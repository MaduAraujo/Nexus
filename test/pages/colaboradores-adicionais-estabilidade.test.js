const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function client(anaOverrides = {}) {
    const emps = [
        { ...ANA, cpf: '529.982.247-25', salary_type: 'Mensal Fixo', ...anaOverrides, created_at: '2024-02-01' },
        { ...BIA, created_at: '2022-05-10' },
        { ...CAIO, created_at: '2025-01-15' },
    ];
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            employees: emps.map((e) => ({ ...e })),
            employee_audit: [],
            employee_audit_decrypted: [],
            vacations: [],
            documents: [],
            document_requirements: [],
            job_titles: [{ id: 'jt1', title: 'Analista', level: 'Júnior', active: true }],
            trainings: [],
            data_access_log: [],
            onboarding_tasks: [],
        }),
        rpc: { job_titles_public: [{ title: 'Analista' }] },
        views: { employees_decrypted: 'employees' },
    });
}

async function editar(c) {
    page = await openPage('colaboradores', { client: c, now: NOW });
    page.window.editEmployee(ANA.id);
    await page.settle();
}

async function salvar() {
    await page.submit('#employee-form');
    await page.settle(20);
}

describe('colaboradores.html — periculosidade, insalubridade e estabilidade', () => {
    test('editar mostra os valores gravados', async () => {
        await editar(client({ adicional_periculosidade: true, grau_insalubridade: 'medio', estabilidade_motivo: 'cipa', estabilidade_ate: '2027-03-31' }));
        assert.equal(page.$('#rem-periculosidade').value, 'sim');
        assert.equal(page.$('#rem-insalubridade').value, 'medio');
        assert.equal(page.$('#estabilidade-motivo').value, 'cipa');
        assert.equal(page.$('#estabilidade-ate').value, '31/03/2027');
    });

    test('salvar grava adicionais e estabilidade', async () => {
        const c = client();
        await editar(c);
        page.$('#rem-periculosidade').value = 'sim';
        page.$('#rem-insalubridade').value = 'maximo';
        page.$('#estabilidade-motivo').value = 'gestante';
        page.eval(`setDateFieldValue(document.getElementById('estabilidade-ate'), '2027-01-31')`);
        await salvar();
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual(
            [upd.adicional_periculosidade, upd.grau_insalubridade, upd.estabilidade_motivo, upd.estabilidade_ate],
            [true, 'maximo', 'gestante', '2027-01-31']
        );
    });

    test('motivo sem data é recusado antes de gravar', async () => {
        const c = client();
        await editar(c);
        page.$('#estabilidade-motivo').value = 'acidente_trabalho';
        await salvar();
        assert.equal(c.writes('employees', 'update').length, 0);
        assert.match(page.toasts().join(' | '), /motivo e a data final da estabilidade/);
    });

    test('PJ e estágio não guardam adicionais nem estabilidade', async () => {
        const c = client({ contract_type: 'PJ', adicional_periculosidade: true, estabilidade_motivo: 'cipa', estabilidade_ate: '2027-03-31' });
        await editar(c);
        page.$('#estabilidade-motivo').value = 'cipa';
        page.eval(`setDateFieldValue(document.getElementById('estabilidade-ate'), '')`);
        await salvar();
        const upd = c.writes('employees', 'update')[0]?.payload;
        assert.ok(upd, page.toasts().join(' | '));
        assert.deepEqual([upd.adicional_periculosidade, upd.grau_insalubridade, upd.estabilidade_motivo, upd.estabilidade_ate], [false, null, null, null]);
    });

    test('os campos mortos de remuneração saíram do formulário', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        assert.equal(page.$('#rem-hora-extra'), null);
        assert.equal(page.$('#rem-salario'), null);
    });
});
