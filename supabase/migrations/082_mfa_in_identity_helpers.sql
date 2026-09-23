CREATE OR REPLACE FUNCTION is_rh()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND profile = 'Administrador'
  ) AND public.mfa_ok();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION my_employee_id()
RETURNS UUID AS $$
  SELECT employee_id FROM profiles
  WHERE id = auth.uid() AND profile = 'colaborador' AND public.mfa_ok();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;