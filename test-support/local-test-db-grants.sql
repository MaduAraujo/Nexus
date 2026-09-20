GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

INSERT INTO nexus_key_store (name, secret) VALUES
  ('data_encryption_key', 'ci-only-encryption-key-0000000000000000000000000000000000000000'),
  ('data_hmac_key',       'ci-only-hmac-key-0000000000000000000000000000000000000000000000')
ON CONFLICT (name) DO NOTHING;
