-- Adiciona coluna de data de nascimento na tabela employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date DATE;
