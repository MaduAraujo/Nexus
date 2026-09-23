DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'employee_audit' AND column_name = 'changes') <> 'text' THEN
    ALTER TABLE employee_audit ALTER COLUMN changes TYPE TEXT USING changes::TEXT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION employee_audit_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id) THEN
    RAISE EXCEPTION 'Um registro do histórico não pode mudar de colaborador' USING ERRCODE = '42501';
  END IF;

  NEW.changes := nexus_wrap('emp:' || NEW.employee_id::TEXT || ':audit:' || NEW.id::TEXT, nexus_norm_json('Alterações', NEW.changes));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employee_audit_encrypt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employee_audit_encrypt_trg ON employee_audit;
CREATE TRIGGER employee_audit_encrypt_trg
  BEFORE INSERT OR UPDATE ON employee_audit
  FOR EACH ROW EXECUTE FUNCTION employee_audit_encrypt();

UPDATE employee_audit SET changes = changes;

DROP VIEW IF EXISTS employee_audit_decrypted;
CREATE VIEW employee_audit_decrypted WITH (security_invoker = true) AS
  SELECT a.id, a.employee_id,
         nexus_decrypt_ctx_jsonb('emp:' || a.employee_id::text || ':audit:' || a.id::text, a.changes) AS changes,
         a.operator_name, a.operator_email, a.created_at
    FROM employee_audit a;

REVOKE ALL ON employee_audit_decrypted FROM PUBLIC, anon;
GRANT SELECT ON employee_audit_decrypted TO authenticated;

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
    ('ai_decision_log',     'evidence',    $q$'ail:' || t.id::text || ':evidence'$q$)
  ) AS r (tbl, col, ctx);
$$;
