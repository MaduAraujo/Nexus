CREATE OR REPLACE FUNCTION payslips_pago_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR OLD.status IS DISTINCT FROM 'pago' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Holerite de % já pago não pode ser excluído.', OLD.mes USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM 'pago'
     OR NEW.proventos IS DISTINCT FROM OLD.proventos
     OR NEW.descontos IS DISTINCT FROM OLD.descontos
     OR NEW.total_proventos IS DISTINCT FROM OLD.total_proventos
     OR NEW.total_descontos IS DISTINCT FROM OLD.total_descontos
     OR NEW.salario_liquido IS DISTINCT FROM OLD.salario_liquido
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.mes IS DISTINCT FROM OLD.mes THEN
    RAISE EXCEPTION 'Holerite de % já pago não pode ser alterado: lance a diferença em folha complementar.', OLD.mes USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION payslips_pago_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payslips_0_pago_guard_trg ON payslips;
CREATE TRIGGER payslips_0_pago_guard_trg
  BEFORE UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION payslips_pago_guard();

ALTER TABLE time_records ADD COLUMN IF NOT EXISTS offline_steps TEXT[] NOT NULL DEFAULT '{}';

DROP FUNCTION IF EXISTS punch_time_record(DATE, TEXT, JSONB, TEXT, UUID);

CREATE OR REPLACE FUNCTION punch_time_record(
  p_date            DATE,
  p_step            TEXT,
  p_loc             JSONB DEFAULT NULL,
  p_selfie_path     TEXT DEFAULT NULL,
  p_biometric_token UUID DEFAULT NULL,
  p_marcado_em      TIMESTAMPTZ DEFAULT NULL
)
RETURNS time_records
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_employee_id UUID := my_employee_id();
  v_result      time_records;
  v_quando      TIMESTAMPTZ := now();
  v_offline     BOOLEAN := p_marcado_em IS NOT NULL;
  v_inicio_dia  TIMESTAMPTZ := p_date::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo';
  v_existente   TIMESTAMPTZ;
BEGIN
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Usuário autenticado não é um colaborador com ponto habilitado';
  END IF;
  IF p_step NOT IN ('entrada', 'saida_almoco', 'retorno_almoco', 'saida') THEN
    RAISE EXCEPTION 'Etapa de ponto inválida: %', p_step;
  END IF;
  IF v_offline THEN
    IF p_marcado_em > now() + INTERVAL '2 minutes' THEN
      RAISE EXCEPTION 'O horário do registro offline está no futuro: confira o relógio do aparelho.' USING ERRCODE = '22007';
    END IF;
    IF p_marcado_em < v_inicio_dia OR p_marcado_em >= v_inicio_dia + INTERVAL '1 day 6 hours' THEN
      RAISE EXCEPTION 'O horário do registro offline não pertence ao dia %.', to_char(p_date, 'DD/MM/YYYY') USING ERRCODE = '22007';
    END IF;
    v_quando := least(p_marcado_em, now());
  END IF;
  IF NOT biometric_consume_for_punch(v_employee_id, p_biometric_token) THEN
    RAISE EXCEPTION 'Verificação facial ausente ou expirada. Tire a selfie novamente.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO time_records (employee_id, date)
  VALUES (v_employee_id, p_date)
  ON CONFLICT (employee_id, date) DO NOTHING;

  SELECT CASE p_step
           WHEN 'entrada' THEN entrada
           WHEN 'saida_almoco' THEN saida_almoco
           WHEN 'retorno_almoco' THEN retorno_almoco
           ELSE saida
         END
    INTO v_existente
    FROM time_records
   WHERE employee_id = v_employee_id AND date = p_date
   FOR UPDATE;
  IF v_existente IS NOT NULL THEN
    RAISE EXCEPTION 'Esta marcação (%) já foi registrada às %.', p_step, to_char(v_existente AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')
      USING ERRCODE = '23505';
  END IF;

  IF p_step = 'entrada' THEN
    UPDATE time_records SET entrada = v_quando, entrada_loc = p_loc, entrada_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSIF p_step = 'saida_almoco' THEN
    UPDATE time_records SET saida_almoco = v_quando, saida_almoco_loc = p_loc, saida_almoco_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSIF p_step = 'retorno_almoco' THEN
    UPDATE time_records SET retorno_almoco = v_quando, retorno_almoco_loc = p_loc, retorno_almoco_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSE
    UPDATE time_records SET saida = v_quando, saida_loc = p_loc, saida_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  END IF;

  IF v_offline THEN
    UPDATE time_records SET offline_steps = array_append(offline_steps, p_step)
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION punch_time_record(DATE, TEXT, JSONB, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION punch_time_record(DATE, TEXT, JSONB, TEXT, UUID, TIMESTAMPTZ) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION bank_adjustments_folha_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR OLD.created_by_name IS DISTINCT FROM 'Folha de pagamento' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
     OR NEW.minutos IS DISTINCT FROM OLD.minutos OR NEW.tipo IS DISTINCT FROM OLD.tipo OR NEW.date IS DISTINCT FROM OLD.date THEN
    RAISE EXCEPTION 'Este débito foi lançado pela folha ao pagar horas extras do banco vencido e não pode ser excluído nem alterado: as horas já foram pagas.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION bank_adjustments_folha_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bank_adjustments_folha_guard_trg ON bank_adjustments;
CREATE TRIGGER bank_adjustments_folha_guard_trg
  BEFORE UPDATE OR DELETE ON bank_adjustments
  FOR EACH ROW EXECUTE FUNCTION bank_adjustments_folha_guard();
