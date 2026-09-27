const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

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
const acao = (obj) => sse('ACTION:' + JSON.stringify(obj));

async function perguntar(p, texto) {
    await p.fill('#chat-input', texto);
    await p.click('#btn-send');
    await p.settle(20);
}

const FALTAS = [
    { id: 'a1', employee_id: ANA.id, tipo: 'falta', date: '2026-06-10', status: 'pendente' },
    { id: 'a2', employee_id: BIA.id, tipo: 'falta', date: '2026-06-11', status: 'pendente' },
    { id: 'a3', employee_id: ANA.id, tipo: 'falta', date: '2026-06-03', status: 'aprovado' },
];

describe('alertas.html — ações da IA sobre ajustes de ponto e burnout', () => {
    test('recusar faltas: o impacto no DSR conta só os pedidos ainda pendentes', async () => {
        const c = client({ adjustment_requests: FALTAS.map((a) => ({ ...a })) });
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => acao({ type: 'reject_adjustment', ids: ['a1', 'a3'], message: 'Recusar faltas da Ana' }),
        });
        await perguntar(page, 'Recuse as faltas da Ana');
        await page.waitFor(() => /Impacto estimado/.test(page.text('.action-impact-preview')));
        assert.match(page.text('.action-impact-preview'), /-R\$\s?133,33.*1 semana de DSR perdido/);
        assert.doesNotMatch(page.text('.action-targets'), /03\/06/);
    });

    test('impacto com mais de um colaborador lista cada um sem escapar o nome duas vezes', async () => {
        const c = client({ adjustment_requests: FALTAS.map((a) => ({ ...a })) });
        c.tables.employees_decrypted.find((e) => e.id === BIA.id).name = 'Bia Lima & Souza';
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => acao({ type: 'reject_adjustment', ids: ['a1', 'a2'], message: 'Recusar' }),
        });
        await perguntar(page, 'Recuse');
        await page.waitFor(() => /Impacto estimado/.test(page.text('.action-impact-preview')));
        const texto = page.text('.action-impact-preview');
        assert.match(texto, /Ana Souza: R\$\s?133,33 · Bia Lima & Souza: R\$\s?266,67/);
        assert.doesNotMatch(texto, /&#39;|&amp;/);
    });

    test('aprovar ajustes chama a RPC para cada pedido e registra a decisão de cada um', async () => {
        const c = client({ adjustment_requests: FALTAS.map((a) => ({ ...a })) }, { rpc: { approve_adjustment_request: {} } });
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => acao({ type: 'approve_adjustment', ids: ['a1', 'a2'], message: 'Aprovar faltas' }),
        });
        await perguntar(page, 'Aprove');
        await page.waitFor(() => !page.$('.btn-do-action').disabled);
        await page.click('.btn-do-action');
        await page.waitFor(() => /Concluído/.test(page.text('.action-confirm-btns')));
        assert.deepEqual(
            c.rpcCalls('approve_adjustment_request').map((x) => [x.args.p_request_id, x.args.p_decision, x.args.p_decided_by_email]),
            [
                ['a1', 'aprovado', RH_USER.email],
                ['a2', 'aprovado', RH_USER.email],
            ]
        );
        assert.deepEqual(
            c.writes('ai_decision_log', 'insert')[0].payload.map((r) => r.target_id),
            ['a1', 'a2']
        );
    });

    test('se um dos ajustes falha, o que foi aplicado continua registrado no log de decisões', async () => {
        const c = client(
            { adjustment_requests: FALTAS.map((a) => ({ ...a })) },
            { rpc: { approve_adjustment_request: (args) => (args.p_request_id === 'a2' ? { error: { message: 'já decidido' } } : {}) } }
        );
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => acao({ type: 'reject_adjustment', ids: ['a1', 'a2'], message: 'Recusar' }),
        });
        await perguntar(page, 'Recuse');
        await page.waitFor(() => !page.$('.btn-do-action').disabled);
        await page.click('.btn-do-action');
        await page.waitFor(() => /Erro ao executar/.test(page.text('.action-confirm-btns')));
        const log = c.writes('ai_decision_log', 'insert');
        assert.equal(log.length, 1, 'o pedido aplicado tem trilha');
        assert.deepEqual(
            log[0].payload.map((r) => [r.target_id, r.action_type]),
            [['a1', 'reject_adjustment']]
        );
    });

    test('marcar alertas de burnout como lidos', async () => {
        const c = client({ burnout_alerts: [{ id: 'b1', employee_id: ANA.id, date: '2026-06-16', lido: false }] });
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => acao({ type: 'mark_burnout_read', ids: ['b1'], message: 'Marcar como lido' }),
        });
        await perguntar(page, 'Marque o alerta como lido');
        await page.waitFor(() => /Ana Souza — alerta de 16\/06\/2026/.test(page.text('.action-targets')));
        await page.click('.btn-do-action');
        await page.waitFor(() => /Concluído/.test(page.text('.action-confirm-btns')));
        assert.equal(c.tables.burnout_alerts[0].lido, true);
    });

    test('cancelar remove o cartão sem executar nada', async () => {
        const c = client({ burnout_alerts: [{ id: 'b1', employee_id: ANA.id, date: '2026-06-16', lido: false }] });
        page = await openPage('alertas', { client: c, now: NOW, fetch: async () => acao({ type: 'mark_burnout_read', ids: ['b1'], message: 'Marcar' }) });
        await perguntar(page, 'Marque');
        await page.click('.btn-cancel-action');
        assert.equal(page.$('.action-confirm-card'), null);
        assert.equal(c.tables.burnout_alerts[0].lido, false);
    });
});

describe('alertas.html — cartões de alerta e histórico', () => {
    const MALICIOSO = { severity: '"><img src=x id=injetado>', category: 'ponto', title: 'Teste', description: 'x' };

    test('severity fora do esperado (vinda da IA) não vira HTML no cartão', async () => {
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            fetch: async () => new Response(JSON.stringify({ content: JSON.stringify({ summary: 's', alerts: [MALICIOSO] }), history: [] }), { status: 200 }),
        });
        await page.click('#btn-analyze');
        await page.waitFor(() => /Teste/.test(page.text('#alerts-body')));
        assert.equal(page.$('#injetado'), null);
        assert.ok(page.$('#alerts-body .alert-card').classList.contains('sev-info'));
        assert.match(page.text('#alerts-body .alert-sev-badge'), /^Info$/);
    });

    test('histórico: tendência, selos por gravidade, resolvidos e severity maliciosa neutralizada', async () => {
        const c = client({
            ai_analysis_history_decrypted: [
                {
                    id: 'h2',
                    summary: 'Semana tensa',
                    health_score: 52,
                    analyzed_at: '2026-06-16T12:00:00Z',
                    alerts: [
                        { severity: 'critical', title: 'Horas extras', category: 'ponto', resolved: true },
                        { severity: 'warning', title: 'Férias vencendo', category: 'ferias' },
                        MALICIOSO,
                    ],
                },
                { id: 'h1', summary: 'Tudo certo', health_score: 91, analyzed_at: '2026-06-09T12:00:00Z', alerts: [] },
            ],
        });
        page = await openPage('alertas', { client: c, now: NOW });
        await page.click('.panel-tab[data-tab="history"]');
        await page.waitFor(() => /Semana tensa/.test(page.text('#history-list')));
        const lista = page.text('#history-list');
        assert.match(lista, /52.*1 crítico.*1 atenção/);
        assert.match(lista, /Horas extras Resolvido/);
        assert.match(lista, /91.*Sem alertas/);
        assert.equal(page.$('#injetado'), null);
        assert.equal(page.charts.length, 1, 'gráfico de tendência');
        assert.deepEqual(page.plain(page.charts[0].config.data.datasets[0].data), [91, 52], 'do mais antigo para o mais recente');
    });

    test('ao reabrir, o cache mostra os alertas e o índice de saúde da última análise', async () => {
        const c = client({
            ai_analysis_cache_decrypted: [
                {
                    cache_key: 'latest',
                    summary: 'Resumo salvo',
                    health_score: 72,
                    analyzed_at: '2026-06-17T08:00:00-03:00',
                    alerts: [{ severity: 'warning', title: 'Documento vencendo', category: 'documentos' }],
                },
            ],
        });
        page = await openPage('alertas', { client: c, now: NOW });
        await page.settle(20);
        assert.match(page.text('#alerts-body'), /Documento vencendo/);
        assert.equal(page.text('#health-score-value'), '72');
        assert.match(page.text('#last-analysis-label'), /Última análise: 08:00/);
    });

    test('resolver um alerta grava no cache; "dispensar todos" limpa a tela', async () => {
        const c = client({
            ai_analysis_cache: [
                {
                    cache_key: 'latest',
                    alerts: [
                        { severity: 'warning', title: 'A' },
                        { severity: 'info', title: 'B' },
                    ],
                },
            ],
            ai_analysis_cache_decrypted: [
                {
                    cache_key: 'latest',
                    summary: 's',
                    health_score: 90,
                    analyzed_at: '2026-06-17T08:00:00-03:00',
                    alerts: [
                        { severity: 'warning', title: 'A' },
                        { severity: 'info', title: 'B' },
                    ],
                },
            ],
        });
        page = await openPage('alertas', { client: c, now: NOW });
        await page.settle(20);
        await page.click('#alerts-body .alert-card[data-idx="1"] .btn-resolve');
        await page.settle(20);
        const upd = c.writes('ai_analysis_cache', 'update')[0].payload;
        assert.deepEqual(
            upd.alerts.map((a) => !!a.resolved),
            [false, true]
        );
        await page.click('#btn-dismiss-all');
        assert.match(page.text('#alerts-body'), /Nexus AI pronto/);
    });
});

describe('alertas.html — relatório', () => {
    test('gera o relatório sem HTML perigoso e copia o texto', async () => {
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            fetch: async (url, init) => {
                assert.equal(JSON.parse(init.body).action, 'report');
                return new Response(JSON.stringify({ content: '# Relatório\n<script>alert(1)</script>Tudo em dia' }), { status: 200 });
            },
        });
        await page.click('#btn-report');
        await page.waitFor(() => page.$('#report-modal').classList.contains('open'));
        assert.equal(page.$('#report-content script'), null);
        assert.match(page.text('#report-content'), /Relatório/);
        await page.click('#btn-copy-report');
        assert.match(page.clipboard.at(-1), /Relatório/);
        assert.equal(page.$('#btn-report').disabled, false);
    });

    test('falha ao gerar vira mensagem no chat e o botão volta', async () => {
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            fetch: async () => new Response(JSON.stringify({ error: 'cota esgotada' }), { status: 429 }),
        });
        await page.click('#btn-report');
        await page.waitFor(() => /Não foi possível gerar o relatório: .*cota esgotada/.test(page.text('#chat-messages')));
        assert.equal(page.$('#btn-report').disabled, false);
        assert.equal(page.$('#report-modal').classList.contains('open'), false);
    });
});

describe('alertas.html — notificações push do RH', () => {
    test('ativar grava a inscrição no servidor e mostra "ativas"; desativar apaga', async () => {
        const c = client();
        page = await openPage('alertas', { client: c, now: NOW, push: { permission: 'granted' } });
        await page.settle(20);
        await page.click('#btn-notif-toggle');
        await page.settle(20);
        assert.equal(c.tables.admin_push_subscriptions[0].endpoint, 'https://push.test/sub-1');
        assert.equal(page.text('#btn-notif-label'), 'Notificações ativas');
        await page.click('#btn-notif-toggle');
        await page.settle(20);
        assert.equal(c.tables.admin_push_subscriptions.length, 0);
        assert.equal(page.text('#btn-notif-label'), 'Ativar notificações');
        assert.equal(page.push.subscribed, false);
    });

    test('se o servidor não grava a inscrição, não finge que está ativo', async () => {
        const c = client();
        c.errors['admin_push_subscriptions:upsert'] = { message: 'rls' };
        page = await openPage('alertas', { client: c, now: NOW, push: { permission: 'granted' } });
        await page.settle(20);
        await page.click('#btn-notif-toggle');
        await page.settle(20);
        assert.equal(page.text('#btn-notif-label'), 'Ativar notificações');
        assert.equal(page.push.subscribed, false, 'desfaz a inscrição local');
        assert.match(page.text('#chat-messages'), /Não foi possível ativar as notificações/);
    });

    test('permissão bloqueada no navegador: explica como liberar', async () => {
        page = await openPage('alertas', { client: client(), now: NOW, push: { permission: 'denied' } });
        await page.settle(20);
        await page.click('#btn-notif-toggle');
        await page.settle(20);
        assert.match(page.text('#chat-messages'), /bloqueadas neste navegador/);
        assert.equal(page.$('#btn-notif-toggle').disabled, false);
    });
});
