-- Versionamento de documentos (reenvio substitui a versão anterior sem apagar o histórico)
-- e assinatura eletrônica simples para documentos que exigem ciência do colaborador.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS version             INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_current           BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS replaces_document_id UUID REFERENCES documents(id) ON DELETE SET NULL;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS requer_assinatura BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS assinado_em       TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS assinado_por      TEXT;

CREATE INDEX IF NOT EXISTS documents_replaces_idx ON documents(replaces_document_id);
CREATE INDEX IF NOT EXISTS documents_current_idx  ON documents(employee_id, category, tipo, is_current);

-- Novas ações de auditoria: substituição de versão e assinatura eletrônica.
ALTER TABLE document_audit_log DROP CONSTRAINT IF EXISTS document_audit_log_action_check;
ALTER TABLE document_audit_log ADD CONSTRAINT document_audit_log_action_check
  CHECK (action IN ('criado','aprovado','recusado','excluido','substituido','assinado'));

-- Colaborador pode registrar a própria assinatura/upload no log de auditoria (RH já tem acesso total).
CREATE POLICY "colabo_audit_log_insert_own" ON document_audit_log FOR INSERT
  WITH CHECK (employee_id = my_employee_id());
