SELECT nexus_refresh_employees_view();

CREATE OR REPLACE FUNCTION apply_ferias_payroll_event(
  p_employee_id UUID,
  p_mes TEXT,
  p_mes_formatado TEXT,
  p_competencia TEXT,
  p_novos_proventos JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing payslips_decrypted;
  v_proventos JSONB;
  v_total_proventos NUMERIC;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode gerar eventos de folha';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_mes, 0));

  SELECT * INTO v_existing FROM payslips_decrypted WHERE employee_id = p_employee_id AND mes = p_mes;

  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_existing.proventos, '[]'::jsonb)) p WHERE p->>'cod' = '040') THEN
      RETURN;
    END IF;
    v_proventos := COALESCE(v_existing.proventos, '[]'::jsonb) || p_novos_proventos;
    v_total_proventos := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(v_proventos) p);
    UPDATE payslips SET
      proventos = v_proventos::text,
      total_proventos = v_total_proventos::text,
      salario_liquido = (v_total_proventos - COALESCE(v_existing.total_descontos, 0))::text
    WHERE id = v_existing.id;
  ELSE
    v_total_proventos := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(p_novos_proventos) p);
    INSERT INTO payslips (employee_id, mes, mes_formatado, competencia, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
    VALUES (p_employee_id, p_mes, p_mes_formatado, p_competencia, p_novos_proventos::text, '[]', v_total_proventos::text, '0', v_total_proventos::text, 'publicado');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION apply_ferias_payroll_event(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_ferias_payroll_event(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION revert_ferias_payroll_event(p_employee_id UUID, p_mes TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slip payslips_decrypted;
  v_proventos JSONB;
  v_total NUMERIC;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode reverter eventos de folha';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_mes, 0));

  SELECT * INTO v_slip FROM payslips_decrypted WHERE employee_id = p_employee_id AND mes = p_mes;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_proventos := COALESCE(
    (SELECT jsonb_agg(p) FROM jsonb_array_elements(COALESCE(v_slip.proventos, '[]'::jsonb)) p WHERE p->>'cod' NOT IN ('040', '041', '042', '043')),
    '[]'::jsonb
  );

  IF jsonb_array_length(v_proventos) = 0 AND jsonb_array_length(COALESCE(v_slip.descontos, '[]'::jsonb)) = 0 THEN
    DELETE FROM payslips WHERE id = v_slip.id;
    RETURN;
  END IF;

  v_total := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(v_proventos) p);
  UPDATE payslips SET
    proventos = v_proventos::text,
    total_proventos = v_total::text,
    salario_liquido = (v_total - COALESCE(v_slip.total_descontos, 0))::text
  WHERE id = v_slip.id;
END;
$$;

REVOKE ALL ON FUNCTION revert_ferias_payroll_event(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revert_ferias_payroll_event(UUID, TEXT) TO authenticated, service_role;
