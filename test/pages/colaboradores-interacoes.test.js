const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const CPF_VALIDO = '529.982.247-25';

function client(extra = {}, empOverrides = {}) {
    const emps = [
        { ...ANA, created_at: '2024-02-01', ...(empOverrides[ANA.id] || {}) },
        { ...BIA, created_at: '2022-05-10', ...(empOverrides[BIA.id] || {}) },
        { ...CAIO, created_at: '2025-01-15', ...(empOverrides[CAIO.id] || {}) },
    ];
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            employees: emps,
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
            ...extra,
        }),
        rpc: { job_titles_public: [{ title: 'Analista' }], anonymize_employee: {} },
        views: { employees_decrypted: 'employees', employee_audit_decrypted: 'employee_audit', ai_decision_log_decrypted: 'ai_decision_log' },
    });
}

const rowFor = (p, name) => p.$$('#employee-list-body tr').find((tr) => tr.textContent.includes(name));
const toastCom = (p, re) => p.toasts().some((t) => re.test(t));

describe('colaboradores.html — lista: carga, busca, filtros e exportação', () => {
    test('erro ao carregar colaboradores deixa a lista vazia sem quebrar a tela', async () => {
        const c = client();
        c.errors['employees:select'] = { message: 'RLS' };
        page = await openPage('colaboradores', { client: c, now: NOW });
        assert.equal(page.$$('#employee-list-body tr .row-checkbox').length, 0);
        assert.equal(page.text('#kpi-total'), '0');
    });

    test('busca sem resultado avisa depois de uma pausa; nova busca cancela o aviso', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        await page.fill('#search-input', 'zzz');
        assert.ok(!toastCom(page, /Colaborador Não Encontrado/), 'não avisa enquanto digita');
        await page.waitFor(() => toastCom(page, /Nenhum resultado para "zzz"/), { timeout: 2000 });
        await page.fill('#search-input', 'yyy');
        await page.fill('#search-input', '');
        await new Promise((r) => setTimeout(r, 700));
        assert.ok(!toastCom(page, /"yyy"/), 'apagar a busca cancela o aviso pendente');
    });

    test('menu de filtro: abre e fecha, departamento filtra e fecha o menu; abrir fecha a exportação', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        const aberto = (id) => page.$(id).classList.contains('open');
        await page.click('#btn-export');
        assert.ok(aberto('#export-menu'));
        await page.click('#btn-filter-trigger');
        assert.ok(aberto('#filter-menu'));
        assert.ok(!aberto('#export-menu'));
        await page.click('#btn-export');
        assert.ok(!aberto('#filter-menu'), 'abrir a exportação fecha o filtro');
        await page.click('#btn-export');
        assert.ok(!aberto('#export-menu'));

        await page.click('#btn-filter-trigger');
        await page.click('#dept-filter-list .btn-filter-dept[data-dept="TI"]');
        assert.ok(!aberto('#filter-menu'));
        assert.equal(page.$$('#employee-list-body tr .row-checkbox').length, 1);
        assert.ok(rowFor(page, 'Caio Prado'));
        await page.click('#btn-filter-trigger');
        await page.click('#btn-filter-trigger');
        assert.ok(!aberto('#filter-menu'));
    });

    test('exportar: pelo menu gera planilha e PDF; lista vazia, sem biblioteca e pop-up bloqueado avisam', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        await page.click('#btn-export');
        await page.click('#export-csv-btn');
        assert.ok(!page.$('#export-menu').classList.contains('open'));
        assert.ok(page.saved.some((n) => /^colaboradores_2026-06-17\.xlsx$/.test(n)));
        await page.click('#btn-export');
        await page.click('#export-pdf-btn');
        assert.match(page.opened.at(-1).text(), /3 colaboradores/);

        const xlsx = page.window.XLSX;
        page.window.XLSX = undefined;
        await page.click('#export-csv-btn');
        assert.ok(toastCom(page, /Biblioteca Excel não carregada/));
        await page.click('[data-click="downloadImportTemplate"]');
        assert.equal(page.toasts().filter((t) => /Biblioteca Excel não carregada/.test(t)).length, 2);
        page.window.XLSX = xlsx;

        page.window.open = () => null;
        await page.click('#export-pdf-btn');
        assert.ok(toastCom(page, /Permita pop-ups para exportar o PDF/));

        await page.fill('#search-input', 'ninguém');
        await page.click('#export-csv-btn');
        await page.click('#export-pdf-btn');
        assert.equal(page.toasts().filter((t) => /Nada para Exportar/.test(t)).length, 2);
    });

    test('seleção: desmarcar uma linha e "selecionar todos" desmarcando tiram da seleção', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        await page.check(rowFor(page, 'Ana Souza').querySelector('.row-checkbox'));
        await page.check(rowFor(page, 'Bia Lima').querySelector('.row-checkbox'));
        await page.check(rowFor(page, 'Ana Souza').querySelector('.row-checkbox'), false);
        assert.equal(page.text('#bulk-selected-count'), '1');
        const all = page.$('#select-all-checkbox');
        all.checked = true;
        page.window.toggleSelectAll(all);
        all.checked = false;
        page.window.toggleSelectAll(all);
        await page.settle();
        assert.equal(page.visible('#bulk-actions-bar'), false);
    });

    test('tempo real: colaborador novo e documento vencendo atualizam lista, KPIs e alertas', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        c.tables.employees.push({ ...ANA, id: 'emp-duda', name: 'Duda Reis', cpf: CPF_VALIDO, email: 'duda@empresa.com', created_at: '2026-06-17' });
        c.emit('employees', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => rowFor(page, 'Duda Reis'));
        assert.equal(page.text('#kpi-total'), '4');

        c.tables.documents.push({ id: 'd1', employee_id: ANA.id, name: 'ASO', tipo: 'Exame', data_validade: '2026-07-10', deleted_at: null });
        c.tables.documents.push({ id: 'd2', employee_id: BIA.id, name: 'CNH', tipo: 'CNH', data_validade: '2026-12-31', deleted_at: null });
        c.emit('documents', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => page.text('#alert-count-documento') === '1', { message: 'vence em 23 dias conta; em 197 dias não' });
    });

    test('erro ao buscar documentos com validade não mostra alerta de documento', async () => {
        const c = client({ documents: [{ id: 'd1', employee_id: ANA.id, name: 'ASO', data_validade: '2026-06-01', deleted_at: null }] });
        c.errors['documents:select'] = { message: 'falhou' };
        page = await openPage('colaboradores', { client: c, now: NOW });
        assert.equal(page.text('#alert-count-documento'), '0');
    });

    test('foto do colaborador aparece na lista e no painel; experiência e aviso prévio aparecem no painel', async () => {
        const c = client(
            {},
            {
                [ANA.id]: { avatar_url: 'https://cdn.test/ana.png', is_probation: 'sim', probation_end_date: '2026-07-20' },
                [BIA.id]: { is_aviso_previo: 'sim', aviso_previo_end_date: '2026-06-25' },
            }
        );
        page = await openPage('colaboradores', { client: c, now: NOW });
        assert.equal(rowFor(page, 'Ana Souza').querySelector('img').getAttribute('src'), 'https://cdn.test/ana.png');
        page.window.openDrawer(ANA.id);
        assert.ok(!page.$('#drawer-avatar-img').classList.contains('hidden'));
        assert.ok(page.$('#drawer-avatar').classList.contains('hidden'));
        assert.equal(page.text('#view-probation'), 'Experiência vence em 33d');
        assert.equal(page.$('#view-probation').className, 'badge badge--ativo');
        assert.ok(page.$('#view-aviso-previo-wrap').classList.contains('hidden'));

        page.window.openDrawer(BIA.id);
        assert.ok(page.$('#drawer-avatar-img').classList.contains('hidden'));
        assert.equal(page.text('#view-aviso-previo'), 'Aviso prévio termina em 8d');
        assert.equal(page.$('#view-aviso-previo').className, 'badge badge--aviso-previo-warning');
    });

    test('link com ?emp= abre o painel do colaborador', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW, query: `?emp=${BIA.id}` });
        assert.ok(page.$('#employee-drawer').classList.contains('active'));
        assert.equal(page.text('#view-name'), 'Bia Lima');
    });
});

describe('colaboradores.html — importação: arquivo, arrastar e soltar e falhas', () => {
    const CAB = ['Nome', 'CPF', 'Email', 'Data de Admissão', 'Tipo de Contrato', 'Departamento', 'Jornada', 'Salário', 'Tipo de Salário'];
    const linha = (nome, cpf, email) => [nome, cpf, email, '01/06/2026', 'CLT', 'TI', '40h', '3000', 'Mensal'];

    test('planilha vazia, só cabeçalho, ou ilegível avisam', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW, xlsxRows: [] });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('vazia.xlsx', 'x', 'application/vnd.ms-excel')]);
        await page.settle(20);
        assert.ok(toastCom(page, /A planilha não contém dados/));

        page.close();
        page = await openPage('colaboradores', { client: client(), now: NOW, xlsxRows: [CAB, ['', '', '']] });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('cab.xlsx', 'x', 'application/vnd.ms-excel')]);
        await page.settle(20);
        assert.ok(toastCom(page, /Nenhum colaborador encontrado na planilha/));

        page.window.XLSX.read = () => {
            throw new Error('corrompido');
        };
        await page.setFiles('#import-file-input', [page.file('ruim.xlsx', 'x', 'application/vnd.ms-excel')]);
        await page.settle(20);
        assert.ok(toastCom(page, /Verifique se o arquivo é uma planilha válida/));
    });

    test('arrastar e soltar lê o arquivo; clicar na linha mostra os detalhes', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW, xlsxRows: [CAB, linha('Joana Lima', CPF_VALIDO, 'joana@empresa.com')] });
        page.window.openImportModal();
        const dz = page.$('#import-dropzone');
        dz.dispatchEvent(new page.window.Event('dragenter', { cancelable: true }));
        assert.ok(dz.classList.contains('dragover'));
        dz.dispatchEvent(new page.window.Event('dragleave', { cancelable: true }));
        assert.ok(!dz.classList.contains('dragover'));
        const drop = new page.window.Event('drop', { cancelable: true });
        drop.dataTransfer = { files: [page.file('equipe.xlsx', 'x', 'application/vnd.ms-excel')] };
        dz.dispatchEvent(drop);
        await page.settle(20);
        assert.match(page.text('#import-preview-body'), /Joana Lima/);
        const detalhe = page.$('#import-detail-0');
        assert.ok(detalhe.classList.contains('hidden'));
        await page.click('#import-preview-body tr.import-row');
        assert.ok(!detalhe.classList.contains('hidden'));

        const vazio = new page.window.Event('drop', { cancelable: true });
        vazio.dataTransfer = { files: [] };
        dz.dispatchEvent(vazio);
        await page.settle();
    });

    test('convite que falha não impede a importação; linha que o banco recusa conta como falha', async () => {
        const c = client();
        c.errors['employees:insert'] = (call) => (call.payload?.[0]?.name === 'Rui Alves' ? { message: 'violação' } : null);
        page = await openPage('colaboradores', {
            client: c,
            now: NOW,
            xlsxRows: [CAB, linha('Joana Lima', CPF_VALIDO, 'joana@empresa.com'), linha('Rui Alves', '111.444.777-35', 'rui@empresa.com')],
            fetch: async () => new Response(JSON.stringify({ error: 'SMTP fora do ar' }), { status: 500 }),
        });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('equipe.xlsx', 'x', 'application/vnd.ms-excel')]);
        await page.settle(20);
        await page.click('#btn-import-confirm');
        await page.waitFor(() => toastCom(page, /Importação Concluída/));
        assert.ok(toastCom(page, /1 colaborador importado, 1 com falha/));
        assert.ok(rowFor(page, 'Joana Lima'));
        assert.equal(c.writes('profiles', 'insert').length, 0, 'sem convite, sem perfil vinculado');
    });
});

describe('colaboradores.html — painel do colaborador: menu, histórico, LGPD e exclusão', () => {
    test('menu de opções abre posicionado, fecha com clique fora e com Esc (que fecha o painel)', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.openDrawer(ANA.id);
        await page.click('#btn-drawer-options');
        assert.ok(page.$('#drawer-dropdown').classList.contains('show'));
        assert.match(page.$('#drawer-dropdown').style.top, /px$/);
        await page.click('#btn-drawer-options');
        assert.ok(!page.$('#drawer-dropdown').classList.contains('show'));
        await page.click('#btn-drawer-options');
        await page.click('#view-name');
        assert.ok(!page.$('#drawer-dropdown').classList.contains('show'));
        await page.key('body', 'Escape');
        assert.ok(!page.$('#employee-drawer').classList.contains('active'));
    });

    test('editar pelo painel abre o formulário na aba de obrigatórios, com a aba marcada', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        await page.click('[data-click-args*="tab-completos"]');
        assert.ok(page.$('[data-click-args*="tab-completos"]').classList.contains('active'));
        page.window.toggleForm();
        page.window.openDrawer(ANA.id);
        await page.click('[data-click="handleEditFromDrawer"]');
        assert.ok(!page.$('#employee-drawer').classList.contains('active'));
        assert.equal(page.$('#name').value, 'Ana Souza');
        assert.ok(page.$('.tab-btn[data-click-args*="tab-obrigatorios"]').classList.contains('active'));
        assert.ok(!page.$('.tab-btn[data-click-args*="tab-completos"]').classList.contains('active'));
        assert.ok(page.$('#tab-obrigatorios').classList.contains('active'));
    });

    test('voltar com o formulário aberto fecha o formulário em vez de sair da tela', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.toggleForm();
        assert.equal(page.window.handleBackClick(), false);
        assert.ok(page.$('#form-container').classList.contains('hidden'));
        assert.equal(page.window.handleBackClick(), true);
    });

    test('histórico e registros LGPD com erro do banco mostram vazio', async () => {
        const c = client();
        c.errors['employee_audit:select'] = { message: 'x' };
        c.errors['data_access_log:select'] = { message: 'x' };
        c.errors['ai_decision_log:select'] = { message: 'x' };
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleShowHistory();
        assert.match(page.text('#audit-history-body'), /Nenhuma alteração registrada/);
        await page.click('[data-click="closeAuditHistoryModal"]');
        await page.window.handleShowLgpd();
        await page.settle();
        assert.match(page.text('#lgpd-access-log-body'), /Nenhum acesso registrado/);
    });

    test('anonimização recusada pelo banco mostra o motivo e mantém o painel', async () => {
        const c = client({}, { [CAIO.id]: { status: 'Inativo' } });
        c.errors['rpc:anonymize_employee'] = { message: 'Há holerite em guarda legal.' };
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: true });
        page.window.openDrawer(CAIO.id);
        await page.window.confirmAnonymizeEmployee();
        assert.ok(toastCom(page, /Erro ao anonimizar.*Há holerite em guarda legal/));
        assert.ok(page.$('#employee-drawer').classList.contains('active'));
    });

    test('excluir pelo painel remove da lista e fecha o painel', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: true });
        page.window.openDrawer(CAIO.id);
        await page.click('[data-click="handleDeleteEmployee"]');
        assert.equal(rowFor(page, 'Caio Prado'), undefined);
        assert.ok(!page.$('#employee-drawer').classList.contains('active'));
        assert.equal(page.text('#kpi-total'), '2');
    });
});

describe('colaboradores.html — organograma e tarefas de integração', () => {
    test('filtro de departamento do organograma, clique no cartão abre o colaborador, Esc fecha', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        await page.click('[data-click="openOrgChart"]');
        const aberto = () => page.$('#orgchart-dept-filter-popover').classList.contains('open');
        await page.click('#orgchart-dept-filter-trigger');
        assert.ok(aberto());
        await page.click('#orgchart-dept-filter-trigger');
        assert.ok(!aberto());
        await page.click('#orgchart-dept-filter-trigger');
        await page.click('#orgchart-container');
        assert.ok(!aberto());
        await page.click('#orgchart-dept-filter-trigger');
        await page.key('#orgchart-dept-filter-trigger', 'Escape');
        assert.ok(!aberto());
        await page.click('#orgchart-dept-filter-trigger');
        page.$('#orgchart-dept-filter-popover').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.ok(aberto(), 'clique fora das opções não escolhe nada');
        await page.click('#orgchart-dept-filter-popover .select-option[data-value="TI"]');
        assert.equal(page.text('#orgchart-container'), 'Caio Prado Desenvolvedor PJ TI');

        await page.click('#orgchart-container .org-card');
        assert.ok(!page.$('#orgchart-modal').classList.contains('open'));
        assert.equal(page.text('#view-name'), 'Caio Prado');

        await page.click('[data-click="openOrgChart"]');
        await page.key('body', 'Escape');
        assert.ok(!page.$('#orgchart-modal').classList.contains('open'));
    });

    test('tarefas de integração: erro ao carregar, ao adicionar e ao remover avisam; fechar', async () => {
        const c = client({ onboarding_tasks: [{ id: 't1', titulo: 'Crachá', dias: 30, ordem: 1 }] });
        c.errors['onboarding_tasks:select'] = { message: 'x' };
        page = await openPage('colaboradores', { client: c, now: NOW });
        await page.window.openOnboardingTasksModal();
        assert.match(page.text('#onb-tasks-30'), /Nenhuma tarefa cadastrada/);
        delete c.errors['onboarding_tasks:select'];
        await page.window.openOnboardingTasksModal();
        assert.match(page.text('#onb-tasks-30'), /Crachá/);

        c.errors['onboarding_tasks:insert'] = { message: 'x' };
        page.$('#onb-add-title-60').value = 'Almoço com a equipe';
        await page.click('[data-click="addOnboardingTask"][data-click-args="[60]"]');
        assert.ok(toastCom(page, /Não foi possível adicionar a tarefa/));
        c.errors['onboarding_tasks:delete'] = { message: 'x' };
        await page.click('#onb-tasks-30 [data-click="removeOnboardingTask"]');
        assert.ok(toastCom(page, /Não foi possível remover a tarefa/));
        assert.match(page.text('#onb-tasks-30'), /Crachá/);

        await page.click('[data-click="closeOnboardingTasksModal"]');
        assert.ok(!page.$('#onboarding-tasks-modal').classList.contains('open'));
    });
});

describe('colaboradores.html — formulário: calendário, anexos, campos condicionais e máscaras', () => {
    test('calendário da admissão: abre pelo campo, pelo ícone e pelo teclado; navega anos; escolhe o dia', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.toggleForm();
        const input = page.$('#admission-date');
        const field = input.closest('.date-field');
        const pop = field.querySelector('.calendar-popover');
        const aberto = () => pop.classList.contains('open');

        await page.click(input);
        assert.ok(aberto());
        assert.equal(page.text(field.querySelector('[data-cal-title]')), 'Junho 2026');
        assert.ok(field.querySelector('.calendar-day--today'));
        for (let i = 0; i < 6; i++) await page.click(field.querySelector('[data-cal-prev]'));
        assert.equal(page.text(field.querySelector('[data-cal-title]')), 'Dezembro 2025');
        for (let i = 0; i < 13; i++) await page.click(field.querySelector('[data-cal-next]'));
        assert.equal(page.text(field.querySelector('[data-cal-title]')), 'Janeiro 2027');
        await page.click(field.querySelector('.calendar-day--muted') || field.querySelector('[data-cal-grid]'));
        assert.ok(aberto(), 'dia de outro mês não escolhe');
        await page.click(field.querySelector('.calendar-day[data-iso="2027-01-04"]'));
        assert.ok(!aberto());
        assert.equal(input.value, '04/01/2027');
        assert.equal(input.dataset.value, '2027-01-04');

        await page.key(input, 'Enter');
        assert.ok(aberto());
        assert.equal(page.text(field.querySelector('[data-cal-title]')), 'Janeiro 2027', 'reabre no mês escolhido');
        assert.ok(field.querySelector('.calendar-day--selected'));
        await page.key(input, ' ');
        assert.ok(!aberto());
        await page.key(input, 'a');
        assert.ok(!aberto());
        await page.click(field.querySelector('.date-field-icon'));
        assert.ok(aberto());
        await page.click(field.querySelector('.date-field-icon'));
        assert.ok(!aberto());
        await page.click(input);
        await page.click('#name');
        assert.ok(!aberto(), 'clique fora fecha');
    });

    test('anexos de admissão: escolher o tipo pelo modal, trocar o tipo na lista e a lista acompanha o contrato', async () => {
        const c = client({
            document_requirements: [
                { tipo: 'RG', category: 'admissional', contract_type: null, obrigatorio: true },
                { tipo: 'Termo de Estágio', category: 'admissional', contract_type: 'Estágio', obrigatorio: true },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.toggleForm();
        let clicou = 0;
        page.$('#reg-doc-input').click = () => clicou++;
        await page.click('[data-click="openRegDocModal"]');
        assert.ok(page.$('#reg-doc-modal').classList.contains('open'));
        assert.deepEqual(
            page.$$('#reg-doc-type-list .reg-doc-type-name').map((e) => e.textContent),
            ['RG', 'Outros']
        );
        assert.match(page.$('#reg-doc-type-list .reg-doc-type-item').innerHTML, /fa-id-card/);
        await page.click('#reg-doc-type-list [data-click-args*="RG"]');
        assert.equal(clicou, 1);
        assert.ok(!page.$('#reg-doc-modal').classList.contains('open'));
        await page.setFiles('#reg-doc-input', [page.file('rg.pdf', 'rg')]);
        assert.equal(page.$('#reg-doc-list .reg-doc-item-tipo').value, 'RG');

        const sel = page.$('#reg-doc-list .reg-doc-item-tipo');
        sel.value = 'Outros';
        sel.dispatchEvent(new page.window.Event('change', { bubbles: true }));
        await page.click('[data-click="openRegDocModal"]');
        assert.ok(!page.$('#reg-doc-type-list [data-click-args*="RG"]').classList.contains('reg-doc-type-item--attached'));
        assert.ok(page.$('#reg-doc-type-list [data-click-args*="Outros"]').classList.contains('reg-doc-type-item--attached'));
        await page.click('[data-click="closeRegDocModal"]');

        const contrato = page.$('#contract-type');
        contrato.value = 'Estágio';
        contrato.dispatchEvent(new page.window.Event('change', { bubbles: true }));
        await page.click('[data-click="openRegDocModal"]');
        assert.deepEqual(
            page.$$('#reg-doc-type-list .reg-doc-type-name').map((e) => e.textContent),
            ['Termo de Estágio', 'Outros'],
            'cada contrato tem a sua lista (Lei 11.788/2008 para estágio)'
        );
        assert.match(page.$('#reg-doc-type-list [data-click-args*="Termo de Estágio"]').innerHTML, /fa-file-lines/);
    });

    test('erro ao buscar a exigência de documentos usa a lista padrão', async () => {
        const c = client();
        c.errors['document_requirements:select'] = { message: 'x' };
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.toggleForm();
        await page.click('[data-click="openRegDocModal"]');
        assert.equal(page.$$('#reg-doc-type-list .reg-doc-type-name').length, 7);
    });

    test('campos condicionais: "não" esconde e limpa; opção marcada desmarca no segundo clique; forma de pagamento; banco "outro"', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.toggleForm();
        const sim = page.$('input[name="seguro-vida"][value="sim"]');
        const nao = page.$('input[name="seguro-vida"][value="nao"]');
        await page.check(sim);
        assert.equal(page.$('#seguro-vida-details').style.display, 'block');
        page.$('#seguradora').value = 'Porto';
        await page.check(nao);
        assert.equal(page.$('#seguro-vida-details').style.display, 'none');
        assert.equal(page.$('#seguradora').value, '', 'esconder limpa o que foi digitado');

        sim.dispatchEvent(new page.window.MouseEvent('mousedown', { bubbles: true }));
        sim.checked = true;
        sim.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        sim.dispatchEvent(new page.window.MouseEvent('mousedown', { bubbles: true }));
        sim.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        await page.settle();
        assert.equal(sim.checked, false, 'segundo clique desmarca');
        assert.equal(page.$('#seguro-vida-details').style.display, 'none');

        const pix = page.$('input[name="forma-pagamento"][value="pix"]');
        await page.check(pix);
        assert.equal(page.$('#pix-details').style.display, 'block');
        pix.dispatchEvent(new page.window.MouseEvent('mousedown', { bubbles: true }));
        pix.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        await page.settle();
        assert.equal(page.$('#pix-details').style.display, 'none');
        assert.equal(page.$('#conta-details').style.display, 'none');

        await page.check(page.$('input[name="forma-pagamento"][value="conta"]'));
        const banco = page.$('#banco');
        banco.value = 'outro';
        banco.dispatchEvent(new page.window.Event('change', { bubbles: true }));
        assert.equal(page.$('#banco-outro-details').style.display, 'block');
        page.$('#banco-outro').value = 'Banco Local';
        banco.value = banco.querySelector('option[value]:not([value=""]):not([value="outro"])').value;
        banco.dispatchEvent(new page.window.Event('change', { bubbles: true }));
        assert.equal(page.$('#banco-outro-details').style.display, 'none');
        assert.equal(page.$('#banco-outro').value, '');
    });

    test('máscaras: RG curto e médio; salário e vale apagados ficam vazios', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.toggleForm();
        await page.fill('#rg', '123');
        assert.equal(page.$('#rg').value, '12.3');
        await page.fill('#rg', '1234567');
        assert.equal(page.$('#rg').value, '12.345.67');
        await page.fill('#salary', 'abc');
        assert.equal(page.$('#salary').value, '');
        await page.fill('#ben-vale-refeicao', 'x');
        assert.equal(page.$('#ben-vale-refeicao').value, '');
    });

    test('cadastro com campo obrigatório vazio ou CPF de outro colaborador é barrado', async () => {
        const c = client({}, { [ANA.id]: { cpf: CPF_VALIDO }, [BIA.id]: { salary_type: 'Mensal Fixo' } });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.toggleForm();
        await page.submit('#employee-form');
        assert.ok(toastCom(page, /Preencha todos os campos obrigatórios/));

        page.window.editEmployee(BIA.id);
        page.$('#cpf').value = CPF_VALIDO;
        await page.submit('#employee-form');
        assert.ok(toastCom(page, /Já existe um colaborador com este CPF/));
        assert.equal(c.writes('employees', 'update').length, 0);
    });
});

describe('colaboradores.html — promoção, catálogos e registros do colaborador: erros e validações', () => {
    test('promoção sem mudança de cargo/contrato é recusada; erro do banco reabilita o botão; só contrato muda', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: true });
        page.window.openDrawer(ANA.id);
        page.window.handlePromoteEmployee();
        await page.window.submitPromotion();
        assert.ok(toastCom(page, /pelo menos cargo ou tipo de contrato precisa mudar/));

        page.$('#promote-contract-type').value = 'PJ';
        c.errors['employees:update'] = { message: 'x' };
        await page.window.submitPromotion();
        assert.ok(toastCom(page, /Não foi possível registrar a promoção/));
        assert.equal(page.$('#btn-promote-submit').disabled, false);

        delete c.errors['employees:update'];
        await page.window.submitPromotion();
        assert.ok(toastCom(page, /Ana Souza agora está em PJ\./));
        page.eval(`currentEmployeeId = 'ninguem'`);
        page.window.updatePromoteBtnState();
        assert.equal(page.$('#btn-promote-submit').disabled, true);
    });

    test('catálogo de cargos: erro ao ativar/desativar e ao excluir avisam', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: true });
        c.errors['job_titles:update'] = { message: 'x' };
        c.errors['job_titles:delete'] = { message: 'x' };
        await page.window.toggleJobTitleActive('jt1', true);
        assert.ok(toastCom(page, /Não foi possível atualizar o cargo/));
        await page.window.deleteJobTitle('jt1');
        assert.ok(toastCom(page, /Não foi possível excluir o cargo/));
        assert.equal(c.tables.job_titles.length, 1);
    });

    test('catálogo de treinamentos: nome obrigatório, repetido, erros; fechar limpa os campos', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: true });
        await page.window.openTrainingsCatalogModal();
        await page.click('[data-click="addTrainingCatalog"]');
        assert.ok(toastCom(page, /Informe o nome do treinamento/));
        page.$('#tc-add-title').value = 'LGPD';
        c.errors['trainings:insert'] = { code: '23505', message: 'dup' };
        await page.click('[data-click="addTrainingCatalog"]');
        assert.ok(toastCom(page, /Já existe um treinamento com esse nome/));
        c.errors['trainings:insert'] = { code: 'XX', message: 'x' };
        await page.click('[data-click="addTrainingCatalog"]');
        assert.ok(toastCom(page, /Não foi possível adicionar o treinamento/));
        c.errors['trainings:update'] = { message: 'x' };
        await page.click('#trainings-catalog-list [data-click="toggleTrainingCatalogActive"]');
        assert.ok(toastCom(page, /Não foi possível atualizar o treinamento/));
        c.errors['trainings:delete'] = { message: 'x' };
        await page.click('#trainings-catalog-list [data-click="deleteTrainingCatalog"]');
        assert.ok(toastCom(page, /Não foi possível excluir o treinamento/));
        await page.click('[data-click="closeTrainingsCatalogModal"]');
        assert.equal(page.$('#tc-add-title').value, '');
        assert.ok(!page.$('#trainings-catalog-modal').classList.contains('open'));
    });

    test('treinamentos do colaborador: sem nome, erro ao atribuir/recusar/concluir, certificado e fechar', async () => {
        const c = client({
            employee_trainings: [
                {
                    id: 'et1',
                    employee_id: ANA.id,
                    title: 'Excel',
                    status: 'aguardando_aprovacao',
                    source: 'autodeclarado',
                    certificate_path: 'emp-ana/cert.pdf',
                    created_at: '2026-06-01',
                },
                { id: 'et2', employee_id: ANA.id, title: 'NR-10', status: 'pendente', created_at: '2026-06-02' },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        const abertos = [];
        page.window.NexusFiles.open = async (bucket, path) => {
            abertos.push([bucket, path]);
            return { error: abertos.length > 1 ? { message: 'x' } : null };
        };
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenTrainings();
        await page.click('[data-click="assignTraining"]');
        assert.ok(toastCom(page, /Escolha um treinamento do catálogo ou digite o nome/));
        page.$('#tr-assign-title').value = 'Word';
        c.errors['employee_trainings:insert'] = { message: 'x' };
        await page.click('[data-click="assignTraining"]');
        assert.ok(toastCom(page, /Não foi possível atribuir o treinamento/));

        c.errors['employee_trainings:update'] = { message: 'x' };
        await page.click('#trainings-list [data-click="rejectTraining"]');
        assert.ok(toastCom(page, /Não foi possível recusar o treinamento/));
        await page.click('#trainings-list [data-click="completeTraining"]');
        assert.ok(toastCom(page, /Não foi possível concluir o treinamento/));

        await page.click('#trainings-list [data-click="viewTrainingCertificate"]');
        assert.deepEqual(abertos[0], ['documents', 'emp-ana/cert.pdf']);
        await page.click('#trainings-list [data-click="viewTrainingCertificate"]');
        const erro = page.$$('.toast').at(-1);
        assert.ok(erro.classList.contains('toast-error'), 'falha aparece como erro, não como sucesso');
        assert.match(erro.textContent, /Não foi possível abrir o certificado/);
        await page.window.viewTrainingCertificate('et2');
        assert.equal(abertos.length, 2, 'treinamento sem certificado não abre nada');

        await page.click('[data-click="closeTrainingsModal"]');
        assert.ok(!page.$('#trainings-modal').classList.contains('open'));
    });

    test('medida disciplinar: tipo e motivo obrigatórios, erro do banco, tipo suspensão mostra os dias; fechar', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenDisciplinary();
        await page.click('[data-click="addDisciplinaryAction"]');
        assert.ok(toastCom(page, /Selecione o tipo da medida disciplinar/));
        await page.click('#da-type-trigger');
        await page.click('#da-type-popover .select-option[data-value="suspensao"]');
        assert.ok(!page.$('#da-suspension-days').classList.contains('hidden'));
        await page.click('#da-type-trigger');
        await page.click('#da-type-popover .select-option[data-value="advertencia_escrita"]');
        assert.ok(page.$('#da-suspension-days').classList.contains('hidden'));
        await page.click('[data-click="addDisciplinaryAction"]');
        assert.ok(toastCom(page, /Informe o motivo/));
        page.$('#da-reason').value = 'Atrasos';
        c.errors['disciplinary_actions:insert'] = { message: 'x' };
        await page.click('[data-click="addDisciplinaryAction"]');
        assert.ok(toastCom(page, /Não foi possível registrar a medida disciplinar/));
        await page.click('[data-click="closeDisciplinaryModal"]');
        assert.ok(!page.$('#disciplinary-modal').classList.contains('open'));
    });

    test('atestados: lista vazia, anexo abre e falha avisa, erros ao aprovar e recusar; fechar', async () => {
        const c = client({
            medical_leaves: [
                {
                    id: 'm1',
                    employee_id: BIA.id,
                    start_date: '2026-06-01',
                    end_date: '2026-06-01',
                    days: 1,
                    status: 'pendente',
                    storage_path: 'emp-bia/at.pdf',
                },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenMedicalLeaves();
        assert.match(page.text('#medical-leaves-list'), /Nenhum atestado enviado ainda/);

        let falhar = false;
        const abertos = [];
        page.window.NexusFiles.open = async (bucket, path) => {
            abertos.push([bucket, path]);
            return { error: falhar ? { message: 'x' } : null };
        };
        page.window.openDrawer(BIA.id);
        await page.window.handleOpenMedicalLeaves();
        await page.click('#medical-leaves-list [data-click="viewLeaveAttachment"]');
        assert.deepEqual(abertos[0], ['documents', 'emp-bia/at.pdf']);
        falhar = true;
        await page.click('#medical-leaves-list [data-click="viewLeaveAttachment"]');
        assert.ok(toastCom(page, /Não foi possível abrir o atestado/));

        c.errors['medical_leaves:update'] = { message: 'x' };
        await page.click('#medical-leaves-list [data-click="approveLeave"]');
        assert.ok(toastCom(page, /Não foi possível aprovar o atestado/));
        await page.click('#medical-leaves-list [data-click="openRejectLeaveRow"]');
        page.$('#ml-reject-reason').value = 'Ilegível';
        await page.click('[data-click="confirmRejectLeave"]');
        assert.ok(toastCom(page, /Não foi possível recusar o atestado/));
        assert.equal(c.tables.medical_leaves[0].status, 'pendente');
        await page.click('[data-click="closeMedicalLeavesModal"]');
        assert.ok(!page.$('#medical-leaves-modal').classList.contains('open'));
    });
});

describe('colaboradores.html — avisos', () => {
    test('aviso some sozinho depois de 4 segundos', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        const agendados = [];
        page.window.setTimeout = (fn, ms) => agendados.push([fn, ms]);
        page.window.filterByAlert('experiencia');
        page.eval(`showToast('Teste', '', 'info')`);
        const toast = page.$$('.toast').at(-1);
        assert.equal(toast.querySelector('.toast-msg'), null, 'sem mensagem não cria o parágrafo');
        agendados.find(([, ms]) => ms === 4000)[0]();
        assert.ok(toast.classList.contains('hide'));
        agendados.find(([, ms]) => ms === 400)[0]();
        assert.ok(!toast.isConnected);
    });
});

describe('colaboradores.html — tipo de contrato, jornada e tipo de salário vindos da planilha', () => {
    const CAB = ['Nome', 'CPF', 'Email', 'Data de Admissão', 'Tipo de Contrato', 'Departamento', 'Jornada', 'Salário', 'Tipo de Salário'];

    test('variações de escrita viram a opção do sistema; valor desconhecido é apontado', async () => {
        const c = client();
        page = await openPage('colaboradores', {
            client: c,
            now: NOW,
            xlsxRows: [
                CAB,
                ['Joana Lima', CPF_VALIDO, 'joana@empresa.com', '01/06/2026', 'estagio', 'TI', '30', 'R$ 1.500,00', 'mensal'],
                ['Rui Alves', '111.444.777-35', 'rui@empresa.com', '01/06/2026', 'freela', 'TI', '50h', '3000', 'semanal'],
            ],
            fetch: async () => new Response('{}', { status: 200 }),
        });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('equipe.xlsx', 'x', 'application/vnd.ms-excel')]);
        await page.settle(20);
        const erros = page.text('#import-detail-1');
        assert.match(erros, /Tipo de contrato inválido/);
        assert.match(erros, /Jornada inválida/);
        assert.match(erros, /Tipo de salário inválido/);
        await page.click('#btn-import-confirm');
        await page.waitFor(() => c.writes('employees', 'insert').length);
        const ins = c.writes('employees', 'insert')[0].payload[0];
        assert.deepEqual([ins.contract_type, ins.work_load, ins.salary_type], ['Estágio', '30h', 'Mensal Fixo']);
    });

    test('editar colaborador antigo gravado como "clt" mostra CLT e deixa salvar', async () => {
        const c = client({}, { [BIA.id]: { salary_type: 'mensal fixo', work_load: '44 h' } });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(BIA.id);
        assert.deepEqual([page.$('#contract-type').value, page.$('#salary-type').value, page.$('#work-load').value], ['CLT', 'Mensal Fixo', '44h']);
        await page.submit('#employee-form');
        await page.waitFor(() => c.writes('employees', 'update').length);
        assert.equal(c.writes('employees', 'update')[0].payload.contract_type, 'CLT');
    });
});

describe('colaboradores.html — atalhos e caminhos restantes', () => {
    test('clicar na linha abre o painel; botões de salvar enviam o formulário; sair do CEP busca o endereço', async () => {
        const buscas = [];
        page = await openPage('colaboradores', {
            client: client(),
            now: NOW,
            fetch: async (url) => {
                buscas.push(url);
                return new Response(JSON.stringify({ logradouro: 'Rua A', bairro: 'Centro', localidade: 'Recife', uf: 'PE' }), { status: 200 });
            },
        });
        await page.click(rowFor(page, 'Bia Lima').querySelector('td:nth-child(2)'));
        assert.equal(page.text('#view-name'), 'Bia Lima');
        page.window.closeDrawer();

        page.window.toggleForm();
        await page.click('#btn-save-simple');
        await page.click('#btn-save');
        assert.equal(page.toasts().filter((t) => /Preencha todos os campos obrigatórios/.test(t)).length, 2);

        page.$('#cep').value = '50000-000';
        page.$('#cep').dispatchEvent(new page.window.Event('blur'));
        await page.waitFor(() => page.$('#cidade').value === 'Recife');
        assert.match(buscas[0], /viacep\.com\.br\/ws\/50000000\/json/);
    });

    test('convite com resposta que não é JSON avisa com a mensagem padrão', async () => {
        const c = client();
        page = await openPage('colaboradores', {
            client: c,
            now: NOW,
            fetch: async () => new Response('<html>erro</html>', { status: 502 }),
        });
        page.window.toggleForm();
        page.$('#name').value = 'Duda Reis';
        page.$('#cpf').value = CPF_VALIDO;
        page.$('#email').value = 'duda@empresa.com';
        page.eval(`setDateFieldValue(document.getElementById('admission-date'), '2026-06-01')`);
        page.$('#admission-date').value = '01/06/2026';
        page.$('#contract-type').value = 'CLT';
        page.$('#dept').value = 'TI';
        page.$('#work-load').value = '40h';
        page.$('#salary').value = 'R$ 3.000,00';
        page.$('#salary-type').value = 'Mensal Fixo';
        await page.submit('#employee-form');
        await page.waitFor(() => toastCom(page, /Colaborador Cadastrado/));
        assert.ok(toastCom(page, /e-mail de acesso não foi enviado: Erro ao enviar convite/));
    });

    test('promover coloca o foco no campo de cargo', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.openDrawer(ANA.id);
        page.window.handlePromoteEmployee();
        await page.waitFor(() => page.document.activeElement === page.$('#promote-role-trigger'), { timeout: 1000 });
    });

    test('data de admissão em formato aaaa/mm/dd na planilha é aceita', async () => {
        const c = client();
        page = await openPage('colaboradores', {
            client: c,
            now: NOW,
            xlsxRows: [
                ['Nome', 'CPF', 'Email', 'Data de Admissão', 'Tipo de Contrato', 'Departamento', 'Jornada', 'Salário', 'Tipo de Salário'],
                ['Joana Lima', CPF_VALIDO, 'joana@empresa.com', '2026/06/01', 'CLT', 'TI', '40h', '3000', 'Mensal Fixo'],
            ],
            fetch: async () => new Response('{}', { status: 200 }),
        });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('equipe.xlsx', 'x', 'application/vnd.ms-excel')]);
        await page.settle(20);
        await page.click('#btn-import-confirm');
        await page.waitFor(() => c.writes('employees', 'insert').length);
        assert.equal(c.writes('employees', 'insert')[0].payload[0].admission_date, '2026-06-01');
    });
});
