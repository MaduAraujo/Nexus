CREATE OR REPLACE FUNCTION ferias_motivo_inicio_vedado(p_inicio DATE, p_contract_type TEXT, p_work_load TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dia DATE;
  v_i INT;
BEGIN
  IF p_inicio IS NULL OR lower(COALESCE(p_contract_type, '')) IN ('estagio', 'estágio') THEN
    RETURN NULL;
  END IF;
  FOR v_i IN 1..2 LOOP
    v_dia := p_inicio + v_i;
    IF EXISTS (SELECT 1 FROM holidays h WHERE h.date = v_dia AND h.abrangencia IS DISTINCT FROM 'facultativo') THEN
      RETURN format('As férias não podem começar nos 2 dias antes de um feriado (%s) — art. 134 §3º da CLT.', to_char(v_dia, 'DD/MM'));
    END IF;
    IF COALESCE(p_work_load, '') <> '12x36' AND extract(isodow FROM v_dia) = 7 THEN
      RETURN format('As férias não podem começar nos 2 dias antes do descanso semanal (domingo, %s) — art. 134 §3º da CLT.', to_char(v_dia, 'DD/MM'));
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ferias_motivo_inicio_vedado(DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ferias_motivo_inicio_vedado(DATE, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION vacations_regras_colaborador_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_hoje DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_tipo TEXT;
  v_jornada TEXT;
  v_admissao DATE;
  v_estagio_ou_aprendiz BOOLEAN;
  v_motivo TEXT;
  v_anos INT;
  v_ciclo_inicio DATE;
  v_ciclo_fim DATE;
  v_outras INT;
  v_alguma_14 BOOLEAN;
  v_abono_no_ciclo BOOLEAN;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR is_rh() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.days IS DISTINCT FROM OLD.days
       OR NEW.abono IS DISTINCT FROM OLD.abono THEN
      RAISE EXCEPTION 'O período de férias não pode ser alterado depois de pedido. Cancele e faça um novo pedido.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.start_date IS NULL OR NEW.end_date IS NULL OR NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION 'A data de fim das férias deve ser igual ou posterior ao início.' USING ERRCODE = '23514';
  END IF;
  IF NEW.days IS DISTINCT FROM (NEW.end_date - NEW.start_date + 1) THEN
    RAISE EXCEPTION 'A quantidade de dias não confere com o período informado.' USING ERRCODE = '23514';
  END IF;
  IF NEW.start_date < v_hoje + 30 THEN
    RAISE EXCEPTION 'As férias precisam ser pedidas com pelo menos 30 dias de antecedência.' USING ERRCODE = '23514';
  END IF;
  IF NEW.days < 5 THEN
    RAISE EXCEPTION 'O período mínimo de férias é de 5 dias corridos.' USING ERRCODE = '23514';
  END IF;

  SELECT contract_type, work_load, admission_date INTO v_tipo, v_jornada, v_admissao FROM employees WHERE id = NEW.employee_id;
  v_estagio_ou_aprendiz := lower(COALESCE(v_tipo, '')) IN ('estagio', 'estágio', 'aprendiz');

  v_motivo := ferias_motivo_inicio_vedado(NEW.start_date, v_tipo, v_jornada);
  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION '%', v_motivo USING ERRCODE = '23514';
  END IF;

  IF v_estagio_ou_aprendiz THEN
    IF COALESCE(NEW.abono, false) THEN
      RAISE EXCEPTION 'Sem abono pecuniário para estágio ou aprendiz.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF v_admissao IS NULL OR NEW.start_date < v_admissao THEN
    RETURN NEW;
  END IF;

  v_anos := extract(YEAR FROM age(NEW.start_date, v_admissao))::INT;
  v_ciclo_inicio := (v_admissao + make_interval(years => v_anos))::DATE;
  v_ciclo_fim := (v_admissao + make_interval(years => v_anos + 1))::DATE - 1;

  SELECT count(*), COALESCE(bool_or(v.days >= 14), false), COALESCE(bool_or(v.abono), false)
    INTO v_outras, v_alguma_14, v_abono_no_ciclo
    FROM vacations v
   WHERE v.employee_id = NEW.employee_id
     AND v.id IS DISTINCT FROM NEW.id
     AND v.status NOT IN ('recusado', 'cancelado')
     AND v.start_date BETWEEN v_ciclo_inicio AND v_ciclo_fim;

  IF v_outras + 1 > 3 THEN
    RAISE EXCEPTION 'Você já utilizou as 3 frações de férias permitidas neste período aquisitivo (art. 134 §1º da CLT).' USING ERRCODE = '23514';
  END IF;
  IF v_outras + 1 = 3 AND NOT v_alguma_14 AND NEW.days < 14 THEN
    RAISE EXCEPTION 'Ao menos uma fração deve ter 14 dias corridos ou mais (art. 134 §1º da CLT).' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(NEW.abono, false) AND v_abono_no_ciclo THEN
    RAISE EXCEPTION 'O abono já foi pedido neste período aquisitivo.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION vacations_regras_colaborador_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vacations_regras_colaborador_trg ON vacations;
CREATE TRIGGER vacations_regras_colaborador_trg
  BEFORE INSERT OR UPDATE ON vacations
  FOR EACH ROW EXECUTE FUNCTION vacations_regras_colaborador_guard();
