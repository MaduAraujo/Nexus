ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS prova_vida_ms INTEGER;
ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS activity_logs_prova_vida_ms_check;
ALTER TABLE activity_logs ADD CONSTRAINT activity_logs_prova_vida_ms_check
  CHECK (prova_vida_ms IS NULL OR prova_vida_ms BETWEEN 0 AND 60000);

CREATE OR REPLACE FUNCTION nexus_fmt_brl(p_valor NUMERIC)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_valor IS NULL THEN NULL
    ELSE 'R$ ' || translate(to_char(p_valor, 'FM999,999,999,990.00'), ',.', '.,')
  END;
$$;

REVOKE ALL ON FUNCTION nexus_fmt_brl(NUMERIC) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION payslip_itens_diff(p_rotulo TEXT, p_old JSONB, p_new JSONB)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH antes AS (
    SELECT COALESCE(e->>'cod', '') AS cod, COALESCE(e->>'descricao', '') AS descricao,
           sum(CASE WHEN (e->>'valor') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e->>'valor')::NUMERIC END) AS valor
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_old) = 'array' THEN p_old ELSE '[]'::JSONB END) e
     WHERE jsonb_typeof(e) = 'object'
     GROUP BY 1, 2
  ), depois AS (
    SELECT COALESCE(e->>'cod', '') AS cod, COALESCE(e->>'descricao', '') AS descricao,
           sum(CASE WHEN (e->>'valor') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (e->>'valor')::NUMERIC END) AS valor
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_new) = 'array' THEN p_new ELSE '[]'::JSONB END) e
     WHERE jsonb_typeof(e) = 'object'
     GROUP BY 1, 2
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'field', 'holerite_item',
           'label', p_rotulo || ' · ' || COALESCE(NULLIF(COALESCE(d.descricao, a.descricao), ''), COALESCE(d.cod, a.cod)),
           'oldValue', nexus_fmt_brl(a.valor),
           'newValue', nexus_fmt_brl(d.valor)
         ) ORDER BY COALESCE(d.cod, a.cod), COALESCE(d.descricao, a.descricao)), '[]'::JSONB)
    FROM antes a
    FULL JOIN depois d ON d.cod = a.cod AND d.descricao = a.descricao
   WHERE a.valor IS DISTINCT FROM d.valor
      OR a.cod IS NULL
      OR d.cod IS NULL;
$$;

REVOKE ALL ON FUNCTION payslip_itens_diff(TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION payslips_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row     payslips := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_ctx     TEXT := 'slip:' || v_row.employee_id::TEXT || ':' || v_row.mes || ':';
  v_rotulo  TEXT := 'Holerite ' || COALESCE(NULLIF(v_row.mes_formatado, ''), v_row.mes);
  v_changes JSONB := '[]'::JSONB;
  v_old_p   JSONB;
  v_old_d   JSONB;
  v_old_liq NUMERIC;
  v_new_p   JSONB;
  v_new_d   JSONB;
  v_new_liq NUMERIC;
  v_email   TEXT;
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM employees WHERE id = OLD.employee_id) THEN
    RETURN NULL;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_p   := nexus_unwrap(v_ctx || 'proventos', OLD.proventos)::JSONB;
    v_old_d   := nexus_unwrap(v_ctx || 'descontos', OLD.descontos)::JSONB;
    v_old_liq := nexus_unwrap(v_ctx || 'salario_liquido', OLD.salario_liquido)::NUMERIC;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_p   := nexus_unwrap(v_ctx || 'proventos', NEW.proventos)::JSONB;
    v_new_d   := nexus_unwrap(v_ctx || 'descontos', NEW.descontos)::JSONB;
    v_new_liq := nexus_unwrap(v_ctx || 'salario_liquido', NEW.salario_liquido)::NUMERIC;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_changes := jsonb_build_array(jsonb_build_object(
      'field', 'holerite', 'label', v_rotulo, 'oldValue', NULL,
      'newValue', 'Lançado · líquido ' || COALESCE(nexus_fmt_brl(v_new_liq), '—')
    ));
  ELSIF TG_OP = 'DELETE' THEN
    v_changes := jsonb_build_array(jsonb_build_object(
      'field', 'holerite', 'label', v_rotulo,
      'oldValue', 'Líquido ' || COALESCE(nexus_fmt_brl(v_old_liq), '—'), 'newValue', 'Excluído'
    ));
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    v_changes := jsonb_build_array(jsonb_build_object(
      'field', 'holerite_status', 'label', v_rotulo || ' · Situação', 'oldValue', OLD.status, 'newValue', NEW.status
    ));
  END IF;

  v_changes := v_changes
    || payslip_itens_diff(v_rotulo || ' · Provento', v_old_p, v_new_p)
    || payslip_itens_diff(v_rotulo || ' · Desconto', v_old_d, v_new_d);

  IF TG_OP = 'UPDATE' AND v_old_liq IS DISTINCT FROM v_new_liq THEN
    v_changes := v_changes || jsonb_build_array(jsonb_build_object(
      'field', 'holerite_liquido', 'label', v_rotulo || ' · Líquido',
      'oldValue', nexus_fmt_brl(v_old_liq), 'newValue', nexus_fmt_brl(v_new_liq)
    ));
  END IF;

  IF jsonb_array_length(v_changes) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO employee_audit (employee_id, changes, operator_name, operator_email)
  VALUES (v_row.employee_id, v_changes, COALESCE(split_part(v_email, '@', 1), 'Sistema'), v_email);

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION payslips_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payslips_z_audit_trg ON payslips;
CREATE TRIGGER payslips_z_audit_trg
  AFTER INSERT OR UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION payslips_audit();

ALTER TABLE trainings ADD COLUMN IF NOT EXISTS validade_meses SMALLINT;
ALTER TABLE trainings DROP CONSTRAINT IF EXISTS trainings_validade_meses_check;
ALTER TABLE trainings ADD CONSTRAINT trainings_validade_meses_check
  CHECK (validade_meses IS NULL OR validade_meses BETWEEN 1 AND 120);

ALTER TABLE employee_trainings ADD COLUMN IF NOT EXISTS certificado_valido_ate DATE;
ALTER TABLE employee_trainings DROP CONSTRAINT IF EXISTS employee_trainings_certificado_valido_ate_check;
ALTER TABLE employee_trainings ADD CONSTRAINT employee_trainings_certificado_valido_ate_check
  CHECK (certificado_valido_ate IS NULL OR completion_date IS NULL OR certificado_valido_ate >= completion_date);

CREATE OR REPLACE FUNCTION employee_trainings_validade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meses SMALLINT;
BEGIN
  IF NEW.status = 'concluido' AND NEW.completion_date IS NOT NULL AND NEW.certificado_valido_ate IS NULL
     AND NEW.training_id IS NOT NULL THEN
    SELECT validade_meses INTO v_meses FROM trainings WHERE id = NEW.training_id;
    IF v_meses IS NOT NULL THEN
      NEW.certificado_valido_ate := (NEW.completion_date + make_interval(months => v_meses))::DATE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employee_trainings_validade() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employee_trainings_validade_trg ON employee_trainings;
CREATE TRIGGER employee_trainings_validade_trg
  BEFORE INSERT OR UPDATE ON employee_trainings
  FOR EACH ROW EXECUTE FUNCTION employee_trainings_validade();

ALTER TABLE employees ADD COLUMN IF NOT EXISTS expediente_inicio SMALLINT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS expediente_fim SMALLINT;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_expediente_check;
ALTER TABLE employees ADD CONSTRAINT employees_expediente_check CHECK (
  (expediente_inicio IS NULL AND expediente_fim IS NULL)
  OR (expediente_inicio IS NOT NULL AND expediente_fim IS NOT NULL
      AND expediente_inicio BETWEEN 0 AND 23 AND expediente_fim BETWEEN 1 AND 24 AND expediente_inicio <> expediente_fim)
);

ALTER TABLE convencoes_coletivas ADD COLUMN IF NOT EXISTS expediente_inicio SMALLINT;
ALTER TABLE convencoes_coletivas ADD COLUMN IF NOT EXISTS expediente_fim SMALLINT;
ALTER TABLE convencoes_coletivas DROP CONSTRAINT IF EXISTS convencoes_coletivas_expediente_check;
ALTER TABLE convencoes_coletivas ADD CONSTRAINT convencoes_coletivas_expediente_check CHECK (
  (expediente_inicio IS NULL AND expediente_fim IS NULL)
  OR (expediente_inicio IS NOT NULL AND expediente_fim IS NOT NULL
      AND expediente_inicio BETWEEN 0 AND 23 AND expediente_fim BETWEEN 1 AND 24 AND expediente_inicio <> expediente_fim)
);

SELECT nexus_refresh_employees_view();

ALTER TABLE messages ADD COLUMN IF NOT EXISTS push_sent_to UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS push_next_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION dispatch_deferred_pushes()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_msg         RECORD;
  v_alert       RECORD;
  v_url         TEXT;
  v_service_key TEXT;
  v_hour        INT := extract(hour FROM NOW() AT TIME ZONE 'America/Sao_Paulo');
  v_dow         INT := extract(dow  FROM NOW() AT TIME ZONE 'America/Sao_Paulo');
BEGIN
  SELECT decrypted_secret INTO v_url         FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'dispatch_deferred_pushes: vault secrets project_url/service_role_key ausentes — pushes adiados (comunicados, compliance, burnout, segurança) não serão enviados';
    RETURN;
  END IF;

  FOR v_msg IN
    SELECT id FROM messages
    WHERE push_sent_at IS NULL
      AND COALESCE(push_next_at, scheduled_at) <= NOW()
      AND (scheduled_at IS NULL OR scheduled_at <= NOW())
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

  IF v_dow IN (0, 6) OR v_hour < 8 OR v_hour >= 18 THEN
    RETURN;
  END IF;

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

REVOKE ALL ON FUNCTION dispatch_deferred_pushes() FROM PUBLIC, anon, authenticated;
