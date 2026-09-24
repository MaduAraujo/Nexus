const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000f901';
const E_RH = '00000000-0000-4000-9000-00000000f901';
const E_COM_PONTO = '00000000-0000-4000-9000-00000000f902';
const E_SEM_REGISTRO = '00000000-0000-4000-9000-00000000f903';

before(async () => {
    await withServiceRole(async (db) => {
        await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [U_RH]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status)
             VALUES ($1, 'Guard RH', '989.000.000-01', 'guard.rh@test.local', 'RH', 'Ativo'),
                    ($2, 'Guard Com Ponto', '989.000.000-02', 'guard.ponto@test.local', 'TI', 'Inativo'),
                    ($3, 'Guard Cadastro Errado', '989.000.000-03', 'guard.erro@test.local', 'TI', 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_COM_PONTO, E_SEM_REGISTRO]
        );
        await db.query(`INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2) ON CONFLICT (id) DO NOTHING`, [U_RH, E_RH]);
        await db.query(`INSERT INTO time_records (employee_id, date, entrada) VALUES ($1, '2026-06-01', '2026-06-01T08:00:00-03:00') ON CONFLICT DO NOTHING`, [
            E_COM_PONTO,
        ]);
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM profiles WHERE id = $1', [U_RH]);
        await db.query('DELETE FROM auth.users WHERE id = $1', [U_RH]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_COM_PONTO, E_SEM_REGISTRO]]);
    });
});

describe('employees_delete_guard (089)', () => {
    test('RH não exclui colaborador com ponto registrado (prazo legal de guarda)', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await assert.rejects(db.query('DELETE FROM employees WHERE id = $1', [E_COM_PONTO]), { code: '23503', message: /prazo legal de guarda/ });
        });
    });

    test('RH exclui cadastro feito por engano (sem holerite, ponto ou documento)', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rowCount } = await db.query('DELETE FROM employees WHERE id = $1', [E_SEM_REGISTRO]);
            assert.equal(rowCount, 1);
        });
    });

    test('manutenção com service_role continua podendo excluir', async () => {
        await withServiceRole(async (db) => {
            await db.query('BEGIN');
            const { rowCount } = await db.query('DELETE FROM employees WHERE id = $1', [E_COM_PONTO]);
            await db.query('ROLLBACK');
            assert.equal(rowCount, 1);
        });
    });
});
