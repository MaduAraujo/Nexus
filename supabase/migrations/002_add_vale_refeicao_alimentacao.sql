-- Migration 002: adiciona vale_refeicao e vale_alimentacao em employees
ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS vale_refeicao   NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS vale_alimentacao NUMERIC(10,2);
