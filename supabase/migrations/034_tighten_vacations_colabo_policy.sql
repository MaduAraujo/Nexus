DROP POLICY IF EXISTS "colabo_vacations_own" ON vacations;

CREATE POLICY "colabo_vacations_select_own" ON vacations FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_vacations_insert_own" ON vacations FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

CREATE POLICY "colabo_vacations_update_own" ON vacations FOR UPDATE
  USING (employee_id = my_employee_id() AND status IN ('pendente','aprovado'))
  WITH CHECK (employee_id = my_employee_id() AND status IN ('cancelado','concluido'));