-- Duas lacunas do gestor de equipe (migration 029): ele só aprovava solicitações
-- pontuais de banco de horas, sem ver o saldo corrente de cada liderado; e não
-- tinha um canal formal para escalar algo ao RH sobre uma pessoa específica do
-- time (usava o chat geral como qualquer colaborador comum).
--
-- O saldo de banco de horas não precisa de coluna nova — é calculado no cliente
-- a partir de time_records + bank_adjustments, mesmo padrão já usado em
-- alertas.js (risco composto) e banco-horas-rh.js. O que falta é só a coluna
-- abaixo, para marcar que um ticket é uma escalação do gestor sobre alguém do
-- time (não uma dúvida do próprio remetente).

ALTER TABLE hr_tickets ADD COLUMN IF NOT EXISTS about_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS hr_tickets_about_emp_idx ON hr_tickets(about_employee_id);
