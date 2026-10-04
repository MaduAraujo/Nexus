const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

const APRENDIZ = {
    ...ANA,
    cpf: '529.982.247-25',
    contract_type: 'Aprendiz',
    salary_type: 'Mensal Fixo',
    work_load: '30h',
    salary: 1200,
    admission_date: '2026-02-02',
    contract_end_date: '2028-02-01',
    birth_date: '2008-05-10',
    aprendiz_fundamental_completo: false,
};

function client(anaOverrides = {}) {
    const emps = [
        { ...APRENDIZ, ...anaOverrides, created_at: '2026-02-02' },
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

const data = (p, id, iso) => p.eval(`setDateFieldValue(document.getElementById('${id}'), '${iso}')`);

async function salvar(p) {
    await p.submit('#employee-form');
    await p.settle(20);
}

async function editar(c) {
    page = await openPage('colaboradores', { client: c, now: NOW });
    page.window.editEmployee(ANA.id);
    await page.settle();
}

const toasts = () => page.toasts().join(' | ');

describe('colaboradores.html — contrato de aprendizagem (CLT arts. 428 a 433)', () => {
    test('editar aprendiz mostra o bloco do aprendiz, o término e a data de nascimento', async () => {
        await editar(client({ aprendiz_fundamental_completo: true }));
        assert.equal(page.visible('#aprendiz-details'), true);
        assert.equal(page.visible('#contrato-termino-details'), true);
        assert.equal(page.visible('#estagio-details'), false);
        assert.equal(page.$('#aprendiz-fundamental').checked, true);
        assert.equal(page.$('#data-nascimento').dataset.value, '2008-05-10');
        assert.equal(page.$('#contract-end-date').dataset.value, '2028-02-01');
    });

    test('salvar aprendiz dentro da lei grava término, escolaridade e nascimento', async () => {
        const c = client();
        await editar(c);
        await page.check('#aprendiz-fundamental');
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /Colaborador Atualizado/.test(t)),
            toasts()
        );
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual([upd.contract_end_date, upd.aprendiz_fundamental_completo, upd.birth_date], ['2028-02-01', true, '2008-05-10']);
    });

    test('contrato acima de 2 anos é barrado na tela, sem gravar', async () => {
        const c = client();
        await editar(c);
        data(page, 'contract-end-date', '2028-02-03');
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /Regra do Aprendiz.*2 anos|2 anos/.test(t)),
            toasts()
        );
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('sem data de nascimento o aprendiz não é salvo', async () => {
        const c = client({ birth_date: null });
        await editar(c);
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /data de nascimento do aprendiz/.test(t)),
            toasts()
        );
        data(page, 'data-nascimento', '2009-01-15');
        await salvar(page);
        assert.equal(c.writes('employees', 'update')[0].payload.birth_date, '2009-01-15');
    });

    test('40h sem ensino fundamental completo e salário abaixo do mínimo hora são barrados', async () => {
        const c = client();
        await editar(c);
        await page.fill('#work-load', '40h');
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /6 horas por dia/.test(t)),
            toasts()
        );
        await page.fill('#work-load', '30h');
        await page.fill('#salary', 'R$ 900,00');
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /salário mínimo hora/.test(t)),
            toasts()
        );
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('trocar de Aprendiz para CLT esconde o bloco e limpa término e escolaridade', async () => {
        const c = client({ aprendiz_fundamental_completo: true });
        await editar(c);
        await page.fill('#contract-type', 'CLT');
        assert.equal(page.visible('#aprendiz-details'), false);
        await salvar(page);
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual([upd.contract_type, upd.contract_end_date, upd.aprendiz_fundamental_completo], ['CLT', null, false]);
    });

    test('CLT sem data de nascimento não envia birth_date (não apaga o que está no banco)', async () => {
        const c = client({ contract_type: 'CLT', work_load: '44h', birth_date: null, contract_end_date: null });
        await editar(c);
        await salvar(page);
        assert.equal('birth_date' in c.writes('employees', 'update')[0].payload, false);
    });
});
