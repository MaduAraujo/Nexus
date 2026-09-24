const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const filesOk = async () => new Response('{}', { status: 200 });

const MSGS = [
    {
        id: 'm1',
        texto: '<p>Feriado <b>sexta</b></p>',
        destino: 'Todos',
        categoria: 'Institucional',
        created_at: '2026-06-10T10:00:00-03:00',
        anexos: [{ name: 'calendario.pdf', path: 'm1/cal.pdf' }],
    },
    { id: 'm2', texto: 'Fechamento', destino: 'Financeiro', categoria: 'Urgente', created_at: '2026-06-12T10:00:00-03:00', anexos: [] },
    {
        id: 'm3',
        texto: 'Agendado',
        destino: 'TI',
        categoria: 'Evento',
        created_at: '2026-06-12T11:00:00-03:00',
        scheduled_at: '2026-07-01T09:00:00-03:00',
        anexos: [],
    },
];

function client(extra = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            messages: MSGS.map((m) => ({ ...m })),
            message_reads: [
                { message_id: 'm1', employee_id: ANA.id, read_at: '2026-06-10T11:00:00-03:00', employees: { name: ANA.name, dept: ANA.dept } },
                { message_id: 'm1', employee_id: BIA.id, read_at: '2026-06-10T12:00:00-03:00', employees: { name: BIA.name, dept: BIA.dept } },
            ],
            message_templates: [
                { id: 'tp1', nome: 'Boas-vindas', texto: 'Bem-vindos!', destino: 'Todos', categoria: 'Institucional', created_at: '2026-01-01' },
            ],
            ...extra,
        }),
        functions: { 'send-push': () => ({ data: { sent: 3 }, error: null }) },
    });
}

async function escrever(p, html) {
    const ed = p.$('#message-text');
    ed.innerHTML = html;
    ed.dispatchEvent(new p.window.Event('input', { bubbles: true }));
    await p.settle();
}

async function escolherDestino(p, dest) {
    await p.click('#dest-toggle-btn');
    await p.click(`#dest-inline-grid [data-dest="${dest}"]`);
}

describe('comunicacao.html — escrever e enviar', () => {
    test('exige destino; envia o texto sanitizado e dispara o push', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        await escrever(page, '<p>Reunião <b>geral</b> amanhã</p><script>alert(1)</script><img src=x onerror=alert(1)>');
        assert.equal(page.$('#send-btn').disabled, false);
        await page.click('#send-btn');
        assert.deepEqual(page.alerts, ['Escolha um destino antes de enviar o comunicado.']);
        assert.equal(c.writes('messages', 'insert').length, 0);

        await escolherDestino(page, 'Financeiro');
        await page.click('#send-btn');
        const msg = c.writes('messages', 'insert')[0].payload[0];
        assert.equal(msg.destino, 'Financeiro');
        assert.equal(msg.categoria, 'Institucional');
        assert.equal(msg.scheduled_at, null);
        assert.doesNotMatch(msg.texto, /script|onerror|img/i);
        assert.match(msg.texto, /<strong>geral<\/strong>/);
        assert.equal(c.calls.find((x) => x.fn === 'send-push').body.message_id, c.tables.messages.at(-1).id);
        assert.match(page.text('#send-btn'), /Enviado!/);
    });

    test('agendado: exige data futura e não dispara push agora', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        await escrever(page, 'Lembrete de treinamento');
        await escolherDestino(page, 'Todos');
        await page.check('#schedule-toggle');
        assert.equal(page.$('#send-btn').disabled, true, 'sem data não agenda');
        await page.click('#schedule-calendar-grid [data-day="20"]');
        await page.fill('#schedule-time-input', '09:30');
        assert.equal(page.visible('#schedule-summary'), true);
        await page.click('#send-btn');
        const msg = c.writes('messages', 'insert')[0].payload[0];
        assert.equal(new Date(msg.scheduled_at).toISOString(), new Date('2026-06-20T09:30:00-03:00').toISOString());
        assert.equal(c.calls.filter((x) => x.fn === 'send-push').length, 0);
        assert.match(page.text('#send-btn'), /Agendado!/);
    });

    test('anexos sobem para message-attachments e ficam no comunicado', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW, fetch: filesOk });
        await escrever(page, 'Segue a política');
        await escolherDestino(page, 'Todos');
        await page.setFiles('#attach-input', [page.file('politica.pdf', '%PDF', 'application/pdf')]);
        assert.match(page.text('#attach-chips'), /politica\.pdf/);
        await page.click('#send-btn');
        const upd = c.writes('messages', 'update')[0].payload;
        assert.equal(upd.anexos[0].name, 'politica.pdf');
        assert.match(upd.anexos[0].path, /\/\d+_politica\.pdf$/);
        assert.ok(page.fetches.some((f) => /nexus-files/.test(f.url)));
    });

    test('erro ao enviar avisa o RH (antes era silencioso)', async () => {
        const c = client();
        c.errors['messages:insert'] = { message: 'RLS' };
        page = await openPage('comunicacao', { client: c, now: NOW });
        await escrever(page, 'Teste');
        await escolherDestino(page, 'Todos');
        await page.click('#send-btn');
        assert.ok(page.alerts.includes('Não foi possível enviar o comunicado. Tente novamente.'));
        assert.equal(page.$('#send-btn').disabled, false);
    });

    test('rascunho é salvo e restaurado; descartar limpa', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        await escrever(page, 'Texto em andamento');
        await escolherDestino(page, 'RH');
        await new Promise((r) => setTimeout(r, 900));
        const draft = JSON.parse(page.window.localStorage.getItem('nexus_comunicado_draft'));
        assert.deepEqual([draft.html, draft.destino], ['Texto em andamento', 'RH']);
        const saved = page.window.localStorage.getItem('nexus_comunicado_draft');
        page.close();

        page = await openPage('comunicacao', { client: client(), now: NOW, localStorage: { nexus_comunicado_draft: saved } });
        assert.equal(page.$('#message-text').textContent, 'Texto em andamento');
        assert.equal(page.visible('#draft-banner'), true);
        await page.click('#draft-banner-discard');
        assert.equal(page.window.localStorage.getItem('nexus_comunicado_draft'), null);
        assert.equal(page.$('#message-text').textContent, '');
    });

    test('modelo: aplicar preenche o editor; salvar cria um novo', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        await page.click('#templates-toggle-btn');
        await page.click('.template-item-apply[data-id="tp1"]');
        assert.equal(page.$('#message-text').textContent, 'Bem-vindos!');
        await page.fill('#template-name-input', 'Aviso padrão');
        await page.click('#templates-save-btn');
        assert.deepEqual(
            [c.writes('message_templates', 'insert')[0].payload[0].nome, c.writes('message_templates', 'insert')[0].payload[0].texto],
            ['Aviso padrão', 'Bem-vindos!']
        );
    });
});

describe('comunicacao.html — histórico', () => {
    test('lista enviados com leituras; agendado marcado; filtros por destino e categoria; busca', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        await page.click('#main-toggle-btn');
        assert.equal(page.text('#stat-total'), '2', 'agendado ainda não conta');
        assert.equal(page.text('#stat-reads'), '2');
        const ids = () =>
            page
                .$$('#messages-list [data-id]')
                .map((e) => e.dataset.id)
                .filter((v, i, a) => a.indexOf(v) === i);
        assert.ok(ids().includes('m3'));
        await page.click('#history-filters [data-dest="Financeiro"]');
        assert.deepEqual(ids(), ['m2']);
        await page.click('#history-filters [data-dest="todos"]');
        await page.click('#category-filters [data-cat="Evento"]');
        assert.deepEqual(ids(), ['m3']);
        await page.click('#category-filters [data-cat="todas"]');
        await page.fill('#search-input', 'feriado');
        assert.deepEqual(ids(), ['m1']);
    });

    test('engajamento do comunicado mostra quem leu, por departamento', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        page.eval('void 0');
        await page.click('#stat-card-leituras');
        await page.waitFor(() => /Ana Souza/.test(page.text('#engagement-readers-list')));
        assert.match(page.text('#engagement-dept-list'), /Financeiro/);
    });

    test('excluir apaga o registro e depois os anexos; erro no banco mantém tudo', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        await page.click('#main-toggle-btn');
        c.errors['messages:delete'] = { message: 'RLS' };
        await page.click(page.$('#messages-list .delete-btn[data-id="m1"]'));
        await page.click('#confirm-delete-confirm');
        assert.equal(c.calls.filter((x) => x.storage === 'message-attachments' && x.op === 'remove').length, 0);
        assert.ok(page.alerts.includes('Não foi possível excluir o comunicado. Tente novamente.'));
        assert.ok(page.$('#messages-list .delete-btn[data-id="m1"]'), 'continua na lista');

        delete c.errors['messages:delete'];
        await page.click(page.$('#messages-list .delete-btn[data-id="m1"]'));
        await page.click('#confirm-delete-confirm');
        const ordem = c.calls.filter((x) => (x.table === 'messages' && x.op === 'delete') || x.storage === 'message-attachments').map((x) => x.op);
        assert.deepEqual(ordem, ['delete', 'delete', 'remove']);
        assert.ok(!page.$('#messages-list .delete-btn[data-id="m1"]'));
    });

    test('editar: remover anexo só apaga o arquivo depois de salvar', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        await page.click('#main-toggle-btn');
        await page.click(page.$('#messages-list .edit-btn[data-id="m1"]'));
        assert.equal(page.visible('#edit-modal'), true);
        await page.click(page.$('#edit-attach-chips button'));
        c.errors['messages:update'] = { message: 'RLS' };
        await page.click('#edit-modal-save');
        assert.equal(c.calls.filter((x) => x.storage === 'message-attachments' && x.op === 'remove').length, 0, 'edição falhou: arquivo fica');
        delete c.errors['messages:update'];
        await page.click('#edit-modal-save');
        assert.deepEqual(c.tables.messages[0].anexos, []);
        assert.deepEqual(c.calls.find((x) => x.storage === 'message-attachments' && x.op === 'remove').path, ['m1/cal.pdf']);
    });
});

void CAIO;
