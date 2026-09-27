CREATE OR REPLACE FUNCTION apply_ferias_recibo(
  p_employee_id   UUID,
  p_mes           TEXT,
  p_mes_formatado TEXT,
  p_competencia   TEXT,
  p_proventos     JSONB,
  p_descontos     JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_proventos NUMERIC;
  v_total_descontos NUMERIC;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode gerar recibo de férias';
  END IF;
  IF p_mes !~ '^[0-9]{4}-[0-9]{2}-F[0-9]{2}$' THEN
    RAISE EXCEPTION 'Chave de recibo de férias inválida: %', p_mes USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_proventos) p WHERE p->>'cod' IN ('040', '041') AND (p->>'valor')::NUMERIC > 0)
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_descontos, '[]'::jsonb)) d WHERE d->>'cod' = '901' AND (d->>'valor')::NUMERIC > 0) THEN
    RAISE EXCEPTION 'Recibo de férias sem desconto de INSS não pode ser emitido.' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_mes, 0));
  IF EXISTS (SELECT 1 FROM payslips WHERE employee_id = p_employee_id AND mes = p_mes) THEN
    RETURN;
  END IF;

  v_total_proventos := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(p_proventos) p);
  v_total_descontos := (SELECT COALESCE(SUM((d->>'valor')::numeric), 0) FROM jsonb_array_elements(COALESCE(p_descontos, '[]'::jsonb)) d);
  INSERT INTO payslips (employee_id, mes, mes_formatado, competencia, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
  VALUES (p_employee_id, p_mes, p_mes_formatado, p_competencia, p_proventos::text, COALESCE(p_descontos, '[]'::jsonb)::text,
          v_total_proventos::text, v_total_descontos::text, (v_total_proventos - v_total_descontos)::text, 'publicado');
END;
$$;

REVOKE ALL ON FUNCTION apply_ferias_recibo(UUID, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_ferias_recibo(UUID, TEXT, TEXT, TEXT, JSONB, JSONB) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION revert_ferias_recibo(p_employee_id UUID, p_mes TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode cancelar recibo de férias';
  END IF;
  IF p_mes !~ '^[0-9]{4}-[0-9]{2}-F[0-9]{2}$' THEN
    RAISE EXCEPTION 'Chave de recibo de férias inválida: %', p_mes USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_mes, 0));
  IF EXISTS (SELECT 1 FROM payslips WHERE employee_id = p_employee_id AND mes = p_mes AND status = 'pago') THEN
    RAISE EXCEPTION 'O recibo de férias de % já foi pago: o estorno é feito na rescisão ou em folha complementar.', p_mes USING ERRCODE = '55000';
  END IF;
  DELETE FROM payslips WHERE employee_id = p_employee_id AND mes = p_mes;
END;
$$;

REVOKE ALL ON FUNCTION revert_ferias_recibo(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revert_ferias_recibo(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION generate_compliance_alerts()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje           DATE := (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_emp            RECORD;
  v_alertas        JSONB;
  v_n              INTEGER;
  v_cycle_start    DATE;
  v_cycle_end      DATE;
  v_concessivo     DATE;
  v_used_remaining INTEGER;
  v_expired_days   INTEGER;
  v_pending        INTEGER;
  v_diff_dias      INTEGER;
  v_existed        BOOLEAN;
  v_prev_lido      BOOLEAN;
  v_new_lido       BOOLEAN;
  v_alert_id       UUID;
BEGIN
  FOR v_emp IN
    SELECT id, admission_date, contract_type, is_probation, probation_end_date,
           is_aviso_previo, aviso_previo_end_date
    FROM employees
    WHERE status IN ('Ativo', 'ativo')
  LOOP
    v_alertas := '[]'::jsonb;

    IF v_emp.admission_date IS NOT NULL AND COALESCE(v_emp.contract_type, '') NOT IN ('estagio', 'estágio', 'aprendiz') THEN
      v_used_remaining := COALESCE((
        SELECT SUM(days + CASE WHEN abono THEN 10 ELSE 0 END) FROM vacations
        WHERE employee_id = v_emp.id AND status IN ('aprovado', 'concluido')
      ), 0);
      v_expired_days := 0;
      v_n := 0;
      LOOP
        v_cycle_start := (v_emp.admission_date + (v_n || ' years')::interval)::date;
        EXIT WHEN v_cycle_start > v_hoje;
        v_cycle_end := (v_emp.admission_date + ((v_n + 1) || ' years')::interval)::date - 1;
        IF v_cycle_end < v_hoje THEN
          v_pending := GREATEST(0, 30 - LEAST(v_used_remaining, 30));
          v_used_remaining := GREATEST(0, v_used_remaining - 30);
          IF v_pending > 0 THEN
            v_concessivo := (v_cycle_end + INTERVAL '1 year')::date;
            IF v_hoje > v_concessivo THEN
              v_expired_days := v_expired_days + v_pending;
            END IF;
          END IF;
        END IF;
        v_n := v_n + 1;
      END LOOP;
      IF v_expired_days > 0 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'ferias_vencidas', 'nivel', 'critico',
          'titulo', format('%s dia(s) de férias vencidas', v_expired_days),
          'mensagem', format('%s dia(s) de férias vencidas — risco de pagamento em dobro (CLT art. 137).', v_expired_days)
        ));
      END IF;
    END IF;

    IF v_emp.is_probation AND v_emp.probation_end_date IS NOT NULL THEN
      v_diff_dias := v_emp.probation_end_date - v_hoje;
      IF v_diff_dias <= 15 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'fim_experiencia',
          'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
          'titulo', CASE
            WHEN v_diff_dias < 0 THEN format('Experiência vencida há %sd', abs(v_diff_dias))
            WHEN v_diff_dias = 0 THEN 'Experiência vence hoje'
            ELSE format('Experiência vence em %sd', v_diff_dias)
          END
        ));
      END IF;
    END IF;

    IF v_emp.is_aviso_previo AND v_emp.aviso_previo_end_date IS NOT NULL THEN
      v_diff_dias := v_emp.aviso_previo_end_date - v_hoje;
      IF v_diff_dias <= 15 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'aviso_previo',
          'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
          'titulo', CASE
            WHEN v_diff_dias < 0 THEN format('Aviso prévio venceu há %sd — regularizar desligamento', abs(v_diff_dias))
            WHEN v_diff_dias = 0 THEN 'Aviso prévio termina hoje'
            ELSE format('Aviso prévio termina em %sd', v_diff_dias)
          END
        ));
      END IF;
    END IF;

    IF jsonb_array_length(v_alertas) > 0 THEN
      SELECT lido INTO v_prev_lido FROM compliance_alerts WHERE employee_id = v_emp.id AND date = v_hoje;
      v_existed := FOUND;

      INSERT INTO compliance_alerts (employee_id, date, alertas, lido)
      VALUES (v_emp.id, v_hoje, v_alertas, false)
      ON CONFLICT (employee_id, date) DO UPDATE
        SET alertas = EXCLUDED.alertas,
            lido = CASE WHEN compliance_alerts.alertas = EXCLUDED.alertas THEN compliance_alerts.lido ELSE false END
      RETURNING id, lido INTO v_alert_id, v_new_lido;

      IF v_new_lido = false AND (NOT v_existed OR v_prev_lido IS DISTINCT FROM false) THEN
        PERFORM notify_alert_push('compliance_alerts', v_alert_id);
      END IF;
    END IF;
  END LOOP;
END;
$$;
