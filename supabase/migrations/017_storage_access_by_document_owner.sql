DROP POLICY IF EXISTS "colabo_storage_own" ON storage.objects;

CREATE POLICY "colabo_storage_select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.storage_path = storage.objects.name
        AND d.employee_id = my_employee_id()
    )
  );