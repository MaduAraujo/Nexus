CREATE TABLE IF NOT EXISTS performance_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cycle           TEXT NOT NULL, 
  status          TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
  overall_rating  SMALLINT CHECK (overall_rating BETWEEN 1 AND 5),
  manager_comment TEXT,
  evaluator_name  TEXT, 
  evaluator_email TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS performance_reviews_emp_idx ON performance_reviews(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS performance_review_competencies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  competency  TEXT NOT NULL,
  rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT
);

CREATE INDEX IF NOT EXISTS performance_review_competencies_review_idx ON performance_review_competencies(review_id);

CREATE TABLE IF NOT EXISTS pdi_goals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  review_id        UUID REFERENCES performance_reviews(id) ON DELETE SET NULL, 
  title            TEXT NOT NULL,
  description      TEXT,
  due_date         DATE,
  status           TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluido', 'cancelado')),
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pdi_goals_emp_idx ON pdi_goals(employee_id, created_at DESC);

CREATE TRIGGER performance_reviews_updated_at
  BEFORE UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER pdi_goals_updated_at
  BEFORE UPDATE ON pdi_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION pdi_goals_self_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_editable CONSTANT TEXT[] := ARRAY['status', 'updated_at'];
  v_is_manager BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM employees WHERE id = NEW.employee_id AND manager_id = my_employee_id()
  ) INTO v_is_manager;
  IF v_is_manager THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_editable) IS DISTINCT FROM (to_jsonb(OLD) - v_editable) THEN
    RAISE EXCEPTION 'Você só pode atualizar o status da sua meta de desenvolvimento.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION pdi_goals_self_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pdi_goals_self_update_guard_trg ON pdi_goals;
CREATE TRIGGER pdi_goals_self_update_guard_trg
  BEFORE UPDATE ON pdi_goals
  FOR EACH ROW EXECUTE FUNCTION pdi_goals_self_update_guard();

ALTER TABLE performance_reviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_review_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdi_goals                       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_performance_reviews_select" ON performance_reviews FOR SELECT USING (is_rh());
CREATE POLICY "gestor_performance_reviews_team" ON performance_reviews FOR ALL
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));
CREATE POLICY "colabo_performance_reviews_own_select" ON performance_reviews FOR SELECT
  USING (employee_id = my_employee_id() AND status = 'concluida');

CREATE POLICY "rh_review_competencies_select" ON performance_review_competencies FOR SELECT USING (is_rh());
CREATE POLICY "gestor_review_competencies_team" ON performance_review_competencies FOR ALL
  USING (review_id IN (
    SELECT pr.id FROM performance_reviews pr
    JOIN employees e ON e.id = pr.employee_id
    WHERE e.manager_id = my_employee_id()
  ));
CREATE POLICY "colabo_review_competencies_own_select" ON performance_review_competencies FOR SELECT
  USING (review_id IN (
    SELECT id FROM performance_reviews WHERE employee_id = my_employee_id() AND status = 'concluida'
  ));

CREATE POLICY "rh_pdi_goals_select" ON pdi_goals FOR SELECT USING (is_rh());
CREATE POLICY "gestor_pdi_goals_team" ON pdi_goals FOR ALL
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));
CREATE POLICY "colabo_pdi_goals_own_select" ON pdi_goals FOR SELECT
  USING (employee_id = my_employee_id());
CREATE POLICY "colabo_pdi_goals_own_update" ON pdi_goals FOR UPDATE
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id());