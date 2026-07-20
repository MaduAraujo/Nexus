-- Mesma classe de bug já corrigida nas migrations 034–037 (policies FOR ALL sem
-- WITH CHECK, liberando ao colaborador mais do que qualquer tela usa).
--
-- hr_ticket_messages: "tmsg_colab_own" liberava INSERT/UPDATE/DELETE em qualquer
-- mensagem do próprio ticket sem restringir a coluna `role`. O bot de atendimento
-- é simulado no cliente (sendBotMessage em chat-colaborador.js grava role='bot'
-- e role='user' diretamente via INSERT — não existe função de servidor para
-- isso), então o colaborador PRECISA poder inserir essas duas roles. Mas nada
-- impedia inserir role='rh' no próprio ticket (se passando por um atendente) ou
-- fazer UPDATE/DELETE em mensagens reais de RH no mesmo ticket — nenhuma tela
-- faz isso, só INSERT de user/bot.
--
-- hr_tickets: "tickets_colab_own" liberava UPDATE de qualquer coluna, inclusive
-- status. Os únicos INSERT/UPDATE feitos pelo colaborador são: abrir um ticket
-- próprio via bot (chat-colaborador.js createTicket, status='bot'), abrir em
-- nome do time direto como 'aguardando_rh' (equipe-colaborador.js
-- confirmEscalateToRh, gestor escalando algo sobre um liderado via
-- about_employee_id), escalar bot -> aguardando_rh, ou gravar
-- csat_rating/csat_rated_at (mantendo o status como já estava). Em nenhum
-- desses casos o colaborador grava 'em_atendimento' — esse status só é setado
-- por RH (chat-rh.js, atrás de is_rh()) quando um atendente assume o ticket —
-- o WITH CHECK abaixo garante que o colaborador nunca consiga chegar nele sozinho.

DROP POLICY IF EXISTS "tickets_colab_own" ON hr_tickets;

CREATE POLICY "tickets_colab_select_own" ON hr_tickets FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "tickets_colab_insert_own" ON hr_tickets FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status IN ('bot', 'aguardando_rh'));

CREATE POLICY "tickets_colab_update_own" ON hr_tickets FOR UPDATE
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id() AND status <> 'em_atendimento');

DROP POLICY IF EXISTS "tmsg_colab_own" ON hr_ticket_messages;

CREATE POLICY "tmsg_colab_select_own" ON hr_ticket_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM hr_tickets t
      WHERE t.id = hr_ticket_messages.ticket_id
        AND t.employee_id = my_employee_id()
    )
  );

CREATE POLICY "tmsg_colab_insert_own" ON hr_ticket_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hr_tickets t
      WHERE t.id = hr_ticket_messages.ticket_id
        AND t.employee_id = my_employee_id()
    )
    AND (
      (role = 'user' AND employee_id = my_employee_id())
      OR (role = 'bot' AND employee_id IS NULL)
    )
  );
