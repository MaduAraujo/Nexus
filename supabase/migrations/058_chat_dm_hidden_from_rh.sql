DROP POLICY IF EXISTS "channels_rh_all" ON chat_channels;
CREATE POLICY "channels_rh_all" ON chat_channels FOR ALL
  USING (is_rh() AND kind = 'channel');

DROP POLICY IF EXISTS "members_rh_all" ON chat_channel_members;
CREATE POLICY "members_rh_all" ON chat_channel_members FOR ALL
  USING (is_rh() AND NOT chat_channel_is_dm(channel_id));

DROP POLICY IF EXISTS "msgs_rh_all" ON chat_messages;
CREATE POLICY "msgs_rh_all" ON chat_messages FOR ALL
  USING (is_rh() AND NOT chat_channel_is_dm(channel_id));

DROP POLICY IF EXISTS "msgs_member_read" ON chat_messages;

CREATE POLICY "msgs_member_read" ON chat_messages FOR SELECT
  USING (
    (is_rh() AND NOT chat_channel_is_dm(channel_id))
    OR EXISTS (
      SELECT 1 FROM chat_channel_members m
      WHERE m.channel_id = chat_messages.channel_id
        AND m.employee_id = my_employee_id()
    )
  );