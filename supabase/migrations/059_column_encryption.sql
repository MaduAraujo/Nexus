CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS nexus_key_store (
  name   TEXT PRIMARY KEY,
  secret TEXT NOT NULL
);
ALTER TABLE nexus_key_store ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexus_key_store FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_name TEXT;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'Vault indisponível: as chaves de cifragem devem ser inseridas em nexus_key_store.';
    RETURN;
  END IF;
  FOREACH v_name IN ARRAY ARRAY['data_encryption_key', 'data_hmac_key'] LOOP
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = v_name) THEN
      BEGIN
        PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), v_name, 'Cifragem de colunas sensíveis (Nexus)');
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Não foi possível criar o segredo % no Vault (%). Crie manualmente: select vault.create_secret(<valor aleatório>, ''%'');', v_name, SQLERRM, v_name;
      END;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION nexus_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  END IF;
  IF v_secret IS NULL THEN
    SELECT secret INTO v_secret FROM nexus_key_store WHERE name = p_name;
  END IF;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Chave de cifragem % não configurada', p_name USING ERRCODE = 'P0001';
  END IF;
  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_wrap(p_context TEXT, p_plain TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_plain IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_plain LIKE 'nexus:enc1:%' THEN
    RETURN p_plain;
  END IF;
  RETURN 'nexus:enc1:' || encode(
    pgp_sym_encrypt(p_context || chr(31) || p_plain, nexus_secret('data_encryption_key'), 'cipher-algo=aes256, compress-algo=0, s2k-mode=1'),
    'base64'
  );
END;
$$;

CREATE OR REPLACE FUNCTION nexus_unwrap(p_context TEXT, p_cipher TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT;
  v_sep   INT;
BEGIN
  IF p_cipher IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_cipher NOT LIKE 'nexus:enc1:%' THEN
    RETURN p_cipher;
  END IF;
  BEGIN
    v_plain := pgp_sym_decrypt(decode(substr(p_cipher, 12), 'base64'), nexus_secret('data_encryption_key'));
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  v_sep := position(chr(31) IN v_plain);
  IF v_sep = 0 OR left(v_plain, v_sep - 1) <> p_context THEN
    RETURN NULL;
  END IF;
  RETURN substr(v_plain, v_sep + 1);
END;
$$;

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
  END IF;

  IF NOT COALESCE(v_ok, FALSE) THEN
    RETURN NULL;
  END IF;
  RETURN nexus_unwrap(p_context, p_cipher);
END;
$$;

CREATE OR REPLACE FUNCTION nexus_decrypt_ctx_numeric(p_context TEXT, p_cipher TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT := nexus_decrypt_ctx(p_context, p_cipher);
BEGIN
  IF v_plain IS NULL OR v_plain !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RETURN NULL;
  END IF;
  RETURN v_plain::NUMERIC;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_blind_index(p_plain TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_plain IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN encode(hmac(regexp_replace(p_plain, '[.[:space:]/-]', '', 'g'), nexus_secret('data_hmac_key'), 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION nexus_secret(TEXT)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_wrap(TEXT, TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_unwrap(TEXT, TEXT)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_blind_index(TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_decrypt_ctx(TEXT, TEXT)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nexus_decrypt_ctx_numeric(TEXT, TEXT)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx(TEXT, TEXT)         TO authenticated;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx_numeric(TEXT, TEXT) TO authenticated;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS notif_prefs JSONB;

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'salary') <> 'text' THEN
    ALTER TABLE employees ALTER COLUMN salary TYPE TEXT USING salary::TEXT;
  END IF;
END $$;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS cpf_hash TEXT;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_cpf_key;

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

  NEW.cpf_hash  := nexus_blind_index(nexus_unwrap(v_ctx, NEW.cpf));
  NEW.cpf       := nexus_wrap(v_ctx, NEW.cpf);
  NEW.rg        := nexus_wrap(v_ctx, NEW.rg);
  NEW.telefone  := nexus_wrap(v_ctx, NEW.telefone);
  NEW.salary    := nexus_wrap(v_ctx, NEW.salary);
  NEW.chave_pix := nexus_wrap(v_ctx, NEW.chave_pix);
  NEW.agencia   := nexus_wrap(v_ctx, NEW.agencia);
  NEW.conta     := nexus_wrap(v_ctx, NEW.conta);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_encrypt_sensitive_trg ON employees;
CREATE TRIGGER employees_encrypt_sensitive_trg
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_encrypt_sensitive();

REVOKE ALL ON FUNCTION employees_encrypt_sensitive() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION chat_messages_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.content := nexus_wrap('chan:' || NEW.channel_id::TEXT, NEW.content);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hr_ticket_messages_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.content := nexus_wrap('tkt:' || NEW.ticket_id::TEXT, NEW.content);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION chat_messages_encrypt()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hr_ticket_messages_encrypt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS chat_messages_encrypt_trg ON chat_messages;
CREATE TRIGGER chat_messages_encrypt_trg
  BEFORE INSERT OR UPDATE OF content ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_encrypt();

DROP TRIGGER IF EXISTS hr_ticket_messages_encrypt_trg ON hr_ticket_messages;
CREATE TRIGGER hr_ticket_messages_encrypt_trg
  BEFORE INSERT OR UPDATE OF content ON hr_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION hr_ticket_messages_encrypt();

ALTER TABLE employees DISABLE TRIGGER employees_updated_at;
UPDATE employees SET cpf = cpf;
ALTER TABLE employees ENABLE TRIGGER employees_updated_at;

UPDATE chat_messages SET content = content;
UPDATE hr_ticket_messages SET content = content;

ALTER TABLE employees ALTER COLUMN cpf_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_cpf_hash_key ON employees(cpf_hash);

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
             WHEN 'salary' THEN 'nexus_decrypt_ctx_numeric(''emp:'' || e.id::text, e.salary) AS salary'
             WHEN 'cpf'       THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.cpf) AS cpf'
             WHEN 'rg'        THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.rg) AS rg'
             WHEN 'telefone'  THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.telefone) AS telefone'
             WHEN 'chave_pix' THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.chave_pix) AS chave_pix'
             WHEN 'agencia'   THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.agencia) AS agencia'
             WHEN 'conta'     THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.conta) AS conta'
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

SELECT nexus_refresh_employees_view();

DROP VIEW IF EXISTS chat_messages_decrypted;
CREATE VIEW chat_messages_decrypted WITH (security_invoker = true) AS
  SELECT m.id, m.channel_id, m.employee_id, nexus_decrypt_ctx('chan:' || m.channel_id::text, m.content) AS content, m.created_at
    FROM chat_messages m;

DROP VIEW IF EXISTS hr_ticket_messages_decrypted;
CREATE VIEW hr_ticket_messages_decrypted WITH (security_invoker = true) AS
  SELECT m.id, m.ticket_id, m.employee_id, m.role, nexus_decrypt_ctx('tkt:' || m.ticket_id::text, m.content) AS content, m.created_at
    FROM hr_ticket_messages m;

REVOKE ALL ON chat_messages_decrypted, hr_ticket_messages_decrypted FROM PUBLIC, anon;
GRANT SELECT ON chat_messages_decrypted, hr_ticket_messages_decrypted TO authenticated;

CREATE OR REPLACE FUNCTION anonymize_employee(
  p_employee_id         UUID,
  p_anonymized_by_name  TEXT DEFAULT NULL,
  p_anonymized_by_email TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp   employees;
  v_label TEXT;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode anonimizar dados de um colaborador';
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado';
  END IF;
  IF v_emp.status <> 'Inativo' THEN
    RAISE EXCEPTION 'Só é possível anonimizar colaboradores desligados (status Inativo)';
  END IF;
  IF nexus_unwrap('emp:' || p_employee_id::text, v_emp.cpf) LIKE 'ANONIMIZADO-%' THEN
    RAISE EXCEPTION 'Este colaborador já teve os dados anonimizados';
  END IF;

  v_label := 'Ex-colaborador ' || substr(p_employee_id::text, 1, 8);

  UPDATE employees SET
    name             = v_label,
    cpf              = 'ANONIMIZADO-' || substr(p_employee_id::text, 1, 8),
    rg               = NULL,
    telefone         = NULL,
    email            = substr(p_employee_id::text, 1, 8) || '@anonimizado.local',
    birth_date       = NULL,
    gender           = NULL,
    raca_cor         = NULL,
    deficiencia      = NULL,
    chave_pix        = NULL,
    tipo_chave_pix   = NULL,
    banco            = NULL,
    tipo_conta       = NULL,
    agencia          = NULL,
    conta            = NULL,
    avatar_url       = NULL,
    bio              = NULL,
    auth_user_id     = NULL
  WHERE id = p_employee_id;

  INSERT INTO employee_audit (employee_id, changes, operator_name, operator_email)
  VALUES (
    p_employee_id,
    jsonb_build_array(jsonb_build_object(
      'field', 'lgpd_anonimizacao', 'label', 'Dados anonimizados a pedido do titular (LGPD art. 18, VI)',
      'oldValue', v_emp.name, 'newValue', v_label
    )),
    COALESCE(p_anonymized_by_name, 'RH'), p_anonymized_by_email
  );
END;
$$;

GRANT EXECUTE ON FUNCTION anonymize_employee(UUID, TEXT, TEXT) TO authenticated;
