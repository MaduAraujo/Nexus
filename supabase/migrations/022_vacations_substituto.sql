-- Campo de substituto/cobertura durante o período de férias.
ALTER TABLE vacations ADD COLUMN IF NOT EXISTS substituto_id UUID REFERENCES employees(id) ON DELETE SET NULL;
