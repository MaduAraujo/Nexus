const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const CPF_VALIDO = '529.982.247-25';

function client(extra = {}, opts = {}) {
    const emps = [
        { ...ANA, created_at: '2024-02-01' },
        { ...BIA, created_at: '2022-05-10' },
        { ...CAIO, created_at: '2025-01-15', status: 'Férias' },
    ];
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            employees: emps.map((e) => ({ ...e })),
            employees_decrypted: emps.map((e) => ({ ...e })),
            employee_audit: [],
            employee_audit_decrypted: [],
            vacations: [{ id: 'v1', employee_id: ANA.id, status: 'pendente' }],
            documents: [],
            document_requirements: [],
            job_titles: [{ id: 'jt1', title: 'Analista', level: 'Júnior', active: true }],
            trainings: [{ id: 'c1', title: 'LGPD', active: true, duration_hours: 4 }],
            data_access_log: [],
            ai_decision_log: [],
            onboarding_tasks: [],
            ...extra,
        }),
        rpc: { job_titles_public: [{ title: 'Analista' }], anonymize_employee: {} },
        views: { employees_decrypted: 'employees' },
        ...opts,
    });
}

const rowFor = (p, name) => p.$$('#employee-list-body tr').find((tr) => tr.textContent.includes(name));

describe('colaboradores.html — lista', () => {
    test('lista, filtra por status e busca', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        assert.equal(page.$$('#employee-list-body tr').length, 3);
        await page.click('[data-filter="ferias"]');
        assert.deepEqual(
            page.$$('#employee-list-body tr').map((tr) => /Caio/.test(tr.textContent)),
            [true]
        );
        await page.click('[data-filter="todos"]');
        await page.fill('#search-input', 'financeiro');
        assert.equal(page.$$('#employee-list-body tr').length, 2);
    });

    test('abrir o perfil registra o acesso (LGPD)', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.settle();
        assert.equal(page.text('#view-name'), 'Ana Souza');
        assert.match(page.text('#view-salary'), /4\.000,00/);
        assert.equal(c.writes('data_access_log', 'insert')[0].payload[0].tipo, 'perfil_completo');
    });

    test('exporta CSV e PDF', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.eval('exportEmployeesCSV(); exportEmployeesPDF();');
        await page.settle(20);
        assert.equal(page.saved.length, 1, 'planilha Excel');
        assert.equal(page.opened.length, 1, 'relatório para imprimir em PDF');
        assert.match(page.opened[0].text(), /Ana Souza/);
        assert.ok(c.rpcCalls('report_data_export').some((x) => x.args.p_source === 'colaboradores.xlsx'));
    });
});

describe('colaboradores.html — status, exclusão, LGPD', () => {
    test('inativar grava a data de desligamento, recusa férias pendentes e audita', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.updateStatus('Inativo');
        await page.settle();
        const emp = c.tables.employees.find((e) => e.id === ANA.id);
        assert.deepEqual([emp.status, emp.termination_date], ['Inativo', '2026-06-17']);
        assert.equal(c.tables.vacations[0].status, 'recusado');
        assert.equal(c.writes('employee_audit', 'insert')[0].payload[0].changes[0].newValue, 'Inativo');
    });

    test('exclusão barrada pelo banco (prazo legal de guarda) orienta a inativar e anonimizar', async () => {
        const c = client();
        c.errors['employees:delete'] = { code: '23503', message: 'Colaborador com holerite...' };
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleDeleteEmployee();
        await page.settle();
        assert.ok(page.toasts().some((t) => /prazo legal de guarda.*Inative.*anonimize/.test(t)));
        assert.ok(rowFor(page, 'Ana Souza'), 'continua na lista');
    });

    test('LGPD: anonimização só para inativos; exportação de dados registra o acesso', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleShowLgpd();
        assert.equal(page.$('#btn-anonymize-lgpd').disabled, true);
        assert.match(page.text('#lgpd-anonymize-hint'), /só é permitida para colaboradores desligados/);
        page.window.exportEmployeeDataLGPD();
        const json = JSON.parse(await page.objectUrls.at(-1).text());
        assert.equal(json.dados.name, 'Ana Souza');
        assert.match(json.finalidade, /LGPD art\. 18, V/);
    });

    test('anonimizar colaborador inativo chama a RPC', async () => {
        const c = client();
        c.tables.employees.find((e) => e.id === BIA.id).status = 'Inativo';
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(BIA.id);
        await page.window.handleShowLgpd();
        assert.equal(page.$('#btn-anonymize-lgpd').disabled, false);
        await page.window.confirmAnonymizeEmployee();
        assert.equal(c.rpcCalls('anonymize_employee')[0].args.p_employee_id, BIA.id);
    });
});

describe('colaboradores.html — promoção e cadastro', () => {
    test('promoção com redução salarial pede confirmação; recusando, nada é gravado', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: false });
        page.window.openDrawer(ANA.id);
        page.window.handlePromoteEmployee();
        page.$('#promote-role').value = 'Analista Pleno';
        page.$('#promote-contract-type').value = 'CLT';
        page.$('#promote-salary').value = 'R$ 3.500,00';
        await page.window.submitPromotion();
        assert.match(page.confirms.at(-1), /redução salarial é vedada/);
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('promoção com aumento grava cargo e salário e audita a mudança', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        page.window.handlePromoteEmployee();
        page.$('#promote-role').value = 'Analista Pleno';
        page.$('#promote-contract-type').value = 'CLT';
        page.$('#promote-salary').value = 'R$ 5.200,00';
        page.$('#promote-motivo').value = 'Resultado do ciclo';
        await page.window.submitPromotion();
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual(upd, { role: 'Analista Pleno', contract_type: 'CLT', salary: 5200 });
        const fields = c.writes('employee_audit', 'insert')[0].payload[0].changes.map((x) => x.field);
        assert.ok(['role', 'salary', 'motivo'].every((f) => fields.includes(f)));
    });

    async function preencherCadastro(p, { email = 'novo@empresa.com', cpf = CPF_VALIDO } = {}) {
        page.window.toggleForm();
        await p.settle();
        p.$('#name').value = 'Novo Colaborador';
        p.$('#cpf').value = cpf;
        p.$('#email').value = email;
        p.eval(`setDateFieldValue(document.getElementById('admission-date'), '2026-06-01')`);
        for (const id of ['contract-type', 'dept', 'work-load', 'salary-type']) {
            const sel = p.$(`#${id}`);
            sel.value = [...sel.options].find((o) => o.value)?.value;
        }
        p.$('#salary').value = 'R$ 3.000,00';
        p.$('#role').value = 'Analista';
    }

    test('cadastro: CPF inválido e e-mail duplicado são barrados', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        await preencherCadastro(page, { cpf: '111.111.111-11' });
        await page.submit('#employee-form');
        assert.ok(page.toasts().some((t) => /CPF Inválido/.test(t)));
        page.$('#cpf').value = CPF_VALIDO;
        page.$('#email').value = ANA.email;
        await page.submit('#employee-form');
        assert.ok(page.toasts().some((t) => /Email Duplicado/.test(t)));
        assert.equal(c.writes('employees', 'insert').length, 0);
    });

    test('cadastro: grava, envia o convite e vincula o perfil de acesso', async () => {
        const c = client({ profiles: [...baseTables().profiles] });
        page = await openPage('colaboradores', {
            client: c,
            now: NOW,
            fetch: async (url, init) => {
                assert.match(url, /invite-employee$/);
                assert.equal(JSON.parse(init.body).email, 'novo@empresa.com');
                return new Response(JSON.stringify({ id: 'auth-novo' }), { status: 200 });
            },
        });
        await preencherCadastro(page);
        await page.submit('#employee-form');
        await page.settle(20);
        const ins = c.writes('employees', 'insert')[0].payload[0];
        assert.equal(ins.name, 'Novo Colaborador');
        assert.equal(ins.salary, 3000);
        assert.deepEqual(c.writes('profiles', 'insert')[0].payload[0], { id: 'auth-novo', profile: 'colaborador', employee_id: c.tables.employees.at(-1).id });
        assert.ok(page.toasts().some((t) => /Um e-mail de acesso foi enviado/.test(t)));
    });

    test('cadastro: se o perfil de acesso não for vinculado, não diz que o convite deu certo', async () => {
        const c = client();
        c.errors['profiles:insert'] = { message: 'duplicate key' };
        page = await openPage('colaboradores', { client: c, now: NOW, fetch: async () => new Response(JSON.stringify({ id: 'auth-x' }), { status: 200 }) });
        await preencherCadastro(page);
        await page.submit('#employee-form');
        await page.settle(20);
        assert.ok(page.toasts().some((t) => /o acesso não foi vinculado/.test(t)));
        assert.ok(!page.toasts().some((t) => /Um e-mail de acesso foi enviado/.test(t)));
    });
});

describe('colaboradores.html — catálogos', () => {
    test('excluir cargo e treinamento do catálogo pede confirmação e exclui (antes quebrava)', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        await page.window.deleteJobTitle('jt1');
        assert.match(page.confirms.at(-1), /Excluir este cargo do catálogo\?/);
        assert.equal(c.writes('job_titles', 'delete').length, 1);
        await page.window.deleteTrainingCatalog('c1');
        assert.equal(c.writes('trainings', 'delete').length, 1);
    });

    test('organograma monta a árvore pelo gestor', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.openOrgChart();
        await page.settle();
        assert.match(page.text('#orgchart-container'), /Bia Lima.*Ana Souza/);
    });
});

describe('colaboradores.html — importação, disciplinares, atestados, onboarding', () => {
    const CABECALHO = ['Nome', 'CPF', 'Email', 'Data de Admissão', 'Tipo de Contrato', 'Departamento', 'Jornada', 'Salário', 'Tipo de Salário', 'Cargo'];

    test('importação: valida linha a linha, aponta duplicados e importa só as válidas', async () => {
        const c = client();
        const xlsxRows = [
            CABECALHO,
            ['Joana Lima', '529.982.247-25', 'joana@empresa.com', '01/06/2026', 'CLT', 'TI', '40h', 'R$ 4.500,00', 'Mensal', 'Dev'],
            ['CPF Ruim', '111.111.111-11', 'ruim@empresa.com', '01/06/2026', 'CLT', 'TI', '40h', '3000', 'Mensal', ''],
            ['Duplicada', '529.982.247-25', 'joana@empresa.com', '2026-06-01', 'CLT', 'TI', '40h', '3000', 'Mensal', ''],
        ];
        page = await openPage('colaboradores', {
            client: c,
            now: NOW,
            xlsxRows,
            fetch: async () => new Response(JSON.stringify({ id: 'auth-joana' }), { status: 200 }),
        });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('equipe.xlsx', 'xlsx', 'application/vnd.ms-excel')]);
        await page.settle(20);
        const preview = page.text('#import-preview-body');
        assert.match(preview, /Joana Lima/);
        assert.match(preview, /CPF inválido/);
        assert.match(preview, /CPF duplicado na planilha/);
        await page.click('#btn-import-confirm');
        await page.settle(20);
        const inseridos = c.writes('employees', 'insert').map((w) => w.payload[0]);
        assert.deepEqual(
            inseridos.map((e) => [e.name, e.salary, e.admission_date]),
            [['Joana Lima', 4500, '2026-06-01']]
        );
        assert.ok(page.toasts().some((t) => /1 colaborador importado/.test(t)));
    });

    test('importação: planilha sem colunas obrigatórias é recusada', async () => {
        page = await openPage('colaboradores', {
            client: client(),
            now: NOW,
            xlsxRows: [
                ['Nome', 'Email'],
                ['X', 'x@y.com'],
            ],
        });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('x.xlsx', 'x', 'application/vnd.ms-excel')]);
        await page.settle(20);
        assert.ok(page.toasts().some((t) => /Colunas Ausentes/.test(t)));
    });

    test('medida disciplinar: suspensão exige dias; registra', async () => {
        const c = client({ disciplinary_actions: [] });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenDisciplinary();
        page.eval(`daTypeField.setValue('suspensao')`);
        page.$('#da-reason').value = 'Falta grave';
        await page.window.addDisciplinaryAction();
        assert.ok(page.toasts().some((t) => /quantidade de dias de suspensão/.test(t)));
        page.$('#da-suspension-days').value = '2';
        await page.window.addDisciplinaryAction();
        const ins = c.writes('disciplinary_actions', 'insert')[0].payload[0];
        assert.deepEqual([ins.type, ins.suspension_days, ins.employee_id], ['suspensao', 2, ANA.id]);
    });

    test('atestado: aprovar e recusar (com motivo)', async () => {
        const c = client({
            medical_leaves: [
                { id: 'm1', employee_id: ANA.id, start_date: '2026-06-01', end_date: '2026-06-02', days: 2, status: 'pendente' },
                { id: 'm2', employee_id: ANA.id, start_date: '2026-06-08', end_date: '2026-06-08', days: 1, status: 'pendente' },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenMedicalLeaves();
        await page.window.approveLeave('m1');
        assert.equal(c.tables.medical_leaves[0].status, 'aprovado');
        page.window.openRejectLeaveRow('m2');
        await page.window.confirmRejectLeave();
        assert.ok(page.toasts().some((t) => /Informe o motivo da recusa/.test(t)));
        page.$('#ml-reject-reason').value = 'Sem CRM';
        await page.window.confirmRejectLeave();
        assert.deepEqual([c.tables.medical_leaves[1].status, c.tables.medical_leaves[1].rejection_reason], ['recusado', 'Sem CRM']);
    });

    test('treinamentos do colaborador: atribuir do catálogo', async () => {
        const c = client({ employee_trainings: [] });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenTrainings();
        page.$('#tr-assign-title').value = 'Excel';
        page.$('#tr-assign-hours').value = '6';
        await page.window.assignTraining();
        const ins = c.writes('employee_trainings', 'insert')[0].payload[0];
        assert.deepEqual([ins.title, ins.hours, ins.employee_id], ['Excel', 6, ANA.id]);
    });

    test('tarefas de onboarding: adicionar e remover', async () => {
        const c = client({ onboarding_tasks: [] });
        page = await openPage('colaboradores', { client: c, now: NOW });
        await page.window.openOnboardingTasksModal();
        const input = page.$('#onboarding-tasks-modal input[type="text"]');
        input.value = 'Conhecer a equipe';
        await page.window.addOnboardingTask(30);
        assert.equal(c.writes('onboarding_tasks', 'insert')[0].payload[0].titulo, 'Conhecer a equipe');
        await page.window.removeOnboardingTask(c.tables.onboarding_tasks[0].id);
        assert.equal(c.writes('onboarding_tasks', 'delete').length, 1);
    });
});
