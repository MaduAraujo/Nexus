const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function client({ messages = [], reads = [], templates = [], errors = {} } = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({ messages, message_reads: reads, message_templates: templates }),
        functions: { 'send-push': () => ({ data: { sent: 0 }, error: null }) },
        errors,
    });
}

async function escrever(p, html, alvo = '#message-text') {
    const ed = p.$(alvo);
    ed.innerHTML = html;
    ed.dispatchEvent(new p.window.Event('input', { bubbles: true }));
    await p.settle();
}

async function historico(p) {
    await p.click('#main-toggle-btn');
}

describe('comunicacao.html — bordas', () => {
    test('falhas ao ler colaboradores, comunicados, leituras e modelos deixam tudo vazio', async () => {
        page = await openPage('comunicacao', {
            client: client({
                errors: { employees: { message: 'a' }, messages: { message: 'b' }, message_reads: { message: 'c' }, message_templates: { message: 'd' } },
            }),
            now: NOW,
        });
        assert.equal(page.text('#stat-total'), '0');
        assert.match(page.text('#templates-menu-list'), /Nenhum modelo/);
        await historico(page);
        assert.match(page.text('#messages-list'), /Nenhum comunicado encontrado/);
        await page.click('#stat-card-leituras');
        assert.equal(page.$('#engagement-modal').classList.contains('hidden'), true);
        await page.click('#main-toggle-btn');
        assert.equal(page.$('#write-section').style.display, 'flex');
    });

    test('um caractere usa o singular; enviar ou salvar modelo sem texto não fazem nada; agendamento sem data não envia', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        await escrever(page, 'A');
        assert.equal(page.text('#char-count'), '1 caractere');
        await escrever(page, '');
        await page.click('#send-btn');
        await page.click('#templates-save-btn');
        await escrever(page, 'Texto');
        await page.click('#dest-toggle-btn');
        await page.click('#dest-inline-grid [data-dest="Todos"]');
        await page.check('#schedule-toggle');
        await page.click(page.$('#schedule-calendar-grid .calendar-day--past') || page.$('#schedule-calendar-grid .calendar-day--muted'));
        await page.click('#send-btn');
        assert.equal(c.writes('messages', 'insert').length, 0);
        assert.equal(c.writes('message_templates', 'insert').length, 0);
    });

    test('rascunho só com destino e sem categoria é restaurado com a categoria padrão; modelo sem categoria também', async () => {
        page = await openPage('comunicacao', {
            client: client({ templates: [{ id: 'tp1', nome: 'X', texto: 'O', destino: 'TI', categoria: null, created_at: '2026-01-01' }] }),
            now: NOW,
            localStorage: { nexus_comunicado_draft: { destino: 'TI', savedAt: '2026-06-17T09:00:00-03:00' } },
        });
        assert.equal(page.visible('#draft-banner'), true);
        assert.ok(page.$('#cat-inline-grid .cat-inline-chip[data-cat="Institucional"]').classList.contains('active'));
        assert.equal(page.text('#char-count'), '0 caracteres');
        await page.click('#templates-toggle-btn');
        await page.click('.template-item-apply[data-id="tp1"]');
        assert.equal(page.text('#char-count'), '1 caractere');
        assert.ok(page.$('#cat-inline-grid .cat-inline-chip[data-cat="Institucional"]').classList.contains('active'));
    });

    test('rascunho de um caractere usa o singular', async () => {
        page = await openPage('comunicacao', {
            client: client(),
            now: NOW,
            localStorage: { nexus_comunicado_draft: { html: 'Z', savedAt: '2026-06-17T09:00:00-03:00' } },
        });
        assert.equal(page.text('#char-count'), '1 caractere');
    });

    test('comunicado sem anexos gravados e com categoria desconhecida; editar sem texto não salva; excluir sem anexos', async () => {
        const c = client({
            messages: [{ id: 'm1', texto: 'Oi', destino: 'Todos', categoria: 'Outra', created_at: '2026-06-10T10:00:00-03:00', anexos: null }],
        });
        page = await openPage('comunicacao', { client: c, now: NOW });
        await historico(page);
        assert.ok(page.$('#messages-list .badge-cat.cat--institucional') || page.$('#messages-list .badge-cat'));
        assert.match(page.text('#messages-list'), /—/);
        await page.click('#messages-list .edit-btn');
        assert.ok(page.$('#edit-cat-grid .cat-inline-chip[data-cat="Outra"]') === null);
        await escrever(page, '', '#edit-message-text');
        await page.click('#edit-modal-save');
        assert.equal(c.writes('messages', 'update').length, 0);
        await page.click('#edit-modal-close');

        await page.click('#confirm-delete-confirm');
        assert.equal(c.writes('messages', 'delete').length, 0);
        await page.click('#messages-list .delete-btn');
        await page.click('#confirm-delete-confirm');
        assert.equal(c.writes('messages', 'delete').length, 1);
        assert.equal(c.calls.filter((x) => x.op === 'remove').length, 0);
    });

    test('editar sem categoria gravada usa a padrão; anexo novo que falha no envio fica de fora', async () => {
        const c = client({ messages: [{ id: 'm1', texto: 'Oi', destino: 'Todos', categoria: null, created_at: '2026-06-10T10:00:00-03:00', anexos: null }] });
        page = await openPage('comunicacao', { client: c, now: NOW, fetch: async () => new Response('{"error":"falhou"}', { status: 500 }) });
        await historico(page);
        await page.click('#messages-list .edit-btn');
        assert.ok(page.$('#edit-cat-grid .cat-inline-chip[data-cat="Institucional"]').classList.contains('active'));
        await page.setFiles('#edit-attach-input', [page.file('a.pdf', '%PDF-1.4')]);
        await page.click('#edit-modal-save');
        const [upd] = c.writes('messages', 'update');
        assert.deepEqual(page.plain(upd.payload.anexos), []);
    });

    test('engajamento: colaborador ativo sem setor, destino sem ninguém, leitor sem setor e nome com espaço duplo', async () => {
        const c = client({
            messages: [
                { id: 'm1', texto: 'A', destino: 'Todos', categoria: 'Institucional', created_at: '2026-06-10T10:00:00-03:00', anexos: [] },
                { id: 'm2', texto: 'B', destino: 'Setor Vazio', categoria: 'Institucional', created_at: '2026-06-11T10:00:00-03:00', anexos: [] },
            ],
            reads: [{ message_id: 'm1', employee_id: ANA.id, read_at: '2026-06-10T11:00:00-03:00', employees: { name: 'Ana  Souza', dept: 'P&D' } }],
        });
        c.tables.employees.find((e) => e.id === ANA.id).dept = null;
        page = await openPage('comunicacao', { client: c, now: NOW });
        await page.click('#stat-card-leituras');
        await page.waitFor(() => /Sem departamento/.test(page.text('#engagement-dept-list')));
        assert.match(page.text('#engagement-readers-list'), /AS\s*Ana Souza · P&D/);

        await historico(page);
        await page.click('#messages-list .reads-badge[data-id="m2"]');
        await page.waitFor(() => /Nenhuma leitura ainda/.test(page.text('#engagement-readers-list')));
        assert.match(page.text('#engagement-dept-list'), /Nenhum destinatário encontrado/);
    });

    test('engajamento aberto duas vezes seguidas mostra só a resposta mais recente; falha ao ler as leituras mostra vazio', async () => {
        const c = client({
            messages: [{ id: 'm1', texto: 'A', destino: 'Todos', categoria: 'Institucional', created_at: '2026-06-10T10:00:00-03:00', anexos: [] }],
            reads: [{ message_id: 'm1', employee_id: ANA.id, read_at: '2026-06-10T11:00:00-03:00', employees: { name: ANA.name, dept: ANA.dept } }],
        });
        page = await openPage('comunicacao', { client: c, now: NOW });
        const card = page.$('#stat-card-leituras');
        card.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        card.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        await page.settle();
        assert.equal(page.$$('#engagement-readers-list .reads-popover-item').length, 1);

        c.errors['message_reads:select'] = { message: 'x' };
        c.emit('message_reads', { eventType: 'INSERT', new: {} });
        await page.settle();
        assert.equal(page.text('#stat-total'), '1');
        await page.click('#engagement-modal-close');
        await page.click('#stat-card-leituras');
        await page.waitFor(() => /Nenhuma leitura ainda/.test(page.text('#engagement-readers-list')));
    });

    test('comunicado que exige ciência mostra visualizações e ciências separadas; comum mostra só visualizações', async () => {
        const c = client({
            messages: [
                { id: 'm1', texto: 'Norma', destino: 'Todos', categoria: 'Política', created_at: '2026-06-10T10:00:00-03:00', anexos: [] },
                { id: 'm2', texto: 'Festa', destino: 'Todos', categoria: 'Evento', created_at: '2026-06-11T10:00:00-03:00', anexos: [] },
            ],
            reads: [
                {
                    message_id: 'm1',
                    employee_id: ANA.id,
                    read_at: '2026-06-10T11:00:00-03:00',
                    acknowledged_at: '2026-06-10T11:05:00-03:00',
                    employees: { name: ANA.name, dept: ANA.dept },
                },
                {
                    message_id: 'm1',
                    employee_id: 'x',
                    read_at: '2026-06-10T12:00:00-03:00',
                    acknowledged_at: null,
                    employees: { name: 'Bia Lima', dept: 'TI' },
                },
                {
                    message_id: 'm2',
                    employee_id: ANA.id,
                    read_at: '2026-06-11T11:00:00-03:00',
                    acknowledged_at: null,
                    employees: { name: ANA.name, dept: ANA.dept },
                },
            ],
        });
        page = await openPage('comunicacao', { client: c, now: NOW });
        await historico(page);
        const ciencia = page.$('#messages-list .reads-badge[data-id="m1"]');
        assert.equal(page.text(ciencia), '2 1');
        assert.ok(ciencia.querySelector('.fa-check-double'));
        assert.equal(page.$('#messages-list .reads-badge[data-id="m2"] .fa-check-double'), null);

        await page.click(ciencia);
        await page.waitFor(() => /Ciência em/.test(page.text('#engagement-readers-list')));
        const itens = page.$$('#engagement-readers-list .reads-popover-item').map((el) => page.text(el));
        assert.equal(itens.filter((t) => /Ciência em 10\/06, 11:05/.test(t)).length, 1);
        assert.ok(itens.some((t) => /Bia Lima/.test(t) && !/Ciência/.test(t)));
    });

    test('banco recusa editar ou excluir comunicado com ciência: o RH vê o motivo, não um erro genérico', async () => {
        const trava = { code: '55000', message: 'Este comunicado já tem ciência confirmada por colaboradores e não pode ser excluído.' };
        const c = client({
            messages: [{ id: 'm1', texto: 'Norma', destino: 'Todos', categoria: 'Urgente', created_at: '2026-06-10T10:00:00-03:00', anexos: [] }],
            errors: { 'messages:update': { ...trava, message: 'não pode ser editado' }, 'messages:delete': trava },
        });
        page = await openPage('comunicacao', { client: c, now: NOW });
        await historico(page);
        await page.click('#messages-list .edit-btn');
        await escrever(page, 'Norma corrigida', '#edit-message-text');
        await page.click('#edit-modal-save');
        await page.click('#messages-list .delete-btn');
        await page.click('#confirm-delete-confirm');
        assert.deepEqual(page.alerts, ['não pode ser editado', trava.message]);
        assert.equal(page.$$('#messages-list .delete-btn').length, 1);

        c.errors['messages:delete'] = { message: 'rede' };
        await page.click('#messages-list .delete-btn');
        await page.click('#confirm-delete-confirm');
        assert.equal(page.alerts.at(-1), 'Não foi possível excluir o comunicado. Tente novamente.');
    });
});
