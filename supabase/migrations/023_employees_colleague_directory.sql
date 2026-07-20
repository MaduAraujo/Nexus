-- Permite que qualquer colaborador veja nome/departamento de colegas ativos, para
-- poder escolher um substituto/cobertura ao solicitar férias (tela ferias-colaborador).
-- Segue o mesmo padrão de "colabo_employees_managed" (migration 020): a policy
-- "colabo_employees_own" só libera a própria linha, então sem isso o select de
-- colegas para o dropdown de substituto retorna vazio.
CREATE POLICY "colabo_employees_active_directory" ON employees FOR SELECT
  USING (status = 'Ativo' AND my_employee_id() IS NOT NULL);
