ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_profile_check;

UPDATE profiles
  SET profile = 'Administrador'
  WHERE profile = 'rh';

ALTER TABLE profiles
  ADD CONSTRAINT profiles_profile_check
  CHECK (profile IN ('Administrador', 'colaborador'));

ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_source_check;

UPDATE documents
  SET source = 'Administrador'
  WHERE source = 'rh';

ALTER TABLE documents
  ADD CONSTRAINT documents_source_check
  CHECK (source IN ('Administrador', 'colaborador'));

UPDATE activity_logs
  SET operator_profile = 'Administrador'
  WHERE operator_profile = 'rh';