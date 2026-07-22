DROP POLICY IF EXISTS "colabo_adjreq_own" ON adjustment_requests;

CREATE POLICY "colabo_adjreq_select_own" ON adjustment_requests FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_adjreq_insert_own" ON adjustment_requests FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

DROP POLICY IF EXISTS "colabo_actlogs_own" ON activity_logs;

CREATE POLICY "colabo_actlogs_select_own" ON activity_logs FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_actlogs_insert_own" ON activity_logs FOR INSERT
  WITH CHECK (employee_id = my_employee_id());