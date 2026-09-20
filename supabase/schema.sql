CREATE TABLE IF NOT EXISTS employees (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  role                TEXT,
  cpf                 TEXT UNIQUE NOT NULL,
  rg                  TEXT,
  telefone            TEXT,
  email               TEXT UNIQUE NOT NULL,
  admission_date      DATE,
  contract_type       TEXT,
  salary_type         TEXT,
  work_load           TEXT,
  dept                TEXT,
  salary              NUMERIC(10,2),
  status              TEXT DEFAULT 'Ativo',
  termination_date    DATE,
  seguro_vida         BOOLEAN DEFAULT false,
  seguradora          TEXT,
  possui_dependentes  BOOLEAN DEFAULT false,
  qtd_dependentes     INTEGER,
  pcd                 BOOLEAN DEFAULT false,
  deficiencia         TEXT,
  pensao_alimenticia  BOOLEAN DEFAULT false,
  tipo_pensao         TEXT,
  vale_transporte     BOOLEAN DEFAULT false,
  valor_passagem      NUMERIC(10,2),
  conducoes_dia       INTEGER,
  forma_pagamento     TEXT,
  tipo_chave_pix      TEXT,
  chave_pix           TEXT,
  banco               TEXT,
  tipo_conta          TEXT,
  agencia             TEXT,
  conta               TEXT,
  avatar_color        TEXT,
  avatar_url          TEXT,
  bio                 TEXT,
  vale_refeicao       NUMERIC(10,2),
  vale_alimentacao    NUMERIC(10,2),
  birth_date          DATE,
  gender              TEXT,
  manager_id          UUID REFERENCES employees(id) ON DELETE SET NULL,
  raca_cor            TEXT,
  is_probation        BOOLEAN DEFAULT false,
  probation_end_date  DATE,
  is_aviso_previo       BOOLEAN DEFAULT false,
  aviso_previo_end_date DATE,
  last_access         TIMESTAMPTZ,
  auth_user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employees_manager_idx ON employees(manager_id);
CREATE INDEX IF NOT EXISTS employees_probation_end_idx
  ON employees(probation_end_date) WHERE is_probation = true;
CREATE INDEX IF NOT EXISTS employees_aviso_previo_end_idx
  ON employees(aviso_previo_end_date) WHERE is_aviso_previo = true;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile     TEXT NOT NULL CHECK (profile IN ('Administrador', 'colaborador')),
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vacations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  days             INTEGER NOT NULL,
  status           TEXT DEFAULT 'pendente'
                   CHECK (status IN ('pendente','aprovado','concluido','recusado','cancelado')),
  abono            BOOLEAN DEFAULT false,
  obs              TEXT,
  rejection_reason TEXT,
  coletiva         BOOLEAN DEFAULT false,
  substituto_id    UUID REFERENCES employees(id) ON DELETE SET NULL,
  decided_by_name  TEXT,
  decided_by_email TEXT,
  approved_at      TIMESTAMPTZ,
  rejected_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vacations_employee_idx ON vacations(employee_id);
CREATE INDEX IF NOT EXISTS vacations_status_idx   ON vacations(status);
CREATE INDEX IF NOT EXISTS vacations_dates_idx    ON vacations(start_date, end_date);

CREATE TABLE IF NOT EXISTS employee_audit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  changes        JSONB NOT NULL,
  operator_name  TEXT,
  operator_email TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employee_audit_emp_idx ON employee_audit(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS time_records (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id                 UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                        DATE NOT NULL,
  entrada                     TIMESTAMPTZ,
  saida_almoco                TIMESTAMPTZ,
  retorno_almoco               TIMESTAMPTZ,
  saida                       TIMESTAMPTZ,
  entrada_loc                 JSONB,
  saida_almoco_loc             JSONB,
  retorno_almoco_loc           JSONB,
  saida_loc                   JSONB,
  ajustado                    BOOLEAN DEFAULT false,
  entrada_ajustado             BOOLEAN DEFAULT false,
  saida_almoco_ajustado        BOOLEAN DEFAULT false,
  retorno_almoco_ajustado      BOOLEAN DEFAULT false,
  saida_ajustado               BOOLEAN DEFAULT false,
  entrada_selfie_path          TEXT,
  saida_almoco_selfie_path     TEXT,
  retorno_almoco_selfie_path   TEXT,
  saida_selfie_path            TEXT,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE INDEX IF NOT EXISTS time_records_emp_date_idx ON time_records(employee_id, date DESC);

CREATE TABLE IF NOT EXISTS adjustment_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN ('entrada','saida-almoco','retorno-almoco','saida','falta')),
  horario          TIME,
  justificativa    TEXT NOT NULL,
  status           TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado')),
  decided_by_name  TEXT,
  decided_by_email TEXT,
  decided_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS adj_req_emp_idx    ON adjustment_requests(employee_id);
CREATE INDEX IF NOT EXISTS adj_req_status_idx ON adjustment_requests(status);

CREATE TABLE IF NOT EXISTS burnout_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  alertas           JSONB NOT NULL,
  lido              BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  push_scheduled_at TIMESTAMPTZ,
  push_sent_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS compliance_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  alertas           JSONB NOT NULL,
  lido              BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  push_scheduled_at TIMESTAMPTZ,
  push_sent_at      TIMESTAMPTZ,
  UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS compliance_alerts_emp_idx  ON compliance_alerts(employee_id);
CREATE INDEX IF NOT EXISTS compliance_alerts_lido_idx ON compliance_alerts(lido) WHERE lido = false;

CREATE TABLE IF NOT EXISTS activity_logs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL,
  acao             TEXT NOT NULL,
  date             DATE,
  valor_registrado TIMESTAMPTZ,
  minutos          INTEGER,
  operator_email   TEXT,
  operator_name    TEXT,
  operator_profile TEXT,
  justificativa    TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_logs_emp_idx ON activity_logs(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  texto        TEXT NOT NULL,
  destino      TEXT NOT NULL,
  categoria    TEXT NOT NULL DEFAULT 'Institucional',
  anexos       JSONB DEFAULT '[]',
  scheduled_at TIMESTAMPTZ,
  push_sent_at TIMESTAMPTZ,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_destino_idx   ON messages(destino);
CREATE INDEX IF NOT EXISTS messages_created_idx   ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS messages_scheduled_idx ON messages(scheduled_at);
CREATE INDEX IF NOT EXISTS messages_categoria_idx ON messages(categoria);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(message_id, employee_id)
);

CREATE TABLE IF NOT EXISTS message_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  texto      TEXT NOT NULL,
  destino    TEXT NOT NULL,
  categoria  TEXT NOT NULL DEFAULT 'Institucional',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_templates_created_idx ON message_templates(created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_employee_idx ON push_subscriptions(employee_id);

CREATE TABLE IF NOT EXISTS admin_push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_push_subscriptions_profile_idx ON admin_push_subscriptions(profile_id);

CREATE TABLE IF NOT EXISTS documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  employee_id           UUID REFERENCES employees(id) ON DELETE CASCADE,
  category              TEXT,
  tipo                  TEXT NOT NULL,
  size_label            TEXT,
  storage_path          TEXT,
  source                TEXT DEFAULT 'Administrador' CHECK (source IN ('Administrador','colaborador')),
  status                TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','recusado')),
  data_validade         DATE,
  retido_ate            DATE,
  lgpd_consentimento    BOOLEAN DEFAULT false,
  lgpd_consentimento_em TIMESTAMPTZ,
  version               INTEGER NOT NULL DEFAULT 1,
  is_current            BOOLEAN NOT NULL DEFAULT true,
  replaces_document_id  UUID REFERENCES documents(id) ON DELETE SET NULL,
  requer_assinatura     BOOLEAN DEFAULT false,
  assinado_em           TIMESTAMPTZ,
  assinado_por          TEXT,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_emp_idx      ON documents(employee_id);
CREATE INDEX IF NOT EXISTS documents_source_idx   ON documents(source, category);
CREATE INDEX IF NOT EXISTS documents_validade_idx ON documents(data_validade);
CREATE INDEX IF NOT EXISTS documents_replaces_idx ON documents(replaces_document_id);
CREATE INDEX IF NOT EXISTS documents_current_idx  ON documents(employee_id, category, tipo, is_current);

CREATE TABLE IF NOT EXISTS document_requirements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL CHECK (category IN ('admissional','demissional')),
  tipo        TEXT NOT NULL,
  obrigatorio BOOLEAN DEFAULT true,
  UNIQUE(category, tipo)
);

CREATE TABLE IF NOT EXISTS document_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID,
  document_name  TEXT NOT NULL,
  employee_id    UUID REFERENCES employees(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN ('criado','aprovado','recusado','excluido','substituido','assinado')),
  actor_id       UUID,
  actor_name     TEXT,
  actor_profile  TEXT,
  details        JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_audit_log_doc_idx ON document_audit_log(document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payslips (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  mes             TEXT NOT NULL,
  mes_formatado   TEXT,
  competencia     TEXT,
  proventos       JSONB NOT NULL,
  descontos       JSONB NOT NULL,
  total_proventos NUMERIC(10,2),
  total_descontos NUMERIC(10,2),
  salario_liquido NUMERIC(10,2),
  status          TEXT DEFAULT 'publicado' CHECK (status IN ('publicado','pago')),
  pago_em         TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  assinado_em     TIMESTAMPTZ,
  assinado_por    TEXT,
  UNIQUE(employee_id, mes)
);

CREATE INDEX IF NOT EXISTS payslips_emp_mes_idx ON payslips(employee_id, mes DESC);

CREATE TABLE IF NOT EXISTS bank_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('credito','debito')),
  minutos         INTEGER NOT NULL,
  date            DATE NOT NULL,
  justificativa   TEXT NOT NULL,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bank_adj_emp_idx ON bank_adjustments(employee_id, date DESC);

CREATE TABLE IF NOT EXISTS holidays (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE NOT NULL,
  name        TEXT NOT NULL,
  abrangencia TEXT DEFAULT 'nacional' CHECK (abrangencia IN ('nacional','estadual','municipal','facultativo')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date)
);

CREATE INDEX IF NOT EXISTS holidays_date_idx ON holidays(date);

CREATE TABLE IF NOT EXISTS hr_settings (
  id                            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  banco_horas_vencimento_meses  INTEGER NOT NULL DEFAULT 6,
  limite_extra_diario_min       INTEGER NOT NULL DEFAULT 120,
  updated_at                    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id            UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  origem                 TEXT NOT NULL CHECK (origem IN ('colaborador','rh')),
  tipo                   TEXT NOT NULL CHECK (tipo IN ('credito','debito')),
  minutos                INTEGER NOT NULL CHECK (minutos > 0),
  date                   DATE NOT NULL,
  justificativa          TEXT NOT NULL,
  anexo_path             TEXT,
  anexo_name             TEXT,
  status                 TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado')),
  requires_approval_from TEXT NOT NULL CHECK (requires_approval_from IN ('gestor','rh')),
  manager_id_snapshot    UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_by_user_id     UUID DEFAULT auth.uid(),
  created_by_name        TEXT,
  created_by_email       TEXT,
  decided_by_name        TEXT,
  decided_by_email       TEXT,
  decided_at             TIMESTAMPTZ,
  decision_obs           TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_requests_emp_idx     ON bank_requests(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bank_requests_manager_idx ON bank_requests(manager_id_snapshot);
CREATE INDEX IF NOT EXISTS bank_requests_status_idx  ON bank_requests(status);

CREATE TABLE IF NOT EXISTS data_access_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tipo              TEXT NOT NULL CHECK (tipo IN ('perfil_completo','documento','holerite','selfie_ponto')),
  detalhe           TEXT,
  accessed_by_name  TEXT,
  accessed_by_email TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS data_access_log_emp_idx ON data_access_log(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_analysis_cache (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key    TEXT NOT NULL DEFAULT 'latest',
  summary      TEXT NOT NULL DEFAULT '',
  alerts       JSONB NOT NULL DEFAULT '[]',
  health_score INTEGER,
  analyzed_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cache_key)
);

CREATE TABLE IF NOT EXISTS ai_analysis_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary      TEXT NOT NULL DEFAULT '',
  health_score INTEGER,
  alerts       JSONB NOT NULL DEFAULT '[]',
  analyzed_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_chat_history (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_decision_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_decision_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID REFERENCES employees(id) ON DELETE SET NULL,
  target_table     TEXT NOT NULL CHECK (target_table IN ('vacations', 'adjustment_requests', 'burnout_alerts')),
  target_id        UUID NOT NULL,
  action_type      TEXT NOT NULL,
  ai_message       TEXT NOT NULL,
  evidence         JSONB NOT NULL,
  decided_by_name  TEXT,
  decided_by_email TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_decision_log_emp_idx ON ai_decision_log(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  icon        TEXT DEFAULT 'hashtag',
  dept        TEXT,
  kind        TEXT NOT NULL DEFAULT 'channel' CONSTRAINT chat_channels_kind_chk CHECK (kind IN ('channel', 'dm')),
  dm_key      TEXT UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chat_channels_dm_key_chk CHECK ((kind = 'dm') = (dm_key IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS chat_channel_members (
  channel_id  UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id)    ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (channel_id, employee_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id)    ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_channel_idx ON chat_messages(channel_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hr_tickets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  about_employee_id  UUID REFERENCES employees(id) ON DELETE SET NULL,
  subject            TEXT NOT NULL DEFAULT 'Atendimento RH',
  status             TEXT NOT NULL DEFAULT 'bot'
                     CHECK (status IN ('bot', 'aguardando_rh', 'em_atendimento', 'resolvido')),
  csat_rating        SMALLINT CHECK (csat_rating BETWEEN 1 AND 5),
  csat_comment       TEXT,
  csat_rated_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hr_tickets_emp_idx       ON hr_tickets(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hr_tickets_about_emp_idx ON hr_tickets(about_employee_id);

CREATE TRIGGER hr_tickets_updated_at
  BEFORE UPDATE ON hr_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS hr_ticket_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES hr_tickets(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,  
  role        TEXT NOT NULL CHECK (role IN ('user', 'bot', 'rh')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hr_ticket_msgs_idx ON hr_ticket_messages(ticket_id, created_at ASC);

CREATE TABLE IF NOT EXISTS hr_ticket_hidden (
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  ticket_id   UUID NOT NULL REFERENCES hr_tickets(id) ON DELETE CASCADE,
  hidden_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (employee_id, ticket_id)
);

CREATE TABLE IF NOT EXISTS kudos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  categoria        TEXT NOT NULL DEFAULT 'colaboracao'
                    CHECK (categoria IN ('colaboracao','inovacao','lideranca','superacao','mentoria')),
  message          TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CHECK (from_employee_id <> to_employee_id)
);

CREATE INDEX IF NOT EXISTS kudos_to_idx      ON kudos(to_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kudos_created_idx ON kudos(created_at DESC);

CREATE TABLE IF NOT EXISTS anonymous_feedback (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria  TEXT NOT NULL DEFAULT 'outro'
             CHECK (categoria IN ('clima','gestao','processos','infraestrutura','outro')),
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','lido','arquivado')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS anon_feedback_status_idx ON anonymous_feedback(status, created_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo     TEXT NOT NULL,
  descricao  TEXT,
  dias       INTEGER NOT NULL CHECK (dias IN (30, 60, 90)),
  ordem      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS onboarding_tasks_dias_idx ON onboarding_tasks(dias, ordem);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  task_id      UUID NOT NULL REFERENCES onboarding_tasks(id) ON DELETE CASCADE,
  concluido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, task_id)
);

CREATE INDEX IF NOT EXISTS onboarding_progress_emp_idx ON onboarding_progress(employee_id);

ALTER TABLE employees            ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_audit       ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_records          ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE burnout_alerts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alerts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads         ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips              ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_adjustments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays              ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_requests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_access_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis_cache     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decision_memory    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decision_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channel_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_tickets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_ticket_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_ticket_hidden       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kudos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE anonymous_feedback    ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_rh()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND profile = 'Administrador'
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION my_employee_id()
RETURNS UUID AS $$
  SELECT employee_id FROM profiles WHERE id = auth.uid() AND profile = 'colaborador';
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE POLICY "rh_employees_all"        ON employees FOR ALL    USING (is_rh());
CREATE POLICY "colabo_employees_own"    ON employees FOR SELECT USING (id = my_employee_id());
CREATE POLICY "colabo_employees_managed" ON employees FOR SELECT USING (manager_id = my_employee_id());

CREATE POLICY "rh_profiles_all"     ON profiles FOR ALL    USING (is_rh());
CREATE POLICY "colabo_profiles_own" ON profiles FOR SELECT USING (id = auth.uid());

CREATE POLICY "rh_vacations_all" ON vacations FOR ALL USING (is_rh());

CREATE POLICY "colabo_vacations_select_own" ON vacations FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_vacations_insert_own" ON vacations FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

CREATE POLICY "colabo_vacations_update_own" ON vacations FOR UPDATE
  USING (employee_id = my_employee_id() AND status IN ('pendente','aprovado'))
  WITH CHECK (employee_id = my_employee_id() AND status IN ('cancelado','concluido'));

CREATE POLICY "colabo_vacations_view_team" ON vacations FOR SELECT
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));

CREATE POLICY "colabo_vacations_approve_team" ON vacations FOR UPDATE
  USING (
    status = 'pendente'
    AND employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id())
  )
  WITH CHECK (
    employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id())
  );

CREATE POLICY "rh_audit_all"     ON employee_audit FOR ALL    USING (is_rh());
CREATE POLICY "colabo_audit_own" ON employee_audit FOR SELECT USING (employee_id = my_employee_id());

CREATE POLICY "rh_time_all" ON time_records FOR ALL USING (is_rh());

CREATE POLICY "colabo_time_select_own" ON time_records FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_time_insert_own" ON time_records FOR INSERT
  WITH CHECK (
    employee_id = my_employee_id()
    AND date BETWEEN (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 1
                  AND (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
  );

CREATE POLICY "colabo_time_update_own" ON time_records FOR UPDATE
  USING (
    employee_id = my_employee_id()
    AND date BETWEEN (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 1
                  AND (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
  )
  WITH CHECK (
    employee_id = my_employee_id()
    AND date BETWEEN (NOW() AT TIME ZONE 'America/Sao_Paulo')::date - 1
                  AND (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
  );

CREATE POLICY "rh_adjreq_all" ON adjustment_requests FOR ALL USING (is_rh());

CREATE POLICY "colabo_adjreq_select_own" ON adjustment_requests FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_adjreq_insert_own" ON adjustment_requests FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

CREATE POLICY "rh_burnout_all"     ON burnout_alerts FOR ALL    USING (is_rh());
CREATE POLICY "colabo_burnout_own" ON burnout_alerts FOR SELECT USING (employee_id = my_employee_id());

CREATE POLICY "rh_compliance_all"     ON compliance_alerts FOR ALL    USING (is_rh());
CREATE POLICY "colabo_compliance_own" ON compliance_alerts FOR SELECT USING (employee_id = my_employee_id());

CREATE POLICY "rh_actlogs_all" ON activity_logs FOR ALL USING (is_rh());

CREATE POLICY "colabo_actlogs_select_own" ON activity_logs FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_actlogs_insert_own" ON activity_logs FOR INSERT
  WITH CHECK (employee_id = my_employee_id());

CREATE POLICY "rh_messages_all" ON messages FOR ALL USING (is_rh());
CREATE POLICY "colabo_messages_read" ON messages FOR SELECT
  USING (
    (scheduled_at IS NULL OR scheduled_at <= NOW()) AND
    (destino = 'Todos' OR destino = (SELECT dept FROM employees WHERE id = my_employee_id()))
  );

CREATE POLICY "rh_reads_all" ON message_reads FOR ALL USING (is_rh());

CREATE POLICY "colabo_reads_select_own" ON message_reads FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_reads_insert_own" ON message_reads FOR INSERT
  WITH CHECK (employee_id = my_employee_id());

CREATE POLICY "colabo_reads_update_own" ON message_reads FOR UPDATE
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id());

CREATE POLICY "push_subscriptions_colab_all" ON push_subscriptions FOR ALL
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id());

CREATE POLICY "admin_push_subscriptions_rh_own" ON admin_push_subscriptions FOR ALL
  USING (profile_id = auth.uid() AND is_rh())
  WITH CHECK (profile_id = auth.uid() AND is_rh());

CREATE POLICY "rh_message_templates_all" ON message_templates FOR ALL USING (is_rh());

CREATE POLICY "rh_docs_all" ON documents FOR ALL USING (is_rh());

CREATE POLICY "colabo_docs_select_own" ON documents FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_docs_insert_own" ON documents FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND source = 'colaborador');

CREATE POLICY "colabo_docs_delete_own" ON documents FOR DELETE
  USING (employee_id = my_employee_id() AND source = 'colaborador');

CREATE POLICY "colabo_docs_update_own" ON documents FOR UPDATE
  USING (employee_id = my_employee_id() AND source = 'colaborador')
  WITH CHECK (employee_id = my_employee_id() AND source = 'colaborador');

CREATE POLICY "rh_requirements_all" ON document_requirements FOR ALL USING (is_rh());

CREATE POLICY "colabo_requirements_select" ON document_requirements FOR SELECT
  USING (my_employee_id() IS NOT NULL);

CREATE POLICY "rh_audit_log_all" ON document_audit_log FOR ALL USING (is_rh());

CREATE POLICY "colabo_audit_log_insert_own" ON document_audit_log FOR INSERT
  WITH CHECK (
    employee_id = my_employee_id()
    AND action IN ('criado', 'substituido', 'assinado', 'excluido')
  );

CREATE POLICY "rh_payslips_all"     ON payslips FOR ALL    USING (is_rh());
CREATE POLICY "colabo_payslips_own" ON payslips FOR SELECT USING (employee_id = my_employee_id());

CREATE POLICY "rh_bankadj_all"     ON bank_adjustments FOR ALL    USING (is_rh());
CREATE POLICY "colabo_bankadj_own" ON bank_adjustments FOR SELECT USING (employee_id = my_employee_id());

CREATE POLICY "rh_holidays_all"        ON holidays FOR ALL    USING (is_rh());
CREATE POLICY "colabo_holidays_select" ON holidays FOR SELECT USING (my_employee_id() IS NOT NULL);

CREATE POLICY "rh_hr_settings_all"     ON hr_settings FOR ALL    USING (is_rh());
CREATE POLICY "colabo_hr_settings_select" ON hr_settings FOR SELECT USING (my_employee_id() IS NOT NULL);

CREATE POLICY "rh_bankreq_all" ON bank_requests FOR ALL USING (is_rh());

CREATE POLICY "colabo_bankreq_select" ON bank_requests FOR SELECT
  USING (employee_id = my_employee_id() OR manager_id_snapshot = my_employee_id());

CREATE POLICY "colabo_bankreq_insert" ON bank_requests FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND origem = 'colaborador');

CREATE POLICY "rh_data_access_log_all"        ON data_access_log FOR ALL    USING (is_rh());
CREATE POLICY "colabo_data_access_log_select" ON data_access_log FOR SELECT USING (employee_id = my_employee_id());

CREATE POLICY "rh_cache_all"   ON ai_analysis_cache   FOR ALL USING (is_rh());
CREATE POLICY "rh_history_all" ON ai_analysis_history FOR ALL USING (is_rh());
CREATE POLICY "rh_chat_all"    ON ai_chat_history     FOR ALL USING (is_rh());
CREATE POLICY "rh_memory_all"  ON ai_decision_memory  FOR ALL USING (is_rh());

CREATE POLICY "rh_ai_decision_log_all"        ON ai_decision_log FOR ALL    USING (is_rh());
CREATE POLICY "colabo_ai_decision_log_select" ON ai_decision_log FOR SELECT USING (employee_id = my_employee_id());

-- Funções auxiliares SECURITY DEFINER: evitam recursão de RLS entre chat_channels e chat_channel_members.
CREATE OR REPLACE FUNCTION chat_channel_is_dm(p_channel UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM chat_channels WHERE id = p_channel AND kind = 'dm');
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION chat_is_member(p_channel UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_channel_members
    WHERE channel_id = p_channel AND employee_id = my_employee_id()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION chat_channel_is_dm(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION chat_is_member(UUID)     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION chat_channel_is_dm(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION chat_is_member(UUID)     TO authenticated;

CREATE OR REPLACE FUNCTION get_or_create_dm(p_other UUID)
RETURNS UUID AS $$
DECLARE
  v_me  UUID := my_employee_id();
  v_key TEXT;
  v_id  UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_a_collaborator' USING ERRCODE = '42501';
  END IF;
  IF p_other IS NULL OR p_other = v_me THEN
    RAISE EXCEPTION 'invalid_recipient' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM employees WHERE id = p_other AND status = 'Ativo') THEN
    RAISE EXCEPTION 'recipient_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_key := LEAST(v_me::text, p_other::text) || ':' || GREATEST(v_me::text, p_other::text);

  SELECT id INTO v_id FROM chat_channels WHERE dm_key = v_key;

  IF v_id IS NULL THEN
    INSERT INTO chat_channels (name, slug, description, icon, kind, dm_key)
    VALUES ('Mensagem direta', 'dm-' || v_key, NULL, 'user', 'dm', v_key)
    ON CONFLICT (dm_key) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM chat_channels WHERE dm_key = v_key;
    END IF;
  END IF;

  INSERT INTO chat_channel_members (channel_id, employee_id)
  VALUES (v_id, v_me), (v_id, p_other)
  ON CONFLICT (channel_id, employee_id) DO NOTHING;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION get_or_create_dm(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_or_create_dm(UUID) TO authenticated;

CREATE POLICY "channels_read_visible" ON chat_channels FOR SELECT
  USING (kind = 'channel' OR chat_is_member(id));
CREATE POLICY "channels_rh_all"   ON chat_channels FOR ALL    USING (is_rh() AND kind = 'channel');

CREATE POLICY "members_read_visible" ON chat_channel_members FOR SELECT
  USING (NOT chat_channel_is_dm(channel_id) OR chat_is_member(channel_id));

CREATE POLICY "members_colab_join" ON chat_channel_members FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND NOT chat_channel_is_dm(channel_id));

CREATE POLICY "members_colab_del"  ON chat_channel_members FOR DELETE
  USING (employee_id = my_employee_id() AND NOT chat_channel_is_dm(channel_id));

CREATE POLICY "members_rh_all"     ON chat_channel_members FOR ALL USING (is_rh() AND NOT chat_channel_is_dm(channel_id));

CREATE POLICY "msgs_member_read" ON chat_messages FOR SELECT
  USING (
    (is_rh() AND NOT chat_channel_is_dm(channel_id))
    OR EXISTS (
      SELECT 1 FROM chat_channel_members m
      WHERE m.channel_id = chat_messages.channel_id
        AND m.employee_id = my_employee_id()
    )
  );

CREATE POLICY "msgs_member_insert" ON chat_messages FOR INSERT
  WITH CHECK (
    employee_id = my_employee_id()
    AND EXISTS (
      SELECT 1 FROM chat_channel_members m
      WHERE m.channel_id = chat_messages.channel_id
        AND m.employee_id = my_employee_id()
    )
  );

CREATE POLICY "msgs_rh_all" ON chat_messages FOR ALL USING (is_rh() AND NOT chat_channel_is_dm(channel_id));

CREATE POLICY "tickets_rh_all" ON hr_tickets FOR ALL USING (is_rh());

CREATE POLICY "tickets_colab_select_own" ON hr_tickets FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "tickets_colab_insert_own" ON hr_tickets FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status IN ('bot', 'aguardando_rh'));

CREATE POLICY "tickets_colab_update_own" ON hr_tickets FOR UPDATE
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id() AND status <> 'em_atendimento');

CREATE POLICY "tickets_colab_delete_own" ON hr_tickets FOR DELETE
  USING (employee_id = my_employee_id());

CREATE POLICY "ticket_hidden_colab_all" ON hr_ticket_hidden FOR ALL
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id());

CREATE POLICY "tmsg_rh_all" ON hr_ticket_messages FOR ALL USING (is_rh());

CREATE POLICY "tmsg_colab_select_own" ON hr_ticket_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM hr_tickets t
      WHERE t.id = hr_ticket_messages.ticket_id
        AND t.employee_id = my_employee_id()
    )
  );

CREATE POLICY "tmsg_colab_insert_own" ON hr_ticket_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM hr_tickets t
      WHERE t.id = hr_ticket_messages.ticket_id
        AND t.employee_id = my_employee_id()
    )
    AND (
      (role = 'user' AND employee_id = my_employee_id())
      OR (role = 'bot' AND employee_id IS NULL)
    )
  );

CREATE POLICY "kudos_read_all"   ON kudos FOR SELECT USING (true);
CREATE POLICY "kudos_colab_give" ON kudos FOR INSERT WITH CHECK (from_employee_id = my_employee_id());
CREATE POLICY "kudos_rh_all"     ON kudos FOR ALL    USING (is_rh());

CREATE POLICY "anon_feedback_colab_insert" ON anonymous_feedback FOR INSERT
  WITH CHECK (my_employee_id() IS NOT NULL);

CREATE POLICY "anon_feedback_rh_all" ON anonymous_feedback FOR ALL USING (is_rh());

CREATE POLICY "onboarding_tasks_read_all" ON onboarding_tasks FOR SELECT USING (true);
CREATE POLICY "onboarding_tasks_rh_all"   ON onboarding_tasks FOR ALL    USING (is_rh());

CREATE POLICY "onboarding_progress_colab_own" ON onboarding_progress FOR ALL USING (employee_id = my_employee_id());
CREATE POLICY "onboarding_progress_rh_all"    ON onboarding_progress FOR ALL USING (is_rh());


CREATE OR REPLACE VIEW team_roster
WITH (security_invoker = true) AS
SELECT
  id, name, role, dept, status, contract_type, work_load,
  avatar_color, avatar_url, manager_id
FROM employees;

GRANT SELECT ON team_roster TO authenticated;

CREATE OR REPLACE FUNCTION colleague_directory()
RETURNS TABLE (
  id UUID,
  name TEXT,
  dept TEXT,
  role TEXT,
  avatar_color TEXT,
  avatar_url TEXT
) AS $$
  SELECT id, name, dept, role, avatar_color, avatar_url
  FROM employees
  WHERE status = 'Ativo';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION colleague_directory() TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments', 'message-attachments', false, 10485760,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars', 'avatars', true, 10485760,
  ARRAY['image/jpeg','image/png','image/gif','image/webp']
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ponto-selfies', 'ponto-selfies', false, 3145728, ARRAY['image/jpeg'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "rh_storage_all" ON storage.objects FOR ALL
  USING (bucket_id = 'documents' AND is_rh());

CREATE POLICY "colabo_storage_select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.storage_path = storage.objects.name
        AND d.employee_id = my_employee_id()
    )
  );

CREATE POLICY "colabo_storage_upload" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "colabo_storage_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "colabo_storage_update" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "rh_msgattach_all" ON storage.objects FOR ALL
  USING (bucket_id = 'message-attachments' AND is_rh());

CREATE POLICY "colabo_msgattach_select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'message-attachments' AND
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id::text = (storage.foldername(name))[1]
        AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW())
        AND (m.destino = 'Todos' OR m.destino = (SELECT dept FROM employees WHERE id = my_employee_id()))
    )
  );

CREATE POLICY "rh_avatars_all" ON storage.objects FOR ALL
  USING (bucket_id = 'avatars' AND is_rh());

CREATE POLICY "colabo_avatars_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND name = my_employee_id()::TEXT);

CREATE POLICY "colabo_avatars_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND name = my_employee_id()::TEXT);

CREATE POLICY "colabo_avatars_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND name = my_employee_id()::TEXT);

CREATE POLICY "colabo_ponto_selfies_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'ponto-selfies'
    AND (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "colabo_ponto_selfies_select_own" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'ponto-selfies'
    AND (storage.foldername(name))[1] = my_employee_id()::TEXT
  );

CREATE POLICY "rh_ponto_selfies_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'ponto-selfies' AND is_rh());

CREATE OR REPLACE FUNCTION sign_document(p_document_id UUID, p_signer_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id       UUID;
  v_requer_assinatura BOOLEAN;
  v_assinado_em       TIMESTAMPTZ;
BEGIN
  SELECT employee_id, requer_assinatura, assinado_em
    INTO v_employee_id, v_requer_assinatura, v_assinado_em
    FROM documents WHERE id = p_document_id;

  IF v_employee_id IS NULL OR v_employee_id <> my_employee_id() THEN
    RAISE EXCEPTION 'Documento não encontrado ou não pertence ao colaborador autenticado';
  END IF;
  IF NOT v_requer_assinatura THEN
    RAISE EXCEPTION 'Este documento não requer assinatura eletrônica';
  END IF;
  IF v_assinado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Documento já assinado';
  END IF;
  IF p_signer_name IS NULL OR btrim(p_signer_name) = '' THEN
    RAISE EXCEPTION 'Nome do signatário é obrigatório';
  END IF;

  UPDATE documents SET assinado_em = NOW(), assinado_por = btrim(p_signer_name)
  WHERE id = p_document_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sign_document(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION sign_payslip(p_payslip_id UUID, p_signer_name TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id UUID;
  v_assinado_em TIMESTAMPTZ;
BEGIN
  SELECT employee_id, assinado_em
    INTO v_employee_id, v_assinado_em
    FROM payslips WHERE id = p_payslip_id;

  IF v_employee_id IS NULL OR v_employee_id <> my_employee_id() THEN
    RAISE EXCEPTION 'Holerite não encontrado ou não pertence ao colaborador autenticado';
  END IF;
  IF v_assinado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Holerite já assinado';
  END IF;
  IF p_signer_name IS NULL OR btrim(p_signer_name) = '' THEN
    RAISE EXCEPTION 'Nome do signatário é obrigatório';
  END IF;

  UPDATE payslips SET assinado_em = NOW(), assinado_por = btrim(p_signer_name)
  WHERE id = p_payslip_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sign_payslip(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION approve_bank_request(
  p_request_id       UUID,
  p_decision         TEXT,
  p_obs              TEXT DEFAULT NULL,
  p_decided_by_name  TEXT DEFAULT NULL,
  p_decided_by_email TEXT DEFAULT NULL
)
RETURNS bank_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req        bank_requests;
  v_is_manager BOOLEAN;
  v_allowed    BOOLEAN := FALSE;
BEGIN
  IF p_decision NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida: %', p_decision;
  END IF;

  SELECT * INTO v_req FROM bank_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;
  IF v_req.status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta solicitação já foi decidida';
  END IF;

  v_is_manager := v_req.requires_approval_from = 'gestor'
    AND v_req.manager_id_snapshot IS NOT NULL
    AND v_req.manager_id_snapshot = my_employee_id();

  IF v_is_manager THEN
    v_allowed := TRUE;
  ELSIF is_rh() THEN
    IF v_req.requires_approval_from = 'rh' AND v_req.created_by_user_id IS NOT NULL AND auth.uid() = v_req.created_by_user_id THEN
      v_allowed := FALSE;
    ELSE
      v_allowed := TRUE;
    END IF;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação (precisa ser o gestor responsável, ou um segundo Administrador)';
  END IF;

  IF p_decision = 'aprovado' THEN
    INSERT INTO bank_adjustments (employee_id, tipo, minutos, date, justificativa, created_by_name)
    VALUES (
      v_req.employee_id, v_req.tipo, v_req.minutos, v_req.date,
      v_req.justificativa || CASE WHEN v_req.anexo_name IS NOT NULL THEN ' [anexo: ' || v_req.anexo_name || ']' ELSE '' END,
      COALESCE(p_decided_by_name, 'RH')
    );

    INSERT INTO activity_logs (employee_id, tipo, acao, date, minutos, operator_email, operator_name, operator_profile, justificativa)
    VALUES (
      v_req.employee_id, 'ajuste_banco', v_req.tipo, v_req.date, v_req.minutos,
      p_decided_by_email, COALESCE(p_decided_by_name, 'RH'),
      CASE WHEN is_rh() THEN 'Administrador' ELSE 'colaborador' END,
      'Solicitação aprovada (' || v_req.origem || '): ' || v_req.justificativa
    );
  END IF;

  UPDATE bank_requests SET
    status           = p_decision,
    decided_by_name  = p_decided_by_name,
    decided_by_email = p_decided_by_email,
    decided_at       = NOW(),
    decision_obs     = p_obs
  WHERE id = p_request_id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_bank_request(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION punch_time_record(
  p_date        DATE,
  p_step        TEXT,
  p_loc         JSONB DEFAULT NULL,
  p_selfie_path TEXT DEFAULT NULL
)
RETURNS time_records
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_employee_id UUID := my_employee_id();
  v_result      time_records;
BEGIN
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Usuário autenticado não é um colaborador com ponto habilitado';
  END IF;
  IF p_step NOT IN ('entrada', 'saida_almoco', 'retorno_almoco', 'saida') THEN
    RAISE EXCEPTION 'Etapa de ponto inválida: %', p_step;
  END IF;

  INSERT INTO time_records (employee_id, date)
  VALUES (v_employee_id, p_date)
  ON CONFLICT (employee_id, date) DO NOTHING;

  IF p_step = 'entrada' THEN
    UPDATE time_records SET entrada = now(), entrada_loc = p_loc, entrada_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSIF p_step = 'saida_almoco' THEN
    UPDATE time_records SET saida_almoco = now(), saida_almoco_loc = p_loc, saida_almoco_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSIF p_step = 'retorno_almoco' THEN
    UPDATE time_records SET retorno_almoco = now(), retorno_almoco_loc = p_loc, retorno_almoco_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  ELSE
    UPDATE time_records SET saida = now(), saida_loc = p_loc, saida_selfie_path = p_selfie_path
      WHERE employee_id = v_employee_id AND date = p_date
      RETURNING * INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION approve_adjustment_request(
  p_request_id       UUID,
  p_decision         TEXT,
  p_decided_by_name  TEXT DEFAULT NULL,
  p_decided_by_email TEXT DEFAULT NULL
)
RETURNS adjustment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req    adjustment_requests;
  v_col    TEXT;
  v_ts     TIMESTAMPTZ;
  v_exists BOOLEAN;
BEGIN
  IF p_decision NOT IN ('aprovado','rejeitado') THEN
    RAISE EXCEPTION 'Decisão inválida: %', p_decision;
  END IF;

  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Você não tem permissão para decidir esta solicitação';
  END IF;

  SELECT * INTO v_req FROM adjustment_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitação não encontrada';
  END IF;
  IF v_req.status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta solicitação já foi decidida';
  END IF;

  IF p_decision = 'aprovado' AND v_req.tipo <> 'falta' THEN
    IF v_req.horario IS NULL THEN
      RAISE EXCEPTION 'Solicitação sem horário informado';
    END IF;

    v_col := replace(v_req.tipo, '-', '_');
    v_ts := (v_req.date::TEXT || ' ' || v_req.horario::TEXT || ' America/Sao_Paulo')::TIMESTAMPTZ;

    SELECT EXISTS(
      SELECT 1 FROM time_records WHERE employee_id = v_req.employee_id AND date = v_req.date
    ) INTO v_exists;

    IF v_exists THEN
      EXECUTE format(
        'UPDATE time_records SET %I = $1, %I = true, ajustado = true WHERE employee_id = $2 AND date = $3',
        v_col, v_col || '_ajustado'
      ) USING v_ts, v_req.employee_id, v_req.date;
    ELSE
      EXECUTE format(
        'INSERT INTO time_records (employee_id, date, %I, %I, ajustado) VALUES ($1, $2, $3, true, true)',
        v_col, v_col || '_ajustado'
      ) USING v_req.employee_id, v_req.date, v_ts;
    END IF;

    INSERT INTO activity_logs (employee_id, tipo, acao, date, valor_registrado, operator_email, operator_name, operator_profile, justificativa)
    VALUES (
      v_req.employee_id, 'ajuste_ponto', v_req.tipo, v_req.date, v_ts,
      p_decided_by_email, COALESCE(p_decided_by_name, 'RH'), 'Administrador',
      'Ajuste de ponto aprovado: ' || v_req.justificativa
    );
  END IF;

  UPDATE adjustment_requests SET
    status           = p_decision,
    decided_by_name  = p_decided_by_name,
    decided_by_email = p_decided_by_email,
    decided_at       = NOW()
  WHERE id = p_request_id
  RETURNING * INTO v_req;

  RETURN v_req;
END;
$$;

GRANT EXECUTE ON FUNCTION approve_adjustment_request(UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION notify_alert_push(p_table TEXT, p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url         TEXT;
  v_service_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url         FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_service_key IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/send-alert-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body := jsonb_build_object('table', p_table, 'id', p_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION report_daily_overtime_alert(
  p_titulo   TEXT,
  p_mensagem TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id   UUID := my_employee_id();
  v_hoje     DATE := (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_existing burnout_alerts;
  v_alerta   JSONB;
  v_alert_id UUID;
BEGIN
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'Sem colaborador associado ao usuário autenticado';
  END IF;

  v_alerta := jsonb_build_object(
    'tipo', 'excesso_legal_diario', 'nivel', 'critico',
    'titulo', p_titulo, 'mensagem', p_mensagem
  );

  SELECT * INTO v_existing FROM burnout_alerts WHERE employee_id = v_emp_id AND date = v_hoje;

  IF FOUND THEN
    UPDATE burnout_alerts SET alertas = alertas || jsonb_build_array(v_alerta), lido = false
    WHERE id = v_existing.id
    RETURNING id INTO v_alert_id;
  ELSE
    INSERT INTO burnout_alerts (employee_id, date, alertas, lido)
    VALUES (v_emp_id, v_hoje, jsonb_build_array(v_alerta), false)
    RETURNING id INTO v_alert_id;
  END IF;

  PERFORM notify_alert_push('burnout_alerts', v_alert_id);
END;
$$;

GRANT EXECUTE ON FUNCTION report_daily_overtime_alert(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION generate_compliance_alerts()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje           DATE := (NOW() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_emp            RECORD;
  v_alertas        JSONB;
  v_n              INTEGER;
  v_cycle_start    DATE;
  v_cycle_end      DATE;
  v_concessivo     DATE;
  v_used_remaining INTEGER;
  v_expired_days   INTEGER;
  v_pending        INTEGER;
  v_diff_dias      INTEGER;
  v_existed        BOOLEAN;
  v_prev_lido      BOOLEAN;
  v_new_lido       BOOLEAN;
  v_alert_id       UUID;
BEGIN
  FOR v_emp IN
    SELECT id, admission_date, contract_type, is_probation, probation_end_date,
           is_aviso_previo, aviso_previo_end_date
    FROM employees
    WHERE status IN ('Ativo', 'ativo')
  LOOP
    v_alertas := '[]'::jsonb;

    IF v_emp.admission_date IS NOT NULL AND COALESCE(v_emp.contract_type, '') NOT IN ('estagio', 'estágio', 'aprendiz') THEN
      v_used_remaining := COALESCE((
        SELECT SUM(days) FROM vacations
        WHERE employee_id = v_emp.id AND status IN ('aprovado', 'concluido')
      ), 0);
      v_expired_days := 0;
      v_n := 0;
      LOOP
        v_cycle_start := (v_emp.admission_date + (v_n || ' years')::interval)::date;
        EXIT WHEN v_cycle_start > v_hoje;
        v_cycle_end := (v_emp.admission_date + ((v_n + 1) || ' years')::interval)::date - 1;
        IF v_cycle_end < v_hoje THEN
          v_pending := GREATEST(0, 30 - LEAST(v_used_remaining, 30));
          v_used_remaining := GREATEST(0, v_used_remaining - 30);
          IF v_pending > 0 THEN
            v_concessivo := (v_cycle_end + INTERVAL '1 year')::date;
            IF v_hoje > v_concessivo THEN
              v_expired_days := v_expired_days + v_pending;
            END IF;
          END IF;
        END IF;
        v_n := v_n + 1;
      END LOOP;
      IF v_expired_days > 0 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'ferias_vencidas', 'nivel', 'critico',
          'titulo', format('%s dia(s) de férias vencidas', v_expired_days),
          'mensagem', format('%s dia(s) de férias vencidas — risco de pagamento em dobro (CLT art. 137).', v_expired_days)
        ));
      END IF;
    END IF;

    IF v_emp.is_probation AND v_emp.probation_end_date IS NOT NULL THEN
      v_diff_dias := v_emp.probation_end_date - v_hoje;
      IF v_diff_dias <= 15 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'fim_experiencia',
          'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
          'titulo', CASE
            WHEN v_diff_dias < 0 THEN format('Experiência vencida há %sd', abs(v_diff_dias))
            WHEN v_diff_dias = 0 THEN 'Experiência vence hoje'
            ELSE format('Experiência vence em %sd', v_diff_dias)
          END
        ));
      END IF;
    END IF;

    IF v_emp.is_aviso_previo AND v_emp.aviso_previo_end_date IS NOT NULL THEN
      v_diff_dias := v_emp.aviso_previo_end_date - v_hoje;
      IF v_diff_dias <= 15 THEN
        v_alertas := v_alertas || jsonb_build_array(jsonb_build_object(
          'tipo', 'aviso_previo',
          'nivel', CASE WHEN v_diff_dias < 0 THEN 'critico' ELSE 'atencao' END,
          'titulo', CASE
            WHEN v_diff_dias < 0 THEN format('Aviso prévio venceu há %sd — regularizar desligamento', abs(v_diff_dias))
            WHEN v_diff_dias = 0 THEN 'Aviso prévio termina hoje'
            ELSE format('Aviso prévio termina em %sd', v_diff_dias)
          END
        ));
      END IF;
    END IF;

    IF jsonb_array_length(v_alertas) > 0 THEN
      SELECT lido INTO v_prev_lido FROM compliance_alerts WHERE employee_id = v_emp.id AND date = v_hoje;
      v_existed := FOUND;

      INSERT INTO compliance_alerts (employee_id, date, alertas, lido)
      VALUES (v_emp.id, v_hoje, v_alertas, false)
      ON CONFLICT (employee_id, date) DO UPDATE
        SET alertas = EXCLUDED.alertas,
            lido = CASE WHEN compliance_alerts.alertas = EXCLUDED.alertas THEN compliance_alerts.lido ELSE false END
      RETURNING id, lido INTO v_alert_id, v_new_lido;

      IF v_new_lido = false AND (NOT v_existed OR v_prev_lido IS DISTINCT FROM false) THEN
        PERFORM notify_alert_push('compliance_alerts', v_alert_id);
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

SELECT cron.schedule(
  'generate-compliance-alerts-daily',
  '0 9 * * *',
  $$SELECT generate_compliance_alerts();$$
);

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION dispatch_deferred_pushes()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg         RECORD;
  v_alert       RECORD;
  v_url         TEXT;
  v_service_key TEXT;
  v_hour        INT := extract(hour FROM NOW() AT TIME ZONE 'America/Sao_Paulo');
  v_dow         INT := extract(dow  FROM NOW() AT TIME ZONE 'America/Sao_Paulo');
BEGIN
  IF v_dow IN (0, 6) OR v_hour < 8 OR v_hour >= 18 THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_url         FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_url IS NULL OR v_service_key IS NULL THEN
    RETURN;
  END IF;

  FOR v_msg IN
    SELECT id FROM messages
    WHERE scheduled_at IS NOT NULL
      AND scheduled_at <= NOW()
      AND push_sent_at IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
  LOOP
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('message_id', v_msg.id)
    );
  END LOOP;

  FOR v_alert IN
    SELECT id FROM compliance_alerts
    WHERE push_scheduled_at IS NOT NULL
      AND push_scheduled_at <= NOW()
      AND push_sent_at IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
  LOOP
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-alert-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('table', 'compliance_alerts', 'id', v_alert.id)
    );
  END LOOP;

  FOR v_alert IN
    SELECT id FROM burnout_alerts
    WHERE push_scheduled_at IS NOT NULL
      AND push_scheduled_at <= NOW()
      AND push_sent_at IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
  LOOP
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/send-alert-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('table', 'burnout_alerts', 'id', v_alert.id)
    );
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'dispatch-deferred-pushes',
  '*/15 10-21 * * 1-5',
  $$SELECT dispatch_deferred_pushes();$$
);

CREATE OR REPLACE FUNCTION anonymize_employee(
  p_employee_id         UUID,
  p_anonymized_by_name  TEXT DEFAULT NULL,
  p_anonymized_by_email TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp   employees;
  v_label TEXT;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode anonimizar dados de um colaborador';
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado';
  END IF;
  IF v_emp.status <> 'Inativo' THEN
    RAISE EXCEPTION 'Só é possível anonimizar colaboradores desligados (status Inativo)';
  END IF;
  IF v_emp.cpf LIKE 'ANONIMIZADO-%' THEN
    RAISE EXCEPTION 'Este colaborador já teve os dados anonimizados';
  END IF;

  v_label := 'Ex-colaborador ' || substr(p_employee_id::text, 1, 8);

  UPDATE employees SET
    name             = v_label,
    cpf              = 'ANONIMIZADO-' || substr(p_employee_id::text, 1, 8),
    rg               = NULL,
    telefone         = NULL,
    email            = substr(p_employee_id::text, 1, 8) || '@anonimizado.local',
    birth_date       = NULL,
    gender           = NULL,
    raca_cor         = NULL,
    deficiencia      = NULL,
    chave_pix        = NULL,
    tipo_chave_pix   = NULL,
    banco            = NULL,
    tipo_conta       = NULL,
    agencia          = NULL,
    conta            = NULL,
    avatar_url       = NULL,
    bio              = NULL,
    auth_user_id     = NULL
  WHERE id = p_employee_id;

  INSERT INTO employee_audit (employee_id, changes, operator_name, operator_email)
  VALUES (
    p_employee_id,
    jsonb_build_array(jsonb_build_object(
      'field', 'lgpd_anonimizacao', 'label', 'Dados anonimizados a pedido do titular (LGPD art. 18, VI)',
      'oldValue', v_emp.name, 'newValue', v_label
    )),
    COALESCE(p_anonymized_by_name, 'RH'), p_anonymized_by_email
  );
END;
$$;

GRANT EXECUTE ON FUNCTION anonymize_employee(UUID, TEXT, TEXT) TO authenticated;

INSERT INTO chat_channels (name, slug, description, icon, dept) VALUES
  ('Geral',          'geral',         'Canal oficial da empresa para todos',          'globe',         NULL),
  ('Ideias',         'ideias',        'Compartilhe sugestões e inovações',            'lightbulb',     NULL),
  ('TI',             'ti',            'Comunicação do time de tecnologia',            'code',          'TI'),
  ('Financeiro',     'financeiro',    'Canal do time financeiro',                     'dollar-sign',   'Financeiro'),
  ('Marketing',      'marketing',     'Canal do time de marketing',                   'bullhorn',      'Marketing'),
  ('Jurídico',       'juridico',      'Canal da equipe jurídica',                     'gavel',         'Jurídico'),
  ('Administrativo', 'administrativo','Canal administrativo',                         'building',      'Administrativo')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO document_requirements (category, tipo, obrigatorio) VALUES
  ('admissional','RG', true),
  ('admissional','CPF', true),
  ('admissional','Comprovante de Residência', true),
  ('admissional','Exame Admissional', true),
  ('admissional','Carteira de Trabalho', true),
  ('admissional','Contrato de Trabalho', true),
  ('demissional','Aviso Prévio', true),
  ('demissional','Termo de Rescisão', true),
  ('demissional','Exame Demissional', true),
  ('demissional','Homologação', true),
  ('demissional','Guia FGTS', true)
ON CONFLICT (category, tipo) DO NOTHING;

INSERT INTO holidays (date, name, abrangencia) VALUES
  ('2026-01-01', 'Confraternização Universal',    'nacional'),
  ('2026-02-16', 'Carnaval (Segunda-feira)',      'facultativo'),
  ('2026-02-17', 'Carnaval (Terça-feira)',        'facultativo'),
  ('2026-04-03', 'Sexta-feira Santa',             'nacional'),
  ('2026-04-21', 'Tiradentes',                    'nacional'),
  ('2026-05-01', 'Dia do Trabalho',                'nacional'),
  ('2026-06-04', 'Corpus Christi',                 'facultativo'),
  ('2026-09-07', 'Independência do Brasil',        'nacional'),
  ('2026-10-12', 'Nossa Senhora Aparecida',        'nacional'),
  ('2026-11-02', 'Finados',                        'nacional'),
  ('2026-11-15', 'Proclamação da República',       'nacional'),
  ('2026-11-20', 'Consciência Negra', 'nacional'),
  ('2026-12-25', 'Natal',                          'nacional')
ON CONFLICT (date) DO NOTHING;

INSERT INTO hr_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

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

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS nexus_key_store (
  name   TEXT PRIMARY KEY,
  secret TEXT NOT NULL
);
ALTER TABLE nexus_key_store ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexus_key_store FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_name TEXT;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'Vault indisponível: as chaves de cifragem devem ser inseridas em nexus_key_store.';
    RETURN;
  END IF;
  FOREACH v_name IN ARRAY ARRAY['data_encryption_key', 'data_hmac_key'] LOOP
    IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = v_name) THEN
      BEGIN
        PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), v_name, 'Cifragem de colunas sensíveis (Nexus)');
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Não foi possível criar o segredo % no Vault (%). Crie manualmente: select vault.create_secret(<valor aleatório>, ''%'');', v_name, SQLERRM, v_name;
      END;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION nexus_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
  END IF;
  IF v_secret IS NULL THEN
    SELECT secret INTO v_secret FROM nexus_key_store WHERE name = p_name;
  END IF;
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Chave de cifragem % não configurada', p_name USING ERRCODE = 'P0001';
  END IF;
  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_wrap(p_context TEXT, p_plain TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_plain IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_plain LIKE 'nexus:enc1:%' THEN
    RETURN p_plain;
  END IF;
  RETURN 'nexus:enc1:' || encode(
    pgp_sym_encrypt(p_context || chr(31) || p_plain, nexus_secret('data_encryption_key'), 'cipher-algo=aes256, compress-algo=0, s2k-mode=1'),
    'base64'
  );
END;
$$;

CREATE OR REPLACE FUNCTION nexus_unwrap(p_context TEXT, p_cipher TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT;
  v_sep   INT;
BEGIN
  IF p_cipher IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_cipher NOT LIKE 'nexus:enc1:%' THEN
    RETURN p_cipher;
  END IF;
  BEGIN
    v_plain := pgp_sym_decrypt(decode(substr(p_cipher, 12), 'base64'), nexus_secret('data_encryption_key'));
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  v_sep := position(chr(31) IN v_plain);
  IF v_sep = 0 OR left(v_plain, v_sep - 1) <> p_context THEN
    RETURN NULL;
  END IF;
  RETURN substr(v_plain, v_sep + 1);
END;
$$;

CREATE OR REPLACE FUNCTION nexus_decrypt_ctx(p_context TEXT, p_cipher TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_kind TEXT := split_part(p_context, ':', 1);
  v_id   UUID;
  v_ok   BOOLEAN := FALSE;
BEGIN
  IF p_cipher IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_id := split_part(p_context, ':', 2)::UUID;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  IF v_kind = 'emp' THEN
    v_ok := is_rh() OR v_id = my_employee_id();
  ELSIF v_kind = 'chan' THEN
    v_ok := (is_rh() AND NOT chat_channel_is_dm(v_id)) OR chat_is_member(v_id);
  ELSIF v_kind = 'tkt' THEN
    v_ok := is_rh() OR EXISTS (SELECT 1 FROM hr_tickets t WHERE t.id = v_id AND t.employee_id = my_employee_id());
  END IF;

  IF NOT COALESCE(v_ok, FALSE) THEN
    RETURN NULL;
  END IF;
  RETURN nexus_unwrap(p_context, p_cipher);
END;
$$;

CREATE OR REPLACE FUNCTION nexus_decrypt_ctx_numeric(p_context TEXT, p_cipher TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT := nexus_decrypt_ctx(p_context, p_cipher);
BEGIN
  IF v_plain IS NULL OR v_plain !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RETURN NULL;
  END IF;
  RETURN v_plain::NUMERIC;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_blind_index(p_plain TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_plain IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN encode(hmac(regexp_replace(p_plain, '[.[:space:]/-]', '', 'g'), nexus_secret('data_hmac_key'), 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION nexus_secret(TEXT)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_wrap(TEXT, TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_unwrap(TEXT, TEXT)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_blind_index(TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_decrypt_ctx(TEXT, TEXT)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nexus_decrypt_ctx_numeric(TEXT, TEXT)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx(TEXT, TEXT)         TO authenticated;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx_numeric(TEXT, TEXT) TO authenticated;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS notif_prefs JSONB;

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'salary') <> 'text' THEN
    ALTER TABLE employees ALTER COLUMN salary TYPE TEXT USING salary::TEXT;
  END IF;
END $$;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS cpf_hash TEXT;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_cpf_key;

CREATE OR REPLACE FUNCTION employees_encrypt_sensitive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'emp:' || NEW.id::TEXT;
BEGIN
  IF NEW.salary IS NOT NULL AND NEW.salary NOT LIKE 'nexus:enc1:%' THEN
    IF NEW.salary !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Salário inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.salary := (NEW.salary::NUMERIC(10, 2))::TEXT;
  END IF;

  NEW.cpf_hash  := nexus_blind_index(nexus_unwrap(v_ctx, NEW.cpf));
  NEW.cpf       := nexus_wrap(v_ctx, NEW.cpf);
  NEW.rg        := nexus_wrap(v_ctx, NEW.rg);
  NEW.telefone  := nexus_wrap(v_ctx, NEW.telefone);
  NEW.salary    := nexus_wrap(v_ctx, NEW.salary);
  NEW.chave_pix := nexus_wrap(v_ctx, NEW.chave_pix);
  NEW.agencia   := nexus_wrap(v_ctx, NEW.agencia);
  NEW.conta     := nexus_wrap(v_ctx, NEW.conta);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_encrypt_sensitive_trg ON employees;
CREATE TRIGGER employees_encrypt_sensitive_trg
  BEFORE INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_encrypt_sensitive();

REVOKE ALL ON FUNCTION employees_encrypt_sensitive() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION chat_messages_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.content := nexus_wrap('chan:' || NEW.channel_id::TEXT, NEW.content);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hr_ticket_messages_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.content := nexus_wrap('tkt:' || NEW.ticket_id::TEXT, NEW.content);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION chat_messages_encrypt()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hr_ticket_messages_encrypt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS chat_messages_encrypt_trg ON chat_messages;
CREATE TRIGGER chat_messages_encrypt_trg
  BEFORE INSERT OR UPDATE OF content ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_encrypt();

DROP TRIGGER IF EXISTS hr_ticket_messages_encrypt_trg ON hr_ticket_messages;
CREATE TRIGGER hr_ticket_messages_encrypt_trg
  BEFORE INSERT OR UPDATE OF content ON hr_ticket_messages
  FOR EACH ROW EXECUTE FUNCTION hr_ticket_messages_encrypt();

ALTER TABLE employees DISABLE TRIGGER employees_updated_at;
UPDATE employees SET cpf = cpf;
ALTER TABLE employees ENABLE TRIGGER employees_updated_at;

UPDATE chat_messages SET content = content;
UPDATE hr_ticket_messages SET content = content;

ALTER TABLE employees ALTER COLUMN cpf_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_cpf_hash_key ON employees(cpf_hash);

CREATE OR REPLACE FUNCTION nexus_refresh_employees_view()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cols TEXT;
BEGIN
  SELECT string_agg(
           CASE a.attname
             WHEN 'salary' THEN 'nexus_decrypt_ctx_numeric(''emp:'' || e.id::text, e.salary) AS salary'
             WHEN 'cpf'       THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.cpf) AS cpf'
             WHEN 'rg'        THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.rg) AS rg'
             WHEN 'telefone'  THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.telefone) AS telefone'
             WHEN 'chave_pix' THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.chave_pix) AS chave_pix'
             WHEN 'agencia'   THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.agencia) AS agencia'
             WHEN 'conta'     THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.conta) AS conta'
             ELSE format('e.%I', a.attname)
           END,
           ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.employees'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attname <> 'cpf_hash';

  DROP VIEW IF EXISTS public.employees_decrypted;
  EXECUTE format('CREATE VIEW public.employees_decrypted WITH (security_invoker = true) AS SELECT %s FROM public.employees e', v_cols);

  REVOKE ALL ON public.employees_decrypted FROM PUBLIC, anon;
  GRANT SELECT ON public.employees_decrypted TO authenticated;
END;
$$;

REVOKE ALL ON FUNCTION nexus_refresh_employees_view() FROM PUBLIC, anon, authenticated;

SELECT nexus_refresh_employees_view();

DROP VIEW IF EXISTS chat_messages_decrypted;
CREATE VIEW chat_messages_decrypted WITH (security_invoker = true) AS
  SELECT m.id, m.channel_id, m.employee_id, nexus_decrypt_ctx('chan:' || m.channel_id::text, m.content) AS content, m.created_at
    FROM chat_messages m;

DROP VIEW IF EXISTS hr_ticket_messages_decrypted;
CREATE VIEW hr_ticket_messages_decrypted WITH (security_invoker = true) AS
  SELECT m.id, m.ticket_id, m.employee_id, m.role, nexus_decrypt_ctx('tkt:' || m.ticket_id::text, m.content) AS content, m.created_at
    FROM hr_ticket_messages m;

REVOKE ALL ON chat_messages_decrypted, hr_ticket_messages_decrypted FROM PUBLIC, anon;
GRANT SELECT ON chat_messages_decrypted, hr_ticket_messages_decrypted TO authenticated;

CREATE OR REPLACE FUNCTION anonymize_employee(
  p_employee_id         UUID,
  p_anonymized_by_name  TEXT DEFAULT NULL,
  p_anonymized_by_email TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp   employees;
  v_label TEXT;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode anonimizar dados de um colaborador';
  END IF;

  SELECT * INTO v_emp FROM employees WHERE id = p_employee_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Colaborador não encontrado';
  END IF;
  IF v_emp.status <> 'Inativo' THEN
    RAISE EXCEPTION 'Só é possível anonimizar colaboradores desligados (status Inativo)';
  END IF;
  IF nexus_unwrap('emp:' || p_employee_id::text, v_emp.cpf) LIKE 'ANONIMIZADO-%' THEN
    RAISE EXCEPTION 'Este colaborador já teve os dados anonimizados';
  END IF;

  v_label := 'Ex-colaborador ' || substr(p_employee_id::text, 1, 8);

  UPDATE employees SET
    name             = v_label,
    cpf              = 'ANONIMIZADO-' || substr(p_employee_id::text, 1, 8),
    rg               = NULL,
    telefone         = NULL,
    email            = substr(p_employee_id::text, 1, 8) || '@anonimizado.local',
    birth_date       = NULL,
    gender           = NULL,
    raca_cor         = NULL,
    deficiencia      = NULL,
    chave_pix        = NULL,
    tipo_chave_pix   = NULL,
    banco            = NULL,
    tipo_conta       = NULL,
    agencia          = NULL,
    conta            = NULL,
    avatar_url       = NULL,
    bio              = NULL,
    auth_user_id     = NULL
  WHERE id = p_employee_id;

  INSERT INTO employee_audit (employee_id, changes, operator_name, operator_email)
  VALUES (
    p_employee_id,
    jsonb_build_array(jsonb_build_object(
      'field', 'lgpd_anonimizacao', 'label', 'Dados anonimizados a pedido do titular (LGPD art. 18, VI)',
      'oldValue', v_emp.name, 'newValue', v_label
    )),
    COALESCE(p_anonymized_by_name, 'RH'), p_anonymized_by_email
  );
END;
$$;

GRANT EXECUTE ON FUNCTION anonymize_employee(UUID, TEXT, TEXT) TO authenticated;

DROP POLICY IF EXISTS "colabo_employees_update_own" ON employees;
CREATE POLICY "colabo_employees_update_own" ON employees FOR UPDATE
  USING (id = my_employee_id())
  WITH CHECK (id = my_employee_id());

CREATE OR REPLACE FUNCTION employees_self_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_editable CONSTANT TEXT[] := ARRAY['name', 'telefone', 'bio', 'avatar_url', 'avatar_color', 'notif_prefs', 'last_access', 'updated_at'];
BEGIN
  IF auth.uid() IS NULL OR is_rh() THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_editable) IS DISTINCT FROM (to_jsonb(OLD) - v_editable) THEN
    RAISE EXCEPTION 'Você só pode alterar nome, telefone, bio e avatar do seu perfil. Os demais dados são gerenciados pelo RH.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employees_self_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employees_self_update_guard_trg ON employees;
CREATE TRIGGER employees_self_update_guard_trg
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_self_update_guard();

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION rate_limit_check(p_action TEXT, p_max INTEGER, p_window_seconds INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_key  TEXT;
  v_hits INTEGER;
BEGIN
  IF v_uid IS NULL OR p_action IS NULL OR p_max IS NULL OR p_max < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RETURN FALSE;
  END IF;

  v_key := v_uid::TEXT || ':' || p_action;

  INSERT INTO rate_limits AS r (key, window_start, hits)
  VALUES (v_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN r.window_start < now() - make_interval(secs => p_window_seconds) THEN now() ELSE r.window_start END,
    hits         = CASE WHEN r.window_start < now() - make_interval(secs => p_window_seconds) THEN 1 ELSE r.hits + 1 END
  RETURNING hits INTO v_hits;

  RETURN v_hits <= p_max;
END;
$$;

REVOKE ALL ON FUNCTION rate_limit_check(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rate_limit_check(TEXT, INTEGER, INTEGER) TO authenticated;

DROP VIEW IF EXISTS public.employees_decrypted;

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'birth_date') <> 'text' THEN
    ALTER TABLE employees ALTER COLUMN birth_date TYPE TEXT USING birth_date::TEXT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION nexus_decrypt_ctx_date(p_context TEXT, p_cipher TEXT)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT := nexus_decrypt_ctx(p_context, p_cipher);
BEGIN
  IF v_plain IS NULL OR v_plain !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_plain::DATE;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION nexus_decrypt_ctx_date(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx_date(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION employees_encrypt_sensitive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'emp:' || NEW.id::TEXT;
BEGIN
  IF NEW.salary IS NOT NULL AND NEW.salary NOT LIKE 'nexus:enc1:%' THEN
    IF NEW.salary !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Salário inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.salary := (NEW.salary::NUMERIC(10, 2))::TEXT;
  END IF;

  IF NEW.birth_date IS NOT NULL AND NEW.birth_date NOT LIKE 'nexus:enc1:%' THEN
    IF NEW.birth_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
      RAISE EXCEPTION 'Data de nascimento inválida' USING ERRCODE = '22007';
    END IF;
    NEW.birth_date := (left(NEW.birth_date, 10)::DATE)::TEXT;
  END IF;

  NEW.cpf_hash     := nexus_blind_index(nexus_unwrap(v_ctx, NEW.cpf));
  NEW.cpf          := nexus_wrap(v_ctx, NEW.cpf);
  NEW.rg           := nexus_wrap(v_ctx, NEW.rg);
  NEW.telefone     := nexus_wrap(v_ctx, NEW.telefone);
  NEW.salary       := nexus_wrap(v_ctx, NEW.salary);
  NEW.chave_pix    := nexus_wrap(v_ctx, NEW.chave_pix);
  NEW.agencia      := nexus_wrap(v_ctx, NEW.agencia);
  NEW.conta        := nexus_wrap(v_ctx, NEW.conta);
  NEW.birth_date   := nexus_wrap(v_ctx, NEW.birth_date);
  NEW.gender       := nexus_wrap(v_ctx, NEW.gender);
  NEW.raca_cor     := nexus_wrap(v_ctx, NEW.raca_cor);
  NEW.deficiencia  := nexus_wrap(v_ctx, NEW.deficiencia);
  NEW.tipo_pensao  := nexus_wrap(v_ctx, NEW.tipo_pensao);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_refresh_employees_view()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cols TEXT;
BEGIN
  SELECT string_agg(
           CASE a.attname
             WHEN 'salary'     THEN 'nexus_decrypt_ctx_numeric(''emp:'' || e.id::text, e.salary) AS salary'
             WHEN 'birth_date' THEN 'nexus_decrypt_ctx_date(''emp:'' || e.id::text, e.birth_date) AS birth_date'
             WHEN 'cpf'         THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.cpf) AS cpf'
             WHEN 'rg'          THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.rg) AS rg'
             WHEN 'telefone'    THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.telefone) AS telefone'
             WHEN 'chave_pix'   THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.chave_pix) AS chave_pix'
             WHEN 'agencia'     THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.agencia) AS agencia'
             WHEN 'conta'       THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.conta) AS conta'
             WHEN 'gender'      THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.gender) AS gender'
             WHEN 'raca_cor'    THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.raca_cor) AS raca_cor'
             WHEN 'deficiencia' THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.deficiencia) AS deficiencia'
             WHEN 'tipo_pensao' THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.tipo_pensao) AS tipo_pensao'
             ELSE format('e.%I', a.attname)
           END,
           ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.employees'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped
     AND a.attname <> 'cpf_hash';

  DROP VIEW IF EXISTS public.employees_decrypted;
  EXECUTE format('CREATE VIEW public.employees_decrypted WITH (security_invoker = true) AS SELECT %s FROM public.employees e', v_cols);

  REVOKE ALL ON public.employees_decrypted FROM PUBLIC, anon;
  GRANT SELECT ON public.employees_decrypted TO authenticated;
END;
$$;

REVOKE ALL ON FUNCTION nexus_refresh_employees_view() FROM PUBLIC, anon, authenticated;

ALTER TABLE employees DISABLE TRIGGER employees_updated_at;
UPDATE employees SET cpf = cpf;
ALTER TABLE employees ENABLE TRIGGER employees_updated_at;

SELECT nexus_refresh_employees_view();