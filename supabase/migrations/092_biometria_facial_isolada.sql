CREATE TABLE IF NOT EXISTS biometric_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  template        TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS biometric_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  matched     BOOLEAN NOT NULL,
  distance    NUMERIC(6, 4),
  vector_hash TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS biometric_verifications_emp_idx ON biometric_verifications(employee_id, created_at DESC);

ALTER TABLE biometric_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON biometric_templates, biometric_verifications FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('public.mfa_ok()') IS NULL THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['biometric_templates', 'biometric_verifications'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t);
    EXECUTE format('CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION biometric_templates_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.template   := nexus_wrap('bio:' || NEW.employee_id::TEXT, nexus_norm_json('Modelo biométrico', NEW.template));
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION biometric_templates_encrypt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS biometric_templates_encrypt_trg ON biometric_templates;
CREATE TRIGGER biometric_templates_encrypt_trg
  BEFORE INSERT OR UPDATE ON biometric_templates
  FOR EACH ROW EXECUTE FUNCTION biometric_templates_encrypt();

CREATE OR REPLACE FUNCTION biometric_descriptor_ok(p_descriptor JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_typeof(p_descriptor) = 'array'
     AND jsonb_array_length(p_descriptor) = 128
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_descriptor) v
        WHERE jsonb_typeof(v) <> 'number' OR abs(v::TEXT::NUMERIC) > 10
     );
$$;

REVOKE ALL ON FUNCTION biometric_descriptor_ok(JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION biometric_status()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp UUID := my_employee_id();
  v_row biometric_templates;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Somente o próprio colaborador consulta a sua biometria.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM biometric_templates WHERE employee_id = v_emp;
  RETURN jsonb_build_object('enrolled', FOUND, 'consent_at', v_row.consent_at, 'consent_version', v_row.consent_version);
END;
$$;

CREATE OR REPLACE FUNCTION biometric_enroll(p_descriptor JSONB, p_consent BOOLEAN, p_consent_version TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp UUID := my_employee_id();
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Somente o próprio colaborador cadastra a sua biometria.' USING ERRCODE = '42501';
  END IF;
  IF p_consent IS NOT TRUE OR btrim(COALESCE(p_consent_version, '')) = '' THEN
    RAISE EXCEPTION 'O cadastro da biometria exige o seu consentimento específico (LGPD art. 11).' USING ERRCODE = '22023';
  END IF;
  IF NOT biometric_descriptor_ok(p_descriptor) THEN
    RAISE EXCEPTION 'Modelo facial inválido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO biometric_templates (employee_id, template, consent_version, consent_at)
  VALUES (v_emp, p_descriptor::TEXT, p_consent_version, NOW())
  ON CONFLICT (employee_id) DO UPDATE
     SET template = EXCLUDED.template, consent_version = EXCLUDED.consent_version, consent_at = EXCLUDED.consent_at;

  RETURN jsonb_build_object('enrolled', true);
END;
$$;

CREATE OR REPLACE FUNCTION biometric_verify(p_descriptor JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_emp       UUID := my_employee_id();
  v_cipher    TEXT;
  v_template  JSONB;
  v_distance  NUMERIC;
  v_matched   BOOLEAN;
  v_id        UUID;
  v_hash      TEXT := encode(digest(p_descriptor::TEXT, 'sha256'), 'hex');
  c_threshold CONSTANT NUMERIC := 0.55;
  c_replay    CONSTANT NUMERIC := 0.01;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Somente o próprio colaborador verifica a sua biometria.' USING ERRCODE = '42501';
  END IF;
  IF NOT biometric_descriptor_ok(p_descriptor) THEN
    RAISE EXCEPTION 'Modelo facial inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT template INTO v_cipher FROM biometric_templates WHERE employee_id = v_emp;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enrolled', false);
  END IF;

  IF (SELECT count(*) FROM biometric_verifications
       WHERE employee_id = v_emp AND created_at > NOW() - INTERVAL '10 minutes') >= 10 THEN
    RAISE EXCEPTION 'Muitas tentativas de verificação. Aguarde alguns minutos.' USING ERRCODE = '54000';
  END IF;

  v_template := nexus_unwrap('bio:' || v_emp::TEXT, v_cipher)::JSONB;
  SELECT sqrt(sum(power(a.v::TEXT::NUMERIC - b.v::TEXT::NUMERIC, 2)))
    INTO v_distance
    FROM jsonb_array_elements(v_template) WITH ORDINALITY a(v, i)
    JOIN jsonb_array_elements(p_descriptor) WITH ORDINALITY b(v, i) USING (i);
  v_matched := v_distance <= c_threshold
               AND v_distance >= c_replay
               AND NOT EXISTS (SELECT 1 FROM biometric_verifications WHERE employee_id = v_emp AND vector_hash = v_hash);

  INSERT INTO biometric_verifications (employee_id, matched, distance, vector_hash)
  VALUES (v_emp, v_matched, round(v_distance, 4), v_hash)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('enrolled', true, 'matched', v_matched, 'verification_id', CASE WHEN v_matched THEN v_id END);
END;
$$;

CREATE OR REPLACE FUNCTION biometric_revoke()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp UUID := my_employee_id();
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Somente o próprio colaborador revoga a sua biometria.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM biometric_templates WHERE employee_id = v_emp;
  DELETE FROM biometric_verifications WHERE employee_id = v_emp;
  RETURN jsonb_build_object('enrolled', false);
END;
$$;

REVOKE ALL ON FUNCTION biometric_status()                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION biometric_enroll(JSONB, BOOLEAN, TEXT)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION biometric_verify(JSONB)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION biometric_revoke()                        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biometric_status()                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION biometric_enroll(JSONB, BOOLEAN, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION biometric_verify(JSONB)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION biometric_revoke()                     TO authenticated, service_role;

CREATE OR REPLACE FUNCTION biometric_consume_for_punch(p_employee_id UUID, p_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_employee_id IS DISTINCT FROM my_employee_id() THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM biometric_templates WHERE employee_id = p_employee_id) THEN
    RETURN true;
  END IF;
  UPDATE biometric_verifications
     SET consumed_at = NOW()
   WHERE id = p_token
     AND employee_id = p_employee_id
     AND matched
     AND consumed_at IS NULL
     AND created_at > NOW() - INTERVAL '15 minutes';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION biometric_consume_for_punch(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biometric_consume_for_punch(UUID, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS punch_time_record(DATE, TEXT, JSONB, TEXT);

CREATE OR REPLACE FUNCTION punch_time_record(
  p_date            DATE,
  p_step            TEXT,
  p_loc             JSONB DEFAULT NULL,
  p_selfie_path     TEXT DEFAULT NULL,
  p_biometric_token UUID DEFAULT NULL
)
RETURNS time_records
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_employee_id UUID := my_employee_id();
  v_result      time_records;
BEGIN
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Usuário autenticado não é um colaborador com ponto habilitado';
  END IF;
  IF p_step NOT IN ('entrada', 'saida_almoco', 'retorno_almoco', 'saida') THEN
    RAISE EXCEPTION 'Etapa de ponto inválida: %', p_step;
  END IF;
  IF NOT biometric_consume_for_punch(v_employee_id, p_biometric_token) THEN
    RAISE EXCEPTION 'Verificação facial ausente ou expirada. Tire a selfie novamente.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO time_records (employee_id, date)
  VALUES (v_employee_id, p_date)
  ON CONFLICT (employee_id, date) DO NOTHING;

  IF p_step = 'entrada' THEN
    UPDATE time_records SET entrada = now(), entrada_loc = p_loc, entrada_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSIF p_step = 'saida_almoco' THEN
    UPDATE time_records SET saida_almoco = now(), saida_almoco_loc = p_loc, saida_almoco_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSIF p_step = 'retorno_almoco' THEN
    UPDATE time_records SET retorno_almoco = now(), retorno_almoco_loc = p_loc, retorno_almoco_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSE
    UPDATE time_records SET saida = now(), saida_loc = p_loc, saida_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION punch_time_record(DATE, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION punch_time_record(DATE, TEXT, JSONB, TEXT, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION nexus_encrypted_columns()
RETURNS TABLE (tbl TEXT, col TEXT, ctx TEXT)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT * FROM (VALUES
    ('employees', 'cpf',                $q$'emp:' || t.id::text$q$),
    ('employees', 'rg',                 $q$'emp:' || t.id::text$q$),
    ('employees', 'telefone',           $q$'emp:' || t.id::text$q$),
    ('employees', 'salary',             $q$'emp:' || t.id::text$q$),
    ('employees', 'chave_pix',          $q$'emp:' || t.id::text$q$),
    ('employees', 'agencia',            $q$'emp:' || t.id::text$q$),
    ('employees', 'conta',              $q$'emp:' || t.id::text$q$),
    ('employees', 'birth_date',         $q$'emp:' || t.id::text$q$),
    ('employees', 'gender',             $q$'emp:' || t.id::text$q$),
    ('employees', 'raca_cor',           $q$'emp:' || t.id::text$q$),
    ('employees', 'deficiencia',        $q$'emp:' || t.id::text$q$),
    ('employees', 'tipo_pensao',        $q$'emp:' || t.id::text$q$),
    ('employees', 'pcd',                $q$'emp:' || t.id::text$q$),
    ('employees', 'pensao_alimenticia', $q$'emp:' || t.id::text$q$),
    ('employee_audit', 'changes',       $q$'emp:' || t.employee_id::text || ':audit:' || t.id::text$q$),
    ('chat_messages',       'content',  $q$'chan:' || t.channel_id::text$q$),
    ('hr_ticket_messages',  'content',  $q$'tkt:' || t.ticket_id::text$q$),
    ('payslips', 'proventos',       $q$'slip:' || t.employee_id::text || ':' || t.mes || ':proventos'$q$),
    ('payslips', 'descontos',       $q$'slip:' || t.employee_id::text || ':' || t.mes || ':descontos'$q$),
    ('payslips', 'total_proventos', $q$'slip:' || t.employee_id::text || ':' || t.mes || ':total_proventos'$q$),
    ('payslips', 'total_descontos', $q$'slip:' || t.employee_id::text || ':' || t.mes || ':total_descontos'$q$),
    ('payslips', 'salario_liquido', $q$'slip:' || t.employee_id::text || ':' || t.mes || ':salario_liquido'$q$),
    ('anonymous_feedback',  'message',     $q$'fb:' || t.id::text || ':message'$q$),
    ('ai_analysis_cache',   'summary',     $q$'ai:cache:' || t.cache_key || ':summary'$q$),
    ('ai_analysis_cache',   'alerts',      $q$'ai:cache:' || t.cache_key || ':alerts'$q$),
    ('ai_analysis_history', 'summary',     $q$'ai:hist:' || t.id::text || ':summary'$q$),
    ('ai_analysis_history', 'alerts',      $q$'ai:hist:' || t.id::text || ':alerts'$q$),
    ('ai_chat_history',     'content',     $q$'ai:chat:' || t.id::text || ':content'$q$),
    ('ai_decision_memory',  'description', $q$'ai:mem:' || t.id::text || ':description'$q$),
    ('ai_decision_log',     'ai_message',  $q$'ail:' || t.id::text || ':ai_message'$q$),
    ('ai_decision_log',     'evidence',    $q$'ail:' || t.id::text || ':evidence'$q$),
    ('biometric_templates', 'template',    $q$'bio:' || t.employee_id::text$q$)
  ) AS r (tbl, col, ctx);
$$;

REVOKE ALL ON FUNCTION nexus_encrypted_columns() FROM PUBLIC, anon, authenticated;
