ALTER TABLE messages ADD COLUMN IF NOT EXISTS anexos       JSONB DEFAULT '[]';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS messages_scheduled_idx ON messages(scheduled_at);

DROP POLICY IF EXISTS "colabo_messages_read" ON messages;
CREATE POLICY "colabo_messages_read" ON messages FOR SELECT
  USING (
    (scheduled_at IS NULL OR scheduled_at <= NOW()) AND
    (destino = 'Todos' OR destino = (SELECT dept FROM employees WHERE id = my_employee_id()))
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments', 'message-attachments', false, 10485760,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "rh_msgattach_all" ON storage.objects FOR ALL
  USING (bucket_id = 'message-attachments' AND is_rh());

CREATE POLICY "colabo_msgattach_select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'message-attachments' AND
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id::text = (storage.foldername(name))[1]
        AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
        AND (m.destino = 'Todos' OR m.destino = (SELECT dept FROM employees WHERE id = my_employee_id()))
    )
  );