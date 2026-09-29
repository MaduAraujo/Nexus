const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { MANAGER_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function gestorClient({ roster, extra = {}, errors = {}, leaves = [] } = {}) {
    return new FakeSupabase({
        user: MANAGER_USER,
        tables: baseTables({
            team_roster: roster || [
                {
                    id: ANA.id,
                    name: 'Ana  Souza',
                    role: null,
                    dept: null,
                    status: null,
                    avatar_url: 'https://storage.test/ana.jpg',
                    contract_type: 'clt',
                    work_load: '40h',
                    manager_id: BIA.id,
                },
                { id: CAIO.id, name: 'Caio Reis', role: 'Dev', dept: 'TI', status: 'Afastado', contract_type: 'clt', work_load: '40h', manager_id: BIA.id },
            ],
            time_records: [],
            bank_adjustments: [{ employee_id: CAIO.id, tipo: 'debito', minutos: 30, date: '2026-06-10', deleted_at: null }],
            vacations: [],
            performance_reviews: [],
            performance_review_competencies: [],
            pdi_goals: [],
            trainings: [],
            employee_trainings: [],
            disciplinary_actions: [],
            hr_tickets: [],
            hr_ticket_messages: [],
            ...extra,
        }),
        rpc: { medical_leaves_team: leaves },
        errors,
    });
}

describe('equipe-colaborador.html — bordas', () => {
    test('cartões: foto, sem cargo/setor/situação, situação desconhecida, saldo zerado e negativo', async () => {
        page = await openPage('equipe-colaborador', { client: gestorClient(), now: NOW });
        const [ana, caio] = page.$$('.team-card');
        assert.equal(ana.querySelector('.team-card-avatar').getAttribute('data-bg-img'), 'https://storage.test/ana.jpg');
        assert.equal(ana.querySelector('.team-card-avatar').textContent, '');
        assert.match(ana.querySelector('.team-card-meta').textContent, /— · —/);
        assert.equal(ana.querySelector('.team-card-badge').textContent, 'Ativo');
        assert.equal(ana.querySelector('.team-card-saldo').className.trim(), 'team-card-saldo');
        assert.ok(caio.querySelector('.team-card-badge').classList.contains('team-card-badge--ativo'));
        assert.match(caio.querySelector('.team-card-saldo').textContent, /^-0h 30min/);
    });

    test('falhas ao ler equipe, ponto, ajustes e férias não quebram a tela', async () => {
        page = await openPage('equipe-colaborador', { client: gestorClient({ errors: { team_roster: { message: 'x' } } }), now: NOW });
        assert.equal(page.visible('#section-not-manager'), true);
        page.close();
        page = await openPage('equipe-colaborador', {
            client: gestorClient({ errors: { time_records: { message: 'a' }, bank_adjustments: { message: 'b' }, vacations: { message: 'c' } } }),
            now: NOW,
        });
        assert.equal(page.$$('.team-card').length, 2);
        assert.match(page.text('#pending-wrap'), /Nenhuma solicitação pendente/);
    });

    test('pedido com abono e colaborador sem setor', async () => {
        page = await openPage('equipe-colaborador', {
            client: gestorClient({
                extra: {
                    vacations: [
                        {
                            id: 'v1',
                            employee_id: ANA.id,
                            start_date: '2026-08-03',
                            end_date: '2026-08-12',
                            days: 10,
                            abono: true,
                            status: 'pendente',
                            created_at: '2026-06-01',
                        },
                    ],
                },
            }),
            now: NOW,
        });
        assert.match(page.text('#pending-list'), /Ana Souza \(—\).*10 dias · Abono pecuniário/);
    });

    test('ações sem colaborador escolhido não fazem nada; clicar fora das estrelas não muda a nota', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        page.eval('openReviewFormModal()');
        assert.equal(page.$('#modal-performance-review-form').classList.contains('open'), false);
        page.$('#pdi-goal-title').value = 'Meta';
        await page.eval('addPdiGoal()');
        await page.eval('assignTraining()');
        assert.equal(c.writes('pdi_goals', 'insert').length, 0);
        assert.equal(c.writes('employee_trainings', 'insert').length, 0);

        await page.click('.team-card-evaluate');
        await page.click('[data-click="openReviewFormModal"]');
        await page.click('#rating-overall');
        assert.equal(page.$('#rating-overall').dataset.rating, '0');
    });

    test('rascunho sem nota geral grava a nota vazia e avisa "Rascunho salvo"', async () => {
        const c = gestorClient();
        page = await openPage('equipe-colaborador', { client: c, now: NOW });
        await page.click('.team-card-evaluate');
        await page.click('[data-click="openReviewFormModal"]');
        await page.fill('#review-cycle', '2026.2');
        await page.click('[data-click="submitReview"][data-click-args*="rascunho"]');
        const [ins] = c.writes('performance_reviews', 'insert');
        assert.equal(ins.payload[0].overall_rating, null);
        assert.equal(ins.payload[0].completed_at, null);
        assert.ok(page.toasts().includes('Rascunho salvo.'));
    });

    test('falhas ao ler avaliações, metas, catálogo, treinos, medidas e atestados mostram vazio', async () => {
        page = await openPage('equipe-colaborador', {
            client: gestorClient({
                errors: {
                    performance_reviews: { message: 'a' },
                    pdi_goals: { message: 'b' },
                    trainings: { message: 'c' },
                    employee_trainings: { message: 'd' },
                    disciplinary_actions: { message: 'e' },
                    'rpc:medical_leaves_team': { message: 'f' },
                },
            }),
            now: NOW,
        });
        await page.click('.team-card-evaluate');
        assert.match(page.text('#performance-reviews-list'), /Nenhuma avaliação/);
        assert.match(page.text('#performance-goals-list'), /Nenhuma meta/);
        await page.click('.team-card-trainings');
        assert.match(page.text('#trainings-list'), /Nenhum treinamento/);
        assert.equal(page.$$('#tr-assign-catalog-popover .select-option').length, 0);
        await page.click('.team-card-disciplinary');
        assert.match(page.text('#disciplinary-list'), /Nenhuma medida/);
        await page.click('.team-card-medical');
        assert.match(page.text('#medical-leaves-list'), /Nenhum atestado/);
    });

    test('medidas: tipo desconhecido, 1 dia de suspensão, descrição e ciência; atestado de 1 dia com situação desconhecida', async () => {
        page = await openPage('equipe-colaborador', {
            client: gestorClient({
                extra: {
                    disciplinary_actions: [
                        {
                            id: 'd1',
                            employee_id: ANA.id,
                            type: 'outra',
                            reason: 'A',
                            description: 'Detalhe',
                            suspension_days: 1,
                            occurred_at: '2026-05-10',
                            acknowledged_at: '2026-05-11T10:00:00Z',
                        },
                        { id: 'd2', employee_id: ANA.id, type: 'suspensao', reason: 'B', suspension_days: 3, occurred_at: '2026-05-01', acknowledged_at: null },
                        {
                            id: 'd3',
                            employee_id: ANA.id,
                            type: 'advertencia_verbal',
                            reason: 'C',
                            suspension_days: null,
                            occurred_at: '2026-04-01',
                            acknowledged_at: null,
                        },
                    ],
                },
                leaves: [{ employee_id: ANA.id, start_date: '2026-05-04', end_date: '2026-05-04', days: 1, status: 'em_analise' }],
            }),
            now: NOW,
        });
        await page.click('.team-card-disciplinary');
        const texto = page.text('#disciplinary-list');
        assert.match(texto, /A 10\/05\/2026 · 1 dia · Detalhe outra Ciente em 11\/05\/2026/);
        assert.match(texto, /B 01\/05\/2026 · 3 dias Suspensão Aguardando ciência/);
        assert.match(texto, /C 01\/04\/2026 Advertência Verbal/);
        await page.click('.team-card-medical');
        assert.match(page.text('#medical-leaves-list'), /04\/05\/2026 → 04\/05\/2026 1 dia em_analise/);
    });
});
