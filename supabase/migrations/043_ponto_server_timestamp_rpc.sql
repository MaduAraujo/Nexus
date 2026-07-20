-- syncPunch() (ponto-colaborador.js) fazia UPSERT direto em time_records passando
-- new Date().toISOString() do dispositivo como o horário do registro — bastava mudar a
-- hora do celular para forjar entrada/saída mais cedo ou mais tarde, sem nenhuma
-- verificação server-side. As migrations 036 (janela de data) e a selfie de prova (042) já
-- reduziam a superfície de fraude, mas o timestamp em si continuava 100% confiável no
-- cliente.
--
-- punch_time_record() move a gravação do horário para o servidor: o valor persistido em
-- time_records.{step} é sempre now() do Postgres, nunca um parâmetro vindo do app. O
-- cliente só informa QUAL etapa está sendo batida (entrada/saida_almoco/retorno_almoco/
-- saida), não QUANDO.
--
-- SECURITY INVOKER (padrão, não DEFINER) de propósito: a função roda com o privilégio de
-- quem chama, então o INSERT/UPDATE internos continuam passando pelas RLS policies de
-- colabo_time_insert_own / colabo_time_update_own (migration 036) normalmente — a janela
-- de tolerância de 1 dia para sincronização offline continua valendo, só o timestamp deixou
-- de ser confiável no cliente.

CREATE OR REPLACE FUNCTION punch_time_record(
  p_date         DATE,
  p_step         TEXT,
  p_loc          JSONB DEFAULT NULL,
  p_selfie_path  TEXT DEFAULT NULL
)
RETURNS time_records
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_employee_id UUID := my_employee_id();
  v_result      time_records;
BEGIN
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Usuário autenticado não é um colaborador com ponto habilitado';
  END IF;
  IF p_step NOT IN ('entrada', 'saida_almoco', 'retorno_almoco', 'saida') THEN
    RAISE EXCEPTION 'Etapa de ponto inválida: %', p_step;
  END IF;

  INSERT INTO time_records (employee_id, date)
  VALUES (v_employee_id, p_date)
  ON CONFLICT (employee_id, date) DO NOTHING;

  IF p_step = 'entrada' THEN
    UPDATE time_records SET entrada = now(), entrada_loc = p_loc, entrada_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSIF p_step = 'saida_almoco' THEN
    UPDATE time_records SET saida_almoco = now(), saida_almoco_loc = p_loc, saida_almoco_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSIF p_step = 'retorno_almoco' THEN
    UPDATE time_records SET retorno_almoco = now(), retorno_almoco_loc = p_loc, retorno_almoco_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSE
    UPDATE time_records SET saida = now(), saida_loc = p_loc, saida_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;
