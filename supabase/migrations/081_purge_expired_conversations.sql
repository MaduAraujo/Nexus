CREATE OR REPLACE FUNCTION purge_expired_conversations()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff  TIMESTAMPTZ := now() - interval '12 months';
  v_chat    INTEGER;
  v_ai      INTEGER;
  v_tickets INTEGER;
BEGIN
  DELETE FROM chat_messages WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_chat = ROW_COUNT;

  DELETE FROM ai_chat_history WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_ai = ROW_COUNT;

  DELETE FROM hr_tickets t
  WHERE t.status IN ('bot', 'resolvido')
    AND GREATEST(
          t.created_at,
          t.updated_at,
          (SELECT max(m.created_at) FROM hr_ticket_messages m WHERE m.ticket_id = t.id)
        ) < v_cutoff;
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  RETURN jsonb_build_object('chat_messages', v_chat, 'ai_chat_history', v_ai, 'hr_tickets', v_tickets);
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_conversations() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('purge-expired-conversations', '45 6 * * *', 'SELECT purge_expired_conversations();');
  END IF;
END $$;