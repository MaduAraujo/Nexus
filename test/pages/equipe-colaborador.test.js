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
