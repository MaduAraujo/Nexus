DROP POLICY IF EXISTS "colabo_employees_active_directory" ON employees;

CREATE VIEW colleague_directory AS
SELECT id, name, dept, role, avatar_color, avatar_url
FROM employees
WHERE status = 'Ativo';

GRANT SELECT ON colleague_directory TO authenticated;