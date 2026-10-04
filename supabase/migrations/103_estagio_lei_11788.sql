ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_end_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS estagio_nivel TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS estagio_obrigatorio BOOLEAN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS estagio_alternancia BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS estagio_supervisor_id UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS estagio_instituicao TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS estagio_avaliacoes JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_estagio_nivel_check') THEN
    ALTER TABLE employees ADD CONSTRAINT employees_estagio_nivel_check
      CHECK (estagio_nivel IS NULL OR estagio_nivel IN ('superior', 'medio_profissional', 'medio', 'especial', 'fundamental_eja'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_estagio_avaliacoes_array') THEN
    ALTER TABLE employees ADD CONSTRAINT employees_estagio_avaliacoes_array
      CHECK (jsonb_typeof(estagio_avaliacoes) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS employees_estagio_supervisor_idx ON employees(estagio_supervisor_id) WHERE estagio_supervisor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION estagio_carga_maxima_semanal(p_nivel TEXT, p_alternancia BOOLEAN)
RETURNS INT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_nivel IN ('especial', 'fundamental_eja') THEN 20
    WHEN COALESCE(p_alternancia, false) THEN 40
    ELSE 30
  END;
$$;

CREATE OR REPLACE FUNCTION estagio_limite_cota(p_quadro INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_quadro, 0) <= 0 THEN 0
    WHEN p_quadro <= 5 THEN 1
    WHEN p_quadro <= 10 THEN 2
    WHEN p_quadro <= 25 THEN 5
    ELSE ceil(p_quadro * 0.2)::INT
  END;
$$;

REVOKE ALL ON FUNCTION estagio_carga_maxima_semanal(TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION estagio_limite_cota(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION estagio_carga_maxima_semanal(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION estagio_limite_cota(INT) TO authenticated;

CREATE OR REPLACE FUNCTION employees_estagio_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx         TEXT := 'emp:' || NEW.id::TEXT;
  v_nascimento  TEXT;
  v_bolsa       TEXT;
  v_pcd         BOOLEAN;
  v_carga       INT;
  v_maxima      INT;
  v_supervisor  RECORD;
  v_supervisionados INT;
  v_quadro      INT;
  v_na_cota     INT;
  v_periodo     JSONB;
  v_entrou_cota BOOLEAN;
BEGIN
  IF lower(COALESCE(NEW.contract_type, '')) NOT IN ('estagio', 'estágio') OR lower(COALESCE(NEW.status, '')) = 'inativo' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND lower(COALESCE(OLD.contract_type, '')) IN ('estagio', 'estágio')
     AND lower(COALESCE(OLD.status, '')) <> 'inativo'
     AND NEW.admission_date IS NOT DISTINCT FROM OLD.admission_date
     AND NEW.work_load IS NOT DISTINCT FROM OLD.work_load
     AND NEW.contract_end_date IS NOT DISTINCT FROM OLD.contract_end_date
     AND NEW.estagio_nivel IS NOT DISTINCT FROM OLD.estagio_nivel
     AND NEW.estagio_obrigatorio IS NOT DISTINCT FROM OLD.estagio_obrigatorio
     AND NEW.estagio_alternancia IS NOT DISTINCT FROM OLD.estagio_alternancia
     AND NEW.estagio_supervisor_id IS NOT DISTINCT FROM OLD.estagio_supervisor_id
     AND NEW.estagio_instituicao IS NOT DISTINCT FROM OLD.estagio_instituicao
     AND NEW.estagio_avaliacoes IS NOT DISTINCT FROM OLD.estagio_avaliacoes
     AND NEW.vale_transporte IS NOT DISTINCT FROM OLD.vale_transporte
     AND nexus_unwrap(v_ctx, NEW.salary::TEXT) IS NOT DISTINCT FROM nexus_unwrap(v_ctx, OLD.salary::TEXT)
     AND nexus_unwrap(v_ctx, NEW.birth_date::TEXT) IS NOT DISTINCT FROM nexus_unwrap(v_ctx, OLD.birth_date::TEXT)
     AND nexus_unwrap(v_ctx, NEW.pcd::TEXT) IS NOT DISTINCT FROM nexus_unwrap(v_ctx, OLD.pcd::TEXT) THEN
    RETURN NEW;
  END IF;

  v_nascimento := nexus_unwrap(v_ctx, NEW.birth_date::TEXT);
  v_bolsa := nexus_unwrap(v_ctx, NEW.salary::TEXT);
  v_pcd := lower(COALESCE(nexus_unwrap(v_ctx, NEW.pcd::TEXT), 'false')) = 'true';

  IF NEW.estagio_nivel IS NULL THEN
    RAISE EXCEPTION 'Informe o nível de ensino do estagiário (Lei 11.788/2008, art. 1º).' USING ERRCODE = '23514';
  END IF;
  IF NEW.estagio_obrigatorio IS NULL THEN
    RAISE EXCEPTION 'Informe se o estágio é obrigatório ou não obrigatório (art. 2º).' USING ERRCODE = '23514';
  END IF;
  IF NULLIF(btrim(COALESCE(NEW.estagio_instituicao, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a instituição de ensino que assina o termo de compromisso (art. 3º, II).' USING ERRCODE = '23514';
  END IF;
  IF NEW.admission_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data de início do estágio.' USING ERRCODE = '23514';
  END IF;
  IF NEW.contract_end_date IS NULL THEN
    RAISE EXCEPTION 'Informe a data de término prevista no termo de compromisso.' USING ERRCODE = '23514';
  END IF;
  IF NEW.contract_end_date < NEW.admission_date THEN
    RAISE EXCEPTION 'O término do estágio deve ser igual ou posterior ao início.' USING ERRCODE = '23514';
  END IF;
  IF NOT v_pcd AND NEW.contract_end_date > (NEW.admission_date + INTERVAL '2 years')::DATE - 1 THEN
    RAISE EXCEPTION 'O estágio não pode passar de 2 anos na mesma empresa, exceto para estagiário com deficiência (art. 11).' USING ERRCODE = '23514';
  END IF;
  IF v_nascimento ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND NEW.admission_date < (left(v_nascimento, 10)::DATE + INTERVAL '16 years')::DATE THEN
    RAISE EXCEPTION 'O estagiário precisa ter pelo menos 16 anos no início do estágio.' USING ERRCODE = '23514';
  END IF;
  IF NEW.estagio_alternancia AND NEW.estagio_nivel IN ('especial', 'fundamental_eja') THEN
    RAISE EXCEPTION 'A jornada de 40 horas só vale para cursos que alternam teoria e prática (art. 10, § 1º).' USING ERRCODE = '23514';
  END IF;

  v_carga := CASE NEW.work_load WHEN '20h' THEN 20 WHEN '30h' THEN 30 WHEN '40h' THEN 40 END;
  IF v_carga IS NULL THEN
    RAISE EXCEPTION 'A carga horária do estágio deve ser de 20h, 30h ou 40h semanais (art. 10).' USING ERRCODE = '23514';
  END IF;
  v_maxima := estagio_carga_maxima_semanal(NEW.estagio_nivel, NEW.estagio_alternancia);
  IF v_carga > v_maxima THEN
    IF v_maxima = 20 THEN
      RAISE EXCEPTION 'Para educação especial e anos finais do fundamental (EJA), o limite é 4h por dia e 20h semanais (art. 10, I).' USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION 'O limite é 6h por dia e 30h semanais; 40h só com alternância entre teoria e prática, fora dos períodos de aula (art. 10).' USING ERRCODE = '23514';
  END IF;

  IF NEW.estagio_supervisor_id IS NULL THEN
    RAISE EXCEPTION 'Indique o supervisor do estágio, um funcionário da área (art. 9º, III).' USING ERRCODE = '23514';
  END IF;
  IF NEW.estagio_supervisor_id = NEW.id THEN
    RAISE EXCEPTION 'O estagiário não pode ser o próprio supervisor.' USING ERRCODE = '23514';
  END IF;
  SELECT id, contract_type, status INTO v_supervisor FROM employees WHERE id = NEW.estagio_supervisor_id;
  IF NOT FOUND OR lower(COALESCE(v_supervisor.status, '')) = 'inativo' THEN
    RAISE EXCEPTION 'O supervisor do estágio precisa ser um funcionário ativo.' USING ERRCODE = '23514';
  END IF;
  IF lower(COALESCE(v_supervisor.contract_type, '')) IN ('estagio', 'estágio') THEN
    RAISE EXCEPTION 'Um estagiário não pode supervisionar outro estagiário (art. 9º, III).' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('estagio_supervisor:' || NEW.estagio_supervisor_id::TEXT, 0));
  SELECT count(*) INTO v_supervisionados
    FROM employees e
   WHERE e.estagio_supervisor_id = NEW.estagio_supervisor_id
     AND e.id <> NEW.id
     AND lower(COALESCE(e.contract_type, '')) IN ('estagio', 'estágio')
     AND lower(COALESCE(e.status, '')) <> 'inativo';
  IF v_supervisionados >= 10 THEN
    RAISE EXCEPTION 'Este supervisor já acompanha 10 estagiários, o máximo permitido (art. 9º, III).' USING ERRCODE = '23514';
  END IF;

  IF NOT NEW.estagio_obrigatorio AND NOT (COALESCE(v_bolsa, '') ~ '^[0-9]+(\.[0-9]+)?$' AND v_bolsa::NUMERIC > 0) THEN
    RAISE EXCEPTION 'No estágio não obrigatório a bolsa é obrigatória (art. 12).' USING ERRCODE = '23514';
  END IF;
  IF NOT NEW.estagio_obrigatorio AND NOT COALESCE(NEW.vale_transporte, false) THEN
    RAISE EXCEPTION 'No estágio não obrigatório o auxílio-transporte é obrigatório (art. 12).' USING ERRCODE = '23514';
  END IF;

  FOR v_periodo IN SELECT * FROM jsonb_array_elements(NEW.estagio_avaliacoes) LOOP
    IF jsonb_typeof(v_periodo) <> 'object'
       OR COALESCE(v_periodo->>'inicio', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR COALESCE(v_periodo->>'fim', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR (v_periodo->>'fim')::DATE < (v_periodo->>'inicio')::DATE THEN
      RAISE EXCEPTION 'Cada período de provas precisa de início e fim, com o fim igual ou posterior ao início.' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  v_entrou_cota := NEW.estagio_nivel IN ('medio', 'especial', 'fundamental_eja')
    AND (TG_OP = 'INSERT'
         OR lower(COALESCE(OLD.contract_type, '')) NOT IN ('estagio', 'estágio')
         OR lower(COALESCE(OLD.status, '')) = 'inativo'
         OR OLD.estagio_nivel IS DISTINCT FROM NEW.estagio_nivel
         OR OLD.estagio_nivel NOT IN ('medio', 'especial', 'fundamental_eja'));
  IF v_entrou_cota THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('estagio_cota', 0));
    SELECT count(*) INTO v_quadro
      FROM employees e
     WHERE e.id <> NEW.id
       AND lower(COALESCE(e.status, '')) <> 'inativo'
       AND lower(COALESCE(e.contract_type, '')) NOT IN ('estagio', 'estágio', 'pj');
    SELECT count(*) INTO v_na_cota
      FROM employees e
     WHERE e.id <> NEW.id
       AND lower(COALESCE(e.status, '')) <> 'inativo'
       AND lower(COALESCE(e.contract_type, '')) IN ('estagio', 'estágio')
       AND e.estagio_nivel IN ('medio', 'especial', 'fundamental_eja');
    IF v_na_cota + 1 > estagio_limite_cota(v_quadro) THEN
      RAISE EXCEPTION 'Limite de estagiários de nível médio/especial/fundamental atingido: com % empregado(s), o máximo é % (art. 17).',
        v_quadro, estagio_limite_cota(v_quadro) USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employees_estagio_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employees_estagio_guard_trg ON employees;
CREATE TRIGGER employees_estagio_guard_trg
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_estagio_guard();

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
  v_meses INT;
  v_recesso INT;
  v_recesso_usado INT;
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

  v_estagio := lower(COALESCE(v_tipo, '')) IN ('estagio', 'estágio');

  v_motivo := ferias_motivo_inicio_vedado(NEW.start_date, v_tipo, v_jornada);
  IF v_motivo IS NOT NULL THEN
    RAISE EXCEPTION '%', v_motivo USING ERRCODE = '23514';
  END IF;

  IF v_estagio THEN
    IF COALESCE(NEW.abono, false) THEN
      RAISE EXCEPTION 'Sem abono pecuniário para estágio.' USING ERRCODE = '23514';
    END IF;
    IF v_admissao IS NULL OR NEW.start_date < v_admissao THEN
      RAISE EXCEPTION 'O recesso só pode começar depois do início do estágio.' USING ERRCODE = '23514';
    END IF;
    v_meses := (extract(YEAR FROM age(NEW.start_date, v_admissao)) * 12 + extract(MONTH FROM age(NEW.start_date, v_admissao)))::INT;
    v_recesso := floor(v_meses * 30 / 12.0)::INT;
    SELECT COALESCE(sum(v.days), 0) INTO v_recesso_usado
      FROM vacations v
     WHERE v.employee_id = NEW.employee_id
       AND v.id IS DISTINCT FROM NEW.id
       AND v.status NOT IN ('recusado', 'cancelado');
    IF NEW.days > v_recesso - v_recesso_usado THEN
      RAISE EXCEPTION 'Recesso insuficiente: até o início pedido você terá % dia(s) de recesso, dos quais % já pedidos ou gozados (2,5 dias por mês completo, Lei 11.788 art. 13).',
        v_recesso, v_recesso_usado USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.days < 5 THEN
    RAISE EXCEPTION 'O período mínimo de férias é de 5 dias corridos.' USING ERRCODE = '23514';
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
  v_ultimo_rel     DATE;
  v_prazo_rel      DATE;
BEGIN
  FOR v_emp IN
    SELECT id, admission_date, contract_type, is_probation, probation_end_date,
           is_aviso_previo, aviso_previo_end_date, work_load, contract_end_date, birth_date, pcd,
           estagio_supervisor_id, estagio_avaliacoes
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

    IF lower(COALESCE(v_emp.contract_type, '')) IN ('estagio', 'estágio') THEN
      v_ctx := 'emp:' || v_emp.id::TEXT;
      v_pcd := lower(COALESCE(nexus_unwrap(v_ctx, v_emp.pcd), 'false')) = 'true';

      IF v_emp.contract_end_date IS NULL THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'estagio_sem_termino', 'nivel', 'critico',
          'titulo', 'Estágio sem data de término no termo de compromisso (Lei 11.788 art. 3º)'
        ));
      ELSE
        v_diff_dias := v_emp.contract_end_date - v_hoje;
        IF v_diff_dias <= 30 THEN
          v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
            'tipo', 'estagio_termino',
            'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
            'titulo', CASE
              WHEN v_diff_dias < 0 THEN format('Estágio terminou há %sd — encerrar ou aditar o termo e emitir o termo de realização (art. 9º, V)', abs(v_diff_dias))
              WHEN v_diff_dias = 0 THEN 'Estágio termina hoje — emitir o termo de realização (art. 9º, V)'
              ELSE format('Estágio termina em %sd — prepare o termo de realização (art. 9º, V)', v_diff_dias)
            END
          ));
        END IF;
      END IF;

      IF NOT v_pcd AND v_emp.admission_date IS NOT NULL THEN
        v_diff_dias := ((v_emp.admission_date + INTERVAL '2 years')::DATE - 1) - v_hoje;
        IF v_diff_dias <= 30 THEN
          v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
            'tipo', 'estagio_2_anos',
            'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
            'titulo', CASE
              WHEN v_diff_dias < 0 THEN 'Estágio passou de 2 anos na empresa — risco de vínculo de emprego (Lei 11.788 arts. 11 e 15)'
              ELSE format('Estágio chega ao limite de 2 anos em %sd (Lei 11.788 art. 11)', v_diff_dias)
            END
          ));
        END IF;
      END IF;

      IF v_emp.estagio_supervisor_id IS NULL THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'estagio_sem_supervisor', 'nivel', 'critico',
          'titulo', 'Estagiário sem supervisor indicado (Lei 11.788 art. 9º, III)'
        ));
      END IF;

      IF v_emp.admission_date IS NOT NULL THEN
        SELECT max(d.created_at AT TIME ZONE 'America/Sao_Paulo')::DATE INTO v_ultimo_rel
          FROM documents d
         WHERE d.employee_id = v_emp.id
           AND d.tipo = 'Relatório de Atividades de Estágio'
           AND COALESCE(d.status, 'pendente') <> 'recusado';
        v_prazo_rel := (GREATEST(v_emp.admission_date, COALESCE(v_ultimo_rel, v_emp.admission_date)) + INTERVAL '6 months')::DATE;
        v_diff_dias := v_prazo_rel - v_hoje;
        IF v_diff_dias <= 15 THEN
          v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
            'tipo', 'estagio_relatorio',
            'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
            'titulo', CASE
              WHEN v_diff_dias < 0 THEN format('Relatório semestral de atividades do estágio atrasado há %sd (art. 9º, VII)', abs(v_diff_dias))
              ELSE format('Relatório semestral de atividades do estágio vence em %sd (art. 9º, VII)', v_diff_dias)
            END
          ));
        END IF;
      END IF;

      v_jornada := CASE v_emp.work_load WHEN '20h' THEN 240 WHEN '40h' THEN 480 ELSE 360 END;
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
              END) > (CASE
                        WHEN EXISTS (
                          SELECT 1 FROM jsonb_array_elements(COALESCE(v_emp.estagio_avaliacoes, '[]'::jsonb)) p
                           WHERE jsonb_typeof(p) = 'object'
                             AND t.date BETWEEN (p->>'inicio')::DATE AND (p->>'fim')::DATE
                        ) THEN round(v_jornada / 2.0)
                        ELSE v_jornada
                      END) + 10;
      IF v_dias > 0 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'estagio_jornada_excedida', 'nivel', 'critico',
          'titulo', format('Estagiário passou da jornada do termo em %s dia(s) nos últimos 30 dias — estágio não admite hora extra (Lei 11.788 art. 10)', v_dias)
        ));
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

SELECT nexus_refresh_employees_view();
