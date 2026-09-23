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
  contract_type TEXT NOT NULL DEFAULT 'CLT' CHECK (contract_type IN ('CLT','Estágio','Aprendiz','Temporário','PJ')),
  CONSTRAINT document_requirements_category_tipo_contract_key UNIQUE (category, tipo, contract_type)
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

CREATE POLICY "kudos_read_all"   ON kudos FOR SELECT TO authenticated USING (true);
CREATE POLICY "kudos_colab_give" ON kudos FOR INSERT WITH CHECK (from_employee_id = my_employee_id());
CREATE POLICY "kudos_rh_all"     ON kudos FOR ALL    USING (is_rh());

CREATE POLICY "anon_feedback_colab_insert" ON anonymous_feedback FOR INSERT
  WITH CHECK (my_employee_id() IS NOT NULL);

CREATE POLICY "anon_feedback_rh_all" ON anonymous_feedback FOR ALL USING (is_rh());

CREATE POLICY "onboarding_tasks_read_all" ON onboarding_tasks FOR SELECT TO authenticated USING (true);
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
  WHERE status = 'Ativo' AND auth.uid() IS NOT NULL;
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

  IF v_employee_id IS NULL OR v_employee_id IS DISTINCT FROM my_employee_id() THEN
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

  IF v_employee_id IS NULL OR v_employee_id IS DISTINCT FROM my_employee_id() THEN
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
ON CONFLICT (category, tipo, contract_type) DO NOTHING;

INSERT INTO document_requirements (category, tipo, obrigatorio, contract_type) VALUES
  -- Estágio (Lei 11.788/2008)
  ('admissional', 'RG',                                  true, 'Estágio'),
  ('admissional', 'CPF',                                 true, 'Estágio'),
  ('admissional', 'Comprovante de Residência',           true, 'Estágio'),
  ('admissional', 'Termo de Compromisso de Estágio',     true, 'Estágio'),
  ('admissional', 'Plano de Atividades de Estágio',      true, 'Estágio'),
  ('admissional', 'Comprovante de Matrícula e Frequência', true, 'Estágio'),
  ('admissional', 'Apólice de Seguro de Acidentes Pessoais', true, 'Estágio'),
  ('demissional', 'Termo de Realização do Estágio',      true, 'Estágio'),
  -- Aprendiz (CLT, arts. 428 a 433)
  ('admissional', 'RG',                                  true, 'Aprendiz'),
  ('admissional', 'CPF',                                 true, 'Aprendiz'),
  ('admissional', 'Comprovante de Residência',           true, 'Aprendiz'),
  ('admissional', 'Carteira de Trabalho',                true, 'Aprendiz'),
  ('admissional', 'Contrato de Trabalho',                true, 'Aprendiz'),
  ('admissional', 'Ficha de Registro do Empregado',      true, 'Aprendiz'),
  ('admissional', 'Exame Admissional',                   true, 'Aprendiz'),
  ('admissional', 'Comprovante de Matrícula e Frequência', true, 'Aprendiz'),
  ('demissional', 'Termo de Rescisão',                   true, 'Aprendiz'),
  ('demissional', 'Exame Demissional',                   true, 'Aprendiz'),
  ('demissional', 'Guia FGTS',                           true, 'Aprendiz'),
  -- Temporário (Lei 6.019/1974; CLT, art. 443): prazo determinado, sem aviso prévio
  ('admissional', 'RG',                                  true, 'Temporário'),
  ('admissional', 'CPF',                                 true, 'Temporário'),
  ('admissional', 'Comprovante de Residência',           true, 'Temporário'),
  ('admissional', 'Carteira de Trabalho',                true, 'Temporário'),
  ('admissional', 'Contrato de Trabalho',                true, 'Temporário'),
  ('admissional', 'Ficha de Registro do Empregado',      true, 'Temporário'),
  ('admissional', 'Exame Admissional',                   true, 'Temporário'),
  ('demissional', 'Termo de Rescisão',                   true, 'Temporário'),
  ('demissional', 'Exame Demissional',                   true, 'Temporário'),
  ('demissional', 'Guia FGTS',                           true, 'Temporário'),
  -- PJ (Código Civil, arts. 593 a 609): sem vínculo empregatício, sem checklist demissional
  ('admissional', 'Contrato de Prestação de Serviços',   true, 'PJ'),
  ('admissional', 'Cartão CNPJ',                         true, 'PJ'),
  ('admissional', 'RG',                                  true, 'PJ'),
  ('admissional', 'CPF',                                 true, 'PJ')
ON CONFLICT (category, tipo, contract_type) DO NOTHING;

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

CREATE OR REPLACE FUNCTION public.mfa_ok()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'aal', '') = 'aal2' THEN
    RETURN TRUE;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified') THEN
    RETURN FALSE;
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.profile = 'Administrador');
END;
$$;

REVOKE ALL ON FUNCTION public.mfa_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_ok() TO authenticated;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relname <> 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t.relname);
    EXECUTE format('CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()))', t.relname);
  END LOOP;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS mfa_required ON storage.objects;
    CREATE POLICY mfa_required ON storage.objects AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()));
  END IF;
END $$;

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

  IF v_kind = 'ai' THEN
    IF NOT is_rh() THEN
      RETURN NULL;
    END IF;
    RETURN nexus_unwrap(p_context, p_cipher);
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
  ELSIF v_kind = 'slip' THEN
    v_ok := is_rh() OR v_id = my_employee_id();
  ELSIF v_kind = 'fb' THEN
    v_ok := is_rh();
  ELSIF v_kind = 'ail' THEN
    v_ok := is_rh() OR EXISTS (SELECT 1 FROM ai_decision_log l WHERE l.id = v_id AND l.employee_id = my_employee_id());
  END IF;

  IF NOT COALESCE(v_ok, FALSE) THEN
    RETURN NULL;
  END IF;
  RETURN nexus_unwrap(p_context, p_cipher);
END;
$$;

CREATE OR REPLACE FUNCTION nexus_decrypt_ctx_bool(p_context TEXT, p_cipher TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT := nexus_decrypt_ctx(p_context, p_cipher);
BEGIN
  IF v_plain IN ('true', 'false') THEN
    RETURN v_plain::BOOLEAN;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_decrypt_ctx_jsonb(p_context TEXT, p_cipher TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_plain TEXT := nexus_decrypt_ctx(p_context, p_cipher);
BEGIN
  IF v_plain IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_plain::JSONB;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION nexus_decrypt_ctx(TEXT, TEXT)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nexus_decrypt_ctx_bool(TEXT, TEXT)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nexus_decrypt_ctx_jsonb(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx(TEXT, TEXT)       TO authenticated;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx_bool(TEXT, TEXT)  TO authenticated;
GRANT EXECUTE ON FUNCTION nexus_decrypt_ctx_jsonb(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION nexus_norm_money(p_label TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_value IS NULL OR p_value LIKE 'nexus:enc1:%' THEN
    RETURN p_value;
  END IF;
  IF p_value !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION '% inválido', p_label USING ERRCODE = '22P02';
  END IF;
  RETURN (p_value::NUMERIC(10, 2))::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_norm_json(p_label TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_value IS NULL OR p_value LIKE 'nexus:enc1:%' THEN
    RETURN p_value;
  END IF;
  RETURN p_value::JSONB::TEXT;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION '% inválido', p_label USING ERRCODE = '22P02';
END;
$$;

REVOKE ALL ON FUNCTION nexus_norm_money(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_norm_json(TEXT, TEXT)  FROM PUBLIC, anon, authenticated;

DROP VIEW IF EXISTS public.employees_decrypted;

DO $$
DECLARE
  v_col TEXT;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['pcd', 'pensao_alimenticia'] LOOP
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = v_col) <> 'text' THEN
      EXECUTE format('ALTER TABLE employees ALTER COLUMN %I DROP DEFAULT', v_col);
      EXECUTE format('ALTER TABLE employees ALTER COLUMN %I TYPE TEXT USING %I::TEXT', v_col, v_col);
      EXECUTE format('ALTER TABLE employees ALTER COLUMN %I SET DEFAULT ''false''', v_col);
    END IF;
  END LOOP;
END $$;

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

  IF NEW.pcd IS NOT NULL AND NEW.pcd NOT LIKE 'nexus:enc1:%' THEN
    IF lower(NEW.pcd) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Indicador PcD inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.pcd := lower(NEW.pcd);
  END IF;

  IF NEW.pensao_alimenticia IS NOT NULL AND NEW.pensao_alimenticia NOT LIKE 'nexus:enc1:%' THEN
    IF lower(NEW.pensao_alimenticia) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Indicador de pensão alimentícia inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.pensao_alimenticia := lower(NEW.pensao_alimenticia);
  END IF;

  NEW.cpf_hash           := nexus_blind_index(nexus_unwrap(v_ctx, NEW.cpf));
  NEW.cpf                := nexus_wrap(v_ctx, NEW.cpf);
  NEW.rg                 := nexus_wrap(v_ctx, NEW.rg);
  NEW.telefone           := nexus_wrap(v_ctx, NEW.telefone);
  NEW.salary             := nexus_wrap(v_ctx, NEW.salary);
  NEW.chave_pix          := nexus_wrap(v_ctx, NEW.chave_pix);
  NEW.agencia            := nexus_wrap(v_ctx, NEW.agencia);
  NEW.conta              := nexus_wrap(v_ctx, NEW.conta);
  NEW.birth_date         := nexus_wrap(v_ctx, NEW.birth_date);
  NEW.gender             := nexus_wrap(v_ctx, NEW.gender);
  NEW.raca_cor           := nexus_wrap(v_ctx, NEW.raca_cor);
  NEW.deficiencia        := nexus_wrap(v_ctx, NEW.deficiencia);
  NEW.tipo_pensao        := nexus_wrap(v_ctx, NEW.tipo_pensao);
  NEW.pcd                := nexus_wrap(v_ctx, NEW.pcd);
  NEW.pensao_alimenticia := nexus_wrap(v_ctx, NEW.pensao_alimenticia);
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
             WHEN 'salary'             THEN 'nexus_decrypt_ctx_numeric(''emp:'' || e.id::text, e.salary) AS salary'
             WHEN 'birth_date'         THEN 'nexus_decrypt_ctx_date(''emp:'' || e.id::text, e.birth_date) AS birth_date'
             WHEN 'pcd'                THEN 'nexus_decrypt_ctx_bool(''emp:'' || e.id::text, e.pcd) AS pcd'
             WHEN 'pensao_alimenticia' THEN 'nexus_decrypt_ctx_bool(''emp:'' || e.id::text, e.pensao_alimenticia) AS pensao_alimenticia'
             WHEN 'cpf'                THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.cpf) AS cpf'
             WHEN 'rg'                 THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.rg) AS rg'
             WHEN 'telefone'           THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.telefone) AS telefone'
             WHEN 'chave_pix'          THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.chave_pix) AS chave_pix'
             WHEN 'agencia'            THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.agencia) AS agencia'
             WHEN 'conta'              THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.conta) AS conta'
             WHEN 'gender'             THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.gender) AS gender'
             WHEN 'raca_cor'           THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.raca_cor) AS raca_cor'
             WHEN 'deficiencia'        THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.deficiencia) AS deficiencia'
             WHEN 'tipo_pensao'        THEN 'nexus_decrypt_ctx(''emp:'' || e.id::text, e.tipo_pensao) AS tipo_pensao'
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

DO $$
DECLARE
  v_col TEXT;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['proventos', 'descontos', 'total_proventos', 'total_descontos', 'salario_liquido'] LOOP
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'payslips' AND column_name = v_col) <> 'text' THEN
      EXECUTE format('ALTER TABLE payslips ALTER COLUMN %I TYPE TEXT USING %I::TEXT', v_col, v_col);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION payslips_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'slip:' || NEW.employee_id::TEXT || ':' || NEW.mes || ':';
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.mes IS DISTINCT FROM OLD.mes) THEN
    RAISE EXCEPTION 'Um holerite não pode mudar de colaborador nem de mês' USING ERRCODE = '42501';
  END IF;

  NEW.proventos       := nexus_wrap(v_ctx || 'proventos',       nexus_norm_json('Proventos', NEW.proventos));
  NEW.descontos       := nexus_wrap(v_ctx || 'descontos',       nexus_norm_json('Descontos', NEW.descontos));
  NEW.total_proventos := nexus_wrap(v_ctx || 'total_proventos', nexus_norm_money('Total de proventos', NEW.total_proventos));
  NEW.total_descontos := nexus_wrap(v_ctx || 'total_descontos', nexus_norm_money('Total de descontos', NEW.total_descontos));
  NEW.salario_liquido := nexus_wrap(v_ctx || 'salario_liquido', nexus_norm_money('Salário líquido', NEW.salario_liquido));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION payslips_encrypt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payslips_encrypt_trg ON payslips;
CREATE TRIGGER payslips_encrypt_trg
  BEFORE INSERT OR UPDATE ON payslips
  FOR EACH ROW EXECUTE FUNCTION payslips_encrypt();

UPDATE payslips SET proventos = proventos;

DROP VIEW IF EXISTS payslips_decrypted;
CREATE VIEW payslips_decrypted WITH (security_invoker = true) AS
  SELECT p.id, p.employee_id, p.mes, p.mes_formatado, p.competencia,
         nexus_decrypt_ctx_jsonb('slip:' || p.employee_id::text || ':' || p.mes || ':proventos', p.proventos) AS proventos,
         nexus_decrypt_ctx_jsonb('slip:' || p.employee_id::text || ':' || p.mes || ':descontos', p.descontos) AS descontos,
         nexus_decrypt_ctx_numeric('slip:' || p.employee_id::text || ':' || p.mes || ':total_proventos', p.total_proventos) AS total_proventos,
         nexus_decrypt_ctx_numeric('slip:' || p.employee_id::text || ':' || p.mes || ':total_descontos', p.total_descontos) AS total_descontos,
         nexus_decrypt_ctx_numeric('slip:' || p.employee_id::text || ':' || p.mes || ':salario_liquido', p.salario_liquido) AS salario_liquido,
         p.status, p.pago_em, p.created_by, p.created_at, p.assinado_em, p.assinado_por
    FROM payslips p;

CREATE OR REPLACE FUNCTION anonymous_feedback_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.message := nexus_wrap('fb:' || NEW.id::TEXT || ':message', NEW.message);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION anonymous_feedback_encrypt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS anonymous_feedback_encrypt_trg ON anonymous_feedback;
CREATE TRIGGER anonymous_feedback_encrypt_trg
  BEFORE INSERT OR UPDATE OF message ON anonymous_feedback
  FOR EACH ROW EXECUTE FUNCTION anonymous_feedback_encrypt();

UPDATE anonymous_feedback SET message = message;

DROP VIEW IF EXISTS anonymous_feedback_decrypted;
CREATE VIEW anonymous_feedback_decrypted WITH (security_invoker = true) AS
  SELECT f.id, f.categoria, nexus_decrypt_ctx('fb:' || f.id::text || ':message', f.message) AS message, f.status, f.created_at
    FROM anonymous_feedback f;

DO $$
DECLARE
  v_spec TEXT[];
BEGIN
  FOREACH v_spec SLICE 1 IN ARRAY ARRAY[
    ARRAY['ai_analysis_cache',   'alerts',   '''[]'''],
    ARRAY['ai_analysis_history', 'alerts',   '''[]'''],
    ARRAY['ai_decision_log',     'evidence', NULL]
  ] LOOP
    IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = v_spec[1] AND column_name = v_spec[2]) <> 'text' THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', v_spec[1], v_spec[2]);
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TEXT USING %I::TEXT', v_spec[1], v_spec[2], v_spec[2]);
      IF v_spec[3] IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %s', v_spec[1], v_spec[2], v_spec[3]);
      END IF;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION ai_analysis_cache_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'ai:cache:' || NEW.cache_key || ':';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cache_key IS DISTINCT FROM OLD.cache_key THEN
    RAISE EXCEPTION 'A chave do cache de análise não pode mudar' USING ERRCODE = '42501';
  END IF;
  NEW.summary := nexus_wrap(v_ctx || 'summary', NEW.summary);
  NEW.alerts  := nexus_wrap(v_ctx || 'alerts', nexus_norm_json('Alertas', NEW.alerts));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_analysis_history_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'ai:hist:' || NEW.id::TEXT || ':';
BEGIN
  NEW.summary := nexus_wrap(v_ctx || 'summary', NEW.summary);
  NEW.alerts  := nexus_wrap(v_ctx || 'alerts', nexus_norm_json('Alertas', NEW.alerts));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_chat_history_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.content := nexus_wrap('ai:chat:' || NEW.id::TEXT || ':content', NEW.content);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_decision_memory_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  NEW.description := nexus_wrap('ai:mem:' || NEW.id::TEXT || ':description', NEW.description);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ai_decision_log_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'ail:' || NEW.id::TEXT || ':';
BEGIN
  NEW.ai_message := nexus_wrap(v_ctx || 'ai_message', NEW.ai_message);
  NEW.evidence   := nexus_wrap(v_ctx || 'evidence', nexus_norm_json('Evidências', NEW.evidence));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ai_analysis_cache_encrypt()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_analysis_history_encrypt() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_chat_history_encrypt()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_decision_memory_encrypt()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ai_decision_log_encrypt()     FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ai_analysis_cache_encrypt_trg ON ai_analysis_cache;
CREATE TRIGGER ai_analysis_cache_encrypt_trg
  BEFORE INSERT OR UPDATE ON ai_analysis_cache
  FOR EACH ROW EXECUTE FUNCTION ai_analysis_cache_encrypt();

DROP TRIGGER IF EXISTS ai_analysis_history_encrypt_trg ON ai_analysis_history;
CREATE TRIGGER ai_analysis_history_encrypt_trg
  BEFORE INSERT OR UPDATE ON ai_analysis_history
  FOR EACH ROW EXECUTE FUNCTION ai_analysis_history_encrypt();

DROP TRIGGER IF EXISTS ai_chat_history_encrypt_trg ON ai_chat_history;
CREATE TRIGGER ai_chat_history_encrypt_trg
  BEFORE INSERT OR UPDATE OF content ON ai_chat_history
  FOR EACH ROW EXECUTE FUNCTION ai_chat_history_encrypt();

DROP TRIGGER IF EXISTS ai_decision_memory_encrypt_trg ON ai_decision_memory;
CREATE TRIGGER ai_decision_memory_encrypt_trg
  BEFORE INSERT OR UPDATE OF description ON ai_decision_memory
  FOR EACH ROW EXECUTE FUNCTION ai_decision_memory_encrypt();

DROP TRIGGER IF EXISTS ai_decision_log_encrypt_trg ON ai_decision_log;
CREATE TRIGGER ai_decision_log_encrypt_trg
  BEFORE INSERT OR UPDATE OF ai_message, evidence ON ai_decision_log
  FOR EACH ROW EXECUTE FUNCTION ai_decision_log_encrypt();

UPDATE ai_analysis_cache   SET summary = summary;
UPDATE ai_analysis_history SET summary = summary;
UPDATE ai_chat_history     SET content = content;
UPDATE ai_decision_memory  SET description = description;
UPDATE ai_decision_log     SET ai_message = ai_message;

DROP VIEW IF EXISTS ai_analysis_cache_decrypted;
CREATE VIEW ai_analysis_cache_decrypted WITH (security_invoker = true) AS
  SELECT c.id, c.cache_key,
         nexus_decrypt_ctx('ai:cache:' || c.cache_key || ':summary', c.summary) AS summary,
         nexus_decrypt_ctx_jsonb('ai:cache:' || c.cache_key || ':alerts', c.alerts) AS alerts,
         c.health_score, c.analyzed_at
    FROM ai_analysis_cache c;

DROP VIEW IF EXISTS ai_analysis_history_decrypted;
CREATE VIEW ai_analysis_history_decrypted WITH (security_invoker = true) AS
  SELECT h.id,
         nexus_decrypt_ctx('ai:hist:' || h.id::text || ':summary', h.summary) AS summary,
         h.health_score,
         nexus_decrypt_ctx_jsonb('ai:hist:' || h.id::text || ':alerts', h.alerts) AS alerts,
         h.analyzed_at
    FROM ai_analysis_history h;

DROP VIEW IF EXISTS ai_chat_history_decrypted;
CREATE VIEW ai_chat_history_decrypted WITH (security_invoker = true) AS
  SELECT m.id, m.role, nexus_decrypt_ctx('ai:chat:' || m.id::text || ':content', m.content) AS content, m.created_at
    FROM ai_chat_history m;

DROP VIEW IF EXISTS ai_decision_memory_decrypted;
CREATE VIEW ai_decision_memory_decrypted WITH (security_invoker = true) AS
  SELECT d.id, d.action_type, nexus_decrypt_ctx('ai:mem:' || d.id::text || ':description', d.description) AS description, d.created_at
    FROM ai_decision_memory d;

DROP VIEW IF EXISTS ai_decision_log_decrypted;
CREATE VIEW ai_decision_log_decrypted WITH (security_invoker = true) AS
  SELECT l.id, l.employee_id, l.target_table, l.target_id, l.action_type,
         nexus_decrypt_ctx('ail:' || l.id::text || ':ai_message', l.ai_message) AS ai_message,
         nexus_decrypt_ctx_jsonb('ail:' || l.id::text || ':evidence', l.evidence) AS evidence,
         l.decided_by_name, l.decided_by_email, l.created_at
    FROM ai_decision_log l;

REVOKE ALL ON payslips_decrypted, anonymous_feedback_decrypted, ai_analysis_cache_decrypted, ai_analysis_history_decrypted,
              ai_chat_history_decrypted, ai_decision_memory_decrypted, ai_decision_log_decrypted FROM PUBLIC, anon;
GRANT SELECT ON payslips_decrypted, anonymous_feedback_decrypted, ai_analysis_cache_decrypted, ai_analysis_history_decrypted,
                ai_chat_history_decrypted, ai_decision_memory_decrypted, ai_decision_log_decrypted TO authenticated;


DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'Storage indisponível neste banco: ajuste os buckets no painel (sem allowed_mime_types).';
    RETURN;
  END IF;

  UPDATE storage.buckets
     SET allowed_mime_types = NULL, file_size_limit = 25 * 1024 * 1024 + 4096
   WHERE id = 'documents';

  UPDATE storage.buckets
     SET allowed_mime_types = NULL, file_size_limit = 10 * 1024 * 1024 + 4096
   WHERE id = 'message-attachments';

  UPDATE storage.buckets
     SET allowed_mime_types = NULL, file_size_limit = 3 * 1024 * 1024 + 4096
   WHERE id = 'ponto-selfies';
END $$;

CREATE TABLE IF NOT EXISTS security_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       TEXT NOT NULL CHECK (kind IN ('login_failed', 'login_success', 'data_export', 'file_download')),
  actor_id   UUID,
  email_hash TEXT,
  ip         TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_actor_idx ON security_events(kind, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_hash_idx  ON security_events(kind, email_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_time_idx  ON security_events(created_at);

CREATE TABLE IF NOT EXISTS security_rules (
  kind             TEXT PRIMARY KEY CHECK (kind IN ('login_failures', 'login_after_failures', 'mass_export', 'mass_download', 'off_hours_access')),
  enabled          BOOLEAN NOT NULL DEFAULT true,
  threshold        INTEGER NOT NULL DEFAULT 1 CHECK (threshold >= 1),
  threshold_rows   INTEGER CHECK (threshold_rows IS NULL OR threshold_rows >= 1),
  window_minutes   INTEGER NOT NULL DEFAULT 60 CHECK (window_minutes >= 1),
  cooldown_minutes INTEGER NOT NULL DEFAULT 60 CHECK (cooldown_minutes >= 1),
  severity         TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('critical', 'warning', 'info')),
  params           JSONB NOT NULL DEFAULT '{}'::jsonb,
  description      TEXT NOT NULL DEFAULT ''
);

INSERT INTO security_rules (kind, threshold, threshold_rows, window_minutes, cooldown_minutes, severity, params, description) VALUES
  ('login_failures',       5,  NULL, 15,  60,  'warning',  '{}',
   'Tentativas de login falhas em série na mesma conta'),
  ('login_after_failures', 3,  NULL, 30,  60,  'warning',  '{}',
   'Login bem-sucedido logo depois de várias falhas (possível senha adivinhada)'),
  ('mass_export',          5,  500,  60,  60,  'warning',  '{}',
   'Muitas exportações ou volume grande de registros exportados pela mesma pessoa'),
  ('mass_download',        30, NULL, 10,  30,  'warning',  '{}',
   'Muitos arquivos baixados pela mesma pessoa em pouco tempo'),
  ('off_hours_access',     1,  NULL, 60,  720, 'warning',
   '{"start_hour": 8, "end_hour": 18, "weekdays_only": true, "profiles": ["Administrador"]}',
   'Acesso ao painel fora do horário comercial (fuso America/Sao_Paulo)')
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS security_alerts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             TEXT NOT NULL CHECK (kind IN ('login_failures', 'login_after_failures', 'mass_export', 'mass_download', 'off_hours_access')),
  severity         TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  subject_key      TEXT NOT NULL,
  actor_id         UUID,
  subject_label    TEXT NOT NULL,
  title            TEXT NOT NULL,
  message          TEXT NOT NULL,
  detail           JSONB NOT NULL DEFAULT '{}'::jsonb,
  lido             BOOLEAN NOT NULL DEFAULT false,
  lido_at          TIMESTAMPTZ,
  lido_por         UUID,
  push_scheduled_at TIMESTAMPTZ,
  push_sent_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_alerts_recent_idx  ON security_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS security_alerts_subject_idx ON security_alerts(kind, subject_key, created_at DESC);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON security_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON security_rules  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON security_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON security_rules  TO authenticated;
GRANT SELECT ON security_alerts TO authenticated;

DROP POLICY IF EXISTS "rh_security_rules_select"  ON security_rules;
DROP POLICY IF EXISTS "rh_security_alerts_select" ON security_alerts;
CREATE POLICY "rh_security_rules_select"  ON security_rules  FOR SELECT USING (is_rh());
CREATE POLICY "rh_security_alerts_select" ON security_alerts FOR SELECT USING (is_rh());

DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('public.mfa_ok()') IS NULL THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['security_events', 'security_rules', 'security_alerts'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t);
    EXECUTE format('CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION security_request_ip()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_ip TEXT;
BEGIN
  BEGIN
    v_ip := trim(split_part(COALESCE(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF v_ip !~ '^[0-9a-fA-F:.]{2,45}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_ip;
END;
$$;

CREATE OR REPLACE FUNCTION security_subject_label(p_actor UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(e.name, ''), u.email, 'Usuário removido')
  FROM (SELECT 1) one
  LEFT JOIN auth.users u ON u.id = p_actor
  LEFT JOIN profiles p ON p.id = p_actor
  LEFT JOIN employees e ON e.id = p.employee_id;
$$;

CREATE OR REPLACE FUNCTION security_raise_alert(
  p_rule        security_rules,
  p_subject_key TEXT,
  p_actor       UUID,
  p_label       TEXT,
  p_title       TEXT,
  p_message     TEXT,
  p_detail      JSONB,
  p_severity    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('security_alert:' || p_rule.kind || ':' || p_subject_key));

  IF EXISTS (
    SELECT 1 FROM security_alerts
    WHERE kind = p_rule.kind AND subject_key = p_subject_key
      AND created_at > now() - make_interval(mins => p_rule.cooldown_minutes)
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO security_alerts (kind, severity, subject_key, actor_id, subject_label, title, message, detail)
  VALUES (p_rule.kind, COALESCE(p_severity, p_rule.severity), p_subject_key, p_actor, p_label, p_title, p_message, COALESCE(p_detail, '{}'::jsonb))
  RETURNING id INTO v_id;

  BEGIN
    PERFORM notify_alert_push('security_alerts', v_id);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'security_raise_alert: push do alerta % não enviado (%)', v_id, SQLERRM;
  END;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION security_insert_event(
  p_kind       TEXT,
  p_actor      UUID,
  p_email_hash TEXT,
  p_detail     JSONB,
  p_cap_hour   INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent INTEGER;
BEGIN
  SELECT count(*) INTO v_recent FROM security_events
  WHERE kind = p_kind
    AND created_at > now() - interval '1 hour'
    AND ((p_actor IS NOT NULL AND actor_id = p_actor) OR (p_email_hash IS NOT NULL AND email_hash = p_email_hash));

  IF v_recent >= p_cap_hour THEN
    RETURN FALSE;
  END IF;

  INSERT INTO security_events (kind, actor_id, email_hash, ip, detail)
  VALUES (p_kind, p_actor, p_email_hash, security_request_ip(), COALESCE(p_detail, '{}'::jsonb));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION security_check_login_failures(p_actor UUID, p_email_hash TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule    security_rules;
  v_count   INTEGER;
  v_last_ip TEXT;
  v_label   TEXT;
  v_key     TEXT;
BEGIN
  SELECT * INTO v_rule FROM security_rules WHERE kind = 'login_failures' AND enabled;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO v_count FROM security_events
  WHERE kind = 'login_failed'
    AND created_at > now() - make_interval(mins => v_rule.window_minutes)
    AND ((p_actor IS NOT NULL AND actor_id = p_actor) OR (p_email_hash IS NOT NULL AND email_hash = p_email_hash));

  IF v_count < v_rule.threshold THEN RETURN; END IF;

  SELECT ip INTO v_last_ip FROM security_events
  WHERE kind = 'login_failed' AND ip IS NOT NULL
    AND ((p_actor IS NOT NULL AND actor_id = p_actor) OR (p_email_hash IS NOT NULL AND email_hash = p_email_hash))
  ORDER BY created_at DESC LIMIT 1;

  IF p_actor IS NOT NULL THEN
    v_key := p_actor::TEXT;
    v_label := security_subject_label(p_actor);
  ELSE
    v_key := p_email_hash;
    v_label := 'E-mail não cadastrado (' || left(p_email_hash, 6) || ')';
  END IF;

  PERFORM security_raise_alert(
    v_rule, v_key, p_actor, v_label,
    format('%s tentativas de login falhas em %s min', v_count, v_rule.window_minutes),
    format('%s teve %s tentativas de login sem sucesso nos últimos %s minutos.%s', v_label, v_count, v_rule.window_minutes,
           CASE WHEN v_last_ip IS NOT NULL THEN ' Último IP: ' || v_last_ip || '.' ELSE '' END),
    jsonb_build_object('failures', v_count, 'window_minutes', v_rule.window_minutes, 'last_ip', v_last_ip),
    CASE WHEN p_actor IS NULL THEN 'info' ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION report_login_failure(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_email TEXT := lower(trim(COALESCE(p_email, '')));
  v_hash  TEXT;
  v_uid   UUID;
BEGIN
  IF length(v_email) < 3 OR length(v_email) > 254 THEN
    RETURN;
  END IF;

  IF (SELECT count(*) FROM security_events WHERE kind = 'login_failed' AND created_at > now() - interval '1 hour') >= 5000 THEN
    RETURN;
  END IF;

  v_hash := encode(digest(v_email, 'sha256'), 'hex');
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  PERFORM security_insert_event('login_failed', v_uid, v_hash, jsonb_build_object('stage', 'password'), 60);
  PERFORM security_check_login_failures(v_uid, v_hash);
EXCEPTION WHEN others THEN
  RAISE WARNING 'report_login_failure: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION report_mfa_failure()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  PERFORM security_insert_event('login_failed', v_uid, NULL, jsonb_build_object('stage', 'mfa'), 60);
  PERFORM security_check_login_failures(v_uid, NULL);
EXCEPTION WHEN others THEN
  RAISE WARNING 'report_mfa_failure: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION record_access(p_kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   TEXT;
  v_rule      security_rules;
  v_failures  INTEGER;
  v_sp        TIMESTAMP;
  v_hour      INTEGER;
  v_dow       INTEGER;
  v_start     INTEGER;
  v_end       INTEGER;
  v_off       BOOLEAN;
  v_ip        TEXT := security_request_ip();
BEGIN
  IF v_uid IS NULL OR p_kind NOT IN ('login', 'session') THEN RETURN; END IF;

  SELECT profile INTO v_profile FROM profiles WHERE id = v_uid;
  IF v_profile IS NULL THEN RETURN; END IF;

  IF p_kind = 'login' THEN
    PERFORM security_insert_event('login_success', v_uid, NULL, jsonb_build_object('profile', v_profile), 60);

    SELECT * INTO v_rule FROM security_rules WHERE kind = 'login_after_failures' AND enabled;
    IF FOUND THEN
      SELECT count(*) INTO v_failures FROM security_events
      WHERE kind = 'login_failed' AND actor_id = v_uid
        AND created_at > now() - make_interval(mins => v_rule.window_minutes);

      IF v_failures >= v_rule.threshold THEN
        PERFORM security_raise_alert(
          v_rule, v_uid::TEXT, v_uid, security_subject_label(v_uid),
          format('Login concluído após %s falhas seguidas', v_failures),
          format('%s entrou com sucesso depois de %s tentativas falhas nos últimos %s minutos. Se não foi essa pessoa, troque a senha da conta.%s',
                 security_subject_label(v_uid), v_failures, v_rule.window_minutes, CASE WHEN v_ip IS NOT NULL THEN ' IP: ' || v_ip || '.' ELSE '' END),
          jsonb_build_object('failures', v_failures, 'window_minutes', v_rule.window_minutes, 'ip', v_ip)
        );
      END IF;
    END IF;
  END IF;

  SELECT * INTO v_rule FROM security_rules WHERE kind = 'off_hours_access' AND enabled;
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT ((v_rule.params -> 'profiles') ? v_profile) THEN RETURN; END IF;

  v_sp    := now() AT TIME ZONE 'America/Sao_Paulo';
  v_hour  := extract(hour FROM v_sp);
  v_dow   := extract(dow FROM v_sp);
  v_start := COALESCE((v_rule.params ->> 'start_hour')::INTEGER, 8);
  v_end   := COALESCE((v_rule.params ->> 'end_hour')::INTEGER, 18);
  v_off   := v_hour < v_start OR v_hour >= v_end
             OR (COALESCE((v_rule.params ->> 'weekdays_only')::BOOLEAN, true) AND v_dow IN (0, 6));

  IF NOT v_off THEN RETURN; END IF;

  PERFORM security_raise_alert(
    v_rule, v_uid::TEXT, v_uid, security_subject_label(v_uid),
    'Acesso fora do horário comercial',
    format('%s acessou o painel em %s, fora do horário comercial (%sh às %sh%s).%s',
           security_subject_label(v_uid), to_char(v_sp, 'DD/MM/YYYY "às" HH24:MI'), v_start, v_end,
           CASE WHEN COALESCE((v_rule.params ->> 'weekdays_only')::BOOLEAN, true) THEN ', dias úteis' ELSE '' END,
           CASE WHEN v_ip IS NOT NULL THEN ' IP: ' || v_ip || '.' ELSE '' END),
    jsonb_build_object('at', to_char(v_sp, 'YYYY-MM-DD"T"HH24:MI'), 'via', p_kind, 'ip', v_ip)
  );
EXCEPTION WHEN others THEN
  RAISE WARNING 'record_access: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION report_data_export(p_source TEXT, p_rows INTEGER DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_rule    security_rules;
  v_source  TEXT := left(regexp_replace(COALESCE(p_source, ''), '[^a-zA-Z0-9_.-]', '', 'g'), 60);
  v_rows    INTEGER := GREATEST(0, LEAST(COALESCE(p_rows, 0), 1000000));
  v_count   INTEGER;
  v_total   BIGINT;
  v_sources TEXT;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  PERFORM security_insert_event('data_export', v_uid, NULL, jsonb_build_object('source', v_source, 'rows', v_rows), 200);

  SELECT * INTO v_rule FROM security_rules WHERE kind = 'mass_export' AND enabled;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*), COALESCE(sum((detail ->> 'rows')::BIGINT), 0),
         string_agg(DISTINCT detail ->> 'source', ', ')
    INTO v_count, v_total, v_sources
  FROM security_events
  WHERE kind = 'data_export' AND actor_id = v_uid
    AND created_at > now() - make_interval(mins => v_rule.window_minutes);

  IF v_count >= v_rule.threshold OR (v_rule.threshold_rows IS NOT NULL AND v_total >= v_rule.threshold_rows) THEN
    PERFORM security_raise_alert(
      v_rule, v_uid::TEXT, v_uid, security_subject_label(v_uid),
      format('%s exportações (%s registros) em %s min', v_count, v_total, v_rule.window_minutes),
      format('%s exportou dados %s vez(es), somando %s registros, nos últimos %s minutos (%s).',
             security_subject_label(v_uid), v_count, v_total, v_rule.window_minutes, COALESCE(v_sources, 'origem não informada')),
      jsonb_build_object('exports', v_count, 'rows', v_total, 'window_minutes', v_rule.window_minutes, 'sources', v_sources)
    );
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'report_data_export: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION report_file_download(p_bucket TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_rule   security_rules;
  v_bucket TEXT := left(regexp_replace(COALESCE(p_bucket, ''), '[^a-zA-Z0-9_.-]', '', 'g'), 60);
  v_count  INTEGER;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;

  PERFORM security_insert_event('file_download', v_uid, NULL, jsonb_build_object('bucket', v_bucket), 500);

  SELECT * INTO v_rule FROM security_rules WHERE kind = 'mass_download' AND enabled;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT count(*) INTO v_count FROM security_events
  WHERE kind = 'file_download' AND actor_id = v_uid
    AND created_at > now() - make_interval(mins => v_rule.window_minutes);

  IF v_count >= v_rule.threshold THEN
    PERFORM security_raise_alert(
      v_rule, v_uid::TEXT, v_uid, security_subject_label(v_uid),
      format('%s arquivos baixados em %s min', v_count, v_rule.window_minutes),
      format('%s baixou %s arquivos nos últimos %s minutos.', security_subject_label(v_uid), v_count, v_rule.window_minutes),
      jsonb_build_object('downloads', v_count, 'window_minutes', v_rule.window_minutes)
    );
  END IF;
EXCEPTION WHEN others THEN
  RAISE WARNING 'report_file_download: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION mark_security_alerts_read(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  UPDATE security_alerts SET lido = true, lido_at = now(), lido_por = auth.uid()
  WHERE id = ANY (p_ids) AND NOT lido;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION purge_security_events()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM security_events WHERE created_at < now() - interval '180 days';
$$;

REVOKE ALL ON FUNCTION security_request_ip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_subject_label(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_raise_alert(security_rules, TEXT, UUID, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_insert_event(TEXT, UUID, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION security_check_login_failures(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_login_failure(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_mfa_failure() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_access(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_data_export(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION report_file_download(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_security_alerts_read(UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION purge_security_events() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION report_login_failure(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION report_mfa_failure() TO authenticated;
GRANT EXECUTE ON FUNCTION record_access(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION report_data_export(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION report_file_download(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_security_alerts_read(UUID[]) TO authenticated;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('purge-security-events', '30 6 * * *', 'SELECT purge_security_events();');
  END IF;
END $$;

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
    RAISE WARNING 'dispatch_deferred_pushes: vault secrets project_url/service_role_key ausentes — pushes adiados (comunicados, compliance, burnout, segurança) não serão enviados';
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

  FOR v_alert IN
    SELECT id FROM security_alerts
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
      body := jsonb_build_object('table', 'security_alerts', 'id', v_alert.id)
    );
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS nexus_key_config (
  purpose TEXT PRIMARY KEY CHECK (purpose IN ('encryption', 'hmac')),
  kid     TEXT NOT NULL CHECK (kid ~ '^[a-z0-9]{1,16}$')
);
INSERT INTO nexus_key_config (purpose, kid) VALUES ('encryption', 'v1'), ('hmac', 'v1') ON CONFLICT (purpose) DO NOTHING;
ALTER TABLE nexus_key_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nexus_key_config FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.mfa_ok()') IS NOT NULL THEN
    DROP POLICY IF EXISTS mfa_required ON nexus_key_config;
    CREATE POLICY mfa_required ON nexus_key_config AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION nexus_key_name(p_purpose TEXT, p_kid TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_base TEXT := CASE p_purpose WHEN 'encryption' THEN 'data_encryption_key' WHEN 'hmac' THEN 'data_hmac_key' END;
BEGIN
  IF v_base IS NULL THEN
    RAISE EXCEPTION 'Finalidade de chave inválida: % (use ''encryption'' ou ''hmac'')', p_purpose;
  END IF;
  IF p_kid IS NULL OR p_kid !~ '^[a-z0-9]{1,16}$' THEN
    RAISE EXCEPTION 'Identificador de chave inválido: % (use de 1 a 16 letras minúsculas ou números)', p_kid;
  END IF;
  RETURN CASE WHEN p_kid = 'v1' THEN v_base ELSE v_base || '_' || p_kid END;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_active_kid(p_purpose TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT kid FROM nexus_key_config WHERE purpose = p_purpose), 'v1');
$$;

CREATE OR REPLACE FUNCTION nexus_secret_exists(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = p_name) THEN
      RETURN TRUE;
    END IF;
  END IF;
  RETURN EXISTS (SELECT 1 FROM nexus_key_store WHERE name = p_name);
END;
$$;

CREATE OR REPLACE FUNCTION nexus_is_cipher(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_value LIKE 'nexus:enc1:%' OR p_value LIKE 'nexus:enc2:%';
$$;

CREATE OR REPLACE FUNCTION nexus_cipher_kid(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN p_value LIKE 'nexus:enc1:%' THEN 'v1'
           WHEN p_value LIKE 'nexus:enc2:%' THEN split_part(p_value, ':', 3)
         END;
$$;

CREATE OR REPLACE FUNCTION nexus_cipher_prefix(p_kid TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_kid = 'v1' THEN 'nexus:enc1:' ELSE 'nexus:enc2:' || p_kid || ':' END;
$$;

CREATE OR REPLACE FUNCTION nexus_encrypt_with(p_kid TEXT, p_context TEXT, p_plain TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN nexus_cipher_prefix(p_kid) || encode(
    pgp_sym_encrypt(p_context || chr(31) || p_plain, nexus_secret(nexus_key_name('encryption', p_kid)), 'cipher-algo=aes256, compress-algo=0, s2k-mode=1'),
    'base64'
  );
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
  IF nexus_is_cipher(p_plain) THEN
    RETURN p_plain;
  END IF;
  RETURN nexus_encrypt_with(nexus_active_kid('encryption'), p_context, p_plain);
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
  v_kid   TEXT;
BEGIN
  IF p_cipher IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT nexus_is_cipher(p_cipher) THEN
    RETURN p_cipher;
  END IF;
  BEGIN
    v_kid := nexus_cipher_kid(p_cipher);
    v_plain := pgp_sym_decrypt(
      decode(substr(p_cipher, length(nexus_cipher_prefix(v_kid)) + 1), 'base64'),
      nexus_secret(nexus_key_name('encryption', v_kid))
    );
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

CREATE OR REPLACE FUNCTION nexus_rewrap(p_context TEXT, p_cipher TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_kid   TEXT;
  v_plain TEXT;
  v_sep   INT;
BEGIN
  IF p_cipher IS NULL OR NOT nexus_is_cipher(p_cipher) THEN
    RETURN p_cipher;
  END IF;
  v_kid := nexus_cipher_kid(p_cipher);
  IF NOT nexus_secret_exists(nexus_key_name('encryption', v_kid)) THEN
    RAISE EXCEPTION 'a chave "%" usada por este valor não está mais no Vault', v_kid;
  END IF;
  BEGIN
    v_plain := pgp_sym_decrypt(
      decode(substr(p_cipher, length(nexus_cipher_prefix(v_kid)) + 1), 'base64'),
      nexus_secret(nexus_key_name('encryption', v_kid))
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'valor corrompido ou cifrado com outra chave (chave "%")', v_kid;
  END;
  v_sep := position(chr(31) IN v_plain);
  IF v_sep = 0 OR left(v_plain, v_sep - 1) <> p_context THEN
    RAISE EXCEPTION 'o contexto do valor não confere (cifra copiada de outra linha?)';
  END IF;
  RETURN nexus_encrypt_with(nexus_active_kid('encryption'), p_context, substr(v_plain, v_sep + 1));
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
  RETURN encode(
    hmac(regexp_replace(p_plain, '[.[:space:]/-]', '', 'g'), nexus_secret(nexus_key_name('hmac', nexus_active_kid('hmac'))), 'sha256'),
    'hex'
  );
END;
$$;

CREATE OR REPLACE FUNCTION nexus_norm_money(p_label TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_value IS NULL OR nexus_is_cipher(p_value) THEN
    RETURN p_value;
  END IF;
  IF p_value !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION '% inválido', p_label USING ERRCODE = '22P02';
  END IF;
  RETURN (p_value::NUMERIC(10, 2))::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_norm_json(p_label TEXT, p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_value IS NULL OR nexus_is_cipher(p_value) THEN
    RETURN p_value;
  END IF;
  RETURN p_value::JSONB::TEXT;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION '% inválido', p_label USING ERRCODE = '22P02';
END;
$$;

CREATE OR REPLACE FUNCTION employees_encrypt_sensitive()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ctx TEXT := 'emp:' || NEW.id::TEXT;
BEGIN
  IF NEW.salary IS NOT NULL AND NOT nexus_is_cipher(NEW.salary) THEN
    IF NEW.salary !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Salário inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.salary := (NEW.salary::NUMERIC(10, 2))::TEXT;
  END IF;

  IF NEW.birth_date IS NOT NULL AND NOT nexus_is_cipher(NEW.birth_date) THEN
    IF NEW.birth_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
      RAISE EXCEPTION 'Data de nascimento inválida' USING ERRCODE = '22007';
    END IF;
    NEW.birth_date := (left(NEW.birth_date, 10)::DATE)::TEXT;
  END IF;

  IF NEW.pcd IS NOT NULL AND NOT nexus_is_cipher(NEW.pcd) THEN
    IF lower(NEW.pcd) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Indicador PcD inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.pcd := lower(NEW.pcd);
  END IF;

  IF NEW.pensao_alimenticia IS NOT NULL AND NOT nexus_is_cipher(NEW.pensao_alimenticia) THEN
    IF lower(NEW.pensao_alimenticia) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'Indicador de pensão alimentícia inválido' USING ERRCODE = '22P02';
    END IF;
    NEW.pensao_alimenticia := lower(NEW.pensao_alimenticia);
  END IF;

  NEW.cpf_hash           := nexus_blind_index(nexus_unwrap(v_ctx, NEW.cpf));
  NEW.cpf                := nexus_wrap(v_ctx, NEW.cpf);
  NEW.rg                 := nexus_wrap(v_ctx, NEW.rg);
  NEW.telefone           := nexus_wrap(v_ctx, NEW.telefone);
  NEW.salary             := nexus_wrap(v_ctx, NEW.salary);
  NEW.chave_pix          := nexus_wrap(v_ctx, NEW.chave_pix);
  NEW.agencia            := nexus_wrap(v_ctx, NEW.agencia);
  NEW.conta              := nexus_wrap(v_ctx, NEW.conta);
  NEW.birth_date         := nexus_wrap(v_ctx, NEW.birth_date);
  NEW.gender             := nexus_wrap(v_ctx, NEW.gender);
  NEW.raca_cor           := nexus_wrap(v_ctx, NEW.raca_cor);
  NEW.deficiencia        := nexus_wrap(v_ctx, NEW.deficiencia);
  NEW.tipo_pensao        := nexus_wrap(v_ctx, NEW.tipo_pensao);
  NEW.pcd                := nexus_wrap(v_ctx, NEW.pcd);
  NEW.pensao_alimenticia := nexus_wrap(v_ctx, NEW.pensao_alimenticia);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_encrypted_columns()
RETURNS TABLE (tbl TEXT, col TEXT, ctx TEXT)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT * FROM (VALUES
    ('employees', 'cpf',                $q$'emp:' || t.id::text$q$),
    ('employees', 'rg',                 $q$'emp:' || t.id::text$q$),
    ('employees', 'telefone',           $q$'emp:' || t.id::text$q$),
    ('employees', 'salary',             $q$'emp:' || t.id::text$q$),
    ('employees', 'chave_pix',          $q$'emp:' || t.id::text$q$),
    ('employees', 'agencia',            $q$'emp:' || t.id::text$q$),
    ('employees', 'conta',              $q$'emp:' || t.id::text$q$),
    ('employees', 'birth_date',         $q$'emp:' || t.id::text$q$),
    ('employees', 'gender',             $q$'emp:' || t.id::text$q$),
    ('employees', 'raca_cor',           $q$'emp:' || t.id::text$q$),
    ('employees', 'deficiencia',        $q$'emp:' || t.id::text$q$),
    ('employees', 'tipo_pensao',        $q$'emp:' || t.id::text$q$),
    ('employees', 'pcd',                $q$'emp:' || t.id::text$q$),
    ('employees', 'pensao_alimenticia', $q$'emp:' || t.id::text$q$),
    ('chat_messages',       'content',  $q$'chan:' || t.channel_id::text$q$),
    ('hr_ticket_messages',  'content',  $q$'tkt:' || t.ticket_id::text$q$),
    ('payslips', 'proventos',       $q$'slip:' || t.employee_id::text || ':' || t.mes || ':proventos'$q$),
    ('payslips', 'descontos',       $q$'slip:' || t.employee_id::text || ':' || t.mes || ':descontos'$q$),
    ('payslips', 'total_proventos', $q$'slip:' || t.employee_id::text || ':' || t.mes || ':total_proventos'$q$),
    ('payslips', 'total_descontos', $q$'slip:' || t.employee_id::text || ':' || t.mes || ':total_descontos'$q$),
    ('payslips', 'salario_liquido', $q$'slip:' || t.employee_id::text || ':' || t.mes || ':salario_liquido'$q$),
    ('anonymous_feedback',  'message',     $q$'fb:' || t.id::text || ':message'$q$),
    ('ai_analysis_cache',   'summary',     $q$'ai:cache:' || t.cache_key || ':summary'$q$),
    ('ai_analysis_cache',   'alerts',      $q$'ai:cache:' || t.cache_key || ':alerts'$q$),
    ('ai_analysis_history', 'summary',     $q$'ai:hist:' || t.id::text || ':summary'$q$),
    ('ai_analysis_history', 'alerts',      $q$'ai:hist:' || t.id::text || ':alerts'$q$),
    ('ai_chat_history',     'content',     $q$'ai:chat:' || t.id::text || ':content'$q$),
    ('ai_decision_memory',  'description', $q$'ai:mem:' || t.id::text || ':description'$q$),
    ('ai_decision_log',     'ai_message',  $q$'ail:' || t.id::text || ':ai_message'$q$),
    ('ai_decision_log',     'evidence',    $q$'ail:' || t.id::text || ':evidence'$q$)
  ) AS r (tbl, col, ctx);
$$;

CREATE OR REPLACE FUNCTION nexus_key_generate(p_purpose TEXT, p_kid TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_name   TEXT := nexus_key_name(p_purpose, p_kid);
  v_secret TEXT;
BEGIN
  IF p_kid = 'v1' THEN
    RAISE EXCEPTION 'v1 é a chave original e não pode ser gerada de novo; escolha outro identificador (ex.: v2)';
  END IF;
  IF nexus_secret_exists(v_name) THEN
    RAISE EXCEPTION 'A chave % já existe', v_name;
  END IF;
  v_secret := encode(gen_random_bytes(32), 'hex');
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    PERFORM vault.create_secret(v_secret, v_name, 'Cifragem de colunas sensíveis (Nexus): ' || p_purpose || ' ' || p_kid);
  ELSE
    INSERT INTO nexus_key_store (name, secret) VALUES (v_name, v_secret);
  END IF;
  RAISE NOTICE 'Chave % criada. Copie o valor para um cofre FORA do Supabase antes de ativá-la.', v_name;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_key_activate(p_purpose TEXT, p_kid TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_name TEXT := nexus_key_name(p_purpose, p_kid);
BEGIN
  IF NOT nexus_secret_exists(v_name) THEN
    RAISE EXCEPTION 'A chave % não existe; crie antes com nexus_key_generate(%, %)', v_name, quote_literal(p_purpose), quote_literal(p_kid);
  END IF;

  IF p_purpose = 'hmac' THEN
    LOCK TABLE employees IN SHARE ROW EXCLUSIVE MODE;
  END IF;

  INSERT INTO nexus_key_config (purpose, kid) VALUES (p_purpose, p_kid)
  ON CONFLICT (purpose) DO UPDATE SET kid = EXCLUDED.kid;

  IF p_purpose = 'hmac' THEN
    BEGIN
      UPDATE employees SET cpf_hash = nexus_blind_index(nexus_unwrap('emp:' || id::text, cpf));
    EXCEPTION WHEN not_null_violation THEN
      RAISE EXCEPTION 'Não foi possível recalcular o índice de CPF: há colaborador cujo CPF não pode ser decifrado. Nada foi alterado.';
    END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_rewrap_all(p_batch INT DEFAULT 500)
RETURNS TABLE (tbl TEXT, rewrapped BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tbl    TEXT;
  v_set    TEXT;
  v_where  TEXT;
  v_n      BIGINT;
  v_prefix TEXT := nexus_cipher_prefix(nexus_active_kid('encryption')) || '%';
BEGIN
  IF p_batch IS NULL OR p_batch < 1 THEN
    RAISE EXCEPTION 'O tamanho do lote deve ser um número positivo';
  END IF;

  FOR v_tbl IN SELECT DISTINCT r.tbl FROM nexus_encrypted_columns() r ORDER BY 1 LOOP
    SELECT string_agg(
             format('%1$I = CASE WHEN t.%1$I LIKE ''nexus:enc%%'' AND t.%1$I NOT LIKE %2$L THEN nexus_rewrap(%3$s, t.%1$I) ELSE t.%1$I END', r.col, v_prefix, r.ctx),
             ', '),
           string_agg(format('(t.%1$I LIKE ''nexus:enc%%'' AND t.%1$I NOT LIKE %2$L)', r.col, v_prefix), ' OR ')
      INTO v_set, v_where
      FROM nexus_encrypted_columns() r
     WHERE r.tbl = v_tbl;

    BEGIN
      EXECUTE format(
        'WITH todo AS (SELECT t.id FROM public.%1$I t WHERE %2$s ORDER BY t.id LIMIT %3$s FOR UPDATE SKIP LOCKED)
         UPDATE public.%1$I t SET %4$s FROM todo WHERE t.id = todo.id',
        v_tbl, v_where, p_batch, v_set);
      GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Rotação interrompida em %: %. Nada desta chamada foi gravado.', v_tbl, SQLERRM;
    END;

    tbl := v_tbl;
    rewrapped := v_n;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION nexus_key_status()
RETURNS TABLE (scope TEXT, object TEXT, kid TEXT, active BOOLEAN, cipher_values BIGINT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r        RECORD;
  v_active TEXT := nexus_active_kid('encryption');
BEGIN
  FOR r IN SELECT c.tbl, c.col FROM nexus_encrypted_columns() c ORDER BY 1, 2 LOOP
    RETURN QUERY EXECUTE format(
      'SELECT ''encryption''::text, %1$L::text, COALESCE(nexus_cipher_kid(t.%3$I), ''plaintext'')::text,
              COALESCE(nexus_cipher_kid(t.%3$I), ''plaintext'') = %4$L, count(*)::bigint
         FROM public.%2$I t WHERE t.%3$I IS NOT NULL GROUP BY 3',
      r.tbl || '.' || r.col, r.tbl, r.col, v_active);
  END LOOP;

  FOR r IN
    SELECT ic.table_name AS tbl, ic.column_name AS col
      FROM information_schema.columns ic
      JOIN information_schema.tables it ON it.table_schema = ic.table_schema AND it.table_name = ic.table_name AND it.table_type = 'BASE TABLE'
     WHERE ic.table_schema = 'public'
       AND ic.data_type IN ('text', 'character varying')
       AND ic.table_name NOT IN ('nexus_key_store', 'nexus_key_config')
       AND NOT EXISTS (SELECT 1 FROM nexus_encrypted_columns() c WHERE c.tbl = ic.table_name AND c.col = ic.column_name)
     ORDER BY 1, 2
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT ''unregistered''::text, %1$L::text, nexus_cipher_kid(t.%3$I)::text, false, count(*)::bigint
         FROM public.%2$I t WHERE nexus_is_cipher(t.%3$I) GROUP BY 3',
      r.tbl || '.' || r.col, r.tbl, r.col);
  END LOOP;

  RETURN QUERY
    SELECT 'hmac'::text, 'employees.cpf_hash'::text, nexus_active_kid('hmac'), TRUE, count(*)::bigint
      FROM employees e WHERE e.cpf_hash = nexus_blind_index(nexus_unwrap('emp:' || e.id::text, e.cpf));
  RETURN QUERY
    SELECT 'hmac'::text, 'employees.cpf_hash'::text, 'stale'::text, FALSE, count(*)::bigint
      FROM employees e WHERE e.cpf_hash IS DISTINCT FROM nexus_blind_index(nexus_unwrap('emp:' || e.id::text, e.cpf));
END;
$$;

CREATE OR REPLACE FUNCTION nexus_key_summary()
RETURNS TABLE (scope TEXT, kid TEXT, active BOOLEAN, cipher_values BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT s.scope, s.kid, bool_or(s.active), sum(s.cipher_values)::bigint
    FROM nexus_key_status() s
   GROUP BY s.scope, s.kid
   ORDER BY s.scope, s.kid;
$$;

REVOKE ALL ON FUNCTION nexus_key_name(TEXT, TEXT)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_active_kid(TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_secret_exists(TEXT)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_is_cipher(TEXT)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_cipher_kid(TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_cipher_prefix(TEXT)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_encrypt_with(TEXT, TEXT, TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_rewrap(TEXT, TEXT)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_encrypted_columns()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_key_generate(TEXT, TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_key_activate(TEXT, TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_rewrap_all(INT)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_key_status()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_key_summary()                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_norm_money(TEXT, TEXT)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_norm_json(TEXT, TEXT)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_wrap(TEXT, TEXT)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_unwrap(TEXT, TEXT)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nexus_blind_index(TEXT)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION employees_encrypt_sensitive()            FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('generate_compliance_alerts', 'dispatch_deferred_pushes', 'notify_alert_push')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('report_daily_overtime_alert', 'approve_bank_request', 'approve_adjustment_request', 'sign_document',
                         'sign_payslip', 'punch_time_record', 'get_or_create_dm', 'anonymize_employee', 'colleague_directory')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION documents_collaborator_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_banco_horas BOOLEAN;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR is_rh() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_banco_horas := NEW.category = 'banco_horas' AND NEW.tipo = 'Atestado/Comprovante';

    IF NEW.requer_assinatura IS TRUE OR NEW.assinado_em IS NOT NULL OR NEW.assinado_por IS NOT NULL THEN
      RAISE EXCEPTION 'Assinatura de documento só é registrada pelo próprio fluxo de assinatura.' USING ERRCODE = '42501';
    END IF;
    IF NEW.category IS NOT NULL AND NOT v_banco_horas THEN
      RAISE EXCEPTION 'A categoria do documento é definida pelo RH.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM 'pendente' AND NOT v_banco_horas THEN
      RAISE EXCEPTION 'Documentos enviados pelo colaborador entram como pendentes; a aprovação é do RH.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'is_current') IS DISTINCT FROM (to_jsonb(OLD) - 'is_current') THEN
    RAISE EXCEPTION 'Você só pode substituir a versão do seu documento. Status, categoria e assinatura são geridos pelo RH.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION documents_collaborator_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS documents_collaborator_guard_trg ON documents;
CREATE TRIGGER documents_collaborator_guard_trg
  BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_collaborator_guard();

CREATE TABLE IF NOT EXISTS performance_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  cycle           TEXT NOT NULL, -- ex.: "1º Semestre 2026" — texto livre, sem calendário fixo de ciclos
  status          TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
  overall_rating  SMALLINT CHECK (overall_rating BETWEEN 1 AND 5),
  manager_comment TEXT,
  evaluator_name  TEXT, -- nome de quem avaliou (gestor ou RH) — sem FK: RH nem sempre tem linha em employees
  evaluator_email TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS performance_reviews_emp_idx ON performance_reviews(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS performance_review_competencies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
  competency  TEXT NOT NULL,
  rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT
);

CREATE INDEX IF NOT EXISTS performance_review_competencies_review_idx ON performance_review_competencies(review_id);

CREATE TABLE IF NOT EXISTS pdi_goals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  review_id        UUID REFERENCES performance_reviews(id) ON DELETE SET NULL, -- opcional: meta pode nascer fora de um ciclo
  title            TEXT NOT NULL,
  description      TEXT,
  due_date         DATE,
  status           TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluido', 'cancelado')),
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pdi_goals_emp_idx ON pdi_goals(employee_id, created_at DESC);

CREATE TRIGGER performance_reviews_updated_at
  BEFORE UPDATE ON performance_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER pdi_goals_updated_at
  BEFORE UPDATE ON pdi_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION pdi_goals_self_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_editable CONSTANT TEXT[] := ARRAY['status', 'updated_at'];
  v_is_manager BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM employees WHERE id = NEW.employee_id AND manager_id = my_employee_id()
  ) INTO v_is_manager;
  IF v_is_manager THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_editable) IS DISTINCT FROM (to_jsonb(OLD) - v_editable) THEN
    RAISE EXCEPTION 'Você só pode atualizar o status da sua meta de desenvolvimento.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION pdi_goals_self_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pdi_goals_self_update_guard_trg ON pdi_goals;
CREATE TRIGGER pdi_goals_self_update_guard_trg
  BEFORE UPDATE ON pdi_goals
  FOR EACH ROW EXECUTE FUNCTION pdi_goals_self_update_guard();

ALTER TABLE performance_reviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_review_competencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdi_goals                       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_performance_reviews_select" ON performance_reviews FOR SELECT USING (is_rh());
CREATE POLICY "gestor_performance_reviews_team" ON performance_reviews FOR ALL
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));
CREATE POLICY "colabo_performance_reviews_own_select" ON performance_reviews FOR SELECT
  USING (employee_id = my_employee_id() AND status = 'concluida');

CREATE POLICY "rh_review_competencies_select" ON performance_review_competencies FOR SELECT USING (is_rh());
CREATE POLICY "gestor_review_competencies_team" ON performance_review_competencies FOR ALL
  USING (review_id IN (
    SELECT pr.id FROM performance_reviews pr
    JOIN employees e ON e.id = pr.employee_id
    WHERE e.manager_id = my_employee_id()
  ));
CREATE POLICY "colabo_review_competencies_own_select" ON performance_review_competencies FOR SELECT
  USING (review_id IN (
    SELECT id FROM performance_reviews WHERE employee_id = my_employee_id() AND status = 'concluida'
  ));

CREATE POLICY "rh_pdi_goals_select" ON pdi_goals FOR SELECT USING (is_rh());
CREATE POLICY "gestor_pdi_goals_team" ON pdi_goals FOR ALL
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));
CREATE POLICY "colabo_pdi_goals_own_select" ON pdi_goals FOR SELECT
  USING (employee_id = my_employee_id());
CREATE POLICY "colabo_pdi_goals_own_update" ON pdi_goals FOR UPDATE
  USING (employee_id = my_employee_id())
  WITH CHECK (employee_id = my_employee_id());

CREATE TABLE IF NOT EXISTS job_titles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  track        TEXT, -- trilha/área de carreira (ex.: "Recursos Humanos", "Tecnologia") — opcional, RH define
  level        TEXT, -- nível dentro da trilha (ex.: "Júnior", "Pleno", "Sênior", "Especialista", "Gerência")
  salary_min   NUMERIC(10,2),
  salary_max   NUMERIC(10,2),
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (title),
  CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_max >= salary_min)
);

CREATE TRIGGER job_titles_updated_at
  BEFORE UPDATE ON job_titles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE job_titles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_job_titles_all" ON job_titles FOR ALL USING (is_rh());

CREATE OR REPLACE FUNCTION job_titles_public()
RETURNS TABLE (id UUID, title TEXT, track TEXT, level TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, title, track, level
  FROM job_titles
  WHERE active = true AND auth.uid() IS NOT NULL
  ORDER BY track NULLS LAST, level NULLS LAST, title;
$$;

REVOKE ALL ON FUNCTION job_titles_public() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION job_titles_public() TO authenticated, service_role;

INSERT INTO job_titles (title, level) VALUES
  ('Estagiário', 'Estágio'),
  ('Aprendiz', 'Aprendizagem'),
  ('Assistente', 'Operacional'),
  ('Analista Júnior', 'Júnior'),
  ('Analista Pleno', 'Pleno'),
  ('Analista Sênior', 'Sênior'),
  ('Especialista', 'Especialista'),
  ('Supervisor', 'Coordenação'),
  ('Coordenador', 'Coordenação'),
  ('Gerente', 'Gerência'),
  ('Diretor', 'Diretoria')
ON CONFLICT (title) DO NOTHING;

CREATE TABLE IF NOT EXISTS trainings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  description    TEXT,
  category       TEXT, -- ex.: "Compliance", "Técnico", "Liderança", "Idiomas"
  provider       TEXT, -- ex.: "Interno", "Externo", nome da plataforma
  duration_hours NUMERIC(6,2),
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (title)
);

CREATE TRIGGER trainings_updated_at
  BEFORE UPDATE ON trainings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE trainings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_trainings_all" ON trainings FOR ALL USING (is_rh());
CREATE POLICY "authenticated_trainings_select" ON trainings FOR SELECT TO authenticated USING (active = true);

CREATE TABLE IF NOT EXISTS employee_trainings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  training_id      UUID REFERENCES trainings(id) ON DELETE SET NULL, -- opcional: registro pode ser livre, fora do catálogo
  title            TEXT NOT NULL,
  category         TEXT,
  provider         TEXT,
  hours            NUMERIC(6,2),
  source           TEXT NOT NULL DEFAULT 'atribuido' CHECK (source IN ('atribuido', 'autodeclarado')),
  status           TEXT NOT NULL DEFAULT 'pendente'
                     CHECK (status IN ('pendente', 'em_andamento', 'concluido', 'aguardando_aprovacao', 'recusado', 'cancelado')),
  completion_date  DATE,
  certificate_url  TEXT,
  notes            TEXT, -- ex.: motivo da recusa pelo RH
  assigned_by_name TEXT, -- nome de quem atribuiu (RH ou gestor) — nulo quando autodeclarado
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (source = 'autodeclarado' AND status IN ('aguardando_aprovacao', 'concluido', 'recusado'))
    OR (source = 'atribuido' AND status IN ('pendente', 'em_andamento', 'concluido', 'cancelado'))
  )
);

CREATE INDEX IF NOT EXISTS employee_trainings_emp_idx ON employee_trainings(employee_id, created_at DESC);

CREATE TRIGGER employee_trainings_updated_at
  BEFORE UPDATE ON employee_trainings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE employee_trainings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_employee_trainings_all" ON employee_trainings FOR ALL USING (is_rh());

CREATE POLICY "gestor_employee_trainings_team" ON employee_trainings FOR ALL
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));

CREATE POLICY "colabo_employee_trainings_own_select" ON employee_trainings FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_employee_trainings_self_report" ON employee_trainings FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao');

CREATE POLICY "colabo_employee_trainings_self_edit_pending" ON employee_trainings FOR UPDATE
  USING (employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao')
  WITH CHECK (employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao');

CREATE POLICY "colabo_employee_trainings_self_withdraw_pending" ON employee_trainings FOR DELETE
  USING (employee_id = my_employee_id() AND source = 'autodeclarado' AND status = 'aguardando_aprovacao');

CREATE TABLE IF NOT EXISTS disciplinary_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('advertencia_verbal', 'advertencia_escrita', 'suspensao')),
  reason            TEXT NOT NULL,
  description       TEXT,
  suspension_days   SMALLINT CHECK (suspension_days IS NULL OR suspension_days > 0),
  occurred_at       DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by_name   TEXT,
  acknowledged_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (type = 'suspensao' OR suspension_days IS NULL)
);

CREATE INDEX IF NOT EXISTS disciplinary_actions_emp_idx ON disciplinary_actions(employee_id, occurred_at DESC);

CREATE TRIGGER disciplinary_actions_updated_at
  BEFORE UPDATE ON disciplinary_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION disciplinary_actions_ack_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_editable CONSTANT TEXT[] := ARRAY['acknowledged_at', 'updated_at'];
BEGIN
  IF auth.uid() IS NULL OR is_rh() THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - v_editable) IS DISTINCT FROM (to_jsonb(OLD) - v_editable) THEN
    RAISE EXCEPTION 'Você só pode dar ciência desta medida disciplinar.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION disciplinary_actions_ack_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS disciplinary_actions_ack_guard_trg ON disciplinary_actions;
CREATE TRIGGER disciplinary_actions_ack_guard_trg
  BEFORE UPDATE ON disciplinary_actions
  FOR EACH ROW EXECUTE FUNCTION disciplinary_actions_ack_guard();

ALTER TABLE disciplinary_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_disciplinary_actions_all" ON disciplinary_actions FOR ALL USING (is_rh());

CREATE POLICY "gestor_disciplinary_actions_team_select" ON disciplinary_actions FOR SELECT
  USING (employee_id IN (SELECT id FROM employees WHERE manager_id = my_employee_id()));

CREATE POLICY "colabo_disciplinary_actions_own_select" ON disciplinary_actions FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_disciplinary_actions_own_ack" ON disciplinary_actions FOR UPDATE
  USING (employee_id = my_employee_id() AND acknowledged_at IS NULL)
  WITH CHECK (employee_id = my_employee_id());

CREATE TABLE IF NOT EXISTS medical_leaves (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  days              INTEGER GENERATED ALWAYS AS (end_date - start_date + 1) STORED,
  doctor_name       TEXT,
  doctor_crm        TEXT,
  cid               TEXT,
  storage_path      TEXT,
  status            TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'recusado')),
  rejection_reason  TEXT,
  reviewed_by_name  TEXT,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS medical_leaves_emp_idx ON medical_leaves(employee_id, start_date DESC);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS afastado_by_medical_leave_id UUID REFERENCES medical_leaves(id) ON DELETE SET NULL;

SELECT nexus_refresh_employees_view();

CREATE TRIGGER medical_leaves_updated_at
  BEFORE UPDATE ON medical_leaves
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE medical_leaves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rh_medical_leaves_select" ON medical_leaves FOR SELECT USING (is_rh());
CREATE POLICY "rh_medical_leaves_update" ON medical_leaves FOR UPDATE USING (is_rh()) WITH CHECK (is_rh());
CREATE POLICY "rh_medical_leaves_delete" ON medical_leaves FOR DELETE USING (is_rh());

CREATE POLICY "colabo_medical_leaves_own_select" ON medical_leaves FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "colabo_medical_leaves_self_report" ON medical_leaves FOR INSERT
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

CREATE POLICY "colabo_medical_leaves_self_edit_pending" ON medical_leaves FOR UPDATE
  USING (employee_id = my_employee_id() AND status = 'pendente')
  WITH CHECK (employee_id = my_employee_id() AND status = 'pendente');

CREATE POLICY "colabo_medical_leaves_self_withdraw_pending" ON medical_leaves FOR DELETE
  USING (employee_id = my_employee_id() AND status = 'pendente');

CREATE OR REPLACE FUNCTION medical_leaves_team()
RETURNS TABLE (id UUID, employee_id UUID, start_date DATE, end_date DATE, days INTEGER, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ml.id, ml.employee_id, ml.start_date, ml.end_date, ml.days, ml.status
  FROM medical_leaves ml
  JOIN employees e ON e.id = ml.employee_id
  WHERE e.manager_id = my_employee_id()
  ORDER BY ml.start_date DESC;
$$;

GRANT EXECUTE ON FUNCTION medical_leaves_team() TO authenticated;

CREATE POLICY "colabo_storage_select_atestados" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    EXISTS (
      SELECT 1 FROM medical_leaves ml
      WHERE ml.storage_path = storage.objects.name
        AND ml.employee_id = my_employee_id()
    )
  );

CREATE OR REPLACE FUNCTION medical_leaves_apply_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'aprovado' AND NEW.start_date <= CURRENT_DATE AND NEW.end_date >= CURRENT_DATE THEN
    UPDATE employees SET status = 'Afastado', afastado_by_medical_leave_id = NEW.id
    WHERE id = NEW.employee_id AND status = 'Ativo';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS medical_leaves_apply_status_trg ON medical_leaves;
CREATE TRIGGER medical_leaves_apply_status_trg
  AFTER INSERT OR UPDATE ON medical_leaves
  FOR EACH ROW EXECUTE FUNCTION medical_leaves_apply_status();

CREATE OR REPLACE FUNCTION sync_medical_leave_statuses()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE employees e
  SET status = 'Afastado', afastado_by_medical_leave_id = ml.id
  FROM medical_leaves ml
  WHERE e.status = 'Ativo'
    AND ml.employee_id = e.id AND ml.status = 'aprovado'
    AND ml.start_date <= CURRENT_DATE AND ml.end_date >= CURRENT_DATE;

  UPDATE employees e
  SET status = 'Ativo', afastado_by_medical_leave_id = NULL
  FROM medical_leaves ml
  WHERE e.status = 'Afastado'
    AND e.afastado_by_medical_leave_id = ml.id
    AND ml.end_date < CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1 FROM medical_leaves ml2
      WHERE ml2.employee_id = e.id AND ml2.status = 'aprovado'
        AND ml2.start_date <= CURRENT_DATE AND ml2.end_date >= CURRENT_DATE
    )
    AND NOT EXISTS (
      SELECT 1 FROM vacations v
      WHERE v.employee_id = e.id AND v.status = 'aprovado'
        AND v.start_date <= CURRENT_DATE AND v.end_date >= CURRENT_DATE
    );
END;
$$;

REVOKE ALL ON FUNCTION sync_medical_leave_statuses() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION apply_ferias_payroll_event(
  p_employee_id UUID,
  p_mes TEXT,
  p_mes_formatado TEXT,
  p_competencia TEXT,
  p_novos_proventos JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing payslips_decrypted;
  v_proventos JSONB;
  v_total_proventos NUMERIC;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode gerar eventos de folha';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_mes, 0));

  SELECT * INTO v_existing FROM payslips_decrypted WHERE employee_id = p_employee_id AND mes = p_mes;

  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_existing.proventos, '[]'::jsonb)) p WHERE p->>'cod' = '040') THEN
      RETURN;
    END IF;
    v_proventos := COALESCE(v_existing.proventos, '[]'::jsonb) || p_novos_proventos;
    v_total_proventos := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(v_proventos) p);
    UPDATE payslips SET
      proventos = v_proventos::text,
      total_proventos = v_total_proventos::text,
      salario_liquido = (v_total_proventos - COALESCE(v_existing.total_descontos, 0))::text
    WHERE id = v_existing.id;
  ELSE
    v_total_proventos := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(p_novos_proventos) p);
    INSERT INTO payslips (employee_id, mes, mes_formatado, competencia, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
    VALUES (p_employee_id, p_mes, p_mes_formatado, p_competencia, p_novos_proventos::text, '[]', v_total_proventos::text, '0', v_total_proventos::text, 'publicado');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION apply_ferias_payroll_event(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_ferias_payroll_event(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION revert_ferias_payroll_event(p_employee_id UUID, p_mes TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slip payslips_decrypted;
  v_proventos JSONB;
  v_total NUMERIC;
BEGIN
  IF NOT is_rh() THEN
    RAISE EXCEPTION 'Apenas o RH pode reverter eventos de folha';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text || ':' || p_mes, 0));

  SELECT * INTO v_slip FROM payslips_decrypted WHERE employee_id = p_employee_id AND mes = p_mes;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_proventos := COALESCE(
    (SELECT jsonb_agg(p) FROM jsonb_array_elements(COALESCE(v_slip.proventos, '[]'::jsonb)) p WHERE p->>'cod' NOT IN ('040', '041', '042', '043')),
    '[]'::jsonb
  );

  IF jsonb_array_length(v_proventos) = 0 AND jsonb_array_length(COALESCE(v_slip.descontos, '[]'::jsonb)) = 0 THEN
    DELETE FROM payslips WHERE id = v_slip.id;
    RETURN;
  END IF;

  v_total := (SELECT COALESCE(SUM((p->>'valor')::numeric), 0) FROM jsonb_array_elements(v_proventos) p);
  UPDATE payslips SET
    proventos = v_proventos::text,
    total_proventos = v_total::text,
    salario_liquido = (v_total - COALESCE(v_slip.total_descontos, 0))::text
  WHERE id = v_slip.id;
END;
$$;

REVOKE ALL ON FUNCTION revert_ferias_payroll_event(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revert_ferias_payroll_event(UUID, TEXT) TO authenticated, service_role;

SELECT cron.schedule(
  'sync-medical-leave-statuses-daily',
  '5 3 * * *',
  $$SELECT sync_medical_leave_statuses();$$
);

DO $$
DECLARE
  t TEXT;
BEGIN
  IF to_regprocedure('public.mfa_ok()') IS NULL THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'performance_reviews',
    'performance_review_competencies',
    'pdi_goals',
    'job_titles',
    'trainings',
    'employee_trainings',
    'disciplinary_actions',
    'medical_leaves'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t);
    EXECUTE format('CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION purge_expired_conversations()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff  TIMESTAMPTZ := now() - interval '12 months';
  v_chat    INTEGER;
  v_ai      INTEGER;
  v_tickets INTEGER;
BEGIN
  DELETE FROM chat_messages WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_chat = ROW_COUNT;

  DELETE FROM ai_chat_history WHERE created_at < v_cutoff;
  GET DIAGNOSTICS v_ai = ROW_COUNT;

  DELETE FROM hr_tickets t
  WHERE t.status IN ('bot', 'resolvido')
    AND GREATEST(
          t.created_at,
          t.updated_at,
          (SELECT max(m.created_at) FROM hr_ticket_messages m WHERE m.ticket_id = t.id)
        ) < v_cutoff;
  GET DIAGNOSTICS v_tickets = ROW_COUNT;

  RETURN jsonb_build_object('chat_messages', v_chat, 'ai_chat_history', v_ai, 'hr_tickets', v_tickets);
END;
$$;

REVOKE ALL ON FUNCTION purge_expired_conversations() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('purge-expired-conversations', '45 6 * * *', 'SELECT purge_expired_conversations();');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION is_rh()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND profile = 'Administrador'
  ) AND public.mfa_ok();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION my_employee_id()
RETURNS UUID AS $$
  SELECT employee_id FROM profiles
  WHERE id = auth.uid() AND profile = 'colaborador' AND public.mfa_ok();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'employee_audit' AND column_name = 'changes') <> 'text' THEN
    ALTER TABLE employee_audit ALTER COLUMN changes TYPE TEXT USING changes::TEXT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION employee_audit_encrypt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id) THEN
    RAISE EXCEPTION 'Um registro do histórico não pode mudar de colaborador' USING ERRCODE = '42501';
  END IF;

  NEW.changes := nexus_wrap('emp:' || NEW.employee_id::TEXT || ':audit:' || NEW.id::TEXT, nexus_norm_json('Alterações', NEW.changes));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION employee_audit_encrypt() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS employee_audit_encrypt_trg ON employee_audit;
CREATE TRIGGER employee_audit_encrypt_trg
  BEFORE INSERT OR UPDATE ON employee_audit
  FOR EACH ROW EXECUTE FUNCTION employee_audit_encrypt();

UPDATE employee_audit SET changes = changes;

DROP VIEW IF EXISTS employee_audit_decrypted;
CREATE VIEW employee_audit_decrypted WITH (security_invoker = true) AS
  SELECT a.id, a.employee_id,
         nexus_decrypt_ctx_jsonb('emp:' || a.employee_id::text || ':audit:' || a.id::text, a.changes) AS changes,
         a.operator_name, a.operator_email, a.created_at
    FROM employee_audit a;

REVOKE ALL ON employee_audit_decrypted FROM PUBLIC, anon;
GRANT SELECT ON employee_audit_decrypted TO authenticated;

CREATE OR REPLACE FUNCTION nexus_encrypted_columns()
RETURNS TABLE (tbl TEXT, col TEXT, ctx TEXT)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT * FROM (VALUES
    ('employees', 'cpf',                $q$'emp:' || t.id::text$q$),
    ('employees', 'rg',                 $q$'emp:' || t.id::text$q$),
    ('employees', 'telefone',           $q$'emp:' || t.id::text$q$),
    ('employees', 'salary',             $q$'emp:' || t.id::text$q$),
    ('employees', 'chave_pix',          $q$'emp:' || t.id::text$q$),
    ('employees', 'agencia',            $q$'emp:' || t.id::text$q$),
    ('employees', 'conta',              $q$'emp:' || t.id::text$q$),
    ('employees', 'birth_date',         $q$'emp:' || t.id::text$q$),
    ('employees', 'gender',             $q$'emp:' || t.id::text$q$),
    ('employees', 'raca_cor',           $q$'emp:' || t.id::text$q$),
    ('employees', 'deficiencia',        $q$'emp:' || t.id::text$q$),
    ('employees', 'tipo_pensao',        $q$'emp:' || t.id::text$q$),
    ('employees', 'pcd',                $q$'emp:' || t.id::text$q$),
    ('employees', 'pensao_alimenticia', $q$'emp:' || t.id::text$q$),
    ('employee_audit', 'changes',       $q$'emp:' || t.employee_id::text || ':audit:' || t.id::text$q$),
    ('chat_messages',       'content',  $q$'chan:' || t.channel_id::text$q$),
    ('hr_ticket_messages',  'content',  $q$'tkt:' || t.ticket_id::text$q$),
    ('payslips', 'proventos',       $q$'slip:' || t.employee_id::text || ':' || t.mes || ':proventos'$q$),
    ('payslips', 'descontos',       $q$'slip:' || t.employee_id::text || ':' || t.mes || ':descontos'$q$),
    ('payslips', 'total_proventos', $q$'slip:' || t.employee_id::text || ':' || t.mes || ':total_proventos'$q$),
    ('payslips', 'total_descontos', $q$'slip:' || t.employee_id::text || ':' || t.mes || ':total_descontos'$q$),
    ('payslips', 'salario_liquido', $q$'slip:' || t.employee_id::text || ':' || t.mes || ':salario_liquido'$q$),
    ('anonymous_feedback',  'message',     $q$'fb:' || t.id::text || ':message'$q$),
    ('ai_analysis_cache',   'summary',     $q$'ai:cache:' || t.cache_key || ':summary'$q$),
    ('ai_analysis_cache',   'alerts',      $q$'ai:cache:' || t.cache_key || ':alerts'$q$),
    ('ai_analysis_history', 'summary',     $q$'ai:hist:' || t.id::text || ':summary'$q$),
    ('ai_analysis_history', 'alerts',      $q$'ai:hist:' || t.id::text || ':alerts'$q$),
    ('ai_chat_history',     'content',     $q$'ai:chat:' || t.id::text || ':content'$q$),
    ('ai_decision_memory',  'description', $q$'ai:mem:' || t.id::text || ':description'$q$),
    ('ai_decision_log',     'ai_message',  $q$'ail:' || t.id::text || ':ai_message'$q$),
    ('ai_decision_log',     'evidence',    $q$'ail:' || t.id::text || ':evidence'$q$)
  ) AS r (tbl, col, ctx);
$$;

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx ON mfa_recovery_codes(user_id);

ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mfa_recovery_codes FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS mfa_required ON mfa_recovery_codes;
CREATE POLICY mfa_required ON mfa_recovery_codes AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()));

ALTER TABLE security_rules DROP CONSTRAINT IF EXISTS security_rules_kind_check;
ALTER TABLE security_rules ADD CONSTRAINT security_rules_kind_check
  CHECK (kind IN ('login_failures', 'login_after_failures', 'mass_export', 'mass_download', 'off_hours_access', 'mfa_recovery_used'));
ALTER TABLE security_alerts DROP CONSTRAINT IF EXISTS security_alerts_kind_check;
ALTER TABLE security_alerts ADD CONSTRAINT security_alerts_kind_check
  CHECK (kind IN ('login_failures', 'login_after_failures', 'mass_export', 'mass_download', 'off_hours_access', 'mfa_recovery_used'));

INSERT INTO security_rules (kind, threshold, threshold_rows, window_minutes, cooldown_minutes, severity, params, description) VALUES
  ('mfa_recovery_used', 1, NULL, 1, 1, 'critical', '{}',
   'Código de recuperação usado no lugar do app autenticador (o app foi desvinculado da conta)')
ON CONFLICT (kind) DO NOTHING;

CREATE OR REPLACE FUNCTION mfa_recovery_generate()
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes    BYTEA;
  v_code     TEXT;
  v_codes    TEXT[] := '{}';
BEGIN
  IF v_uid IS NULL OR COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'Confirme o código do app autenticador antes de gerar códigos de recuperação' USING ERRCODE = '42501';
  END IF;

  DELETE FROM mfa_recovery_codes WHERE user_id = v_uid;

  FOR i IN 1..10 LOOP
    v_bytes := gen_random_bytes(10);
    v_code := '';
    FOR j IN 0..9 LOOP
      v_code := v_code || substr(v_alphabet, get_byte(v_bytes, j) % 32 + 1, 1);
    END LOOP;
    v_code := substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
    INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (v_uid, crypt(v_code, gen_salt('bf', 10)));
    v_codes := v_codes || v_code;
  END LOOP;

  RETURN v_codes;
END;
$$;

CREATE OR REPLACE FUNCTION mfa_recovery_remaining()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM mfa_recovery_codes WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION mfa_recovery_verify(p_user UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_norm TEXT := upper(regexp_replace(COALESCE(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
BEGIN
  IF p_user IS NULL OR length(v_norm) <> 10 THEN
    RETURN FALSE;
  END IF;
  v_norm := substr(v_norm, 1, 5) || '-' || substr(v_norm, 6, 5);

  IF NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p_user AND f.status = 'verified') THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (SELECT 1 FROM mfa_recovery_codes c WHERE c.user_id = p_user AND c.code_hash = crypt(v_norm, c.code_hash));
END;
$$;

CREATE OR REPLACE FUNCTION mfa_recovery_complete(p_user UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule  security_rules;
  v_label TEXT := security_subject_label(p_user);
BEGIN
  DELETE FROM mfa_recovery_codes WHERE user_id = p_user;

  SELECT * INTO v_rule FROM security_rules WHERE kind = 'mfa_recovery_used' AND enabled;
  IF FOUND THEN
    PERFORM security_raise_alert(
      v_rule, 'user:' || p_user::text, p_user, v_label,
      'Código de recuperação do MFA usado',
      v_label || ' entrou com um código de recuperação e o app autenticador foi desvinculado da conta. Confirme com a pessoa que foi ela.',
      '{}'::jsonb
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mfa_recovery_generate()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mfa_recovery_remaining()            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mfa_recovery_verify(UUID, TEXT)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mfa_recovery_complete(UUID)         FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mfa_recovery_generate()          TO authenticated;
GRANT EXECUTE ON FUNCTION mfa_recovery_remaining()         TO authenticated;
GRANT EXECUTE ON FUNCTION mfa_recovery_verify(UUID, TEXT)  TO service_role;
GRANT EXECUTE ON FUNCTION mfa_recovery_complete(UUID)      TO service_role;

CREATE TABLE IF NOT EXISTS e2e_keys (
  user_id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  public_key          JSONB NOT NULL,
  fingerprint         TEXT NOT NULL,
  wrapped_by_password JSONB NOT NULL,
  wrapped_by_recovery JSONB NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS e2e_org_keys (
  id          TEXT PRIMARY KEY CHECK (id = 'rh'),
  public_key  JSONB NOT NULL,
  fingerprint TEXT NOT NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS e2e_org_key_grants (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_fp    TEXT NOT NULL,
  wrapped_private JSONB NOT NULL,
  granted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipient_fp)
);

CREATE TABLE IF NOT EXISTS e2e_channel_keys (
  channel_id   UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  key_version  INTEGER NOT NULL CHECK (key_version >= 1),
  recipient_fp TEXT NOT NULL,
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  wrapped_key  JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, key_version, recipient_fp)
);

ALTER TABLE e2e_keys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE e2e_org_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE e2e_org_key_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE e2e_channel_keys   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON e2e_keys, e2e_org_keys, e2e_org_key_grants, e2e_channel_keys FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON e2e_keys TO authenticated;
GRANT SELECT, INSERT ON e2e_org_keys, e2e_org_key_grants, e2e_channel_keys TO authenticated;

DROP POLICY IF EXISTS "e2e_keys_own" ON e2e_keys;
CREATE POLICY "e2e_keys_own" ON e2e_keys FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "e2e_org_keys_read" ON e2e_org_keys;
DROP POLICY IF EXISTS "e2e_org_keys_create" ON e2e_org_keys;
CREATE POLICY "e2e_org_keys_read" ON e2e_org_keys FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "e2e_org_keys_create" ON e2e_org_keys FOR INSERT WITH CHECK (is_rh() AND created_by = auth.uid());

CREATE OR REPLACE FUNCTION e2e_fingerprint_of(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fingerprint FROM e2e_keys WHERE user_id = p_user;
$$;

REVOKE ALL ON FUNCTION e2e_fingerprint_of(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION e2e_fingerprint_of(UUID) TO authenticated;

DROP POLICY IF EXISTS "e2e_org_key_grants_own" ON e2e_org_key_grants;
DROP POLICY IF EXISTS "e2e_org_key_grants_give" ON e2e_org_key_grants;
CREATE POLICY "e2e_org_key_grants_own" ON e2e_org_key_grants FOR SELECT USING (is_rh() AND user_id = auth.uid());
CREATE POLICY "e2e_org_key_grants_give" ON e2e_org_key_grants FOR INSERT
  WITH CHECK (
    is_rh()
    AND granted_by = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = e2e_org_key_grants.user_id AND p.profile = 'Administrador')
    AND recipient_fp = e2e_fingerprint_of(e2e_org_key_grants.user_id)
  );

DROP POLICY IF EXISTS "e2e_channel_keys_member_read" ON e2e_channel_keys;
DROP POLICY IF EXISTS "e2e_channel_keys_member_insert" ON e2e_channel_keys;
CREATE POLICY "e2e_channel_keys_member_read" ON e2e_channel_keys FOR SELECT
  USING (chat_channel_is_dm(channel_id) AND chat_is_member(channel_id));
CREATE POLICY "e2e_channel_keys_member_insert" ON e2e_channel_keys FOR INSERT
  WITH CHECK (
    chat_channel_is_dm(channel_id)
    AND chat_is_member(channel_id)
    AND EXISTS (SELECT 1 FROM chat_channel_members m WHERE m.channel_id = e2e_channel_keys.channel_id AND m.employee_id = e2e_channel_keys.employee_id)
  );

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['e2e_keys', 'e2e_org_keys', 'e2e_org_key_grants', 'e2e_channel_keys'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS mfa_required ON public.%I', t);
    EXECUTE format('CREATE POLICY mfa_required ON public.%I AS RESTRICTIVE TO authenticated USING ((SELECT public.mfa_ok()))', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION e2e_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS e2e_keys_updated_at ON e2e_keys;
CREATE TRIGGER e2e_keys_updated_at BEFORE UPDATE ON e2e_keys FOR EACH ROW EXECUTE FUNCTION e2e_touch_updated_at();

CREATE OR REPLACE FUNCTION e2e_employee_key(p_employee_id UUID)
RETURNS TABLE (public_key JSONB, fingerprint TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.public_key, k.fingerprint
    FROM employees e
    JOIN e2e_keys k ON k.user_id = e.auth_user_id
   WHERE e.id = p_employee_id
     AND (is_rh() OR p_employee_id = my_employee_id());
$$;

CREATE OR REPLACE FUNCTION e2e_dm_peer_key(p_channel UUID)
RETURNS TABLE (employee_id UUID, public_key JSONB, fingerprint TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.employee_id, k.public_key, k.fingerprint
    FROM chat_channel_members m
    JOIN employees e ON e.id = m.employee_id
    LEFT JOIN e2e_keys k ON k.user_id = e.auth_user_id
   WHERE m.channel_id = p_channel
     AND m.employee_id IS DISTINCT FROM my_employee_id()
     AND chat_channel_is_dm(p_channel)
     AND chat_is_member(p_channel);
$$;

CREATE OR REPLACE FUNCTION e2e_admins_pending_grant()
RETURNS TABLE (user_id UUID, label TEXT, public_key JSONB, fingerprint TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.user_id, COALESCE(u.email, 'Administrador'), k.public_key, k.fingerprint
    FROM profiles p
    JOIN e2e_keys k ON k.user_id = p.id
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.profile = 'Administrador'
     AND is_rh()
     AND NOT EXISTS (SELECT 1 FROM e2e_org_key_grants g WHERE g.user_id = k.user_id AND g.recipient_fp = k.fingerprint);
$$;

REVOKE ALL ON FUNCTION e2e_touch_updated_at()          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION e2e_employee_key(UUID)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION e2e_dm_peer_key(UUID)           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION e2e_admins_pending_grant()      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION e2e_employee_key(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION e2e_dm_peer_key(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION e2e_admins_pending_grant()   TO authenticated;

ALTER TABLE e2e_channel_keys ALTER COLUMN employee_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION e2e_org_fingerprint()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fingerprint FROM e2e_org_keys WHERE id = 'rh';
$$;

REVOKE ALL ON FUNCTION e2e_org_fingerprint() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION e2e_org_fingerprint() TO authenticated;

DROP POLICY IF EXISTS "e2e_channel_keys_member_read" ON e2e_channel_keys;
DROP POLICY IF EXISTS "e2e_channel_keys_member_insert" ON e2e_channel_keys;

CREATE POLICY "e2e_channel_keys_member_read" ON e2e_channel_keys FOR SELECT
  USING (chat_is_member(channel_id) OR (is_rh() AND NOT chat_channel_is_dm(channel_id)));

CREATE POLICY "e2e_channel_keys_member_insert" ON e2e_channel_keys FOR INSERT
  WITH CHECK (
    chat_is_member(channel_id)
    AND (
      EXISTS (SELECT 1 FROM chat_channel_members m WHERE m.channel_id = e2e_channel_keys.channel_id AND m.employee_id = e2e_channel_keys.employee_id)
      OR (employee_id IS NULL AND NOT chat_channel_is_dm(channel_id) AND recipient_fp = e2e_org_fingerprint())
    )
  );

CREATE OR REPLACE FUNCTION e2e_channel_member_keys(p_channel UUID)
RETURNS TABLE (employee_id UUID, public_key JSONB, fingerprint TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.employee_id, k.public_key, k.fingerprint
    FROM chat_channel_members m
    JOIN employees e ON e.id = m.employee_id
    LEFT JOIN e2e_keys k ON k.user_id = e.auth_user_id
   WHERE m.channel_id = p_channel
     AND chat_is_member(p_channel);
$$;

REVOKE ALL ON FUNCTION e2e_channel_member_keys(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION e2e_channel_member_keys(UUID) TO authenticated;
