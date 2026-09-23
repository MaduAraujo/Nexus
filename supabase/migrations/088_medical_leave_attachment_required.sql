DROP POLICY IF EXISTS "colabo_medical_leaves_self_report" ON medical_leaves;
CREATE POLICY "colabo_medical_leaves_self_report" ON medical_leaves FOR INSERT
  WITH CHECK (
    employee_id = my_employee_id() AND status = 'pendente'
    AND storage_path IS NOT NULL AND split_part(storage_path, '/', 1) = my_employee_id()::TEXT
  );
