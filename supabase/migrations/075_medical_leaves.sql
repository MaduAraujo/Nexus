CREATE TABLE IF NOT EXISTS medical_leaves (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  days              INTEGER GENERATED ALWAYS AS (end_date - start_date + 1) STORED,
  doctor_name       TEXT,
  doctor_crm        TEXT,
  cid               TEXT,
  storage_path      TEXT,
  status            TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'recusado')),
  rejection_reason  TEXT,
  reviewed_by_name  TEXT,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS medical_leaves_emp_idx ON medical_leaves(employee_id, start_date DESC);

CREATE TRIGGER medical_leaves_updated_at
  BEFORE UPDATE ON medical_leaves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE medical_leaves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_medical_leaves_select" ON medical_leaves FOR SELECT USING (is_rh());
CREATE POLICY "rh_medical_leaves_update" ON medical_leaves FOR UPDATE USING (is_rh()) WITH CHECK (is_rh());
CREATE POLICY "rh_medical_leaves_delete" ON medical_leaves FOR DELETE USING (is_rh());

CREATE POLICY "colabo_medical_leaves_own_select" ON medical_leaves FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_medical_leaves_self_report" ON medical_leaves FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

CREATE POLICY "colabo_medical_leaves_self_edit_pending" ON medical_leaves FOR UPDATE
  USING (employee_id = my_employee_id() AND status = 'pendente')
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

CREATE POLICY "colabo_medical_leaves_self_withdraw_pending" ON medical_leaves FOR DELETE
  USING (employee_id = my_employee_id() AND status = 'pendente');

CREATE OR REPLACE FUNCTION medical_leaves_team()
RETURNS TABLE (id UUID, employee_id UUID, start_date DATE, end_date DATE, days INTEGER, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ml.id, ml.employee_id, ml.start_date, ml.end_date, ml.days, ml.status
  FROM medical_leaves ml
  JOIN employees e ON e.id = ml.employee_id
  WHERE e.manager_id = my_employee_id()
  ORDER BY ml.start_date DESC;
$$;

GRANT EXECUTE ON FUNCTION medical_leaves_team() TO authenticated;

CREATE POLICY "colabo_storage_select_atestados" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    EXISTS (
      SELECT 1 FROM medical_leaves ml
      WHERE ml.storage_path = storage.objects.name
        AND ml.employee_id = my_employee_id()
    )
  );

CREATE OR REPLACE FUNCTION medical_leaves_apply_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aprovado' AND NEW.start_date <= CURRENT_DATE AND NEW.end_date >= CURRENT_DATE THEN
    UPDATE employees SET status = 'Afastado' WHERE id = NEW.employee_id AND status = 'Ativo';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medical_leaves_apply_status_trg ON medical_leaves;
CREATE TRIGGER medical_leaves_apply_status_trg
  AFTER INSERT OR UPDATE ON medical_leaves
  FOR EACH ROW EXECUTE FUNCTION medical_leaves_apply_status();

CREATE OR REPLACE FUNCTION sync_medical_leave_statuses()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE employees e
  SET status = 'Afastado'
  WHERE e.status = 'Ativo'
    AND EXISTS (
      SELECT 1 FROM medical_leaves ml
      WHERE ml.employee_id = e.id AND ml.status = 'aprovado'
        AND ml.start_date <= CURRENT_DATE AND ml.end_date >= CURRENT_DATE
    );

  UPDATE employees e
  SET status = 'Ativo'
  WHERE e.status = 'Afastado'
    AND EXISTS (
      SELECT 1 FROM medical_leaves ml
      WHERE ml.employee_id = e.id AND ml.status = 'aprovado' AND ml.end_date < CURRENT_DATE
    )
    AND NOT EXISTS (
      SELECT 1 FROM medical_leaves ml2
      WHERE ml2.employee_id = e.id AND ml2.status = 'aprovado'
        AND ml2.start_date <= CURRENT_DATE AND ml2.end_date >= CURRENT_DATE
    )
    AND NOT EXISTS (
      SELECT 1 FROM vacations v
      WHERE v.employee_id = e.id AND v.status = 'aprovado'
        AND v.start_date <= CURRENT_DATE AND v.end_date >= CURRENT_DATE
    );
END;
$$;

SELECT cron.schedule(
  'sync-medical-leave-statuses-daily',
  '5 3 * * *',
  $$SELECT sync_medical_leave_statuses();$$
);