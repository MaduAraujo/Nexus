DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'Storage indisponível neste banco: crie o bucket documents no painel.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('documents', 'documents', false, 25 * 1024 * 1024 + 4096, NULL)
  ON CONFLICT (id) DO NOTHING;
END $$;