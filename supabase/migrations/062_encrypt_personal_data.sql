DROP VIEW IF EXISTS public.employees_decrypted;

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'birth_date') <> 'text' THEN
    ALTER TABLE employees ALTER COLUMN birth_date TYPE TEXT USING birth_date::TEXT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION nexus_decrypt_ctx_date(p_context TEXT, p_cipher TEXT)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT := nexus_decrypt_ctx(p_context, p_cipher);
BEGIN
  IF v_plain IS NULL OR v_plain !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_plain::DATE;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION nexus_decrypt_ctx_date(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx_date(TEXT, TEXT) TO authenticated;

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

  NEW.cpf_hash     := nexus_blind_index(nexus_unwrap(v_ctx, NEW.cpf));
  NEW.cpf          := nexus_wrap(v_ctx, NEW.cpf);
  NEW.rg           := nexus_wrap(v_ctx, NEW.rg);
  NEW.telefone     := nexus_wrap(v_ctx, NEW.telefone);
  NEW.salary       := nexus_wrap(v_ctx, NEW.salary);
  NEW.chave_pix    := nexus_wrap(v_ctx, NEW.chave_pix);
  NEW.agencia      := nexus_wrap(v_ctx, NEW.agencia);
  NEW.conta        := nexus_wrap(v_ctx, NEW.conta);
  NEW.birth_date   := nexus_wrap(v_ctx, NEW.birth_date);
  NEW.gender       := nexus_wrap(v_ctx, NEW.gender);
  NEW.raca_cor     := nexus_wrap(v_ctx, NEW.raca_cor);
  NEW.deficiencia  := nexus_wrap(v_ctx, NEW.deficiencia);
  NEW.tipo_pensao  := nexus_wrap(v_ctx, NEW.tipo_pensao);
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
             WHEN 'salary'     THEN 'nexus_decrypt_ctx_numeric(''emp:'' || e.id::text, e.salary) AS salary'
             WHEN 'birth_date' THEN 'nexus_decrypt_ctx_date(''emp:'' || e.id::text, e.birth_date) AS birth_date'
             WHEN 'cpf'         THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.cpf) AS cpf'
             WHEN 'rg'          THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.rg) AS rg'
             WHEN 'telefone'    THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.telefone) AS telefone'
             WHEN 'chave_pix'   THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.chave_pix) AS chave_pix'
             WHEN 'agencia'     THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.agencia) AS agencia'
             WHEN 'conta'       THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.conta) AS conta'
             WHEN 'gender'      THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.gender) AS gender'
             WHEN 'raca_cor'    THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.raca_cor) AS raca_cor'
             WHEN 'deficiencia' THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.deficiencia) AS deficiencia'
             WHEN 'tipo_pensao' THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.tipo_pensao) AS tipo_pensao'
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