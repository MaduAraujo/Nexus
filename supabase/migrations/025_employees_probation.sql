ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_probation BOOLEAN DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end_date DATE;

CREATE INDEX IF NOT EXISTS employees_probation_end_idx
  ON employees(probation_end_date) WHERE is_probation = true;