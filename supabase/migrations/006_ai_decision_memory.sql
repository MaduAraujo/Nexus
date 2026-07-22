CREATE TABLE IF NOT EXISTS ai_decision_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ai_decision_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_memory_all" ON ai_decision_memory FOR ALL USING (is_rh());