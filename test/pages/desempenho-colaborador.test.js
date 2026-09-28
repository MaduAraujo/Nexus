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

describe('desempenho-colaborador.html — casos de erro e validação', () => {
    const NOW = '2026-06-17T10:00:00-03:00';

    test('colaborador novo, sem nenhum registro, vê um estado vazio em cada seção', async () => {
        const c = client({ performance_reviews: [], pdi_goals: [], employee_trainings: [], disciplinary_actions: [], medical_leaves: [] });
        c.handlers.rpc.job_titles_public = [];
        page = await openPage('desempenho-colaborador', { client: c });
        assert.match(page.text('#career-track-list'), /O RH ainda não cadastrou o catálogo de cargos/);
        assert.match(page.text('#reviews-list'), /Nenhuma avaliação/);
        assert.match(page.text('#goals-list'), /Nenhuma meta cadastrada/);
        assert.match(page.text('#trainings-list'), /Nenhum treinamento registrado ainda/);
        assert.match(page.text('#disciplinary-list'), /Nenhuma medida disciplinar registrada/);
        assert.match(page.text('#medical-leaves-list'), /Nenhum atestado enviado/);
    });

    test('cargo atual fora do catálogo avisa o colaborador', async () => {
        const c = client();
        for (const t of ['employees', 'employees_decrypted']) (c.tables[t] || []).filter((e) => e.id === ANA.id).forEach((e) => (e.role = 'Cargo Antigo <x>'));
        page = await openPage('desempenho-colaborador', { client: c });
        assert.match(page.text('#career-track-list'), /Seu cargo atual \(Cargo Antigo <x>\) não está neste catálogo/);
        assert.equal(page.$('#career-track-list x'), null);
    });

    test('falha ao avançar meta, dar ciência ou retirar curso avisa e não muda a tela', async () => {
        const c = client();
        c.errors['pdi_goals:update'] = { message: 'RLS' };
        c.errors['disciplinary_actions:update'] = { message: 'RLS' };
        c.errors['employee_trainings:delete'] = { message: 'RLS' };
        page = await openPage('desempenho-colaborador', { client: c });
        await page.click('[data-click="advanceGoal"][data-click-args*="g1"]');
        await page.click('[data-click="acknowledgeDisciplinary"]');
        await page.click('[data-click="withdrawTraining"]');
        assert.deepEqual(
            page.toasts().filter((t) => !/^Erro ao comunicar/.test(t)),
            ['Não foi possível atualizar a meta.', 'Não foi possível registrar sua ciência.', 'Não foi possível retirar o registro.']
        );
        assert.equal(c.tables.pdi_goals[0].status, 'pendente');
        assert.equal(c.tables.disciplinary_actions[0].acknowledged_at, null);
        assert.equal(c.tables.employee_trainings.length, 2);
        assert.ok(!c.calls.some((x) => x.storage === 'documents' && x.op === 'remove'), 'anexo continua lá');
    });

    test('meta concluída não avança mais', async () => {
        const c = client();
        page = await openPage('desempenho-colaborador', { client: c });
        await page.eval(`advanceGoal('g1', 'concluido')`);
        assert.equal(c.writes('pdi_goals', 'update').length, 0);
    });

    test('abrir certificado do curso; sem arquivo não faz nada; erro avisa', async () => {
        page = await openPage('desempenho-colaborador', { client: client(), fetch: filesOk });
        const abertos = [];
        page.window.NexusFiles.open = async (bucket, path) => {
            abertos.push(`${bucket}/${path}`);
            return { error: abertos.length > 1 ? new Error('x') : null };
        };
        await page.eval(`viewTrainingCertificate('t1')`);
        await page.eval(`viewTrainingCertificate('t2')`);
        assert.deepEqual(abertos, ['documents/emp-ana/certificados/x.pdf']);
        assert.deepEqual(page.toasts(), []);
        await page.eval(`viewTrainingCertificate('t2')`);
        assert.deepEqual(page.toasts(), ['Não foi possível abrir o certificado.']);
    });

    test('autodeclarar curso: sem nome, carga horária inválida, sem anexo e falha no envio do arquivo', async () => {
        const c = client();
        page = await openPage('desempenho-colaborador', { client: c });
        page.$('#tr-self-submit').disabled = false;
        await page.eval(`selfReportTraining()`);
        assert.deepEqual(page.toasts(), ['Informe o nome do curso.']);

        await page.fill('#tr-self-title', 'Excel');
        await page.fill('#tr-self-hours', '-3');
        await page.setFiles('#tr-self-file', [page.file('c.pdf', '%PDF', 'application/pdf')]);
        await page.click('#tr-self-submit');
        assert.ok(page.toasts().includes('Carga horária inválida.'));

        await page.fill('#tr-self-hours', '');
        await page.setFiles('#tr-self-file', []);
        page.$('#tr-self-submit').disabled = false;
        await page.eval(`selfReportTraining()`);
        assert.ok(page.toasts().includes('Anexe o certificado (imagem ou PDF).'));

        await page.setFiles('#tr-self-file', [page.file('c.pdf', '%PDF', 'application/pdf')]);
        page.window.NexusFiles.upload = async () => ({ error: new Error('rede') });
        await page.click('#tr-self-submit');
        assert.ok(page.toasts().includes('Não foi possível enviar o certificado.'));
        assert.equal(c.writes('employee_trainings', 'insert').length, 0);
    });

    test('se o registro do curso falhar, o certificado enviado é apagado', async () => {
        const c = client();
        c.errors['employee_trainings:insert'] = { message: 'RLS' };
        page = await openPage('desempenho-colaborador', { client: c, fetch: filesOk });
        await page.fill('#tr-self-title', 'Excel');
        await page.setFiles('#tr-self-file', [page.file('c.pdf', '%PDF', 'application/pdf')]);
        await page.click('#tr-self-submit');
        assert.ok(page.toasts().includes('Não foi possível registrar o curso.'));
        assert.match(c.calls.find((x) => x.storage === 'documents' && x.op === 'remove').path[0], /^emp-ana\/certificados\/\d+_c\.pdf$/);
    });

    test('anexo acima de 10 MB é recusado; tamanho aparece em KB ou MB; remover anexo limpa', async () => {
        page = await openPage('desempenho-colaborador', { client: client() });
        const grande = page.file('grande.pdf', 'x', 'application/pdf');
        Object.defineProperty(grande, 'size', { value: 10 * 1024 * 1024 + 1 });
        await page.setFiles('#ml-file', [grande]);
        assert.deepEqual(page.toasts(), ['O atestado deve ter no máximo 10 MB.']);
        assert.equal(page.text('#ml-file-name'), 'Anexar atestado *');

        const medio = page.file('exame.png', 'x', 'image/png');
        Object.defineProperty(medio, 'size', { value: 2.5 * 1024 * 1024 });
        await page.setFiles('#ml-file', [medio]);
        assert.equal(page.text('#ml-file-hint'), 'Imagem · 2.5 MB');
        assert.ok(page.$('#ml-file-box').classList.contains('has-file'));

        await page.setFiles('#ml-file', [page.file('p.pdf', '%PDF', 'application/pdf')]);
        assert.equal(page.text('#ml-file-hint'), 'PDF · 1 KB');

        await page.click('#ml-file-clear');
        assert.equal(page.text('#ml-file-name'), 'Anexar atestado *');
        assert.equal(page.$('#ml-file-clear').classList.contains('hidden'), true);
    });

    test('atestado: sem período, sem anexo ou com falha no envio do arquivo não registra', async () => {
        const c = client();
        page = await openPage('desempenho-colaborador', { client: c });
        page.$('#ml-submit').disabled = false;
        await page.eval(`selfReportLeave()`);
        assert.deepEqual(page.toasts(), ['Informe o período do atestado.']);

        page.eval(
            `setDateFieldValue(document.getElementById('ml-start-date'), '2026-06-10'); setDateFieldValue(document.getElementById('ml-end-date'), '2026-06-11');`
        );
        page.$('#ml-submit').disabled = false;
        await page.eval(`selfReportLeave()`);
        assert.ok(page.toasts().includes('Anexe o atestado (imagem ou PDF).'));

        await page.setFiles('#ml-file', [page.file('a.pdf', '%PDF', 'application/pdf')]);
        page.window.NexusFiles.upload = async () => ({ error: new Error('rede') });
        await page.click('#ml-submit');
        assert.ok(page.toasts().includes('Não foi possível enviar o anexo.'));
        assert.equal(c.writes('medical_leaves', 'insert').length, 0);
    });

    test('botão desabilitado não envia (evita clique duplo)', async () => {
        page = await openPage('desempenho-colaborador', { client: client() });
        assert.equal(page.$('#ml-submit').disabled, true);
        assert.equal(page.$('#tr-self-submit').disabled, true);
        await page.eval(`selfReportLeave()`);
        await page.eval(`selfReportTraining()`);
        assert.deepEqual(page.toasts(), []);
    });

    test('retirar atestado pendente apaga o registro e o anexo; erro avisa', async () => {
        const pendente = {
            id: 'm2',
            employee_id: ANA.id,
            start_date: '2026-06-01',
            end_date: '2026-06-01',
            days: 1,
            status: 'pendente',
            storage_path: 'emp-ana/atestados/1_a.pdf',
        };
        const c = client({ medical_leaves: [pendente] });
        c.errors['medical_leaves:delete'] = { message: 'RLS' };
        page = await openPage('desempenho-colaborador', { client: c });
        assert.match(page.text('#medical-leaves-list'), /01\/06\/2026 → 01\/06\/2026 1 dia Pendente/);
        await page.click('[data-click="withdrawLeave"]');
        assert.ok(page.toasts().includes('Não foi possível retirar o atestado.'));
        assert.equal(c.tables.medical_leaves.length, 1);

        delete c.errors['medical_leaves:delete'];
        await page.click('[data-click="withdrawLeave"]');
        assert.deepEqual(c.calls.find((x) => x.storage === 'documents' && x.op === 'remove').path, ['emp-ana/atestados/1_a.pdf']);
        assert.match(page.text('#medical-leaves-list'), /Nenhum atestado enviado/);
        assert.ok(page.toasts().includes('Atestado retirado.'));
    });

    test('calendário: abre no mês atual, navega entre meses e anos, escolhe o dia e fecha ao clicar fora', async () => {
        page = await openPage('desempenho-colaborador', { client: client(), now: NOW });
        const campo = page.$('#ml-start-field');
        const pop = campo.querySelector('.calendar-popover');
        const titulo = () => page.text(campo.querySelector('[data-cal-title]'));

        await page.click('#ml-start-date');
        assert.ok(pop.classList.contains('open'));
        assert.equal(titulo(), 'Junho 2026');
        const dias = campo.querySelectorAll('[data-cal-grid] .calendar-day');
        assert.equal(dias.length % 7, 0);
        assert.equal(dias[0].disabled, true, 'junho/2026 começa na segunda: o domingo é do mês anterior');
        assert.equal(page.text(campo.querySelector('.calendar-day--today')), '17');

        for (let i = 0; i < 6; i++) await page.click(campo.querySelector('[data-cal-prev]'));
        assert.equal(titulo(), 'Dezembro 2025');
        assert.ok(pop.classList.contains('open'), 'navegar não fecha');
        await page.click(campo.querySelector('[data-cal-next]'));
        assert.equal(titulo(), 'Janeiro 2026');
        for (let i = 0; i < 12; i++) await page.click(campo.querySelector('[data-cal-next]'));
        assert.equal(titulo(), 'Janeiro 2027');

        await page.click(campo.querySelector('[data-cal-grid] .calendar-day--muted'));
        assert.ok(pop.classList.contains('open'), 'dia de outro mês não é escolhível');
        await page.click(campo.querySelector('[data-cal-grid] [data-iso="2027-01-15"]'));
        assert.equal(pop.classList.contains('open'), false);
        assert.equal(page.$('#ml-start-date').value, '15/01/2027');

        await page.click('#ml-start-date');
        assert.equal(titulo(), 'Janeiro 2027', 'reabre no mês da data escolhida');
        assert.ok(campo.querySelector('.calendar-day--selected[data-iso="2027-01-15"]'));
        await page.click('#ml-start-date');
        assert.equal(pop.classList.contains('open'), false, 'clicar de novo fecha');

        await page.key(page.$('#ml-start-date'), 'Enter');
        assert.ok(pop.classList.contains('open'));
        await page.key(page.$('#ml-start-date'), ' ');
        assert.equal(pop.classList.contains('open'), false);
        await page.key(page.$('#ml-start-date'), 'a');
        assert.equal(pop.classList.contains('open'), false);

        await page.click(campo.querySelector('.date-field-icon'));
        assert.ok(pop.classList.contains('open'));
        await page.click(campo.querySelector('.date-field-icon'));
        assert.equal(pop.classList.contains('open'), false);

        await page.click(campo.querySelector('.date-field-icon'));
        await page.click('#ml-doctor-name');
        assert.equal(pop.classList.contains('open'), false, 'clique fora fecha');
    });

    test('calendário sem data escolhida volta para o mês atual ao reabrir', async () => {
        page = await openPage('desempenho-colaborador', { client: client(), now: NOW });
        const campo = page.$('#ml-end-field');
        await page.click('#ml-end-date');
        await page.click(campo.querySelector('[data-cal-next]'));
        await page.click('#ml-end-date');
        await page.click('#ml-end-date');
        assert.equal(page.text(campo.querySelector('[data-cal-title]')), 'Junho 2026');
    });

    test('o aviso some sozinho depois de alguns segundos', async () => {
        page = await openPage('desempenho-colaborador', { client: client() });
        const w = page.window;
        const original = w.setTimeout;
        w.setTimeout = (fn, ms, ...a) => (ms >= 400 ? (fn(...a), 0) : original(fn, ms, ...a));
        page.$('#ml-submit').disabled = false;
        await page.eval(`selfReportLeave()`);
        w.setTimeout = original;
        assert.deepEqual(page.toasts(), []);
    });
});

describe('desempenho-colaborador.html — um aviso por falha', () => {
    const esperarAvisoGlobal = () => new Promise((r) => setTimeout(r, 700));

    test('falha com mensagem própria da tela não mostra também o aviso genérico do servidor', async () => {
        const c = client();
        c.errors['pdi_goals:update'] = { message: 'RLS' };
        page = await openPage('desempenho-colaborador', { client: c });
        await page.click('[data-click="advanceGoal"][data-click-args*="g1"]');
        await esperarAvisoGlobal();
        assert.deepEqual(page.toasts(), ['Não foi possível atualizar a meta.']);
    });

    test('falha que a tela não trata continua avisando pelo aviso genérico', async () => {
        const c = client();
        c.errors['medical_leaves:select'] = { message: 'permission denied' };
        page = await openPage('desempenho-colaborador', { client: c });
        await esperarAvisoGlobal();
        assert.deepEqual(page.toasts(), ['Erro ao comunicar com o servidor: permission denied']);
    });
});
