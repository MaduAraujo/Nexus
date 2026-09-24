CREATE OR REPLACE FUNCTION employees_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM payslips WHERE employee_id = OLD.id)
     OR EXISTS (SELECT 1 FROM time_records WHERE employee_id = OLD.id)
     OR EXISTS (SELECT 1 FROM documents WHERE employee_id = OLD.id) THEN
    RAISE EXCEPTION 'Colaborador com holerite, ponto ou documento não pode ser excluído (prazo legal de guarda). Inative e, se necessário, anonimize.'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION employees_delete_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employees_delete_guard_trg ON employees;
CREATE TRIGGER employees_delete_guard_trg
  BEFORE DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_delete_guard();
