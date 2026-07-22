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

CREATE POLICY "rh_data_access_log_all"        ON data_access_log FOR ALL    USING (is_rh());
CREATE POLICY "colabo_data_access_log_select" ON data_access_log FOR SELECT
  USING (employee_id = my_employee_id());

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