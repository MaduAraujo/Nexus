ALTER TABLE message_reads ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION message_reads_ciencia_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION 'A ciência de um comunicado é registro com valor legal e não pode ser apagada.' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.message_id := OLD.message_id;
    NEW.employee_id := OLD.employee_id;
    NEW.read_at := OLD.read_at;
    IF OLD.acknowledged_at IS NOT NULL THEN
      NEW.acknowledged_at := OLD.acknowledged_at;
      RETURN NEW;
    END IF;
  ELSE
    NEW.read_at := now();
  END IF;
  IF NEW.acknowledged_at IS NOT NULL THEN
    IF NEW.employee_id IS DISTINCT FROM my_employee_id() THEN
      RAISE EXCEPTION 'Só o próprio colaborador pode confirmar a ciência de um comunicado.' USING ERRCODE = '42501';
    END IF;
    NEW.acknowledged_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION message_reads_ciencia_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS message_reads_ciencia_guard_trg ON message_reads;
CREATE TRIGGER message_reads_ciencia_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON message_reads
  FOR EACH ROW EXECUTE FUNCTION message_reads_ciencia_guard();

CREATE OR REPLACE FUNCTION messages_ciencia_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = OLD.id AND r.acknowledged_at IS NOT NULL) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Este comunicado já tem ciência confirmada por colaboradores e não pode ser excluído: a confirmação é prova do que foi comunicado.' USING ERRCODE = '55000';
  END IF;
  IF NEW.texto IS DISTINCT FROM OLD.texto OR NEW.categoria IS DISTINCT FROM OLD.categoria
     OR NEW.destino IS DISTINCT FROM OLD.destino OR NEW.anexos IS DISTINCT FROM OLD.anexos THEN
    RAISE EXCEPTION 'Este comunicado já tem ciência confirmada por colaboradores e não pode ser editado. Publique um novo comunicado com a correção.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION messages_ciencia_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS messages_ciencia_guard_trg ON messages;
CREATE TRIGGER messages_ciencia_guard_trg
  BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_ciencia_guard();

CREATE OR REPLACE FUNCTION purge_expired_conversations()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff         TIMESTAMPTZ := now() - interval '12 months';
  v_cutoff_tickets TIMESTAMPTZ := now() - interval '5 years';
  v_chat           INTEGER;
  v_ai             INTEGER;
  v_tickets        INTEGER;
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
        ) < v_cutoff_tickets;
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  RETURN jsonb_build_object('chat_messages', v_chat, 'ai_chat_history', v_ai, 'hr_tickets', v_tickets);
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_conversations() FROM PUBLIC, anon, authenticated;

UPDATE storage.buckets SET public = false WHERE id = 'avatars';

DROP POLICY IF EXISTS "authenticated_avatars_select" ON storage.objects;
CREATE POLICY "authenticated_avatars_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');
