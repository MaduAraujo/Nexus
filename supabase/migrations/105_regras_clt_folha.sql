ALTER TABLE employees ADD COLUMN IF NOT EXISTS adicional_periculosidade BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS grau_insalubridade TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS estabilidade_ate DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS estabilidade_motivo TEXT;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_grau_insalubridade_check;
ALTER TABLE employees ADD CONSTRAINT employees_grau_insalubridade_check
  CHECK (grau_insalubridade IS NULL OR grau_insalubridade IN ('minimo', 'medio', 'maximo'));

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

SELECT nexus_refresh_employees_view();
