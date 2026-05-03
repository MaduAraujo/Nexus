-- Adiciona colunas de bio e avatar_url na tabela employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bio       TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Permite que colaboradores deletem seus próprios arquivos no Storage
CREATE POLICY "colabo_storage_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

-- Permite que colaboradores substituam (UPDATE) seus próprios arquivos
CREATE POLICY "colabo_storage_update" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = my_employee_id()::TEXT
  );
