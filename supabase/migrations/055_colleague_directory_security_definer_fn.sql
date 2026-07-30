DROP VIEW IF EXISTS colleague_directory;

CREATE OR REPLACE FUNCTION colleague_directory()
RETURNS TABLE (
  id UUID,
  name TEXT,
  dept TEXT,
  role TEXT,
  avatar_color TEXT,
  avatar_url TEXT
) AS $$
  SELECT id, name, dept, role, avatar_color, avatar_url
  FROM employees
  WHERE status = 'Ativo';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION colleague_directory() TO authenticated;