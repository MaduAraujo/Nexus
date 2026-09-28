const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

const MSGS = [
    {
        id: 'm1',
        texto: '<p>Feriado <b>sexta</b></p>',
        destino: 'Todos',
        categoria: 'Institucional',
        created_at: '2026-06-10T10:00:00-03:00',
        anexos: [{ name: 'calendario.pdf', path: 'm1/cal.pdf', type: 'application/pdf', size: 2048 }],
    },
    { id: 'm2', texto: 'Fechamento', destino: 'Financeiro', categoria: 'Urgente', created_at: '2026-06-12T10:00:00-03:00', anexos: [] },
];

function client(extra = {}, opts = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            messages: MSGS.map((m) => ({ ...m })),
            message_reads: [{ message_id: 'm1', employee_id: ANA.id, read_at: '2026-06-10T11:00:00-03:00', employees: { name: ANA.name, dept: ANA.dept } }],
            message_templates: [
                { id: 'tp1', nome: 'Boas-vindas', texto: 'Bem-vindos!', destino: 'Todos', categoria: 'Institucional', created_at: '2026-01-01' },
            ],
            ...extra,
        }),
        functions: { 'send-push': () => ({ data: { sent: 1 }, error: null }) },
        ...opts,
    });
}

async function escrever(p, html, alvo = '#message-text') {
    const ed = p.$(alvo);
    ed.innerHTML = html;
    ed.dispatchEvent(new p.window.Event('input', { bubbles: true }));
    await p.settle();
}

async function escolherDestino(p, dest) {
    await p.click('#dest-toggle-btn');
    await p.click(`#dest-inline-grid [data-dest="${dest}"]`);
}

function simularEdicao(p) {
    const comandos = [];
    p.document.execCommand = (cmd, ui, valor) => {
        comandos.push([cmd, valor]);
        return true;
    };
    p.document.queryCommandState = (cmd) => cmd === 'bold';
    return comandos;
}

function selecionarTexto(p, no, inicio, fim) {
    const r = p.document.createRange();
    r.setStart(no, inicio);
    r.setEnd(no, fim);
    const sel = p.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
}

describe('comunicacao.html — barra de formatação', () => {
    test('negrito e lista usam o comando do editor e marcam o botão ativo; colar entra como texto puro', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        const comandos = simularEdicao(page);
        await escrever(page, 'Texto');
        await page.click('#format-toolbar [data-format="bold"]');
        await page.click('#format-toolbar [data-format="list"]');
        assert.deepEqual(
            comandos.map(([c]) => c),
            ['bold', 'insertUnorderedList']
        );
        assert.ok(page.$('#format-toolbar [data-format="bold"]').classList.contains('active'));
        assert.ok(!page.$('#format-toolbar [data-format="list"]').classList.contains('active'));
        assert.ok(!page.$('#format-toolbar [data-format="link"]').classList.contains('active'));

        const colar = new page.window.Event('paste', { cancelable: true, bubbles: true });
        colar.clipboardData = { getData: (t) => (t === 'text/plain' ? 'colado <b>sem</b> formato' : '') };
        page.$('#message-text').dispatchEvent(colar);
        assert.ok(colar.defaultPrevented);
        assert.deepEqual(comandos.at(-1), ['insertText', 'colado <b>sem</b> formato']);

        page.document.queryCommandState = () => {
            throw new Error('não suportado');
        };
        page.$('#message-text').dispatchEvent(new page.window.KeyboardEvent('keyup'));
        assert.ok(!page.$('#format-toolbar [data-format="bold"]').classList.contains('active'), 'se o navegador não informa, nada fica ativo');
    });

    test('link: cancelar não faz nada; endereço sem http é recusado; sem seleção insere no fim com o texto pedido', async () => {
        const respostas = [null, 'ftp://arquivos', 'https://nexus.test/politica', 'Política'];
        page = await openPage('comunicacao', { client: client(), now: NOW, prompt: () => respostas.shift() });
        simularEdicao(page);
        await escrever(page, 'Leia a ');
        page.$('#message-text').focus = () => {};
        page.window.getSelection().removeAllRanges();
        await page.click('#format-toolbar [data-format="link"]');
        assert.equal(page.$('#message-text a'), null);
        await page.click('#format-toolbar [data-format="link"]');
        assert.deepEqual(page.alerts, ['Use um link começando com http:// ou https://']);
        await page.click('#format-toolbar [data-format="link"]');
        const a = page.$('#message-text a');
        assert.equal(a.getAttribute('href'), 'https://nexus.test/politica');
        assert.equal(a.textContent, 'Política');
        assert.equal(a.rel, 'noopener noreferrer');
        assert.equal(page.$('#message-text').textContent, 'Leia a Política');
    });

    test('link com texto selecionado troca a seleção pelo link; com cursor posicionado insere ali', async () => {
        const respostas = ['https://nexus.test', 'https://exemplo.test', ''];
        page = await openPage('comunicacao', { client: client(), now: NOW, prompt: () => respostas.shift() });
        simularEdicao(page);
        page.$('#message-text').focus = () => {};
        await escrever(page, 'veja aqui por favor');
        const texto = page.$('#message-text').firstChild;
        selecionarTexto(page, texto, 5, 9);
        await page.click('#format-toolbar [data-format="link"]');
        assert.equal(page.$('#message-text').innerHTML, 'veja <a href="https://nexus.test" target="_blank" rel="noopener noreferrer">aqui</a> por favor');

        await escrever(page, 'início fim');
        selecionarTexto(page, page.$('#message-text').firstChild, 7, 7);
        await page.click('#format-toolbar [data-format="link"]');
        assert.equal(page.$('#message-text a').textContent, 'https://exemplo.test', 'sem texto informado usa o endereço');
        assert.match(page.$('#message-text').innerHTML, /^início <a /);
    });

    test('barra de formatação do modal de edição', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        const comandos = simularEdicao(page);
        await page.click('#main-toggle-btn');
        await page.click(page.$('#messages-list .edit-btn[data-id="m2"]'));
        await page.click('#edit-format-toolbar [data-format="bold"]');
        assert.deepEqual(comandos, [['bold', undefined]]);
        assert.ok(page.$('#edit-format-toolbar [data-format="bold"]').classList.contains('active'));
    });
});

describe('comunicacao.html — escrever: anexos, agendamento, categoria, modelos e rascunho', () => {
    test('remover anexo antes de enviar; anexo que falha não impede o envio dos demais', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        let n = 0;
        page.window.NexusFiles.upload = async () => ({ error: ++n === 2 ? { message: 'falhou' } : null });
        await escrever(page, 'Documentos');
        await escolherDestino(page, 'Todos');
        await page.click('#attach-btn');
        await page.setFiles('#attach-input', [page.file('a.pdf', '%PDF'), page.file('b.pdf', '%PDF'), page.file('c.pdf', '%PDF')]);
        await page.click('#attach-chips .attach-chip-remove[data-idx="0"]');
        assert.deepEqual(
            page.$$('#attach-chips .attach-chip-name').map((e) => e.textContent),
            ['b.pdf', 'c.pdf']
        );
        page.$('#attach-chips').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        await page.click('#send-btn');
        await page.waitFor(() => c.writes('messages', 'update').length);
        assert.deepEqual(
            c.writes('messages', 'update')[0].payload.anexos.map((a) => a.name),
            ['b.pdf']
        );
    });

    test('depois de enviar, o formulário volta ao estado inicial; falha no push não trava o envio', async () => {
        const c = client({}, { functions: { 'send-push': () => Promise.reject(new Error('push fora')) } });
        page = await openPage('comunicacao', { client: c, now: NOW });
        const agendados = [];
        const realSetTimeout = page.window.setTimeout.bind(page.window);
        page.window.setTimeout = (fn, ms, ...a) => (ms === 2200 ? agendados.push(fn) : realSetTimeout(fn, ms, ...a));
        await escrever(page, 'Aviso rápido');
        await escolherDestino(page, 'RH');
        await page.click('#cat-toggle-btn');
        await page.click('#cat-inline-grid [data-cat="Urgente"]');
        await page.click('#send-btn');
        await page.waitFor(() => agendados.length);
        assert.equal(c.writes('messages', 'insert')[0].payload[0].categoria, 'Urgente');
        agendados[0]();
        assert.equal(page.$('#message-text').innerHTML, '');
        assert.equal(page.text('#char-count'), '0 caracteres');
        assert.ok(page.$('#cat-inline-grid [data-cat="Institucional"]').classList.contains('active'));
        assert.ok(!page.$('#send-btn').classList.contains('sent-success'));
    });

    test('menus de destino e categoria: um fecha o outro e clicar de novo fecha', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        const aberto = (id) => !page.$(id).classList.contains('hidden');
        await page.click('#cat-toggle-btn');
        assert.ok(aberto('#cat-inline-grid'));
        await page.click('#dest-toggle-btn');
        assert.ok(aberto('#dest-inline-grid'));
        assert.ok(!aberto('#cat-inline-grid'));
        await page.click('#cat-toggle-btn');
        assert.ok(!aberto('#dest-inline-grid'));
        await page.click('#cat-toggle-btn');
        assert.ok(!aberto('#cat-inline-grid'));
        assert.equal(page.$('#cat-toggle-btn').getAttribute('aria-expanded'), 'false');
    });

    test('agendamento: não volta a meses passados, navega entre anos, reabre pelo resumo; desligar limpa', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        await escrever(page, 'Evento');
        await page.check('#schedule-toggle');
        assert.equal(page.$('#schedule-calendar-prev').disabled, true, 'o mês atual não volta');
        assert.ok(page.$('#schedule-calendar-grid .calendar-day--past'), 'dias passados desabilitados');
        for (let i = 0; i < 7; i++) await page.click('#schedule-calendar-next');
        assert.equal(page.text('#schedule-calendar-title'), 'Janeiro 2027');
        await page.click('#schedule-calendar-prev');
        assert.equal(page.text('#schedule-calendar-title'), 'Dezembro 2026');
        await page.click('#schedule-calendar-grid [data-day="10"]');
        await page.fill('#schedule-time-input', '08:00');
        assert.equal(page.visible('#schedule-summary'), true);
        await page.click('#schedule-summary-edit');
        assert.equal(page.visible('#schedule-picker'), true);
        assert.ok(page.$('#schedule-calendar-grid .calendar-day--selected'));
        await page.check('#schedule-toggle', false);
        assert.equal(page.$('#schedule-time-input').value, '');
        assert.equal(page.visible('#schedule-picker'), false);
        assert.equal(page.text('#send-btn'), 'Enviar');
    });

    test('agendar para hoje num horário que já passou é recusado no envio', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        await escrever(page, 'Lembrete');
        await escolherDestino(page, 'Todos');
        await page.check('#schedule-toggle');
        await page.click('#schedule-calendar-grid [data-day="17"]');
        await page.fill('#schedule-time-input', '08:00');
        assert.equal(page.visible('#schedule-summary'), false, 'horário passado não fecha o agendamento');
        await page.click('#send-btn');
        assert.deepEqual(page.alerts, ['Escolha uma data e hora futuras para o agendamento.']);
        assert.equal(c.writes('messages', 'insert').length, 0);
    });

    test('modelos: excluir pede confirmação; lista vazia avisa; erro ao salvar mantém o nome digitado', async () => {
        const c = client();
        const respostas = [false, true];
        page = await openPage('comunicacao', { client: c, now: NOW, confirm: () => respostas.shift() });
        await page.click('#templates-toggle-btn');
        assert.ok(!page.$('#templates-menu').classList.contains('hidden'));
        await page.click('.template-item-delete[data-id="tp1"]');
        assert.equal(c.writes('message_templates', 'delete').length, 0);
        await page.click('.template-item-delete[data-id="tp1"]');
        assert.equal(c.writes('message_templates', 'delete').length, 1);
        assert.match(page.text('#templates-menu-list'), /Nenhum modelo salvo ainda/);
        await page.click('#message-text');
        assert.ok(page.$('#templates-menu').classList.contains('hidden'), 'clique fora fecha');

        c.errors['message_templates:insert'] = { message: 'x' };
        await escrever(page, 'Texto do modelo');
        await page.fill('#template-name-input', 'Aviso');
        await page.click('#templates-save-btn');
        assert.equal(page.$('#template-name-input').value, 'Aviso');
        assert.equal(page.$('#templates-save-btn').disabled, false);
    });

    test('rascunho ilegível é ignorado; falha ao gravar o rascunho não quebra; sair da página grava', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW, localStorage: { nexus_comunicado_draft: '{quebrado' } });
        assert.equal(page.visible('#draft-banner'), false);
        await escrever(page, 'Novo texto');
        page.window.dispatchEvent(new page.window.Event('beforeunload'));
        assert.equal(JSON.parse(page.window.localStorage.getItem('nexus_comunicado_draft')).html, 'Novo texto');

        const proto = page.window.Storage.prototype;
        const original = proto.setItem;
        proto.setItem = () => {
            throw new Error('cota cheia');
        };
        await escrever(page, 'Outro texto');
        page.window.dispatchEvent(new page.window.Event('beforeunload'));
        proto.setItem = original;
        assert.equal(JSON.parse(page.window.localStorage.getItem('nexus_comunicado_draft')).html, 'Novo texto');
    });
});

describe('comunicacao.html — histórico em cartões, anexos e engajamento', () => {
    test('menu do cartão: abre, fecha ao clicar de novo e fora; editar e excluir pelo menu', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        await page.click('#main-toggle-btn');
        const menuBtn = () => page.$('#messages-cards .msg-card-menu-btn[data-id="m2"]');
        await page.click(menuBtn());
        assert.ok(page.$('.msg-card-menu-popover'));
        assert.equal(menuBtn().getAttribute('aria-expanded'), 'true');
        await page.click(menuBtn());
        assert.equal(page.$('.msg-card-menu-popover'), null);
        await page.click(menuBtn());
        await page.click('#search-input');
        assert.equal(page.$('.msg-card-menu-popover'), null);

        await page.click(menuBtn());
        page.$('.msg-card-menu-popover').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.ok(page.$('.msg-card-menu-popover'), 'clique fora dos itens mantém o menu');
        await page.click('.msg-card-menu-popover [data-action="edit"]');
        assert.equal(page.visible('#edit-modal'), true);
        assert.equal(page.$('#edit-message-text').textContent, 'Fechamento');
        await page.click('#edit-modal-close');
        assert.equal(page.visible('#edit-modal'), false);

        await page.click(menuBtn());
        await page.click('.msg-card-menu-popover [data-action="delete"]');
        assert.equal(page.visible('#confirm-delete-modal'), true);
        await page.click('#confirm-delete-cancel');
        assert.equal(page.visible('#confirm-delete-modal'), false);
        await page.click(menuBtn());
        await page.click('.msg-card-menu-popover [data-action="delete"]');
        await page.key('body', 'Escape');
        assert.equal(page.visible('#confirm-delete-modal'), false);
        assert.equal(c.writes('messages', 'delete').length, 0);
    });

    test('expandir o cartão mostra categoria e destino', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        await page.click('#main-toggle-btn');
        const btn = page.$$('#messages-cards .msg-card-expand-btn')[0];
        const detalhes = btn.closest('.msg-card-item').querySelector('.msg-card-details');
        await page.click(btn);
        assert.ok(!detalhes.classList.contains('hidden'));
        assert.equal(btn.getAttribute('aria-expanded'), 'true');
        await page.click(btn);
        assert.ok(detalhes.classList.contains('hidden'));
    });

    test('anexos do comunicado: abre a lista, baixa o arquivo, falha avisa; clicar fora ou de novo fecha', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        const abertos = [];
        page.window.NexusFiles.open = async (bucket, path, o) => {
            abertos.push([bucket, path, o.name]);
            return { error: abertos.length > 1 ? { message: 'Arquivo indisponível.' } : null };
        };
        await page.click('#main-toggle-btn');
        await page.click('#messages-list .attach-badge[data-id="m1"]');
        assert.match(page.text('.attach-popover'), /calendario\.pdf/);
        await page.click('#messages-list .attach-badge[data-id="m1"]');
        assert.equal(page.$('.attach-popover'), null);
        await page.click('#messages-cards .attach-badge[data-id="m1"]');
        await page.click('.attach-popover');
        assert.ok(page.$('.attach-popover'), 'clique fora do item não baixa');
        await page.click('.attach-popover .attach-popover-item');
        assert.deepEqual(abertos[0], ['message-attachments', 'm1/cal.pdf', 'calendario.pdf']);
        assert.equal(page.$('.attach-popover'), null);
        await page.click('#messages-list .attach-badge[data-id="m1"]');
        await page.click('.attach-popover .attach-popover-item');
        assert.deepEqual(page.alerts, ['Arquivo indisponível.']);
        await page.click('#messages-list .attach-badge[data-id="m1"]');
        await page.click('#search-input');
        assert.equal(page.$('.attach-popover'), null);
    });

    test('engajamento: pelo teclado, "quem já leu" pela tabela e pelo cartão, sem leituras, leitor removido; Esc e fechar', async () => {
        const c = client({
            message_reads: [
                {
                    message_id: 'm1',
                    employee_id: ANA.id,
                    read_at: '2026-06-10T11:00:00-03:00',
                    employees: { name: ANA.name, dept: ANA.dept, avatar_url: 'https://cdn.test/ana.png' },
                },
                { message_id: 'm1', employee_id: 'x', read_at: '2026-06-10T12:00:00-03:00', employees: null },
            ],
        });
        page = await openPage('comunicacao', { client: c, now: NOW });
        await page.key('#stat-card-leituras', 'Enter');
        await page.waitFor(() => /Colaborador removido/.test(page.text('#engagement-readers-list')));
        assert.equal(page.text('#engagement-modal-title-text'), 'Engajamento Geral');
        assert.ok(page.$('#engagement-readers-list [data-bg-img="https://cdn.test/ana.png"]'));
        await page.key('body', 'Escape');
        assert.ok(page.$('#engagement-modal').classList.contains('hidden'));
        await page.key('#stat-card-leituras', 'a');
        assert.ok(page.$('#engagement-modal').classList.contains('hidden'));

        await page.click('#main-toggle-btn');
        await page.click('#messages-list .reads-badge[data-id="m2"]');
        await page.waitFor(() => /Nenhuma leitura ainda/.test(page.text('#engagement-readers-list')));
        assert.equal(page.text('#engagement-modal-title-text'), 'Quem já leu');
        assert.ok(page.$('#engagement-summary').classList.contains('hidden'));
        await page.click('#engagement-modal-close');
        assert.ok(page.$('#engagement-modal').classList.contains('hidden'));
        await page.click('#messages-cards .reads-badge[data-id="m1"]');
        await page.waitFor(() => /Ana Souza/.test(page.text('#engagement-readers-list')));
    });

    test('filtro do histórico abre e fecha; voltar no histórico retorna à escrita; na escrita segue o link', async () => {
        page = await openPage('comunicacao', { client: client(), now: NOW });
        await page.click('#main-toggle-btn');
        await page.click('#hist-toggle-btn');
        assert.ok(page.$('#hist-filter-menu').classList.contains('open'));
        await page.click('#hist-toggle-btn');
        assert.ok(!page.$('#hist-filter-menu').classList.contains('open'));
        await page.click('#hist-toggle-btn');
        await page.click('#search-input');
        assert.ok(!page.$('#hist-filter-menu').classList.contains('open'));

        await page.click('#btn-back');
        assert.equal(page.$('#write-section').style.display, 'flex');
        assert.equal(page.$('#main-toggle-btn').getAttribute('title'), 'Comunicados Enviados');
        assert.equal(page.navigations?.length || 0, 0, 'no histórico, voltar não sai da tela');
        await page.click('#btn-fab');
        assert.equal(page.$('#write-section').style.display, 'none');
        await page.click('#btn-fab');
        assert.equal(page.$('#write-section').style.display, 'flex');
        await page.click('#btn-back');
        assert.equal(page.navigations.length, 1, 'na escrita, voltar segue o link');
    });

    test('tempo real: comunicado novo e leitura nova atualizam o histórico e os números', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW });
        await page.click('#main-toggle-btn');
        c.tables.messages.push({ id: 'm9', texto: 'Novo', destino: 'TI', categoria: 'Evento', created_at: '2026-06-17T09:00:00-03:00', anexos: [] });
        c.emit('messages', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => page.$('#messages-list .edit-btn[data-id="m9"]'));
        assert.equal(page.text('#stat-total'), '3');
        c.tables.message_reads.push({ message_id: 'm9', employee_id: BIA.id, read_at: '2026-06-17T09:30:00-03:00' });
        c.emit('message_reads', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => page.text('#stat-reads') === '2');
        assert.equal(page.text('#stat-unread'), '1');
    });
});

describe('comunicacao.html — modal de edição', () => {
    test('trocar destino e categoria, anexar e remover arquivo novo, Esc fecha; editor vazio desabilita salvar', async () => {
        const c = client();
        page = await openPage('comunicacao', { client: c, now: NOW, fetch: async () => new Response('{}', { status: 200 }) });
        await page.click('#main-toggle-btn');
        await page.click(page.$('#messages-list .edit-btn[data-id="m2"]'));
        const aberto = (id) => !page.$(id).classList.contains('hidden');
        await page.click('#edit-dest-toggle-btn');
        assert.ok(aberto('#edit-dest-grid'));
        await page.click('#edit-cat-toggle-btn');
        assert.ok(aberto('#edit-cat-grid'));
        assert.ok(!aberto('#edit-dest-grid'));
        await page.click('#edit-cat-grid [data-cat="Evento"]');
        await page.click('#edit-cat-toggle-btn');
        assert.ok(!aberto('#edit-cat-grid'));
        await page.click('#edit-dest-toggle-btn');
        await page.click('#edit-dest-grid [data-dest="TI"]');
        await page.click('#edit-dest-toggle-btn');
        assert.ok(!aberto('#edit-dest-grid'));

        await page.click('#edit-attach-btn');
        await page.setFiles('#edit-attach-input', [page.file('novo.pdf', '%PDF'), page.file('outro.pdf', '%PDF')]);
        await page.click('#edit-attach-chips .attach-chip-remove[data-kind="new"][data-idx="0"]');
        assert.deepEqual(
            page.$$('#edit-attach-chips .attach-chip-name').map((e) => e.textContent),
            ['outro.pdf']
        );
        page.$('#edit-attach-chips').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));

        await escrever(page, '<br>', '#edit-message-text');
        assert.equal(page.$('#edit-message-text').innerHTML, '');
        assert.equal(page.$('#edit-modal-save').disabled, true);
        await escrever(page, 'Fechamento revisado', '#edit-message-text');
        await page.click('#edit-modal-save');
        await page.waitFor(() => c.writes('messages', 'update').length);
        const upd = c.writes('messages', 'update')[0].payload;
        assert.deepEqual([upd.destino, upd.categoria], ['TI', 'Evento']);
        assert.deepEqual(
            upd.anexos.map((a) => a.name),
            ['outro.pdf']
        );

        await page.click(page.$('#messages-list .edit-btn[data-id="m2"]'));
        await page.key('body', 'Escape');
        assert.equal(page.visible('#edit-modal'), false);
    });
});
