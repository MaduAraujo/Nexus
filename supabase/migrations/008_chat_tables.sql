-- ── Chat: canais sociais e atendimento RH ────────────────────────────────────

-- Canais do chat social
CREATE TABLE IF NOT EXISTS chat_channels (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  icon        TEXT DEFAULT 'hashtag',
  dept        TEXT,                   -- NULL = canal aberto a todos
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Membros dos canais
CREATE TABLE IF NOT EXISTS chat_channel_members (
  channel_id  UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id)    ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (channel_id, employee_id)
);

-- Mensagens nos canais sociais
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id)    ON DELETE CASCADE,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_channel_idx ON chat_messages(channel_id, created_at DESC);

-- Tickets de atendimento RH
CREATE TABLE IF NOT EXISTS hr_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  subject     TEXT NOT NULL DEFAULT 'Atendimento RH',
  status      TEXT NOT NULL DEFAULT 'bot'
              CHECK (status IN ('bot', 'aguardando_rh', 'em_atendimento', 'resolvido')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hr_tickets_emp_idx ON hr_tickets(employee_id, created_at DESC);

CREATE TRIGGER hr_tickets_updated_at
  BEFORE UPDATE ON hr_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Mensagens dentro dos tickets
CREATE TABLE IF NOT EXISTS hr_ticket_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES hr_tickets(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,  -- NULL = bot
  role        TEXT NOT NULL CHECK (role IN ('user', 'bot', 'rh')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hr_ticket_msgs_idx ON hr_ticket_messages(ticket_id, created_at ASC);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE chat_channels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channel_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_tickets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_ticket_messages    ENABLE ROW LEVEL SECURITY;

-- chat_channels: todos podem ler; só RH cria/edita
CREATE POLICY "channels_read_all"  ON chat_channels FOR SELECT USING (true);
CREATE POLICY "channels_rh_all"    ON chat_channels FOR ALL   USING (is_rh());

-- chat_channel_members: todos leem; colaborador entra em canal; RH gerencia
CREATE POLICY "members_read_all"   ON chat_channel_members FOR SELECT USING (true);
CREATE POLICY "members_colab_join" ON chat_channel_members FOR INSERT
  WITH CHECK (employee_id = my_employee_id());
CREATE POLICY "members_colab_del"  ON chat_channel_members FOR DELETE
  USING (employee_id = my_employee_id());
CREATE POLICY "members_rh_all"     ON chat_channel_members FOR ALL USING (is_rh());

-- chat_messages: membro do canal lê e escreve
CREATE POLICY "msgs_member_read"   ON chat_messages FOR SELECT
  USING (
    is_rh()
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
CREATE POLICY "msgs_rh_all"        ON chat_messages FOR ALL USING (is_rh());

-- hr_tickets: colaborador vê apenas os seus; RH vê todos
CREATE POLICY "tickets_colab_own"  ON hr_tickets FOR ALL
  USING (employee_id = my_employee_id());
CREATE POLICY "tickets_rh_all"     ON hr_tickets FOR ALL USING (is_rh());

-- hr_ticket_messages: acesso vinculado ao ticket dono
CREATE POLICY "tmsg_colab_own"     ON hr_ticket_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM hr_tickets t
      WHERE t.id = hr_ticket_messages.ticket_id
        AND t.employee_id = my_employee_id()
    )
  );
CREATE POLICY "tmsg_rh_all"        ON hr_ticket_messages FOR ALL USING (is_rh());

-- ── Canais padrão ─────────────────────────────────────────────────────────────

INSERT INTO chat_channels (name, slug, description, icon, dept) VALUES
  ('Geral',          'geral',         'Canal oficial da empresa para todos',          'globe',         NULL),
  ('Ideias',         'ideias',        'Compartilhe sugestões e inovações',            'lightbulb',     NULL),
  ('TI',             'ti',            'Comunicação do time de tecnologia',            'code',          'TI'),
  ('Financeiro',     'financeiro',    'Canal do time financeiro',                     'dollar-sign',   'Financeiro'),
  ('Marketing',      'marketing',     'Canal do time de marketing',                   'bullhorn',      'Marketing'),
  ('Jurídico',       'juridico',      'Canal da equipe jurídica',                     'gavel',         'Jurídico'),
  ('Administrativo', 'administrativo','Canal administrativo',                         'building',      'Administrativo')
ON CONFLICT (slug) DO NOTHING;
