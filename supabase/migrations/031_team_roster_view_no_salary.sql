CREATE OR REPLACE VIEW team_roster
WITH (security_invoker = true) AS
SELECT
  id, name, role, dept, status, contract_type, work_load,
  avatar_color, avatar_url, manager_id
FROM employees;

GRANT SELECT ON team_roster TO authenticated;