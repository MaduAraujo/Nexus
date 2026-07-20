-- Mesma classe de problema das migrations 034/035/036. "colabo_reads_own" era
-- FOR ALL; o único uso do colaborador é marcar a própria leitura via upsert
-- (comunicados-colaborador.js), sem nenhum UPDATE/DELETE em lugar nenhum do app —
-- nem RH usa. Risco baixo (só afeta o próprio indicador de "lido"), mas fechado
-- pela mesma razão das outras: nenhuma tela precisa de mais que isso.

DROP POLICY IF EXISTS "colabo_reads_own" ON message_reads;

CREATE POLICY "colabo_reads_select_own" ON message_reads FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_reads_insert_own" ON message_reads FOR INSERT
  WITH CHECK (employee_id = my_employee_id());

-- upsert() em comunicados-colaborador.js vira INSERT ... ON CONFLICT DO UPDATE:
-- com duas abas abertas ao mesmo tempo, a segunda pode cair no ramo de UPDATE
-- (ambas carregam `lidos` antes de qualquer uma marcar a mensagem). Sem policy de
-- UPDATE o upsert falhava nessa corrida; permitido aqui porque reescrever o
-- próprio read_at é inofensivo.
CREATE POLICY "colabo_reads_update_own" ON message_reads FOR UPDATE
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id());
