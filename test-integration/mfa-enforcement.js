const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_ADMIN = '00000000-0000-4000-8000-00000000e001';
const U_ADMIN_MFA = '00000000-0000-4000-8000-00000000e002';
const U_COLAB = '00000000-0000-4000-8000-00000000e003';
const U_COLAB_MFA = '00000000-0000-4000-8000-00000000e004';

const E_ADMIN = '00000000-0000-4000-9000-00000000e001';
const E_ADMIN_MFA = '00000000-0000-4000-9000-00000000e002';
const E_COLAB = '00000000-0000-4000-9000-00000000e003';
const E_COLAB_MFA = '00000000-0000-4000-9000-00000000e004';

before(async () => {
    await withServiceRole(async (db) => {
        const people = [
            [U_ADMIN, E_ADMIN, 'Administrador', 'Admin sem MFA'],
            [U_ADMIN_MFA, E_ADMIN_MFA, 'Administrador', 'Admin com MFA'],
            [U_COLAB, E_COLAB, 'colaborador', 'Colab sem MFA'],
            [U_COLAB_MFA, E_COLAB_MFA, 'colaborador', 'Colab com MFA'],
        ];
        for (const [i, [uid, eid, profile, name]] of people.entries()) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [uid]);
            await db.query(
                `INSERT INTO employees (id, name, cpf, email, dept, status)
                 VALUES ($1, $2, $3, $4, 'TI', 'Ativo') ON CONFLICT (id) DO NOTHING`,
                [eid, name, `903.000.000-0${i}`, `mfa${i}@test.local`]
            );
            await db.query('INSERT INTO profiles (id, profile, employee_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [uid, profile, eid]);
        }
        for (const [factorId, uid] of [
            ['00000000-0000-4000-a000-00000000e002', U_ADMIN_MFA],
            ['00000000-0000-4000-a000-00000000e004', U_COLAB_MFA],
        ]) {
            await db.query(
                `INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
                 VALUES ($1, $2, 'teste', 'totp', 'verified', now(), now()) ON CONFLICT (id) DO NOTHING`,
                [factorId, uid]
            );
        }
        await db.query(
            `INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
             VALUES ('00000000-0000-4000-a000-00000000e003', $1, 'pendente', 'totp', 'unverified', now(), now()) ON CONFLICT (id) DO NOTHING`,
            [U_COLAB]
        );
    });
});

const contarFuncionarios = (db) => db.query('SELECT count(*)::int AS n FROM employees').then((r) => r.rows[0].n);
const lerPropriosPerfil = (db, uid) => db.query('SELECT profile FROM profiles WHERE id = $1', [uid]).then((r) => r.rows.length);

describe('MFA aplicado no banco (migration 063)', () => {
    test('Administrador sem nenhum fator não lê dado algum, mesmo com senha válida (aal1)', async () => {
        await withUser({ sub: U_ADMIN, aal: 'aal1' }, async (db) => {
            assert.equal(await contarFuncionarios(db), 0);
        });
    });

    test('Administrador com MFA ativo e só a senha (aal1) não lê dado algum', async () => {
        await withUser({ sub: U_ADMIN_MFA, aal: 'aal1' }, async (db) => {
            assert.equal(await contarFuncionarios(db), 0);
        });
    });

    test('Administrador que digitou o código (aal2) lê normalmente', async () => {
        await withUser({ sub: U_ADMIN_MFA, aal: 'aal2' }, async (db) => {
            assert.ok((await contarFuncionarios(db)) >= 4);
        });
    });

    test('a view decifrada também respeita (security_invoker)', async () => {
        await withUser({ sub: U_ADMIN_MFA, aal: 'aal1' }, async (db) => {
            const { rows } = await db.query('SELECT count(*)::int AS n FROM employees_decrypted');
            assert.equal(rows[0].n, 0);
        });
    });

    test('colaborador com MFA ativo e só a senha (aal1) não lê o próprio cadastro', async () => {
        await withUser({ sub: U_COLAB_MFA, aal: 'aal1' }, async (db) => {
            const { rows } = await db.query('SELECT id FROM employees WHERE id = $1', [E_COLAB_MFA]);
            assert.equal(rows.length, 0);
        });
    });

    test('colaborador com MFA ativo e código digitado (aal2) lê o próprio cadastro', async () => {
        await withUser({ sub: U_COLAB_MFA, aal: 'aal2' }, async (db) => {
            const { rows } = await db.query('SELECT id FROM employees WHERE id = $1', [E_COLAB_MFA]);
            assert.equal(rows.length, 1);
        });
    });

    test('colaborador sem MFA (aal1) segue como antes: MFA é opcional para ele', async () => {
        await withUser({ sub: U_COLAB, aal: 'aal1' }, async (db) => {
            const { rows } = await db.query('SELECT id FROM employees WHERE id = $1', [E_COLAB]);
            assert.equal(rows.length, 1);
        });
    });

    test('fator não confirmado não conta: colaborador com QR gerado mas sem código digitado continua entrando', async () => {
        await withUser({ sub: U_COLAB, aal: 'aal1' }, async (db) => {
            const { rows } = await db.query('SELECT public.mfa_ok() AS ok');
            assert.equal(rows[0].ok, true);
        });
    });

    test('profiles continua legível em aal1: o login precisa dela antes do código e a tela de ativação também', async () => {
        for (const uid of [U_ADMIN, U_ADMIN_MFA, U_COLAB_MFA]) {
            await withUser({ sub: uid, aal: 'aal1' }, async (db) => {
                assert.equal(await lerPropriosPerfil(db, uid), 1, uid);
            });
        }
    });

    test('escrita também é barrada em aal1 (administrador com MFA não altera dado sem o código)', async () => {
        await withUser({ sub: U_ADMIN_MFA, aal: 'aal1' }, async (db) => {
            const { rowCount } = await db.query("UPDATE employees SET bio = 'x' WHERE id = $1", [E_COLAB]);
            assert.equal(rowCount, 0);
        });
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT bio FROM employees WHERE id = $1', [E_COLAB]);
            assert.notEqual(rows[0].bio, 'x');
        });
    });

    test('todas as tabelas com RLS (menos profiles) têm a política mfa_required', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query(
                `SELECT c.relname
                 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relname <> 'profiles'
                   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'mfa_required')`
            );
            assert.deepEqual(
                rows.map((r) => r.relname),
                [],
                'tabela nova sem a política mfa_required: veja o aviso no fim da migration 063'
            );
        });
    });

    test('RPC SECURITY DEFINER não contorna o MFA do RH: só com a senha (aal1), is_rh() é falso e anonymize_employee é recusada', async () => {
        await withUser({ sub: U_ADMIN_MFA, aal: 'aal1' }, async (db) => {
            const { rows } = await db.query('SELECT public.is_rh() AS rh');
            assert.equal(rows[0].rh, false);
            await assert.rejects(() => db.query("SELECT anonymize_employee($1, 'x', 'x@test.local')", [E_COLAB]));
        });
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT name FROM employees_decrypted WHERE id = $1', [E_COLAB]);
            assert.equal(rows[0].name, 'Colab sem MFA');
        });
    });

    test('Administrador sem fator cadastrado também não é RH para as RPCs', async () => {
        await withUser({ sub: U_ADMIN, aal: 'aal1' }, async (db) => {
            const { rows } = await db.query('SELECT public.is_rh() AS rh');
            assert.equal(rows[0].rh, false);
        });
    });

    test('Administrador com o código (aal2) segue sendo RH', async () => {
        await withUser({ sub: U_ADMIN_MFA, aal: 'aal2' }, async (db) => {
            const { rows } = await db.query('SELECT public.is_rh() AS rh');
            assert.equal(rows[0].rh, true);
        });
    });

    test('nexus_decrypt_ctx não decifra para o RH em aal1, mesmo com o texto cifrado em mãos', async () => {
        const cipher = await withServiceRole((db) => db.query('SELECT cpf FROM employees WHERE id = $1', [E_COLAB]).then((r) => r.rows[0].cpf));
        await withUser({ sub: U_ADMIN_MFA, aal: 'aal1' }, async (db) => {
            const { rows } = await db.query('SELECT public.nexus_decrypt_ctx($1, $2) AS v', [`emp:${E_COLAB}`, cipher]);
            assert.equal(rows[0].v, null);
        });
        await withUser({ sub: U_ADMIN_MFA, aal: 'aal2' }, async (db) => {
            const { rows } = await db.query('SELECT public.nexus_decrypt_ctx($1, $2) AS v', [`emp:${E_COLAB}`, cipher]);
            assert.notEqual(rows[0].v, null);
        });
    });

    test('colaborador com MFA ativo e só a senha (aal1) não é reconhecido pelas RPCs (ponto, assinatura, DM)', async () => {
        await withUser({ sub: U_COLAB_MFA, aal: 'aal1' }, async (db) => {
            const { rows } = await db.query('SELECT public.my_employee_id() AS id');
            assert.equal(rows[0].id, null);
            await assert.rejects(() => db.query("SELECT punch_time_record(current_date, 'entrada')"), /não é um colaborador/);
        });
        await withUser({ sub: U_COLAB_MFA, aal: 'aal2' }, async (db) => {
            const { rows } = await db.query('SELECT public.my_employee_id() AS id');
            assert.equal(rows[0].id, E_COLAB_MFA);
        });
    });

    test('colaborador sem MFA (aal1) continua reconhecido pelas RPCs', async () => {
        await withUser({ sub: U_COLAB, aal: 'aal1' }, async (db) => {
            const { rows } = await db.query('SELECT public.my_employee_id() AS id');
            assert.equal(rows[0].id, E_COLAB);
        });
    });

    test('anon não executa mfa_ok()', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query("SELECT has_function_privilege('anon', 'public.mfa_ok()', 'EXECUTE') AS anon");
            assert.equal(rows[0].anon, false);
        });
    });
});
