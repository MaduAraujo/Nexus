-- Gestor de equipe: hoje um colaborador com liderados (via employees.manager_id)
-- só conseguia aprovar banco de horas do time (migration 020). Isso estende o
-- mesmo poder para férias, para alimentar a tela "Minha Equipe".
--
-- Decisão de design: NÃO criamos um valor 'Gestor' em profiles.profile. Um
-- gestor continua sendo um profiles.profile = 'colaborador' normal — a única
-- diferença é ter colaboradores apontando para ele via manager_id (exatamente
-- como bank_requests já funciona). Introduzir um terceiro valor no CHECK
-- obrigaria a alterar o gate de autenticação em ~10 telas (todas comparam
-- profile === 'colaborador' para liberar acesso), sem nenhum ganho funcional:
-- um gestor é, antes de tudo, um colaborador comum que também lidera pessoas.

-- Gestor vê as férias de quem está sob sua liderança (para a tela "Minha Equipe").
CREATE POLICY "colabo_vacations_view_team" ON vacations FOR SELECT
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));

-- Gestor aprova/recusa apenas solicitações pendentes do próprio time — depois de
-- decidida, a solicitação sai do escopo de UPDATE (status deixa de ser 'pendente').
CREATE POLICY "colabo_vacations_approve_team" ON vacations FOR UPDATE
  USING (
    status = 'pendente'
    AND employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id())
  )
  WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id())
  );
