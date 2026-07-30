CREATE TABLE IF NOT EXISTS ai_decision_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID REFERENCES employees(id) ON DELETE SET NULL,
  target_table     TEXT NOT NULL CHECK (target_table IN ('vacations', 'adjustment_requests', 'burnout_alerts')),
  target_id        UUID NOT NULL,
  action_type      TEXT NOT NULL,
  ai_message       TEXT NOT NULL,
  evidence         JSONB NOT NULL,
  decided_by_name  TEXT,
  decided_by_email TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_decision_log_emp_idx ON ai_decision_log(employee_id, created_at DESC);

ALTER TABLE ai_decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_ai_decision_log_all"        ON ai_decision_log FOR ALL    USING (is_rh());
CREATE POLICY "colabo_ai_decision_log_select" ON ai_decision_log FOR SELECT USING (employee_id = my_employee_id());
