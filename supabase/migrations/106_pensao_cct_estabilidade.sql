ALTER TABLE employees ADD COLUMN IF NOT EXISTS pensao_valor TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_type TEXT;

CREATE TABLE IF NOT EXISTS convencoes_coletivas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  sindicato        TEXT,
  vigencia_inicio  DATE NOT NULL,
  vigencia_fim     DATE NOT NULL,
  piso_salarial    NUMERIC(10, 2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nome),
  CHECK (vigencia_fim >= vigencia_inicio),
  CHECK (vigencia_fim <= vigencia_inicio + INTERVAL '2 years'),
  CHECK (piso_salarial > 0)
);

DROP TRIGGER IF EXISTS convencoes_coletivas_updated_at ON convencoes_coletivas;
CREATE TRIGGER convencoes_coletivas_updated_at
  BEFORE UPDATE ON convencoes_coletivas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE convencoes_coletivas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON convencoes_coletivas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON convencoes_coletivas TO authenticated;
DROP POLICY IF EXISTS "rh_convencoes_coletivas_all" ON convencoes_coletivas;
CREATE POLICY "rh_convencoes_coletivas_all" ON convencoes_coletivas FOR ALL
  USING ((SELECT public.is_rh())) WITH CHECK ((SELECT public.is_rh()));
DROP POLICY IF EXISTS mfa_required ON convencoes_coletivas;
CREATE POLICY mfa_required ON convencoes_coletivas AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()));

ALTER TABLE employees ADD COLUMN IF NOT EXISTS convencao_coletiva_id UUID REFERENCES convencoes_coletivas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS employees_convencao_coletiva_id_idx ON employees (convencao_coletiva_id);

CREATE OR REPLACE FUNCTION employees_encrypt_sensitive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'emp:' || NEW.id::TEXT;
BEGIN
  IF NEW.salary IS NOT NULL AND NOT nexus_is_cipher(NEW.salary) THEN
    IF NEW.salary !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Salário inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.salary := (NEW.salary::NUMERIC(10, 2))::TEXT;
  END IF;

  IF NEW.pensao_valor IS NOT NULL AND NOT nexus_is_cipher(NEW.pensao_valor) THEN
    IF NEW.pensao_valor !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Valor da pensão alimentícia inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.pensao_valor := (NEW.pensao_valor::NUMERIC(10, 2))::TEXT;
  END IF;

  IF NEW.birth_date IS NOT NULL AND NOT nexus_is_cipher(NEW.birth_date) THEN
    IF NEW.birth_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
      RAISE EXCEPTION 'Data de nascimento inválida' USING ERRCODE = '22007';
    END IF;
    NEW.birth_date := (left(NEW.birth_date, 10)::DATE)::TEXT;
  END IF;

  IF NEW.pcd IS NOT NULL AND NOT nexus_is_cipher(NEW.pcd) THEN
    IF lower(NEW.pcd) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Indicador PcD inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.pcd := lower(NEW.pcd);
  END IF;

  IF NEW.pensao_alimenticia IS NOT NULL AND NOT nexus_is_cipher(NEW.pensao_alimenticia) THEN
    IF lower(NEW.pensao_alimenticia) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Indicador de pensão alimentícia inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.pensao_alimenticia := lower(NEW.pensao_alimenticia);
  END IF;

  IF (NEW.estabilidade_ate IS NULL) <> (NEW.estabilidade_motivo IS NULL) THEN
    RAISE EXCEPTION 'Informe o motivo e a data final da estabilidade juntos.' USING ERRCODE = '23514';
  END IF;

  IF NEW.estabilidade_motivo IS NOT NULL AND NOT nexus_is_cipher(NEW.estabilidade_motivo) THEN
    IF NEW.estabilidade_motivo NOT IN ('gestante', 'acidente_trabalho', 'cipa', 'dirigente_sindical', 'outra') THEN
      RAISE EXCEPTION 'Motivo de estabilidade inválido' USING ERRCODE = '22P02';
    END IF;
  END IF;

  NEW.cpf_hash            := nexus_blind_index(nexus_unwrap(v_ctx, NEW.cpf));
  NEW.cpf                 := nexus_wrap(v_ctx, NEW.cpf);
  NEW.rg                  := nexus_wrap(v_ctx, NEW.rg);
  NEW.telefone            := nexus_wrap(v_ctx, NEW.telefone);
  NEW.salary              := nexus_wrap(v_ctx, NEW.salary);
  NEW.chave_pix           := nexus_wrap(v_ctx, NEW.chave_pix);
  NEW.agencia             := nexus_wrap(v_ctx, NEW.agencia);
  NEW.conta               := nexus_wrap(v_ctx, NEW.conta);
  NEW.birth_date          := nexus_wrap(v_ctx, NEW.birth_date);
  NEW.gender              := nexus_wrap(v_ctx, NEW.gender);
  NEW.raca_cor            := nexus_wrap(v_ctx, NEW.raca_cor);
  NEW.deficiencia         := nexus_wrap(v_ctx, NEW.deficiencia);
  NEW.tipo_pensao         := nexus_wrap(v_ctx, NEW.tipo_pensao);
  NEW.pensao_valor        := nexus_wrap(v_ctx, NEW.pensao_valor);
  NEW.pcd                 := nexus_wrap(v_ctx, NEW.pcd);
  NEW.pensao_alimenticia  := nexus_wrap(v_ctx, NEW.pensao_alimenticia);
  NEW.estabilidade_motivo := nexus_wrap(v_ctx, NEW.estabilidade_motivo);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employees_encrypt_sensitive() FROM PUBLIC, anon, authenticated;

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
             WHEN 'salary'              THEN 'nexus_decrypt_ctx_numeric(''emp:'' || e.id::text, e.salary) AS salary'
             WHEN 'pensao_valor'        THEN 'nexus_decrypt_ctx_numeric(''emp:'' || e.id::text, e.pensao_valor) AS pensao_valor'
             WHEN 'birth_date'          THEN 'nexus_decrypt_ctx_date(''emp:'' || e.id::text, e.birth_date) AS birth_date'
             WHEN 'pcd'                 THEN 'nexus_decrypt_ctx_bool(''emp:'' || e.id::text, e.pcd) AS pcd'
             WHEN 'pensao_alimenticia'  THEN 'nexus_decrypt_ctx_bool(''emp:'' || e.id::text, e.pensao_alimenticia) AS pensao_alimenticia'
             WHEN 'cpf'                 THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.cpf) AS cpf'
             WHEN 'rg'                  THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.rg) AS rg'
             WHEN 'telefone'            THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.telefone) AS telefone'
             WHEN 'chave_pix'           THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.chave_pix) AS chave_pix'
             WHEN 'agencia'             THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.agencia) AS agencia'
             WHEN 'conta'               THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.conta) AS conta'
             WHEN 'gender'              THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.gender) AS gender'
             WHEN 'raca_cor'            THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.raca_cor) AS raca_cor'
             WHEN 'deficiencia'         THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.deficiencia) AS deficiencia'
             WHEN 'tipo_pensao'         THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.tipo_pensao) AS tipo_pensao'
             WHEN 'estabilidade_motivo' THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.estabilidade_motivo) AS estabilidade_motivo'
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

CREATE OR REPLACE FUNCTION nexus_encrypted_columns()
RETURNS TABLE (tbl TEXT, col TEXT, ctx TEXT)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT * FROM (VALUES
    ('employees', 'cpf',                 $q$'emp:' || t.id::text$q$),
    ('employees', 'rg',                  $q$'emp:' || t.id::text$q$),
    ('employees', 'telefone',            $q$'emp:' || t.id::text$q$),
    ('employees', 'salary',              $q$'emp:' || t.id::text$q$),
    ('employees', 'chave_pix',           $q$'emp:' || t.id::text$q$),
    ('employees', 'agencia',             $q$'emp:' || t.id::text$q$),
    ('employees', 'conta',               $q$'emp:' || t.id::text$q$),
    ('employees', 'birth_date',          $q$'emp:' || t.id::text$q$),
    ('employees', 'gender',              $q$'emp:' || t.id::text$q$),
    ('employees', 'raca_cor',            $q$'emp:' || t.id::text$q$),
    ('employees', 'deficiencia',         $q$'emp:' || t.id::text$q$),
    ('employees', 'tipo_pensao',         $q$'emp:' || t.id::text$q$),
    ('employees', 'pensao_valor',        $q$'emp:' || t.id::text$q$),
    ('employees', 'pcd',                 $q$'emp:' || t.id::text$q$),
    ('employees', 'pensao_alimenticia',  $q$'emp:' || t.id::text$q$),
    ('employees', 'estabilidade_motivo', $q$'emp:' || t.id::text$q$),
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

CREATE OR REPLACE FUNCTION employees_piso_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cct     convencoes_coletivas;
  v_hoje    DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_tipo    TEXT := lower(COALESCE(NEW.contract_type, 'clt'));
  v_horas   NUMERIC;
  v_piso    NUMERIC;
  v_salario NUMERIC;
BEGIN
  IF COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.convencao_coletiva_id IS NULL OR v_tipo IN ('pj', 'estagio', 'estágio', 'aprendiz') OR public.status_bloqueia_acesso(NEW.status) THEN
    RETURN NEW;
  END IF;
  v_salario := nexus_unwrap('emp:' || NEW.id::TEXT, NEW.salary)::NUMERIC;
  IF TG_OP = 'UPDATE'
     AND v_salario IS NOT DISTINCT FROM nexus_unwrap('emp:' || OLD.id::TEXT, OLD.salary)::NUMERIC
     AND NEW.convencao_coletiva_id IS NOT DISTINCT FROM OLD.convencao_coletiva_id
     AND NEW.work_load IS NOT DISTINCT FROM OLD.work_load
     AND NEW.contract_type IS NOT DISTINCT FROM OLD.contract_type THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_cct FROM convencoes_coletivas WHERE id = NEW.convencao_coletiva_id;
  IF NOT FOUND OR v_hoje < v_cct.vigencia_inicio OR v_hoje > v_cct.vigencia_fim THEN
    RETURN NEW;
  END IF;

  v_horas := CASE WHEN NEW.work_load ~ '^[0-9]+h$' THEN least(substring(NEW.work_load FROM '^([0-9]+)h$')::NUMERIC, 44) ELSE 44 END;
  v_piso := round(v_cct.piso_salarial * v_horas / 44, 2);

  IF v_salario IS NOT NULL AND v_salario < v_piso THEN
    RAISE EXCEPTION 'Salário de R$ % abaixo do piso de R$ % da convenção "%"%. A convenção coletiva tem força de lei (CF art. 7º, XXVI).',
      replace(to_char(v_salario, 'FM9999990.00'), '.', ','), replace(to_char(v_piso, 'FM9999990.00'), '.', ','), v_cct.nome,
      CASE WHEN v_horas < 44 THEN format(' (proporcional a %sh semanais — OJ 358 do TST)', v_horas) ELSE '' END
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employees_piso_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employees_piso_guard_trg ON employees;
CREATE TRIGGER employees_piso_guard_trg
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_piso_guard();

CREATE OR REPLACE FUNCTION employees_estabilidade_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_data DATE;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NOT public.status_bloqueia_acesso(NEW.status) OR public.status_bloqueia_acesso(OLD.status) OR NEW.estabilidade_ate IS NULL THEN
    RETURN NEW;
  END IF;

  v_data := COALESCE(NEW.termination_date, (now() AT TIME ZONE 'America/Sao_Paulo')::DATE);
  IF v_data > NEW.estabilidade_ate THEN
    RETURN NEW;
  END IF;

  IF NEW.termination_type IS NULL THEN
    RAISE EXCEPTION 'Colaborador com estabilidade até %: informe o tipo de rescisão (use a tela de Rescisão).', to_char(NEW.estabilidade_ate, 'DD/MM/YYYY')
      USING ERRCODE = '23514';
  END IF;
  IF NEW.termination_type IN ('sem_justa_causa', 'acordo_mutuo', 'aprendiz_sem_justa_causa', 'aprendiz_desempenho', 'prazo_sem_justa_causa') THEN
    RAISE EXCEPTION 'Colaborador com estabilidade até %: a dispensa sem justa causa nesse período é nula e obriga a reintegrar ou a indenizar todo o período.', to_char(NEW.estabilidade_ate, 'DD/MM/YYYY')
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employees_estabilidade_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employees_estabilidade_guard_trg ON employees;
CREATE TRIGGER employees_estabilidade_guard_trg
  BEFORE UPDATE OF status ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_estabilidade_guard();

SELECT nexus_refresh_employees_view();
