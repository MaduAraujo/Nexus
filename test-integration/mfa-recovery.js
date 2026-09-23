const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_ADMIN = '00000000-0000-4000-8000-00000000c801';
const U_SEM_FATOR = '00000000-0000-4000-8000-00000000c802';
const E_ADMIN = '00000000-0000-4000-9000-00000000c801';
const E_SEM_FATOR = '00000000-0000-4000-9000-00000000c802';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_ADMIN, U_SEM_FATOR]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status)
             VALUES ($1, 'Rec Admin', '932.000.000-01', 'rec.admin@test.local', 'RH', 'Ativo'),
                    ($2, 'Rec Colab', '932.000.000-02', 'rec.colab@test.local', 'TI', 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_ADMIN, E_SEM_FATOR]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4) ON CONFLICT (id) DO NOTHING`,
            [U_ADMIN, E_ADMIN, U_SEM_FATOR, E_SEM_FATOR]
        );
        await db.query(
            `INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
             VALUES ('00000000-0000-4000-a000-00000000c801', $1, 'teste', 'totp', 'verified', now(), now()) ON CONFLICT (id) DO NOTHING`,
            [U_ADMIN]
        );
        await db.query('DELETE FROM mfa_recovery_codes WHERE user_id = ANY($1)', [[U_ADMIN, U_SEM_FATOR]]);
    });
});

const gerar = (sub, aal) => withUser({ sub, aal, commit: true }, (db) => db.query('SELECT mfa_recovery_generate() AS codes').then((r) => r.rows[0].codes));
const conferir = (user, code) => withServiceRole((db) => db.query('SELECT mfa_recovery_verify($1, $2) AS ok', [user, code]).then((r) => r.rows[0].ok));

describe('Códigos de recuperação do MFA (migration 084)', () => {
    test('só gera com o código do app já digitado (aal2): com só a senha é recusado', async () => {
        await assert.rejects(() => gerar(U_ADMIN, 'aal1'), /Confirme o código do app autenticador/);
    });

    test('gera 10 códigos distintos no formato XXXXX-XXXXX e guarda só o hash', async () => {
        const codes = await gerar(U_ADMIN, 'aal2');
        assert.equal(codes.length, 10);
        assert.equal(new Set(codes).size, 10);
        for (const c of codes) assert.match(c, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);

        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT code_hash FROM mfa_recovery_codes WHERE user_id = $1', [U_ADMIN]);
            assert.equal(rows.length, 10);
            for (const r of rows) {
                assert.ok(r.code_hash.startsWith('$2a$10$'), 'bcrypt');
                assert.ok(!codes.some((c) => r.code_hash.includes(c)));
            }
        });
    });

    test('gerar de novo invalida os códigos antigos', async () => {
        const antigos = await gerar(U_ADMIN, 'aal2');
        const novos = await gerar(U_ADMIN, 'aal2');
        assert.equal(await conferir(U_ADMIN, antigos[0]), false);
        assert.equal(await conferir(U_ADMIN, novos[0]), true);
    });

    test('a pessoa vê quantos restam, mas nunca lê a tabela de hashes', async () => {
        await gerar(U_ADMIN, 'aal2');
        await withUser({ sub: U_ADMIN }, async (db) => {
            const { rows } = await db.query('SELECT mfa_recovery_remaining() AS n');
            assert.equal(rows[0].n, 10);
            const hashes = await db.query('SELECT * FROM mfa_recovery_codes').then(
                (r) => r.rows,
                () => []
            );
            assert.equal(hashes.length, 0);
        });
    });

    test('conferência aceita o código normalizado (sem hífen, minúsculo) e recusa código errado', async () => {
        const [code] = await gerar(U_ADMIN, 'aal2');
        assert.equal(await conferir(U_ADMIN, code.replace('-', '').toLowerCase()), true);
        assert.equal(await conferir(U_ADMIN, 'AAAAA-AAAAA'), false);
        assert.equal(await conferir(U_ADMIN, ''), false);
        assert.equal(await conferir(U_SEM_FATOR, code), false, 'código de outra pessoa');
    });

    test('sem fator TOTP verificado, nenhum código vale (não há o que recuperar)', async () => {
        const codes = await gerar(U_SEM_FATOR, 'aal2');
        assert.equal(await conferir(U_SEM_FATOR, codes[0]), false);
    });

    test('concluir a recuperação apaga todos os códigos e gera alerta crítico para o RH', async () => {
        await gerar(U_ADMIN, 'aal2');
        await withServiceRole(async (db) => {
            await db.query("DELETE FROM security_alerts WHERE kind = 'mfa_recovery_used'");
            await db.query('SELECT mfa_recovery_complete($1)', [U_ADMIN]);
            const restantes = await db.query('SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1', [U_ADMIN]);
            assert.equal(restantes.rows[0].n, 0);
            const { rows } = await db.query("SELECT severity, actor_id, subject_label FROM security_alerts WHERE kind = 'mfa_recovery_used'");
            assert.equal(rows.length, 1);
            assert.equal(rows[0].severity, 'critical');
            assert.equal(rows[0].actor_id, U_ADMIN);
            assert.equal(rows[0].subject_label, 'Rec Admin');
        });
    });

    test('conferir e concluir são só da Edge Function (service_role): nem anon nem usuário logado chamam', async () => {
        await withServiceRole(async (db) => {
            for (const fn of ['mfa_recovery_verify(uuid,text)', 'mfa_recovery_complete(uuid)']) {
                for (const role of ['anon', 'authenticated']) {
                    const { rows } = await db.query('SELECT has_function_privilege($1, $2, $3) AS ok', [role, `public.${fn}`, 'EXECUTE']);
                    assert.equal(rows[0].ok, false, `${role} executa ${fn}`);
                }
                const { rows } = await db.query("SELECT has_function_privilege('service_role', $1, 'EXECUTE') AS ok", [`public.${fn}`]);
                assert.equal(rows[0].ok, true, fn);
            }
            for (const fn of ['mfa_recovery_generate()', 'mfa_recovery_remaining()']) {
                const { rows } = await db.query("SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok", [`public.${fn}`]);
                assert.equal(rows[0].ok, false, `anon executa ${fn}`);
            }
        });
    });
});
