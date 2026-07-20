-- Mesma classe de problema corrigida em vacations (034) e em documents (016):
-- policies "FOR ALL" liberando employee_id = my_employee_id() sem restringir
-- coluna/status, quando na prática o app só usa SELECT + INSERT para o colaborador.

-- adjustment_requests: só RH decide (status aprovado/rejeitado, ver alertas.js e
-- banco-horas-rh.js, ambos atrás de is_rh()). O colaborador só cria a solicitação
-- (ponto-colaborador.js) — a policy FOR ALL, porém, também deixava ele mesmo
-- aprovar a própria solicitação via chamada direta à API.
DROP POLICY IF EXISTS "colabo_adjreq_own" ON adjustment_requests;

CREATE POLICY "colabo_adjreq_select_own" ON adjustment_requests FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_adjreq_insert_own" ON adjustment_requests FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

-- activity_logs é o trilho de auditoria (quem bateu ponto, quando, ajustes de banco
-- de horas etc.) — nenhuma tela faz UPDATE/DELETE nele, nem RH. Colaborador só
-- insere a própria entrada ao bater ponto (ponto-colaborador.js). A policy FOR ALL
-- permitia editar/apagar o próprio histórico de auditoria via API direta.
DROP POLICY IF EXISTS "colabo_actlogs_own" ON activity_logs;

CREATE POLICY "colabo_actlogs_select_own" ON activity_logs FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_actlogs_insert_own" ON activity_logs FOR INSERT
  WITH CHECK (employee_id = my_employee_id());
