const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const filesOk = async () => new Response('{}', { status: 200 });

function client(extra = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({
            performance_reviews: [
                {
                    id: 'r1',
                    employee_id: ANA.id,
                    cycle: '2025.2',
                    status: 'concluida',
                    overall_rating: 4,
                    manager_comment: 'Ótima <entrega>',
                    created_at: '2026-01-10',
                    completed_at: '2026-01-20',
                },
            ],
            performance_review_competencies: [
                { review_id: 'r1', competency: 'Comunicação', rating: 5 },
                { review_id: 'r1', competency: 'Prazo', rating: 3 },
            ],
            pdi_goals: [
                { id: 'g1', employee_id: ANA.id, title: 'Curso de Excel', status: 'pendente', due_date: '2026-08-01', created_at: '2026-02-01' },
                { id: 'g2', employee_id: ANA.id, title: 'Mentoria', status: 'em_andamento', created_at: '2026-01-01' },
            ],
            employee_trainings: [
                {
                    id: 't1',
                    employee_id: ANA.id,
                    title: 'NR-10',
                    hours: 40,
                    source: 'rh',
                    status: 'concluido',
                    certificate_url: 'javascript:alert(1)',
                    created_at: '2026-01-01',
                },
                {
                    id: 't2',
                    employee_id: ANA.id,
                    title: 'Power BI',
                    hours: 8,
                    source: 'autodeclarado',
                    status: 'aguardando_aprovacao',
                    certificate_path: 'emp-ana/certificados/x.pdf',
                    created_at: '2026-02-01',
                },
            ],
            disciplinary_actions: [
                { id: 'd1', employee_id: ANA.id, type: 'advertencia_escrita', reason: 'Atrasos', occurred_at: '2026-03-02', acknowledged_at: null },
            ],
            medical_leaves: [
                {
                    id: 'm1',
                    employee_id: ANA.id,
                    start_date: '2026-04-06',
                    end_date: '2026-04-07',
                    days: 2,
                    cid: 'J11',
                    status: 'recusado',
                    rejection_reason: 'Ilegível',
                },
            ],
            ...extra,
        }),
        rpc: {
            job_titles_public: [
                { title: 'Analista Pleno', level: 'Pleno', track: 'Financeiro' },
                { title: 'Analista', level: 'Júnior', track: 'Financeiro' },
                { title: 'Coordenadora', level: 'Coordenação', track: 'Financeiro' },
            ],
        },
    });
}

describe('desempenho-colaborador.html — trilha, avaliações e metas', () => {
    test('trilha de carreira ordenada por nível e marca o cargo atual', async () => {
        page = await openPage('desempenho-colaborador', { client: client() });
        assert.deepEqual(
            page.$$('.career-level-title').map((e) => e.textContent),
            ['Analista', 'Analista Pleno', 'Coordenadora']
        );
        assert.match(page.text('.career-level-row--current'), /Analista.*Você está aqui/);
    });

    test('avaliações com competências e comentário escapado; card expande', async () => {
        page = await openPage('desempenho-colaborador', { client: client() });
        assert.match(page.text('#reviews-list'), /2025\.2 Concluída em 20\/01\/2026 ★★★★☆/);
        assert.match(page.text('#reviews-list'), /Comunicação ★★★★★ Prazo ★★★☆☆ Ótima <entrega>/);
        await page.click('.review-card-header');
        assert.ok(page.$('#review-card-r1').classList.contains('open'));
    });

    test('metas avançam de pendente → em andamento → concluída', async () => {
        const c = client();
        page = await openPage('desempenho-colaborador', { client: c });
        await page.click('[data-click="advanceGoal"][data-click-args*="g1"]');
        assert.equal(c.tables.pdi_goals[0].status, 'em_andamento');
        assert.deepEqual(page.toasts(), ['Meta iniciada!']);
        await page.click('[data-click="advanceGoal"][data-click-args*="g2"]');
        assert.equal(c.tables.pdi_goals[1].status, 'concluido');
    });
});

describe('desempenho-colaborador.html — treinamentos', () => {
    test('link de certificado que não é http(s) não vira link clicável', async () => {
        page = await openPage('desempenho-colaborador', { client: client() });
        assert.equal(page.$('#trainings-list a[href^="javascript"]'), null);
        assert.ok(page.$('[data-click="withdrawTraining"]'), 'autodeclarado aguardando pode ser retirado');
    });

    test('autodeclarar curso exige nome e anexo; envia o certificado e registra aguardando aprovação', async () => {
        const c = client();
        page = await openPage('desempenho-colaborador', { client: c, fetch: filesOk });
        assert.equal(page.$('#tr-self-submit').disabled, true);
        await page.fill('#tr-self-title', 'Excel Avançado');
        await page.fill('#tr-self-hours', '12,5');
        await page.fill('#tr-self-cert', 'javascript:alert(1)');
        await page.setFiles('#tr-self-file', [page.file('cert.pdf', '%PDF-1.4', 'application/pdf')]);
        assert.equal(page.text('#tr-self-file-name'), 'cert.pdf');
        assert.equal(page.$('#tr-self-submit').disabled, false);
        await page.click('#tr-self-submit');
        assert.deepEqual(page.toasts(), ['O link do certificado deve começar com https://']);

        await page.fill('#tr-self-cert', 'https://cursos.exemplo.com/cert/1');
        await page.click('#tr-self-submit');
        const [ins] = c.writes('employee_trainings', 'insert');
        assert.equal(ins.payload[0].hours, 12.5);
        assert.equal(ins.payload[0].status, 'aguardando_aprovacao');
        assert.match(ins.payload[0].certificate_path, /^emp-ana\/certificados\/\d+_cert\.pdf$/);
        assert.equal(page.fetches.length, 1);
        assert.ok(page.toasts().includes('Curso enviado para aprovação do RH!'));
    });

    test('anexo em formato não aceito é recusado', async () => {
        page = await openPage('desempenho-colaborador', { client: client() });
        await page.setFiles('#tr-self-file', [page.file('x.exe', 'MZ', 'application/x-msdownload')]);
        assert.deepEqual(page.toasts(), ['Envie o certificado em imagem (JPG, PNG, WEBP) ou PDF.']);
        assert.equal(page.text('#tr-self-file-name'), 'Anexar certificado *');
    });

    test('retirar curso autodeclarado apaga o registro e o anexo', async () => {
        const c = client();
        page = await openPage('desempenho-colaborador', { client: c });
        await page.click('[data-click="withdrawTraining"]');
        assert.equal(c.writes('employee_trainings', 'delete').length, 1);
        assert.deepEqual(c.calls.find((x) => x.storage === 'documents' && x.op === 'remove').path, ['emp-ana/certificados/x.pdf']);
    });
});

describe('desempenho-colaborador.html — medidas disciplinares e atestados', () => {
    test('dar ciência numa advertência', async () => {
        const c = client();
        page = await openPage('desempenho-colaborador', { client: c });
        assert.match(page.text('#disciplinary-list'), /Atrasos.*02\/03\/2026.*Advertência Escrita/);
        await page.click('[data-click="acknowledgeDisciplinary"]');
        assert.ok(c.tables.disciplinary_actions[0].acknowledged_at);
        assert.match(page.text('#disciplinary-list'), /Ciente em/);
    });

    test('atestado recusado mostra o motivo; novo atestado valida datas e envia', async () => {
        const c = client();
        page = await openPage('desempenho-colaborador', { client: c, fetch: filesOk });
        assert.match(page.text('#medical-leaves-list'), /06\/04\/2026 → 07\/04\/2026 2 dias · CID J11 Motivo: Ilegível/);

        page.eval(
            `setDateFieldValue(document.getElementById('ml-start-date'), '2026-06-10'); setDateFieldValue(document.getElementById('ml-end-date'), '2026-06-09');`
        );
        await page.setFiles('#ml-file', [page.file('atestado.jpg', 'jpg', 'image/jpeg')]);
        await page.click('#ml-submit');
        assert.deepEqual(page.toasts(), ['A data final não pode ser antes do início.']);

        page.eval(`setDateFieldValue(document.getElementById('ml-end-date'), '2026-06-12'); refreshSubmitButtons();`);
        await page.fill('#ml-doctor-name', 'Dra. Paula');
        await page.fill('#ml-cid', 'A09');
        await page.click('#ml-submit');
        const [ins] = c.writes('medical_leaves', 'insert');
        assert.deepEqual(
            { ...ins.payload[0], storage_path: undefined },
            { employee_id: ANA.id, start_date: '2026-06-10', end_date: '2026-06-12', doctor_name: 'Dra. Paula', cid: 'A09', storage_path: undefined }
        );
        assert.ok(page.toasts().includes('Atestado enviado para aprovação do RH!'));
    });

    test('se o registro do atestado falhar, o anexo enviado é apagado', async () => {
        const c = client({});
        c.errors['medical_leaves:insert'] = { message: 'RLS' };
        page = await openPage('desempenho-colaborador', { client: c, fetch: filesOk });
        page.eval(
            `setDateFieldValue(document.getElementById('ml-start-date'), '2026-06-10'); setDateFieldValue(document.getElementById('ml-end-date'), '2026-06-10');`
        );
        await page.setFiles('#ml-file', [page.file('a.pdf', '%PDF', 'application/pdf')]);
        await page.click('#ml-submit');
        assert.ok(page.toasts().includes('Não foi possível enviar o atestado.'));
        assert.ok(c.calls.some((x) => x.storage === 'documents' && x.op === 'remove'));
    });
});
