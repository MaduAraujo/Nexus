-- LGPD: até aqui só existia log de ALTERAÇÃO (employee_audit, document_audit_log,
-- activity_logs) — nenhum registro de quem apenas VISUALIZOU um dado sensível. O art. 37
-- da LGPD pede registro das operações de tratamento, e abrir o perfil completo de um
-- colaborador (CPF, RG, salário, dados bancários, raça/cor), um documento ou uma selfie
-- de ponto é tratamento de dado pessoal (e, no caso de raça/cor, dado sensível — art. 5º
-- II) mesmo sem alterar nada. Esta tabela cobre esse lado que faltava.
CREATE TABLE IF NOT EXISTS data_access_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tipo              TEXT NOT NULL CHECK (tipo IN ('perfil_completo','documento','holerite','selfie_ponto')),
  detalhe           TEXT,
  accessed_by_name  TEXT,
  accessed_by_email TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS data_access_log_emp_idx ON data_access_log(employee_id, created_at DESC);

ALTER TABLE data_access_log ENABLE ROW LEVEL SECURITY;
-- RH grava e consulta tudo. Colaborador só lê o próprio (transparência — art. 9º/18 LGPD:
-- o titular tem direito de saber quem acessou seus dados).
CREATE POLICY "rh_data_access_log_all"        ON data_access_log FOR ALL    USING (is_rh());
CREATE POLICY "colabo_data_access_log_select" ON data_access_log FOR SELECT
  USING (employee_id = my_employee_id());

-- Anonimização a pedido do titular (LGPD art. 18, VI). Só para colaboradores já
-- desligados: o registro em si precisa sobreviver (folha/ponto têm prazo legal de guarda
-- — ver retido_ate em documents, migration 014), mas os identificadores diretos e dados
-- sensíveis são sobrescritos. SECURITY DEFINER porque o colaborador nunca tem UPDATE em
-- employees (só is_rh() tem, via rh_employees_all) — a autorização real é checada aqui.
CREATE OR REPLACE FUNCTION anonymize_employee(
  p_employee_id         UUID,
  p_anonymized_by_name  TEXT DEFAULT NULL,
  p_anonymized_by_email TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp   employees;
  v_label TEXT;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode anonimizar dados de um colaborador';
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado';
  END IF;
  IF v_emp.status <> 'Inativo' THEN
    RAISE EXCEPTION 'Só é possível anonimizar colaboradores desligados (status Inativo)';
  END IF;
  IF v_emp.cpf LIKE 'ANONIMIZADO-%' THEN
    RAISE EXCEPTION 'Este colaborador já teve os dados anonimizados';
  END IF;

  v_label := 'Ex-colaborador ' || substr(p_employee_id::text, 1, 8);

  UPDATE employees SET
    name             = v_label,
    cpf              = 'ANONIMIZADO-' || substr(p_employee_id::text, 1, 8),
    rg               = NULL,
    telefone         = NULL,
    email            = substr(p_employee_id::text, 1, 8) || '@anonimizado.local',
    birth_date       = NULL,
    gender           = NULL,
    raca_cor         = NULL,
    deficiencia      = NULL,
    chave_pix        = NULL,
    tipo_chave_pix   = NULL,
    banco            = NULL,
    tipo_conta       = NULL,
    agencia          = NULL,
    conta            = NULL,
    avatar_url       = NULL,
    bio              = NULL,
    auth_user_id     = NULL
  WHERE id = p_employee_id;

  INSERT INTO employee_audit (employee_id, changes, operator_name, operator_email)
  VALUES (
    p_employee_id,
    jsonb_build_array(jsonb_build_object(
      'field', 'lgpd_anonimizacao', 'label', 'Dados anonimizados a pedido do titular (LGPD art. 18, VI)',
      'oldValue', v_emp.name, 'newValue', v_label
    )),
    COALESCE(p_anonymized_by_name, 'RH'), p_anonymized_by_email
  );
END;
$$;

GRANT EXECUTE ON FUNCTION anonymize_employee(UUID, TEXT, TEXT) TO authenticated;
