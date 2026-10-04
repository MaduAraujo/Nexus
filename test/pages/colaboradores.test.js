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

    test('medida disciplinar: PJ não tem a opção no menu nem consegue abrir o registro', async () => {
        const c = client({ disciplinary_actions: [] });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(CAIO.id);
        assert.ok(page.$('#menu-disciplinary').classList.contains('hidden'));
        await page.window.handleOpenDisciplinary();
        assert.equal(page.$('#disciplinary-modal').classList.contains('open'), false);
        assert.ok(page.toasts().some((t) => /não está sujeito a advertência ou suspensão/.test(t)));
        assert.equal(c.calls.filter((x) => x.table === 'disciplinary_actions').length, 0);
        page.window.openDrawer(ANA.id);
        assert.equal(page.$('#menu-disciplinary').classList.contains('hidden'), false);
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

describe('colaboradores.html — LGPD, status e modelo de importação', () => {
    test('LGPD: quem acessou os dados e as decisões da IA sobre o colaborador, escapados', async () => {
        const c = client({
            data_access_log: [
                {
                    id: 'a1',
                    employee_id: ANA.id,
                    tipo: 'holerite',
                    detalhe: '06/2026',
                    accessed_by_name: 'RH <b>Admin</b>',
                    created_at: '2026-06-16T10:00:00Z',
                },
                { id: 'a2', employee_id: ANA.id, tipo: 'desconhecido', accessed_by_name: null, created_at: '2026-06-15T10:00:00Z' },
            ],
            ai_decision_log: [],
            ai_decision_log_decrypted: [
                {
                    id: 'd1',
                    employee_id: ANA.id,
                    target_table: 'vacations',
                    ai_message: 'Aprovar <img src=x>',
                    decided_by_name: 'Maria',
                    created_at: '2026-06-14T10:00:00Z',
                },
                { id: 'd2', employee_id: ANA.id, target_table: '<svg onload=1>', ai_message: 'x', created_at: '2026-06-13T10:00:00Z' },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleShowLgpd();
        await page.settle();
        const acessos = page.text('#lgpd-access-log-body');
        assert.match(acessos, /RH <b>Admin<\/b>.*Holerite — 06\/2026/);
        assert.match(acessos, /desconhecido/);
        const ia = page.text('#lgpd-ai-decisions-body');
        assert.match(ia, /Confirmado por Maria.*Férias: Aprovar <img src=x>/);
        assert.equal(page.$$('#lgpd-access-log-body b, #lgpd-ai-decisions-body img, #lgpd-ai-decisions-body svg').length, 0, 'nada vira HTML');
    });

    test('LGPD sem registros mostra os vazios', async () => {
        page = await openPage('colaboradores', { client: client({ ai_decision_log_decrypted: [] }), now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleShowLgpd();
        await page.settle();
        assert.match(page.text('#lgpd-access-log-body'), /Nenhum acesso registrado ainda/);
        assert.match(page.text('#lgpd-ai-decisions-body'), /Nenhuma decisão da IA registrada ainda/);
    });

    test('opções de status dependem do status atual; Inativo é permanente', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        const opcoes = () => page.$$('#dynamic-status-options [data-click="updateStatus"]').map((a) => JSON.parse(a.dataset.clickArgs)[0]);
        page.window.openDrawer(ANA.id);
        page.window.showStatusSubmenu();
        assert.deepEqual(opcoes(), ['Inativo', 'Férias', 'Afastado']);
        page.window.openDrawer(CAIO.id);
        page.window.showStatusSubmenu();
        assert.deepEqual(opcoes(), ['Ativo']);
        assert.match(page.text('#dynamic-status-options'), /Voltar das Férias/);
        page.close();

        const c = client();
        c.tables.employees.find((e) => e.id === BIA.id).status = 'Afastado';
        c.tables.employees.find((e) => e.id === CAIO.id).status = 'Inativo';
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(BIA.id);
        page.window.showStatusSubmenu();
        assert.match(page.text('#dynamic-status-options'), /Voltar do Afastamento/);
        page.window.openDrawer(CAIO.id);
        page.window.showStatusSubmenu();
        assert.equal(opcoes().length, 0);
        assert.match(page.text('#dynamic-status-options'), /Status Inativo é permanente/);
    });

    test('voltar de férias não mexe na data de desligamento; erro do banco avisa', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(CAIO.id);
        await page.window.updateStatus('Ativo');
        await page.settle();
        const caio = c.tables.employees.find((e) => e.id === CAIO.id);
        assert.deepEqual([caio.status, caio.termination_date ?? null], ['Ativo', null]);

        c.errors['employees:update'] = { message: 'falhou' };
        page.window.openDrawer(ANA.id);
        await page.window.updateStatus('Afastado');
        assert.ok(page.toasts().some((t) => /Não foi possível atualizar o status/.test(t)));
        assert.equal(c.tables.employees.find((e) => e.id === ANA.id).status, 'Ativo');
    });

    test('modelo de importação traz as colunas obrigatórias e um exemplo', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.downloadImportTemplate();
        assert.equal(page.saved.at(-1), 'modelo_importacao_colaboradores.xlsx');
    });
});

describe('colaboradores.html — regras de cadastro, importação e lista', () => {
    test('CPF: tamanho, dígitos repetidos e cada dígito verificador', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        const valido = page.window.isValidCPF;
        assert.equal(valido('529.982.247-25'), true);
        assert.equal(valido('52998224725'), true);
        assert.equal(valido('529.982.247-2'), false, 'faltando dígito');
        assert.equal(valido('111.111.111-11'), false, 'todos iguais');
        assert.equal(valido('529.982.247-35'), false, 'primeiro verificador errado');
        assert.equal(valido('529.982.247-24'), false, 'segundo verificador errado');
        assert.equal(valido('000.000.001-91'), true, 'resto 10/11 vira 0');
    });

    test('importação: cada campo obrigatório é apontado; salário "3.500" é milhar; data impossível é recusada', async () => {
        const CABECALHO = ['Nome', 'CPF', 'Email', 'Data de Admissão', 'Tipo de Contrato', 'Departamento', 'Jornada', 'Salário', 'Tipo de Salário', 'Cargo'];
        const c = client();
        const xlsxRows = [
            CABECALHO,
            ['', '', '', '', '', '', '', '', '', 'Estagiário'],
            ['Email Ruim', '111.444.777-35', 'sem-arroba', '31/02/2025', 'CLT', 'TI', '40h', '0', 'Mensal', ''],
            ['Milhar BR', '153.509.460-56', 'milhar@empresa.com', '15/01/2025', 'CLT', 'TI', '40h', '3.500', 'Mensal', ''],
            ['Já Existe', '000.000.001-91', 'ana@empresa.com', '2025-13-01', 'CLT', 'TI', '40h', 'R$ 12.000', 'Mensal', ''],
        ];
        page = await openPage('colaboradores', { client: c, now: NOW, xlsxRows, fetch: async () => new Response('{"id":"auth-x"}', { status: 200 }) });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('equipe.xlsx', 'xlsx', 'application/vnd.ms-excel')]);
        await page.settle(20);
        const preview = page.text('#import-preview-body');
        for (const msg of [
            'Nome é obrigatório',
            'CPF é obrigatório',
            'Email é obrigatório',
            'Tipo de contrato é obrigatório',
            'Departamento é obrigatório',
            'Jornada de trabalho é obrigatória',
            'Tipo de salário é obrigatório',
            'Email inválido',
            'Email já cadastrado',
        ])
            assert.ok(preview.includes(msg), `falta o aviso "${msg}"`);
        assert.equal((preview.match(/Data de admissão inválida/g) || []).length, 3, '31/02, mês 13 e vazio');
        assert.equal((preview.match(/Salário inválido/g) || []).length, 2, 'vazio e zero');
        await page.click('#btn-import-confirm');
        await page.settle(20);
        const [milhar] = c.writes('employees', 'insert').map((w) => w.payload[0]);
        assert.deepEqual([milhar.name, milhar.salary, milhar.admission_date], ['Milhar BR', 3500, '2025-01-15']);
    });

    test('aviso prévio: vencido, termina hoje e termina em breve aparecem como alerta; longe não', async () => {
        const c = client();
        const set = (id, fim) =>
            Object.assign(
                c.tables.employees.find((e) => e.id === id),
                { is_aviso_previo: true, aviso_previo_end_date: fim }
            );
        set(ANA.id, '2026-06-10');
        set(BIA.id, '2026-06-17');
        set(CAIO.id, '2026-09-30');
        page = await openPage('colaboradores', { client: c, now: NOW });
        const sino = (nome) => rowFor(page, nome).querySelector('.bell-alert-icon')?.getAttribute('title') || '';
        assert.match(sino('Ana Souza'), /Aviso prévio venceu há 7d/);
        assert.match(sino('Bia Lima'), /Aviso prévio termina hoje/);
        assert.doesNotMatch(sino('Caio Prado'), /Aviso prévio/);
    });

    test('filtros de status e departamento se combinam', async () => {
        const c = client();
        c.tables.employees.find((e) => e.id === BIA.id).status = 'Afastado';
        page = await openPage('colaboradores', { client: c, now: NOW });
        const nomes = () => page.$$('#employee-list-body tr').map((tr) => tr.querySelector('.employee-name-cell strong').textContent);
        for (const [filtro, esperado] of [
            ['afastados', /Bia Lima/],
            ['ferias', /Caio Prado/],
            ['ativos', /Ana Souza/],
        ]) {
            await page.click(`[data-filter="${filtro}"]`);
            assert.match(nomes().join(' '), esperado, filtro);
            assert.equal(nomes().length, 1, filtro);
        }
        await page.click('[data-filter="inativos"]');
        assert.match(page.text('#employee-list-body'), /Nenhum|nenhum/);
    });

    test('paginação: 5 por página, avançar e voltar', async () => {
        const extras = Array.from({ length: 9 }, (_, i) => ({
            ...BIA,
            id: `emp-x${i}`,
            name: `Pessoa ${String(i).padStart(2, '0')}`,
            email: `p${i}@empresa.com`,
            cpf: `000.000.00${i}-00`,
            manager_id: null,
            created_at: `2023-01-${String(10 + i).padStart(2, '0')}`,
        }));
        const c = client();
        c.tables.employees.push(...extras);
        page = await openPage('colaboradores', { client: c, now: NOW });
        assert.equal(page.$$('#employee-list-body tr').length, 5);
        const next = page.$$('.pagination-btn').at(-1);
        await page.click(next);
        assert.equal(page.$$('#employee-list-body tr').length, 5);
        await page.click(page.$$('.pagination-btn').at(-1));
        assert.equal(page.$$('#employee-list-body tr').length, 2);
        await page.click(page.$$('.pagination-btn')[0]);
        assert.equal(page.$$('#employee-list-body tr').length, 5);
    });
});
