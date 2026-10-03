CREATE OR REPLACE FUNCTION public.status_bloqueia_acesso(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT lower(COALESCE(p_status, '')) IN ('inativo', 'bloqueado');
$$;

CREATE OR REPLACE FUNCTION public.conta_desativada()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN employees e ON e.id = p.employee_id
    WHERE p.id = auth.uid() AND public.status_bloqueia_acesso(e.status)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_rh()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND profile = 'Administrador'
  ) AND public.mfa_ok() AND NOT public.conta_desativada();
$$;

CREATE OR REPLACE FUNCTION public.my_employee_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.employee_id FROM profiles p
  JOIN employees e ON e.id = p.employee_id
  WHERE p.id = auth.uid() AND p.profile = 'colaborador' AND public.mfa_ok()
    AND NOT public.status_bloqueia_acesso(e.status);
$$;

CREATE OR REPLACE FUNCTION public.colleague_directory()
RETURNS TABLE (
  id UUID,
  name TEXT,
  dept TEXT,
  role TEXT,
  avatar_color TEXT,
  avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, dept, role, avatar_color, avatar_url
  FROM employees
  WHERE status = 'Ativo' AND (public.my_employee_id() IS NOT NULL OR public.is_rh());
$$;

DROP POLICY IF EXISTS "kudos_read_all" ON kudos;
CREATE POLICY "kudos_read_all" ON kudos FOR SELECT TO authenticated
  USING ((SELECT public.my_employee_id()) IS NOT NULL);

DROP POLICY IF EXISTS "onboarding_tasks_read_all" ON onboarding_tasks;
CREATE POLICY "onboarding_tasks_read_all" ON onboarding_tasks FOR SELECT TO authenticated
  USING ((SELECT public.my_employee_id()) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.employees_desligado_limpa_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.status_bloqueia_acesso(NEW.status) AND NOT public.status_bloqueia_acesso(OLD.status) THEN
    DELETE FROM push_subscriptions WHERE employee_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_desligado_limpa_push_trg ON employees;
CREATE TRIGGER employees_desligado_limpa_push_trg
  AFTER UPDATE OF status ON employees
  FOR EACH ROW EXECUTE FUNCTION public.employees_desligado_limpa_push();

DELETE FROM push_subscriptions ps
USING employees e
WHERE e.id = ps.employee_id AND public.status_bloqueia_acesso(e.status);

CREATE OR REPLACE FUNCTION public.report_login_failure(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_hash  TEXT;
  v_uid   UUID;
BEGIN
  IF length(v_email) < 3 OR length(v_email) > 254 THEN
    RETURN;
  END IF;

  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  IF v_uid IS NULL
     AND (SELECT count(*) FROM security_events WHERE kind = 'login_failed' AND created_at > now() - interval '1 hour') >= 5000 THEN
    RETURN;
  END IF;

  v_hash := encode(digest(v_email, 'sha256'), 'hex');

  PERFORM security_insert_event('login_failed', v_uid, v_hash, jsonb_build_object('stage', 'password'), 60);
  PERFORM security_check_login_failures(v_uid, v_hash);
EXCEPTION WHEN others THEN
  RAISE WARNING 'report_login_failure: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.status_bloqueia_acesso(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.status_bloqueia_acesso(TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.conta_desativada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_desativada() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.employees_desligado_limpa_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.colleague_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.colleague_directory() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_rh() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_employee_id() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_login_failure(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_login_failure(TEXT) TO anon, authenticated;
