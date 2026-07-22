INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', true, 10485760,
  ARRAY['image/jpeg','image/png','image/gif','image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "rh_avatars_all" ON storage.objects FOR ALL
  USING (bucket_id = 'avatars' AND is_rh());

CREATE POLICY "public_avatars_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "colabo_avatars_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND name = my_employee_id()::TEXT);

CREATE POLICY "colabo_avatars_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND name = my_employee_id()::TEXT);

CREATE POLICY "colabo_avatars_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND name = my_employee_id()::TEXT);