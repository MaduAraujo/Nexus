-- "Gestor não vê holerite/salário do time" era verdade só por omissão: nenhuma
-- tela pedia a coluna salary, mas a policy colabo_employees_managed (migration
-- 020) libera a LINHA inteira do liderado — RLS no Postgres é por linha, não
-- por coluna, então qualquer chamada direta à API (sb.from('employees').select
-- ('salary')...) para um liderado funcionaria hoje, mesmo sem nenhuma tela
-- expor isso. Como esse ponto foi documentado explicitamente como "correto por
-- LGPD, mantido de propósito", ele passa a ser garantido pelo banco, não só
-- pela UI: a view abaixo estruturalmente não tem a coluna salary (nem cpf, rg,
-- dados bancários/PIX, seguro de vida, pensão, bio) — não tem como pedir o que
-- a view não seleciona, não importa como a query é feita.
--
-- Views herdam a RLS da tabela base normalmente (a policy roda com o contexto
-- da sessão de quem está de fato logado, não do dono da view) — security_invoker
-- só deixa isso explícito, sem mudar o comportamento de RLS em si.

CREATE OR REPLACE VIEW team_roster
WITH (security_invoker = true) AS
SELECT
  id, name, role, dept, status, contract_type, work_load,
  avatar_color, avatar_url, manager_id
FROM employees;

GRANT SELECT ON team_roster TO authenticated;
