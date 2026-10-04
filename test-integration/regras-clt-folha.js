const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000ac01';
const U_A = '00000000-0000-4000-8000-00000000ac02';
const E_RH = '00000000-0000-4000-9000-00000000ac01';
const E_A = '00000000-0000-4000-9000-00000000ac02';

const gravarComoRH = (sql, params) => withUser({ sub: U_RH, commit: true }, (db) => db.query(sql, params));

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, contract_type)
             VALUES ($1, 'Regras RH', '963.000.000-01', 'regras.rh@test.local', 'RH', 'Ativo', 'CLT'),
                    ($2, 'Regras A', '963.000.000-02', 'regras.a@test.local', 'Vendas', 'Ativo', 'CLT')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4) ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A]
        );
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A]]);
    });
});

describe('Migration 105 — adicionais de risco e estabilidade no cadastro', () => {
    test('RH grava periculosidade e insalubridade; grau fora da lista é recusado', async () => {
        const { rows } = await gravarComoRH(
            `UPDATE employees SET adicional_periculosidade = true, grau_insalubridade = 'maximo' WHERE id = $1 RETURNING adicional_periculosidade, grau_insalubridade`,
            [E_A]
        );
        assert.deepEqual(rows[0], { adicional_periculosidade: true, grau_insalubridade: 'maximo' });
        await assert.rejects(gravarComoRH(`UPDATE employees SET grau_insalubridade = 'alto' WHERE id = $1`, [E_A]), { code: '23514' });
    });

    test('motivo da estabilidade fica cifrado na tabela e legível na view', async () => {
        await gravarComoRH(`UPDATE employees SET estabilidade_motivo = 'gestante', estabilidade_ate = '2027-01-31' WHERE id = $1`, [E_A]);
        const cru = await withServiceRole((db) => db.query('SELECT estabilidade_motivo FROM employees WHERE id = $1', [E_A]));
        assert.ok(!cru.rows[0].estabilidade_motivo.includes('gestante'), 'não pode ficar em texto puro');
        const view = await withUser({ sub: U_RH }, (db) =>
            db.query("SELECT estabilidade_motivo, to_char(estabilidade_ate, 'YYYY-MM-DD') AS ate FROM employees_decrypted WHERE id = $1", [E_A])
        );
        assert.deepEqual(view.rows[0], { estabilidade_motivo: 'gestante', ate: '2027-01-31' });
        const cols = await withServiceRole((db) => db.query("SELECT 1 FROM nexus_encrypted_columns() WHERE tbl = 'employees' AND col = 'estabilidade_motivo'"));
        assert.equal(cols.rows.length, 1, 'entra na rotação de chaves');
    });

    test('motivo inválido ou motivo sem data (e vice-versa) são recusados', async () => {
        await assert.rejects(gravarComoRH(`UPDATE employees SET estabilidade_motivo = 'xyz', estabilidade_ate = '2027-01-31' WHERE id = $1`, [E_A]), {
            code: '22P02',
        });
        await assert.rejects(gravarComoRH(`UPDATE employees SET estabilidade_motivo = 'cipa', estabilidade_ate = NULL WHERE id = $1`, [E_A]), {
            code: '23514',
        });
        await assert.rejects(gravarComoRH(`UPDATE employees SET estabilidade_motivo = NULL, estabilidade_ate = '2027-01-31' WHERE id = $1`, [E_A]), {
            code: '23514',
        });
        const { rowCount } = await gravarComoRH(`UPDATE employees SET estabilidade_motivo = NULL, estabilidade_ate = NULL WHERE id = $1`, [E_A]);
        assert.equal(rowCount, 1);
    });

    test('o próprio colaborador não consegue alterar adicionais nem estabilidade', async () => {
        await assert.rejects(
            withUser({ sub: U_A, commit: true }, (db) => db.query('UPDATE employees SET adicional_periculosidade = false WHERE id = $1', [E_A])),
            { code: '42501' }
        );
        await assert.rejects(
            withUser({ sub: U_A, commit: true }, (db) =>
                db.query(`UPDATE employees SET estabilidade_motivo = 'cipa', estabilidade_ate = '2030-01-01' WHERE id = $1`, [E_A])
            ),
            { code: '42501' }
        );
    });
});
