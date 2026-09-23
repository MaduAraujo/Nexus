ALTER TABLE employees ADD COLUMN IF NOT EXISTS afastado_by_medical_leave_id UUID REFERENCES medical_leaves(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION medical_leaves_apply_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aprovado' AND NEW.start_date <= CURRENT_DATE AND NEW.end_date >= CURRENT_DATE THEN
    UPDATE employees SET status = 'Afastado', afastado_by_medical_leave_id = NEW.id
    WHERE id = NEW.employee_id AND status = 'Ativo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sync_medical_leave_statuses()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE employees e
  SET status = 'Afastado', afastado_by_medical_leave_id = ml.id
  FROM medical_leaves ml
  WHERE e.status = 'Ativo'
    AND ml.employee_id = e.id AND ml.status = 'aprovado'
    AND ml.start_date <= CURRENT_DATE AND ml.end_date >= CURRENT_DATE;
  UPDATE employees e
  SET status = 'Ativo', afastado_by_medical_leave_id = NULL
  FROM medical_leaves ml
  WHERE e.status = 'Afastado'
    AND e.afastado_by_medical_leave_id = ml.id
    AND ml.end_date < CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1 FROM medical_leaves ml2
      WHERE ml2.employee_id = e.id AND ml2.status = 'aprovado'
        AND ml2.start_date <= CURRENT_DATE AND ml2.end_date >= CURRENT_DATE
    )
    AND NOT EXISTS (
      SELECT 1 FROM vacations v
      WHERE v.employee_id = e.id AND v.status = 'aprovado'
        AND v.start_date <= CURRENT_DATE AND v.end_date >= CURRENT_DATE
    );
END;
$$;

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
  v_existing payslips;
  v_proventos JSONB;
  v_total_proventos NUMERIC;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode gerar eventos de folha';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_mes, 0));

  SELECT * INTO v_existing FROM payslips WHERE employee_id = p_employee_id AND mes = p_mes;

  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_existing.proventos) p WHERE p->>'cod' = '040') THEN
      RETURN; 
    END IF;
    v_proventos := v_existing.proventos || p_novos_proventos;
    v_total_proventos := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(v_proventos) p);
    UPDATE payslips SET
      proventos = v_proventos,
      total_proventos = v_total_proventos,
      salario_liquido = v_total_proventos - COALESCE(total_descontos, 0)
    WHERE id = v_existing.id;
  ELSE
    v_total_proventos := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(p_novos_proventos) p);
    INSERT INTO payslips (employee_id, mes, mes_formatado, competencia, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
    VALUES (p_employee_id, p_mes, p_mes_formatado, p_competencia, p_novos_proventos, '[]'::jsonb, v_total_proventos, 0, v_total_proventos, 'publicado');
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
  v_slip payslips;
  v_proventos JSONB;
  v_total NUMERIC;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode reverter eventos de folha';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_mes, 0));

  SELECT * INTO v_slip FROM payslips WHERE employee_id = p_employee_id AND mes = p_mes;
  IF NOT FOUND THEN
    RETURN; 
  END IF;

  v_proventos := COALESCE(
    (SELECT jsonb_agg(p) FROM jsonb_array_elements(v_slip.proventos) p WHERE p->>'cod' NOT IN ('040', '041', '042', '043')),
    '[]'::jsonb
  );

  IF jsonb_array_length(v_proventos) = 0 AND jsonb_array_length(COALESCE(v_slip.descontos, '[]'::jsonb)) = 0 THEN
    DELETE FROM payslips WHERE id = v_slip.id;
    RETURN;
  END IF;

  v_total := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(v_proventos) p);
  UPDATE payslips SET
    proventos = v_proventos,
    total_proventos = v_total,
    salario_liquido = v_total - COALESCE(v_slip.total_descontos, 0)
  WHERE id = v_slip.id;
END;
$$;

REVOKE ALL ON FUNCTION revert_ferias_payroll_event(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revert_ferias_payroll_event(UUID, TEXT) TO authenticated, service_role;