ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS vale_refeicao   NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS vale_alimentacao NUMERIC(10,2);