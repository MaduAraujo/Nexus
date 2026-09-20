CREATE TABLE IF NOT EXISTS nexus_key_config (
  purpose TEXT PRIMARY KEY CHECK (purpose IN ('encryption', 'hmac')),
  kid     TEXT NOT NULL CHECK (kid ~ '^[a-z0-9]{1,16}$')
);
INSERT INTO nexus_key_config (purpose, kid) VALUES ('encryption', 'v1'), ('hmac', 'v1') ON CONFLICT (purpose) DO NOTHING;
ALTER TABLE nexus_key_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexus_key_config FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.mfa_ok()') IS NOT NULL THEN
    DROP POLICY IF EXISTS mfa_required ON nexus_key_config;
    CREATE POLICY mfa_required ON nexus_key_config AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION nexus_key_name(p_purpose TEXT, p_kid TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_base TEXT := CASE p_purpose WHEN 'encryption' THEN 'data_encryption_key' WHEN 'hmac' THEN 'data_hmac_key' END;
BEGIN
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Finalidade de chave inválida: % (use ''encryption'' ou ''hmac'')', p_purpose;
  END IF;
  IF p_kid IS NULL OR p_kid !~ '^[a-z0-9]{1,16}$' THEN
    RAISE EXCEPTION 'Identificador de chave inválido: % (use de 1 a 16 letras minúsculas ou números)', p_kid;
  END IF;
  RETURN CASE WHEN p_kid = 'v1' THEN v_base ELSE v_base || '_' || p_kid END;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_active_kid(p_purpose TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT kid FROM nexus_key_config WHERE purpose = p_purpose), 'v1');
$$;

CREATE OR REPLACE FUNCTION nexus_secret_exists(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- IF aninhado de propósito: numa condição única com AND, o Postgres analisaria a consulta ao Vault mesmo sem Vault.
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = p_name) THEN
      RETURN TRUE;
    END IF;
  END IF;
  RETURN EXISTS (SELECT 1 FROM nexus_key_store WHERE name = p_name);
END;
$$;

CREATE OR REPLACE FUNCTION nexus_is_cipher(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_value LIKE 'nexus:enc1:%' OR p_value LIKE 'nexus:enc2:%';
$$;

CREATE OR REPLACE FUNCTION nexus_cipher_kid(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN p_value LIKE 'nexus:enc1:%' THEN 'v1'
           WHEN p_value LIKE 'nexus:enc2:%' THEN split_part(p_value, ':', 3)
         END;
$$;

CREATE OR REPLACE FUNCTION nexus_cipher_prefix(p_kid TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_kid = 'v1' THEN 'nexus:enc1:' ELSE 'nexus:enc2:' || p_kid || ':' END;
$$;

CREATE OR REPLACE FUNCTION nexus_encrypt_with(p_kid TEXT, p_context TEXT, p_plain TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN nexus_cipher_prefix(p_kid) || encode(
    pgp_sym_encrypt(p_context || chr(31) || p_plain, nexus_secret(nexus_key_name('encryption', p_kid)), 'cipher-algo=aes256, compress-algo=0, s2k-mode=1'),
    'base64'
  );
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
  IF nexus_is_cipher(p_plain) THEN
    RETURN p_plain;
  END IF;
  RETURN nexus_encrypt_with(nexus_active_kid('encryption'), p_context, p_plain);
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
  v_kid   TEXT;
BEGIN
  IF p_cipher IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT nexus_is_cipher(p_cipher) THEN
    RETURN p_cipher;
  END IF;
  BEGIN
    v_kid := nexus_cipher_kid(p_cipher);
    v_plain := pgp_sym_decrypt(
      decode(substr(p_cipher, length(nexus_cipher_prefix(v_kid)) + 1), 'base64'),
      nexus_secret(nexus_key_name('encryption', v_kid))
    );
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

CREATE OR REPLACE FUNCTION nexus_rewrap(p_context TEXT, p_cipher TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_kid   TEXT;
  v_plain TEXT;
  v_sep   INT;
BEGIN
  IF p_cipher IS NULL OR NOT nexus_is_cipher(p_cipher) THEN
    RETURN p_cipher;
  END IF;
  v_kid := nexus_cipher_kid(p_cipher);
  IF NOT nexus_secret_exists(nexus_key_name('encryption', v_kid)) THEN
    RAISE EXCEPTION 'a chave "%" usada por este valor não está mais no Vault', v_kid;
  END IF;
  BEGIN
    v_plain := pgp_sym_decrypt(
      decode(substr(p_cipher, length(nexus_cipher_prefix(v_kid)) + 1), 'base64'),
      nexus_secret(nexus_key_name('encryption', v_kid))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'valor corrompido ou cifrado com outra chave (chave "%")', v_kid;
  END;
  v_sep := position(chr(31) IN v_plain);
  IF v_sep = 0 OR left(v_plain, v_sep - 1) <> p_context THEN
    RAISE EXCEPTION 'o contexto do valor não confere (cifra copiada de outra linha?)';
  END IF;
  RETURN nexus_encrypt_with(nexus_active_kid('encryption'), p_context, substr(v_plain, v_sep + 1));
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
  RETURN encode(
    hmac(regexp_replace(p_plain, '[.[:space:]/-]', '', 'g'), nexus_secret(nexus_key_name('hmac', nexus_active_kid('hmac'))), 'sha256'),
    'hex'
  );
END;
$$;

CREATE OR REPLACE FUNCTION nexus_norm_money(p_label TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR nexus_is_cipher(p_value) THEN
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
  IF p_value IS NULL OR nexus_is_cipher(p_value) THEN
    RETURN p_value;
  END IF;
  RETURN p_value::JSONB::TEXT;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION '% inválido', p_label USING ERRCODE = '22P02';
END;
$$;

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

CREATE OR REPLACE FUNCTION nexus_encrypted_columns()
RETURNS TABLE (tbl TEXT, col TEXT, ctx TEXT)
LANGUAGE sql
IMMUTABLE
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
    ('ai_decision_log',     'evidence',    $q$'ail:' || t.id::text || ':evidence'$q$)
  ) AS r (tbl, col, ctx);
$$;

CREATE OR REPLACE FUNCTION nexus_key_generate(p_purpose TEXT, p_kid TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_name   TEXT := nexus_key_name(p_purpose, p_kid);
  v_secret TEXT;
BEGIN
  IF p_kid = 'v1' THEN
    RAISE EXCEPTION 'v1 é a chave original e não pode ser gerada de novo; escolha outro identificador (ex.: v2)';
  END IF;
  IF nexus_secret_exists(v_name) THEN
    RAISE EXCEPTION 'A chave % já existe', v_name;
  END IF;
  v_secret := encode(gen_random_bytes(32), 'hex');
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    PERFORM vault.create_secret(v_secret, v_name, 'Cifragem de colunas sensíveis (Nexus): ' || p_purpose || ' ' || p_kid);
  ELSE
    INSERT INTO nexus_key_store (name, secret) VALUES (v_name, v_secret);
  END IF;
  RAISE NOTICE 'Chave % criada. Copie o valor para um cofre FORA do Supabase antes de ativá-la.', v_name;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_key_activate(p_purpose TEXT, p_kid TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_name TEXT := nexus_key_name(p_purpose, p_kid);
BEGIN
  IF NOT nexus_secret_exists(v_name) THEN
    RAISE EXCEPTION 'A chave % não existe; crie antes com nexus_key_generate(%, %)', v_name, quote_literal(p_purpose), quote_literal(p_kid);
  END IF;

  IF p_purpose = 'hmac' THEN
    LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE;
  END IF;

  INSERT INTO nexus_key_config (purpose, kid) VALUES (p_purpose, p_kid)
  ON CONFLICT (purpose) DO UPDATE SET kid = EXCLUDED.kid;

  IF p_purpose = 'hmac' THEN
    BEGIN
      UPDATE employees SET cpf_hash = nexus_blind_index(nexus_unwrap('emp:' || id::text, cpf));
    EXCEPTION WHEN not_null_violation THEN
      RAISE EXCEPTION 'Não foi possível recalcular o índice de CPF: há colaborador cujo CPF não pode ser decifrado. Nada foi alterado.';
    END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_rewrap_all(p_batch INT DEFAULT 500)
RETURNS TABLE (tbl TEXT, rewrapped BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tbl    TEXT;
  v_set    TEXT;
  v_where  TEXT;
  v_n      BIGINT;
  v_prefix TEXT := nexus_cipher_prefix(nexus_active_kid('encryption')) || '%';
BEGIN
  IF p_batch IS NULL OR p_batch < 1 THEN
    RAISE EXCEPTION 'O tamanho do lote deve ser um número positivo';
  END IF;

  FOR v_tbl IN SELECT DISTINCT r.tbl FROM nexus_encrypted_columns() r ORDER BY 1 LOOP
    SELECT string_agg(
             format('%1$I = CASE WHEN t.%1$I LIKE ''nexus:enc%%'' AND t.%1$I NOT LIKE %2$L THEN nexus_rewrap(%3$s, t.%1$I) ELSE t.%1$I END', r.col, v_prefix, r.ctx),
             ', '),
           string_agg(format('(t.%1$I LIKE ''nexus:enc%%'' AND t.%1$I NOT LIKE %2$L)', r.col, v_prefix), ' OR ')
      INTO v_set, v_where
      FROM nexus_encrypted_columns() r
     WHERE r.tbl = v_tbl;

    BEGIN
      EXECUTE format(
        'WITH todo AS (SELECT t.id FROM public.%1$I t WHERE %2$s ORDER BY t.id LIMIT %3$s FOR UPDATE SKIP LOCKED)
         UPDATE public.%1$I t SET %4$s FROM todo WHERE t.id = todo.id',
        v_tbl, v_where, p_batch, v_set);
      GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Rotação interrompida em %: %. Nada desta chamada foi gravado.', v_tbl, SQLERRM;
    END;

    tbl := v_tbl;
    rewrapped := v_n;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_key_status()
RETURNS TABLE (scope TEXT, object TEXT, kid TEXT, active BOOLEAN, cipher_values BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r        RECORD;
  v_active TEXT := nexus_active_kid('encryption');
BEGIN
  FOR r IN SELECT c.tbl, c.col FROM nexus_encrypted_columns() c ORDER BY 1, 2 LOOP
    RETURN QUERY EXECUTE format(
      'SELECT ''encryption''::text, %1$L::text, COALESCE(nexus_cipher_kid(t.%3$I), ''plaintext'')::text,
              COALESCE(nexus_cipher_kid(t.%3$I), ''plaintext'') = %4$L, count(*)::bigint
         FROM public.%2$I t WHERE t.%3$I IS NOT NULL GROUP BY 3',
      r.tbl || '.' || r.col, r.tbl, r.col, v_active);
  END LOOP;

  FOR r IN
    SELECT ic.table_name AS tbl, ic.column_name AS col
      FROM information_schema.columns ic
      JOIN information_schema.tables it ON it.table_schema = ic.table_schema AND it.table_name = ic.table_name AND it.table_type = 'BASE TABLE'
     WHERE ic.table_schema = 'public'
       AND ic.data_type IN ('text', 'character varying')
       AND ic.table_name NOT IN ('nexus_key_store', 'nexus_key_config')
       AND NOT EXISTS (SELECT 1 FROM nexus_encrypted_columns() c WHERE c.tbl = ic.table_name AND c.col = ic.column_name)
     ORDER BY 1, 2
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT ''unregistered''::text, %1$L::text, nexus_cipher_kid(t.%3$I)::text, false, count(*)::bigint
         FROM public.%2$I t WHERE nexus_is_cipher(t.%3$I) GROUP BY 3',
      r.tbl || '.' || r.col, r.tbl, r.col);
  END LOOP;

  RETURN QUERY
    SELECT 'hmac'::text, 'employees.cpf_hash'::text, nexus_active_kid('hmac'), TRUE, count(*)::bigint
      FROM employees e WHERE e.cpf_hash = nexus_blind_index(nexus_unwrap('emp:' || e.id::text, e.cpf));
  RETURN QUERY
    SELECT 'hmac'::text, 'employees.cpf_hash'::text, 'stale'::text, FALSE, count(*)::bigint
      FROM employees e WHERE e.cpf_hash IS DISTINCT FROM nexus_blind_index(nexus_unwrap('emp:' || e.id::text, e.cpf));
END;
$$;

CREATE OR REPLACE FUNCTION nexus_key_summary()
RETURNS TABLE (scope TEXT, kid TEXT, active BOOLEAN, cipher_values BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT s.scope, s.kid, bool_or(s.active), sum(s.cipher_values)::bigint
    FROM nexus_key_status() s
   GROUP BY s.scope, s.kid
   ORDER BY s.scope, s.kid;
$$;

REVOKE ALL ON FUNCTION nexus_key_name(TEXT, TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_active_kid(TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_secret_exists(TEXT)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_is_cipher(TEXT)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_cipher_kid(TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_cipher_prefix(TEXT)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_encrypt_with(TEXT, TEXT, TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_rewrap(TEXT, TEXT)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_encrypted_columns()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_key_generate(TEXT, TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_key_activate(TEXT, TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_rewrap_all(INT)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_key_status()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_key_summary()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_norm_money(TEXT, TEXT)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_norm_json(TEXT, TEXT)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_wrap(TEXT, TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_unwrap(TEXT, TEXT)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_blind_index(TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION employees_encrypt_sensitive()            FROM PUBLIC, anon, authenticated;