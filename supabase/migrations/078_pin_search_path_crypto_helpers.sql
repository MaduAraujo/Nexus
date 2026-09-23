CREATE OR REPLACE FUNCTION nexus_norm_money(p_label TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
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
SET search_path = public
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

CREATE OR REPLACE FUNCTION nexus_key_name(p_purpose TEXT, p_kid TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
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

CREATE OR REPLACE FUNCTION nexus_is_cipher(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_value LIKE 'nexus:enc1:%' OR p_value LIKE 'nexus:enc2:%';
$$;

CREATE OR REPLACE FUNCTION nexus_cipher_kid(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
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
SET search_path = public
AS $$
  SELECT CASE WHEN p_kid = 'v1' THEN 'nexus:enc1:' ELSE 'nexus:enc2:' || p_kid || ':' END;
$$;

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