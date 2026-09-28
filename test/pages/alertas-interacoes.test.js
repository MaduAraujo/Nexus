const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';

function client(extra = {}, opts = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            ai_analysis_cache: [],
            ai_analysis_cache_decrypted: [],
            ai_analysis_history: [],
            ai_analysis_history_decrypted: [],
            ai_chat_history: [],
            ai_chat_history_decrypted: [],
            ai_decision_memory: [],
            ai_decision_log: [],
            vacations: [],
            adjustment_requests: [],
            burnout_alerts: [],
            compliance_alerts: [],
            time_records: [],
            bank_adjustments: [],
            hr_tickets: [],
            documents: [],
            kudos: [],
            anonymous_feedback: [],
            anonymous_feedback_decrypted: [],
            admin_push_subscriptions: [],
            ...extra,
        }),
        ...opts,
    });
}

const sse = (text) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\ndata: [DONE]\n`, { status: 200 });
const analise = (content) => new Response(JSON.stringify({ content, history: [] }), { status: 200 });

async function abrirAba(p, aba) {
    await p.click(`.panel-tab[data-tab="${aba}"]`);
    await p.waitFor(() => !/Calculando|Cruzando|Verificando|Levantando|Carregando/.test(p.text(`#${aba}-body`)));
}

describe('alertas.html — push do RH no iPhone e renovação da inscrição', () => {
    test('iPhone sem o app instalado explica que precisa instalar antes', async () => {
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            push: { permission: 'granted' },
            before: (w) => Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: IPHONE }),
        });
        await page.settle(20);
        assert.match(page.$('#btn-notif-toggle').title, /Instale o app na Tela de Início/);
        await page.click('#btn-notif-toggle');
        await page.settle(20);
        assert.match(page.text('#chat-messages'), /Instale o app na Tela de Início .* para ativar notificações push/);
        assert.equal(page.push.subscribed, false);
    });

    test('iPhone com o app instalado ativa normalmente', async () => {
        const c = client();
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            push: { permission: 'granted' },
            before: (w) => {
                Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: IPHONE });
                Object.defineProperty(w.navigator, 'standalone', { configurable: true, value: true });
            },
        });
        await page.settle(20);
        await page.click('#btn-notif-toggle');
        await page.settle(20);
        assert.equal(c.tables.admin_push_subscriptions.length, 1);
    });

    test('inscrição já existente é ressincronizada ao abrir; renovação pelo navegador também é gravada', async () => {
        const ouvintes = [];
        const c = client();
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            push: { permission: 'granted', subscribed: true },
            before: (w) => {
                w.navigator.serviceWorker.addEventListener = (tipo, cb) => tipo === 'message' && ouvintes.push(cb);
            },
        });
        await page.settle(20);
        assert.equal(c.writes('admin_push_subscriptions', 'upsert').length, 1);
        assert.equal(page.text('#btn-notif-label'), 'Notificações ativas');

        const nova = { endpoint: 'https://push.test/sub-2', keys: { p256dh: 'k', auth: 'a' } };
        ouvintes.forEach((cb) => cb({ data: { type: 'OUTRO', subscription: nova } }));
        ouvintes.forEach((cb) => cb({ data: { type: 'PUSH_SUBSCRIPTION_CHANGED' } }));
        await page.settle();
        assert.equal(c.writes('admin_push_subscriptions', 'upsert').length, 1);
        ouvintes.forEach((cb) => cb({ data: { type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: nova } }));
        await page.settle();
        assert.equal(c.writes('admin_push_subscriptions', 'upsert')[1].payload[0].endpoint, 'https://push.test/sub-2');
    });
});

describe('alertas.html — análise e chat: formatos inesperados e erros', () => {
    test('resposta da IA com texto em volta do JSON é aproveitada; texto puro vira resumo', async () => {
        const respostas = [
            analise(
                'Aqui está: {"summary":"Resumo ok","alerts":[{"severity":"warning","title":"Férias acumuladas","description":"d","category":"ferias"}]} fim'
            ),
            analise('Sem JSON nenhum aqui'),
        ];
        page = await openPage('alertas', { client: client(), now: NOW, fetch: async () => respostas.shift() });
        await page.click('#btn-analyze');
        await page.waitFor(() => /Férias acumuladas/.test(page.text('#alerts-body')));
        await page.click('#btn-analyze');
        await page.waitFor(() => /Tudo em ordem!/.test(page.text('#alerts-body')));
        assert.match(page.text('#alerts-body'), /Sem JSON nenhum aqui/);
        assert.equal(page.$('#btn-dismiss-all').style.display, 'none');
    });

    test('dispensar o último alerta limpa o painel; chips da análise perguntam ao chat', async () => {
        const perguntas = [];
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            fetch: async (url, init) => {
                const body = JSON.parse(init.body);
                if (body.action === 'chat') {
                    perguntas.push(body.message);
                    return sse('Resposta');
                }
                return analise(
                    JSON.stringify({ summary: 's', alerts: [{ severity: 'critical', title: 'Burnout na equipe', description: 'd', category: 'burnout' }] })
                );
            },
        });
        await page.click('#btn-analyze');
        await page.waitFor(() => page.$('.chat-suggestions-dynamic .suggestion-chip'));
        await page.click(page.$('.chat-suggestions-dynamic'));
        assert.ok(page.$('.chat-suggestions-dynamic'), 'clique fora de um chip não faz nada');
        const chip = page.$('.chat-suggestions-dynamic .suggestion-chip');
        const texto = chip.textContent.trim();
        await page.click(chip);
        await page.waitFor(() => perguntas.length === 1);
        assert.equal(perguntas[0], texto);
        assert.equal(page.$('.chat-suggestions-dynamic'), null);

        await page.click('.alert-card-dismiss');
        assert.match(page.text('#alerts-body'), /Nexus AI pronto/);
    });

    test('Enter envia, Shift+Enter não; o botão acompanha o texto; chip inicial pergunta', async () => {
        const perguntas = [];
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            fetch: async (url, init) => {
                perguntas.push(JSON.parse(init.body).message);
                return sse('ok');
            },
        });
        const input = page.$('#chat-input');
        await page.fill(input, 'Oi');
        assert.equal(page.$('#btn-send').disabled, false);
        await page.fill(input, '   ');
        assert.equal(page.$('#btn-send').disabled, true);
        await page.fill(input, 'Quantas férias?');
        await page.key(input, 'Enter', { shiftKey: true });
        assert.equal(perguntas.length, 0);
        await page.key(input, 'Enter');
        await page.waitFor(() => perguntas.length === 1);
        await page.waitFor(() => !page.$('#btn-send').disabled || !page.$('#chat-input').value);

        await page.click('#chat-suggestions-initial');
        await page.click(page.$('#chat-suggestions-initial .suggestion-chip'));
        await page.waitFor(() => perguntas.length === 2);
    });

    test('chat: erro do servidor e ação ilegível viram mensagens claras', async () => {
        const respostas = [
            new Response(JSON.stringify({ error: 'modelo indisponível' }), { status: 503 }),
            new Response('não é json', { status: 500 }),
            sse('ACTION:{isto não é json'),
        ];
        page = await openPage('alertas', { client: client(), now: NOW, fetch: async () => respostas.shift() });
        const perguntar = async (t) => {
            await page.fill('#chat-input', t);
            await page.click('#btn-send');
            await page.settle(20);
        };
        await perguntar('a');
        await page.waitFor(() => /Erro ao processar sua pergunta: modelo indisponível/.test(page.text('#chat-messages')));
        await perguntar('b');
        await page.waitFor(() => /Erro ao processar sua pergunta: Erro 500/.test(page.text('#chat-messages')));
        await perguntar('c');
        await page.waitFor(() => /Não foi possível processar a ação solicitada/.test(page.text('#chat-messages')));
    });

    test('se não der para conferir os registros da ação, avisa e não deixa confirmar', async () => {
        const c = client();
        c.errors.vacations = () => {
            throw new Error('rede');
        };
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => sse('ACTION:' + JSON.stringify({ type: 'approve_vacation', ids: ['v1'], message: 'Aprovar' })),
        });
        await page.fill('#chat-input', 'Aprove');
        await page.click('#btn-send');
        await page.waitFor(() => /Não foi possível conferir os registros/.test(page.text('.action-targets')));
    });

    test('recusar férias pela IA grava a recusa com o motivo padrão; ação desconhecida não executa nada', async () => {
        const c = client({ vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2026-07-01', end_date: '2026-07-10', days: 10, status: 'pendente' }] });
        const acoes = [
            { type: 'reject_vacation', ids: ['v1'], message: 'Recusar' },
            { type: 'apagar_tudo', ids: ['v1'], message: 'Apagar' },
        ];
        page = await openPage('alertas', { client: c, now: NOW, fetch: async () => sse('ACTION:' + JSON.stringify(acoes.shift())) });
        await page.fill('#chat-input', 'Recuse');
        await page.click('#btn-send');
        await page.waitFor(() => !page.$('.btn-do-action')?.disabled);
        await page.click('.btn-do-action');
        await page.waitFor(() => /Concluído/.test(page.text('.action-confirm-btns')));
        assert.deepEqual([c.tables.vacations[0].status, c.tables.vacations[0].rejection_reason], ['recusado', 'Recusada pelo RH via assistente de IA.']);

        await page.fill('#chat-input', 'Apague');
        await page.click('#btn-send');
        await page.waitFor(() => page.$$('.action-targets').length === 2 && /Nenhum registro pendente/.test(page.text(page.$$('.action-targets')[1])));
        const cards = page.$$('.btn-do-action');
        assert.equal(cards[cards.length - 1].disabled, true, 'ação que a tela não conhece não pode ser confirmada');
        assert.equal(c.writes('ai_decision_log', 'insert').length, 1, 'só a recusa foi registrada');
    });
});

describe('alertas.html — relatório, histórico e abas com erro', () => {
    test('relatório fecha pelo fundo escuro; "Copiado!" volta ao texto original', async () => {
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            fetch: async () => new Response(JSON.stringify({ content: '# Relatório' }), { status: 200 }),
        });
        await page.click('#btn-report');
        await page.waitFor(() => page.$('#report-modal').classList.contains('open'));
        await page.click('#report-content');
        assert.equal(page.$('#report-modal').classList.contains('open'), true);
        await page.click('#report-modal');
        assert.equal(page.$('#report-modal').classList.contains('open'), false);
        assert.equal(page.document.body.style.overflow, '');

        const original = page.$('#btn-copy-report').innerHTML;
        const w = page.window;
        const agendados = [];
        const st = w.setTimeout;
        w.setTimeout = (fn, ms) => (ms === 2000 ? agendados.push(fn) : st(fn, ms));
        await page.click('#btn-copy-report');
        await page.settle();
        w.setTimeout = st;
        assert.match(page.$('#btn-copy-report').innerHTML, /Copiado!/);
        agendados.forEach((f) => f());
        assert.equal(page.$('#btn-copy-report').innerHTML, original);
    });

    test('histórico: carrega uma vez só (voltar à aba não consulta de novo); erro ao carregar avisa', async () => {
        const hist = [
            { id: 'h1', summary: 'a', health_score: 70, alerts: [], analyzed_at: '2026-06-10T10:00:00Z' },
            { id: 'h2', summary: 'b', health_score: 80, alerts: [], analyzed_at: '2026-06-12T10:00:00Z' },
        ];
        const c = client({ ai_analysis_history_decrypted: hist });
        page = await openPage('alertas', { client: c, now: NOW });
        await abrirAba(page, 'history');
        assert.ok(page.window._trendChart, 'gráfico de tendência desenhado');
        await page.click('.panel-tab[data-tab="risco"]');
        await abrirAba(page, 'history');
        assert.equal(c.calls.filter((x) => x.table === 'ai_analysis_history_decrypted').length, 1);
        assert.deepEqual(page.pageErrors.map(String), []);
        page.close();

        const e = client();
        e.errors.ai_analysis_history_decrypted = () => {
            throw new Error('rede');
        };
        page = await openPage('alertas', { client: e, now: NOW });
        await page.click('.panel-tab[data-tab="history"]');
        await page.waitFor(() => /Erro ao carregar histórico/.test(page.text('#history-list')));
    });

    test('risco composto, jurídico, compliance e gestores: falha na consulta vira mensagem de erro', async () => {
        const falha = () => {
            throw new Error('rede');
        };
        const c = client();
        c.errors.employees = falha;
        c.errors.documents = falha;
        c.errors.vacations = falha;
        page = await openPage('alertas', { client: c, now: NOW });
        await page.click('.panel-tab[data-tab="risco"]');
        await page.waitFor(() => /Erro ao cruzar os dados/.test(page.text('#risco-list')));
        await page.click('.panel-tab[data-tab="juridico"]');
        await page.waitFor(() => /Erro ao calcular o score/.test(page.text('#juridico-list')));
        await page.click('.panel-tab[data-tab="compliance"]');
        await page.waitFor(() => /Erro ao verificar prazos/.test(page.text('#compliance-list')));
        await page.click('.panel-tab[data-tab="gestores"]');
        await page.waitFor(() => /Erro ao levantar os gestores/.test(page.text('#gestores-list')));
    });

    test('compliance sem nada vencendo mostra o estado vazio; alerta do robô de compliance entra na lista', async () => {
        page = await openPage('alertas', { client: client({ documents: [] }), now: NOW });
        await abrirAba(page, 'compliance');
        assert.match(page.text('#compliance-list'), /Nenhuma pendência de compliance/);
        assert.equal(page.$('#compliance-summary-count').classList.contains('hidden'), true);
        page.close();

        const c = client({
            documents: [{ id: 'd1', employee_id: BIA.id, name: 'aso.pdf', tipo: 'ASO', data_validade: '2026-07-01' }],
            compliance_alerts: [{ employee_id: ANA.id, lido: false, alertas: [{ nivel: 'atencao', titulo: 'Fim da experiência em 10 dias' }] }],
        });
        page = await openPage('alertas', { client: c, now: NOW });
        await abrirAba(page, 'compliance');
        assert.match(page.text('#compliance-list'), /Fim da experiência em 10 dias/);
        assert.equal(page.text('#compliance-summary-count'), '2');
    });

    test('risco composto: banco de horas 20h negativo no mês conta como sinal (extras e ajustes entram na conta)', async () => {
        const dia = (d, saida) => ({
            employee_id: ANA.id,
            date: `2026-06-${d}`,
            entrada: `2026-06-${d}T08:00:00-03:00`,
            saida_almoco: `2026-06-${d}T12:00:00-03:00`,
            retorno_almoco: `2026-06-${d}T13:00:00-03:00`,
            saida: `2026-06-${d}T${saida}:00-03:00`,
        });
        const curtos = ['01', '02', '03', '04', '05', '08', '09', '10', '11', '12'].map((d) => dia(d, '15:00'));
        const c = client({
            time_records: [...curtos, dia('15', '18:00'), { employee_id: ANA.id, date: '2026-06-16', entrada: '2026-06-16T08:00:00-03:00' }],
            bank_adjustments: [
                { employee_id: ANA.id, tipo: 'debito', minutos: 90, date: '2026-06-05', deleted_at: null },
                { employee_id: ANA.id, tipo: 'credito', minutos: 30, date: '2026-06-06', deleted_at: null },
                { employee_id: ANA.id, tipo: 'credito', minutos: 999, date: null, deleted_at: null },
            ],
            hr_tickets: [{ employee_id: ANA.id, subject: 'Horas', status: 'em_atendimento' }],
        });
        page = await openPage('alertas', { client: c, now: NOW });
        await abrirAba(page, 'risco');
        assert.match(page.text('#risco-list'), /Banco de horas: -20h 00min/);
    });

    test('comunidade: alternar entre kudos e feedback e filtrar por status', async () => {
        const c = client({
            anonymous_feedback_decrypted: [
                { id: 'f1', categoria: 'clima', message: 'Clima ruim', status: 'novo', created_at: '2026-06-16T10:00:00-03:00' },
                { id: 'f2', categoria: 'clima', message: 'Já resolvido', status: 'lido', created_at: '2026-06-15T10:00:00-03:00' },
            ],
        });
        page = await openPage('alertas', { client: c, now: NOW });
        await page.click('.panel-tab[data-tab="comunidade"]');
        await page.settle(20);
        await page.click('.comunidade-subtab[data-subtab="feedback"]');
        assert.equal(page.$('#comunidade-kudos-list').classList.contains('hidden'), true);
        assert.equal(page.$('#comunidade-feedback-wrap').classList.contains('hidden'), false);

        const filtro = (f) => page.click(`.anon-feedback-filters .af-chip[data-filter="${f}"]`);
        await filtro('lido');
        assert.match(page.text('#comunidade-feedback-list'), /Já resolvido/);
        assert.doesNotMatch(page.text('#comunidade-feedback-list'), /Clima ruim/);
        const vazio = page
            .$$('.anon-feedback-filters .af-chip')
            .map((b) => b.dataset.filter)
            .find((f) => f !== 'all' && f !== 'lido' && f !== 'novo');
        if (vazio) {
            await filtro(vazio);
            assert.match(page.text('#comunidade-feedback-list'), /Nenhum feedback encontrado/);
        }
        await filtro('all');
        assert.match(page.text('#comunidade-feedback-list'), /Clima ruim.*Já resolvido|Já resolvido.*Clima ruim/);

        await page.click('.comunidade-subtab[data-subtab="kudos"]');
        assert.equal(page.$('#comunidade-kudos-list').classList.contains('hidden'), false);
    });

    test('depois de limpar a conversa, os chips iniciais continuam perguntando ao chat', async () => {
        const perguntas = [];
        const c = client({ ai_chat_history_decrypted: [{ role: 'user', content: 'Oi' }] });
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async (url, init) => {
                perguntas.push(JSON.parse(init.body).message);
                return sse('ok');
            },
        });
        await page.click('#btn-clear-chat');
        await page.settle(20);
        await page.click('#chat-suggestions-initial');
        await page.click(page.$('#chat-suggestions-initial .suggestion-chip'));
        await page.waitFor(() => perguntas.length === 1);
    });
});

describe('alertas.html — um aviso por falha no chat da IA', () => {
    const esperarAvisoGlobal = () => new Promise((r) => setTimeout(r, 700));

    test('falha ao executar a ação da IA aparece só no cartão, sem o aviso genérico do servidor', async () => {
        const c = client({ vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2026-07-01', end_date: '2026-07-10', days: 10, status: 'pendente' }] });
        c.errors['vacations:update'] = { message: 'permission denied' };
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => sse('ACTION:' + JSON.stringify({ type: 'approve_vacation', ids: ['v1'], message: 'Aprovar' })),
        });
        await page.fill('#chat-input', 'Aprove');
        await page.click('#btn-send');
        await page.waitFor(() => !page.$('.btn-do-action')?.disabled);
        await page.click('.btn-do-action');
        await page.waitFor(() => /Erro ao executar/.test(page.text('.action-confirm-btns')));
        assert.ok(page.$('.action-status.fail[role="alert"]'));
        await esperarAvisoGlobal();
        assert.equal(
            page.toasts().some((t) => /Erro ao comunicar com o servidor/.test(t)),
            false
        );
    });

    test('servidor recusa a inscrição de push: só a mensagem do chat, anunciada como alerta', async () => {
        const c = client();
        c.errors['admin_push_subscriptions:upsert'] = { message: 'rls' };
        page = await openPage('alertas', { client: c, now: NOW, push: { permission: 'granted' } });
        await page.settle(20);
        await page.click('#btn-notif-toggle');
        await page.settle(20);
        const aviso = page.$$('#chat-messages .chat-message[role="alert"]').at(-1);
        assert.match(page.text(aviso), /Não foi possível ativar as notificações/);
        await esperarAvisoGlobal();
        assert.equal(
            page.toasts().some((t) => /Erro ao comunicar com o servidor/.test(t)),
            false
        );
    });

    test('resposta normal da IA não é marcada como alerta; erro da pergunta é', async () => {
        const respostas = [sse('Tudo certo por aqui.'), new Response(JSON.stringify({ error: 'fora do ar' }), { status: 503 })];
        page = await openPage('alertas', { client: client(), now: NOW, fetch: async () => respostas.shift() });
        await page.fill('#chat-input', 'Oi');
        await page.click('#btn-send');
        await page.waitFor(() => /Tudo certo por aqui/.test(page.text('#chat-messages')));
        assert.equal(page.$$('#chat-messages .chat-message[role="alert"]').length, 0);
        await page.fill('#chat-input', 'De novo');
        await page.click('#btn-send');
        await page.waitFor(() => /Erro ao processar sua pergunta: fora do ar/.test(page.text('#chat-messages')));
        assert.equal(page.$$('#chat-messages .chat-message[role="alert"]').length, 1);
    });
});
