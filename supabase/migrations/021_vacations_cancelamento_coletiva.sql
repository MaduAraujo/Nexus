-- Permite que o colaborador cancele uma solicitação pendente (status 'cancelado')
-- e sinaliza férias concedidas coletivamente pelo RH (art. 139 CLT).

ALTER TABLE vacations DROP CONSTRAINT IF EXISTS vacations_status_check;
ALTER TABLE vacations ADD CONSTRAINT vacations_status_check
  CHECK (status IN ('pendente','aprovado','concluido','recusado','cancelado'));

ALTER TABLE vacations ADD COLUMN IF NOT EXISTS coletiva BOOLEAN DEFAULT false;
