ALTER TABLE employees ADD COLUMN IF NOT EXISTS bio       TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE POLICY "colabo_storage_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "colabo_storage_update" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = my_employee_id()::TEXT
  );