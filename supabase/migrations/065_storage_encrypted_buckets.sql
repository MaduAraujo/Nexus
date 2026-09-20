DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'Storage indisponível neste banco: ajuste os buckets no painel (sem allowed_mime_types).';
    RETURN;
  END IF;

  UPDATE storage.buckets
     SET allowed_mime_types = NULL, file_size_limit = 25 * 1024 * 1024 + 4096
   WHERE id = 'documents';

  UPDATE storage.buckets
     SET allowed_mime_types = NULL, file_size_limit = 10 * 1024 * 1024 + 4096
   WHERE id = 'message-attachments';

  UPDATE storage.buckets
     SET allowed_mime_types = NULL, file_size_limit = 3 * 1024 * 1024 + 4096
   WHERE id = 'ponto-selfies';
END $$;
