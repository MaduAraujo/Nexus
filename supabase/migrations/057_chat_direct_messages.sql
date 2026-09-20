ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS kind   TEXT NOT NULL DEFAULT 'channel',
  ADD COLUMN IF NOT EXISTS dm_key TEXT UNIQUE;

ALTER TABLE chat_channels DROP CONSTRAINT IF EXISTS chat_channels_kind_chk;
ALTER TABLE chat_channels ADD CONSTRAINT chat_channels_kind_chk CHECK (kind IN ('channel', 'dm'));

ALTER TABLE chat_channels DROP CONSTRAINT IF EXISTS chat_channels_dm_key_chk;
ALTER TABLE chat_channels ADD CONSTRAINT chat_channels_dm_key_chk CHECK ((kind = 'dm') = (dm_key IS NOT NULL));

CREATE OR REPLACE FUNCTION chat_channel_is_dm(p_channel UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM chat_channels WHERE id = p_channel AND kind = 'dm');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION chat_is_member(p_channel UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_channel_members
    WHERE channel_id = p_channel AND employee_id = my_employee_id()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION chat_channel_is_dm(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_is_member(UUID)     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_channel_is_dm(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION chat_is_member(UUID)     TO authenticated;

DROP POLICY IF EXISTS "channels_read_all" ON chat_channels;
CREATE POLICY "channels_read_visible" ON chat_channels FOR SELECT
  USING (kind = 'channel' OR chat_is_member(id));

DROP POLICY IF EXISTS "members_read_all" ON chat_channel_members;
CREATE POLICY "members_read_visible" ON chat_channel_members FOR SELECT
  USING (NOT chat_channel_is_dm(channel_id) OR chat_is_member(channel_id));

DROP POLICY IF EXISTS "members_colab_join" ON chat_channel_members;
CREATE POLICY "members_colab_join" ON chat_channel_members FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND NOT chat_channel_is_dm(channel_id));

DROP POLICY IF EXISTS "members_colab_del" ON chat_channel_members;
CREATE POLICY "members_colab_del" ON chat_channel_members FOR DELETE
  USING (employee_id = my_employee_id() AND NOT chat_channel_is_dm(channel_id));

CREATE OR REPLACE FUNCTION get_or_create_dm(p_other UUID)
RETURNS UUID AS $$
DECLARE
  v_me  UUID := my_employee_id();
  v_key TEXT;
  v_id  UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_a_collaborator' USING ERRCODE = '42501';
  END IF;
  IF p_other IS NULL OR p_other = v_me THEN
    RAISE EXCEPTION 'invalid_recipient' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_other AND status = 'Ativo') THEN
    RAISE EXCEPTION 'recipient_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_key := LEAST(v_me::text, p_other::text) || ':' || GREATEST(v_me::text, p_other::text);

  SELECT id INTO v_id FROM chat_channels WHERE dm_key = v_key;

  IF v_id IS NULL THEN
    INSERT INTO chat_channels (name, slug, description, icon, kind, dm_key)
    VALUES ('Mensagem direta', 'dm-' || v_key, NULL, 'user', 'dm', v_key)
    ON CONFLICT (dm_key) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM chat_channels WHERE dm_key = v_key;
    END IF;
  END IF;

  INSERT INTO chat_channel_members (channel_id, employee_id)
  VALUES (v_id, v_me), (v_id, p_other)
  ON CONFLICT (channel_id, employee_id) DO NOTHING;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION get_or_create_dm(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_dm(UUID) TO authenticated;