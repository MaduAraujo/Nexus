const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

const NOW = '2026-06-17T10:00:00-03:00';
let page;
afterEach(() => page?.close());

function client(messages, reads = [], extra = {}) {
    return new FakeSupabase({ user: COLAB_USER, tables: baseTables({ messages, message_reads: reads }), ...extra });
}

describe('comunicados-colaborador.html — bordas', () => {
    test('falha ao ler comunicados e leituras mostra a lista vazia, sem quebrar', async () => {
        const c = client([], [], { errors: { messages: { message: 'x' }, message_reads: { message: 'y' } } });
        page = await openPage('comunicados-colaborador', { client: c, now: NOW });
        assert.equal(page.text('#stat-total'), '0');
        assert.match(page.text('#comunicados-list'), /Nenhum comunicado disponível/);
    });

    test('colaborador sem departamento vê só os comunicados para todos', async () => {
        const c = client([
            { id: 'm1', texto: 'A', destino: 'Todos', categoria: 'Institucional', created_at: '2026-06-16T10:00:00-03:00', anexos: [] },
            { id: 'm2', texto: 'B', destino: 'TI', categoria: 'Institucional', created_at: '2026-06-16T10:00:00-03:00', anexos: [] },
        ]);
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).dept = null;
        page = await openPage('comunicados-colaborador', { client: c, now: NOW });
        assert.deepEqual(
            page.$$('.comunicado-card').map((el) => el.dataset.id),
            ['m1']
        );
    });

    test('categoria desconhecida usa o selo institucional; texto longo é resumido; sem lista de anexos não quebra', async () => {
        const longo = 'palavra '.repeat(60);
        page = await openPage('comunicados-colaborador', {
            client: client(
                [{ id: 'm1', texto: longo, destino: 'Todos', categoria: 'Outra', created_at: '2026-06-16T10:00:00-03:00' }],
                [{ message_id: 'm1', employee_id: ANA.id }]
            ),
            now: NOW,
        });
        const preview = page.text('.comunicado-preview');
        assert.ok(preview.endsWith('…'));
        assert.ok(preview.length <= 221);
        assert.equal(page.$('.comunicado-top'), null);
        await page.click('.comunicado-card[data-id="m1"]');
        assert.ok(page.$('#modal-cat').classList.contains('cat--institucional'));
    });

    test('filtro "não lidos" com tudo lido avisa que todos já foram lidos', async () => {
        page = await openPage('comunicados-colaborador', {
            client: client(
                [{ id: 'm1', texto: 'A', destino: 'Todos', categoria: 'Institucional', created_at: '2026-06-16T10:00:00-03:00', anexos: [] }],
                [{ message_id: 'm1', employee_id: ANA.id }]
            ),
            now: NOW,
        });
        await page.click('.filter-btn[data-filter="nao-lidos"]');
        assert.match(page.text('#comunicados-list'), /Nenhum resultado encontrado.*Todos os comunicados já foram lidos/);
    });

    test('comunicado urgente: confirmar só depois de rolar até o fim; rolar com o modal fechado ou já no fim não muda nada', async () => {
        const c = client([{ id: 'm1', texto: 'Norma nova', destino: 'Todos', categoria: 'Urgente', created_at: '2026-06-16T10:00:00-03:00', anexos: [] }]);
        page = await openPage('comunicados-colaborador', { client: c, now: NOW });
        const card = page.$('#msg-modal .msg-modal-card');
        Object.defineProperty(card, 'scrollHeight', { configurable: true, value: 1000 });
        await page.click('.comunicado-card[data-id="m1"]');
        const btn = page.$('#btn-marcar-lido');
        assert.equal(btn.disabled, true);
        await page.click(btn);
        assert.equal(c.writes('message_reads', 'upsert').length, 0);

        await page.click('#modal-close');
        card.dispatchEvent(new page.window.Event('scroll'));
        await page.click(btn);
        assert.equal(c.writes('message_reads', 'upsert').length, 0);

        await page.click('.comunicado-card[data-id="m1"]');
        Object.defineProperty(card, 'scrollHeight', { configurable: true, value: 0 });
        card.dispatchEvent(new page.window.Event('scroll'));
        assert.equal(page.visible('#modal-scroll-hint'), false);
        card.dispatchEvent(new page.window.Event('scroll'));
        await page.check('#modal-ciencia');
        assert.equal(btn.disabled, false);
    });
});
