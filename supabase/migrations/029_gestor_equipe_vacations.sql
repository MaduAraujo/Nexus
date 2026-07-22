CREATE POLICY "colabo_vacations_view_team" ON vacations FOR SELECT
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));

CREATE POLICY "colabo_vacations_approve_team" ON vacations FOR UPDATE
  USING (
    status = 'pendente'
    AND employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id())
  )
  WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id())
  );