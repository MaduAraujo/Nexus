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