-- Compliance de documentos: validade/alerta de vencimento, trilha LGPD (consentimento + retenção)
-- e checklist de documentos obrigatórios por admissão/demissão.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS data_validade         DATE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS retido_ate            DATE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS lgpd_consentimento    BOOLEAN DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS lgpd_consentimento_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS documents_validade_idx ON documents(data_validade);

-- Backfill do prazo de guarda para documentos já existentes (mesma tabela de anos usada no upload).
UPDATE documents SET retido_ate = (created_at::date + (
    CASE tipo
      WHEN 'Contrato de Trabalho' THEN 30
      WHEN 'Termo de Rescisão'    THEN 30
      WHEN 'Homologação'          THEN 30
      WHEN 'Guia FGTS'            THEN 30
      WHEN 'Carteira de Trabalho' THEN 30
      WHEN 'Exame Admissional'    THEN 20
      WHEN 'Exame Demissional'    THEN 20
      ELSE 5
    END) * INTERVAL '1 year')::date
WHERE retido_ate IS NULL;

-- Checklist de documentos obrigatórios por categoria (admissional/demissional)
CREATE TABLE IF NOT EXISTS document_requirements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL CHECK (category IN ('admissional','demissional')),
  tipo        TEXT NOT NULL,
  obrigatorio BOOLEAN DEFAULT TRUE,
  UNIQUE(category, tipo)
);

ALTER TABLE document_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_requirements_all" ON document_requirements FOR ALL USING (is_rh());

INSERT INTO document_requirements (category, tipo, obrigatorio) VALUES
  ('admissional','RG', true),
  ('admissional','CPF', true),
  ('admissional','Comprovante de Residência', true),
  ('admissional','Exame Admissional', true),
  ('admissional','Carteira de Trabalho', true),
  ('admissional','Contrato de Trabalho', true),
  ('demissional','Aviso Prévio', true),
  ('demissional','Termo de Rescisão', true),
  ('demissional','Exame Demissional', true),
  ('demissional','Homologação', true),
  ('demissional','Guia FGTS', true)
ON CONFLICT (category, tipo) DO NOTHING;

-- Log de auditoria de documentos (quem enviou/aprovou/recusou/excluiu e quando).
-- document_id não tem FK pois o registro deve sobreviver à exclusão do documento.
CREATE TABLE IF NOT EXISTS document_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID,
  document_name  TEXT NOT NULL,
  employee_id    UUID REFERENCES employees(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN ('criado','aprovado','recusado','excluido')),
  operator_name  TEXT,
  operator_email TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_audit_log_doc_idx ON document_audit_log(document_id, created_at DESC);

ALTER TABLE document_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_audit_log_all" ON document_audit_log FOR ALL USING (is_rh());
