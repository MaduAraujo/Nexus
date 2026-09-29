const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

function client(extra = {}, opts = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({
            performance_reviews: [],
            performance_review_competencies: [],
            pdi_goals: [],
            employee_trainings: [],
            disciplinary_actions: [],
            medical_leaves: [],
            ...extra,
        }),
        rpc: { job_titles_public: [] },
        ...opts,
    });
}

describe('desempenho-colaborador.html — bordas', () => {
    test('trilha: sem cargo definido, empate de nível ordena pelo nome, cargo sem nível e cargos sem trilha', async () => {
        const c = client(
            {},
            {
                rpc: {
                    job_titles_public: [
                        { title: 'Beta', level: 'Pleno', track: 'TI' },
                        { title: 'Alfa', level: 'Pleno', track: 'TI' },
                        { title: 'Estagiário', level: null, track: '' },
                    ],
                },
            }
        );
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).role = null;
        page = await openPage('desempenho-colaborador', { client: c });
        assert.deepEqual(
            page.$$('.career-level-title').map((e) => e.textContent),
            ['Alfa', 'Beta', 'Estagiário']
        );
        assert.equal(page.$$('.career-track-name').length, 1);
        assert.equal(page.$$('.career-level-tag').length, 2);
        assert.equal(page.$('.career-level-row--current'), null);
    });

    test('falha ao ler avaliações, metas, cursos, medidas e atestados mostra os estados vazios', async () => {
        const c = client(
            {},
            {
                errors: {
                    performance_reviews: { message: 'a' },
                    pdi_goals: { message: 'b' },
                    employee_trainings: { message: 'c' },
                    disciplinary_actions: { message: 'd' },
                    medical_leaves: { message: 'e' },
                },
            }
        );
        page = await openPage('desempenho-colaborador', { client: c });
        assert.match(page.text('#reviews-list'), /Nenhuma avaliação/);
        assert.match(page.text('#goals-list'), /Nenhuma meta/);
        assert.match(page.text('#trainings-list'), /Nenhum treinamento/);
        assert.match(page.text('#disciplinary-list'), /Nenhuma medida/);
        assert.match(page.text('#medical-leaves-list'), /Nenhum atestado/);
    });

    test('avaliação sem nota, sem comentário, sem data de conclusão e sem competências', async () => {
        page = await openPage('desempenho-colaborador', {
            client: client({
                performance_reviews: [
                    {
                        id: 'r1',
                        employee_id: ANA.id,
                        cycle: '2026.1',
                        status: 'concluida',
                        overall_rating: null,
                        manager_comment: null,
                        created_at: '2026-03-10',
                        completed_at: null,
                    },
                ],
            }),
        });
        assert.match(page.text('#reviews-list'), /Concluída em 10\/03\/2026 —/);
        assert.match(page.text('#reviews-list'), /Sem competências detalhadas/);
        assert.equal(page.$('.review-comment'), null);
    });

    test('meta com situação desconhecida e descrição; curso sem detalhes e com situação desconhecida', async () => {
        page = await openPage('desempenho-colaborador', {
            client: client({
                pdi_goals: [{ id: 'g1', employee_id: ANA.id, title: 'Meta', description: 'Detalhe <b>', status: 'pausado', created_at: '2026-01-01' }],
                employee_trainings: [
                    { id: 't1', employee_id: ANA.id, title: 'Curso', hours: null, source: 'rh', status: 'suspenso', created_at: '2026-01-01' },
                ],
            }),
        });
        assert.match(page.text('#goals-list'), /Meta Detalhe <b> pausado/);
        assert.equal(page.$('.goal-advance-btn'), null);
        assert.match(page.text('#trainings-list'), /Curso — suspenso/);
    });

    test('medidas: tipo desconhecido, suspensão de 1 e de vários dias, descrição e data ausente', async () => {
        page = await openPage('desempenho-colaborador', {
            client: client({
                disciplinary_actions: [
                    {
                        id: 'd1',
                        employee_id: ANA.id,
                        type: 'suspensao',
                        reason: 'A',
                        description: 'Detalhe',
                        suspension_days: 1,
                        occurred_at: '2026-03-02',
                        acknowledged_at: null,
                    },
                    { id: 'd2', employee_id: ANA.id, type: 'suspensao', reason: 'B', suspension_days: 3, occurred_at: '2026-03-01', acknowledged_at: null },
                    { id: 'd3', employee_id: ANA.id, type: 'outra', reason: 'C', suspension_days: null, occurred_at: null, acknowledged_at: null },
                ],
            }),
        });
        const texto = page.text('#disciplinary-list');
        assert.match(texto, /A Detalhe 02\/03\/2026 · 1 dia Suspensão/);
        assert.match(texto, /B 01\/03\/2026 · 3 dias Suspensão/);
        assert.match(texto, /C — outra/);
    });

    test('atestado aprovado usa o selo de concluído', async () => {
        page = await openPage('desempenho-colaborador', {
            client: client({
                medical_leaves: [{ id: 'm1', employee_id: ANA.id, start_date: '2026-04-06', end_date: '2026-04-06', days: 1, status: 'aprovado' }],
            }),
        });
        assert.ok(page.$('#medical-leaves-list .goal-status-badge--concluido'));
        assert.match(page.text('#medical-leaves-list'), /1 dia Aprovado/);
    });

    test('anexo inválido que ficou no campo é recusado de novo ao enviar curso ou atestado', async () => {
        const c = client();
        page = await openPage('desempenho-colaborador', { client: c });
        await page.fill('#tr-self-title', 'Curso X');
        await page.setFiles('#tr-self-file', [page.file('x.exe', 'MZ', 'application/x-msdownload')]);
        page.eval('refreshSubmitButtons()');
        await page.click('#tr-self-submit');
        page.eval(
            `setDateFieldValue(document.getElementById('ml-start-date'), '2026-06-10'); setDateFieldValue(document.getElementById('ml-end-date'), '2026-06-11');`
        );
        await page.setFiles('#ml-file', [page.file('y.exe', 'MZ', 'application/x-msdownload')]);
        page.eval('refreshSubmitButtons()');
        await page.click('#ml-submit');
        assert.equal(c.writes('employee_trainings', 'insert').length, 0);
        assert.equal(c.writes('medical_leaves', 'insert').length, 0);
        assert.deepEqual(
            page.toasts().filter((t) => /em imagem/.test(t)),
            [
                'Envie o certificado em imagem (JPG, PNG, WEBP) ou PDF.',
                'Envie o certificado em imagem (JPG, PNG, WEBP) ou PDF.',
                'Envie o atestado em imagem (JPG, PNG, WEBP) ou PDF.',
                'Envie o atestado em imagem (JPG, PNG, WEBP) ou PDF.',
            ]
        );
    });
});
