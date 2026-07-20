-- Modelos salvos de comunicados (para avisos recorrentes)

CREATE TABLE IF NOT EXISTS message_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  texto      TEXT NOT NULL,
  destino    TEXT NOT NULL,
  categoria  TEXT NOT NULL DEFAULT 'Institucional',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_templates_created_idx ON message_templates(created_at DESC);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_message_templates_all" ON message_templates FOR ALL USING (is_rh());
