CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx ON mfa_recovery_codes(user_id);

ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mfa_recovery_codes FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS mfa_required ON mfa_recovery_codes;
CREATE POLICY mfa_required ON mfa_recovery_codes AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()));

ALTER TABLE security_rules DROP CONSTRAINT IF EXISTS security_rules_kind_check;
ALTER TABLE security_rules ADD CONSTRAINT security_rules_kind_check
  CHECK (kind IN ('login_failures', 'login_after_failures', 'mass_export', 'mass_download', 'off_hours_access', 'mfa_recovery_used'));
ALTER TABLE security_alerts DROP CONSTRAINT IF EXISTS security_alerts_kind_check;
ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_kind_check
  CHECK (kind IN ('login_failures', 'login_after_failures', 'mass_export', 'mass_download', 'off_hours_access', 'mfa_recovery_used'));

INSERT INTO security_rules (kind, threshold, threshold_rows, window_minutes, cooldown_minutes, severity, params, description) VALUES
  ('mfa_recovery_used', 1, NULL, 1, 1, 'critical', '{}',
   'Código de recuperação usado no lugar do app autenticador (o app foi desvinculado da conta)')
ON CONFLICT (kind) DO NOTHING;

CREATE OR REPLACE FUNCTION mfa_recovery_generate()
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes    BYTEA;
  v_code     TEXT;
  v_codes    TEXT[] := '{}';
BEGIN
  IF v_uid IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'Confirme o código do app autenticador antes de gerar códigos de recuperação' USING ERRCODE = '42501';
  END IF;

  DELETE FROM mfa_recovery_codes WHERE user_id = v_uid;

  FOR i IN 1..10 LOOP
    v_bytes := gen_random_bytes(10);
    v_code := '';
    FOR j IN 0..9 LOOP
      v_code := v_code || substr(v_alphabet, get_byte(v_bytes, j) % 32 + 1, 1);
    END LOOP;
    v_code := substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
    INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (v_uid, crypt(v_code, gen_salt('bf', 10)));
    v_codes := v_codes || v_code;
  END LOOP;

  RETURN v_codes;
END;
$$;

CREATE OR REPLACE FUNCTION mfa_recovery_remaining()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM mfa_recovery_codes WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION mfa_recovery_verify(p_user UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_norm TEXT := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  IF p_user IS NULL OR length(v_norm) <> 10 THEN
    RETURN FALSE;
  END IF;
  v_norm := substr(v_norm, 1, 5) || '-' || substr(v_norm, 6, 5);

  IF NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p_user AND f.status = 'verified') THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (SELECT 1 FROM mfa_recovery_codes c WHERE c.user_id = p_user AND c.code_hash = crypt(v_norm, c.code_hash));
END;
$$;

CREATE OR REPLACE FUNCTION mfa_recovery_complete(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule  security_rules;
  v_label TEXT := security_subject_label(p_user);
BEGIN
  DELETE FROM mfa_recovery_codes WHERE user_id = p_user;

  SELECT * INTO v_rule FROM security_rules WHERE kind = 'mfa_recovery_used' AND enabled;
  IF FOUND THEN
    PERFORM security_raise_alert(
      v_rule, 'user:' || p_user::text, p_user, v_label,
      'Código de recuperação do MFA usado',
      v_label || ' entrou com um código de recuperação e o app autenticador foi desvinculado da conta. Confirme com a pessoa que foi ela.',
      '{}'::jsonb
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mfa_recovery_generate()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mfa_recovery_remaining()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mfa_recovery_verify(UUID, TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mfa_recovery_complete(UUID)         FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mfa_recovery_generate()          TO authenticated;
GRANT EXECUTE ON FUNCTION mfa_recovery_remaining()         TO authenticated;
GRANT EXECUTE ON FUNCTION mfa_recovery_verify(UUID, TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION mfa_recovery_complete(UUID)      TO service_role;
