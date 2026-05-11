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
  last_access         TIMESTAMPTZ,
  auth_user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

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
  status           TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','concluido','recusado')),
  abono            BOOLEAN DEFAULT false,
  obs              TEXT,
  rejection_reason TEXT,
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
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                    DATE NOT NULL,
  entrada                 TIMESTAMPTZ,
  saida_almoco            TIMESTAMPTZ,
  retorno_almoco          TIMESTAMPTZ,
  saida                   TIMESTAMPTZ,
  entrada_loc             JSONB,      
  saida_almoco_loc        JSONB,
  retorno_almoco_loc      JSONB,
  saida_loc               JSONB,
  ajustado                BOOLEAN DEFAULT false,
  entrada_ajustado        BOOLEAN DEFAULT false,
  saida_almoco_ajustado   BOOLEAN DEFAULT false,
  retorno_almoco_ajustado BOOLEAN DEFAULT false,
  saida_ajustado          BOOLEAN DEFAULT false,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE INDEX IF NOT EXISTS time_records_emp_date_idx ON time_records(employee_id, date DESC);

CREATE TABLE IF NOT EXISTS adjustment_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('entrada','saida-almoco','retorno-almoco','saida','falta')),
  horario       TIME,
  justificativa TEXT NOT NULL,
  status        TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS adj_req_emp_idx    ON adjustment_requests(employee_id);
CREATE INDEX IF NOT EXISTS adj_req_status_idx ON adjustment_requests(status);

CREATE TABLE IF NOT EXISTS burnout_alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  alertas     JSONB NOT NULL,   
  lido        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

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
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  texto      TEXT NOT NULL,
  destino    TEXT NOT NULL,   
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_destino_idx ON messages(destino);
CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at DESC);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY(message_id, employee_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  employee_id  UUID REFERENCES employees(id) ON DELETE CASCADE,
  category     TEXT,            
  tipo         TEXT NOT NULL,
  size_label   TEXT,
  storage_path TEXT,            
  source       TEXT DEFAULT 'Administrador' CHECK (source IN ('Administrador','colaborador')),
  status       TEXT DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','recusado')),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_emp_idx    ON documents(employee_id);
CREATE INDEX IF NOT EXISTS documents_source_idx ON documents(source, category);

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

-- ── Tabelas de IA (via migrations 003–006) ──────────────────────

CREATE TABLE IF NOT EXISTS ai_analysis_cache (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key   TEXT NOT NULL DEFAULT 'latest',
  summary     TEXT NOT NULL DEFAULT '',
  alerts      JSONB NOT NULL DEFAULT '[]',
  health_score INTEGER,
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
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

ALTER TABLE employees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_audit     ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE burnout_alerts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_adjustments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis_cache  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decision_memory ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_rh()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND profile = 'Administrador'
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION my_employee_id()
RETURNS UUID AS $$
  SELECT employee_id FROM profiles WHERE id = auth.uid() AND profile = 'colaborador';
$$ LANGUAGE sql SECURITY DEFINER;

CREATE POLICY "rh_employees_all"   ON employees FOR ALL USING (is_rh());
CREATE POLICY "colabo_employees_own" ON employees FOR SELECT
  USING (id = my_employee_id());

CREATE POLICY "rh_profiles_all"    ON profiles FOR ALL USING (is_rh());
CREATE POLICY "colabo_profiles_own" ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "rh_vacations_all"     ON vacations FOR ALL USING (is_rh());
CREATE POLICY "colabo_vacations_own" ON vacations FOR ALL
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_audit_all"         ON employee_audit FOR ALL USING (is_rh());
CREATE POLICY "colabo_audit_own"     ON employee_audit FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_time_all"          ON time_records FOR ALL USING (is_rh());
CREATE POLICY "colabo_time_own"      ON time_records FOR ALL
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_adjreq_all"        ON adjustment_requests FOR ALL USING (is_rh());
CREATE POLICY "colabo_adjreq_own"    ON adjustment_requests FOR ALL
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_burnout_all"       ON burnout_alerts FOR ALL USING (is_rh());
CREATE POLICY "colabo_burnout_own"   ON burnout_alerts FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_actlogs_all"       ON activity_logs FOR ALL USING (is_rh());
CREATE POLICY "colabo_actlogs_own"   ON activity_logs FOR ALL
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_messages_all"      ON messages FOR ALL USING (is_rh());
CREATE POLICY "colabo_messages_read" ON messages FOR SELECT
  USING (
    destino = 'Todos' OR
    destino = (SELECT dept FROM employees WHERE id = my_employee_id())
  );

CREATE POLICY "rh_reads_all"         ON message_reads FOR ALL USING (is_rh());
CREATE POLICY "colabo_reads_own"     ON message_reads FOR ALL
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_docs_all"          ON documents FOR ALL USING (is_rh());
CREATE POLICY "colabo_docs_own"      ON documents FOR ALL
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_payslips_all"      ON payslips FOR ALL USING (is_rh());
CREATE POLICY "colabo_payslips_own"  ON payslips FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_bankadj_all"       ON bank_adjustments FOR ALL USING (is_rh());
CREATE POLICY "colabo_bankadj_own"   ON bank_adjustments FOR SELECT
  USING (employee_id = my_employee_id());

CREATE POLICY "rh_cache_all"   ON ai_analysis_cache   FOR ALL USING (is_rh());
CREATE POLICY "rh_history_all" ON ai_analysis_history FOR ALL USING (is_rh());
CREATE POLICY "rh_chat_all"    ON ai_chat_history     FOR ALL USING (is_rh());
CREATE POLICY "rh_memory_all"  ON ai_decision_memory  FOR ALL USING (is_rh());

CREATE POLICY "rh_storage_all" ON storage.objects FOR ALL
  USING (bucket_id = 'documents' AND is_rh());

CREATE POLICY "colabo_storage_own" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] = my_employee_id()::TEXT
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