const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// supabase/schema.sql é o baseline para bootstrar um projeto Supabase novo (README explica o porquê:
// as migrations em supabase/migrations/ são incrementais e assumem que as tabelas base já existem,
// então `db push` sozinho falha em um banco vazio). Isso só funciona se schema.sql continuar
// carregando tudo que as migrations acrescentaram depois dele — este teste pega o esquecimento
// de embutir uma migration nova no schema.sql consolidado.

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const SCHEMA_FILE = path.join(__dirname, '..', 'supabase', 'schema.sql');

// Identificadores que uma migration introduz e que devem aparecer em algum lugar do schema.sql:
// funções, tabelas, colunas e triggers criados. Não cobre ALTER ... DROP, RLS policies (nome livre
// e repetido entre tabelas) nem DML puro (INSERT/UPDATE de dados) — só a estrutura.
const IDENTIFIER_RE =
    /CREATE (?:OR REPLACE )?FUNCTION ([a-zA-Z0-9_]+)|CREATE TABLE(?: IF NOT EXISTS)? ([a-zA-Z0-9_]+)|ADD COLUMN(?: IF NOT EXISTS)? ([a-zA-Z0-9_]+)|CREATE (?:OR REPLACE )?TRIGGER ([a-zA-Z0-9_]+)/g;

function migrationFiles() {
    return fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
}

test('schema.sql embute tudo que cada migration cria (funções, tabelas, colunas, triggers)', () => {
    const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
    const missing = [];

    for (const file of migrationFiles()) {
        const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        let match;
        IDENTIFIER_RE.lastIndex = 0;
        while ((match = IDENTIFIER_RE.exec(src))) {
            const name = match[1] || match[2] || match[3] || match[4];
            if (!schema.includes(name)) missing.push(`${file} -> ${name}`);
        }
    }

    assert.deepEqual(
        missing,
        [],
        `schema.sql está desatualizado em relação às migrations (rode o objeto faltante manualmente contra schema.sql):\n${missing.join('\n')}`
    );
});

test('supabase/migrations/ tem pelo menos uma migration (regressão contra pasta esvaziada por engano)', () => {
    assert.ok(migrationFiles().length > 0);
});
