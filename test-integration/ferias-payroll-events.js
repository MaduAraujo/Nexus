const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

// Cobre a migration 079: apply_ferias_payroll_event/revert_ferias_payroll_event (atômicos, RH-only) e
// a correção de sync_medical_leave_statuses (só reverte Afastado->Ativo pelo atestado que causou o
// afastamento, nunca por outro atestado antigo e não relacionado). Não executado nesta sessão por
// falta de Postgres local — rodar antes de aplicar a 079 em produção.

const U_RH = '00000000-0000-4000-8000-00000000f701';
const U_A = '00000000-0000-4000-8000-00000000f702';

const E_RH = '00000000-0000-4000-9000-00000000f701';
const E_A = '00000000-0000-4000-9000-00000000f702';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A]) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status)
             VALUES ($1, 'Folha RH Fixture', '921.000.000-01', 'folha.rh@test.local', 'RH', 'Ativo'),
                    ($2, 'Folha Colab Fixture', '921.000.000-02', 'folha.a@test.local', 'Vendas', 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A]
        );
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A]]);
    });
});

afterEach(async () => {
    await withServiceRole((db) => db.query('DELETE FROM payslips WHERE employee_id = $1', [E_A]));
});

const PROVENTOS_FERIAS = JSON.stringify([
    { cod: '040', descricao: 'Adiantamento de Férias', referencia: '20 dias', valor: 1500 },
    { cod: '041', descricao: '1/3 Constitucional de Férias', referencia: '—', valor: 500 },
]);

describe('apply_ferias_payroll_event', () => {
    test('não-RH não consegue chamar', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(
                () => db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-07', 'Julho 2026', '07/2026', PROVENTOS_FERIAS]),
                /Apenas o RH/
            );
        });
    });

    test('sem holerite do mês: cria um novo, só com o evento de férias', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-07', 'Julho 2026', '07/2026', PROVENTOS_FERIAS]);
        });
        const { rows } = await withServiceRole((db) => db.query('SELECT * FROM payslips WHERE employee_id = $1 AND mes = $2', [E_A, '2026-07']));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].total_proventos, '2000.00');
        assert.equal(rows[0].salario_liquido, '2000.00');
        assert.equal(rows[0].proventos.length, 2);
    });

    test('com holerite já existente (ex.: folha mensal já gerada): soma o evento aos proventos existentes', async () => {
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido)
                 VALUES ($1, '2026-07', '[{"cod":"001","descricao":"Salário Base","valor":3000}]'::jsonb, '[]'::jsonb, 3000, 0, 3000)`,
                [E_A]
            )
        );
        await withUser({ sub: U_RH }, (db) =>
            db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-07', 'Julho 2026', '07/2026', PROVENTOS_FERIAS])
        );
        const { rows } = await withServiceRole((db) => db.query('SELECT * FROM payslips WHERE employee_id = $1 AND mes = $2', [E_A, '2026-07']));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].proventos.length, 3);
        assert.equal(rows[0].total_proventos, '5000.00');
    });

    test('chamar duas vezes é idempotente (não duplica o evento cod 040)', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-07', 'Julho 2026', '07/2026', PROVENTOS_FERIAS]);
            await db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-07', 'Julho 2026', '07/2026', PROVENTOS_FERIAS]);
        });
        const { rows } = await withServiceRole((db) => db.query('SELECT * FROM payslips WHERE employee_id = $1 AND mes = $2', [E_A, '2026-07']));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].proventos.length, 2);
        assert.equal(rows[0].total_proventos, '2000.00');
    });

    test('duas chamadas concorrentes para o mesmo colaborador+mês não colidem no UNIQUE(employee_id, mes)', async () => {
        // Antes da migration 079, esse teste reproduzia a corrida real: sem o advisory lock, as duas
        // podiam ver "não existe holerite" ao mesmo tempo e uma delas batia no UNIQUE constraint.
        await withUser({ sub: U_RH }, async (db) => {
            await Promise.all([
                db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-08', 'Agosto 2026', '08/2026', PROVENTOS_FERIAS]),
                db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-08', 'Agosto 2026', '08/2026', PROVENTOS_FERIAS]),
            ]);
        });
        const { rows } = await withServiceRole((db) => db.query('SELECT * FROM payslips WHERE employee_id = $1 AND mes = $2', [E_A, '2026-08']));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].proventos.length, 2); // não duplicou
    });
});

describe('revert_ferias_payroll_event', () => {
    test('não-RH não consegue chamar', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(() => db.query('SELECT revert_ferias_payroll_event($1, $2)', [E_A, '2026-07']), /Apenas o RH/);
        });
    });

    test('sem holerite do mês: não quebra (nada a reverter)', async () => {
        await withUser({ sub: U_RH }, (db) => db.query('SELECT revert_ferias_payroll_event($1, $2)', [E_A, '2026-07']));
    });

    test('holerite só com o evento de férias: apaga o holerite inteiro', async () => {
        await withUser({ sub: U_RH }, (db) =>
            db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-07', 'Julho 2026', '07/2026', PROVENTOS_FERIAS])
        );
        await withUser({ sub: U_RH }, (db) => db.query('SELECT revert_ferias_payroll_event($1, $2)', [E_A, '2026-07']));
        const { rows } = await withServiceRole((db) => db.query('SELECT * FROM payslips WHERE employee_id = $1 AND mes = $2', [E_A, '2026-07']));
        assert.equal(rows.length, 0);
    });

    test('holerite com outros proventos além do evento: remove só o evento de férias, mantém o resto', async () => {
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido)
                 VALUES ($1, '2026-07', '[{"cod":"001","descricao":"Salário Base","valor":3000}]'::jsonb, '[]'::jsonb, 3000, 0, 3000)`,
                [E_A]
            )
        );
        await withUser({ sub: U_RH }, (db) =>
            db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-07', 'Julho 2026', '07/2026', PROVENTOS_FERIAS])
        );
        await withUser({ sub: U_RH }, (db) => db.query('SELECT revert_ferias_payroll_event($1, $2)', [E_A, '2026-07']));

        const { rows } = await withServiceRole((db) => db.query('SELECT * FROM payslips WHERE employee_id = $1 AND mes = $2', [E_A, '2026-07']));
        assert.equal(rows.length, 1);
        assert.equal(rows[0].proventos.length, 1);
        assert.equal(rows[0].proventos[0].cod, '001');
        assert.equal(rows[0].total_proventos, '3000.00');
    });
});

describe('sync_medical_leave_statuses — só reverte pelo atestado que causou o afastamento (migration 079)', () => {
    const ML_OLD = '00000000-0000-4000-c000-00000000f701'; // atestado antigo, não relacionado, já vencido
    const ML_CURRENT = '00000000-0000-4000-c000-00000000f702'; // atestado que realmente causou o afastamento

    afterEach(async () => {
        await withServiceRole(async (db) => {
            await db.query('DELETE FROM medical_leaves WHERE id = ANY($1)', [[ML_OLD, ML_CURRENT]]);
            await db.query("UPDATE employees SET status = 'Ativo', afastado_by_medical_leave_id = NULL WHERE id = $1", [E_A]);
        });
    });

    test('afastado manualmente (sem afastado_by_medical_leave_id) não é revertido só por ter um atestado antigo e vencido no histórico', async () => {
        await withServiceRole(async (db) => {
            // Atestado antigo, aprovado, já terminou há muito tempo — não tem nenhuma relação com o
            // afastamento atual do colaborador.
            await db.query(
                `INSERT INTO medical_leaves (id, employee_id, start_date, end_date, status)
                 VALUES ($1, $2, '2020-01-01', '2020-01-05', 'aprovado')`,
                [ML_OLD, E_A]
            );
            // RH marcou "Afastado" manualmente por outro motivo — afastado_by_medical_leave_id fica NULL.
            await db.query("UPDATE employees SET status = 'Afastado', afastado_by_medical_leave_id = NULL WHERE id = $1", [E_A]);
            await db.query('SELECT sync_medical_leave_statuses()');
        });
        const { rows } = await withServiceRole((db) => db.query('SELECT status FROM employees WHERE id = $1', [E_A]));
        assert.equal(rows[0].status, 'Afastado', 'não deveria ter revertido — o afastamento não foi causado por este atestado');
    });

    test('afastado por um atestado específico: reverte para Ativo quando ESSE atestado termina', async () => {
        await withServiceRole(async (db) => {
            await db.query(
                `INSERT INTO medical_leaves (id, employee_id, start_date, end_date, status)
                 VALUES ($1, $2, '2020-01-01', '2020-01-05', 'aprovado')`,
                [ML_CURRENT, E_A]
            );
            await db.query("UPDATE employees SET status = 'Afastado', afastado_by_medical_leave_id = $1 WHERE id = $2", [ML_CURRENT, E_A]);
            await db.query('SELECT sync_medical_leave_statuses()');
        });
        const { rows } = await withServiceRole((db) => db.query('SELECT status, afastado_by_medical_leave_id FROM employees WHERE id = $1', [E_A]));
        assert.equal(rows[0].status, 'Ativo');
        assert.equal(rows[0].afastado_by_medical_leave_id, null);
    });

    test('afastado por um atestado que já terminou, mas com outro atestado aprovado ainda vigente: continua Afastado', async () => {
        const hoje = new Date().toISOString().slice(0, 10);
        const amanha = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
        await withServiceRole(async (db) => {
            await db.query(
                `INSERT INTO medical_leaves (id, employee_id, start_date, end_date, status)
                 VALUES ($1, $2, '2020-01-01', '2020-01-05', 'aprovado')`,
                [ML_CURRENT, E_A]
            );
            await db.query(
                `INSERT INTO medical_leaves (id, employee_id, start_date, end_date, status)
                 VALUES ($1, $2, $3, $4, 'aprovado')`,
                [ML_OLD, E_A, hoje, amanha]
            );
            await db.query("UPDATE employees SET status = 'Afastado', afastado_by_medical_leave_id = $1 WHERE id = $2", [ML_CURRENT, E_A]);
            await db.query('SELECT sync_medical_leave_statuses()');
        });
        const { rows } = await withServiceRole((db) => db.query('SELECT status FROM employees WHERE id = $1', [E_A]));
        assert.equal(rows[0].status, 'Afastado', 'ainda tem um atestado aprovado vigente cobrindo hoje');
    });
});
