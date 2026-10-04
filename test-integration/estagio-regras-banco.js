const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_EST = '00000000-0000-4000-8000-00000000e501';
const E_SUP = '00000000-0000-4000-9000-00000000e500';
const E_EST = '00000000-0000-4000-9000-00000000e501';
const E_PCD = '00000000-0000-4000-9000-00000000e502';
const E_ALERTA = '00000000-0000-4000-9000-00000000e503';
const E_TEMP = '00000000-0000-4000-9000-00000000e504';
const TODOS = [E_EST, E_PCD, E_ALERTA, E_TEMP, E_SUP];

const REGRA = { code: '23514' };

const hojeSql = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";

function estagiario(db, { id, cpf, email, adm = `${hojeSql} - 150`, fim = `${hojeSql} + 300`, ...o }) {
    const v = {
        work_load: '30h',
        nivel: 'superior',
        obrigatorio: false,
        alternancia: false,
        supervisor: E_SUP,
        instituicao: 'Universidade Teste',
        salary: '1200.00',
        vale_transporte: true,
        pcd: 'false',
        birth_date: '2003-05-05',
        ...o,
    };
    return db.query(
        `INSERT INTO employees (id, name, cpf, email, dept, status, contract_type, admission_date, contract_end_date, work_load, salary, birth_date, pcd,
                                vale_transporte, estagio_nivel, estagio_obrigatorio, estagio_alternancia, estagio_supervisor_id, estagio_instituicao)
         VALUES ($1, 'Estagiário Teste', $2, $3, 'TI', 'Ativo', 'Estágio', ${adm}, ${fim}, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [id, cpf, email, v.work_load, v.salary, v.birth_date, v.pcd, v.vale_transporte, v.nivel, v.obrigatorio, v.alternancia, v.supervisor, v.instituicao]
    );
}

const tentar = (o) => withServiceRole((db) => estagiario(db, { id: E_TEMP, cpf: '952.000.000-04', email: 'estagio.temp@test.local', ...o }));

before(async () => {
    await withServiceRole(async (db) => {
        await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [U_EST]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, contract_type, work_load, admission_date)
             VALUES ($1, 'Supervisor Estágio', '952.000.000-00', 'estagio.sup@test.local', 'TI', 'Ativo', 'CLT', '44h', '2020-01-01')
             ON CONFLICT (id) DO NOTHING`,
            [E_SUP]
        );
        await estagiario(db, { id: E_EST, cpf: '952.000.000-01', email: 'estagio.a@test.local' });
        await db.query(`INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'colaborador', $2) ON CONFLICT (id) DO NOTHING`, [U_EST, E_EST]);
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM vacations WHERE employee_id = ANY($1)', [TODOS]);
        await db.query('DELETE FROM documents WHERE employee_id = ANY($1)', [TODOS]);
        await db.query('DELETE FROM compliance_alerts WHERE employee_id = ANY($1)', [TODOS]);
        await db.query('DELETE FROM profiles WHERE id = $1', [U_EST]);
        await db.query('DELETE FROM auth.users WHERE id = $1', [U_EST]);
        await db.query('DELETE FROM employees WHERE id = ANY($1) AND id <> $2', [TODOS, E_SUP]);
        await db.query('DELETE FROM employees WHERE id = $1', [E_SUP]);
    });
});

describe('Lei 11.788/2008 no banco — cadastro do estagiário', () => {
    test('termo de compromisso incompleto é recusado', async () => {
        await assert.rejects(tentar({ nivel: null }), { ...REGRA, message: /nível de ensino/ });
        await assert.rejects(tentar({ instituicao: '' }), { ...REGRA, message: /instituição de ensino/ });
        await assert.rejects(tentar({ fim: 'NULL' }), { ...REGRA, message: /término prevista/ });
        await assert.rejects(tentar({ supervisor: null }), { ...REGRA, message: /supervisor do estágio/ });
    });

    test('art. 11: mais de 2 anos é recusado, exceto para estagiário com deficiência', async () => {
        await assert.rejects(tentar({ adm: hojeSql, fim: `${hojeSql} + 731` }), { ...REGRA, message: /2 anos/ });
        await withServiceRole((db) =>
            estagiario(db, { id: E_PCD, cpf: '952.000.000-02', email: 'estagio.pcd@test.local', adm: hojeSql, fim: `${hojeSql} + 900`, pcd: 'true' })
        );
    });

    test('art. 10: carga acima do nível é recusada; 40h só com alternância', async () => {
        await assert.rejects(tentar({ work_load: '40h' }), { ...REGRA, message: /6h por dia e 30h/ });
        await assert.rejects(tentar({ work_load: '44h' }), { ...REGRA, message: /20h, 30h ou 40h/ });
        await assert.rejects(tentar({ nivel: 'especial', work_load: '30h' }), { ...REGRA, message: /4h por dia e 20h/ });
    });

    test('art. 12: estágio não obrigatório exige bolsa e auxílio-transporte', async () => {
        await assert.rejects(tentar({ salary: '0' }), { ...REGRA, message: /bolsa é obrigatória/ });
        await assert.rejects(tentar({ vale_transporte: false }), { ...REGRA, message: /auxílio-transporte/ });
    });

    test('menor de 16 anos no início é recusado (o dado de nascimento é lido decifrado)', async () => {
        await assert.rejects(tentar({ adm: "'2026-03-10'::date", fim: "'2026-12-01'::date", birth_date: '2010-03-11' }), { ...REGRA, message: /16 anos/ });
    });

    test('estagiário não supervisiona estagiário', async () => {
        await assert.rejects(
            withServiceRole((db) => db.query('UPDATE employees SET estagio_supervisor_id = $2 WHERE id = $1', [E_PCD, E_EST])),
            { ...REGRA, message: /não pode supervisionar/ }
        );
    });

    test('atualização que não mexe no termo passa mesmo com o salário cifrado', async () => {
        await withServiceRole((db) => db.query(`UPDATE employees SET dept = 'Financeiro' WHERE id = $1`, [E_EST]));
    });
});

describe('Lei 11.788/2008 no banco — recesso do art. 13', () => {
    const pedir = (inicioSql, dias) =>
        withUser({ sub: U_EST, commit: true }, (db) =>
            db.query(
                `INSERT INTO vacations (employee_id, start_date, end_date, days, status) VALUES ($1, ${inicioSql}, ${inicioSql} + ($2::int - 1), $2, 'pendente') RETURNING id`,
                [E_EST, dias]
            )
        );

    test('recesso proporcional: mais do que 2,5 dias por mês completo é recusado; menos de 5 dias é aceito', async () => {
        await assert.rejects(pedir(`${hojeSql} + 40`, 20), { ...REGRA, message: /Recesso insuficiente/ });
        const { rows } = await pedir(`${hojeSql} + 40`, 3);
        assert.equal(rows.length, 1);
    });

    test('estagiário não vende abono', async () => {
        await assert.rejects(
            withUser({ sub: U_EST }, (db) =>
                db.query(
                    `INSERT INTO vacations (employee_id, start_date, end_date, days, abono, status) VALUES ($1, ${hojeSql} + 60, ${hojeSql} + 64, 5, true, 'pendente')`,
                    [E_EST]
                )
            ),
            { ...REGRA, message: /abono/ }
        );
    });
});

describe('Lei 11.788/2008 no banco — alertas de compliance', () => {
    test('fim do termo próximo e relatório semestral atrasado geram alerta; relatório entregue some com o alerta', async () => {
        await withServiceRole((db) =>
            estagiario(db, { id: E_ALERTA, cpf: '952.000.000-03', email: 'estagio.alerta@test.local', adm: `${hojeSql} - 220`, fim: `${hojeSql} + 10` })
        );
        await withServiceRole((db) => db.query('SELECT generate_compliance_alerts()'));
        const tipos = async () =>
            (
                await withServiceRole((db) => db.query(`SELECT alertas FROM compliance_alerts WHERE employee_id = $1 AND date = ${hojeSql}`, [E_ALERTA]))
            ).rows[0]?.alertas.map((a) => a.tipo) || [];
        const antes = await tipos();
        assert.ok(antes.includes('estagio_termino'), antes.join(','));
        assert.ok(antes.includes('estagio_relatorio'), antes.join(','));

        await withServiceRole((db) =>
            db.query(
                `INSERT INTO documents (name, employee_id, category, tipo, source, status) VALUES ('relatorio.pdf', $1, 'admissional', 'Relatório de Atividades de Estágio', 'Administrador', 'aprovado')`,
                [E_ALERTA]
            )
        );
        await withServiceRole((db) => db.query('SELECT generate_compliance_alerts()'));
        assert.equal((await tipos()).includes('estagio_relatorio'), false);
    });
});
