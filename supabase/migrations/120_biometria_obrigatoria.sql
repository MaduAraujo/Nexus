CREATE OR REPLACE FUNCTION biometric_consume_for_punch(p_employee_id UUID, p_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_employee_id IS DISTINCT FROM my_employee_id() THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM biometric_templates WHERE employee_id = p_employee_id) THEN
    RAISE EXCEPTION 'Cadastre sua biometria facial em Meu Ponto antes de registrar o ponto.' USING ERRCODE = '42501';
  END IF;
  UPDATE biometric_verifications
     SET consumed_at = NOW()
   WHERE id = p_token
     AND employee_id = p_employee_id
     AND matched
     AND consumed_at IS NULL
     AND created_at > NOW() - INTERVAL '15 minutes';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION biometric_consume_for_punch(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION biometric_consume_for_punch(UUID, UUID) TO authenticated, service_role;
