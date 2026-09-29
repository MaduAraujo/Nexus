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
            bank_requests: [],
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
const erro = { message: 'falhou' };
const lancar = () => {
    throw new Error('rede');
};
const naSegunda = () => {
    let n = 0;
    return () => (++n === 2 ? erro : null);
};

async function perguntar(p, texto) {
    await p.fill('#chat-input', texto);
    await p.click('#btn-send');
    await p.settle(20);
}

async function abrirAba(p, aba) {
    await p.click(`.panel-tab[data-tab="${aba}"]`);
    await p.waitFor(() => !/Calculando|Cruzando|Verificando|Levantando|Carregando/.test(p.text(`#${aba}-body`)));
}

function semDept(c, id) {
    c.tables.employees.find((e) => e.id === id).dept = null;
}

describe('alertas.html — bordas do push, da análise e do chat', () => {
    test('falha genérica ao assinar o push mostra a mensagem padrão, não a de bloqueio', async () => {
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            push: { permission: 'granted' },
            before: (w) =>
                w.navigator.serviceWorker.ready.then((r) => {
                    r.pushManager.subscribe = async () => {
                        throw new Error('rede');
                    };
                }),
        });
        await page.settle(20);
        await page.click('#btn-notif-toggle');
        await page.settle(20);
        const aviso = page.$$('#chat-messages .chat-message[role="alert"]').at(-1);
        assert.match(page.text(aviso), /Não foi possível ativar as notificações agora/);
        assert.doesNotMatch(page.text(aviso), /bloqueadas/);
    });

    test('análise sem summary, alerts e history: conta zero alertas e grava vazio; segundo clique durante a análise é ignorado', async () => {
        const c = client();
        let chamadas = 0;
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => {
                chamadas++;
                return new Response(JSON.stringify({ content: '{}' }), { status: 200 });
            },
        });
        page.eval('runAnalysis(); runAnalysis();');
        await page.settle(30);
        assert.equal(chamadas, 1);
        assert.match(page.text('#chat-messages'), /Encontrei\s*0\s*alerta/);
        assert.equal(c.writes('ai_analysis_history', 'insert')[0].payload[0].summary, '');
        assert.equal(c.writes('ai_analysis_cache', 'upsert')[0].payload[0].summary, '');
    });

    test('enviar vazio ou durante outra operação não chama a IA; relatório e sugestão também esperam', async () => {
        let chamadas = 0;
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            fetch: async () => {
                chamadas++;
                return sse('oi');
            },
        });
        await page.key('#chat-input', 'Enter');
        page.eval('isLoading = true');
        await page.fill('#chat-input', 'Olá');
        await page.key('#chat-input', 'Enter');
        page.eval(`sendSuggestion('Resumo'); generateReport();`);
        await page.settle(20);
        assert.equal(chamadas, 0);
        assert.match(page.$('#btn-report').innerHTML, /Relatório|file/i);
    });

    test('stream com linhas de controle e JSON quebrado mostra só o texto válido', async () => {
        const corpo = `: ping\nevent: meta\ndata: {quebrado\ndata: ${JSON.stringify({ choices: [{ delta: { content: 'Tudo certo' } }] })}\ndata: [DONE]\n`;
        page = await openPage('alertas', { client: client(), now: NOW, fetch: async () => new Response(corpo, { status: 200 }) });
        await perguntar(page, 'Status?');
        assert.match(page.text(page.$$('#chat-messages .chat-message.ai').at(-1)), /Tudo certo/);
    });

    test('relatório sem a biblioteca de markdown escapa o HTML e quebra as linhas', async () => {
        page = await openPage('alertas', {
            client: client(),
            now: NOW,
            fetch: async () => new Response(JSON.stringify({ content: 'Linha <b>1</b> & 2\nLinha 3' }), { status: 200 }),
            before(w) {
                delete w.marked;
            },
        });
        await page.click('#btn-report');
        await page.settle(20);
        const html = page.$('#report-content').innerHTML;
        assert.match(html, /&lt;b&gt;1&lt;\/b&gt; &amp;(amp;)? 2<br>Linha 3/);
    });

    test('ação com tipo desconhecido não executa nada', async () => {
        const c = client();
        page = await openPage('alertas', { client: c, now: NOW });
        page.eval(`executeAction({ type: 'apagar_tudo', message: 'x' }).then((r) => (window.__resultado = r))`);
        await page.settle(20);
        assert.equal(page.eval('window.__resultado'), false);
        assert.equal(c.writes('ai_decision_memory', 'insert').length, 0);
    });
});

describe('alertas.html — bordas das ações sobre registros', () => {
    const falta = (id, empId, date, extra = {}) => ({ id, employee_id: empId, tipo: 'falta', date, status: 'pendente', ...extra });

    test('recusar ajuste que não é falta não mostra impacto de DSR', async () => {
        const c = client({ adjustment_requests: [falta('e1', ANA.id, '2026-06-10', { tipo: 'entrada' })] });
        page = await openPage('alertas', { client: c, now: NOW, fetch: async () => acao({ type: 'reject_adjustment', ids: ['e1'], message: 'Recusar' }) });
        await perguntar(page, 'Recuse');
        await page.waitFor(() => !page.$('.btn-do-action').disabled);
        await page.settle(20);
        assert.equal(page.$('.action-impact-preview').classList.contains('hidden'), true);
    });

    test('faltas da mesma pessoa em duas semanas (uma num domingo) somam 2 semanas de DSR', async () => {
        const c = client({ adjustment_requests: [falta('a1', ANA.id, '2026-06-14'), falta('a2', ANA.id, '2026-06-03')] });
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => acao({ type: 'reject_adjustment', ids: ['a1', 'a2'], message: 'Recusar' }),
        });
        await perguntar(page, 'Recuse');
        await page.waitFor(() => /Impacto estimado/.test(page.text('.action-impact-preview')));
        assert.match(page.text('.action-impact-preview'), /-R\$\s?266,67.*2 semanas de DSR perdido/);
    });

    test('colaborador sem salário cadastrado entra no impacto com valor zero e nome genérico', async () => {
        const c = client({ adjustment_requests: [falta('a1', ANA.id, '2026-06-10'), falta('a2', BIA.id, '2026-06-11')] });
        c.tables.employees_decrypted = c.tables.employees_decrypted.filter((e) => e.id !== BIA.id);
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            fetch: async () => acao({ type: 'reject_adjustment', ids: ['a1', 'a2'], message: 'Recusar' }),
        });
        await perguntar(page, 'Recuse');
        await page.waitFor(() => /Impacto estimado/.test(page.text('.action-impact-preview')));
        assert.match(page.text('.action-impact-preview'), /Ana Souza: R\$\s?133,33 · —: R\$\s?0,00/);
    });

    test('sem conseguir ler os salários ou os pedidos, o impacto simplesmente não aparece', async () => {
        const c = client({ adjustment_requests: [falta('a1', ANA.id, '2026-06-10')] }, { errors: { employees_decrypted: erro } });
        page = await openPage('alertas', { client: c, now: NOW, fetch: async () => acao({ type: 'reject_adjustment', ids: ['a1'], message: 'Recusar' }) });
        await perguntar(page, 'Recuse');
        await page.waitFor(() => !page.$('.btn-do-action').disabled);
        await page.settle(20);
        assert.equal(page.$('.action-impact-preview').classList.contains('hidden'), true);
        page.close();

        const c2 = client({ adjustment_requests: [falta('a1', ANA.id, '2026-06-10')] });
        c2.errors['adjustment_requests:select'] = naSegunda();
        page = await openPage('alertas', { client: c2, now: NOW, fetch: async () => acao({ type: 'reject_adjustment', ids: ['a1'], message: 'Recusar' }) });
        await perguntar(page, 'Recuse');
        await page.waitFor(() => !page.$('.btn-do-action').disabled);
        await page.settle(20);
        assert.equal(page.$('.action-impact-preview').classList.contains('hidden'), true);
    });

    test('falha ao ler os registros-alvo deixa a ação sem alvos; falha ao ler nomes usa "Colaborador"', async () => {
        const v1 = { id: 'v1', employee_id: ANA.id, start_date: '2026-07-01', end_date: '2026-07-10', days: 10, status: 'pendente' };
        const c = client({ vacations: [{ ...v1 }] }, { errors: { vacations: erro } });
        page = await openPage('alertas', { client: c, now: NOW, fetch: async () => acao({ type: 'approve_vacation', ids: ['v1'], message: 'Aprovar' }) });
        await perguntar(page, 'Aprove');
        await page.waitFor(() => /Nenhum registro pendente/.test(page.text('.action-targets')));
        page.close();

        const c2 = client({ vacations: [{ ...v1 }] }, { errors: { employees: erro } });
        page = await openPage('alertas', { client: c2, now: NOW, fetch: async () => acao({ type: 'approve_vacation', ids: ['v1'], message: 'Aprovar' }) });
        await perguntar(page, 'Aprove');
        await page.waitFor(() => /Colaborador — férias de 01\/07\/2026 a 10\/07\/2026/.test(page.text('.action-targets')));
    });

    test('sem conseguir reler a evidência, a ação ainda aplica mas não grava log de decisão vazio', async () => {
        const c = client({ vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2026-07-01', end_date: '2026-07-10', days: 10, status: 'pendente' }] });
        c.errors['vacations:select'] = naSegunda();
        page = await openPage('alertas', { client: c, now: NOW, fetch: async () => acao({ type: 'approve_vacation', ids: ['v1'], message: 'Aprovar' }) });
        await perguntar(page, 'Aprove');
        await page.waitFor(() => !page.$('.btn-do-action').disabled);
        await page.click('.btn-do-action');
        await page.waitFor(() => /Concluído/.test(page.text('.action-confirm-btns')));
        assert.equal(c.tables.vacations[0].status, 'aprovado');
        assert.equal(c.writes('ai_decision_log', 'insert').length, 0);
    });
});

describe('alertas.html — bordas do cache, histórico e abas', () => {
    const cache = (extra = {}) => ({
        cache_key: 'latest',
        summary: 'Resumo antigo',
        alerts: [
            { category: 'aprovacao', severity: 'warning', title: 'Aprovação A', description: 'd', resolved: true },
            { category: 'ausencia', severity: 'critical', title: 'Ausência B', description: 'd', employees: ['Ana'], action: 'Ligar para Ana' },
            { category: 'admissao', severity: 'info', title: 'Admissão C', description: 'd' },
        ],
        health_score: null,
        analyzed_at: '2026-06-10T10:00:00-03:00',
        ...extra,
    });

    test('cache antigo: data completa, alerta já resolvido, cartão sem chips e sem ação, sugestões por categoria e sem score', async () => {
        const c = client({ ai_analysis_cache_decrypted: [cache()] });
        page = await openPage('alertas', { client: c, now: NOW });
        await page.settle(20);
        assert.match(page.text('#last-analysis-label'), /10\/06\/2026/);
        const cards = page.$$('#alerts-body .alert-card');
        const resolvido = cards.find((k) => /Aprovação A/.test(page.text(k)));
        assert.equal(resolvido.classList.contains('resolved'), true);
        assert.ok(resolvido.querySelector('.resolved-badge'));
        const admissao = cards.find((k) => /Admissão C/.test(page.text(k)));
        assert.equal(admissao.querySelector('.emp-chips'), null);
        assert.equal(admissao.querySelector('.alert-action'), null);
        const chips = page.text('.chat-suggestions-dynamic');
        assert.match(chips, /aprovações estão mais urgentes/);
        assert.match(chips, /ausente sem justificativa/);
        assert.match(chips, /onboarding/);
        assert.notEqual(page.$('#health-score-wrap').style.display, 'flex');
    });

    test('contagem de severidade: dois críticos no plural; sem críticos não mostra o selo', async () => {
        const dois = cache({ alerts: [1, 2].map((i) => ({ category: 'burnout', severity: 'critical', title: `C${i}`, description: 'd' })), health_score: 60 });
        page = await openPage('alertas', { client: client({ ai_analysis_cache_decrypted: [dois] }), now: NOW });
        await page.settle(20);
        assert.match(page.text('#severity-counts'), /2 críticos/);
        page.close();
        const semCritico = cache({ alerts: [{ category: 'burnout', severity: 'warning', title: 'W', description: 'd' }] });
        page = await openPage('alertas', { client: client({ ai_analysis_cache_decrypted: [semCritico] }), now: NOW });
        await page.settle(20);
        assert.doesNotMatch(page.text('#severity-counts'), /crítico/);
        assert.match(page.text('#severity-counts'), /1 atenção/);
    });

    test('resolver alerta quando o cache sumiu ou a leitura falha não quebra a tela', async () => {
        const c = client({ ai_analysis_cache_decrypted: [cache()] });
        page = await openPage('alertas', { client: c, now: NOW });
        await page.settle(20);
        c.tables.ai_analysis_cache_decrypted = [];
        const [b, cc] = page.$$('#alerts-body .btn-resolve');
        await page.click(b);
        await page.settle(10);
        c.errors.ai_analysis_cache_decrypted = lancar;
        await page.click(cc);
        await page.settle(10);
        assert.equal(page.$$('#alerts-body .alert-card.resolved').length, 3);
        assert.equal(c.writes('ai_analysis_cache', 'update').length, 0);
    });

    test('falhas ao ler chat, cache e histórico não derrubam a página', async () => {
        const c = client({}, { errors: { ai_chat_history_decrypted: lancar, ai_analysis_cache_decrypted: lancar, ai_analysis_history_decrypted: erro } });
        page = await openPage('alertas', { client: c, now: NOW });
        await page.settle(20);
        assert.match(page.text('#alerts-body'), /Analisar Agora/);
        await abrirAba(page, 'history');
        assert.match(page.text('#history-list'), /Nenhuma análise registrada/);
    });

    test('histórico: faixas de score, score ausente, data antiga e volta para a aba de alertas', async () => {
        const item = (id, score, dia, alerts = []) => ({
            id,
            summary: `Análise ${id}`,
            health_score: score,
            alerts,
            analyzed_at: `2026-06-${dia}T09:00:00-03:00`,
        });
        const c = client({
            ai_analysis_history_decrypted: [
                item('h1', 90, '17'),
                item('h2', 70, '15'),
                item('h3', 50, '14', [{ severity: 'critical', category: 'burnout', title: 'X' }]),
                item('h4', 20, '13'),
                item('h5', null, '12'),
            ],
        });
        page = await openPage('alertas', { client: c, now: NOW });
        await abrirAba(page, 'history');
        const scores = page.$$('.history-score').map((s) => s.className.replace('history-score', '').trim());
        assert.deepEqual(scores, ['score-green', 'score-yellow', 'score-amber', 'score-red', '']);
        assert.equal(page.text(page.$$('.history-score').at(-1)), '—');
        assert.match(page.text('#history-list'), /hoje às/);
        assert.match(page.text('#history-list'), /15\/06\/2026 às/);
        const grafico = page.charts.at(-1);
        assert.deepEqual([...grafico.data.datasets[0].pointBackgroundColor], ['#e2e8f0', '#ef4444', '#f59e0b', '#84cc16', '#22c55e']);
        await page.click('.panel-tab[data-tab="alerts"]');
        assert.equal(page.$('#alerts-body').style.display, '');
        assert.equal(page.$('#alerts-header-right').style.display, '');
        assert.equal(page.$('#history-body').style.display, 'none');
    });

    test('histórico sem a biblioteca de gráficos lista as análises sem o gráfico', async () => {
        const c = client({
            ai_analysis_history_decrypted: [{ id: 'h1', summary: 'S', health_score: 80, alerts: [], analyzed_at: '2026-06-16T09:00:00-03:00' }],
        });
        page = await openPage('alertas', {
            client: c,
            now: NOW,
            before(w) {
                delete w.Chart;
            },
        });
        await abrirAba(page, 'history');
        assert.equal(page.$$('.history-item').length, 1);
        assert.equal(page.charts.length, 0);
    });
});

describe('alertas.html — bordas de risco composto, jurídico, compliance, comunidade e gestores', () => {
    test('consultas que voltam com erro (sem exceção) viram estados vazios em todas as abas', async () => {
        const errors = {};
        for (const t of [
            'employees',
            'time_records',
            'bank_adjustments',
            'burnout_alerts',
            'hr_tickets',
            'compliance_alerts',
            'adjustment_requests',
            'documents',
            'kudos',
            'anonymous_feedback_decrypted',
        ]) {
            errors[t] = erro;
        }
        page = await openPage('alertas', { client: client({}, { errors }), now: NOW });
        await abrirAba(page, 'risco');
        assert.match(page.text('#risco-list'), /Nenhum risco composto/);
        await abrirAba(page, 'juridico');
        assert.match(page.text('#juridico-list'), /Nenhuma exposição jurídica/);
        assert.match(page.text('#juridico-summary'), /Baixo/);
        await abrirAba(page, 'compliance');
        assert.match(page.text('#compliance-list'), /Nenhuma pendência de compliance/);
        await page.click('.panel-tab[data-tab="comunidade"]');
        await page.settle(20);
        assert.match(page.text('#comunidade-kudos-list'), /Nenhum reconhecimento/);
        assert.match(page.text('#comunidade-feedback-list'), /Nenhum feedback/);
        await abrirAba(page, 'gestores');
        assert.match(page.text('#gestores-list'), /Nenhum gestor definido/);
    });

    test('jurídico e compliance: cada consulta secundária com erro isolado ainda mostra o resto', async () => {
        const c = client(
            { time_records: [{ employee_id: ANA.id, date: '2026-06-10', entrada: '2026-06-10T08:00:00-03:00', saida: '2026-06-10T17:00:00-03:00' }] },
            { errors: { compliance_alerts: erro, burnout_alerts: erro, adjustment_requests: erro, documents: erro } }
        );
        page = await openPage('alertas', { client: c, now: NOW });
        await abrirAba(page, 'juridico');
        assert.match(page.text('#juridico-list'), /Ana Souza/);
        await abrirAba(page, 'compliance');
        assert.match(page.text('#compliance-list'), /Nenhuma pendência/);
    });

    test('risco composto: alerta vazio é ignorado, piora para crítico, ticket mais urgente vence e assunto vazio usa o status', async () => {
        const recente = '2026-06-16T10:00:00-03:00';
        const b = (empId, alertas, date) => ({ employee_id: empId, alertas, lido: false, created_at: recente, date });
        const c = client({
            burnout_alerts: [
                b(ANA.id, [], '2026-06-10'),
                b(ANA.id, [{ nivel: 'atencao' }], '2026-06-11'),
                b(ANA.id, [{ nivel: 'critico', titulo: 'Jornada exaustiva' }], '2026-06-12'),
                b(ANA.id, [{ nivel: 'atencao', titulo: 'Outro' }], '2026-06-13'),
                b(BIA.id, [{ nivel: 'atencao' }], '2026-06-12'),
            ],
            hr_tickets: [
                { employee_id: ANA.id, subject: '', status: 'em_atendimento' },
                { employee_id: ANA.id, subject: '', status: 'aguardando_rh' },
                { employee_id: ANA.id, subject: 'Terceiro', status: 'em_atendimento' },
                { employee_id: BIA.id, subject: '', status: 'em_atendimento' },
            ],
        });
        semDept(c, BIA.id);
        page = await openPage('alertas', { client: c, now: NOW });
        await abrirAba(page, 'risco');
        const cards = page.$$('#risco-list .alert-card');
        const ana = cards.find((k) => /Ana Souza/.test(page.text(k)));
        const bia = cards.find((k) => /Bia Lima/.test(page.text(k)));
        assert.match(page.text(ana), /Burnout crítico/);
        assert.match(page.text(ana), /Ticket RH: aguardando atendimento/);
        assert.equal(ana.classList.contains('sev-critical'), true);
        assert.match(page.text(bia), /Bia Lima — —/);
        assert.match(page.text(bia), /Ticket RH: em atendimento/);
        assert.equal(bia.classList.contains('sev-warning'), true);
    });

    test('jurídico: ponto de quem não está ativo é ignorado; um único fator leve fica como informativo', async () => {
        const dia = (empId) => ({ employee_id: empId, date: '2026-06-10', entrada: '2026-06-10T08:00:00-03:00', saida: '2026-06-10T17:00:00-03:00' });
        const rejeitado = (id) => ({
            id,
            employee_id: BIA.id,
            tipo: 'entrada',
            date: '2026-06-01',
            status: 'rejeitado',
            created_at: '2026-06-02T10:00:00-03:00',
        });
        const c = client({ time_records: [dia('sumiu'), dia(ANA.id)], adjustment_requests: [rejeitado('r1'), rejeitado('r2'), rejeitado('r3')] });
        semDept(c, ANA.id);
        page = await openPage('alertas', { client: c, now: NOW });
        await abrirAba(page, 'juridico');
        const card = page.$$('#juridico-list .alert-card').find((k) => /Ana Souza/.test(page.text(k)));
        assert.equal(card.classList.contains('sev-info'), true);
        assert.equal(
            page
                .$$('#juridico-list .alert-card')
                .find((k) => /Bia Lima/.test(page.text(k)))
                .classList.contains('sev-warning'),
            true
        );
        assert.match(page.text(card), /Ana Souza — —/);
        assert.match(page.text(card), /1 fator de exposição identificado\./);
        assert.equal(page.$$('#juridico-list .alert-card').length, 2);
    });

    test('compliance: documento distante é ignorado; sem tipo vira "documento"; uma pendência no singular', async () => {
        const c = client({
            documents: [
                { id: 'd1', employee_id: ANA.id, name: 'contrato.pdf', tipo: null, data_validade: '2026-06-22' },
                { id: 'd2', employee_id: BIA.id, name: 'aso.pdf', tipo: 'ASO', data_validade: '2026-12-31' },
                { id: 'd3', employee_id: BIA.id, name: 'nr10.pdf', tipo: 'NR', data_validade: '2026-06-01' },
            ],
            compliance_alerts: [{ employee_id: BIA.id, lido: false, alertas: [{ nivel: 'atencao', titulo: 'Férias vencendo' }] }],
        });
        semDept(c, ANA.id);
        page = await openPage('alertas', { client: c, now: NOW });
        await abrirAba(page, 'compliance');
        const cards = page.$$('#compliance-list .alert-card');
        assert.equal(cards.length, 2);
        assert.match(page.text(cards[0]), /Bia Lima.*2 pendências de compliance/);
        cards.shift();
        assert.match(page.text(cards[0]), /Ana Souza — —/);
        assert.match(page.text(cards[0]), /contrato\.pdf \(documento\) vence em 5d/);
        assert.match(page.text(cards[0]), /1 pendência de compliance/);
    });

    test('comunidade: cancelar remoção, remoção recusada pelo banco e feedback arquivado sem botão de arquivar', async () => {
        const c = client(
            {
                kudos: [
                    {
                        id: 'k1',
                        from_employee_id: BIA.id,
                        to_employee_id: ANA.id,
                        from: { name: 'Bia Lima' },
                        to: { name: 'Ana Souza' },
                        categoria: 'mentoria',
                        message: 'Valeu',
                        created_at: '2026-06-16T10:00:00-03:00',
                    },
                ],
                anonymous_feedback_decrypted: [
                    { id: 'f1', categoria: 'outro', message: 'Arquivado', status: 'arquivado', created_at: '2026-06-16T10:00:00-03:00' },
                ],
            },
            { errors: { 'kudos:delete': erro, 'anonymous_feedback:update': erro } }
        );
        let responder = false;
        page = await openPage('alertas', { client: c, now: NOW, confirm: () => responder });
        await page.click('.panel-tab[data-tab="comunidade"]');
        await page.settle(20);
        await page.click('[data-click="removeKudosMod"]');
        assert.equal(c.writes('kudos', 'delete').length, 0);
        responder = true;
        await page.click('[data-click="removeKudosMod"]');
        assert.equal(c.writes('kudos', 'delete').length, 1);
        assert.match(page.text('#comunidade-kudos-list'), /Valeu/);
        assert.match(page.text('#comunidade-kudos-list'), /Mentoria/);
        const botoes = page.$$('#comunidade-feedback-list [data-click="markAnonFeedbackMod"]');
        assert.equal(botoes.length, 1);
        assert.match(page.text(botoes[0]), /Marcar como lido/);
        await page.click(botoes[0]);
        assert.equal(c.tables.anonymous_feedback_decrypted[0].status, 'arquivado');
        assert.equal(page.$$('#comunidade-feedback-list [data-click="markAnonFeedbackMod"]').length, 1);
    });

    test('gestores: contadores ficam em zero quando as consultas falham; departamento vazio mostra traço', async () => {
        const c = client({}, { errors: { vacations: erro, bank_requests: erro, hr_tickets: erro } });
        semDept(c, BIA.id);
        page = await openPage('alertas', { client: c, now: NOW });
        await abrirAba(page, 'gestores');
        const card = page.$$('.gestor-card').find((k) => /Bia Lima/.test(page.text(k)));
        assert.match(page.text(card.querySelector('.gestor-card-meta')), /^—$/);
        const valores = [...card.querySelectorAll('.gestor-stat-val')].map((v) => v.textContent);
        assert.deepEqual(valores.slice(1), ['0', '0', '0']);
    });
});
