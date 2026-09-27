const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

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
            employee_audit_decrypted: [],
            vacations: [],
            documents: [],
            document_requirements: [],
            job_titles: [{ id: 'jt1', title: 'Analista', level: 'Júnior', active: true, salary_min: 3000, salary_max: 5000 }],
            trainings: [{ id: 'c1', title: 'LGPD', active: true, duration_hours: 4, category: 'Compliance' }],
            employee_trainings: [],
            data_access_log: [],
            onboarding_tasks: [],
            performance_reviews: [],
            pdi_goals: [],
            ...extra,
        }),
        rpc: { job_titles_public: [{ title: 'Analista' }] },
        views: { employees_decrypted: 'employees', employee_audit_decrypted: 'employee_audit' },
    });
}

const rowFor = (p, name) => p.$$('#employee-list-body tr').find((tr) => tr.textContent.includes(name));
const selecionar = async (p, name) => p.check(rowFor(p, name).querySelector('.row-checkbox'));

describe('colaboradores.html — ações em lote', () => {
    test('selecionar mostra a barra com a contagem; limpar esconde', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        assert.equal(page.visible('#bulk-actions-bar'), false);
        await selecionar(page, 'Ana Souza');
        await selecionar(page, 'Bia Lima');
        assert.equal(page.visible('#bulk-actions-bar'), true);
        assert.equal(page.text('#bulk-selected-count'), '2');
        await page.click('.btn-bulk-clear');
        assert.equal(page.visible('#bulk-actions-bar'), false);
    });

    test('"selecionar todos" marca a página inteira', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        const all = page.$('#select-all-checkbox');
        all.checked = true;
        page.window.toggleSelectAll(all);
        await page.settle();
        assert.equal(page.text('#bulk-selected-count'), '3');
        assert.ok(page.$$('.row-checkbox').every((cb) => cb.checked));
    });

    test('inativar em lote: data de desligamento só para quem não tem, recusa férias pendentes e audita cada um', async () => {
        const c = client(
            {
                vacations: [
                    { id: 'v1', employee_id: ANA.id, status: 'pendente' },
                    { id: 'v2', employee_id: CAIO.id, status: 'aprovado' },
                ],
            },
            { [BIA.id]: { termination_date: '2026-05-31' } }
        );
        page = await openPage('colaboradores', { client: c, now: '2026-06-17T22:30:00-03:00' });
        await selecionar(page, 'Ana Souza');
        await selecionar(page, 'Bia Lima');
        await page.window.bulkUpdateStatus('Inativo');
        await page.settle();

        assert.match(page.confirms.at(-1), /2 colaborador\(es\) para "Inativo"/);
        const byId = (id) => c.tables.employees.find((e) => e.id === id);
        assert.deepEqual([byId(ANA.id).status, byId(ANA.id).termination_date], ['Inativo', '2026-06-17'], 'data local, não UTC (22h30 em Brasília)');
        assert.deepEqual([byId(BIA.id).status, byId(BIA.id).termination_date], ['Inativo', '2026-05-31'], 'não sobrescreve a data que já existia');
        assert.equal(byId(CAIO.id).status, 'Ativo');
        assert.equal(c.tables.vacations.find((v) => v.id === 'v1').status, 'recusado');
        assert.equal(c.tables.vacations.find((v) => v.id === 'v2').status, 'aprovado');
        const audit = c.writes('employee_audit', 'insert')[0].payload;
        assert.deepEqual(audit.map((a) => [a.employee_id, a.changes[0].newValue]).sort(), [
            [ANA.id, 'Inativo'],
            [BIA.id, 'Inativo'],
        ]);
        assert.ok(page.toasts().some((t) => /2 colaborador\(es\) atualizado/.test(t)));
        assert.equal(page.visible('#bulk-actions-bar'), false, 'seleção limpa depois da ação');
    });

    test('lote para o mesmo status não grava nada; recusar a confirmação também não', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: false });
        await selecionar(page, 'Ana Souza');
        await page.window.bulkUpdateStatus('Ativo');
        assert.ok(page.toasts().some((t) => /já estão com este status/.test(t)));
        await page.window.bulkUpdateStatus('Férias');
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('erro do banco no lote: avisa e não audita', async () => {
        const c = client();
        c.errors['employees:update'] = { message: 'rls' };
        page = await openPage('colaboradores', { client: c, now: NOW });
        await selecionar(page, 'Ana Souza');
        await page.window.bulkUpdateStatus('Afastado');
        assert.ok(page.toasts().some((t) => /Não foi possível atualizar o status em lote/.test(t)));
        assert.equal(c.writes('employee_audit', 'insert').length, 0);
    });

    test('excluir em lote remove da lista; barrado pelo prazo legal, orienta a inativar', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        await selecionar(page, 'Caio Prado');
        await page.window.bulkDeleteEmployees();
        await page.settle();
        assert.equal(rowFor(page, 'Caio Prado'), undefined);
        assert.equal(page.text('#kpi-total'), '2');

        c.errors['employees:delete'] = { code: '23503', message: 'fk' };
        await selecionar(page, 'Ana Souza');
        await page.window.bulkDeleteEmployees();
        assert.ok(page.toasts().some((t) => /prazo legal de guarda/.test(t)));
        assert.ok(rowFor(page, 'Ana Souza'));
    });
});

describe('colaboradores.html — catálogo de cargos e treinamentos', () => {
    test('cargo: nome obrigatório, faixa invertida recusada, grava e atualiza a lista', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        await page.window.openJobTitlesModal();
        assert.match(page.text('#job-titles-list'), /Analista.*Júnior.*R\$\s?3\.000,00 a R\$\s?5\.000,00/);

        await page.window.addJobTitle();
        assert.ok(page.toasts().some((t) => /Informe o nome do cargo/.test(t)));

        page.$('#jt-add-title').value = 'Analista Sênior';
        await page.fill('#jt-add-salary-min', '800000');
        await page.fill('#jt-add-salary-max', '600000');
        assert.equal(page.$('#jt-add-salary-min').value, 'R$ 8.000,00', 'máscara de moeda');
        await page.window.addJobTitle();
        assert.ok(page.toasts().some((t) => /salário máximo precisa ser maior/.test(t)));

        await page.fill('#jt-add-salary-max', '1000000');
        page.$('#jt-add-level').value = 'Sênior';
        await page.window.addJobTitle();
        const ins = c.writes('job_titles', 'insert')[0].payload[0];
        assert.deepEqual([ins.title, ins.level, ins.salary_min, ins.salary_max], ['Analista Sênior', 'Sênior', 8000, 10000]);
        assert.match(page.text('#job-titles-list'), /Analista Sênior/);
        assert.equal(page.$('#jt-add-title').value, '', 'formulário limpo');
    });

    test('cargo com nome repetido explica o motivo; desativar marca como inativo', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        await page.window.openJobTitlesModal();
        c.errors['job_titles:insert'] = { code: '23505', message: 'dup' };
        page.$('#jt-add-title').value = 'Analista';
        await page.window.addJobTitle();
        assert.ok(page.toasts().some((t) => /Já existe um cargo com esse nome/.test(t)));

        await page.window.toggleJobTitleActive('jt1', true);
        assert.equal(c.tables.job_titles[0].active, false);
        assert.match(page.text('#job-titles-list'), /Inativo/);
        page.window.closeJobTitlesModal();
        assert.equal(page.$('#job-titles-modal').classList.contains('open'), false);
    });

    test('treinamento: carga horária aceita vírgula e recusa texto', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        await page.window.openTrainingsCatalogModal();
        assert.match(page.text('#trainings-catalog-list'), /LGPD.*Compliance.*4h/);
        page.$('#tc-add-title').value = 'Primeiros socorros';
        page.$('#tc-add-hours').value = 'muitas';
        await page.window.addTrainingCatalog();
        assert.ok(page.toasts().some((t) => /carga horária em número/.test(t)));
        page.$('#tc-add-hours').value = '2,5';
        page.$('#tc-add-provider').value = 'Cruz Vermelha';
        await page.window.addTrainingCatalog();
        const ins = c.writes('trainings', 'insert')[0].payload[0];
        assert.deepEqual([ins.title, ins.duration_hours, ins.provider], ['Primeiros socorros', 2.5, 'Cruz Vermelha']);

        await page.window.toggleTrainingCatalogActive('c1', true);
        assert.equal(c.tables.trainings.find((t) => t.id === 'c1').active, false);
    });
});

describe('colaboradores.html — histórico, treinamentos e desempenho do colaborador', () => {
    test('histórico de alterações mostra quem mudou o quê, com HTML escapado', async () => {
        const c = client({
            employee_audit: [
                {
                    id: 'a1',
                    employee_id: ANA.id,
                    created_at: '2026-06-10T14:00:00Z',
                    operator_name: 'rh',
                    changes: [{ label: 'Cargo', oldValue: 'Estagiária', newValue: '<img src=x onerror=alert(1)>' }],
                },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleShowHistory();
        assert.equal(page.$('#audit-history-modal').classList.contains('open'), true);
        assert.match(page.text('#audit-history-body'), /rh.*Cargo: Estagiária → <img src=x/);
        assert.equal(page.$('#audit-history-body img'), null, 'nada de HTML injetado');

        page.window.closeAuditHistoryModal();
        page.window.openDrawer(BIA.id);
        await page.window.handleShowHistory();
        assert.match(page.text('#audit-history-body'), /Nenhuma alteração registrada/);
    });

    test('curso autodeclarado: aprovar e recusar; atribuído: concluir com a data de hoje', async () => {
        const c = client({
            employee_trainings: [
                { id: 't1', employee_id: ANA.id, title: 'Excel', status: 'aguardando_aprovacao', created_at: '2026-06-01T00:00:00Z' },
                { id: 't2', employee_id: ANA.id, title: 'Power BI', status: 'aguardando_aprovacao', created_at: '2026-06-02T00:00:00Z' },
                { id: 't3', employee_id: ANA.id, title: 'LGPD', status: 'pendente', created_at: '2026-06-03T00:00:00Z' },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenTrainings();
        await page.window.approveTraining('t1');
        await page.window.rejectTraining('t2');
        await page.window.completeTraining('t3');
        const t = (id) => c.tables.employee_trainings.find((x) => x.id === id);
        assert.deepEqual([t('t1').status, t('t1').completion_date], ['concluido', '2026-06-17']);
        assert.equal(t('t2').status, 'recusado');
        assert.deepEqual([t('t3').status, t('t3').completion_date], ['concluido', '2026-06-17']);
        assert.ok(page.toasts().some((x) => /Treinamento Aprovado/.test(x)));
        assert.ok(page.toasts().some((x) => /Treinamento Recusado/.test(x)));
    });

    test('atribuir do catálogo usa título, categoria e carga horária do catálogo', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenTrainings();
        page.eval(`trAssignCatalogField.setValue('c1')`);
        await page.window.assignTraining();
        const ins = c.writes('employee_trainings', 'insert')[0].payload[0];
        assert.deepEqual([ins.title, ins.training_id, ins.category, ins.hours], ['LGPD', 'c1', 'Compliance', 4]);
    });

    test('erro ao aprovar treinamento não finge sucesso', async () => {
        const c = client({
            employee_trainings: [{ id: 't1', employee_id: ANA.id, title: 'Excel', status: 'aguardando_aprovacao', created_at: '2026-06-01T00:00:00Z' }],
        });
        c.errors['employee_trainings:update'] = { message: 'rls' };
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenTrainings();
        await page.window.approveTraining('t1');
        assert.ok(page.toasts().some((x) => /Não foi possível aprovar/.test(x)));
        assert.ok(!page.toasts().some((x) => /Treinamento Aprovado/.test(x)));
    });

    test('desempenho: lista avaliações com estrelas e metas do PDI; vazio tem mensagem própria', async () => {
        const c = client({
            performance_reviews: [
                { id: 'r1', employee_id: ANA.id, cycle: '2026.1', status: 'concluida', overall_rating: 4, created_at: '2026-06-01T12:00:00Z' },
                { id: 'r2', employee_id: ANA.id, cycle: '2026.2', status: 'rascunho', overall_rating: null, created_at: '2026-06-10T12:00:00Z' },
            ],
            pdi_goals: [
                { id: 'g1', employee_id: ANA.id, title: 'Curso de SQL', status: 'em_andamento', due_date: '2026-08-31', created_at: '2026-06-01T12:00:00Z' },
            ],
        });
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.openDrawer(ANA.id);
        await page.window.handleOpenPerformance();
        const reviews = page.text('#performance-reviews-list');
        assert.match(reviews, /2026\.1 ★★★★☆/);
        assert.match(reviews, /Concluída/);
        assert.match(reviews, /2026\.2 — .*Rascunho/);
        assert.match(page.text('#performance-goals-list'), /Curso de SQL Em andamento · prazo 31\/08\/2026/);

        page.window.closePerformanceModal();
        page.window.openDrawer(BIA.id);
        await page.window.handleOpenPerformance();
        assert.match(page.text('#performance-reviews-list'), /Nenhuma avaliação registrada/);
        assert.match(page.text('#performance-goals-list'), /Nenhuma meta/);
    });
});

describe('colaboradores.html — alertas da lista', () => {
    test('experiência vencendo, aniversário do mês e documento vencido aparecem no banner e filtram a lista', async () => {
        const c = client(
            { documents: [{ id: 'd1', employee_id: CAIO.id, name: 'ASO', tipo: 'ASO', data_validade: '2026-06-01' }] },
            {
                [ANA.id]: { is_probation: true, probation_end_date: '2026-06-25' },
                [BIA.id]: { birth_date: '1990-06-30' },
            }
        );
        page = await openPage('colaboradores', { client: c, now: NOW });
        assert.equal(page.visible('#alerts-banner'), true);
        assert.deepEqual(
            ['#alert-count-experiencia', '#alert-count-aniversario', '#alert-count-documento'].map((s) => page.text(s)),
            ['1', '1', '1']
        );
        page.window.filterByAlert('experiencia');
        await page.settle();
        assert.deepEqual(
            page.$$('#employee-list-body tr').map((tr) => /Ana Souza/.test(tr.textContent)),
            [true]
        );
        page.window.filterByAlert('documento');
        await page.settle();
        assert.ok(rowFor(page, 'Caio Prado'));
        assert.equal(page.$$('#employee-list-body tr').length, 1);
    });

    test('colaborador desligado não gera alerta de fim de experiência', async () => {
        const c = client({}, { [ANA.id]: { status: 'Inativo', is_probation: true, probation_end_date: '2026-03-01' } });
        page = await openPage('colaboradores', { client: c, now: NOW });
        assert.equal(page.text('#alert-count-experiencia'), '0');
        assert.equal(page.visible('#alerts-banner'), false);
    });
});
