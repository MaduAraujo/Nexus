CREATE OR REPLACE FUNCTION public.mfa_ok()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'aal', '') = 'aal2' THEN
    RETURN TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified') THEN
    RETURN FALSE;
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.profile = 'Administrador');
END;
$$;

REVOKE ALL ON FUNCTION public.mfa_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_ok() TO authenticated;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relname <> 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t.relname);
    EXECUTE format('CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()))', t.relname);
  END LOOP;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS mfa_required ON storage.objects;
    CREATE POLICY mfa_required ON storage.objects AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()));
  END IF;
END $$;