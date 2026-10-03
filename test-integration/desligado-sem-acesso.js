const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000dd01';
const U_A = '00000000-0000-4000-8000-00000000dd02';
const U_B = '00000000-0000-4000-8000-00000000dd03';

const E_RH = '00000000-0000-4000-9000-00000000dd01';
const E_A = '00000000-0000-4000-9000-00000000dd02';
const E_B = '00000000-0000-4000-9000-00000000dd03';

const KUDO = 'elogio-fixture-099';
const ENDPOINT = 'https://push.test.local/099';
const EMAIL_REAL = 'desligado.a@test.local';

const status = (id, valor) => withServiceRole((db) => db.query('UPDATE employees SET status = $2 WHERE id = $1', [id, valor]));

before(async () => {
    await withServiceRole(async (db) => {
        for (const [id, email] of [
            [U_RH, 'desligado.rh@test.local'],
            [U_A, EMAIL_REAL],
            [U_B, 'desligado.b@test.local'],
        ]) {
            await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, email]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status)
             VALUES ($1, 'Desligado RH', '962.000.000-01', 'desligado.rh@test.local', 'RH', 'Ativo'),
                    ($2, 'Desligado A', '962.000.000-02', $4, 'Vendas', 'Ativo'),
                    ($3, 'Desligado B', '962.000.000-03', 'desligado.b@test.local', 'Vendas', 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A, E_B, EMAIL_REAL]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A, U_B, E_B]
        );
        await db.query('INSERT INTO kudos (from_employee_id, to_employee_id, message) VALUES ($1, $2, $3)', [E_B, E_A, KUDO]);
    });
});

beforeEach(async () => {
    await withServiceRole((db) => db.query("UPDATE employees SET status = 'Ativo' WHERE id = ANY($1)", [[E_RH, E_A, E_B]]));
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM kudos WHERE message = $1', [KUDO]);
        await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [ENDPOINT]);
        await db.query("DELETE FROM security_events WHERE detail ->> 'fixture' = '099'");
        await db.query('DELETE FROM security_events WHERE actor_id = $1', [U_A]);
        await db.query('DELETE FROM security_alerts WHERE actor_id = $1', [U_A]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A, U_B]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A, E_B]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A, U_B]]);
    });
});

describe('Desligado perde o acesso (migration 099)', () => {
    test('colaborador ativo continua com acesso normal', async () => {
        await withUser({ sub: U_A }, async (db) => {
            assert.equal((await db.query('SELECT my_employee_id() AS id')).rows[0].id, E_A);
            assert.equal((await db.query('SELECT conta_desativada() AS d')).rows[0].d, false);
            assert.equal((await db.query('SELECT id FROM employees_decrypted WHERE id = $1', [E_A])).rows.length, 1);
            assert.ok((await db.query('SELECT id FROM colleague_directory() WHERE id = $1', [E_B])).rows.length === 1);
            assert.equal((await db.query('SELECT 1 FROM kudos WHERE message = $1', [KUDO])).rows.length, 1);
        });
    });

    test('depois de Inativo, o colaborador não lê mais nada, nem o próprio cadastro', async () => {
        await status(E_A, 'Inativo');
        await withUser({ sub: U_A }, async (db) => {
            assert.equal((await db.query('SELECT my_employee_id() AS id')).rows[0].id, null);
            assert.equal((await db.query('SELECT conta_desativada() AS d')).rows[0].d, true);
            assert.equal((await db.query('SELECT id FROM employees_decrypted WHERE id = $1', [E_A])).rows.length, 0);
            assert.equal((await db.query('SELECT id FROM colleague_directory()')).rows.length, 0);
            assert.equal((await db.query('SELECT 1 FROM kudos WHERE message = $1', [KUDO])).rows.length, 0);
            assert.equal((await db.query('SELECT 1 FROM onboarding_tasks')).rows.length, 0);
        });
    });

    test('o status é conferido sem diferenciar maiúsculas, e Bloqueado também corta o acesso', async () => {
        for (const valor of ['inativo', 'Bloqueado']) {
            await status(E_A, valor);
            await withUser({ sub: U_A }, async (db) => {
                assert.equal((await db.query('SELECT my_employee_id() AS id')).rows[0].id, null, valor);
            });
        }
    });

    test('férias e afastamento não cortam o acesso', async () => {
        for (const valor of ['Férias', 'Afastado']) {
            await status(E_A, valor);
            await withUser({ sub: U_A }, async (db) => {
                assert.equal((await db.query('SELECT my_employee_id() AS id')).rows[0].id, E_A, valor);
            });
        }
    });

    test('RH desligado perde o papel de RH; os outros colaboradores não são afetados', async () => {
        await status(E_RH, 'Inativo');
        await withUser({ sub: U_RH }, async (db) => {
            assert.equal((await db.query('SELECT is_rh() AS r')).rows[0].r, false);
            assert.equal((await db.query('SELECT id FROM employees WHERE id = $1', [E_B])).rows.length, 0);
        });
        await withUser({ sub: U_B }, async (db) => {
            assert.equal((await db.query('SELECT my_employee_id() AS id')).rows[0].id, E_B);
        });
    });

    test('ao desligar, as inscrições de push do colaborador são apagadas', async () => {
        await withServiceRole((db) =>
            db.query("INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth) VALUES ($1, $2, 'k', 'a')", [E_A, ENDPOINT])
        );
        await status(E_A, 'Inativo');
        const { rows } = await withServiceRole((db) => db.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [ENDPOINT]));
        assert.equal(rows.length, 0);
    });

    test('quem não fez login não consulta o status de ninguém', async () => {
        await withServiceRole(async (db) => {
            for (const funcao of ['public.conta_desativada()', 'public.status_bloqueia_acesso(text)']) {
                const { rows } = await db.query("SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok", [funcao]);
                assert.equal(rows[0].ok, false, funcao);
            }
        });
        await withUser({ sub: '', role: 'anon' }, async (db) => {
            const r = (await db.query('SELECT is_rh() AS rh, my_employee_id() AS eu')).rows[0];
            assert.equal(r.rh, false);
            assert.equal(r.eu, null);
        });
    });
});

describe('Falhas de login com o teto global atingido (migration 099)', () => {
    before(async () => {
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO security_events (kind, email_hash, detail)
                 SELECT 'login_failed', md5(g::text), '{"fixture":"099"}'::jsonb FROM generate_series(1, 5000) g`
            )
        );
    });

    test('e-mail inexistente deixa de ser registrado, mas a conta real continua sendo vigiada', async () => {
        const contar = (where, args) =>
            withServiceRole(async (db) => (await db.query(`SELECT count(*)::int AS n FROM security_events WHERE ${where}`, args)).rows[0].n);

        await withUser({ sub: '', role: 'anon', commit: true }, (db) => db.query("SELECT report_login_failure('ninguem.099@test.local')"));
        const hashFalso = (await withServiceRole((db) => db.query("SELECT encode(extensions.digest('ninguem.099@test.local', 'sha256'), 'hex') AS h"))).rows[0]
            .h;
        assert.equal(await contar('email_hash = $1', [hashFalso]), 0);

        await withUser({ sub: '', role: 'anon', commit: true }, (db) => db.query('SELECT report_login_failure($1)', [EMAIL_REAL]));
        assert.equal(await contar("kind = 'login_failed' AND actor_id = $1", [U_A]), 1);
    });
});
