CREATE TABLE IF NOT EXISTS chat_reads (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_kind  TEXT NOT NULL CONSTRAINT chat_reads_kind_chk CHECK (thread_kind IN ('channel', 'ticket')),
  thread_id    UUID NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, thread_kind, thread_id)
);

CREATE INDEX IF NOT EXISTS chat_reads_thread_idx ON chat_reads (thread_kind, thread_id);
CREATE INDEX IF NOT EXISTS hr_ticket_msgs_role_idx ON hr_ticket_messages (ticket_id, role, created_at);

ALTER TABLE chat_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_reads_own_select" ON chat_reads;
CREATE POLICY "chat_reads_own_select" ON chat_reads FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS mfa_required ON chat_reads;
CREATE POLICY mfa_required ON chat_reads AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()));

REVOKE ALL ON chat_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON chat_reads TO authenticated;

CREATE OR REPLACE FUNCTION chat_mark_read(p_kind TEXT, p_thread UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := my_employee_id();
  v_ok BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_thread IS NULL OR p_kind IS NULL OR p_kind NOT IN ('channel', 'ticket') THEN
    RAISE EXCEPTION 'invalid_thread' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'channel' THEN
    v_ok := v_me IS NOT NULL AND chat_is_member(p_thread);
  ELSE
    v_ok := (v_me IS NOT NULL AND EXISTS (SELECT 1 FROM hr_tickets t WHERE t.id = p_thread AND t.employee_id = v_me))
         OR (v_me IS NULL AND is_rh() AND EXISTS (SELECT 1 FROM hr_tickets t WHERE t.id = p_thread));
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO chat_reads (user_id, thread_kind, thread_id, last_read_at)
  VALUES (auth.uid(), p_kind, p_thread, now())
  ON CONFLICT (user_id, thread_kind, thread_id) DO UPDATE SET last_read_at = EXCLUDED.last_read_at;
END;
$$;

REVOKE ALL ON FUNCTION chat_mark_read(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION chat_mark_read(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION chat_unread_summary()
RETURNS TABLE (kind TEXT, thread UUID, unread INTEGER)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_me  UUID := my_employee_id();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF v_me IS NOT NULL THEN
    RETURN QUERY
      SELECT 'channel'::TEXT, m.channel_id, count(c.id)::INTEGER
        FROM chat_channel_members m
        LEFT JOIN chat_reads r
          ON r.user_id = v_uid AND r.thread_kind = 'channel' AND r.thread_id = m.channel_id
        JOIN chat_messages c
          ON c.channel_id = m.channel_id
         AND c.employee_id <> v_me
         AND c.created_at > COALESCE(r.last_read_at, m.joined_at, '-infinity'::TIMESTAMPTZ)
       WHERE m.employee_id = v_me
       GROUP BY m.channel_id;

    RETURN QUERY
      SELECT 'ticket'::TEXT, t.id, count(x.id)::INTEGER
        FROM hr_tickets t
        LEFT JOIN chat_reads r
          ON r.user_id = v_uid AND r.thread_kind = 'ticket' AND r.thread_id = t.id
        JOIN hr_ticket_messages x
          ON x.ticket_id = t.id
         AND x.role = 'rh'
         AND x.created_at > COALESCE(r.last_read_at, '-infinity'::TIMESTAMPTZ)
       WHERE t.employee_id = v_me
         AND NOT EXISTS (SELECT 1 FROM hr_ticket_hidden h WHERE h.ticket_id = t.id AND h.employee_id = v_me)
       GROUP BY t.id;
  ELSIF is_rh() THEN
    RETURN QUERY
      SELECT 'ticket'::TEXT, t.id, count(x.id)::INTEGER
        FROM hr_tickets t
        LEFT JOIN chat_reads r
          ON r.user_id = v_uid AND r.thread_kind = 'ticket' AND r.thread_id = t.id
        JOIN hr_ticket_messages x
          ON x.ticket_id = t.id
         AND x.role = 'user'
         AND x.created_at > COALESCE(r.last_read_at, '-infinity'::TIMESTAMPTZ)
       WHERE t.status IN ('aguardando_rh', 'em_atendimento')
       GROUP BY t.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION chat_unread_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION chat_unread_summary() TO authenticated;

CREATE OR REPLACE FUNCTION chat_push_targets(p_kind TEXT, p_id UUID)
RETURNS TABLE (employee_id UUID, profile_id UUID, title TEXT, body TEXT, url TEXT, tag TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg    chat_messages;
  v_chan   chat_channels;
  v_tmsg   hr_ticket_messages;
  v_ticket hr_tickets;
  v_sender TEXT;
BEGIN
  IF p_kind = 'chat' THEN
    SELECT * INTO v_msg FROM chat_messages WHERE id = p_id;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT * INTO v_chan FROM chat_channels WHERE id = v_msg.channel_id;
    SELECT e.name INTO v_sender FROM employees e WHERE e.id = v_msg.employee_id;

    RETURN QUERY
      SELECT m.employee_id,
             NULL::UUID,
             CASE WHEN v_chan.kind = 'dm' THEN COALESCE(v_sender, 'Nova mensagem') ELSE '#' || v_chan.name END,
             CASE WHEN v_chan.kind = 'dm' THEN 'Enviou uma mensagem para você.' ELSE 'Nova mensagem de ' || COALESCE(v_sender, 'um colega') || '.' END,
             '/src/screens/chat-colaborador.html?canal=' || v_chan.id::TEXT,
             'chat-' || v_chan.id::TEXT
        FROM chat_channel_members m
        JOIN employees e ON e.id = m.employee_id
        LEFT JOIN profiles p ON p.employee_id = m.employee_id AND p.profile = 'colaborador'
        LEFT JOIN chat_reads r ON r.user_id = p.id AND r.thread_kind = 'channel' AND r.thread_id = m.channel_id
       WHERE m.channel_id = v_msg.channel_id
         AND m.employee_id <> v_msg.employee_id
         AND NOT status_bloqueia_acesso(e.status)
         AND COALESCE(e.notif_prefs ->> 'chat', 'true') <> 'false'
         AND (
           v_chan.kind = 'dm'
           OR NOT EXISTS (
             SELECT 1 FROM chat_messages o
              WHERE o.channel_id = v_msg.channel_id
                AND o.id <> v_msg.id
                AND o.employee_id <> m.employee_id
                AND o.created_at <= v_msg.created_at
                AND o.created_at > COALESCE(r.last_read_at, m.joined_at, '-infinity'::TIMESTAMPTZ)
           )
         );

  ELSIF p_kind = 'ticket_msg' THEN
    SELECT * INTO v_tmsg FROM hr_ticket_messages WHERE id = p_id;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT * INTO v_ticket FROM hr_tickets WHERE id = v_tmsg.ticket_id;

    IF v_tmsg.role = 'rh' THEN
      RETURN QUERY
        SELECT e.id, NULL::UUID, 'Resposta do RH'::TEXT, 'Um analista respondeu o seu atendimento.'::TEXT,
               '/src/screens/chat-colaborador.html?ticket=' || v_ticket.id::TEXT,
               'ticket-' || v_ticket.id::TEXT
          FROM employees e
         WHERE e.id = v_ticket.employee_id
           AND NOT status_bloqueia_acesso(e.status)
           AND COALESCE(e.notif_prefs ->> 'chat', 'true') <> 'false'
           AND NOT EXISTS (SELECT 1 FROM hr_ticket_hidden h WHERE h.ticket_id = v_ticket.id AND h.employee_id = e.id);
    ELSIF v_tmsg.role = 'user' AND v_ticket.status IN ('aguardando_rh', 'em_atendimento') THEN
      SELECT e.name INTO v_sender FROM employees e WHERE e.id = v_ticket.employee_id;
      RETURN QUERY
        SELECT NULL::UUID, p.id, 'Atendimento RH'::TEXT, 'Nova mensagem de ' || COALESCE(v_sender, 'um colaborador') || '.',
               '/src/screens/chat-rh.html?ticket=' || v_ticket.id::TEXT,
               'ticket-' || v_ticket.id::TEXT
          FROM profiles p
          LEFT JOIN employees e ON e.id = p.employee_id
         WHERE p.profile = 'Administrador'
           AND NOT status_bloqueia_acesso(e.status);
    END IF;

  ELSIF p_kind = 'ticket_escalated' THEN
    SELECT * INTO v_ticket FROM hr_tickets WHERE id = p_id AND status = 'aguardando_rh';
    IF NOT FOUND THEN RETURN; END IF;
    SELECT e.name INTO v_sender FROM employees e WHERE e.id = v_ticket.employee_id;

    RETURN QUERY
      SELECT NULL::UUID, p.id, 'Atendimento aguardando analista'::TEXT,
             COALESCE(v_sender, 'Um colaborador') || ' pediu para falar com o RH.',
             '/src/screens/chat-rh.html?ticket=' || v_ticket.id::TEXT,
             'ticket-' || v_ticket.id::TEXT
        FROM profiles p
        LEFT JOIN employees e ON e.id = p.employee_id
       WHERE p.profile = 'Administrador'
         AND NOT status_bloqueia_acesso(e.status);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION chat_push_targets(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION chat_push_targets(TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION chat_notify_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind        TEXT;
  v_url         TEXT;
  v_service_key TEXT;
BEGIN
  v_kind := CASE TG_TABLE_NAME
              WHEN 'chat_messages' THEN 'chat'
              WHEN 'hr_ticket_messages' THEN 'ticket_msg'
              ELSE 'ticket_escalated'
            END;

  BEGIN
    SELECT decrypted_secret INTO v_url         FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

    IF v_url IS NULL OR v_service_key IS NULL THEN
      RAISE WARNING 'chat_notify_push: vault secrets project_url/service_role_key ausentes — push de % (%) não enviado', v_kind, NEW.id;
      RETURN NULL;
    END IF;

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-chat-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('kind', v_kind, 'id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chat_notify_push: % (%): %', v_kind, NEW.id, SQLERRM;
  END;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION chat_notify_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS chat_messages_push_trg ON chat_messages;
CREATE TRIGGER chat_messages_push_trg
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_notify_push();

DROP TRIGGER IF EXISTS hr_ticket_messages_push_trg ON hr_ticket_messages;
CREATE TRIGGER hr_ticket_messages_push_trg
  AFTER INSERT ON hr_ticket_messages
  FOR EACH ROW WHEN (NEW.role IN ('rh', 'user'))
  EXECUTE FUNCTION chat_notify_push();

DROP TRIGGER IF EXISTS hr_tickets_escalated_push_trg ON hr_tickets;
CREATE TRIGGER hr_tickets_escalated_push_trg
  AFTER UPDATE OF status ON hr_tickets
  FOR EACH ROW WHEN (NEW.status = 'aguardando_rh' AND OLD.status IS DISTINCT FROM 'aguardando_rh')
  EXECUTE FUNCTION chat_notify_push();

CREATE OR REPLACE FUNCTION chat_reads_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM chat_reads
   WHERE thread_kind = CASE TG_TABLE_NAME WHEN 'chat_channels' THEN 'channel' ELSE 'ticket' END
     AND thread_id = OLD.id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION chat_reads_cleanup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS chat_channels_reads_cleanup_trg ON chat_channels;
CREATE TRIGGER chat_channels_reads_cleanup_trg
  AFTER DELETE ON chat_channels
  FOR EACH ROW EXECUTE FUNCTION chat_reads_cleanup();

DROP TRIGGER IF EXISTS hr_tickets_reads_cleanup_trg ON hr_tickets;
CREATE TRIGGER hr_tickets_reads_cleanup_trg
  AFTER DELETE ON hr_tickets
  FOR EACH ROW EXECUTE FUNCTION chat_reads_cleanup();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_reads'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reads';
  END IF;
END $$;
