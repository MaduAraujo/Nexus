-- Mesma classe de problema das migrations 034/035: "colabo_time_own" era FOR ALL
-- só com employee_id = my_employee_id(), sem restringir a data. O único fluxo do
-- colaborador é o upsert de ponto.js (syncPunch), que sempre grava o `date` do
-- calendário local do dispositivo no momento da batida — mas nada no banco
-- impedia enviar, via API direta, um `date` de qualquer dia passado ou futuro e
-- reescrever entrada/saida à vontade, o que forjaria o cálculo de banco de horas
-- (banco-horas-rh.js) e os alertas de burnout (burnout_alerts é derivado destes
-- horários).
--
-- Janela de 1 dia de tolerância (ontem ou hoje, fuso America/Sao_Paulo) em vez de
-- exigir `date = hoje` exato: o app tem fila offline (ponto-colaborador.js,
-- queueOfflinePunch) que guarda a batida original e sincroniza depois — inclusive
-- depois da virada do dia, se o funcionário bateu o ponto perto da meia-noite e
-- ficou sem conexão. Uma igualdade estrita quebraria essa sincronização legítima.
-- Fuso horário explícito (não CURRENT_DATE cru) porque o servidor roda em UTC:
-- às 22h no horário de Brasília já é dia seguinte em UTC, então CURRENT_DATE sem
-- conversão rejeitaria batidas noturnas legítimas por ~3h todo dia.
--
-- DELETE nunca é usado por ninguém (nem RH) nesta tabela — removido para o
-- colaborador.

DROP POLICY IF EXISTS "colabo_time_own" ON time_records;

CREATE POLICY "colabo_time_select_own" ON time_records FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_time_insert_own" ON time_records FOR INSERT
  WITH CHECK (
    employee_id = my_employee_id()
    AND date BETWEEN (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 1
                  AND (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
  );

CREATE POLICY "colabo_time_update_own" ON time_records FOR UPDATE
  USING (
    employee_id = my_employee_id()
    AND date BETWEEN (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 1
                  AND (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
  )
  WITH CHECK (
    employee_id = my_employee_id()
    AND date BETWEEN (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 1
                  AND (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
  );
