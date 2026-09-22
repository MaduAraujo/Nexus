CREATE TABLE IF NOT EXISTS disciplinary_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('advertencia_verbal', 'advertencia_escrita', 'suspensao')),
  reason            TEXT NOT NULL,
  description       TEXT,
  suspension_days   SMALLINT CHECK (suspension_days IS NULL OR suspension_days > 0),
  occurred_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by_name   TEXT,
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (type = 'suspensao' OR suspension_days IS NULL)
);

CREATE INDEX IF NOT EXISTS disciplinary_actions_emp_idx ON disciplinary_actions(employee_id, occurred_at DESC);

CREATE TRIGGER disciplinary_actions_updated_at
  BEFORE UPDATE ON disciplinary_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION disciplinary_actions_ack_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_editable CONSTANT TEXT[] := ARRAY['acknowledged_at', 'updated_at'];
BEGIN
  IF auth.uid() IS NULL OR is_rh() THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_editable) IS DISTINCT FROM (to_jsonb(OLD) - v_editable) THEN
    RAISE EXCEPTION 'Você só pode dar ciência desta medida disciplinar.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION disciplinary_actions_ack_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS disciplinary_actions_ack_guard_trg ON disciplinary_actions;
CREATE TRIGGER disciplinary_actions_ack_guard_trg
  BEFORE UPDATE ON disciplinary_actions
  FOR EACH ROW EXECUTE FUNCTION disciplinary_actions_ack_guard();

ALTER TABLE disciplinary_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_disciplinary_actions_all" ON disciplinary_actions FOR ALL USING (is_rh());

CREATE POLICY "gestor_disciplinary_actions_team_select" ON disciplinary_actions FOR SELECT
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));

CREATE POLICY "colabo_disciplinary_actions_own_select" ON disciplinary_actions FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_disciplinary_actions_own_ack" ON disciplinary_actions FOR UPDATE
  USING (employee_id = my_employee_id() AND acknowledged_at IS NULL)
  WITH CHECK (employee_id = my_employee_id());