const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const CPF_VALIDO = '529.982.247-25';
const erro = { message: 'falhou' };

const MIA = {
    id: 'emp-mia',
    name: 'Mia Nunes',
    email: 'mia@empresa.com',
    cpf: '390.533.447-05',
    status: 'Ativo',
    role: null,
    dept: null,
    contract_type: null,
    salary: null,
    admission_date: null,
    raca_cor: 'Branca',
    manager_id: null,
    created_at: '2026-01-01',
};

function client(extra = {}, empOverrides = {}, { semPadrao = false, extraEmps = [] } = {}) {
    const emps = semPadrao
        ? extraEmps
        : [
              { ...ANA, created_at: '2024-02-01', ...(empOverrides[ANA.id] || {}) },
              { ...BIA, created_at: '2022-05-10', ...(empOverrides[BIA.id] || {}) },
              { ...CAIO, created_at: '2025-01-15', ...(empOverrides[CAIO.id] || {}) },
              ...extraEmps,
          ];
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            employees: emps.map((e) => ({ ...e })),
            employee_audit: [],
            vacations: [],
            documents: [],
            document_requirements: [],
            job_titles: [{ id: 'jt1', title: 'Analista', level: 'Júnior', active: true }],
            trainings: [{ id: 'c1', title: 'LGPD', active: true, duration_hours: 4, category: 'Compliance' }],
            employee_trainings: [],
            data_access_log: [],
            ai_decision_log: [],
            onboarding_tasks: [],
            disciplinary_actions: [],
            medical_leaves: [],
            performance_reviews: [],
            pdi_goals: [],
            profiles: [...baseTables().profiles],
            ...extra,
        }),
        rpc: { job_titles_public: [{ title: 'Analista' }], anonymize_employee: {} },
        views: { employees_decrypted: 'employees', employee_audit_decrypted: 'employee_audit', ai_decision_log_decrypted: 'ai_decision_log' },
    });
}

const rowFor = (p, name) => p.$$('#employee-list-body tr').find((tr) => tr.textContent.includes(name));
const toastCom = (p, re) => p.toasts().some((t) => re.test(t));

async function preencherCadastro(p, { email = 'novo@empresa.com', cpf = CPF_VALIDO, salario = 'R$ 3.000,00' } = {}) {
    p.window.toggleForm();
    await p.settle();
    p.$('#name').value = 'Novo Colaborador';
    p.$('#cpf').value = cpf;
    p.$('#email').value = email;
    p.eval(`setDateFieldValue(document.getElementById('admission-date'), '2026-06-01')`);
    for (const id of ['contract-type', 'dept', 'work-load', 'salary-type']) {
        const sel = p.$(`#${id}`);
        sel.value = [...sel.options].find((o) => o.value)?.value;
    }
    p.$('#salary').value = salario;
    p.$('#role').value = 'Analista';
}

function marcar(p, nome, valor) {
    const r = p.$(`input[name="${nome}"][value="${valor}"]`);
    r.checked = true;
    r.dispatchEvent(new p.window.Event('change', { bubbles: true }));
}

describe('colaboradores.html — cadastro com campos opcionais vazios', () => {
    test('status fora dos quatro conhecidos aparece sem cor de selo', async () => {
        page = await openPage('colaboradores', { client: client({}, { [ANA.id]: { status: 'Licença' } }), now: NOW });
        const selo = rowFor(page, 'Ana Souza').querySelector('.badge');
        assert.equal(selo.className.trim(), 'badge');
        assert.equal(page.text(selo), 'Licença');
    });

    test('lista, ficha, exportação, organograma e promoção lidam com cargo, depto, contrato, salário e admissão vazios', async () => {
        const c = client({}, {}, { semPadrao: true, extraEmps: [MIA] });
        page = await openPage('colaboradores', { client: c, now: NOW });
        const linha = rowFor(page, 'Mia Nunes');
        const tds = [...linha.querySelectorAll('td')].map((td) => td.textContent.trim());
        assert.deepEqual(tds.slice(4), ['-', '-', '-']);

        page.window.openDrawer(MIA.id);
        assert.deepEqual(
            ['#view-role', '#view-dept', '#view-contract', '#view-raca-cor'].map((s) => page.text(s)),
            ['—', '—', '—', 'Branco']
        );
        assert.match(page.text('#view-salary'), /R\$\s?0,00/);

        page.eval('exportEmployeesPDF()');
        const pdf = page.opened.at(-1).text();
        assert.match(pdf, /1 colaborador(?!es)/);

        page.window.openOrgChart();
        const card = page.$('.org-card');
        assert.match(page.text(card.querySelector('small')), /^—$/);
        assert.equal(card.querySelector('.org-card-dept'), null);
        page.window.closeOrgChart();

        page.window.handlePromoteEmployee();
        assert.match(page.text('#promote-current-info'), /Atual: — · — · R\$\s?0,00/);
        assert.equal(page.$('#promote-contract-type').value, 'CLT');
        assert.equal(page.$('#promote-salary').value, 'R$ 0,00');
        page.window.updatePromoteBtnState();
        assert.equal(page.$('#btn-promote-submit').disabled, true);
        page.eval(`promoteRoleField.setValue('Analista')`);
        page.$('#promote-salary').value = 'R$ 2.500,00';
        page.window.updatePromoteBtnState();
        assert.equal(page.$('#btn-promote-submit').disabled, false);
        await page.window.submitPromotion();
        const mudancas = c.writes('employee_audit', 'insert')[0].payload[0].changes;
        assert.deepEqual(
            mudancas.map((m) => [m.field, m.oldValue]),
            [
                ['role', '—'],
                ['contractType', '—'],
                ['salary', 'R$ 0.00'],
            ]
        );
    });

    test('abrir a edição de um cadastro esparso deixa os campos vazios; gerente sem cargo aparece só pelo nome', async () => {
        const c = client({}, {}, { extraEmps: [MIA] });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(MIA.id);
        await page.settle();
        assert.deepEqual(
            ['#role', '#dept', '#salary'].map((s) => page.$(s).value),
            ['', '', 'R$ 0,00']
        );
        assert.equal(page.$('#admission-date').value, '');
        const opcao = [...page.$('#manager-id').options].find((o) => o.value === ANA.id);
        assert.ok(opcao);
        page.window.toggleForm();
        const miaOpcao = () => [...page.$('#manager-id').options].find((o) => o.value === MIA.id);
        page.window.toggleForm();
        assert.equal(page.text(miaOpcao()), 'Mia Nunes');
    });

    test('edição com opções marcadas "sim" mas sem os detalhes deixa os campos vazios', async () => {
        const esparsa = {
            is_aviso_previo: true,
            aviso_previo_end_date: null,
            seguro_vida: true,
            seguradora: null,
            possui_dependentes: true,
            qtd_dependentes: null,
            vale_transporte: true,
            conducoes_dia: null,
            forma_pagamento: 'pix',
            tipo_chave_pix: null,
            chave_pix: null,
        };
        const c = client({}, { [ANA.id]: esparsa, [BIA.id]: { forma_pagamento: 'conta', banco: null, tipo_conta: null, agencia: null, conta: null } });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        for (const s of ['#aviso-previo-end-date', '#seguradora', '#qtd-dependentes', '#conducoes-dia', '#tipo-chave-pix', '#chave-pix']) {
            assert.equal(page.$(s).value, '', s);
        }
        page.window.toggleForm();
        page.window.editEmployee(BIA.id);
        await page.settle();
        for (const s of ['#banco-outro', '#tipo-conta', '#agencia', '#conta']) {
            assert.equal(page.$(s).value, '', s);
        }
    });

    test('editar e preencher o departamento que estava vazio registra "—" como valor anterior', async () => {
        const c = client({}, { [ANA.id]: { dept: null, cpf: CPF_VALIDO, contract_type: 'CLT', salary_type: 'Mensal Fixo' } });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        page.$('#dept').value = 'TI';
        await page.submit('#employee-form');
        await page.settle(20);
        const mudanca = c.writes('employee_audit', 'insert')[0].payload[0].changes.find((m) => m.field === 'dept');
        assert.deepEqual([mudanca.oldValue, mudanca.newValue], ['—', 'TI']);
    });

    test('cadastro com seguro, dependentes e VT marcados sem detalhes grava nulos; salário zerado vira nulo', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, fetch: async () => new Response('{}', { status: 200 }) });
        await preencherCadastro(page, { salario: 'R$ 0,00' });
        marcar(page, 'seguro-vida', 'sim');
        marcar(page, 'possui-dependentes', 'sim');
        marcar(page, 'vale-transporte', 'sim');
        page.$('#valor-passagem').value = 'R$ 0,00';
        await page.submit('#employee-form');
        await page.settle(20);
        const ins = c.writes('employees', 'insert')[0].payload[0];
        assert.deepEqual([ins.salary, ins.seguradora, ins.qtd_dependentes, ins.valor_passagem, ins.conducoes_dia], [null, null, null, null, null]);
    });
});

describe('colaboradores.html — falhas no cadastro, sessão e usuário ausente', () => {
    test('cadastro gravado mas releitura falha: avisa o erro', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        c.errors['employees:select'] = { message: 'releitura falhou' };
        await preencherCadastro(page);
        await page.submit('#employee-form');
        await page.settle(20);
        assert.ok(toastCom(page, /releitura falhou/));
    });

    test('sessão expirada no convite: cadastra e avisa que o e-mail não foi enviado', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        c.auth.session = null;
        await preencherCadastro(page);
        await page.submit('#employee-form');
        await page.settle(20);
        assert.ok(toastCom(page, /Sessão expirada/));
        assert.equal(c.writes('employees', 'insert').length, 1);
    });

    test('sem usuário na sessão, auditoria e anonimização usam "RH"; anexos ficam sem autor', async () => {
        const c = client({}, { [CAIO.id]: { status: 'Inativo' }, [ANA.id]: { cpf: CPF_VALIDO, contract_type: 'CLT', salary_type: 'Mensal Fixo' } });
        page = await openPage('colaboradores', { client: c, now: NOW, fetch: async () => new Response('{}', { status: 200 }) });
        c.auth.user = null;

        page.window.openDrawer(ANA.id);
        await page.window.updateStatus('Férias');
        assert.deepEqual(
            [c.writes('employee_audit', 'insert').at(-1).payload[0].operator_name, c.writes('employee_audit', 'insert').at(-1).payload[0].operator_email],
            ['RH', '']
        );

        await page.check(rowFor(page, 'Bia Lima').querySelector('.row-checkbox'));
        await page.window.bulkUpdateStatus('Afastado');
        assert.equal(c.writes('employee_audit', 'insert').at(-1).payload[0].operator_name, 'RH');

        page.window.openDrawer(CAIO.id);
        await page.window.confirmAnonymizeEmployee();
        assert.deepEqual(
            [c.rpcCalls('anonymize_employee')[0].args.p_anonymized_by_name, c.rpcCalls('anonymize_employee')[0].args.p_anonymized_by_email],
            ['RH', null]
        );

        page.window.editEmployee(ANA.id);
        await page.settle();
        page.window.selectRegDocType('RG');
        await page.setFiles('#reg-doc-input', [page.file('rg.pdf', '%PDF-1.4')]);
        await page.submit('#employee-form');
        await page.settle(20);
        assert.equal(c.writes('documents', 'insert')[0].payload[0].created_by, null);
    });
});

describe('colaboradores.html — lista, filtros, lote e exclusão', () => {
    test('escolher um departamento não apaga a busca nem tira o destaque do filtro de status', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        await page.fill('#search-input', 'a');
        const financeiro = page.$$('#dept-filter-list .btn-filter-dept').find((b) => b.dataset.dept === 'Financeiro');
        await page.click(financeiro);
        assert.equal(page.$('#search-input').value, 'a');
        assert.equal(page.$('.btn-filter[data-filter="todos"]').classList.contains('active'), true);
        assert.ok(rowFor(page, 'Ana Souza'));
        assert.equal(rowFor(page, 'Caio Prado'), undefined);
    });

    test('depois de filtrar por alerta, a busca volta a considerar todos os status', async () => {
        const c = client({}, { [ANA.id]: { is_probation: true, probation_end_date: '2026-06-25' }, [CAIO.id]: { status: 'Inativo' } });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.filterByAlert('experiencia');
        assert.equal(page.$$('.btn-filter[data-filter].active').length, 0);
        await page.fill('#search-input', 'caio');
        page.window.filterTable();
        assert.ok(rowFor(page, 'Caio Prado'));
    });

    test('excluir a última página inteira volta para a página anterior', async () => {
        const extras = Array.from({ length: 3 }, (_, i) => ({
            ...MIA,
            id: `emp-x${i}`,
            name: `Extra ${i}`,
            email: `x${i}@e.com`,
            cpf: `000.000.00${i}-00`,
            created_at: `2020-01-0${i + 1}`,
        }));
        const c = client({}, {}, { extraEmps: extras });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.goToPage(2);
        await page.settle();
        assert.equal(page.$$('#employee-list-body tr').length, 1);
        const ultima = page.$$('#employee-list-body .row-checkbox')[0];
        await page.check(ultima);
        await page.window.bulkDeleteEmployees();
        assert.equal(page.$$('#employee-list-body tr').length, 5);
    });

    test('recusar exclusões e falha genérica do banco no lote', async () => {
        let responder = false;
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: () => responder });
        await page.check(rowFor(page, 'Ana Souza').querySelector('.row-checkbox'));
        await page.window.bulkDeleteEmployees();
        page.window.openDrawer(BIA.id);
        await page.window.handleDeleteEmployee();
        page.window.openDrawer(CAIO.id);
        await page.window.confirmAnonymizeEmployee();
        assert.equal(c.writes('employees', 'delete').length, 0);
        assert.equal(c.rpcCalls('anonymize_employee').length, 0);

        responder = true;
        c.errors['employees:delete'] = { message: 'x', code: '42501' };
        await page.window.bulkDeleteEmployees();
        assert.ok(toastCom(page, /Não foi possível excluir os colaboradores selecionados/));
    });

    test('ações da ficha com colaborador que sumiu (ou sem ficha aberta) não fazem nada', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.eval(`
            currentEmployeeId = 'sumiu';
            openDrawer('sumiu');
            showStatusSubmenu();
            updateStatus('Ativo');
            handleDeleteEmployee();
            exportEmployeeDataLGPD();
            confirmAnonymizeEmployee();
            handlePromoteEmployee();
            submitPromotion();
            handleOpenTrainings();
            handleOpenDisciplinary();
            handleOpenMedicalLeaves();
            handleOpenPerformance();
            editEmployee('sumiu');
            currentEmployeeId = null;
            handleShowHistory();
            handleShowLgpd();
            trainingsEmployeeId = null;
            assignTraining();
            disciplinaryEmployeeId = null;
            addDisciplinaryAction();
        `);
        await page.settle(20);
        assert.equal(c.writes('employees').length, 0);
        assert.equal(c.writes('employee_trainings').length, 0);
        assert.equal(c.writes('disciplinary_actions').length, 0);
        assert.equal(page.$('#employee-drawer').classList.contains('active'), false);
    });

    test('histórico com valores vazios e operador sem nome', async () => {
        const c = client({
            employee_audit: [
                {
                    id: 'a1',
                    employee_id: ANA.id,
                    created_at: '2026-06-10T14:00:00Z',
                    operator_name: null,
                    changes: [{ label: 'Cargo', oldValue: '', newValue: '' }],
                },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleShowHistory();
        assert.match(page.text('#audit-history-body'), /RH.*Cargo: — → —/);
    });

    test('organograma: ciclo de gestores não trava; sem ninguém cadastrado mostra vazio', async () => {
        const c = client({}, { [ANA.id]: { manager_id: BIA.id }, [BIA.id]: { manager_id: ANA.id } });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openOrgChart();
        assert.match(page.text('#orgchart-container'), /Ana Souza/);
        assert.match(page.text('#orgchart-container'), /Bia Lima/);
        page.close();

        page = await openPage('colaboradores', { client: client({}, {}, { semPadrao: true }), now: NOW });
        page.window.openOrgChart();
        assert.match(page.text('#orgchart-container'), /Nenhum colaborador cadastrado/);
    });
});

describe('colaboradores.html — importação: formatos e valores estranhos', () => {
    const CAB = ['Nome', 'CPF', 'Email', 'Data de Admissão', 'Tipo de Contrato', 'Departamento', 'Jornada', 'Salário', 'Tipo de Salário'];
    const linha = (nome, cpf, email, extra = {}) => {
        const r = [nome, cpf, email, '01/06/2026', 'CLT', 'TI', '40h', '3000', 'Mensal'];
        Object.entries(extra).forEach(([i, v]) => (r[i] = v));
        return r;
    };

    test('CSV é lido como texto; data, salário, CPF já cadastrado, célula nula e linha curta viram erro legível', async () => {
        page = await openPage('colaboradores', {
            client: client(),
            now: NOW,
            xlsxRows: [
                CAB,
                linha('Data Ruim', '846.213.579-64', 'd@e.com', { 3: 'ontem' }),
                linha('Salario Ruim', CPF_VALIDO, 's@e.com', { 7: 'abc' }),
                linha('Repetida', ANA.cpf, 'r@e.com'),
                [null, null, null],
                ['Curta'],
            ],
        });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('equipe.csv', 'a;b', 'text/csv')]);
        await page.settle(20);
        const corpo = page.text('#import-preview-body');
        assert.match(corpo, /Data de admissão inválida/);
        assert.match(corpo, /Salário inválido/);
        assert.match(corpo, /CPF já cadastrado/);
        assert.match(corpo, /Curta/);
        assert.equal(page.$$('#import-preview-body tr.import-row').length, 4);
    });

    test('importar duas linhas boas e uma recusada usa o plural', async () => {
        const c = client();
        let n = 0;
        c.errors['employees:insert'] = () => (++n === 3 ? { message: 'recusado' } : null);
        page = await openPage('colaboradores', {
            client: c,
            now: NOW,
            fetch: async () => new Response('{}', { status: 200 }),
            xlsxRows: [CAB, linha('Um', CPF_VALIDO, 'um@e.com'), linha('Dois', '271.845.963-82', 'dois@e.com'), linha('Tres', '390.533.447-05', 'tres@e.com')],
        });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('equipe.xlsx', 'x', 'application/vnd.ms-excel')]);
        await page.settle(20);
        await page.window.confirmImport();
        assert.ok(toastCom(page, /2 colaboradores importados, 1 com falha/));
    });
});

describe('colaboradores.html — cadastros auxiliares com dados incompletos', () => {
    test('onboarding: tarefa sem descrição e adicionar sem título não grava', async () => {
        const c = client({
            onboarding_tasks: [
                { id: 'o1', titulo: 'Crachá', descricao: null, dias: 30, ordem: 1 },
                { id: 'o2', titulo: 'Notebook', descricao: 'Com VPN', dias: 60, ordem: 1 },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        await page.window.openOnboardingTasksModal();
        assert.equal(page.$('#onb-tasks-30 .onb-chip-desc'), null);
        assert.equal(page.text('#onb-tasks-60 .onb-chip-desc'), 'Com VPN');
        await page.window.addOnboardingTask(30);
        assert.equal(c.writes('onboarding_tasks', 'insert').length, 0);
    });

    test('campo de data abre e fecha no clique', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.toggleForm();
        const input = page.$('#admission-date');
        const pop = input.closest('.date-field').querySelector('.calendar-popover');
        await page.click(input);
        assert.equal(pop.classList.contains('open'), true);
        await page.click(input);
        assert.equal(pop.classList.contains('open'), false);
    });

    test('documentos de admissão: arquivo grande em MB, tipo fora da lista e duas falhas no plural', async () => {
        const c = client({}, { [ANA.id]: { cpf: CPF_VALIDO, contract_type: 'CLT', salary_type: 'Mensal Fixo' } });
        page = await openPage('colaboradores', {
            client: c,
            now: NOW,
            fetch: async (url) => (/nexus-files/.test(url) ? new Response('{"error":"falhou"}', { status: 500 }) : new Response('{}', { status: 200 })),
        });
        page.window.editEmployee(ANA.id);
        await page.settle();
        page.window.selectRegDocType('Certidão de Casamento');
        await page.setFiles('#reg-doc-input', [page.file('certidao.pdf', 'x'.repeat(1300 * 1024))]);
        assert.match(page.text('#reg-doc-list'), /1\.3 MB/);
        assert.ok([...page.$('.reg-doc-item-tipo').options].some((o) => o.value === 'Certidão de Casamento'));
        page.window.selectRegDocType('RG');
        await page.setFiles('#reg-doc-input', [page.file('rg.pdf', '%PDF')]);
        await page.submit('#employee-form');
        await page.settle(20);
        assert.ok(toastCom(page, /2 documentos não foram anexados/));
    });

    test('cargos: faixa só com mínimo, só com máximo ou nenhuma; falha genérica ao adicionar; recusar exclusão', async () => {
        const c = client({
            job_titles: [
                { id: 'j1', title: 'Mín', salary_min: 1000, salary_max: null, track: 'Tec', level: null, active: true },
                { id: 'j2', title: 'Máx', salary_min: null, salary_max: 5000, track: null, level: null, active: true },
                { id: 'j3', title: 'Nada', salary_min: null, salary_max: null, track: null, level: null, active: false },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: () => false });
        await page.window.openJobTitlesModal();
        const texto = page.text('#job-titles-list');
        assert.match(texto, /Mín.*Tec · R\$\s?1\.000,00 a —/);
        assert.match(texto, /Máx.*Sem trilha\/nível definido · — a R\$\s?5\.000,00/);
        assert.match(texto, /Nada.*Faixa salarial não definida/);
        c.errors['job_titles:insert'] = { message: 'x', code: '42501' };
        page.$('#jt-add-title').value = 'Novo';
        await page.window.addJobTitle();
        assert.ok(toastCom(page, /Não foi possível adicionar o cargo/));
        await page.window.deleteJobTitle('j1');
        assert.equal(c.writes('job_titles', 'delete').length, 0);
    });

    test('catálogos e listas do colaborador com erro de leitura ficam vazios', async () => {
        const c = client({}, {});
        page = await openPage('colaboradores', { client: c, now: NOW });
        for (const t of ['job_titles', 'trainings', 'employee_trainings', 'disciplinary_actions', 'medical_leaves', 'performance_reviews', 'pdi_goals']) {
            c.errors[t] = erro;
        }
        await page.window.openJobTitlesModal();
        assert.match(page.text('#job-titles-list'), /Nenhum cargo cadastrado/);
        await page.window.openTrainingsCatalogModal();
        assert.match(page.text('#trainings-catalog-list'), /Nenhum treinamento cadastrado/);
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenTrainings();
        assert.match(page.text('#trainings-list'), /Nenhum treinamento registrado/);
        await page.window.handleOpenDisciplinary();
        assert.match(page.text('#disciplinary-list'), /Nenhuma medida disciplinar/);
        await page.window.handleOpenMedicalLeaves();
        assert.match(page.text('#medical-leaves-list'), /Nenhum atestado/);
        await page.window.handleOpenPerformance();
        assert.match(page.text('#performance-reviews-list'), /Nenhuma avaliação/);
        assert.match(page.text('#performance-goals-list'), /Nenhuma meta/);
        await page.eval('fetchTrainingsCatalogPublic()');
        assert.deepEqual([...page.eval('trainingsCatalogPublic')], []);
    });

    test('treinamentos: catálogo sem detalhes, recusar exclusão e certificado por link', async () => {
        const c = client({
            trainings: [{ id: 'c9', title: 'Sem nada', active: true }],
            employee_trainings: [
                {
                    id: 't1',
                    employee_id: ANA.id,
                    title: 'Curso',
                    status: 'concluido',
                    certificate_url: 'https://cert.example/x',
                    created_at: '2026-06-01T00:00:00Z',
                },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: () => false });
        await page.window.openTrainingsCatalogModal();
        assert.match(page.text('#trainings-catalog-list'), /Sem detalhes definidos/);
        await page.window.deleteTrainingCatalog('c9');
        assert.equal(c.writes('trainings', 'delete').length, 0);
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenTrainings();
        assert.equal(page.$('#trainings-list a').getAttribute('href'), 'https://cert.example/x');
    });

    test('disciplinar, atestado e metas com detalhes opcionais preenchidos', async () => {
        const c = client({
            disciplinary_actions: [
                {
                    id: 'd1',
                    employee_id: ANA.id,
                    type: 'suspensao',
                    reason: 'Falta grave',
                    description: 'Reincidência',
                    suspension_days: 3,
                    occurred_at: '2026-06-01',
                    acknowledged_at: '2026-06-02T10:00:00Z',
                    created_at: '2026-06-01',
                },
                {
                    id: 'd2',
                    employee_id: ANA.id,
                    type: 'suspensao',
                    reason: 'Atraso',
                    description: null,
                    suspension_days: 1,
                    occurred_at: '2026-05-01',
                    acknowledged_at: null,
                    created_at: '2026-05-01',
                },
                {
                    id: 'd3',
                    employee_id: ANA.id,
                    type: 'advertencia_verbal',
                    reason: 'Conversa',
                    description: null,
                    suspension_days: null,
                    occurred_at: '2026-04-01',
                    acknowledged_at: null,
                    created_at: '2026-04-01',
                },
            ],
            medical_leaves: [
                {
                    id: 'm1',
                    employee_id: ANA.id,
                    start_date: '2026-06-01',
                    end_date: '2026-06-02',
                    days: 2,
                    doctor_name: 'Rosa',
                    cid: 'J11',
                    status: 'aprovado',
                },
            ],
            pdi_goals: [{ id: 'g1', employee_id: ANA.id, title: 'Sem prazo', status: 'pendente', due_date: null, created_at: '2026-06-01' }],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenDisciplinary();
        const disc = page.text('#disciplinary-list');
        assert.match(disc, /3 dias · Reincidência/);
        assert.match(disc, /Ciente em 02\/06\/2026/);
        assert.match(disc, /1 dia(?!s)/);
        await page.window.handleOpenMedicalLeaves();
        assert.match(page.text('#medical-leaves-list'), /Dr\(a\)\. Rosa · CID J11/);
        await page.window.handleOpenPerformance();
        assert.doesNotMatch(page.text('#performance-goals-list'), /prazo \d/);
    });
});

describe('colaboradores.html — etapas do formulário, máscaras e CEP', () => {
    test('na segunda etapa o botão vira "Voltar" e volta uma etapa', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.toggleForm();
        page.window.handleNextStep();
        assert.equal(page.text('#btn-prev-step'), 'Voltar');
        page.window.handleCancelOrBack();
        assert.equal(page.text('#btn-prev-step'), 'Cancelar');
        assert.equal(page.$('#form-container').classList.contains('hidden'), false);
        page.window.handleCancelOrBack();
        assert.equal(page.$('#form-container').classList.contains('hidden'), true);
    });

    test('máscaras cortam o excesso e formatam por tamanho', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        const val = async (sel, v) => {
            await page.fill(sel, v);
            return page.$(sel).value;
        };
        assert.equal(await val('#cpf', '529982247251234'), '529.982.247-25');
        assert.equal(await val('#telefone', ''), '');
        assert.equal(await val('#telefone', '11'), '(11');
        assert.equal(await val('#telefone', '11987'), '(11) 987');
        assert.equal(await val('#telefone', '119876543210000'), '(11) 98765-4321');
        assert.equal(await val('#conta', '12345'), '12345');
        assert.equal(await val('#conta', '123456789'), '12345-67');
        assert.equal(await val('#cep', '0131010099'), '01310-100');
        assert.equal(await val('#pis-pasep', '123'), '123');
        assert.equal(await val('#pis-pasep', '12345678'), '123.45678');
        assert.equal(await val('#pis-pasep', '1234567890'), '123.45678.90');
        assert.equal(await val('#pis-pasep', '123456789012345'), '123.45678.90-1');
    });

    test('CEP com campos faltando preenche o que veio e deixa o resto vazio', async () => {
        const respostas = [{ bairro: 'Centro' }];
        page = await openPage('colaboradores', { client: client(), now: NOW, fetch: async () => new Response(JSON.stringify(respostas.shift())) });
        page.$('#logradouro').value = 'antigo';
        await page.window.pesquisacep('01310-100');
        assert.deepEqual(
            ['#logradouro', '#bairro', '#cidade', '#uf'].map((s) => page.$(s).value),
            ['', 'Centro', '', '']
        );
        respostas.push({ uf: 'SP' });
        await page.window.pesquisacep('01310-100');
        assert.equal(page.$('#bairro').value, '');
        assert.equal(page.$('#uf').value, 'SP');
    });
});
