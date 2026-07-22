CREATE POLICY "colabo_requirements_select" ON document_requirements FOR SELECT
  USING (my_employee_id() IS NOT NULL);