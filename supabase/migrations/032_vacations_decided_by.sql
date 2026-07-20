-- Sem isso, "quantas férias o gestor decidiu" era impossível de medir: vacations
-- registra approved_at/rejected_at mas nunca QUEM decidiu (RH ou o gestor direto),
-- diferente de bank_requests que já rastreia decided_by_name/decided_by_email.
-- Necessário para o Painel de Gestores na Central de Alertas.

ALTER TABLE vacations ADD COLUMN IF NOT EXISTS decided_by_name  TEXT;
ALTER TABLE vacations ADD COLUMN IF NOT EXISTS decided_by_email TEXT;
