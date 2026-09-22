ALTER TABLE document_requirements
  ADD COLUMN IF NOT EXISTS contract_type TEXT NOT NULL DEFAULT 'CLT';

ALTER TABLE document_requirements
  DROP CONSTRAINT IF EXISTS document_requirements_contract_type_check;
ALTER TABLE document_requirements
  ADD CONSTRAINT document_requirements_contract_type_check
  CHECK (contract_type IN ('CLT', 'Estágio', 'Aprendiz', 'Temporário', 'PJ'));

ALTER TABLE document_requirements
  DROP CONSTRAINT IF EXISTS document_requirements_category_tipo_key;
ALTER TABLE document_requirements
  DROP CONSTRAINT IF EXISTS document_requirements_category_tipo_contract_key;
ALTER TABLE document_requirements
  ADD CONSTRAINT document_requirements_category_tipo_contract_key UNIQUE (category, tipo, contract_type);

INSERT INTO document_requirements (category, tipo, obrigatorio, contract_type) VALUES
  -- Estágio (Lei 11.788/2008)
  ('admissional', 'RG',                                  true, 'Estágio'),
  ('admissional', 'CPF',                                 true, 'Estágio'),
  ('admissional', 'Comprovante de Residência',           true, 'Estágio'),
  ('admissional', 'Termo de Compromisso de Estágio',     true, 'Estágio'),
  ('admissional', 'Plano de Atividades de Estágio',      true, 'Estágio'),
  ('admissional', 'Comprovante de Matrícula e Frequência', true, 'Estágio'),
  ('admissional', 'Apólice de Seguro de Acidentes Pessoais', true, 'Estágio'),
  ('demissional', 'Termo de Realização do Estágio',      true, 'Estágio'),
  -- Aprendiz (CLT, arts. 428 a 433)
  ('admissional', 'RG',                                  true, 'Aprendiz'),
  ('admissional', 'CPF',                                 true, 'Aprendiz'),
  ('admissional', 'Comprovante de Residência',           true, 'Aprendiz'),
  ('admissional', 'Carteira de Trabalho',                true, 'Aprendiz'),
  ('admissional', 'Contrato de Trabalho',                true, 'Aprendiz'),
  ('admissional', 'Ficha de Registro do Empregado',      true, 'Aprendiz'),
  ('admissional', 'Exame Admissional',                   true, 'Aprendiz'),
  ('admissional', 'Comprovante de Matrícula e Frequência', true, 'Aprendiz'),
  ('demissional', 'Termo de Rescisão',                   true, 'Aprendiz'),
  ('demissional', 'Exame Demissional',                   true, 'Aprendiz'),
  ('demissional', 'Guia FGTS',                           true, 'Aprendiz'),
  -- Temporário (Lei 6.019/1974; CLT, art. 443): prazo determinado, sem aviso prévio
  ('admissional', 'RG',                                  true, 'Temporário'),
  ('admissional', 'CPF',                                 true, 'Temporário'),
  ('admissional', 'Comprovante de Residência',           true, 'Temporário'),
  ('admissional', 'Carteira de Trabalho',                true, 'Temporário'),
  ('admissional', 'Contrato de Trabalho',                true, 'Temporário'),
  ('admissional', 'Ficha de Registro do Empregado',      true, 'Temporário'),
  ('admissional', 'Exame Admissional',                   true, 'Temporário'),
  ('demissional', 'Termo de Rescisão',                   true, 'Temporário'),
  ('demissional', 'Exame Demissional',                   true, 'Temporário'),
  ('demissional', 'Guia FGTS',                           true, 'Temporário'),
  -- PJ (Código Civil, arts. 593 a 609): sem vínculo empregatício, sem checklist demissional
  ('admissional', 'Contrato de Prestação de Serviços',   true, 'PJ'),
  ('admissional', 'Cartão CNPJ',                         true, 'PJ'),
  ('admissional', 'RG',                                  true, 'PJ'),
  ('admissional', 'CPF',                                 true, 'PJ')
ON CONFLICT (category, tipo, contract_type) DO NOTHING;