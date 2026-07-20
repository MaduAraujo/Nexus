-- Fluxo de solicitação de banco de horas pelo colaborador (com anexo de atestado) e
-- aprovação em duas etapas para ajustes lançados pelo RH (gestor da área confirma antes
-- de virar um lançamento efetivo em bank_adjustments).

-- Gestor responsável por colaborador (auto-referência). Usado tanto para exibir
-- "gestor" na tela de colaboradores quanto para decidir quem aprova a 2ª etapa.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES employees(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS employees_manager_idx ON employees(manager_id);

-- Sem isso, um colaborador-gestor não conseguiria ver nome/departamento dos seus
-- liderados (nem direto, nem via join a partir de bank_requests) — a policy
-- "colabo_employees_own" só libera a própria linha.
CREATE POLICY "colabo_employees_managed" ON employees FOR SELECT
  USING (manager_id = my_employee_id());

CREATE TABLE IF NOT EXISTS bank_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id            UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  origem                 TEXT NOT NULL CHECK (origem IN ('colaborador','rh')),
  tipo                   TEXT NOT NULL CHECK (tipo IN ('credito','debito')),
  minutos                INTEGER NOT NULL CHECK (minutos > 0),
  date                   DATE NOT NULL,
  justificativa          TEXT NOT NULL,
  anexo_path             TEXT,
  anexo_name             TEXT,
  status                 TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado')),
  requires_approval_from TEXT NOT NULL CHECK (requires_approval_from IN ('gestor','rh')),
  manager_id_snapshot    UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_by_user_id     UUID DEFAULT auth.uid(),
  created_by_name        TEXT,
  created_by_email       TEXT,
  decided_by_name         TEXT,
  decided_by_email        TEXT,
  decided_at              TIMESTAMPTZ,
  decision_obs            TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_requests_emp_idx     ON bank_requests(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bank_requests_manager_idx ON bank_requests(manager_id_snapshot);
CREATE INDEX IF NOT EXISTS bank_requests_status_idx  ON bank_requests(status);

ALTER TABLE bank_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_bankreq_all" ON bank_requests FOR ALL USING (is_rh());

CREATE POLICY "colabo_bankreq_select" ON bank_requests FOR SELECT
  USING (employee_id = my_employee_id() OR manager_id_snapshot = my_employee_id());

CREATE POLICY "colabo_bankreq_insert" ON bank_requests FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND origem = 'colaborador');

-- Aprova ou rejeita uma solicitação. Roda com privilégios do dono (SECURITY DEFINER) para poder
-- inserir em bank_adjustments/activity_logs sem dar ao colaborador-gestor acesso direto a essas
-- tabelas; a autorização real é verificada aqui dentro (é o gestor certo, ou é RH e não é a mesma
-- pessoa que criou uma solicitação que dependia de segunda aprovação do próprio RH).
CREATE OR REPLACE FUNCTION approve_bank_request(
  p_request_id      UUID,
  p_decision        TEXT,
  p_obs             TEXT DEFAULT NULL,
  p_decided_by_name  TEXT DEFAULT NULL,
  p_decided_by_email TEXT DEFAULT NULL
)
RETURNS bank_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req      bank_requests;
  v_is_manager BOOLEAN;
  v_allowed  BOOLEAN := FALSE;
BEGIN
  IF p_decision NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida: %', p_decision;
  END IF;

  SELECT * INTO v_req FROM bank_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;
  IF v_req.status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta solicitação já foi decidida';
  END IF;

  v_is_manager := v_req.requires_approval_from = 'gestor'
    AND v_req.manager_id_snapshot IS NOT NULL
    AND v_req.manager_id_snapshot = my_employee_id();

  IF v_is_manager THEN
    v_allowed := TRUE;
  ELSIF is_rh() THEN
    IF v_req.requires_approval_from = 'rh' AND v_req.created_by_user_id IS NOT NULL AND auth.uid() = v_req.created_by_user_id THEN
      v_allowed := FALSE; -- exige um segundo Administrador diferente de quem lançou
    ELSE
      v_allowed := TRUE;
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação (precisa ser o gestor responsável, ou um segundo Administrador)';
  END IF;

  IF p_decision = 'aprovado' THEN
    INSERT INTO bank_adjustments (employee_id, tipo, minutos, date, justificativa, created_by_name)
    VALUES (
      v_req.employee_id, v_req.tipo, v_req.minutos, v_req.date,
      v_req.justificativa || CASE WHEN v_req.anexo_name IS NOT NULL THEN ' [anexo: ' || v_req.anexo_name || ']' ELSE '' END,
      COALESCE(p_decided_by_name, 'RH')
    );

    INSERT INTO activity_logs (employee_id, tipo, acao, date, minutos, operator_email, operator_name, operator_profile, justificativa)
    VALUES (
      v_req.employee_id, 'ajuste_banco', v_req.tipo, v_req.date, v_req.minutos,
      p_decided_by_email, COALESCE(p_decided_by_name, 'RH'),
      CASE WHEN is_rh() THEN 'Administrador' ELSE 'colaborador' END,
      'Solicitação aprovada (' || v_req.origem || '): ' || v_req.justificativa
    );
  END IF;

  UPDATE bank_requests SET
    status           = p_decision,
    decided_by_name  = p_decided_by_name,
    decided_by_email = p_decided_by_email,
    decided_at       = NOW(),
    decision_obs     = p_obs
  WHERE id = p_request_id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_bank_request(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;
