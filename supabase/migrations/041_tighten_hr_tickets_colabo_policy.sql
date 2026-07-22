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