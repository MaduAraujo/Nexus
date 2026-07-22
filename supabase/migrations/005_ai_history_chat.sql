CREATE TABLE IF NOT EXISTS ai_analysis_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary      TEXT NOT NULL DEFAULT '',
  health_score INTEGER,
  alerts       JSONB NOT NULL DEFAULT '[]',
  analyzed_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ai_analysis_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_history_all" ON ai_analysis_history FOR ALL USING (is_rh());

CREATE TABLE IF NOT EXISTS ai_chat_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ai_chat_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_chat_all" ON ai_chat_history FOR ALL USING (is_rh());