ALTER TABLE document_audit_log DROP COLUMN IF EXISTS operator_name;
ALTER TABLE document_audit_log DROP COLUMN IF EXISTS operator_email;
ALTER TABLE document_audit_log ADD COLUMN IF NOT EXISTS actor_id UUID;
ALTER TABLE document_audit_log ADD COLUMN IF NOT EXISTS actor_name TEXT;
ALTER TABLE document_audit_log ADD COLUMN IF NOT EXISTS actor_profile TEXT;
ALTER TABLE document_audit_log ADD COLUMN IF NOT EXISTS details JSONB;