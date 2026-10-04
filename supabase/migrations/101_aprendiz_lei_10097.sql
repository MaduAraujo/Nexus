ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS contract_end_date DATE,
  ADD COLUMN IF NOT EXISTS aprendiz_fundamental_completo BOOLEAN NOT NULL DEFAULT false;

SELECT nexus_refresh_employees_view();

CREATE OR REPLACE FUNCTION aprendiz_salario_minimo()
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 1621.00::NUMERIC;
$$;

CREATE OR REPLACE FUNCTION aprendiz_jornada_min(p_work_load TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_work_load, '') ~ '^[0-9]+h'
      THEN LEAST(round(substring(p_work_load FROM '^([0-9]+)h')::NUMERIC / 5 * 60)::INT, 480)
    ELSE 360
  END;
$$;

REVOKE ALL ON FUNCTION aprendiz_salario_minimo() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION aprendiz_jornada_min(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION aprendiz_salario_minimo() TO authenticated;
GRANT EXECUTE ON FUNCTION aprendiz_jornada_min(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION employees_aprendiz_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx      TEXT := 'emp:' || NEW.id::TEXT;
  v_nasc     DATE;
  v_pcd      BOOLEAN;
  v_salario  NUMERIC;
  v_idade    INT;
  v_semanal  INT;
  v_teto     INT;
  v_divisor  INT;
  v_piso     NUMERIC;
BEGIN
  IF lower(COALESCE(NEW.contract_type, '')) <> 'aprendiz' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND lower(COALESCE(OLD.contract_type, '')) = 'aprendiz'
     AND NEW.birth_date IS NOT DISTINCT FROM OLD.birth_date
     AND NEW.admission_date IS NOT DISTINCT FROM OLD.admission_date
     AND NEW.contract_end_date IS NOT DISTINCT FROM OLD.contract_end_date
     AND NEW.pcd IS NOT DISTINCT FROM OLD.pcd
     AND NEW.work_load IS NOT DISTINCT FROM OLD.work_load
     AND NEW.aprendiz_fundamental_completo IS NOT DISTINCT FROM OLD.aprendiz_fundamental_completo
     AND NEW.salary IS NOT DISTINCT FROM OLD.salary THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_nasc := left(nexus_unwrap(v_ctx, NEW.birth_date), 10)::DATE;
  EXCEPTION WHEN OTHERS THEN
    v_nasc := NULL;
  END;
  v_pcd := lower(COALESCE(nexus_unwrap(v_ctx, NEW.pcd), 'false')) = 'true';
  BEGIN
    v_salario := nexus_unwrap(v_ctx, NEW.salary)::NUMERIC;
  EXCEPTION WHEN OTHERS THEN
    v_salario := NULL;
  END;

  IF v_nasc IS NULL THEN
    RAISE EXCEPTION 'Informe a data de nascimento do aprendiz (CLT art. 428).' USING ERRCODE = '23514';
  END IF;

  IF NEW.admission_date IS NOT NULL THEN
    v_idade := extract(YEAR FROM age(NEW.admission_date, v_nasc))::INT;
    IF v_idade < 14 THEN
      RAISE EXCEPTION 'O aprendiz precisa ter pelo menos 14 anos na admissão (CLT art. 428).' USING ERRCODE = '23514';
    END IF;
    IF v_idade >= 24 AND NOT v_pcd THEN
      RAISE EXCEPTION 'O aprendiz precisa ter menos de 24 anos na admissão, salvo pessoa com deficiência (CLT art. 428 §5º).' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.contract_end_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data de término do contrato de aprendizagem (CLT art. 428).' USING ERRCODE = '23514';
  END IF;

  IF NEW.admission_date IS NOT NULL THEN
    IF NEW.contract_end_date <= NEW.admission_date THEN
      RAISE EXCEPTION 'O término do contrato de aprendizagem deve ser depois da admissão.' USING ERRCODE = '23514';
    END IF;
    IF NOT v_pcd AND NEW.contract_end_date > (NEW.admission_date + INTERVAL '2 years')::DATE THEN
      RAISE EXCEPTION 'O contrato de aprendizagem não pode passar de 2 anos, salvo pessoa com deficiência (CLT art. 428 §3º).' USING ERRCODE = '23514';
    END IF;
    IF NOT v_pcd AND NEW.contract_end_date >= (v_nasc + INTERVAL '24 years')::DATE THEN
      RAISE EXCEPTION 'O contrato termina depois de o aprendiz completar 24 anos — ajuste o término (CLT art. 433).' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_teto := CASE WHEN NEW.aprendiz_fundamental_completo THEN 480 ELSE 360 END;
  IF COALESCE(NEW.work_load, '') ~ '^[0-9]+h' THEN
    v_semanal := substring(NEW.work_load FROM '^([0-9]+)h')::INT;
  END IF;
  IF NEW.work_load = '12x36' OR (v_semanal IS NOT NULL AND v_semanal::NUMERIC / 5 * 60 > v_teto) THEN
    IF NEW.aprendiz_fundamental_completo THEN
      RAISE EXCEPTION 'A jornada do aprendiz não pode passar de 8 horas por dia, já contando as aulas teóricas (CLT art. 432 §1º).' USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'A jornada do aprendiz não pode passar de 6 horas por dia; até 8 horas só para quem já concluiu o ensino fundamental (CLT art. 432).' USING ERRCODE = '23514';
  END IF;

  IF v_salario > 0 THEN
    v_divisor := round(aprendiz_jornada_min(NEW.work_load)::NUMERIC / 60 * 5 * 5)::INT;
    v_piso := round(aprendiz_salario_minimo() / 220 * v_divisor, 2);
    IF v_salario < v_piso THEN
      RAISE EXCEPTION 'O salário do aprendiz não pode ser menor que o salário mínimo hora proporcional à jornada (R$ %) — CLT art. 428 §2º.',
        replace(to_char(v_piso, 'FM999990.00'), '.', ',') USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employees_aprendiz_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employees_aprendiz_guard_trg ON employees;
CREATE TRIGGER employees_aprendiz_guard_trg
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_aprendiz_guard();

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
  v_estagio BOOLEAN;
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

  SELECT contract_type, work_load, admission_date INTO v_tipo, v_jornada, v_admissao FROM employees WHERE id = NEW.employee_id;

  IF lower(COALESCE(v_tipo, '')) = 'pj' THEN
    IF COALESCE(NEW.abono, false) THEN
      RAISE EXCEPTION 'Contrato PJ não tem abono pecuniário.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.days < 5 THEN
    RAISE EXCEPTION 'O período mínimo de férias é de 5 dias corridos.' USING ERRCODE = '23514';
  END IF;
  v_estagio := lower(COALESCE(v_tipo, '')) IN ('estagio', 'estágio');

  v_motivo := ferias_motivo_inicio_vedado(NEW.start_date, v_tipo, v_jornada);
  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION '%', v_motivo USING ERRCODE = '23514';
  END IF;

  IF v_estagio THEN
    IF COALESCE(NEW.abono, false) THEN
      RAISE EXCEPTION 'Sem abono pecuniário para estágio.' USING ERRCODE = '23514';
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

CREATE OR REPLACE FUNCTION generate_compliance_alerts()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hoje           DATE := (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_emp            RECORD;
  v_alertas        JSONB;
  v_n              INTEGER;
  v_cycle_start    DATE;
  v_cycle_end      DATE;
  v_concessivo     DATE;
  v_used_remaining INTEGER;
  v_expired_days   INTEGER;
  v_pending        INTEGER;
  v_diff_dias      INTEGER;
  v_existed        BOOLEAN;
  v_prev_lido      BOOLEAN;
  v_new_lido       BOOLEAN;
  v_alert_id       UUID;
  v_ctx            TEXT;
  v_nasc           DATE;
  v_pcd            BOOLEAN;
  v_jornada        INTEGER;
  v_dias           INTEGER;
BEGIN
  FOR v_emp IN
    SELECT id, admission_date, contract_type, is_probation, probation_end_date,
           is_aviso_previo, aviso_previo_end_date, work_load, contract_end_date, birth_date, pcd
    FROM employees
    WHERE status IN ('Ativo', 'ativo')
  LOOP
    v_alertas := '[]'::jsonb;

    IF v_emp.admission_date IS NOT NULL AND lower(COALESCE(v_emp.contract_type, '')) NOT IN ('estagio', 'estágio', 'pj') THEN
      v_used_remaining := COALESCE((
        SELECT SUM(days + CASE WHEN abono THEN 10 ELSE 0 END) FROM vacations
        WHERE employee_id = v_emp.id AND status IN ('aprovado', 'concluido')
      ), 0);
      v_expired_days := 0;
      v_n := 0;
      LOOP
        v_cycle_start := (v_emp.admission_date + (v_n || ' years')::interval)::date;
        EXIT WHEN v_cycle_start > v_hoje;
        v_cycle_end := (v_emp.admission_date + ((v_n + 1) || ' years')::interval)::date - 1;
        IF v_cycle_end < v_hoje THEN
          v_pending := GREATEST(0, 30 - LEAST(v_used_remaining, 30));
          v_used_remaining := GREATEST(0, v_used_remaining - 30);
          IF v_pending > 0 THEN
            v_concessivo := (v_cycle_end + INTERVAL '1 year')::date;
            IF v_hoje > v_concessivo THEN
              v_expired_days := v_expired_days + v_pending;
            END IF;
          END IF;
        END IF;
        v_n := v_n + 1;
      END LOOP;
      IF v_expired_days > 0 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'ferias_vencidas', 'nivel', 'critico',
          'titulo', format('%s dia(s) de férias vencidas', v_expired_days),
          'mensagem', format('%s dia(s) de férias vencidas — risco de pagamento em dobro (CLT art. 137).', v_expired_days)
        ));
      END IF;
    END IF;

    IF v_emp.is_probation AND v_emp.probation_end_date IS NOT NULL THEN
      v_diff_dias := v_emp.probation_end_date - v_hoje;
      IF v_diff_dias <= 15 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'fim_experiencia',
          'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
          'titulo', CASE
            WHEN v_diff_dias < 0 THEN format('Experiência vencida há %sd', abs(v_diff_dias))
            WHEN v_diff_dias = 0 THEN 'Experiência vence hoje'
            ELSE format('Experiência vence em %sd', v_diff_dias)
          END
        ));
      END IF;
    END IF;

    IF v_emp.is_aviso_previo AND v_emp.aviso_previo_end_date IS NOT NULL THEN
      v_diff_dias := v_emp.aviso_previo_end_date - v_hoje;
      IF v_diff_dias <= 15 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'aviso_previo',
          'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
          'titulo', CASE
            WHEN v_diff_dias < 0 THEN format('Aviso prévio venceu há %sd — regularizar desligamento', abs(v_diff_dias))
            WHEN v_diff_dias = 0 THEN 'Aviso prévio termina hoje'
            ELSE format('Aviso prévio termina em %sd', v_diff_dias)
          END
        ));
      END IF;
    END IF;

    IF lower(COALESCE(v_emp.contract_type, '')) = 'aprendiz' THEN
      v_ctx := 'emp:' || v_emp.id::TEXT;
      BEGIN
        v_nasc := left(nexus_unwrap(v_ctx, v_emp.birth_date), 10)::DATE;
      EXCEPTION WHEN OTHERS THEN
        v_nasc := NULL;
      END;
      v_pcd := lower(COALESCE(nexus_unwrap(v_ctx, v_emp.pcd), 'false')) = 'true';

      IF v_emp.contract_end_date IS NULL THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'aprendiz_sem_termino', 'nivel', 'critico',
          'titulo', 'Contrato de aprendizagem sem data de término (CLT art. 428)'
        ));
      ELSE
        v_diff_dias := v_emp.contract_end_date - v_hoje;
        IF v_diff_dias <= 30 THEN
          v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
            'tipo', 'aprendiz_termino',
            'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
            'titulo', CASE
              WHEN v_diff_dias < 0 THEN format('Contrato de aprendizagem terminou há %sd — desligar ou recontratar (CLT art. 433)', abs(v_diff_dias))
              WHEN v_diff_dias = 0 THEN 'Contrato de aprendizagem termina hoje'
              ELSE format('Contrato de aprendizagem termina em %sd', v_diff_dias)
            END
          ));
        END IF;
      END IF;

      IF NOT v_pcd AND v_nasc IS NOT NULL THEN
        v_diff_dias := (v_nasc + INTERVAL '24 years')::DATE - v_hoje;
        IF v_diff_dias <= 30 THEN
          v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
            'tipo', 'aprendiz_24_anos',
            'nivel', CASE WHEN v_diff_dias <= 0 THEN 'critico' ELSE 'atencao' END,
            'titulo', CASE
              WHEN v_diff_dias <= 0 THEN 'Aprendiz completou 24 anos — o contrato de aprendizagem se extingue (CLT art. 433)'
              ELSE format('Aprendiz completa 24 anos em %sd — o contrato se extingue (CLT art. 433)', v_diff_dias)
            END
          ));
        END IF;
      END IF;

      v_jornada := aprendiz_jornada_min(v_emp.work_load);
      SELECT count(*) INTO v_dias
        FROM time_records t
       WHERE t.employee_id = v_emp.id
         AND t.date >= v_hoje - 30
         AND t.entrada IS NOT NULL
         AND t.saida IS NOT NULL
         AND (CASE
                WHEN t.saida_almoco IS NOT NULL
                  THEN extract(EPOCH FROM t.saida_almoco - t.entrada) / 60
                       + COALESCE(extract(EPOCH FROM t.saida - t.retorno_almoco) / 60, 0)
                ELSE extract(EPOCH FROM t.saida - t.entrada) / 60
              END) > v_jornada + 10;
      IF v_dias > 0 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'aprendiz_hora_extra', 'nivel', 'critico',
          'titulo', format('Aprendiz passou da jornada em %s dia(s) nos últimos 30 dias — hora extra e compensação são proibidas (CLT art. 432)', v_dias)
        ));
      END IF;

      IF v_nasc IS NOT NULL AND v_hoje < (v_nasc + INTERVAL '18 years')::DATE THEN
        SELECT count(*) INTO v_dias
          FROM time_records t
         WHERE t.employee_id = v_emp.id
           AND t.date >= v_hoje - 30
           AND EXISTS (
             SELECT 1 FROM unnest(ARRAY[t.entrada, t.saida_almoco, t.retorno_almoco, t.saida]) AS m(marca)
              WHERE m.marca IS NOT NULL
                AND (m.marca AT TIME ZONE 'America/Sao_Paulo')::TIME NOT BETWEEN TIME '05:00' AND TIME '22:00'
           );
        IF v_dias > 0 THEN
          v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
            'tipo', 'aprendiz_menor_noturno', 'nivel', 'critico',
            'titulo', format('Aprendiz menor de 18 anos com marcação entre 22h e 5h em %s dia(s) — trabalho noturno é proibido (CLT art. 404)', v_dias)
          ));
        END IF;
      END IF;
    END IF;

    IF jsonb_array_length(v_alertas) > 0 THEN
      SELECT lido INTO v_prev_lido FROM compliance_alerts WHERE employee_id = v_emp.id AND date = v_hoje;
      v_existed := FOUND;

      INSERT INTO compliance_alerts (employee_id, date, alertas, lido)
      VALUES (v_emp.id, v_hoje, v_alertas, false)
      ON CONFLICT (employee_id, date) DO UPDATE
        SET alertas = EXCLUDED.alertas,
            lido = CASE WHEN compliance_alerts.alertas = EXCLUDED.alertas THEN compliance_alerts.lido ELSE false END
      RETURNING id, lido INTO v_alert_id, v_new_lido;

      IF v_new_lido = false AND (NOT v_existed OR v_prev_lido IS DISTINCT FROM false) THEN
        PERFORM notify_alert_push('compliance_alerts', v_alert_id);
      END IF;
    END IF;
  END LOOP;
END;
$$;
