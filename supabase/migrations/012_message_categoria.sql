ALTER TABLE messages ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'Institucional';

CREATE INDEX IF NOT EXISTS messages_categoria_idx ON messages(categoria);