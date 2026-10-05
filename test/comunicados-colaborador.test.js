const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { createMockSupabase } = require('../test-support/mock-supabase');

let comunicados;

before(() => {
    const dom = new JSDOM('<!doctype html><div></div>');
    global.window = dom.window;
    global.document = dom.window.document;
    global.DOMParser = dom.window.DOMParser;
    global.Node = dom.window.Node;
    require('../src/javascript/comunicado-format.js');
    global.comunicadoPlainText = dom.window.comunicadoPlainText;
    global.sanitizeComunicadoHTML = dom.window.sanitizeComunicadoHTML;
    global.comunicadoExigeCiencia = dom.window.comunicadoExigeCiencia;
    global.comunicadoPendente = dom.window.comunicadoPendente;

    global.document = { addEventListener: () => {} };
    comunicados = require('../src/javascript/comunicados-colaborador.js');
});

function msg(id, overrides = {}) {
    return {
        id,
        destino: 'Todos',
        categoria: 'Institucional',
        texto: `<p>mensagem ${id}</p>`,
        created_at: '2026-09-10T10:00:00Z',
        anexos: [],
        ...overrides,
    };
}

describe('loadData', () => {
    beforeEach(() => {
        comunicados.__setStateForTest({ myEmployeeId: 'c1', myDept: 'TI' });
    });

    test('traz mensagens para "Todos" e para o próprio departamento, não para outros', async () => {
        global.sb = createMockSupabase({
            messages: [msg('m1', { destino: 'Todos' }), msg('m2', { destino: 'TI' }), msg('m3', { destino: 'RH' })],
            message_reads: [],
        });
        await comunicados.loadData();
        const { allMsgs } = comunicados.__getStateForTest();
        assert.deepEqual(allMsgs.map((m) => m.id).sort(), ['m1', 'm2']);
    });

    test('sem departamento, só traz "Todos"', async () => {
        comunicados.__setStateForTest({ myEmployeeId: 'c1', myDept: '' });
        global.sb = createMockSupabase({
            messages: [msg('m1', { destino: 'Todos' }), msg('m2', { destino: 'TI' })],
            message_reads: [],
        });
        await comunicados.loadData();
        const { allMsgs } = comunicados.__getStateForTest();
        assert.deepEqual(
            allMsgs.map((m) => m.id),
            ['m1']
        );
    });

    test('carrega o conjunto de mensagens já lidas só do próprio colaborador', async () => {
        global.sb = createMockSupabase({
            messages: [msg('m1')],
            message_reads: [
                { message_id: 'm1', employee_id: 'c1' },
                { message_id: 'm1', employee_id: 'outro' },
            ],
        });
        await comunicados.loadData();
        const { lidos } = comunicados.__getStateForTest();
        assert.ok(lidos.has('m1'));
    });

    test('separa o que foi só visualizado do que teve ciência confirmada', async () => {
        global.sb = createMockSupabase({
            messages: [msg('m1', { categoria: 'Urgente' }), msg('m2', { categoria: 'Urgente' })],
            message_reads: [
                { message_id: 'm1', employee_id: 'c1', acknowledged_at: null },
                { message_id: 'm2', employee_id: 'c1', acknowledged_at: '2026-09-10T11:00:00Z' },
            ],
        });
        await comunicados.loadData();
        const { lidos, cientes } = comunicados.__getStateForTest();
        assert.deepEqual([...lidos].sort(), ['m1', 'm2']);
        assert.deepEqual([...cientes], ['m2']);
    });
});

describe('confirmarCiencia', () => {
    beforeEach(() => {
        comunicados.__setStateForTest({ myEmployeeId: 'c1', myDept: 'TI' });
    });

    test('grava a ciência junto com a visualização e marca os dois conjuntos', async () => {
        global.sb = createMockSupabase({ messages: [msg('m1', { categoria: 'Urgente' })], message_reads: [] });
        await comunicados.loadData();
        assert.equal(await comunicados.confirmarCiencia('m1'), true);
        const [row] = global.sb.upsertCalls[0].rows;
        assert.equal(row.message_id, 'm1');
        assert.equal(row.employee_id, 'c1');
        assert.ok(row.acknowledged_at);
        const { lidos, cientes } = comunicados.__getStateForTest();
        assert.ok(lidos.has('m1'));
        assert.ok(cientes.has('m1'));
    });

    test('ciência já confirmada não grava de novo', async () => {
        global.sb = createMockSupabase({
            messages: [msg('m1', { categoria: 'Urgente' })],
            message_reads: [{ message_id: 'm1', employee_id: 'c1', acknowledged_at: '2026-09-10T11:00:00Z' }],
        });
        await comunicados.loadData();
        assert.equal(await comunicados.confirmarCiencia('m1'), true);
        assert.equal(global.sb.upsertCalls.length, 0);
    });

    test('se o banco recusa, não finge que houve ciência', async () => {
        global.sb = createMockSupabase({ messages: [msg('m1', { categoria: 'Urgente' })], message_reads: [] });
        await comunicados.loadData();
        global.sb.from = () => ({ upsert: async () => ({ error: { message: 'recusado' } }) });
        assert.equal(await comunicados.confirmarCiencia('m1'), false);
        assert.equal(comunicados.__getStateForTest().cientes.has('m1'), false);
    });

    test('Urgente e Política exigem ciência; as demais categorias, não', () => {
        assert.equal(comunicados.exigeCiencia(msg('x', { categoria: 'Política' })), true);
        for (const categoria of ['Institucional', 'Benefícios', 'Evento']) assert.equal(comunicados.exigeCiencia(msg('x', { categoria })), false, categoria);
        assert.equal(comunicados.exigeCiencia(null), false);
    });
});

describe('marcarLido / marcarTodosLidos', () => {
    beforeEach(() => {
        comunicados.__setStateForTest({ myEmployeeId: 'c1', myDept: 'TI' });
    });

    test('marcarLido grava no Supabase e some da lista de não lidos', async () => {
        global.sb = createMockSupabase({ messages: [msg('m1'), msg('m2')], message_reads: [] });
        await comunicados.loadData();
        await comunicados.marcarLido('m1');
        const { lidos } = comunicados.__getStateForTest();
        assert.ok(lidos.has('m1'));
        assert.ok(!lidos.has('m2'));
        assert.deepEqual(global.sb.upsertCalls[0].rows, [{ message_id: 'm1', employee_id: 'c1' }]);
    });

    test('marcarLido é idempotente: já lido não grava de novo', async () => {
        global.sb = createMockSupabase({ messages: [msg('m1')], message_reads: [{ message_id: 'm1', employee_id: 'c1' }] });
        await comunicados.loadData();
        await comunicados.marcarLido('m1');
        assert.equal(global.sb.upsertCalls.length, 0);
    });

    test('marcarTodosLidos marca só os que ainda não estavam lidos', async () => {
        global.sb = createMockSupabase({
            messages: [msg('m1'), msg('m2'), msg('m3')],
            message_reads: [{ message_id: 'm1', employee_id: 'c1' }],
        });
        await comunicados.loadData();
        await comunicados.marcarTodosLidos();
        const { lidos } = comunicados.__getStateForTest();
        assert.equal(lidos.size, 3);
        assert.deepEqual(global.sb.upsertCalls[0].rows.map((r) => r.message_id).sort(), ['m2', 'm3']);
    });

    test('marcarTodosLidos pula comunicado urgente (ciência é individual)', async () => {
        global.sb = createMockSupabase({ messages: [msg('m1', { categoria: 'Urgente' }), msg('m2')], message_reads: [] });
        await comunicados.loadData();
        await comunicados.marcarTodosLidos();
        assert.deepEqual(
            global.sb.upsertCalls[0].rows.map((r) => r.message_id),
            ['m2']
        );
        assert.equal(comunicados.__getStateForTest().lidos.has('m1'), false);
        assert.equal(comunicados.exigeCiencia(msg('x', { categoria: 'Urgente' })), true);
        assert.equal(comunicados.exigeCiencia(msg('x')), false);
    });

    test('marcarTodosLidos não grava nada quando já está tudo lido', async () => {
        global.sb = createMockSupabase({ messages: [msg('m1')], message_reads: [{ message_id: 'm1', employee_id: 'c1' }] });
        await comunicados.loadData();
        await comunicados.marcarTodosLidos();
        assert.equal(global.sb.upsertCalls.length, 0);
    });
});

describe('filterMsgs (o que a tela mostra por aba/busca)', () => {
    const msgs = [
        msg('m1', { destino: 'Todos', texto: '<p>Reunião geral amanhã</p>' }),
        msg('m2', { destino: 'TI', texto: '<p>Manutenção no servidor</p>' }),
        msg('m3', { destino: 'RH', texto: '<p>Novo benefício de vale-refeição</p>' }),
    ];
    const lidos = new Set(['m1']);

    test('aba "todos-vis" (não é "nao-lidos") mostra tudo, lido ou não', () => {
        const out = comunicados.filterMsgs(msgs, lidos, 'todos-vis', '');
        assert.equal(out.length, 3);
    });

    test('aba "nao-lidos" esconde o que já foi lido', () => {
        const out = comunicados.filterMsgs(msgs, lidos, 'nao-lidos', '');
        assert.deepEqual(
            out.map((m) => m.id),
            ['m2', 'm3']
        );
    });

    test('busca casa com o texto do comunicado (sem tags), sem diferenciar maiúsculas', () => {
        const out = comunicados.filterMsgs(msgs, lidos, 'todos-vis', 'BENEFÍCIO');
        assert.deepEqual(
            out.map((m) => m.id),
            ['m3']
        );
    });

    test('busca também casa com o nome do destino', () => {
        const out = comunicados.filterMsgs(msgs, lidos, 'todos-vis', 'ti');
        assert.deepEqual(
            out.map((m) => m.id),
            ['m2']
        );
    });

    test('aba "nao-lidos": comunicado crítico só visualizado continua pendente até a ciência', () => {
        const criticos = [msg('u1', { categoria: 'Urgente' }), msg('u2', { categoria: 'Política' })];
        const out = comunicados.filterMsgs(criticos, new Set(['u1', 'u2']), 'nao-lidos', '', new Set(['u2']));
        assert.deepEqual(
            out.map((m) => m.id),
            ['u1']
        );
    });

    test('busca e filtro de não lidos combinam (AND)', () => {
        const out = comunicados.filterMsgs(msgs, lidos, 'nao-lidos', 'servidor');
        assert.deepEqual(
            out.map((m) => m.id),
            ['m2']
        );
    });
});

describe('helpers de formatação', () => {
    test('escHTML neutraliza os cinco caracteres perigosos de HTML', () => {
        assert.equal(comunicados.escHTML(`<b>"a" & 'b'</b>`), '&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;');
    });

    test('fmtDate formata em dd/mm/aaaa', () => {
        assert.equal(comunicados.fmtDate('2026-01-05T10:00:00Z'), '05/01/2026');
    });

    test('timeAgo: bem recente vira "agora mesmo"', () => {
        assert.equal(comunicados.timeAgo(new Date().toISOString()), 'agora mesmo');
    });

    test('timeAgo: mais de 2 dias cai para a data formatada', () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
        assert.equal(comunicados.timeAgo(threeDaysAgo), comunicados.fmtDate(threeDaysAgo));
    });

    test('fmtDateTime junta data e hora com "às"', () => {
        assert.match(comunicados.fmtDateTime('2026-01-05T10:30:00Z'), /^05\/01\/2026 às \d{2}:\d{2}$/);
    });
});
