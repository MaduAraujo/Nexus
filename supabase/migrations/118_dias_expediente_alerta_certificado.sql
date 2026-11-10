ALTER TABLE employees ADD COLUMN IF NOT EXISTS expediente_dias SMALLINT[];
ALTER TABLE employees ADD COLUMN IF NOT EXISTS escala_12x36_inicio DATE;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_expediente_dias_check;
ALTER TABLE employees ADD CONSTRAINT employees_expediente_dias_check CHECK (
  expediente_dias IS NULL
  OR (cardinality(expediente_dias) BETWEEN 1 AND 7 AND expediente_dias <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[])
);

ALTER TABLE convencoes_coletivas ADD COLUMN IF NOT EXISTS expediente_dias SMALLINT[];
ALTER TABLE convencoes_coletivas DROP CONSTRAINT IF EXISTS convencoes_coletivas_expediente_dias_check;
ALTER TABLE convencoes_coletivas ADD CONSTRAINT convencoes_coletivas_expediente_dias_check CHECK (
  expediente_dias IS NULL
  OR (cardinality(expediente_dias) BETWEEN 1 AND 7 AND expediente_dias <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::SMALLINT[])
);

SELECT nexus_refresh_employees_view();

CREATE INDEX IF NOT EXISTS employee_trainings_validade_idx
  ON employee_trainings (employee_id, certificado_valido_ate)
  WHERE status = 'concluido' AND certificado_valido_ate IS NOT NULL;

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
  v_cert           RECORD;
BEGIN
  FOR v_emp IN
    SELECT id, admission_date, contract_type, is_probation, probation_end_date,
           is_aviso_previo, aviso_previo_end_date, work_load, contract_end_date, birth_date, pcd,
           estagio_supervisor_id, estagio_avaliacoes
    FROM employees
    WHERE status IN ('Ativo', 'ativo')
  LOOP
    v_alertas := '[]'::jsonb;

    IF v_emp.admission_date IS NOT NULL AND lower(COALESCE(v_emp.contract_type, '')) NOT IN ('estagio', 'estágio', 'pj', 'temporário', 'temporario') THEN
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

    IF lower(COALESCE(v_emp.contract_type, '')) IN ('temporário', 'temporario') THEN
      IF v_emp.contract_end_date IS NULL THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'temporario_sem_termino', 'nivel', 'critico',
          'titulo', 'Temporário sem data de término do contrato (Lei 6.019/1974, art. 10)'
        ));
      ELSE
        v_diff_dias := v_emp.contract_end_date - v_hoje;
        IF v_diff_dias <= 30 THEN
          v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
            'tipo', 'temporario_termino',
            'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
            'titulo', CASE
              WHEN v_diff_dias < 0 THEN format('Contrato temporário terminou há %sd e o trabalhador segue ativo — risco de vínculo direto com a empresa (Lei 6.019, art. 10)', abs(v_diff_dias))
              WHEN v_diff_dias = 0 THEN 'Contrato temporário termina hoje — combine o encerramento com a agência'
              ELSE format('Contrato temporário termina em %sd — combine com a agência o encerramento ou a prorrogação (até 270 dias no total)', v_diff_dias)
            END
          ));
        END IF;
      END IF;
    END IF;

    IF lower(COALESCE(v_emp.contract_type, '')) = 'prazo determinado' THEN
      IF v_emp.contract_end_date IS NULL THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'prazo_sem_termino', 'nivel', 'critico',
          'titulo', 'Contrato por prazo determinado sem data de término (CLT art. 443)'
        ));
      ELSE
        v_diff_dias := v_emp.contract_end_date - v_hoje;
        IF v_diff_dias <= 30 THEN
          v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
            'tipo', 'prazo_termino',
            'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
            'titulo', CASE
              WHEN v_diff_dias < 0 THEN format('Contrato por prazo determinado terminou há %sd e a pessoa segue trabalhando — ele passa a valer por prazo indeterminado (CLT art. 451)', abs(v_diff_dias))
              WHEN v_diff_dias = 0 THEN 'Contrato por prazo determinado termina hoje'
              ELSE format('Contrato por prazo determinado termina em %sd — desligar no prazo ou efetivar', v_diff_dias)
            END
          ));
        END IF;
      END IF;
    END IF;

    FOR v_cert IN
      SELECT et.title, et.certificado_valido_ate - v_hoje AS dias
        FROM employee_trainings et
       WHERE et.employee_id = v_emp.id
         AND et.status = 'concluido'
         AND et.certificado_valido_ate IS NOT NULL
         AND et.certificado_valido_ate <= v_hoje + 30
         AND NOT EXISTS (
           SELECT 1 FROM employee_trainings n
            WHERE n.employee_id = et.employee_id
              AND n.id <> et.id
              AND n.status = 'concluido'
              AND (n.training_id = et.training_id OR lower(trim(n.title)) = lower(trim(et.title)))
              AND COALESCE(n.certificado_valido_ate, 'infinity'::DATE) > et.certificado_valido_ate
              AND (n.completion_date IS NULL OR et.completion_date IS NULL OR n.completion_date >= et.completion_date)
         )
       ORDER BY et.certificado_valido_ate, et.title
    LOOP
      v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
        'tipo', 'certificado_validade',
        'nivel', CASE WHEN v_cert.dias < 0 THEN 'critico' ELSE 'atencao' END,
        'titulo', CASE
          WHEN v_cert.dias < 0 THEN format('Certificado de "%s" venceu há %sd — providencie a reciclagem', v_cert.title, abs(v_cert.dias))
          WHEN v_cert.dias = 0 THEN format('Certificado de "%s" vence hoje — providencie a reciclagem', v_cert.title)
          ELSE format('Certificado de "%s" vence em %sd — programe a reciclagem', v_cert.title, v_cert.dias)
        END
      ));
    END LOOP;

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
