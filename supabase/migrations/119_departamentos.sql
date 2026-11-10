CREATE TABLE IF NOT EXISTS departments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome           TEXT NOT NULL,
  descricao      TEXT,
  responsavel_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(trim(nome)) BETWEEN 1 AND 60),
  CHECK (nome = trim(nome)),
  CHECK (lower(nome) <> 'todos')
);

CREATE UNIQUE INDEX IF NOT EXISTS departments_nome_unico ON departments (lower(nome));
CREATE INDEX IF NOT EXISTS departments_responsavel_idx ON departments (responsavel_id);

DROP TRIGGER IF EXISTS departments_updated_at ON departments;
CREATE TRIGGER departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON departments FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO authenticated;
DROP POLICY IF EXISTS "rh_departments_all" ON departments;
CREATE POLICY "rh_departments_all" ON departments FOR ALL
  USING ((SELECT public.is_rh())) WITH CHECK ((SELECT public.is_rh()));
DROP POLICY IF EXISTS "authenticated_departments_select" ON departments;
CREATE POLICY "authenticated_departments_select" ON departments FOR SELECT TO authenticated USING (true);

INSERT INTO departments (nome, descricao) VALUES
  ('TI', 'Tecnologia da Informação'),
  ('RH', 'Recursos Humanos'),
  ('Financeiro', NULL),
  ('Marketing', NULL),
  ('Jurídico', NULL),
  ('Administrativo', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO departments (nome)
SELECT DISTINCT ON (lower(trim(e.dept))) trim(e.dept)
  FROM employees e
 WHERE length(trim(COALESCE(e.dept, ''))) BETWEEN 1 AND 60
   AND lower(trim(e.dept)) <> 'todos'
 ORDER BY lower(trim(e.dept)), trim(e.dept)
ON CONFLICT DO NOTHING;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);
CREATE INDEX IF NOT EXISTS employees_department_id_idx ON employees (department_id);

ALTER TABLE employees DISABLE TRIGGER USER;

UPDATE employees e
   SET department_id = d.id,
       dept = d.nome
  FROM departments d
 WHERE lower(d.nome) = lower(trim(e.dept));

ALTER TABLE employees ENABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION employees_department_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep departments;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.department_id IS DISTINCT FROM OLD.department_id AND NEW.department_id IS NOT NULL THEN
    SELECT * INTO v_dep FROM departments WHERE id = NEW.department_id;
  ELSIF TG_OP = 'INSERT' AND NEW.department_id IS NOT NULL AND NEW.dept IS NULL THEN
    SELECT * INTO v_dep FROM departments WHERE id = NEW.department_id;
  ELSIF length(trim(COALESCE(NEW.dept, ''))) = 0 THEN
    NEW.dept := NULL;
    NEW.department_id := NULL;
    RETURN NEW;
  ELSE
    SELECT * INTO v_dep FROM departments WHERE lower(nome) = lower(trim(NEW.dept));
    IF NOT FOUND THEN
      INSERT INTO departments (nome) VALUES (left(trim(NEW.dept), 60)) RETURNING * INTO v_dep;
    END IF;
  END IF;

  IF NOT v_dep.ativo AND (TG_OP = 'INSERT' OR v_dep.id IS DISTINCT FROM OLD.department_id) THEN
    RAISE EXCEPTION 'O departamento % está inativo: escolha outro ou reative-o.', v_dep.nome USING ERRCODE = '23514';
  END IF;

  NEW.department_id := v_dep.id;
  NEW.dept := v_dep.nome;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employees_department_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employees_department_sync_trg ON employees;
CREATE TRIGGER employees_department_sync_trg
  BEFORE INSERT OR UPDATE OF dept, department_id ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_department_sync();

CREATE OR REPLACE FUNCTION departments_rename_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE employees SET dept = NEW.nome WHERE department_id = NEW.id;
  UPDATE messages SET destino = NEW.nome WHERE destino = OLD.nome;
  UPDATE chat_channels SET dept = NEW.nome WHERE dept = OLD.nome;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION departments_rename_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS departments_rename_sync_trg ON departments;
CREATE TRIGGER departments_rename_sync_trg
  AFTER UPDATE OF nome ON departments
  FOR EACH ROW
  WHEN (OLD.nome IS DISTINCT FROM NEW.nome)
  EXECUTE FUNCTION departments_rename_sync();

SELECT nexus_refresh_employees_view();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'departments'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.departments;
  END IF;
END $$;
