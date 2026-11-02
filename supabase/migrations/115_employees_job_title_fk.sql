ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_title_id UUID REFERENCES job_titles(id);

CREATE INDEX IF NOT EXISTS employees_job_title_id_idx ON employees (job_title_id);

ALTER TABLE employees DISABLE TRIGGER USER;

UPDATE employees e
   SET job_title_id = j.id
  FROM job_titles j
 WHERE lower(trim(j.title)) = lower(trim(e.role));

ALTER TABLE employees ENABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION employees_job_title_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.job_title_id IS DISTINCT FROM OLD.job_title_id THEN
    NEW.job_title_id := (
      SELECT j.id FROM job_titles j
       WHERE lower(trim(j.title)) = lower(trim(NEW.role))
       ORDER BY j.id
       LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employees_job_title_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employees_job_title_sync_trg ON employees;
CREATE TRIGGER employees_job_title_sync_trg
  BEFORE INSERT OR UPDATE OF role, job_title_id ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_job_title_sync();

CREATE OR REPLACE FUNCTION job_titles_rename_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE employees SET role = NEW.title WHERE job_title_id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION job_titles_rename_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS job_titles_rename_sync_trg ON job_titles;
CREATE TRIGGER job_titles_rename_sync_trg
  AFTER UPDATE OF title ON job_titles
  FOR EACH ROW
  WHEN (OLD.title IS DISTINCT FROM NEW.title)
  EXECUTE FUNCTION job_titles_rename_sync();

SELECT nexus_refresh_employees_view();
