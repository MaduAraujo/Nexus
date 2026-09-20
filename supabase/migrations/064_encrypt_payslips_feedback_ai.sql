CREATE OR REPLACE FUNCTION nexus_decrypt_ctx(p_context TEXT, p_cipher TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_kind TEXT := split_part(p_context, ':', 1);
  v_id   UUID;
  v_ok   BOOLEAN := FALSE;
BEGIN
  IF p_cipher IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_kind = 'ai' THEN
    IF NOT is_rh() THEN
      RETURN NULL;
    END IF;
    RETURN nexus_unwrap(p_context, p_cipher);
  END IF;

  BEGIN
    v_id := split_part(p_context, ':', 2)::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  IF v_kind = 'emp' THEN
    v_ok := is_rh() OR v_id = my_employee_id();
  ELSIF v_kind = 'chan' THEN
    v_ok := (is_rh() AND NOT chat_channel_is_dm(v_id)) OR chat_is_member(v_id);
  ELSIF v_kind = 'tkt' THEN
    v_ok := is_rh() OR EXISTS (SELECT 1 FROM hr_tickets t WHERE t.id = v_id AND t.employee_id = my_employee_id());
  ELSIF v_kind = 'slip' THEN
    v_ok := is_rh() OR v_id = my_employee_id();
  ELSIF v_kind = 'fb' THEN
    v_ok := is_rh();
  ELSIF v_kind = 'ail' THEN
    v_ok := is_rh() OR EXISTS (SELECT 1 FROM ai_decision_log l WHERE l.id = v_id AND l.employee_id = my_employee_id());
  END IF;

  IF NOT COALESCE(v_ok, FALSE) THEN
    RETURN NULL;
  END IF;
  RETURN nexus_unwrap(p_context, p_cipher);
END;
$$;

CREATE OR REPLACE FUNCTION nexus_decrypt_ctx_bool(p_context TEXT, p_cipher TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT := nexus_decrypt_ctx(p_context, p_cipher);
BEGIN
  IF v_plain IN ('true', 'false') THEN
    RETURN v_plain::BOOLEAN;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_decrypt_ctx_jsonb(p_context TEXT, p_cipher TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT := nexus_decrypt_ctx(p_context, p_cipher);
BEGIN
  IF v_plain IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_plain::JSONB;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION nexus_decrypt_ctx(TEXT, TEXT)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nexus_decrypt_ctx_bool(TEXT, TEXT)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nexus_decrypt_ctx_jsonb(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx(TEXT, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx_bool(TEXT, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx_jsonb(TEXT, TEXT) TO authenticated;

-- Valor monetário como texto normalizado (2 casas); recusa lixo antes de cifrar. Já cifrado passa direto.
CREATE OR REPLACE FUNCTION nexus_norm_money(p_label TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR p_value LIKE 'nexus:enc1:%' THEN
    RETURN p_value;
  END IF;
  IF p_value !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION '% inválido', p_label USING ERRCODE = '22P02';
  END IF;
  RETURN (p_value::NUMERIC(10, 2))::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_norm_json(p_label TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR p_value LIKE 'nexus:enc1:%' THEN
    RETURN p_value;
  END IF;
  RETURN p_value::JSONB::TEXT;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION '% inválido', p_label USING ERRCODE = '22P02';
END;
$$;

REVOKE ALL ON FUNCTION nexus_norm_money(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_norm_json(TEXT, TEXT)  FROM PUBLIC, anon, authenticated;

DROP VIEW IF EXISTS public.employees_decrypted;

DO $$
DECLARE
  v_col TEXT;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['pcd', 'pensao_alimenticia'] LOOP
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = v_col) <> 'text' THEN
      EXECUTE format('ALTER TABLE employees ALTER COLUMN %I DROP DEFAULT', v_col);
      EXECUTE format('ALTER TABLE employees ALTER COLUMN %I TYPE TEXT USING %I::TEXT', v_col, v_col);
      EXECUTE format('ALTER TABLE employees ALTER COLUMN %I SET DEFAULT ''false''', v_col);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION employees_encrypt_sensitive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'emp:' || NEW.id::TEXT;
BEGIN
  IF NEW.salary IS NOT NULL AND NEW.salary NOT LIKE 'nexus:enc1:%' THEN
    IF NEW.salary !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Salário inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.salary := (NEW.salary::NUMERIC(10, 2))::TEXT;
  END IF;

  IF NEW.birth_date IS NOT NULL AND NEW.birth_date NOT LIKE 'nexus:enc1:%' THEN
    IF NEW.birth_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
      RAISE EXCEPTION 'Data de nascimento inválida' USING ERRCODE = '22007';
    END IF;
    NEW.birth_date := (left(NEW.birth_date, 10)::DATE)::TEXT;
  END IF;

  IF NEW.pcd IS NOT NULL AND NEW.pcd NOT LIKE 'nexus:enc1:%' THEN
    IF lower(NEW.pcd) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Indicador PcD inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.pcd := lower(NEW.pcd);
  END IF;

  IF NEW.pensao_alimenticia IS NOT NULL AND NEW.pensao_alimenticia NOT LIKE 'nexus:enc1:%' THEN
    IF lower(NEW.pensao_alimenticia) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Indicador de pensão alimentícia inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.pensao_alimenticia := lower(NEW.pensao_alimenticia);
  END IF;

  NEW.cpf_hash           := nexus_blind_index(nexus_unwrap(v_ctx, NEW.cpf));
  NEW.cpf                := nexus_wrap(v_ctx, NEW.cpf);
  NEW.rg                 := nexus_wrap(v_ctx, NEW.rg);
  NEW.telefone           := nexus_wrap(v_ctx, NEW.telefone);
  NEW.salary             := nexus_wrap(v_ctx, NEW.salary);
  NEW.chave_pix          := nexus_wrap(v_ctx, NEW.chave_pix);
  NEW.agencia            := nexus_wrap(v_ctx, NEW.agencia);
  NEW.conta              := nexus_wrap(v_ctx, NEW.conta);
  NEW.birth_date         := nexus_wrap(v_ctx, NEW.birth_date);
  NEW.gender             := nexus_wrap(v_ctx, NEW.gender);
  NEW.raca_cor           := nexus_wrap(v_ctx, NEW.raca_cor);
  NEW.deficiencia        := nexus_wrap(v_ctx, NEW.deficiencia);
  NEW.tipo_pensao        := nexus_wrap(v_ctx, NEW.tipo_pensao);
  NEW.pcd                := nexus_wrap(v_ctx, NEW.pcd);
  NEW.pensao_alimenticia := nexus_wrap(v_ctx, NEW.pensao_alimenticia);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_refresh_employees_view()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cols TEXT;
BEGIN
  SELECT string_agg(
           CASE a.attname
             WHEN 'salary'             THEN 'nexus_decrypt_ctx_numeric(''emp:'' || e.id::text, e.salary) AS salary'
             WHEN 'birth_date'         THEN 'nexus_decrypt_ctx_date(''emp:'' || e.id::text, e.birth_date) AS birth_date'
             WHEN 'pcd'                THEN 'nexus_decrypt_ctx_bool(''emp:'' || e.id::text, e.pcd) AS pcd'
             WHEN 'pensao_alimenticia' THEN 'nexus_decrypt_ctx_bool(''emp:'' || e.id::text, e.pensao_alimenticia) AS pensao_alimenticia'
             WHEN 'cpf'                THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.cpf) AS cpf'
             WHEN 'rg'                 THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.rg) AS rg'
             WHEN 'telefone'           THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.telefone) AS telefone'
             WHEN 'chave_pix'          THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.chave_pix) AS chave_pix'
             WHEN 'agencia'            THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.agencia) AS agencia'
             WHEN 'conta'              THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.conta) AS conta'
             WHEN 'gender'             THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.gender) AS gender'
             WHEN 'raca_cor'           THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.raca_cor) AS raca_cor'
             WHEN 'deficiencia'        THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.deficiencia) AS deficiencia'
             WHEN 'tipo_pensao'        THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.tipo_pensao) AS tipo_pensao'
             ELSE format('e.%I', a.attname)
           END,
           ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.employees'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attname <> 'cpf_hash';

  DROP VIEW IF EXISTS public.employees_decrypted;
  EXECUTE format('CREATE VIEW public.employees_decrypted WITH (security_invoker = true) AS SELECT %s FROM public.employees e', v_cols);

  REVOKE ALL ON public.employees_decrypted FROM PUBLIC, anon;
  GRANT SELECT ON public.employees_decrypted TO authenticated;
END;
$$;

REVOKE ALL ON FUNCTION nexus_refresh_employees_view() FROM PUBLIC, anon, authenticated;

ALTER TABLE employees DISABLE TRIGGER employees_updated_at;
UPDATE employees SET cpf = cpf;
ALTER TABLE employees ENABLE TRIGGER employees_updated_at;

SELECT nexus_refresh_employees_view();

DO $$
DECLARE
  v_col TEXT;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['proventos', 'descontos', 'total_proventos', 'total_descontos', 'salario_liquido'] LOOP
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'payslips' AND column_name = v_col) <> 'text' THEN
      EXECUTE format('ALTER TABLE payslips ALTER COLUMN %I TYPE TEXT USING %I::TEXT', v_col, v_col);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION payslips_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'slip:' || NEW.employee_id::TEXT || ':' || NEW.mes || ':';
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.mes IS DISTINCT FROM OLD.mes) THEN
    RAISE EXCEPTION 'Um holerite não pode mudar de colaborador nem de mês' USING ERRCODE = '42501';
  END IF;

  NEW.proventos       := nexus_wrap(v_ctx || 'proventos',       nexus_norm_json('Proventos', NEW.proventos));
  NEW.descontos       := nexus_wrap(v_ctx || 'descontos',       nexus_norm_json('Descontos', NEW.descontos));
  NEW.total_proventos := nexus_wrap(v_ctx || 'total_proventos', nexus_norm_money('Total de proventos', NEW.total_proventos));
  NEW.total_descontos := nexus_wrap(v_ctx || 'total_descontos', nexus_norm_money('Total de descontos', NEW.total_descontos));
  NEW.salario_liquido := nexus_wrap(v_ctx || 'salario_liquido', nexus_norm_money('Salário líquido', NEW.salario_liquido));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION payslips_encrypt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payslips_encrypt_trg ON payslips;
CREATE TRIGGER payslips_encrypt_trg
  BEFORE INSERT OR UPDATE ON payslips
  FOR EACH ROW EXECUTE FUNCTION payslips_encrypt();

UPDATE payslips SET proventos = proventos;

DROP VIEW IF EXISTS payslips_decrypted;
CREATE VIEW payslips_decrypted WITH (security_invoker = true) AS
  SELECT p.id, p.employee_id, p.mes, p.mes_formatado, p.competencia,
         nexus_decrypt_ctx_jsonb('slip:' || p.employee_id::text || ':' || p.mes || ':proventos', p.proventos) AS proventos,
         nexus_decrypt_ctx_jsonb('slip:' || p.employee_id::text || ':' || p.mes || ':descontos', p.descontos) AS descontos,
         nexus_decrypt_ctx_numeric('slip:' || p.employee_id::text || ':' || p.mes || ':total_proventos', p.total_proventos) AS total_proventos,
         nexus_decrypt_ctx_numeric('slip:' || p.employee_id::text || ':' || p.mes || ':total_descontos', p.total_descontos) AS total_descontos,
         nexus_decrypt_ctx_numeric('slip:' || p.employee_id::text || ':' || p.mes || ':salario_liquido', p.salario_liquido) AS salario_liquido,
         p.status, p.pago_em, p.created_by, p.created_at, p.assinado_em, p.assinado_por
    FROM payslips p;

CREATE OR REPLACE FUNCTION anonymous_feedback_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.message := nexus_wrap('fb:' || NEW.id::TEXT || ':message', NEW.message);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION anonymous_feedback_encrypt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS anonymous_feedback_encrypt_trg ON anonymous_feedback;
CREATE TRIGGER anonymous_feedback_encrypt_trg
  BEFORE INSERT OR UPDATE OF message ON anonymous_feedback
  FOR EACH ROW EXECUTE FUNCTION anonymous_feedback_encrypt();

UPDATE anonymous_feedback SET message = message;

DROP VIEW IF EXISTS anonymous_feedback_decrypted;
CREATE VIEW anonymous_feedback_decrypted WITH (security_invoker = true) AS
  SELECT f.id, f.categoria, nexus_decrypt_ctx('fb:' || f.id::text || ':message', f.message) AS message, f.status, f.created_at
    FROM anonymous_feedback f;

DO $$
DECLARE
  v_spec TEXT[];
BEGIN
  FOREACH v_spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['ai_analysis_cache',   'alerts',   '''[]'''],
    ARRAY['ai_analysis_history', 'alerts',   '''[]'''],
    ARRAY['ai_decision_log',     'evidence', NULL]
  ] LOOP
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = v_spec[1] AND column_name = v_spec[2]) <> 'text' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', v_spec[1], v_spec[2]);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TEXT USING %I::TEXT', v_spec[1], v_spec[2], v_spec[2]);
      IF v_spec[3] IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s', v_spec[1], v_spec[2], v_spec[3]);
      END IF;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION ai_analysis_cache_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'ai:cache:' || NEW.cache_key || ':';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cache_key IS DISTINCT FROM OLD.cache_key THEN
    RAISE EXCEPTION 'A chave do cache de análise não pode mudar' USING ERRCODE = '42501';
  END IF;
  NEW.summary := nexus_wrap(v_ctx || 'summary', NEW.summary);
  NEW.alerts  := nexus_wrap(v_ctx || 'alerts', nexus_norm_json('Alertas', NEW.alerts));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_analysis_history_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'ai:hist:' || NEW.id::TEXT || ':';
BEGIN
  NEW.summary := nexus_wrap(v_ctx || 'summary', NEW.summary);
  NEW.alerts  := nexus_wrap(v_ctx || 'alerts', nexus_norm_json('Alertas', NEW.alerts));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_chat_history_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.content := nexus_wrap('ai:chat:' || NEW.id::TEXT || ':content', NEW.content);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_decision_memory_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.description := nexus_wrap('ai:mem:' || NEW.id::TEXT || ':description', NEW.description);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_decision_log_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'ail:' || NEW.id::TEXT || ':';
BEGIN
  NEW.ai_message := nexus_wrap(v_ctx || 'ai_message', NEW.ai_message);
  NEW.evidence   := nexus_wrap(v_ctx || 'evidence', nexus_norm_json('Evidências', NEW.evidence));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ai_analysis_cache_encrypt()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_analysis_history_encrypt() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_chat_history_encrypt()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_decision_memory_encrypt()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_decision_log_encrypt()     FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ai_analysis_cache_encrypt_trg ON ai_analysis_cache;
CREATE TRIGGER ai_analysis_cache_encrypt_trg
  BEFORE INSERT OR UPDATE ON ai_analysis_cache
  FOR EACH ROW EXECUTE FUNCTION ai_analysis_cache_encrypt();

DROP TRIGGER IF EXISTS ai_analysis_history_encrypt_trg ON ai_analysis_history;
CREATE TRIGGER ai_analysis_history_encrypt_trg
  BEFORE INSERT OR UPDATE ON ai_analysis_history
  FOR EACH ROW EXECUTE FUNCTION ai_analysis_history_encrypt();

DROP TRIGGER IF EXISTS ai_chat_history_encrypt_trg ON ai_chat_history;
CREATE TRIGGER ai_chat_history_encrypt_trg
  BEFORE INSERT OR UPDATE OF content ON ai_chat_history
  FOR EACH ROW EXECUTE FUNCTION ai_chat_history_encrypt();

DROP TRIGGER IF EXISTS ai_decision_memory_encrypt_trg ON ai_decision_memory;
CREATE TRIGGER ai_decision_memory_encrypt_trg
  BEFORE INSERT OR UPDATE OF description ON ai_decision_memory
  FOR EACH ROW EXECUTE FUNCTION ai_decision_memory_encrypt();

DROP TRIGGER IF EXISTS ai_decision_log_encrypt_trg ON ai_decision_log;
CREATE TRIGGER ai_decision_log_encrypt_trg
  BEFORE INSERT OR UPDATE OF ai_message, evidence ON ai_decision_log
  FOR EACH ROW EXECUTE FUNCTION ai_decision_log_encrypt();

UPDATE ai_analysis_cache   SET summary = summary;
UPDATE ai_analysis_history SET summary = summary;
UPDATE ai_chat_history     SET content = content;
UPDATE ai_decision_memory  SET description = description;
UPDATE ai_decision_log     SET ai_message = ai_message;

DROP VIEW IF EXISTS ai_analysis_cache_decrypted;
CREATE VIEW ai_analysis_cache_decrypted WITH (security_invoker = true) AS
  SELECT c.id, c.cache_key,
         nexus_decrypt_ctx('ai:cache:' || c.cache_key || ':summary', c.summary) AS summary,
         nexus_decrypt_ctx_jsonb('ai:cache:' || c.cache_key || ':alerts', c.alerts) AS alerts,
         c.health_score, c.analyzed_at
    FROM ai_analysis_cache c;

DROP VIEW IF EXISTS ai_analysis_history_decrypted;
CREATE VIEW ai_analysis_history_decrypted WITH (security_invoker = true) AS
  SELECT h.id,
         nexus_decrypt_ctx('ai:hist:' || h.id::text || ':summary', h.summary) AS summary,
         h.health_score,
         nexus_decrypt_ctx_jsonb('ai:hist:' || h.id::text || ':alerts', h.alerts) AS alerts,
         h.analyzed_at
    FROM ai_analysis_history h;

DROP VIEW IF EXISTS ai_chat_history_decrypted;
CREATE VIEW ai_chat_history_decrypted WITH (security_invoker = true) AS
  SELECT m.id, m.role, nexus_decrypt_ctx('ai:chat:' || m.id::text || ':content', m.content) AS content, m.created_at
    FROM ai_chat_history m;

DROP VIEW IF EXISTS ai_decision_memory_decrypted;
CREATE VIEW ai_decision_memory_decrypted WITH (security_invoker = true) AS
  SELECT d.id, d.action_type, nexus_decrypt_ctx('ai:mem:' || d.id::text || ':description', d.description) AS description, d.created_at
    FROM ai_decision_memory d;

DROP VIEW IF EXISTS ai_decision_log_decrypted;
CREATE VIEW ai_decision_log_decrypted WITH (security_invoker = true) AS
  SELECT l.id, l.employee_id, l.target_table, l.target_id, l.action_type,
         nexus_decrypt_ctx('ail:' || l.id::text || ':ai_message', l.ai_message) AS ai_message,
         nexus_decrypt_ctx_jsonb('ail:' || l.id::text || ':evidence', l.evidence) AS evidence,
         l.decided_by_name, l.decided_by_email, l.created_at
    FROM ai_decision_log l;

REVOKE ALL ON payslips_decrypted, anonymous_feedback_decrypted, ai_analysis_cache_decrypted, ai_analysis_history_decrypted,
              ai_chat_history_decrypted, ai_decision_memory_decrypted, ai_decision_log_decrypted FROM PUBLIC, anon;
GRANT SELECT ON payslips_decrypted, anonymous_feedback_decrypted, ai_analysis_cache_decrypted, ai_analysis_history_decrypted,
                ai_chat_history_decrypted, ai_decision_memory_decrypted, ai_decision_log_decrypted TO authenticated;
