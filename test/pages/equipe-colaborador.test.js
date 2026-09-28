const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, MANAGER_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function gestorClient(extra = {}) {
    return new FakeSupabase({
        user: MANAGER_USER,
        tables: baseTables({
            team_roster: [
                { id: ANA.id, name: ANA.name, role: ANA.role, dept: ANA.dept, status: 'Ativo', contract_type: 'clt', work_load: '40h', manager_id: BIA.id },
            ],
            time_records: [
                {
                    employee_id: ANA.id,
                    date: '2026-06-15',
                    entrada: '2026-06-15T08:00:00-03:00',
                    saida_almoco: '2026-06-15T12:00:00-03:00',
                    retorno_almoco: '2026-06-15T13:00:00-03:00',
                    saida: '2026-06-15T18:30:00-03:00',
                },
            ],
            bank_adjustments: [],
            vacations: [
                {
                    id: 'v1',
                    employee_id: ANA.id,
                    start_date: '2026-08-03',
                    end_date: '2026-08-17',
                    days: 15,
                    status: 'pendente',
                    obs: 'Viagem',
                    created_at: '2026-06-01',
                },
            ],
            performance_reviews: [{ id: 'r1', employee_id: ANA.id, cycle: '2026.1', status: 'rascunho', created_at: '2026-06-01' }],
            performance_review_competencies: [],
            pdi_goals: [],
            trainings: [{ id: 'c1', title: 'LGPD Básico', category: 'Compliance', duration_hours: 4, active: true }],
            employee_trainings: [
                {
                    id: 'et1',
                    employee_id: ANA.id,
                    title: 'Power BI',
                    source: 'autodeclarado',
                    status: 'aguardando_aprovacao',
                    certificate_url: 'data:text/html,x',
                    created_at: '2026-06-02',
                },
            ],
            disciplinary_actions: [
                { id: 'd1', employee_id: ANA.id, type: 'suspensao', reason: 'Faltas', suspension_days: 2, occurred_at: '2026-05-10', acknowledged_at: null },
            ],
            hr_tickets: [],
            hr_ticket_messages: [],
            ...extra,
        }),
        rpc: { medical_leaves_team: [{ employee_id: ANA.id, start_date: '2026-05-04', end_date: '2026-05-05', days: 2, status: 'aprovado' }] },
    });
}

describe('equipe-colaborador.html', () => {
    test('quem não é gestor vê o aviso e não a equipe', async () => {
        page = await openPage('equipe-colaborador', { client: new FakeSupabase({ user: COLAB_USER, tables: baseTables({ team_roster: [] }) }), now: NOW });
        assert.equal(page.visible('#section-not-manager'), true);
        assert.equal(page.visible('#team-content'), false);
    });

    test('mostra a equipe com saldo do mês e as férias pendentes', async () => {
        page = await openPage('equipe-colaborador', { client: gestorClient(), now: NOW });
        assert.match(page.text('#team-grid'), /Ana Souza.*Analista · Financeiro.*\+1h 30min \(mês\)/);
        assert.equal(page.text('#pending-count-label'), '1 pendente');
        assert.match(page.text('#pending-list'), /03\/08\/2026 → 17\/08\/2026 · 15 dias.*Viagem/);
    });

    test('aprovar férias grava a decisão com o nome do gestor', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('[data-click="approveVacation"]');
        const v = c.tables.vacations[0];
        assert.deepEqual([v.status, v.decided_by_name], ['aprovado', 'Bia Lima']);
        assert.match(page.text('#pending-wrap'), /Nenhuma solicitação pendente/);
    });

    test('recusar exige motivo', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('[data-click="openRejectModal"]');
        await page.click('[data-click="confirmRejectVacation"]');
        assert.equal(page.text('#err-reject-reason'), 'Informe o motivo da recusa.');
        await page.fill('#reject-reason-text', 'Pico de fechamento');
        await page.click('[data-click="confirmRejectVacation"]');
        assert.deepEqual([c.tables.vacations[0].status, c.tables.vacations[0].rejection_reason], ['recusado', 'Pico de fechamento']);
    });

    test('escalar ao RH cria o chamado e a primeira mensagem', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-escalate');
        assert.equal(page.text('#escalate-employee-name'), 'Ana Souza');
        await page.fill('#escalate-message-text', 'Queda de rendimento nas últimas semanas');
        await page.click('[data-click="confirmEscalateToRh"]');
        const ticket = c.writes('hr_tickets', 'insert')[0].payload[0];
        assert.deepEqual([ticket.about_employee_id, ticket.subject, ticket.status], [ANA.id, 'Sobre Ana Souza', 'aguardando_rh']);
        assert.equal(c.writes('hr_ticket_messages', 'insert')[0].payload[0].content, 'Queda de rendimento nas últimas semanas');
    });

    test('avaliação de desempenho: concluir rascunho, nova avaliação com estrelas e meta de PDI', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-evaluate');
        assert.equal(page.text('#performance-emp-name'), 'Ana Souza');
        await page.click('[data-click="completeReview"]');
        assert.equal(c.tables.performance_reviews[0].status, 'concluida');

        await page.click('[data-click="openReviewFormModal"]');
        await page.click('[data-click="submitReview"]');
        assert.match(page.text('#err-review-cycle'), /Informe o ciclo/);
        await page.fill('#review-cycle', '2026.2');
        await page.click('#rating-overall .rating-star[data-value="4"]');
        await page.click('#rating-comp-0 .rating-star[data-value="5"]');
        await page.click('[data-click="submitReview"][data-click-args*="concluida"]');
        const review = c.writes('performance_reviews', 'insert')[0].payload[0];
        assert.deepEqual([review.cycle, review.overall_rating, review.status, review.evaluator_name], ['2026.2', 4, 'concluida', 'Bia Lima']);
        assert.deepEqual(c.writes('performance_review_competencies', 'insert')[0].payload, [
            { review_id: c.tables.performance_reviews[1].id, competency: 'Qualidade do trabalho', rating: 5 },
        ]);

        await page.fill('#pdi-goal-title', 'Liderar o fechamento de julho');
        await page.click('[data-click="addPdiGoal"]');
        assert.equal(c.writes('pdi_goals', 'insert')[0].payload[0].title, 'Liderar o fechamento de julho');
    });

    test('treinamentos: link não-http não vira link; aprovar autodeclarado e atribuir do catálogo', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-trainings');
        assert.equal(page.$('#trainings-list a[href^="data:"]'), null);
        await page.click('[data-click="approveTraining"]');
        assert.deepEqual([c.tables.employee_trainings[0].status, c.tables.employee_trainings[0].completion_date], ['concluido', '2026-06-17']);

        await page.click('#tr-assign-catalog-trigger');
        await page.click('#tr-assign-catalog-popover .select-option[data-value="c1"]');
        await page.click('[data-click="assignTraining"]');
        const t = c.writes('employee_trainings', 'insert')[0].payload[0];
        assert.deepEqual([t.title, t.training_id, t.hours, t.assigned_by_name], ['LGPD Básico', 'c1', 4, 'Bia Lima']);
    });

    test('medidas disciplinares e atestados da equipe', async () => {
        page = await openPage('equipe-colaborador', { client: gestorClient(), now: NOW });
        await page.click('.team-card-disciplinary');
        assert.match(page.text('#disciplinary-list'), /Faltas 10\/05\/2026 · 2 dias Suspensão Aguardando ciência/);
        await page.click('.team-card-medical');
        assert.match(page.text('#medical-leaves-list'), /04\/05\/2026 → 05\/05\/2026 2 dias Aprovado/);
    });
});

describe('equipe-colaborador.html — erros, estados vazios e controles', () => {
    const aberto = (id) => page.$(`#${id}`).classList.contains('open');

    test('gestor sem ninguém na equipe não consulta férias; PJ mostra "PJ" em vez de saldo', async () => {
        const c = gestorClient({ team_roster: [] });
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        assert.equal(c.calls.filter((x) => x.table === 'vacations').length, 0);
        page.close();

        const pj = gestorClient({
            team_roster: [
                { id: ANA.id, name: ANA.name, role: ANA.role, dept: ANA.dept, status: 'Ativo', contract_type: 'pj', work_load: '', manager_id: BIA.id },
            ],
        });
        page = await openPage('equipe-colaborador', { client: pj, now: NOW });
        assert.match(page.text('#team-grid .team-card-saldo'), /^PJ$/);
    });

    test('falha ao aprovar ou recusar férias avisa e mantém o pedido na lista', async () => {
        const c = gestorClient();
        c.errors['vacations:update'] = { message: 'RLS' };
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('[data-click="approveVacation"]');
        assert.ok(page.toasts().includes('Não foi possível aprovar. Tente novamente.'));
        await page.click('[data-click="openRejectModal"]');
        await page.fill('#reject-reason-text', 'Pico');
        await page.click('[data-click="confirmRejectVacation"]');
        assert.ok(page.toasts().includes('Não foi possível recusar. Tente novamente.'));
        assert.equal(c.tables.vacations[0].status, 'pendente');
        assert.equal(page.text('#pending-count-label'), '1 pendente');
    });

    test('escalar ao RH: mensagem vazia é recusada; falha ao criar o chamado não grava mensagem', async () => {
        const c = gestorClient();
        c.errors['hr_tickets:insert'] = { message: 'RLS' };
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-escalate');
        await page.click('[data-click="confirmEscalateToRh"]');
        assert.equal(page.text('#err-escalate-message'), 'Descreva o que você quer levar ao RH.');
        await page.fill('#escalate-message-text', 'Situação delicada');
        await page.click('[data-click="confirmEscalateToRh"]');
        assert.ok(page.toasts().includes('Não foi possível enviar. Tente novamente.'));
        assert.equal(c.writes('hr_ticket_messages', 'insert').length, 0);
    });

    test('avaliação: sem registros mostra vazio; falhas ao concluir, salvar e criar meta avisam', async () => {
        const c = gestorClient({ performance_reviews: [] });
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-evaluate');
        assert.match(page.text('#performance-reviews-list'), /Nenhuma avaliação registrada ainda/);
        await page.click('[data-click="closePerformanceModal"]');
        assert.equal(aberto('modal-performance'), false);
        page.close();

        const e = gestorClient();
        e.errors['performance_reviews:update'] = { message: 'RLS' };
        e.errors['performance_reviews:insert'] = { message: 'RLS' };
        e.errors['pdi_goals:insert'] = { message: 'RLS' };
        page = await openPage('equipe-colaborador', { client: e, now: NOW });
        await page.click('.team-card-evaluate');
        await page.click('[data-click="completeReview"]');
        assert.ok(page.toasts().includes('Não foi possível concluir a avaliação.'));
        assert.equal(e.tables.performance_reviews[0].status, 'rascunho');

        await page.click('[data-click="openReviewFormModal"]');
        await page.fill('#review-cycle', '2026.2');
        await page.click('#rating-overall .rating-star[data-value="3"]');
        await page.click('[data-click="submitReview"][data-click-args*="concluida"]');
        assert.ok(page.toasts().includes('Não foi possível salvar a avaliação.'));
        assert.equal(e.writes('performance_review_competencies', 'insert').length, 0);

        await page.fill('#pdi-goal-title', 'Meta');
        await page.click('[data-click="addPdiGoal"]');
        assert.ok(page.toasts().includes('Não foi possível criar a meta.'));
        assert.equal(page.$('#pdi-goal-title').value, 'Meta', 'o texto digitado não se perde');
    });

    test('prazo da meta de PDI: calendário abre no mês atual, vira o ano, escolhe o dia e grava', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-evaluate');
        const pop = page.$('#pdi-goal-due-popover');
        await page.click('#pdi-goal-due-trigger');
        assert.equal(pop.classList.contains('open'), true);
        assert.equal(page.text('#pdi-goal-due-title'), 'Junho 2026');
        assert.equal(page.text('#pdi-goal-due-grid .calendar-day--today'), '17');

        for (let i = 0; i < 6; i++) await page.click('#pdi-goal-due-prev');
        assert.equal(page.text('#pdi-goal-due-title'), 'Dezembro 2025');
        for (let i = 0; i < 8; i++) await page.click('#pdi-goal-due-next');
        assert.equal(page.text('#pdi-goal-due-title'), 'Agosto 2026');
        assert.equal(pop.classList.contains('open'), true, 'navegar não fecha');

        await page.click(page.$('#pdi-goal-due-grid .calendar-day--muted'));
        assert.equal(pop.classList.contains('open'), true, 'dia de outro mês não é escolhível');
        await page.click('#pdi-goal-due-grid [data-iso="2026-08-31"]');
        assert.equal(pop.classList.contains('open'), false);
        assert.equal(page.text('#pdi-goal-due-text'), '31/08/2026');

        await page.click('#pdi-goal-due-trigger');
        assert.equal(page.text('#pdi-goal-due-title'), 'Agosto 2026', 'reabre no mês escolhido');
        await page.click('#pdi-goal-due-trigger');
        assert.equal(pop.classList.contains('open'), false);
        await page.click('#pdi-goal-due-trigger');
        await page.key(page.document, 'a');
        assert.equal(pop.classList.contains('open'), true);
        await page.key(page.document, 'Escape');
        assert.equal(pop.classList.contains('open'), false);
        await page.click('#pdi-goal-due-trigger');
        await page.click('#pdi-goal-title');
        assert.equal(pop.classList.contains('open'), false, 'clique fora fecha');

        await page.fill('#pdi-goal-title', 'Certificação');
        await page.click('[data-click="addPdiGoal"]');
        assert.equal(c.writes('pdi_goals', 'insert')[0].payload[0].due_date, '2026-08-31');
        assert.equal(page.text('#pdi-goal-due-text'), 'Prazo', 'limpa depois de criar');
    });

    test('treinamentos: sem registros mostra vazio; título obrigatório; digitado com carga horária; concluir e recusar', async () => {
        const c = gestorClient({
            employee_trainings: [
                { id: 'et2', employee_id: ANA.id, title: 'Excel', status: 'pendente', category: 'TI', provider: 'Escola', hours: 8, created_at: '2026-06-01' },
                {
                    id: 'et3',
                    employee_id: ANA.id,
                    title: 'Oratória',
                    status: 'aguardando_aprovacao',
                    source: 'autodeclarado',
                    certificate_url: 'https://cert.exemplo.com/1',
                    created_at: '2026-06-03',
                },
            ],
        });
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-trainings');
        assert.match(page.text('#trainings-list'), /Excel.*TI · Escola · 8h/);
        assert.ok(page.$('#trainings-list a[href="https://cert.exemplo.com/1"]'));

        await page.click('[data-click="completeTraining"]');
        assert.deepEqual([c.tables.employee_trainings[0].status, c.tables.employee_trainings[0].completion_date], ['concluido', '2026-06-17']);
        await page.click('[data-click="rejectTraining"]');
        assert.equal(c.tables.employee_trainings[1].status, 'recusado');
        assert.ok(page.toasts().includes('Treinamento recusado.'));

        await page.click('[data-click="assignTraining"]');
        assert.ok(page.toasts().includes('Escolha um treinamento do catálogo ou digite o nome.'));
        await page.fill('#tr-assign-title', 'Primeiros socorros');
        await page.fill('#tr-assign-hours', '2,5');
        await page.click('[data-click="assignTraining"]');
        const t = c.writes('employee_trainings', 'insert')[0].payload[0];
        assert.deepEqual([t.title, t.training_id, t.hours, t.category], ['Primeiros socorros', null, 2.5, null]);
        assert.equal(page.$('#tr-assign-title').value, '');

        await page.click('[data-click="closeTrainingsModal"]');
        assert.equal(aberto('modal-trainings'), false);
        page.close();

        page = await openPage('equipe-colaborador', { client: gestorClient({ employee_trainings: [] }), now: NOW });
        await page.click('.team-card-trainings');
        assert.match(page.text('#trainings-list'), /Nenhum treinamento registrado ainda/);
        await page.window.assignTraining();
    });

    test('treinamentos: falhas ao atribuir, aprovar, recusar e concluir avisam', async () => {
        const c = gestorClient({
            employee_trainings: [
                { id: 'et1', employee_id: ANA.id, title: 'Power BI', source: 'autodeclarado', status: 'aguardando_aprovacao', created_at: '2026-06-02' },
                { id: 'et2', employee_id: ANA.id, title: 'Excel', status: 'em_andamento', created_at: '2026-06-01' },
            ],
        });
        c.errors['employee_trainings:insert'] = { message: 'RLS' };
        c.errors['employee_trainings:update'] = { message: 'RLS' };
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-trainings');
        await page.fill('#tr-assign-title', 'X');
        await page.click('[data-click="assignTraining"]');
        await page.click('[data-click="approveTraining"]');
        await page.click('[data-click="rejectTraining"]');
        await page.click('[data-click="completeTraining"]');
        for (const msg of [
            'Não foi possível atribuir o treinamento.',
            'Não foi possível aprovar o treinamento.',
            'Não foi possível recusar o treinamento.',
            'Não foi possível concluir o treinamento.',
        ]) {
            assert.ok(page.toasts().includes(msg), msg);
        }
        assert.equal(page.$('#tr-assign-title').value, 'X');
    });

    test('seletor do catálogo: abre, fecha com clique fora ou Esc, e clique fora das opções não escolhe', async () => {
        page = await openPage('equipe-colaborador', { client: gestorClient(), now: NOW });
        await page.click('.team-card-trainings');
        const pop = page.$('#tr-assign-catalog-popover');
        await page.click('#tr-assign-catalog-trigger');
        assert.equal(pop.classList.contains('open'), true);
        await page.click(pop);
        assert.equal(pop.classList.contains('open'), true);
        assert.equal(page.$('#tr-assign-catalog').value, '');
        await page.click('#tr-assign-catalog-trigger');
        assert.equal(pop.classList.contains('open'), false);
        await page.click('#tr-assign-catalog-trigger');
        await page.click('#tr-assign-title');
        assert.equal(pop.classList.contains('open'), false);
        await page.click('#tr-assign-catalog-trigger');
        await page.key(page.document, 'Enter');
        assert.equal(pop.classList.contains('open'), true);
        await page.key(page.document, 'Escape');
        assert.equal(pop.classList.contains('open'), false);

        await page.click('#tr-assign-catalog-trigger');
        await page.click('#tr-assign-catalog-popover .select-option[data-value="c1"]');
        assert.equal(page.text('#tr-assign-catalog-label'), 'LGPD Básico');
    });

    test('medidas disciplinares e atestados: estados vazios e fechar os modais', async () => {
        const c = gestorClient({ disciplinary_actions: [] });
        c.handlers.rpc.medical_leaves_team = [];
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-disciplinary');
        assert.match(page.text('#disciplinary-list'), /Nenhuma medida disciplinar registrada/);
        await page.click('[data-click="closeDisciplinaryModal"]');
        assert.equal(aberto('modal-disciplinary'), false);
        await page.click('.team-card-medical');
        assert.match(page.text('#medical-leaves-list'), /Nenhum atestado registrado ainda/);
        await page.click('[data-click="closeMedicalLeavesModal"]');
        assert.equal(aberto('modal-medical-leaves'), false);
    });

    test('tempo real: férias novas e mudança na equipe aparecem sem recarregar', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        c.tables.vacations.push({
            id: 'v2',
            employee_id: ANA.id,
            start_date: '2026-09-01',
            end_date: '2026-09-10',
            days: 10,
            status: 'pendente',
            created_at: '2026-06-17',
        });
        c.emit('vacations', { new: { id: 'v2' } });
        await page.settle(20);
        assert.equal(page.text('#pending-count-label'), '2 pendentes');

        c.tables.team_roster.push({
            id: 'emp-caio',
            name: 'Caio Reis',
            role: 'Dev',
            dept: 'TI',
            status: 'Ativo',
            contract_type: 'clt',
            work_load: '40h',
            manager_id: BIA.id,
        });
        c.emit('employees', { new: { id: 'emp-caio', manager_id: BIA.id } });
        await page.settle(20);
        assert.match(page.text('#team-grid'), /Caio Reis/);
    });

    test('último liderado transferido com a tela aberta: férias pendentes dele somem', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        assert.equal(page.text('#pending-count-label'), '1 pendente');
        c.tables.team_roster.length = 0;
        c.emit('employees', { new: { id: ANA.id, manager_id: null } });
        await page.settle(20);
        const consultas = c.calls.filter((x) => x.table === 'vacations').length;
        c.emit('vacations', { new: { id: 'v1' } });
        await page.settle(20);
        assert.equal(c.calls.filter((x) => x.table === 'vacations').length, consultas, 'sem equipe não consulta férias');
        assert.match(page.text('#pending-wrap'), /Nenhuma solicitação pendente/);
    });

    test('o aviso some sozinho depois de alguns segundos', async () => {
        page = await openPage('equipe-colaborador', { client: gestorClient(), now: NOW });
        const w = page.window;
        const original = w.setTimeout;
        w.setTimeout = (fn, ms, ...a) => (ms >= 400 ? (fn(...a), 0) : original(fn, ms, ...a));
        await page.click('.team-card-trainings');
        await page.click('[data-click="assignTraining"]');
        w.setTimeout = original;
        assert.deepEqual(page.toasts(), []);
    });
});
