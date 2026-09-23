CREATE TABLE IF NOT EXISTS e2e_keys (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  public_key          JSONB NOT NULL,
  fingerprint         TEXT NOT NULL,
  wrapped_by_password JSONB NOT NULL,
  wrapped_by_recovery JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS e2e_org_keys (
  id          TEXT PRIMARY KEY CHECK (id = 'rh'),
  public_key  JSONB NOT NULL,
  fingerprint TEXT NOT NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS e2e_org_key_grants (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_fp    TEXT NOT NULL,
  wrapped_private JSONB NOT NULL,
  granted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipient_fp)
);

CREATE TABLE IF NOT EXISTS e2e_channel_keys (
  channel_id   UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  key_version  INTEGER NOT NULL CHECK (key_version >= 1),
  recipient_fp TEXT NOT NULL,
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  wrapped_key  JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, key_version, recipient_fp)
);

ALTER TABLE e2e_keys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE e2e_org_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE e2e_org_key_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE e2e_channel_keys   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON e2e_keys, e2e_org_keys, e2e_org_key_grants, e2e_channel_keys FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON e2e_keys TO authenticated;
GRANT SELECT, INSERT ON e2e_org_keys, e2e_org_key_grants, e2e_channel_keys TO authenticated;

DROP POLICY IF EXISTS "e2e_keys_own" ON e2e_keys;
CREATE POLICY "e2e_keys_own" ON e2e_keys FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "e2e_org_keys_read" ON e2e_org_keys;
DROP POLICY IF EXISTS "e2e_org_keys_create" ON e2e_org_keys;
CREATE POLICY "e2e_org_keys_read" ON e2e_org_keys FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "e2e_org_keys_create" ON e2e_org_keys FOR INSERT WITH CHECK (is_rh() AND created_by = auth.uid());

CREATE OR REPLACE FUNCTION e2e_fingerprint_of(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fingerprint FROM e2e_keys WHERE user_id = p_user;
$$;

REVOKE ALL ON FUNCTION e2e_fingerprint_of(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION e2e_fingerprint_of(UUID) TO authenticated;

DROP POLICY IF EXISTS "e2e_org_key_grants_own" ON e2e_org_key_grants;
DROP POLICY IF EXISTS "e2e_org_key_grants_give" ON e2e_org_key_grants;
CREATE POLICY "e2e_org_key_grants_own" ON e2e_org_key_grants FOR SELECT USING (is_rh() AND user_id = auth.uid());
CREATE POLICY "e2e_org_key_grants_give" ON e2e_org_key_grants FOR INSERT
  WITH CHECK (
    is_rh()
    AND granted_by = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = e2e_org_key_grants.user_id AND p.profile = 'Administrador')
    AND recipient_fp = e2e_fingerprint_of(e2e_org_key_grants.user_id)
  );

DROP POLICY IF EXISTS "e2e_channel_keys_member_read" ON e2e_channel_keys;
DROP POLICY IF EXISTS "e2e_channel_keys_member_insert" ON e2e_channel_keys;
CREATE POLICY "e2e_channel_keys_member_read" ON e2e_channel_keys FOR SELECT
  USING (chat_channel_is_dm(channel_id) AND chat_is_member(channel_id));
CREATE POLICY "e2e_channel_keys_member_insert" ON e2e_channel_keys FOR INSERT
  WITH CHECK (
    chat_channel_is_dm(channel_id)
    AND chat_is_member(channel_id)
    AND EXISTS (SELECT 1 FROM chat_channel_members m WHERE m.channel_id = e2e_channel_keys.channel_id AND m.employee_id = e2e_channel_keys.employee_id)
  );

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['e2e_keys', 'e2e_org_keys', 'e2e_org_key_grants', 'e2e_channel_keys'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t);
    EXECUTE format('CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION e2e_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS e2e_keys_updated_at ON e2e_keys;
CREATE TRIGGER e2e_keys_updated_at BEFORE UPDATE ON e2e_keys FOR EACH ROW EXECUTE FUNCTION e2e_touch_updated_at();

CREATE OR REPLACE FUNCTION e2e_employee_key(p_employee_id UUID)
RETURNS TABLE (public_key JSONB, fingerprint TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.public_key, k.fingerprint
    FROM employees e
    JOIN e2e_keys k ON k.user_id = e.auth_user_id
   WHERE e.id = p_employee_id
     AND (is_rh() OR p_employee_id = my_employee_id());
$$;

CREATE OR REPLACE FUNCTION e2e_dm_peer_key(p_channel UUID)
RETURNS TABLE (employee_id UUID, public_key JSONB, fingerprint TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.employee_id, k.public_key, k.fingerprint
    FROM chat_channel_members m
    JOIN employees e ON e.id = m.employee_id
    LEFT JOIN e2e_keys k ON k.user_id = e.auth_user_id
   WHERE m.channel_id = p_channel
     AND m.employee_id IS DISTINCT FROM my_employee_id()
     AND chat_channel_is_dm(p_channel)
     AND chat_is_member(p_channel);
$$;

CREATE OR REPLACE FUNCTION e2e_admins_pending_grant()
RETURNS TABLE (user_id UUID, label TEXT, public_key JSONB, fingerprint TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.user_id, COALESCE(u.email, 'Administrador'), k.public_key, k.fingerprint
    FROM profiles p
    JOIN e2e_keys k ON k.user_id = p.id
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.profile = 'Administrador'
     AND is_rh()
     AND NOT EXISTS (SELECT 1 FROM e2e_org_key_grants g WHERE g.user_id = k.user_id AND g.recipient_fp = k.fingerprint);
$$;

REVOKE ALL ON FUNCTION e2e_touch_updated_at()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION e2e_employee_key(UUID)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION e2e_dm_peer_key(UUID)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION e2e_admins_pending_grant()      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION e2e_employee_key(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION e2e_dm_peer_key(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION e2e_admins_pending_grant()   TO authenticated;
