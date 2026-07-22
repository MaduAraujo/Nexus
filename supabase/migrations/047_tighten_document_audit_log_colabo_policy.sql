DROP POLICY IF EXISTS "colabo_audit_log_insert_own" ON document_audit_log;

CREATE POLICY "colabo_audit_log_insert_own" ON document_audit_log FOR INSERT
  WITH CHECK (
    employee_id = my_employee_id()
    AND action IN ('criado', 'substituido', 'assinado', 'excluido')
  );