ALTER TABLE employee_trainings ADD COLUMN IF NOT EXISTS certificate_path TEXT;

DROP POLICY IF EXISTS "colabo_employee_trainings_self_report" ON employee_trainings;
CREATE POLICY "colabo_employee_trainings_self_report" ON employee_trainings FOR INSERT
  WITH CHECK (
    employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao'
    AND certificate_path IS NOT NULL AND split_part(certificate_path, '/', 1) = my_employee_id()::TEXT
  );

DROP POLICY IF EXISTS "colabo_employee_trainings_self_edit_pending" ON employee_trainings;
CREATE POLICY "colabo_employee_trainings_self_edit_pending" ON employee_trainings FOR UPDATE
  USING (employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao')
  WITH CHECK (
    employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao'
    AND (certificate_path IS NULL OR split_part(certificate_path, '/', 1) = my_employee_id()::TEXT)
  );

DROP POLICY IF EXISTS "colabo_storage_select_certificados" ON storage.objects;
CREATE POLICY "colabo_storage_select_certificados" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    EXISTS (
      SELECT 1 FROM employee_trainings et
      WHERE et.certificate_path = storage.objects.name
        AND et.employee_id = my_employee_id()
    )
  );
