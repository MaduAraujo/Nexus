DROP POLICY IF EXISTS "kudos_read_all" ON kudos;
CREATE POLICY "kudos_read_all" ON kudos FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "onboarding_tasks_read_all" ON onboarding_tasks;
CREATE POLICY "onboarding_tasks_read_all" ON onboarding_tasks FOR SELECT TO authenticated USING (true);

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('generate_compliance_alerts', 'dispatch_deferred_pushes', 'notify_alert_push')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('report_daily_overtime_alert', 'approve_bank_request', 'approve_adjustment_request', 'sign_document',
                         'sign_payslip', 'punch_time_record', 'get_or_create_dm', 'anonymize_employee', 'colleague_directory')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;
