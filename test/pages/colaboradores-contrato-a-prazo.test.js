const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

const TEMPORARIO = {
    ...ANA,
    cpf: '529.982.247-25',
    contract_type: 'Temporário',
    salary_type: 'Mensal Fixo',
    work_load: '44h',
    salary: 3000,
    admission_date: '2026-03-02',
    contract_end_date: '2026-08-28',
    is_probation: false,
};

function client(anaOverrides = {}) {
    const emps = [
        { ...TEMPORARIO, ...anaOverrides, created_at: '2026-03-02' },
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

describe('colaboradores.html — temporário (Lei 6.019/1974)', () => {
    test('mostra o término e a explicação do prazo de 180 + 90 dias', async () => {
        await editar(client());
        assert.equal(page.visible('#contrato-termino-details'), true);
        assert.equal(page.$('#contract-end-date').dataset.value, '2026-08-28');
        assert.match(page.text('#contrato-termino-hint'), /até 180 dias, mais 90 de prorrogação/);
    });

    test('dentro do prazo salva com o término', async () => {
        const c = client();
        await editar(c);
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /Colaborador Atualizado/.test(t)),
            toasts()
        );
        assert.equal(c.writes('employees', 'update')[0].payload.contract_end_date, '2026-08-28');
    });

    test('mais de 270 dias é barrado na tela, sem gravar', async () => {
        const c = client();
        await editar(c);
        data(page, 'contract-end-date', '2026-12-31');
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /270 dias/.test(t)),
            toasts()
        );
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('contrato de experiência é barrado (art. 10 §4º)', async () => {
        const c = client({ is_probation: true, probation_end_date: '2026-04-30' });
        await editar(c);
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /não admite contrato de experiência/.test(t)),
            toasts()
        );
        assert.equal(c.writes('employees', 'update').length, 0);
    });
});

describe('colaboradores.html — prazo determinado (CLT art. 443)', () => {
    test('aparece como opção, mostra a explicação e exige término de até 2 anos', async () => {
        const c = client({ contract_type: 'Prazo determinado', contract_end_date: '2028-03-03' });
        await editar(c);
        assert.match(page.text('#contrato-termino-hint'), /até 2 anos, com uma só prorrogação/);
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /2 anos \(CLT art\. 445\)/.test(t)),
            toasts()
        );
        data(page, 'contract-end-date', '2027-03-01');
        await salvar(page);
        assert.equal(c.writes('employees', 'update')[0].payload.contract_type, 'Prazo determinado');
    });

    test('trocar para CLT esconde o término e a explicação', async () => {
        const c = client({ contract_type: 'Prazo determinado', contract_end_date: '2027-03-01' });
        await editar(c);
        await page.fill('#contract-type', 'CLT');
        assert.equal(page.visible('#contrato-termino-details'), false);
        assert.equal(page.visible('#contrato-termino-hint'), false);
        await salvar(page);
        assert.equal(c.writes('employees', 'update')[0].payload.contract_end_date, null);
    });

    test('efetivar pela promoção limpa a data de término', async () => {
        const c = client({ contract_type: 'Prazo determinado', contract_end_date: '2027-03-01' });
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: true });
        page.window.openDrawer(ANA.id);
        page.window.handlePromoteEmployee();
        page.$('#promote-contract-type').value = 'CLT';
        await page.window.submitPromotion();
        await page.settle();
        const upd = c.writes('employees', 'update')[0].payload;
        assert.equal(upd.contract_type, 'CLT');
        assert.equal(upd.contract_end_date, null);
    });
});
