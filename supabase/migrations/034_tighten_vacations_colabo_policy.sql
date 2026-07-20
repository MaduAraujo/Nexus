-- A policy original "colabo_vacations_own" (schema.sql) é FOR ALL usando só
-- employee_id = my_employee_id(), sem restringir coluna/status. Nenhuma tela usa
-- isso além de: inserir pedido 'pendente' (ferias-colaborador.js insert), cancelar
-- um pedido 'pendente' (cancelRequest) e auto-expirar um 'aprovado' vencido para
-- 'concluido'. Mas a policy, como está, também permite ao colaborador — via
-- qualquer chamada direta à API com a própria sessão, sem precisar da UI — definir
-- status='aprovado' na própria solicitação (auto-aprovação de férias) ou apagar
-- qualquer um dos próprios registros (nenhuma tela jamais fez DELETE em vacations).
-- Substituída por três policies que só liberam exatamente as transições usadas.

DROP POLICY IF EXISTS "colabo_vacations_own" ON vacations;

CREATE POLICY "colabo_vacations_select_own" ON vacations FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_vacations_insert_own" ON vacations FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

-- pendente -> cancelado (cancelRequest) ou aprovado -> concluido (auto-expiração
-- de vencidas). Como o WITH CHECK nunca aceita status='aprovado', a auto-aprovação
-- deixa de ser possível mesmo com uma chamada direta à API.
CREATE POLICY "colabo_vacations_update_own" ON vacations FOR UPDATE
  USING (employee_id = my_employee_id() AND status IN ('pendente','aprovado'))
  WITH CHECK (employee_id = my_employee_id() AND status IN ('cancelado','concluido'));
