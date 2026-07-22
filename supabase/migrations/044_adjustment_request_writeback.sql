ALTER TABLE adjustment_requests ADD COLUMN IF NOT EXISTS decided_by_name  TEXT;
ALTER TABLE adjustment_requests ADD COLUMN IF NOT EXISTS decided_by_email TEXT;
ALTER TABLE adjustment_requests ADD COLUMN IF NOT EXISTS decided_at       TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION approve_adjustment_request(
  p_request_id       UUID,
  p_decision         TEXT,
  p_decided_by_name  TEXT DEFAULT NULL,
  p_decided_by_email TEXT DEFAULT NULL
)
RETURNS adjustment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req    adjustment_requests;
  v_col    TEXT;
  v_ts     TIMESTAMPTZ;
  v_exists BOOLEAN;
BEGIN
  IF p_decision NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida: %', p_decision;
  END IF;

  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação';
  END IF;

  SELECT * INTO v_req FROM adjustment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;
  IF v_req.status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta solicitação já foi decidida';
  END IF;

  IF p_decision = 'aprovado' AND v_req.tipo <> 'falta' THEN
    IF v_req.horario IS NULL THEN
      RAISE EXCEPTION 'Solicitação sem horário informado';
    END IF;

    v_col := replace(v_req.tipo, '-', '_'); 
    v_ts := (v_req.date::TEXT || ' ' || v_req.horario::TEXT || ' America/Sao_Paulo')::TIMESTAMPTZ;

    SELECT EXISTS(
      SELECT 1 FROM time_records WHERE employee_id = v_req.employee_id AND date = v_req.date
    ) INTO v_exists;

    IF v_exists THEN
      EXECUTE format(
        'UPDATE time_records SET %I = $1, %I = true, ajustado = true WHERE employee_id = $2 AND date = $3',
        v_col, v_col || '_ajustado'
      ) USING v_ts, v_req.employee_id, v_req.date;
    ELSE
      EXECUTE format(
        'INSERT INTO time_records (employee_id, date, %I, %I, ajustado) VALUES ($1, $2, $3, true, true)',
        v_col, v_col || '_ajustado'
      ) USING v_req.employee_id, v_req.date, v_ts;
    END IF;

    INSERT INTO activity_logs (employee_id, tipo, acao, date, valor_registrado, operator_email, operator_name, operator_profile, justificativa)
    VALUES (
      v_req.employee_id, 'ajuste_ponto', v_req.tipo, v_req.date, v_ts,
      p_decided_by_email, COALESCE(p_decided_by_name, 'RH'), 'Administrador',
      'Ajuste de ponto aprovado: ' || v_req.justificativa
    );
  END IF;

  UPDATE adjustment_requests SET
    status           = p_decision,
    decided_by_name  = p_decided_by_name,
    decided_by_email = p_decided_by_email,
    decided_at       = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_adjustment_request(UUID, TEXT, TEXT, TEXT) TO authenticated;