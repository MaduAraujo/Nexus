-- Adiciona coluna de sexo/gênero na tabela employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender TEXT;
