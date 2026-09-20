CREATE TABLE IF NOT EXISTS security_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL CHECK (kind IN ('login_failed', 'login_success', 'data_export', 'file_download')),
  actor_id   UUID,
  email_hash TEXT,
  ip         TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_actor_idx ON security_events(kind, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_hash_idx  ON security_events(kind, email_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_time_idx  ON security_events(created_at);

CREATE TABLE IF NOT EXISTS security_rules (
  kind             TEXT PRIMARY KEY CHECK (kind IN ('login_failures', 'login_after_failures', 'mass_export', 'mass_download', 'off_hours_access')),
  enabled          BOOLEAN NOT NULL DEFAULT true,
  threshold        INTEGER NOT NULL DEFAULT 1 CHECK (threshold >= 1),
  threshold_rows   INTEGER CHECK (threshold_rows IS NULL OR threshold_rows >= 1),
  window_minutes   INTEGER NOT NULL DEFAULT 60 CHECK (window_minutes >= 1),
  cooldown_minutes INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes >= 1),
  severity         TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('critical', 'warning', 'info')),
  params           JSONB NOT NULL DEFAULT '{}'::jsonb,
  description      TEXT NOT NULL DEFAULT ''
);

INSERT INTO security_rules (kind, threshold, threshold_rows, window_minutes, cooldown_minutes, severity, params, description) VALUES
  ('login_failures',       5,  NULL, 15,  60,  'warning',  '{}',
   'Tentativas de login falhas em série na mesma conta'),
  ('login_after_failures', 3,  NULL, 30,  60,  'warning',  '{}',
   'Login bem-sucedido logo depois de várias falhas (possível senha adivinhada)'),
  ('mass_export',          5,  500,  60,  60,  'warning',  '{}',
   'Muitas exportações ou volume grande de registros exportados pela mesma pessoa'),
  ('mass_download',        30, NULL, 10,  30,  'warning',  '{}',
   'Muitos arquivos baixados pela mesma pessoa em pouco tempo'),
  ('off_hours_access',     1,  NULL, 60,  720, 'warning',
   '{"start_hour": 8, "end_hour": 18, "weekdays_only": true, "profiles": ["Administrador"]}',
   'Acesso ao painel fora do horário comercial (fuso America/Sao_Paulo)')
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS security_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL CHECK (kind IN ('login_failures', 'login_after_failures', 'mass_export', 'mass_download', 'off_hours_access')),
  severity         TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  subject_key      TEXT NOT NULL,
  actor_id         UUID,
  subject_label    TEXT NOT NULL,
  title            TEXT NOT NULL,
  message          TEXT NOT NULL,
  detail           JSONB NOT NULL DEFAULT '{}'::jsonb,
  lido             BOOLEAN NOT NULL DEFAULT false,
  lido_at          TIMESTAMPTZ,
  lido_por         UUID,
  push_scheduled_at TIMESTAMPTZ,
  push_sent_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_alerts_recent_idx  ON security_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS security_alerts_subject_idx ON security_alerts(kind, subject_key, created_at DESC);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON security_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON security_rules  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON security_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON security_rules  TO authenticated;
GRANT SELECT ON security_alerts TO authenticated;

DROP POLICY IF EXISTS "rh_security_rules_select"  ON security_rules;
DROP POLICY IF EXISTS "rh_security_alerts_select" ON security_alerts;
CREATE POLICY "rh_security_rules_select"  ON security_rules  FOR SELECT USING (is_rh());
CREATE POLICY "rh_security_alerts_select" ON security_alerts FOR SELECT USING (is_rh());

-- Política mfa_required (migration 063) nas tabelas novas. Se a 063 ainda não foi aplicada, esta migration não depende dela:
-- o laço da 063 cobre toda tabela com RLS existente na hora em que rodar, inclusive estas.
DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('public.mfa_ok()') IS NULL THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['security_events', 'security_rules', 'security_alerts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t);
    EXECUTE format('CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION security_request_ip()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ip TEXT;
BEGIN
  BEGIN
    v_ip := trim(split_part(COALESCE(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF v_ip !~ '^[0-9a-fA-F:.]{2,45}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_ip;
END;
$$;

CREATE OR REPLACE FUNCTION security_subject_label(p_actor UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(e.name, ''), u.email, 'Usuário removido')
  FROM (SELECT 1) one
  LEFT JOIN auth.users u ON u.id = p_actor
  LEFT JOIN profiles p ON p.id = p_actor
  LEFT JOIN employees e ON e.id = p.employee_id;
$$;

CREATE OR REPLACE FUNCTION security_raise_alert(
  p_rule        security_rules,
  p_subject_key TEXT,
  p_actor       UUID,
  p_label       TEXT,
  p_title       TEXT,
  p_message     TEXT,
  p_detail      JSONB,
  p_severity    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('security_alert:' || p_rule.kind || ':' || p_subject_key));

  IF EXISTS (
    SELECT 1 FROM security_alerts
    WHERE kind = p_rule.kind AND subject_key = p_subject_key
      AND created_at > now() - make_interval(mins => p_rule.cooldown_minutes)
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO security_alerts (kind, severity, subject_key, actor_id, subject_label, title, message, detail)
  VALUES (p_rule.kind, COALESCE(p_severity, p_rule.severity), p_subject_key, p_actor, p_label, p_title, p_message, COALESCE(p_detail, '{}'::jsonb))
  RETURNING id INTO v_id;

  BEGIN
    PERFORM notify_alert_push('security_alerts', v_id);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'security_raise_alert: push do alerta % não enviado (%)', v_id, SQLERRM;
  END;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION security_insert_event(
  p_kind       TEXT,
  p_actor      UUID,
  p_email_hash TEXT,
  p_detail     JSONB,
  p_cap_hour   INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent INTEGER;
BEGIN
  SELECT count(*) INTO v_recent FROM security_events
  WHERE kind = p_kind
    AND created_at > now() - interval '1 hour'
    AND ((p_actor IS NOT NULL AND actor_id = p_actor) OR (p_email_hash IS NOT NULL AND email_hash = p_email_hash));

  IF v_recent >= p_cap_hour THEN
    RETURN FALSE;
  END IF;

  INSERT INTO security_events (kind, actor_id, email_hash, ip, detail)
  VALUES (p_kind, p_actor, p_email_hash, security_request_ip(), COALESCE(p_detail, '{}'::jsonb));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION security_check_login_failures(p_actor UUID, p_email_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule    security_rules;
  v_count   INTEGER;
  v_last_ip TEXT;
  v_label   TEXT;
  v_key     TEXT;
BEGIN
  SELECT * INTO v_rule FROM security_rules WHERE kind = 'login_failures' AND enabled;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO v_count FROM security_events
  WHERE kind = 'login_failed'
    AND created_at > now() - make_interval(mins => v_rule.window_minutes)
    AND ((p_actor IS NOT NULL AND actor_id = p_actor) OR (p_email_hash IS NOT NULL AND email_hash = p_email_hash));

  IF v_count < v_rule.threshold THEN RETURN; END IF;

  SELECT ip INTO v_last_ip FROM security_events
  WHERE kind = 'login_failed' AND ip IS NOT NULL
    AND ((p_actor IS NOT NULL AND actor_id = p_actor) OR (p_email_hash IS NOT NULL AND email_hash = p_email_hash))
  ORDER BY created_at DESC LIMIT 1;

  IF p_actor IS NOT NULL THEN
    v_key := p_actor::TEXT;
    v_label := security_subject_label(p_actor);
  ELSE
    v_key := p_email_hash;
    v_label := 'E-mail não cadastrado (' || left(p_email_hash, 6) || ')';
  END IF;

  PERFORM security_raise_alert(
    v_rule, v_key, p_actor, v_label,
    format('%s tentativas de login falhas em %s min', v_count, v_rule.window_minutes),
    format('%s teve %s tentativas de login sem sucesso nos últimos %s minutos.%s', v_label, v_count, v_rule.window_minutes,
           CASE WHEN v_last_ip IS NOT NULL THEN ' Último IP: ' || v_last_ip || '.' ELSE '' END),
    jsonb_build_object('failures', v_count, 'window_minutes', v_rule.window_minutes, 'last_ip', v_last_ip),
    CASE WHEN p_actor IS NULL THEN 'info' ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION report_login_failure(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_hash  TEXT;
  v_uid   UUID;
BEGIN
  IF length(v_email) < 3 OR length(v_email) > 254 THEN
    RETURN;
  END IF;

  IF (SELECT count(*) FROM security_events WHERE kind = 'login_failed' AND created_at > now() - interval '1 hour') >= 5000 THEN
    RETURN;
  END IF;

  v_hash := encode(digest(v_email, 'sha256'), 'hex');
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  PERFORM security_insert_event('login_failed', v_uid, v_hash, jsonb_build_object('stage', 'password'), 60);
  PERFORM security_check_login_failures(v_uid, v_hash);
EXCEPTION WHEN others THEN
  RAISE WARNING 'report_login_failure: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION report_mfa_failure()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  PERFORM security_insert_event('login_failed', v_uid, NULL, jsonb_build_object('stage', 'mfa'), 60);
  PERFORM security_check_login_failures(v_uid, NULL);
EXCEPTION WHEN others THEN
  RAISE WARNING 'report_mfa_failure: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION record_access(p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   TEXT;
  v_rule      security_rules;
  v_failures  INTEGER;
  v_sp        TIMESTAMP;
  v_hour      INTEGER;
  v_dow       INTEGER;
  v_start     INTEGER;
  v_end       INTEGER;
  v_off       BOOLEAN;
  v_ip        TEXT := security_request_ip();
BEGIN
  IF v_uid IS NULL OR p_kind NOT IN ('login', 'session') THEN RETURN; END IF;

  SELECT profile INTO v_profile FROM profiles WHERE id = v_uid;
  IF v_profile IS NULL THEN RETURN; END IF;

  IF p_kind = 'login' THEN
    PERFORM security_insert_event('login_success', v_uid, NULL, jsonb_build_object('profile', v_profile), 60);

    SELECT * INTO v_rule FROM security_rules WHERE kind = 'login_after_failures' AND enabled;
    IF FOUND THEN
      SELECT count(*) INTO v_failures FROM security_events
      WHERE kind = 'login_failed' AND actor_id = v_uid
        AND created_at > now() - make_interval(mins => v_rule.window_minutes);

      IF v_failures >= v_rule.threshold THEN
        PERFORM security_raise_alert(
          v_rule, v_uid::TEXT, v_uid, security_subject_label(v_uid),
          format('Login concluído após %s falhas seguidas', v_failures),
          format('%s entrou com sucesso depois de %s tentativas falhas nos últimos %s minutos. Se não foi essa pessoa, troque a senha da conta.%s',
                 security_subject_label(v_uid), v_failures, v_rule.window_minutes, CASE WHEN v_ip IS NOT NULL THEN ' IP: ' || v_ip || '.' ELSE '' END),
          jsonb_build_object('failures', v_failures, 'window_minutes', v_rule.window_minutes, 'ip', v_ip)
        );
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_rule FROM security_rules WHERE kind = 'off_hours_access' AND enabled;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT ((v_rule.params -> 'profiles') ? v_profile) THEN RETURN; END IF;

  v_sp    := now() AT TIME ZONE 'America/Sao_Paulo';
  v_hour  := extract(hour FROM v_sp);
  v_dow   := extract(dow FROM v_sp);
  v_start := COALESCE((v_rule.params ->> 'start_hour')::INTEGER, 8);
  v_end   := COALESCE((v_rule.params ->> 'end_hour')::INTEGER, 18);
  v_off   := v_hour < v_start OR v_hour >= v_end
             OR (COALESCE((v_rule.params ->> 'weekdays_only')::BOOLEAN, true) AND v_dow IN (0, 6));

  IF NOT v_off THEN RETURN; END IF;

  PERFORM security_raise_alert(
    v_rule, v_uid::TEXT, v_uid, security_subject_label(v_uid),
    'Acesso fora do horário comercial',
    format('%s acessou o painel em %s, fora do horário comercial (%sh às %sh%s).%s',
           security_subject_label(v_uid), to_char(v_sp, 'DD/MM/YYYY "às" HH24:MI'), v_start, v_end,
           CASE WHEN COALESCE((v_rule.params ->> 'weekdays_only')::BOOLEAN, true) THEN ', dias úteis' ELSE '' END,
           CASE WHEN v_ip IS NOT NULL THEN ' IP: ' || v_ip || '.' ELSE '' END),
    jsonb_build_object('at', to_char(v_sp, 'YYYY-MM-DD"T"HH24:MI'), 'via', p_kind, 'ip', v_ip)
  );
EXCEPTION WHEN others THEN
  RAISE WARNING 'record_access: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION report_data_export(p_source TEXT, p_rows INTEGER DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_rule    security_rules;
  v_source  TEXT := left(regexp_replace(COALESCE(p_source, ''), '[^a-zA-Z0-9_.-]', '', 'g'), 60);
  v_rows    INTEGER := GREATEST(0, LEAST(COALESCE(p_rows, 0), 1000000));
  v_count   INTEGER;
  v_total   BIGINT;
  v_sources TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  PERFORM security_insert_event('data_export', v_uid, NULL, jsonb_build_object('source', v_source, 'rows', v_rows), 200);

  SELECT * INTO v_rule FROM security_rules WHERE kind = 'mass_export' AND enabled;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), COALESCE(sum((detail ->> 'rows')::BIGINT), 0),
         string_agg(DISTINCT detail ->> 'source', ', ')
    INTO v_count, v_total, v_sources
  FROM security_events
  WHERE kind = 'data_export' AND actor_id = v_uid
    AND created_at > now() - make_interval(mins => v_rule.window_minutes);

  IF v_count >= v_rule.threshold OR (v_rule.threshold_rows IS NOT NULL AND v_total >= v_rule.threshold_rows) THEN
    PERFORM security_raise_alert(
      v_rule, v_uid::TEXT, v_uid, security_subject_label(v_uid),
      format('%s exportações (%s registros) em %s min', v_count, v_total, v_rule.window_minutes),
      format('%s exportou dados %s vez(es), somando %s registros, nos últimos %s minutos (%s).',
             security_subject_label(v_uid), v_count, v_total, v_rule.window_minutes, COALESCE(v_sources, 'origem não informada')),
      jsonb_build_object('exports', v_count, 'rows', v_total, 'window_minutes', v_rule.window_minutes, 'sources', v_sources)
    );
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'report_data_export: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION report_file_download(p_bucket TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_rule   security_rules;
  v_bucket TEXT := left(regexp_replace(COALESCE(p_bucket, ''), '[^a-zA-Z0-9_.-]', '', 'g'), 60);
  v_count  INTEGER;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  PERFORM security_insert_event('file_download', v_uid, NULL, jsonb_build_object('bucket', v_bucket), 500);

  SELECT * INTO v_rule FROM security_rules WHERE kind = 'mass_download' AND enabled;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO v_count FROM security_events
  WHERE kind = 'file_download' AND actor_id = v_uid
    AND created_at > now() - make_interval(mins => v_rule.window_minutes);

  IF v_count >= v_rule.threshold THEN
    PERFORM security_raise_alert(
      v_rule, v_uid::TEXT, v_uid, security_subject_label(v_uid),
      format('%s arquivos baixados em %s min', v_count, v_rule.window_minutes),
      format('%s baixou %s arquivos nos últimos %s minutos.', security_subject_label(v_uid), v_count, v_rule.window_minutes),
      jsonb_build_object('downloads', v_count, 'window_minutes', v_rule.window_minutes)
    );
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'report_file_download: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION mark_security_alerts_read(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  UPDATE security_alerts SET lido = true, lido_at = now(), lido_por = auth.uid()
  WHERE id = ANY (p_ids) AND NOT lido;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION purge_security_events()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM security_events WHERE created_at < now() - interval '180 days';
$$;

REVOKE ALL ON FUNCTION security_request_ip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_subject_label(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_raise_alert(security_rules, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_insert_event(TEXT, UUID, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_check_login_failures(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_login_failure(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_mfa_failure() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_access(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_data_export(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_file_download(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_security_alerts_read(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION purge_security_events() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION report_login_failure(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION report_mfa_failure() TO authenticated;
GRANT EXECUTE ON FUNCTION record_access(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION report_data_export(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION report_file_download(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_security_alerts_read(UUID[]) TO authenticated;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('purge-security-events', '30 6 * * *', 'SELECT purge_security_events();');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION dispatch_deferred_pushes()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg         RECORD;
  v_alert       RECORD;
  v_url         TEXT;
  v_service_key TEXT;
  v_hour        INT := extract(hour FROM NOW() AT TIME ZONE 'America/Sao_Paulo');
  v_dow         INT := extract(dow  FROM NOW() AT TIME ZONE 'America/Sao_Paulo');
BEGIN
  IF v_dow IN (0, 6) OR v_hour < 8 OR v_hour >= 18 THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url         FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'dispatch_deferred_pushes: vault secrets project_url/service_role_key ausentes — pushes adiados (comunicados, compliance, burnout, segurança) não serão enviados';
    RETURN;
  END IF;

  FOR v_msg IN
    SELECT id FROM messages
    WHERE scheduled_at IS NOT NULL
      AND scheduled_at <= NOW()
      AND push_sent_at IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
  LOOP
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('message_id', v_msg.id)
    );
  END LOOP;

  FOR v_alert IN
    SELECT id FROM compliance_alerts
    WHERE push_scheduled_at IS NOT NULL
      AND push_scheduled_at <= NOW()
      AND push_sent_at IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
  LOOP
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-alert-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('table', 'compliance_alerts', 'id', v_alert.id)
    );
  END LOOP;

  FOR v_alert IN
    SELECT id FROM burnout_alerts
    WHERE push_scheduled_at IS NOT NULL
      AND push_scheduled_at <= NOW()
      AND push_sent_at IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
  LOOP
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-alert-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('table', 'burnout_alerts', 'id', v_alert.id)
    );
  END LOOP;

  FOR v_alert IN
    SELECT id FROM security_alerts
    WHERE push_scheduled_at IS NOT NULL
      AND push_scheduled_at <= NOW()
      AND push_sent_at IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
  LOOP
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-alert-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('table', 'security_alerts', 'id', v_alert.id)
    );
  END LOOP;
END;
$$;