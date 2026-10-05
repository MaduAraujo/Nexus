const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const MODULO = path.join(__dirname, '..', 'src', 'javascript', 'shared', 'chat-unread.js');

const SIDEBAR = `
<nav class="sidebar-nav"><ul>
  <li><a href="../screens/chat-colaborador.html" class="nav-link"><span class="nav-text">Chat</span></a></li>
  <li><a href="../screens/perfil-colaborador.html" class="nav-link"><span class="nav-text">Perfil</span></a></li>
</ul></nav>`;

let dom;
let rpcs;
let resumo;
let erros;
let canais;
let sessao;
let visibilidade;

function fakeSb() {
    return {
        auth: { getSession: async () => ({ data: { session: sessao } }) },
        rpc: async (name, args) => {
            rpcs.push({ name, args });
            if (erros[name]) return { data: null, error: { message: erros[name] } };
            return { data: name === 'chat_unread_summary' ? (typeof resumo === 'function' ? resumo() : resumo) : null, error: null };
        },
        channel: (name) => {
            const ch = { name, handlers: [], subscribed: false };
            ch.on = (type, filter, cb) => {
                ch.handlers.push({ type, filter, cb });
                return ch;
            };
            ch.subscribe = () => {
                ch.subscribed = true;
                return ch;
            };
            canais.push(ch);
            return ch;
        },
    };
}

function carregar({ comSb = true } = {}) {
    dom = new JSDOM(`<!DOCTYPE html><body>${SIDEBAR}</body>`, { url: 'http://localhost/src/screens/inicio-colaborador.html' });
    Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, get: () => visibilidade });
    global.window = dom.window;
    global.document = dom.window.document;
    if (comSb) global.sb = fakeSb();
    else delete global.sb;
    delete require.cache[MODULO];
    return require(MODULO);
}

const badge = () => dom.window.document.querySelector('a[href*="chat-colaborador"] .nav-badge');
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
    rpcs = [];
    resumo = [];
    erros = {};
    canais = [];
    sessao = { access_token: 't' };
    visibilidade = 'visible';
});

afterEach(() => {
    dom?.window.close();
    delete global.window;
    delete global.document;
    delete global.sb;
});

describe('NexusChatUnread — contagem e badge do sidebar', () => {
    test('soma as não lidas do servidor e mostra no link do Chat; outros links ficam sem badge', async () => {
        resumo = [
            { kind: 'channel', thread: 'c1', unread: 2 },
            { kind: 'ticket', thread: 't1', unread: 1 },
            { kind: 'channel', thread: 'c2', unread: 0 },
        ];
        const u = carregar();
        assert.equal(await u.iniciar(), true);
        assert.equal(badge().textContent, '3');
        assert.equal(badge().classList.contains('hidden'), false);
        assert.equal(badge().getAttribute('aria-label'), '3 mensagens não lidas');
        assert.equal(dom.window.document.querySelector('a[href*="perfil"] .nav-badge'), null);
        assert.equal(u.contar('channel', 'c1'), 2);
        assert.equal(u.contar('channel', 'c2'), 0);
        assert.equal(u.total('channel'), 2);
        assert.equal(u.total('ticket'), 1);
    });

    test('sem não lidas o badge fica escondido; uma só usa o singular; acima de 99 vira 99+', async () => {
        const u = carregar();
        await u.iniciar();
        assert.equal(badge().classList.contains('hidden'), true);

        resumo = [{ kind: 'channel', thread: 'c1', unread: 1 }];
        await u.atualizar();
        assert.equal(badge().getAttribute('aria-label'), '1 mensagem não lida');

        resumo = [{ kind: 'channel', thread: 'c1', unread: 150 }];
        await u.atualizar();
        assert.equal(badge().textContent, '99+');
        assert.equal(u.rotulo(99), '99');
    });

    test('resposta nula ou erro do servidor não quebra nem apaga o que já estava', async () => {
        resumo = null;
        const u = carregar();
        await u.iniciar();
        assert.equal(u.total(), 0);

        resumo = [{ kind: 'channel', thread: 'c1', unread: 4 }];
        await u.atualizar();
        erros.chat_unread_summary = 'falhou';
        assert.equal(await u.atualizar(), false);
        assert.equal(badge().textContent, '4');
    });

    test('sem sessão ou sem cliente Supabase não consulta nada', async () => {
        sessao = null;
        let u = carregar();
        assert.equal(await u.iniciar(), false);
        assert.equal(rpcs.length, 0);

        u = carregar({ comSb: false });
        assert.equal(await u.iniciar(), false);
    });

    test('não consulta nada até a tela liberar o acesso e chamar iniciar; iniciar é idempotente', async () => {
        const u = carregar();
        await espera(5);
        assert.equal(rpcs.length, 0);
        assert.equal(canais.length, 0);
        const p = u.iniciar();
        assert.equal(u.iniciar(), p);
        await p;
        assert.equal(rpcs.filter((r) => r.name === 'chat_unread_summary').length, 1);
    });
});

describe('NexusChatUnread — conversa aberta e tempo real', () => {
    test('abrir marca como lida no servidor e zera na hora; reabrir a mesma não repete', async () => {
        resumo = [{ kind: 'channel', thread: 'c1', unread: 2 }];
        const u = carregar();
        await u.iniciar();
        assert.equal(await u.abrir('channel', 'c1'), true);
        assert.deepEqual(rpcs.at(-1), { name: 'chat_mark_read', args: { p_kind: 'channel', p_thread: 'c1' } });
        assert.equal(badge().classList.contains('hidden'), true);

        const antes = rpcs.length;
        assert.equal(await u.abrir('channel', 'c1'), true);
        assert.equal(rpcs.length, antes);

        assert.equal(await u.abrir(null), true);
        assert.equal(await u.abrir('ticket', null), true);
    });

    test('falha ao marcar como lida devolve false', async () => {
        const u = carregar();
        await u.iniciar();
        erros.chat_mark_read = 'negado';
        assert.equal(await u.marcarLida('ticket', 't9'), false);
    });

    test('mensagem que chega na conversa aberta, com a aba visível, já entra como lida', async () => {
        const u = carregar();
        await u.iniciar();
        await u.abrir('channel', 'c1');
        resumo = [
            { kind: 'channel', thread: 'c1', unread: 1 },
            { kind: 'channel', thread: 'c2', unread: 1 },
        ];
        const marcadas = rpcs.filter((r) => r.name === 'chat_mark_read').length;
        await u.atualizar();
        assert.equal(u.contar('channel', 'c1'), 0);
        assert.equal(u.contar('channel', 'c2'), 1);
        assert.equal(rpcs.filter((r) => r.name === 'chat_mark_read').length, marcadas + 1);
    });

    test('com a aba escondida a conversa aberta conta como não lida; ao voltar, atualiza e marca', async () => {
        const u = carregar();
        await u.iniciar();
        await u.abrir('channel', 'c1');
        visibilidade = 'hidden';
        resumo = [{ kind: 'channel', thread: 'c1', unread: 2 }];
        await u.atualizar();
        assert.equal(badge().textContent, '2');

        dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
        await espera(5);
        assert.equal(u.contar('channel', 'c1'), 2);

        visibilidade = 'visible';
        dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
        await espera(5);
        assert.equal(u.contar('channel', 'c1'), 0);
        assert.deepEqual(rpcs.at(-1).args, { p_kind: 'channel', p_thread: 'c1' });
    });

    test('assina mensagens, atendimentos e leituras; vários eventos juntos viram uma consulta só', async () => {
        const u = carregar();
        await u.iniciar();
        const ch = canais.find((c) => c.name === 'chat-unread');
        assert.ok(ch.subscribed);
        assert.deepEqual(
            ch.handlers.map((h) => [h.filter.event, h.filter.table]),
            [
                ['INSERT', 'chat_messages'],
                ['INSERT', 'hr_ticket_messages'],
                ['*', 'hr_tickets'],
                ['*', 'chat_reads'],
            ]
        );
        const antes = rpcs.filter((r) => r.name === 'chat_unread_summary').length;
        resumo = [{ kind: 'ticket', thread: 't1', unread: 1 }];
        ch.handlers.forEach((h) => h.cb({}));
        await espera(400);
        assert.equal(rpcs.filter((r) => r.name === 'chat_unread_summary').length, antes + 1);
        assert.equal(badge().textContent, '1');
    });

    test('aoMudar avisa na hora e a cada atualização, até cancelar', async () => {
        const u = carregar();
        await u.iniciar();
        const vistos = [];
        const cancelar = u.aoMudar((api) => vistos.push(api.total()));
        resumo = [{ kind: 'channel', thread: 'c1', unread: 5 }];
        await u.atualizar();
        cancelar();
        resumo = [];
        await u.atualizar();
        assert.deepEqual(vistos, [0, 5]);
    });
});
