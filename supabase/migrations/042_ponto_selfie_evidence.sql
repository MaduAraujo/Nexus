ALTER TABLE time_records
  ADD COLUMN IF NOT EXISTS entrada_selfie_path        TEXT,
  ADD COLUMN IF NOT EXISTS saida_almoco_selfie_path    TEXT,
  ADD COLUMN IF NOT EXISTS retorno_almoco_selfie_path  TEXT,
  ADD COLUMN IF NOT EXISTS saida_selfie_path           TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ponto-selfies', 'ponto-selfies', false, 3145728, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "colabo_ponto_selfies_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ponto-selfies'
    AND (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "colabo_ponto_selfies_select_own" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'ponto-selfies'
    AND (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "rh_ponto_selfies_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'ponto-selfies' AND is_rh());