CREATE POLICY "colabo_hr_settings_select" ON hr_settings FOR SELECT
  USING (my_employee_id() IS NOT NULL);

CREATE OR REPLACE FUNCTION report_daily_overtime_alert(
  p_titulo   TEXT,
  p_mensagem TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id   UUID := my_employee_id();
  v_hoje     DATE := (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_existing burnout_alerts;
  v_alerta   JSONB;
BEGIN
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'Sem colaborador associado ao usuário autenticado';
  END IF;

  v_alerta := jsonb_build_object(
    'tipo', 'excesso_legal_diario', 'nivel', 'critico',
    'titulo', p_titulo, 'mensagem', p_mensagem
  );

  SELECT * INTO v_existing FROM burnout_alerts WHERE employee_id = v_emp_id AND date = v_hoje;

  IF FOUND THEN
    UPDATE burnout_alerts SET alertas = alertas || jsonb_build_array(v_alerta), lido = false
    WHERE id = v_existing.id;
  ELSE
    INSERT INTO burnout_alerts (employee_id, date, alertas, lido)
    VALUES (v_emp_id, v_hoje, jsonb_build_array(v_alerta), false);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION report_daily_overtime_alert(TEXT, TEXT) TO authenticated;