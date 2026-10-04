const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole } = require('../test-support/pg-rls-client.js');

const E_A = '00000000-0000-4000-9000-00000000b701';

const REGRA = { code: '23514' };

let hoje;

const somarDias = (iso, dias) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
};
const somarMeses = (iso, meses) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 + meses, d)).toISOString().slice(0, 10);
};

const gravar = (campos) =>
    withServiceRole((db) => {
        const nomes = Object.keys(campos);
        const sets = nomes.map((n, i) => `${n} = $${i + 2}`).join(', ');
        return db.query(`UPDATE employees SET ${sets} WHERE id = $1 RETURNING contrato_prorrogado`, [E_A, ...nomes.map((n) => campos[n])]);
    });

const alertas = () =>
    withServiceRole(async (db) => {
        await db.query('DELETE FROM compliance_alerts WHERE employee_id = $1', [E_A]);
        await db.query('SELECT generate_compliance_alerts()');
        const r = await db.query('SELECT alertas FROM compliance_alerts WHERE employee_id = $1', [E_A]);
        return (r.rows[0]?.alertas || []).map((a) => a.tipo);
    });

before(async () => {
    await withServiceRole(async (db) => {
        hoje = (await db.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, contract_type)
             VALUES ($1, 'Prazo A', '971.000.000-01', 'prazo.a@test.local', 'Vendas', 'Ativo', 'CLT')
             ON CONFLICT (id) DO NOTHING`,
            [E_A]
        );
    });
});

beforeEach(async () => {
    await withServiceRole((db) =>
        db.query(
            `UPDATE employees SET contract_type = 'CLT', admission_date = $2, contract_end_date = NULL, termination_date = NULL,
                    is_probation = false, probation_end_date = NULL, contrato_prorrogado = false, status = 'Ativo'
              WHERE id = $1`,
            [E_A, hoje]
        )
    );
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM compliance_alerts WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM employees WHERE id = $1', [E_A]);
    });
});

describe('temporário no banco (Lei 6.019/1974, migration 104)', () => {
    test('exige término, aceita até 270 dias e recusa 271', async () => {
        await assert.rejects(gravar({ contract_type: 'Temporário' }), { ...REGRA, message: /término do contrato temporário/ });
        await gravar({ contract_type: 'Temporário', contract_end_date: somarDias(hoje, 269) });
        await assert.rejects(gravar({ contract_end_date: somarDias(hoje, 270) }), { ...REGRA, message: /270 dias/ });
    });

    test('não admite contrato de experiência', async () => {
        await assert.rejects(
            gravar({ contract_type: 'Temporário', contract_end_date: somarDias(hoje, 90), is_probation: true, probation_end_date: somarDias(hoje, 30) }),
            { ...REGRA, message: /art\. 10 §4º/ }
        );
    });

    test('novo contrato temporário só 90 dias depois do fim do anterior', async () => {
        await gravar({ contract_type: 'Temporário', admission_date: somarDias(hoje, -200), contract_end_date: somarDias(hoje, -20) });
        await gravar({ termination_date: somarDias(hoje, -20), status: 'Inativo' });
        await assert.rejects(gravar({ admission_date: somarDias(hoje, 30), contract_end_date: somarDias(hoje, 120), status: 'Ativo' }), {
            ...REGRA,
            message: /90 dias depois/,
        });
        await gravar({ admission_date: somarDias(hoje, 71), contract_end_date: somarDias(hoje, 160), status: 'Ativo' });
    });

    test('alerta quando o contrato está para terminar e deixa de alertar férias vencidas', async () => {
        await gravar({ contract_type: 'Temporário', admission_date: somarDias(hoje, -200), contract_end_date: somarDias(hoje, 10) });
        const tipos = await alertas();
        assert.ok(tipos.includes('temporario_termino'), JSON.stringify(tipos));
        assert.ok(!tipos.includes('ferias_vencidas'));
    });

    test('a lista de documentos do temporário traz o contrato com a agência, e não a guia do FGTS', async () => {
        const { rows } = await withServiceRole((db) => db.query("SELECT tipo FROM document_requirements WHERE contract_type = 'Temporário'"));
        const tipos = rows.map((r) => r.tipo);
        assert.ok(tipos.includes('Contrato com a Empresa de Trabalho Temporário'));
        assert.ok(!tipos.includes('Guia FGTS'));
        assert.ok(!tipos.includes('Carteira de Trabalho'));
    });
});

describe('prazo determinado no banco (CLT arts. 443, 445, 451 e 452, migration 104)', () => {
    test('recusa mais de 2 anos e contrato de experiência', async () => {
        await assert.rejects(gravar({ contract_type: 'Prazo determinado', contract_end_date: somarDias(somarMeses(hoje, 24), 1) }), {
            ...REGRA,
            message: /2 anos/,
        });
        await assert.rejects(
            gravar({ contract_type: 'Prazo determinado', contract_end_date: somarMeses(hoje, 6), is_probation: true, probation_end_date: somarDias(hoje, 30) }),
            { ...REGRA, message: /art\. 443 §2º, c/ }
        );
    });

    test('aceita uma prorrogação e recusa a segunda (art. 451)', async () => {
        const r0 = await gravar({ contract_type: 'Prazo determinado', contract_end_date: somarMeses(hoje, 3) });
        assert.equal(r0.rows[0].contrato_prorrogado, false);
        const r1 = await gravar({ contract_end_date: somarMeses(hoje, 6) });
        assert.equal(r1.rows[0].contrato_prorrogado, true);
        await assert.rejects(gravar({ contract_end_date: somarMeses(hoje, 9) }), { ...REGRA, message: /prorrogado uma vez/ });
        const r2 = await gravar({ contrato_prorrogado: false });
        assert.equal(r2.rows[0].contrato_prorrogado, true, 'a marca não é apagada à mão');
    });

    test('novo contrato a prazo em até 6 meses é recusado (art. 452); depois disso passa', async () => {
        await gravar({ contract_type: 'Prazo determinado', admission_date: somarMeses(hoje, -8), contract_end_date: somarMeses(hoje, -2) });
        await gravar({ termination_date: somarMeses(hoje, -2), status: 'Inativo' });
        await assert.rejects(gravar({ admission_date: somarDias(hoje, 10), contract_end_date: somarMeses(hoje, 6), status: 'Ativo' }), {
            ...REGRA,
            message: /art\. 452/,
        });
        await gravar({ admission_date: somarDias(somarMeses(hoje, 4), 1), contract_end_date: somarMeses(hoje, 10), status: 'Ativo' });
    });

    test('alerta o contrato vencido com a pessoa ainda ativa', async () => {
        await gravar({ contract_type: 'Prazo determinado', admission_date: somarMeses(hoje, -6), contract_end_date: somarDias(hoje, -1) });
        assert.ok((await alertas()).includes('prazo_termino'));
    });

    test('a lista de documentos do prazo determinado segue a da CLT, sem aviso prévio', async () => {
        const { rows } = await withServiceRole((db) => db.query("SELECT tipo FROM document_requirements WHERE contract_type = 'Prazo determinado'"));
        const tipos = rows.map((r) => r.tipo);
        assert.ok(tipos.includes('Carteira de Trabalho'));
        assert.ok(!tipos.includes('Aviso Prévio'));
    });
});
