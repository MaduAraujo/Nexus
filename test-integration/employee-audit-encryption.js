const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const PREFIX = 'nexus:enc1:';

const U_RH = '00000000-0000-4000-8000-00000000a801';
const U_A = '00000000-0000-4000-8000-00000000a802';
const U_B = '00000000-0000-4000-8000-00000000a803';

const E_RH = '00000000-0000-4000-9000-00000000a801';
const E_A = '00000000-0000-4000-9000-00000000a802';
const E_B = '00000000-0000-4000-9000-00000000a803';

const AUD_A = '00000000-0000-4000-b000-00000000a802';
const AUD_B = '00000000-0000-4000-b000-00000000a803';

const CHANGES_A = [
    { field: 'cpf', label: 'CPF', oldValue: '111.222.333-44', newValue: '931.000.000-02' },
    { field: 'salary', label: 'Salário', oldValue: 4000, newValue: 5000 },
];
const CHANGES_B = [{ field: 'dept', label: 'Departamento', oldValue: 'TI', newValue: 'Financeiro' }];

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A, U_B]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status)
             VALUES ($1, 'Aud RH', '931.000.000-01', 'aud.rh@test.local', 'RH', 'Ativo'),
                    ($2, 'Aud A',  '931.000.000-02', 'aud.a@test.local',  'TI', 'Ativo'),
                    ($3, 'Aud B',  '931.000.000-03', 'aud.b@test.local',  'TI', 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A, E_B]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A, U_B, E_B]
        );
        await db.query('DELETE FROM employee_audit WHERE employee_id = ANY($1)', [[E_A, E_B]]);
        await db.query(
            `INSERT INTO employee_audit (id, employee_id, changes, operator_name, operator_email)
             VALUES ($1, $2, $3, 'rh', 'rh@test.local'), ($4, $5, $6, 'rh', 'rh@test.local')`,
            [AUD_A, E_A, JSON.stringify(CHANGES_A), AUD_B, E_B, JSON.stringify(CHANGES_B)]
        );
    });
});

const lerCru = (id) => withServiceRole((db) => db.query('SELECT changes FROM employee_audit WHERE id = $1', [id]).then((r) => r.rows[0].changes));

describe('Histórico de edições cifrado (migration 083)', () => {
    test('o banco guarda o histórico cifrado: nem o CPF antigo nem o salário aparecem em claro', async () => {
        const cru = await lerCru(AUD_A);
        assert.ok(cru.startsWith(PREFIX));
        assert.ok(!cru.includes('111.222.333-44'));
        assert.ok(!cru.includes('Salário'));
    });

    test('o RH lê o histórico pela view decifrada, com o JSON original', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT changes FROM employee_audit_decrypted WHERE id = $1', [AUD_A]);
            assert.deepEqual(rows[0].changes, CHANGES_A);
        });
    });

    test('o colaborador lê só o próprio histórico', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT id, changes FROM employee_audit_decrypted WHERE employee_id = ANY($1)', [[E_A, E_B]]);
            assert.deepEqual(
                rows.map((r) => r.id),
                [AUD_A]
            );
            assert.deepEqual(rows[0].changes, CHANGES_A);
        });
    });

    test('texto cifrado do histórico de outra pessoa não decifra, nem copiado para o próprio contexto', async () => {
        const alheio = await lerCru(AUD_B);
        await withUser({ sub: U_A }, async (db) => {
            const proprio = await db.query('SELECT public.nexus_decrypt_ctx($1, $2) AS v', [`emp:${E_A}:audit:${AUD_A}`, alheio]);
            assert.equal(proprio.rows[0].v, null);
            const deB = await db.query('SELECT public.nexus_decrypt_ctx($1, $2) AS v', [`emp:${E_B}:audit:${AUD_B}`, alheio]);
            assert.equal(deB.rows[0].v, null);
        });
    });

    test('inserção pelo RH (como o front faz, JSON como texto) já grava cifrado', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query(`INSERT INTO employee_audit (employee_id, changes, operator_name) VALUES ($1, $2, 'rh') RETURNING id, changes`, [
                E_B,
                JSON.stringify([{ field: 'telefone', oldValue: '11 90000-0000', newValue: '11 91111-1111' }]),
            ]);
            assert.ok(rows[0].changes.startsWith(PREFIX));
            const lido = await db.query('SELECT changes FROM employee_audit_decrypted WHERE id = $1', [rows[0].id]);
            assert.equal(lido.rows[0].changes[0].newValue, '11 91111-1111');
        });
    });

    test('a anonimização (LGPD) também grava o registro cifrado', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await db.query("UPDATE employees SET status = 'Inativo' WHERE id = $1", [E_B]);
            await db.query("SELECT anonymize_employee($1, 'rh', 'rh@test.local')", [E_B]);
            await db.query('RESET ROLE');
            const { rows } = await db.query('SELECT changes FROM employee_audit WHERE employee_id = $1 AND id <> $2', [E_B, AUD_B]);
            assert.ok(rows.length >= 1);
            for (const r of rows) {
                assert.ok(r.changes.startsWith(PREFIX));
                assert.ok(!r.changes.includes('Aud B'));
            }
        });
    });

    test('um registro do histórico não pode mudar de colaborador', async () => {
        await withServiceRole(async (db) => {
            await assert.rejects(() => db.query('UPDATE employee_audit SET employee_id = $1 WHERE id = $2', [E_B, AUD_A]), /não pode mudar de colaborador/);
        });
    });

    test('JSON inválido é recusado', async () => {
        await withServiceRole(async (db) => {
            await assert.rejects(() => db.query("INSERT INTO employee_audit (employee_id, changes) VALUES ($1, 'não é json')", [E_A]), /Alterações inválido/);
        });
    });

    test('a coluna está registrada para a rotação de chaves', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query("SELECT 1 FROM nexus_encrypted_columns() WHERE tbl = 'employee_audit' AND col = 'changes'");
            assert.equal(rows.length, 1);
        });
    });
});
