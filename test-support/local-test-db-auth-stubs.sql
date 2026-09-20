CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL,
  friendly_name TEXT,
  factor_type   TEXT NOT NULL,
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  secret        TEXT
);

GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated;
GRANT ALL ON auth.mfa_factors TO postgres;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO postgres, anon, authenticated;
