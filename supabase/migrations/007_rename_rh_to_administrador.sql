-- Renomeia o valor de perfil 'rh' para 'Administrador'

-- 1. Remove a constraint antiga
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_profile_check;

-- 2. Atualiza os registros existentes
UPDATE profiles
  SET profile = 'Administrador'
  WHERE profile = 'rh';

-- 3. Recria a constraint com o novo valor
ALTER TABLE profiles
  ADD CONSTRAINT profiles_profile_check
  CHECK (profile IN ('Administrador', 'colaborador'));

-- 4. Atualiza a constraint de source em documents (se existir)
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_source_check;

UPDATE documents
  SET source = 'Administrador'
  WHERE source = 'rh';

ALTER TABLE documents
  ADD CONSTRAINT documents_source_check
  CHECK (source IN ('Administrador', 'colaborador'));

-- 5. Atualiza logs de auditoria (activity_logs) existentes
UPDATE activity_logs
  SET operator_profile = 'Administrador'
  WHERE operator_profile = 'rh';
