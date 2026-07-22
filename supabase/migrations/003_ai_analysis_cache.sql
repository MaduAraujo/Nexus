CREATE TABLE IF NOT EXISTS ai_analysis_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key   TEXT NOT NULL DEFAULT 'latest',
  summary     TEXT NOT NULL DEFAULT '',
  alerts      JSONB NOT NULL DEFAULT '[]',
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cache_key)
);

ALTER TABLE ai_analysis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_cache_all"
  ON ai_analysis_cache FOR ALL
  USING (is_rh());