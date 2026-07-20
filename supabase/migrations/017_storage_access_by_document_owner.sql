-- Corrige o acesso de storage do colaborador: a política antiga só liberava leitura quando o
-- primeiro segmento do caminho era o próprio employee_id, mas documentos enviados pelo RH ficam
-- em "rh/...", então o colaborador nunca conseguia abrir contratos, termos de rescisão etc. mesmo
-- enxergando a linha correspondente em "documents". Agora a leitura é decidida pela própria tabela
-- documents (quem é o dono do documento), não pelo prefixo da pasta.
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
