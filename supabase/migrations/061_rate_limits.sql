CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION rate_limit_check(p_action TEXT, p_max INTEGER, p_window_seconds INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_key  TEXT;
  v_hits INTEGER;
BEGIN
  IF v_uid IS NULL OR p_action IS NULL OR p_max IS NULL OR p_max < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RETURN FALSE;
  END IF;

  v_key := v_uid::TEXT || ':' || p_action;

  INSERT INTO rate_limits AS r (key, window_start, hits)
  VALUES (v_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN r.window_start < now() - make_interval(secs => p_window_seconds) THEN now() ELSE r.window_start END,
    hits         = CASE WHEN r.window_start < now() - make_interval(secs => p_window_seconds) THEN 1 ELSE r.hits + 1 END
  RETURNING hits INTO v_hits;

  RETURN v_hits <= p_max;
END;
$$;

REVOKE ALL ON FUNCTION rate_limit_check(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rate_limit_check(TEXT, INTEGER, INTEGER) TO authenticated;