const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_A = '00000000-0000-4000-8000-00000000e001';
const U_B = '00000000-0000-4000-8000-00000000e002';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_A, U_B]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
    });
});

const como = (db, sub) => db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub]);
const chamar = async (db, acao, max, janela) => (await db.query('SELECT rate_limit_check($1, $2, $3) AS ok', [acao, max, janela])).rows[0].ok;

describe('Limite de chamadas (migration 061)', () => {
    test('libera até o limite e bloqueia a chamada seguinte', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const resultados = [];
            for (let i = 0; i < 5; i++) resultados.push(await chamar(db, 'teste-ia', 3, 3600));
            assert.deepEqual(resultados, [true, true, true, false, false]);
        });
    });

    test('o contador de um usuário não afeta o de outro nem o de outra ação', async () => {
        await withUser({ sub: U_A }, async (db) => {
            for (let i = 0; i < 4; i++) await chamar(db, 'teste-ia', 3, 3600);
            assert.equal(await chamar(db, 'outra-acao', 3, 3600), true);
            await como(db, U_B);
            assert.equal(await chamar(db, 'teste-ia', 3, 3600), true);
        });
    });

    test('depois que a janela passa, o contador recomeça', async () => {
        await withUser({ sub: U_A }, async (db) => {
            for (let i = 0; i < 4; i++) await chamar(db, 'teste-ia', 3, 3600);
            assert.equal(await chamar(db, 'teste-ia', 3, 3600), false);
            await db.query('RESET ROLE');
            await db.query("UPDATE rate_limits SET window_start = now() - interval '2 hours' WHERE key = $1", [`${U_A}:teste-ia`]);
            await db.query('SET LOCAL ROLE authenticated');
            assert.equal(await chamar(db, 'teste-ia', 3, 3600), true);
        });
    });

    test('anon não pode chamar e a API não enxerga os contadores (RLS)', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query("SELECT has_function_privilege('anon', 'rate_limit_check(text,integer,integer)', 'EXECUTE') AS anon");
            assert.equal(rows[0].anon, false);
        });
        await withUser({ sub: U_A }, async (db) => {
            await chamar(db, 'teste-ia', 3, 3600);
            const { rows } = await db.query('SELECT count(*)::int AS n FROM rate_limits');
            assert.equal(rows[0].n, 0);
        });
    });
});
