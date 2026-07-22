CREATE TABLE IF NOT EXISTS holidays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date         DATE NOT NULL,
  name         TEXT NOT NULL,
  abrangencia  TEXT DEFAULT 'nacional' CHECK (abrangencia IN ('nacional','estadual','municipal','facultativo')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date)
);

CREATE INDEX IF NOT EXISTS holidays_date_idx ON holidays(date);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_holidays_all"      ON holidays FOR ALL USING (is_rh());
CREATE POLICY "colabo_holidays_select" ON holidays FOR SELECT
  USING (my_employee_id() IS NOT NULL);

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

CREATE TABLE IF NOT EXISTS hr_settings (
  id                          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  banco_horas_vencimento_meses INTEGER NOT NULL DEFAULT 6,
  limite_extra_diario_min      INTEGER NOT NULL DEFAULT 120,
  updated_at                   TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO hr_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE hr_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_hr_settings_all" ON hr_settings FOR ALL USING (is_rh());