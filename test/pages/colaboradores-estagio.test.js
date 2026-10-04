const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

const ESTAGIARIA = {
    ...ANA,
    cpf: '529.982.247-25',
    contract_type: 'Estágio',
    salary_type: 'Mensal Fixo',
    work_load: '30h',
    admission_date: '2025-02-01',
    contract_end_date: '2026-12-31',
    vale_transporte: true,
    valor_passagem: 5.5,
    conducoes_dia: 2,
    estagio_nivel: 'superior',
    estagio_obrigatorio: false,
    estagio_alternancia: false,
    estagio_supervisor_id: BIA.id,
    estagio_instituicao: 'Universidade de São Paulo',
    estagio_avaliacoes: [{ inicio: '2026-06-20', fim: '2026-06-25' }],
};

function client(anaOverrides = {}, outros = []) {
    const emps = [
        { ...ESTAGIARIA, ...anaOverrides, created_at: '2025-02-01' },
        { ...BIA, created_at: '2022-05-10' },
        { ...CAIO, created_at: '2025-01-15' },
        ...outros,
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

describe('colaboradores.html — termo de compromisso de estágio', () => {
    test('editar estagiária mostra o bloco do estágio com os dados do termo e os períodos de provas', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        assert.equal(page.visible('#estagio-details'), true);
        assert.equal(page.visible('#contrato-termino-details'), true);
        assert.equal(page.$('#estagio-nivel').value, 'superior');
        assert.equal(page.$('#estagio-instituicao').value, 'Universidade de São Paulo');
        assert.equal(page.$('#estagio-supervisor').value, BIA.id);
        assert.equal(page.$('input[name="estagio-obrigatorio"][value="nao"]').checked, true);
        assert.equal(page.$('input[name="estagio-alternancia"][value="nao"]').checked, true);
        assert.equal(page.$('#contract-end-date').dataset.value, '2026-12-31');
        assert.match(page.text('#estagio-provas-lista'), /20\/06\/2026 → 25\/06\/2026/);
        const opcoes = page.$$('#estagio-supervisor option').map((o) => o.value);
        assert.ok(!opcoes.includes(ANA.id), 'o próprio estagiário não aparece como supervisor');
    });

    test('salvar sem mudar nada preserva o termo inteiro', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /Colaborador Atualizado/.test(t)),
            page.toasts().join(' | ')
        );
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual(
            [
                upd.contract_end_date,
                upd.estagio_nivel,
                upd.estagio_obrigatorio,
                upd.estagio_alternancia,
                upd.estagio_supervisor_id,
                upd.estagio_instituicao,
                upd.estagio_avaliacoes,
            ],
            ['2026-12-31', 'superior', false, false, BIA.id, 'Universidade de São Paulo', [{ inicio: '2026-06-20', fim: '2026-06-25' }]]
        );
    });

    test('regra do art. 11: término além de 2 anos é barrado na tela, sem gravar', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        data(page, 'contract-end-date', '2027-02-01');
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /2 anos/.test(t)),
            page.toasts().join(' | ')
        );
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('menor de 16 anos no início do estágio é barrado pela data de nascimento do formulário', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        data(page, 'data-nascimento', '2009-02-02');
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /16 anos/.test(t)),
            page.toasts().join(' | ')
        );
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('estagiário legado sem termo: as escolhas vazias são acusadas antes de gravar', async () => {
        const c = client({
            estagio_nivel: null,
            estagio_obrigatorio: null,
            estagio_alternancia: null,
            estagio_supervisor_id: null,
            estagio_instituicao: null,
            estagio_avaliacoes: null,
            contract_end_date: null,
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        assert.equal(page.$('input[name="estagio-obrigatorio"]:checked'), null);
        assert.equal(page.text('#estagio-provas-lista'), '');
        await salvar(page);
        assert.ok(
            page.toasts().some((t) => /nível de ensino/.test(t)),
            page.toasts().join(' | ')
        );
        await page.fill('#estagio-nivel', 'medio');
        await salvar(page);
        assert.ok(page.toasts().some((t) => /obrigatório ou não obrigatório/.test(t)));
        await page.check('input[name="estagio-obrigatorio"][value="sim"]');
        await page.fill('#estagio-instituicao', 'Escola Estadual');
        data(page, 'contract-end-date', '2026-12-31');
        await page.fill('#estagio-supervisor', BIA.id);
        await salvar(page);
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual([upd.estagio_nivel, upd.estagio_obrigatorio, upd.estagio_instituicao], ['medio', true, 'Escola Estadual']);
    });

    test('períodos de provas: exige início e fim, recusa fim antes do início, ordena e remove', async () => {
        const c = client({ estagio_avaliacoes: [] });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();

        await page.click('#btn-estagio-prova-add');
        assert.ok(page.toasts().some((t) => /Período Incompleto/.test(t)));

        data(page, 'estagio-prova-inicio', '2026-11-20');
        data(page, 'estagio-prova-fim', '2026-11-10');
        await page.click('#btn-estagio-prova-add');
        assert.ok(page.toasts().some((t) => /Período Inválido/.test(t)));

        data(page, 'estagio-prova-fim', '2026-11-25');
        await page.click('#btn-estagio-prova-add');
        data(page, 'estagio-prova-inicio', '2026-07-01');
        data(page, 'estagio-prova-fim', '2026-07-03');
        await page.click('#btn-estagio-prova-add');
        assert.equal(page.$('#estagio-prova-inicio').dataset.value, '');
        assert.deepEqual(
            page.$$('#estagio-provas-lista li').map((li) => li.textContent.trim()),
            ['01/07/2026 → 03/07/2026', '20/11/2026 → 25/11/2026']
        );

        await page.click(page.$$('#estagio-provas-lista button')[0]);
        await salvar(page);
        assert.deepEqual(c.writes('employees', 'update')[0].payload.estagio_avaliacoes, [{ inicio: '2026-11-20', fim: '2026-11-25' }]);
    });

    test('trocar de Estágio para CLT esconde o bloco e limpa o termo no banco', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        await page.fill('#contract-type', 'CLT');
        await page.fill('#work-load', '44h');
        assert.equal(page.visible('#estagio-details'), false);
        assert.equal(page.visible('#contrato-termino-details'), false);
        await salvar(page);
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual(
            [upd.contract_type, upd.contract_end_date, upd.estagio_nivel, upd.estagio_supervisor_id, upd.estagio_avaliacoes, upd.estagio_alternancia],
            ['CLT', null, null, null, [], false]
        );
    });

    test('Aprendiz mostra só o término do contrato, sem o bloco do estágio', async () => {
        page = await openPage('colaboradores', { client: client({ contract_type: 'CLT' }), now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        assert.equal(page.visible('#contrato-termino-details'), false);
        await page.fill('#contract-type', 'Aprendiz');
        assert.equal(page.visible('#contrato-termino-details'), true);
        assert.equal(page.visible('#estagio-details'), false);
        await page.fill('#contract-type', 'Estágio');
        const opcoes = page.$$('#estagio-supervisor option').map((o) => o.value);
        assert.deepEqual(opcoes.sort(), ['', BIA.id, CAIO.id].sort());
    });

    test('estágio obrigatório com alternância volta marcado na edição; supervisor sem cargo aparece só pelo nome', async () => {
        const semCargo = { ...BIA, id: 'emp-sem-cargo', name: 'Fábio Sem Cargo', cpf: '333.666.999-57', email: 'fabio@empresa.com', role: null };
        page = await openPage('colaboradores', {
            client: client({ estagio_obrigatorio: true, estagio_alternancia: true, work_load: '40h' }, [semCargo]),
            now: NOW,
        });
        page.window.editEmployee(ANA.id);
        await page.settle();
        assert.equal(page.$('input[name="estagio-obrigatorio"][value="sim"]').checked, true);
        assert.equal(page.$('input[name="estagio-alternancia"][value="sim"]').checked, true);
        assert.equal(page.$('#estagio-supervisor option[value="emp-sem-cargo"]').textContent, 'Fábio Sem Cargo');
    });

    test('supervisor não lista estagiários nem inativos', async () => {
        const outroEstagiario = { ...BIA, id: 'emp-est2', name: 'Dani Estagiária', cpf: '111.444.777-35', email: 'dani@empresa.com', contract_type: 'estagio' };
        const inativo = { ...BIA, id: 'emp-ina', name: 'Edu Inativo', cpf: '222.555.888-46', email: 'edu@empresa.com', status: 'Inativo' };
        page = await openPage('colaboradores', { client: client({}, [outroEstagiario, inativo]), now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        const opcoes = page.$$('#estagio-supervisor option').map((o) => o.value);
        assert.ok(!opcoes.includes('emp-est2'));
        assert.ok(!opcoes.includes('emp-ina'));
    });
});
