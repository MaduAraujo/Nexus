ALTER TABLE payslips ADD COLUMN IF NOT EXISTS assinado_em  TIMESTAMPTZ;
ALTER TABLE payslips ADD COLUMN IF NOT EXISTS assinado_por TEXT;

CREATE OR REPLACE FUNCTION sign_payslip(p_payslip_id UUID, p_signer_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id UUID;
  v_assinado_em TIMESTAMPTZ;
BEGIN
  SELECT employee_id, assinado_em
    INTO v_employee_id, v_assinado_em
    FROM payslips WHERE id = p_payslip_id;

  IF v_employee_id IS NULL OR v_employee_id <> my_employee_id() THEN
    RAISE EXCEPTION 'Holerite não encontrado ou não pertence ao colaborador autenticado';
  END IF;
  IF v_assinado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Holerite já assinado';
  END IF;
  IF p_signer_name IS NULL OR btrim(p_signer_name) = '' THEN
    RAISE EXCEPTION 'Nome do signatário é obrigatório';
  END IF;

  UPDATE payslips SET assinado_em = NOW(), assinado_por = btrim(p_signer_name)
  WHERE id = p_payslip_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sign_payslip(UUID, TEXT) TO authenticated;