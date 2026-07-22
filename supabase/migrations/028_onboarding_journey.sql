CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      TEXT NOT NULL,
  descricao   TEXT,
  dias        INTEGER NOT NULL CHECK (dias IN (30, 60, 90)),
  ordem       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onboarding_tasks_dias_idx ON onboarding_tasks(dias, ordem);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  task_id        UUID NOT NULL REFERENCES onboarding_tasks(id) ON DELETE CASCADE,
  concluido_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, task_id)
);

CREATE INDEX IF NOT EXISTS onboarding_progress_emp_idx ON onboarding_progress(employee_id);

ALTER TABLE onboarding_tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_tasks_read_all" ON onboarding_tasks FOR SELECT USING (true);
CREATE POLICY "onboarding_tasks_rh_all"   ON onboarding_tasks FOR ALL USING (is_rh());

CREATE POLICY "onboarding_progress_colab_own" ON onboarding_progress FOR ALL
  USING (employee_id = my_employee_id());
CREATE POLICY "onboarding_progress_rh_all"    ON onboarding_progress FOR ALL USING (is_rh());

INSERT INTO onboarding_tasks (titulo, descricao, dias, ordem) VALUES
  ('Enviar documentos admissionais', 'Complete o checklist de documentos na tela "Documentos".', 30, 1),
  ('Conhecer a equipe', 'Apresente-se aos colegas do seu departamento no chat social.', 30, 2),
  ('Reunião 1:1 com o gestor', 'Alinhe expectativas e prioridades dos primeiros 90 dias.', 30, 3),
  ('Registrar o primeiro ponto', 'Confirme que sabe usar a tela de Banco de Horas.', 30, 4),
  ('Concluir treinamentos obrigatórios', 'Segurança do trabalho, compliance e políticas internas.', 60, 1),
  ('Revisão de 60 dias com o gestor', 'Feedback intermediário sobre a adaptação ao cargo.', 60, 2),
  ('Assumir uma entrega própria', 'Conduza uma tarefa ou projeto pequeno de ponta a ponta.', 60, 3),
  ('Avaliação de fim de experiência', 'Reunião final com RH e gestor sobre a confirmação do contrato.', 90, 1),
  ('Definir metas para os próximos 6 meses', 'Alinhe objetivos de médio prazo com o gestor.', 90, 2)
ON CONFLICT DO NOTHING;