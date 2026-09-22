CREATE TABLE IF NOT EXISTS trainings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  description    TEXT,
  category       TEXT, 
  provider       TEXT, 
  duration_hours NUMERIC(6,2),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (title)
);

CREATE TRIGGER trainings_updated_at
  BEFORE UPDATE ON trainings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE trainings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_trainings_all" ON trainings FOR ALL USING (is_rh());
CREATE POLICY "authenticated_trainings_select" ON trainings FOR SELECT TO authenticated USING (active = true);

CREATE TABLE IF NOT EXISTS employee_trainings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  training_id      UUID REFERENCES trainings(id) ON DELETE SET NULL, 
  title            TEXT NOT NULL,
  category         TEXT,
  provider         TEXT,
  hours            NUMERIC(6,2),
  source           TEXT NOT NULL DEFAULT 'atribuido' CHECK (source IN ('atribuido', 'autodeclarado')),
  status           TEXT NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente', 'em_andamento', 'concluido', 'aguardando_aprovacao', 'recusado', 'cancelado')),
  completion_date  DATE,
  certificate_url  TEXT,
  notes            TEXT, 
  assigned_by_name TEXT, 
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (source = 'autodeclarado' AND status IN ('aguardando_aprovacao', 'concluido', 'recusado'))
    OR (source = 'atribuido' AND status IN ('pendente', 'em_andamento', 'concluido', 'cancelado'))
  )
);

CREATE INDEX IF NOT EXISTS employee_trainings_emp_idx ON employee_trainings(employee_id, created_at DESC);

CREATE TRIGGER employee_trainings_updated_at
  BEFORE UPDATE ON employee_trainings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE employee_trainings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_employee_trainings_all" ON employee_trainings FOR ALL USING (is_rh());

CREATE POLICY "gestor_employee_trainings_team" ON employee_trainings FOR ALL
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));

CREATE POLICY "colabo_employee_trainings_own_select" ON employee_trainings FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_employee_trainings_self_report" ON employee_trainings FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao');

CREATE POLICY "colabo_employee_trainings_self_edit_pending" ON employee_trainings FOR UPDATE
  USING (employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao')
  WITH CHECK (employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao');

CREATE POLICY "colabo_employee_trainings_self_withdraw_pending" ON employee_trainings FOR DELETE
  USING (employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao');