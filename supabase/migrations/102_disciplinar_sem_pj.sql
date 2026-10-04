CREATE OR REPLACE FUNCTION disciplinary_actions_sem_pj_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM employees WHERE id = NEW.employee_id AND lower(COALESCE(contract_type, '')) = 'pj') THEN
    RAISE EXCEPTION 'Prestador PJ não está sujeito a advertência ou suspensão — use as cláusulas do contrato de prestação de serviços.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION disciplinary_actions_sem_pj_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS disciplinary_actions_sem_pj_trg ON disciplinary_actions;
CREATE TRIGGER disciplinary_actions_sem_pj_trg
  BEFORE INSERT OR UPDATE OF employee_id ON disciplinary_actions
  FOR EACH ROW EXECUTE FUNCTION disciplinary_actions_sem_pj_guard();
