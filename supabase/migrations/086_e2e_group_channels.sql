ALTER TABLE e2e_channel_keys ALTER COLUMN employee_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION e2e_org_fingerprint()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fingerprint FROM e2e_org_keys WHERE id = 'rh';
$$;

REVOKE ALL ON FUNCTION e2e_org_fingerprint() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION e2e_org_fingerprint() TO authenticated;

DROP POLICY IF EXISTS "e2e_channel_keys_member_read" ON e2e_channel_keys;
DROP POLICY IF EXISTS "e2e_channel_keys_member_insert" ON e2e_channel_keys;

CREATE POLICY "e2e_channel_keys_member_read" ON e2e_channel_keys FOR SELECT
  USING (chat_is_member(channel_id) OR (is_rh() AND NOT chat_channel_is_dm(channel_id)));

CREATE POLICY "e2e_channel_keys_member_insert" ON e2e_channel_keys FOR INSERT
  WITH CHECK (
    chat_is_member(channel_id)
    AND (
      EXISTS (SELECT 1 FROM chat_channel_members m WHERE m.channel_id = e2e_channel_keys.channel_id AND m.employee_id = e2e_channel_keys.employee_id)
      OR (employee_id IS NULL AND NOT chat_channel_is_dm(channel_id) AND recipient_fp = e2e_org_fingerprint())
    )
  );

CREATE OR REPLACE FUNCTION e2e_channel_member_keys(p_channel UUID)
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
     AND chat_is_member(p_channel);
$$;

REVOKE ALL ON FUNCTION e2e_channel_member_keys(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION e2e_channel_member_keys(UUID) TO authenticated;
