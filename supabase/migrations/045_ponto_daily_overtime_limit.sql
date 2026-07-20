-- Limite legal de horas extras diárias (CLT art. 59, §1º) só bloqueava no lançamento
-- manual do RH (banco-horas-rh.js, submitAdjust) — o próprio ato de bater "Saída" em
-- ponto-colaborador.js não sabia do limite, e o excesso só aparecia depois como badge
-- "Excesso 2h+" em banco-horas-rh.js, quando o RH abrisse aquela tela por conta própria.
--
-- Não dá para "bloquear" um horário de saída real (falsificar o ponto para esconder
-- excesso é ilegal) — em vez disso, o colaborador precisa registrar o ato do ponto: ao
-- confirmar uma saída que ultrapassaria o limite, uma justificativa obrigatória é
-- exigida na hora (ver confirmarRegistro em ponto-colaborador.js) e o RH é notificado
-- de imediato via burnout_alerts, em vez de só descobrir depois olhando a tabela.

-- ponto-colaborador.js precisa ler o limite configurado pelo RH para avisar/exigir
-- justificativa no momento certo. Só SELECT — edição continua exclusiva do RH
-- (rh_hr_settings_all, FOR ALL). Mesmo padrão de colabo_holidays_select (migration 019).
CREATE POLICY "colabo_hr_settings_select" ON hr_settings FOR SELECT
  USING (my_employee_id() IS NOT NULL);

-- Colaborador não tem INSERT/UPDATE em burnout_alerts (só rh_burnout_all e
-- colabo_burnout_own FOR SELECT) — esta RPC concentra a escrita, restrita à própria
-- linha do dia do colaborador autenticado, sem abrir a tabela inteira.
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
