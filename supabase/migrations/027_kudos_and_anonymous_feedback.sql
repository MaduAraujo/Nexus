CREATE TABLE IF NOT EXISTS kudos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  categoria         TEXT NOT NULL DEFAULT 'colaboracao'
                     CHECK (categoria IN ('colaboracao','inovacao','lideranca','superacao','mentoria')),
  message           TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (from_employee_id <> to_employee_id)
);

CREATE INDEX IF NOT EXISTS kudos_to_idx      ON kudos(to_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kudos_created_idx ON kudos(created_at DESC);

ALTER TABLE kudos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kudos_read_all"   ON kudos FOR SELECT USING (true);
CREATE POLICY "kudos_colab_give" ON kudos FOR INSERT
  WITH CHECK (from_employee_id = my_employee_id());
CREATE POLICY "kudos_rh_all"     ON kudos FOR ALL USING (is_rh());

CREATE TABLE IF NOT EXISTS anonymous_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria   TEXT NOT NULL DEFAULT 'outro'
              CHECK (categoria IN ('clima','gestao','processos','infraestrutura','outro')),
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','lido','arquivado')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS anon_feedback_status_idx ON anonymous_feedback(status, created_at DESC);

ALTER TABLE anonymous_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_feedback_colab_insert" ON anonymous_feedback FOR INSERT
  WITH CHECK (my_employee_id() IS NOT NULL);
CREATE POLICY "anon_feedback_rh_all" ON anonymous_feedback FOR ALL USING (is_rh());