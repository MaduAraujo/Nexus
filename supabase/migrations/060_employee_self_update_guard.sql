DROP POLICY IF EXISTS "colabo_employees_update_own" ON employees;
CREATE POLICY "colabo_employees_update_own" ON employees FOR UPDATE
  USING (id = my_employee_id())
  WITH CHECK (id = my_employee_id());

CREATE OR REPLACE FUNCTION employees_self_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_editable CONSTANT TEXT[] := ARRAY['name', 'telefone', 'bio', 'avatar_url', 'avatar_color', 'notif_prefs', 'last_access', 'updated_at'];
BEGIN
  IF auth.uid() IS NULL OR is_rh() THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_editable) IS DISTINCT FROM (to_jsonb(OLD) - v_editable) THEN
    RAISE EXCEPTION 'Você só pode alterar nome, telefone, bio e avatar do seu perfil. Os demais dados são gerenciados pelo RH.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employees_self_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employees_self_update_guard_trg ON employees;
CREATE TRIGGER employees_self_update_guard_trg
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_self_update_guard();