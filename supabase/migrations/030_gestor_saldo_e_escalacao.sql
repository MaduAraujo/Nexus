ALTER TABLE hr_tickets ADD COLUMN IF NOT EXISTS about_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS hr_tickets_about_emp_idx ON hr_tickets(about_employee_id);