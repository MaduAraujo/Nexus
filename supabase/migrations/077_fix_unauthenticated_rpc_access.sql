CREATE OR REPLACE FUNCTION sign_document(p_document_id UUID, p_signer_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id       UUID;
  v_requer_assinatura BOOLEAN;
  v_assinado_em       TIMESTAMPTZ;
BEGIN
  SELECT employee_id, requer_assinatura, assinado_em
    INTO v_employee_id, v_requer_assinatura, v_assinado_em
    FROM documents WHERE id = p_document_id;

  IF v_employee_id IS NULL OR v_employee_id IS DISTINCT FROM my_employee_id() THEN
    RAISE EXCEPTION 'Documento não encontrado ou não pertence ao colaborador autenticado';
  END IF;
  IF NOT v_requer_assinatura THEN
    RAISE EXCEPTION 'Este documento não requer assinatura eletrônica';
  END IF;
  IF v_assinado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Documento já assinado';
  END IF;
  IF p_signer_name IS NULL OR btrim(p_signer_name) = '' THEN
    RAISE EXCEPTION 'Nome do signatário é obrigatório';
  END IF;

  UPDATE documents SET assinado_em = NOW(), assinado_por = btrim(p_signer_name)
  WHERE id = p_document_id;
END;
$$;

CREATE OR REPLACE FUNCTION sign_payslip(p_payslip_id UUID, p_signer_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id UUID;
  v_assinado_em TIMESTAMPTZ;
BEGIN
  SELECT employee_id, assinado_em
    INTO v_employee_id, v_assinado_em
    FROM payslips WHERE id = p_payslip_id;

  IF v_employee_id IS NULL OR v_employee_id IS DISTINCT FROM my_employee_id() THEN
    RAISE EXCEPTION 'Holerite não encontrado ou não pertence ao colaborador autenticado';
  END IF;
  IF v_assinado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Holerite já assinado';
  END IF;
  IF p_signer_name IS NULL OR btrim(p_signer_name) = '' THEN
    RAISE EXCEPTION 'Nome do signatário é obrigatório';
  END IF;

  UPDATE payslips SET assinado_em = NOW(), assinado_por = btrim(p_signer_name)
  WHERE id = p_payslip_id;
END;
$$;

CREATE OR REPLACE FUNCTION colleague_directory()
RETURNS TABLE(id UUID, name TEXT, dept TEXT, role TEXT, avatar_color TEXT, avatar_url TEXT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, dept, role, avatar_color, avatar_url
  FROM employees
  WHERE status = 'Ativo' AND auth.uid() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION job_titles_public()
RETURNS TABLE(id UUID, title TEXT, track TEXT, level TEXT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, title, track, level
  FROM job_titles
  WHERE active = true AND auth.uid() IS NOT NULL
  ORDER BY track NULLS LAST, level NULLS LAST, title;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('generate_compliance_alerts', 'dispatch_deferred_pushes', 'notify_alert_push', 'sync_medical_leave_statuses')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('report_daily_overtime_alert', 'approve_bank_request', 'approve_adjustment_request', 'sign_document',
                         'sign_payslip', 'punch_time_record', 'get_or_create_dm', 'anonymize_employee', 'colleague_directory',
                         'job_titles_public')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;