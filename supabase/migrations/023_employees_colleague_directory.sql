CREATE POLICY "colabo_employees_active_directory" ON employees FOR SELECT
  USING (status = 'Ativo' AND my_employee_id() IS NOT NULL);