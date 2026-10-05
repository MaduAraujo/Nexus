const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000ae01';
const U_A = '00000000-0000-4000-8000-00000000ae02';
const E_RH = '00000000-0000-4000-9000-00000000ae01';
const E_A = '00000000-0000-4000-9000-00000000ae02';

const HOJE = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
const comoRH = (sql, params) => withUser({ sub: U_RH, commit: true }, (db) => db.query(sql, params));
const comoA = (sql, params) => withUser({ sub: U_A, commit: true }, (db) => db.query(sql, params));

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, contract_type, work_load, salary)
             VALUES ($1, 'Pago RH', '965.000.000-01', 'pago.rh@test.local', 'RH', 'Ativo', 'clt', '44h', '9000'),
                    ($2, 'Pago A', '965.000.000-02', 'pago.a@test.local', 'Vendas', 'Ativo', 'clt', '44h', '3000')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4) ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A]
        );
    });
});

beforeEach(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM payslips WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM time_records WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM bank_adjustments WHERE employee_id = $1', [E_A]);
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM payslips WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM time_records WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM bank_adjustments WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A]]);
    });
});

const holerite = (mes, status) =>
    withServiceRole((db) =>
        db.query(
            `INSERT INTO payslips (employee_id, mes, mes_formatado, competencia, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
             VALUES ($1, $2, $2, $2, '[{"cod":"030","valor":1500}]', '[]', 1500, 0, 1500, $3) RETURNING id`,
            [E_A, mes, status]
        )
    );

describe('Migration 108 — holerite pago não muda', () => {
    test('o RH não volta um holerite pago para publicado, nem troca os valores, nem exclui', async () => {
        const { rows } = await holerite('2026-13-1', 'pago');
        const id = rows[0].id;
        await assert.rejects(comoRH(`UPDATE payslips SET status = 'publicado' WHERE id = $1`, [id]), { code: '55000', message: /já pago/ });
        await assert.rejects(comoRH(`UPDATE payslips SET salario_liquido = 1 WHERE id = $1`, [id]), { code: '55000' });
        await assert.rejects(comoRH('DELETE FROM payslips WHERE id = $1', [id]), { code: '55000' });
        await assert.rejects(
            comoRH(
                `INSERT INTO payslips (employee_id, mes, mes_formatado, competencia, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
                 VALUES ($1, '2026-13-1', 'x', 'x', '[]', '[]', 0, 0, 0, 'publicado')
                 ON CONFLICT (employee_id, mes) DO UPDATE SET status = EXCLUDED.status, salario_liquido = EXCLUDED.salario_liquido`,
                [E_A]
            ),
            { code: '55000' }
        );
    });

    test('holerite ainda não pago continua podendo ser refeito e pago', async () => {
        const { rows } = await holerite('2026-11', 'publicado');
        const r = await comoRH(`UPDATE payslips SET status = 'pago', pago_em = now() WHERE id = $1 RETURNING status`, [rows[0].id]);
        assert.equal(r.rows[0].status, 'pago');
    });
});

describe('Migration 108 — ponto offline', () => {
    test('vale o horário do aparelho e a marcação fica marcada como offline', async () => {
        const { rows } = await comoA(
            `SELECT entrada, offline_steps FROM punch_time_record(${HOJE}, 'entrada', NULL, NULL, NULL, least(now(), (${HOJE})::timestamp AT TIME ZONE 'America/Sao_Paulo' + INTERVAL '1 minute'))`
        );
        assert.deepEqual(rows[0].offline_steps, ['entrada']);
        assert.ok(new Date(rows[0].entrada) <= new Date());
    });

    test('a mesma marcação não é registrada duas vezes', async () => {
        await comoA(`SELECT punch_time_record(${HOJE}, 'entrada')`);
        await assert.rejects(comoA(`SELECT punch_time_record(${HOJE}, 'entrada')`), { code: '23505', message: /já foi registrada/ });
    });

    test('horário no futuro ou fora do dia é recusado', async () => {
        await assert.rejects(comoA(`SELECT punch_time_record(${HOJE}, 'entrada', NULL, NULL, NULL, now() + INTERVAL '1 hour')`), { code: '22007' });
        await assert.rejects(comoA(`SELECT punch_time_record(${HOJE}, 'entrada', NULL, NULL, NULL, now() - INTERVAL '3 days')`), { code: '22007' });
    });
});

describe('Migration 108 — débito lançado pela folha', () => {
    test('o RH não exclui nem altera o débito da folha, mas exclui ajustes comuns', async () => {
        const ins = await withServiceRole((db) =>
            db.query(
                `INSERT INTO bank_adjustments (employee_id, tipo, minutos, date, justificativa, created_by_name) VALUES
                   ($1, 'debito', 240, '2026-01-01', 'Pago como hora extra', 'Folha de pagamento'),
                   ($1, 'credito', 60, '2026-01-01', 'Ajuste manual', 'rh')
                 RETURNING id, created_by_name`,
                [E_A]
            )
        );
        const folha = ins.rows.find((r) => r.created_by_name === 'Folha de pagamento').id;
        const manual = ins.rows.find((r) => r.created_by_name === 'rh').id;
        await assert.rejects(comoRH('UPDATE bank_adjustments SET deleted_at = now() WHERE id = $1', [folha]), { code: '55000' });
        await assert.rejects(comoRH('UPDATE bank_adjustments SET minutos = 1 WHERE id = $1', [folha]), { code: '55000' });
        const { rows } = await comoRH('UPDATE bank_adjustments SET deleted_at = now() WHERE id = $1 RETURNING id', [manual]);
        assert.equal(rows.length, 1);
    });
});
