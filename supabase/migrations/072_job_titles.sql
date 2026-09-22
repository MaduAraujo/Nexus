CREATE TABLE IF NOT EXISTS job_titles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  track        TEXT, 
  level        TEXT, 
  salary_min   NUMERIC(10,2),
  salary_max   NUMERIC(10,2),
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (title),
  CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min)
);

CREATE TRIGGER job_titles_updated_at
  BEFORE UPDATE ON job_titles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE job_titles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_job_titles_all" ON job_titles FOR ALL USING (is_rh());

CREATE OR REPLACE FUNCTION job_titles_public()
RETURNS TABLE (id UUID, title TEXT, track TEXT, level TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, title, track, level
  FROM job_titles
  WHERE active = true
  ORDER BY track NULLS LAST, level NULLS LAST, title;
$$;

GRANT EXECUTE ON FUNCTION job_titles_public() TO authenticated;

INSERT INTO job_titles (title, level) VALUES
  ('Estagiário', 'Estágio'),
  ('Aprendiz', 'Aprendizagem'),
  ('Assistente', 'Operacional'),
  ('Analista Júnior', 'Júnior'),
  ('Analista Pleno', 'Pleno'),
  ('Analista Sênior', 'Sênior'),
  ('Especialista', 'Especialista'),
  ('Supervisor', 'Coordenação'),
  ('Coordenador', 'Coordenação'),
  ('Gerente', 'Gerência'),
  ('Diretor', 'Diretoria')
ON CONFLICT (title) DO NOTHING;