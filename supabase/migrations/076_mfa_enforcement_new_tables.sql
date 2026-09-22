DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('public.mfa_ok()') IS NULL THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'performance_reviews',
    'performance_review_competencies',
    'pdi_goals',
    'job_titles',
    'trainings',
    'employee_trainings',
    'disciplinary_actions',
    'medical_leaves'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t);
    EXECUTE format('CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()))', t);
  END LOOP;
END $$;