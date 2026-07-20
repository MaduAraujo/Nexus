-- "colabo_employees_active_directory" (migration 023) libera SELECT na LINHA
-- inteira de qualquer colaborador ativo para qualquer colaborador autenticado —
-- RLS é por linha, não por coluna, então salary, cpf, rg, chave_pix,
-- banco/agencia/conta, deficiencia, pensao_alimenticia de todo mundo ficavam
-- acessíveis via chamada direta à API (sb.from('employees').select('salary')...),
-- mesmo que nenhuma tela peça essas colunas.
--
-- Diferente do caso gestor→liderado (migration 031: a visibilidade da linha é
-- legítima ali, só a coluna era o problema, por isso team_roster usa
-- security_invoker=true e mantém a policy de base), aqui a visibilidade "qualquer
-- ativo vê qualquer ativo" não tem por que existir na tabela base — os dois
-- consumidores (dropdown de substituto de férias, seletor de kudos) só precisam
-- de id/name/dept. Por isso a correção fecha a linha na tabela base e move o
-- acesso para uma view.
--
-- Esta view NÃO usa security_invoker (ao contrário de team_roster): ela roda com
-- o privilégio do dono, ignorando RLS de propósito — é o mecanismo padrão do
-- Postgres para expor uma projeção de colunas restrita quando a própria
-- visibilidade da linha (não só da coluna) precisa ser diferente da tabela base.
-- Como a view não seleciona salary/cpf/rg/dados bancários/pensão/deficiência,
-- não tem como pedir o que ela não expõe, e o filtro `status = 'Ativo'` já vem
-- embutido na definição — não depende de nenhuma policy adicional.

DROP POLICY IF EXISTS "colabo_employees_active_directory" ON employees;

CREATE VIEW colleague_directory AS
SELECT id, name, dept, role, avatar_color, avatar_url
FROM employees
WHERE status = 'Ativo';

GRANT SELECT ON colleague_directory TO authenticated;
