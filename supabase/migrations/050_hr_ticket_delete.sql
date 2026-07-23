CREATE POLICY "tickets_colab_delete_own" ON hr_tickets FOR DELETE
  USING (employee_id = my_employee_id());

CREATE TABLE IF NOT EXISTS hr_ticket_hidden (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ticket_id   UUID NOT NULL REFERENCES hr_tickets(id) ON DELETE CASCADE,
  hidden_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (employee_id, ticket_id)
);

ALTER TABLE hr_ticket_hidden ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_hidden_colab_all" ON hr_ticket_hidden FOR ALL
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id());