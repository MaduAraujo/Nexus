const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000d801';
const U_RH2 = '00000000-0000-4000-8000-00000000d802';
const U_A = '00000000-0000-4000-8000-00000000d803';
const U_B = '00000000-0000-4000-8000-00000000d804';
const U_C = '00000000-0000-4000-8000-00000000d805';

const E_A = '00000000-0000-4000-9000-00000000d803';
const E_B = '00000000-0000-4000-9000-00000000d804';
const E_C = '00000000-0000-4000-9000-00000000d805';

const PUB = (n) => ({ kty: 'EC', crv: 'P-256', x: `x${n}`, y: `y${n}` });
const BLOB = { v: 1, iv: 'aaa', ct: 'bbb' };

let dmAB;

async function keyRow(db, uid, n) {
    await db.query(
        `INSERT INTO e2e_keys (user_id, public_key, fingerprint, wrapped_by_password, wrapped_by_recovery) VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (user_id) DO UPDATE SET public_key = EXCLUDED.public_key, fingerprint = EXCLUDED.fingerprint`,
        [uid, PUB(n), `fp-${n}`, BLOB]
    );
}

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_RH2, U_A, U_B, U_C]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        for (const [eid, uid, n] of [
            [E_A, U_A, 3],
            [E_B, U_B, 4],
            [E_C, U_C, 5],
        ]) {
            await db.query(
                `INSERT INTO employees (id, name, cpf, email, dept, status, auth_user_id) VALUES ($1, $2, $3, $4, 'TI', 'Ativo', $5)
                 ON CONFLICT (id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id`,
                [eid, `E2E ${n}`, `933.000.000-0${n}`, `e2e${n}@test.local`, uid]
            );
        }
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', NULL), ($2, 'Administrador', NULL),
                    ($3, 'colaborador', $6), ($4, 'colaborador', $7), ($5, 'colaborador', $8)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, U_RH2, U_A, U_B, U_C, E_A, E_B, E_C]
        );
        await db.query('DELETE FROM e2e_org_key_grants');
        await db.query('DELETE FROM e2e_org_keys');
        await db.query('DELETE FROM e2e_keys WHERE user_id = ANY($1)', [[U_RH, U_RH2, U_A, U_B, U_C]]);
        await keyRow(db, U_RH, 1);
        await keyRow(db, U_RH2, 2);
        await keyRow(db, U_A, 3);
        await keyRow(db, U_B, 4);
    });
    dmAB = await withUser({ sub: U_A, commit: true }, (db) => db.query('SELECT get_or_create_dm($1) AS id', [E_B]).then((r) => r.rows[0].id));
    await withServiceRole((db) => db.query('DELETE FROM e2e_channel_keys WHERE channel_id = $1', [dmAB]));
});

const tentar = (db, sql, params) =>
    db.query('SAVEPOINT t').then(() =>
        db.query(sql, params).then(
            async (r) => {
                await db.query('RELEASE SAVEPOINT t');
                return r.rowCount;
            },
            async (e) => {
                await db.query('ROLLBACK TO SAVEPOINT t');
                return e;
            }
        )
    );

describe('Chaves de ponta a ponta (migration 085)', () => {
    test('cada pessoa lê e grava só a própria linha de chaves (a chave privada embrulhada não vaza)', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT user_id FROM e2e_keys');
            assert.deepEqual(
                rows.map((r) => r.user_id),
                [U_A]
            );
            const err = await tentar(
                db,
                'INSERT INTO e2e_keys (user_id, public_key, fingerprint, wrapped_by_password, wrapped_by_recovery) VALUES ($1, $2, $3, $4, $4)',
                [U_C, PUB(9), 'fp-9', BLOB]
            );
            assert.ok(err instanceof Error, 'não pode criar chave para outra pessoa');
            assert.equal(await tentar(db, "UPDATE e2e_keys SET fingerprint = 'x' WHERE user_id = $1", [U_B]), 0);
        });
    });

    test('chave pública de colaborador: o RH vê qualquer uma; o colaborador só a própria', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT fingerprint FROM e2e_employee_key($1)', [E_B]);
            assert.equal(rows[0].fingerprint, 'fp-4');
        });
        await withUser({ sub: U_A }, async (db) => {
            assert.equal((await db.query('SELECT * FROM e2e_employee_key($1)', [E_A])).rows.length, 1);
            assert.equal((await db.query('SELECT * FROM e2e_employee_key($1)', [E_B])).rows.length, 0);
        });
    });

    test('chave da organização: só o RH cria, todo usuário logado lê a pública', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const err = await tentar(db, "INSERT INTO e2e_org_keys (id, public_key, fingerprint, created_by) VALUES ('rh', $1, 'fp-org', $2)", [PUB(0), U_A]);
            assert.ok(err instanceof Error);
        });
        await withUser({ sub: U_RH, commit: true }, async (db) => {
            await db.query("INSERT INTO e2e_org_keys (id, public_key, fingerprint, created_by) VALUES ('rh', $1, 'fp-org', $2)", [PUB(0), U_RH]);
            await db.query("INSERT INTO e2e_org_key_grants (user_id, recipient_fp, wrapped_private, granted_by) VALUES ($1, 'fp-1', $2, $1)", [U_RH, BLOB]);
        });
        await withUser({ sub: U_B }, async (db) => {
            assert.equal((await db.query('SELECT fingerprint FROM e2e_org_keys')).rows[0].fingerprint, 'fp-org');
        });
    });

    test('acesso à chave do RH: só para Administrador, com a impressão digital atual dele, e cada um lê só o seu', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const pendentes = await db.query('SELECT user_id FROM e2e_admins_pending_grant()');
            assert.deepEqual(
                pendentes.rows.map((r) => r.user_id),
                [U_RH2]
            );
            assert.ok(
                (await tentar(db, "INSERT INTO e2e_org_key_grants (user_id, recipient_fp, wrapped_private, granted_by) VALUES ($1, 'fp-3', $2, $3)", [
                    U_A,
                    BLOB,
                    U_RH,
                ])) instanceof Error,
                'colaborador não recebe a chave do RH'
            );
            assert.ok(
                (await tentar(db, "INSERT INTO e2e_org_key_grants (user_id, recipient_fp, wrapped_private, granted_by) VALUES ($1, 'fp-velha', $2, $3)", [
                    U_RH2,
                    BLOB,
                    U_RH,
                ])) instanceof Error,
                'impressão digital diferente da atual'
            );
            assert.equal(
                await tentar(db, "INSERT INTO e2e_org_key_grants (user_id, recipient_fp, wrapped_private, granted_by) VALUES ($1, 'fp-2', $2, $3)", [
                    U_RH2,
                    BLOB,
                    U_RH,
                ]),
                1
            );
        });
        await withUser({ sub: U_RH2 }, async (db) => {
            const { rows } = await db.query('SELECT user_id FROM e2e_org_key_grants');
            assert.ok(rows.every((r) => r.user_id === U_RH2));
        });
        await withUser({ sub: U_A }, async (db) => {
            assert.equal((await db.query('SELECT * FROM e2e_org_key_grants')).rows.length, 0);
            assert.equal((await db.query('SELECT * FROM e2e_admins_pending_grant()')).rows.length, 0);
        });
    });

    test('conversa direta: os dois membros veem a chave pública um do outro; quem está fora não vê nada', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT employee_id, fingerprint FROM e2e_dm_peer_key($1)', [dmAB]);
            assert.deepEqual(rows, [{ employee_id: E_B, fingerprint: 'fp-4' }]);
        });
        await withUser({ sub: U_C }, async (db) => {
            assert.equal((await db.query('SELECT * FROM e2e_dm_peer_key($1)', [dmAB])).rows.length, 0);
        });
        await withUser({ sub: U_RH }, async (db) => {
            assert.equal((await db.query('SELECT * FROM e2e_dm_peer_key($1)', [dmAB])).rows.length, 0);
        });
    });

    test('chave da conversa: só membros gravam e leem, e só para membros; o RH não vê', async () => {
        await withUser({ sub: U_A, commit: true }, async (db) => {
            await db.query(
                `INSERT INTO e2e_channel_keys (channel_id, key_version, recipient_fp, employee_id, wrapped_key) VALUES ($1, 1, 'fp-3', $2, $4), ($1, 1, 'fp-4', $3, $4)`,
                [dmAB, E_A, E_B, BLOB]
            );
        });
        await withUser({ sub: U_A }, async (db) => {
            const err = await tentar(
                db,
                "INSERT INTO e2e_channel_keys (channel_id, key_version, recipient_fp, employee_id, wrapped_key) VALUES ($1, 2, 'fp-5', $2, $3)",
                [dmAB, E_C, BLOB]
            );
            assert.ok(err instanceof Error, 'não entrega a chave para quem não é membro');
            const dup = await tentar(
                db,
                "INSERT INTO e2e_channel_keys (channel_id, key_version, recipient_fp, employee_id, wrapped_key) VALUES ($1, 1, 'fp-3', $2, $3)",
                [dmAB, E_A, BLOB]
            );
            assert.ok(dup instanceof Error, 'a mesma versão não é regravada (corrida entre os dois lados)');
        });
        await withUser({ sub: U_B }, async (db) => {
            assert.equal((await db.query('SELECT * FROM e2e_channel_keys WHERE channel_id = $1', [dmAB])).rows.length, 2);
        });
        for (const sub of [U_C, U_RH]) {
            await withUser({ sub }, async (db) => {
                assert.equal((await db.query('SELECT * FROM e2e_channel_keys WHERE channel_id = $1', [dmAB])).rows.length, 0, sub);
            });
        }
    });

    test('sem o segundo fator (aal1, quem tem MFA), nenhuma tabela de chaves é legível', async () => {
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
                 VALUES ('00000000-0000-4000-a000-00000000d803', $1, 't', 'totp', 'verified', now(), now()) ON CONFLICT (id) DO NOTHING`,
                [U_A]
            )
        );
        await withUser({ sub: U_A, aal: 'aal1' }, async (db) => {
            assert.equal((await db.query('SELECT * FROM e2e_keys')).rows.length, 0);
            assert.equal((await db.query('SELECT * FROM e2e_channel_keys')).rows.length, 0);
        });
        await withServiceRole((db) => db.query("DELETE FROM auth.mfa_factors WHERE id = '00000000-0000-4000-a000-00000000d803'"));
    });

    test('canal de grupo (migration 086): membros veem as chaves públicas uns dos outros; quem não é membro não', async () => {
        const group = await withServiceRole(async (db) => {
            await db.query("DELETE FROM chat_channels WHERE slug = 'e2e-grupo-teste'");
            const { rows } = await db.query("INSERT INTO chat_channels (name, slug, kind) VALUES ('E2E Grupo', 'e2e-grupo-teste', 'channel') RETURNING id");
            await db.query('INSERT INTO chat_channel_members (channel_id, employee_id) VALUES ($1, $2), ($1, $3)', [rows[0].id, E_A, E_B]);
            return rows[0].id;
        });
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT employee_id, fingerprint FROM e2e_channel_member_keys($1) ORDER BY fingerprint', [group]);
            assert.deepEqual(rows, [
                { employee_id: E_A, fingerprint: 'fp-3' },
                { employee_id: E_B, fingerprint: 'fp-4' },
            ]);
        });
        await withUser({ sub: U_C }, async (db) => {
            assert.equal((await db.query('SELECT * FROM e2e_channel_member_keys($1)', [group])).rows.length, 0);
        });

        await withUser({ sub: U_A }, async (db) => {
            const orgErrada = await tentar(
                db,
                "INSERT INTO e2e_channel_keys (channel_id, key_version, recipient_fp, employee_id, wrapped_key) VALUES ($1, 1, 'fp-falsa', NULL, $2)",
                [group, BLOB]
            );
            assert.ok(orgErrada instanceof Error, 'entrada sem colaborador só vale para a impressão digital da chave do RH');
            const orgNoDm = await tentar(
                db,
                "INSERT INTO e2e_channel_keys (channel_id, key_version, recipient_fp, employee_id, wrapped_key) VALUES ($1, 9, 'fp-org', NULL, $2)",
                [dmAB, BLOB]
            );
            assert.ok(orgNoDm instanceof Error, 'a chave do RH nunca recebe a chave de uma conversa direta');
            const ok = await tentar(
                db,
                `INSERT INTO e2e_channel_keys (channel_id, key_version, recipient_fp, employee_id, wrapped_key)
                 VALUES ($1, 1, 'fp-3', $2, $4), ($1, 1, 'fp-4', $3, $4), ($1, 1, 'fp-org', NULL, $4)`,
                [group, E_A, E_B, BLOB]
            );
            assert.equal(ok, 3);
            const { rows } = await db.query('SELECT count(*)::int AS n FROM e2e_channel_keys WHERE channel_id = $1', [group]);
            assert.equal(rows[0].n, 3);
        });

        await withServiceRole((db) =>
            db.query(
                `INSERT INTO e2e_channel_keys (channel_id, key_version, recipient_fp, employee_id, wrapped_key)
                 VALUES ($1, 1, 'fp-3', $2, $4), ($1, 1, 'fp-4', $3, $4), ($1, 1, 'fp-org', NULL, $4) ON CONFLICT DO NOTHING`,
                [group, E_A, E_B, BLOB]
            )
        );
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT recipient_fp FROM e2e_channel_keys WHERE channel_id = $1 ORDER BY recipient_fp', [group]);
            assert.equal(rows.length, 3, 'o RH (compliance) enxerga as entradas do grupo; só abre a da chave do RH');
        });
        await withUser({ sub: U_C }, async (db) => {
            assert.equal((await db.query('SELECT * FROM e2e_channel_keys WHERE channel_id = $1', [group])).rows.length, 0);
            const invasor = await tentar(
                db,
                "INSERT INTO e2e_channel_keys (channel_id, key_version, recipient_fp, employee_id, wrapped_key) VALUES ($1, 2, 'fp-5', $2, $3)",
                [group, E_C, BLOB]
            );
            assert.ok(invasor instanceof Error, 'quem não é membro não se inclui na chave do grupo');
        });
    });

    test('anon não chama as funções de chaves', async () => {
        await withServiceRole(async (db) => {
            for (const fn of [
                'e2e_employee_key(uuid)',
                'e2e_dm_peer_key(uuid)',
                'e2e_admins_pending_grant()',
                'e2e_channel_member_keys(uuid)',
                'e2e_org_fingerprint()',
            ]) {
                const { rows } = await db.query("SELECT has_function_privilege('anon', $1, 'EXECUTE') AS ok", [`public.${fn}`]);
                assert.equal(rows[0].ok, false, fn);
            }
        });
    });
});
