DROP POLICY IF EXISTS "colabo_reads_own" ON message_reads;

CREATE POLICY "colabo_reads_select_own" ON message_reads FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_reads_insert_own" ON message_reads FOR INSERT
  WITH CHECK (employee_id = my_employee_id());

CREATE POLICY "colabo_reads_update_own" ON message_reads FOR UPDATE
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id());