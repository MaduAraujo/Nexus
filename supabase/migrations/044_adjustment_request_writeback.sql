-- Aprovar um adjustment_requests hoje só trocava o status para 'aprovado' (ver
-- alertas.js, executeAction/approve_adjustment) — a correção do horário nunca era
-- escrita de volta em time_records. Ou seja, "aprovar" um ajuste de ponto virava
-- só um rótulo: o registro de ponto errado continuava errado, e o cálculo de
-- banco de horas/rescisão/folha (todos lidos direto de time_records) nunca via a
-- correção. Mesmo padrão de approve_bank_request (migration 020): RPC
-- SECURITY DEFINER que decide e escreve o efeito colateral atomicamente.

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

  -- Só RH decide (mesma regra documentada na migration 035 — o colaborador só cria
  -- a própria solicitação).
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

  -- Justificativa de falta não corrige um horário de ponto (não há o que escrever
  -- em time_records) — só documenta a ausência como justificada.
  IF p_decision = 'aprovado' AND v_req.tipo <> 'falta' THEN
    IF v_req.horario IS NULL THEN
      RAISE EXCEPTION 'Solicitação sem horário informado';
    END IF;

    v_col := replace(v_req.tipo, '-', '_'); -- 'saida-almoco' -> 'saida_almoco' etc.
    -- Domínio fechado pelo CHECK de adjustment_requests.tipo — nunca chega aqui com
    -- valor fora de entrada/saida-almoco/retorno-almoco/saida (falta já foi excluída
    -- acima), então o identificador dinâmico abaixo é seguro.

    -- Horário do formulário (<input type="time">, ponto-colaborador.js) é sempre
    -- local — Brasília não observa horário de verão desde 2019, então o offset fixo
    -- é seguro (mesma premissa da migration 036).
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
