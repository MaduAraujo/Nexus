const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const anaEmb = { name: ANA.name, role: ANA.role, dept: ANA.dept };

function client(extra = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            hr_tickets: [
                {
                    id: 't1',
                    employee_id: ANA.id,
                    status: 'aguardando_rh',
                    subject: 'Atendimento solicitado',
                    updated_at: '2026-06-15T09:00:00-03:00',
                    employees: anaEmb,
                },
                {
                    id: 't2',
                    employee_id: BIA.id,
                    status: 'resolvido',
                    csat_rating: 4,
                    updated_at: '2026-06-10T09:00:00-03:00',
                    employees: { name: BIA.name },
                    about: { name: ANA.name },
                },
                { id: 't3', employee_id: ANA.id, status: 'bot', updated_at: '2026-06-16T09:00:00-03:00', employees: anaEmb },
            ],
            hr_ticket_messages: [],
            hr_ticket_messages_decrypted: [
                { id: 'x1', ticket_id: 't1', role: 'bot', content: 'Olá **Ana**', created_at: '2026-06-15T08:58:00-03:00' },
                {
                    id: 'x2',
                    ticket_id: 't1',
                    role: 'user',
                    employee_id: ANA.id,
                    content: 'Preciso de ajuda <b>já</b>',
                    created_at: '2026-06-15T08:59:00-03:00',
                },
                { id: 'x3', ticket_id: 't1', role: 'bot', content: '— Conversa transferida para analista de RH. —', created_at: '2026-06-15T09:00:00-03:00' },
            ],
            anonymous_feedback: [],
            anonymous_feedback_decrypted: [
                { id: 'f1', categoria: 'clima', message: 'Clima tenso', status: 'novo', created_at: '2026-06-16T10:00:00-03:00' },
                { id: 'f2', categoria: 'gestao', message: 'Falta feedback', status: 'lido', created_at: '2026-06-15T10:00:00-03:00' },
            ],
            ...extra,
        }),
    });
}

describe('chat-rh.html', () => {
    test('indicadores, fila ordenada por urgência, SLA estourado e CSAT médio', async () => {
        page = await openPage('chat-rh', { client: client(), now: NOW });
        assert.deepEqual(
            ['stat-total', 'stat-waiting', 'stat-active', 'stat-solved', 'stat-csat'].map((id) => page.text(`#${id}`)),
            ['3', '1', '0', '1', '4.0★']
        );
        assert.deepEqual(
            page.$$('#ticket-list .ticket-item').map((li) => li.dataset.ticketId),
            ['t1', 't3', 't2']
        );
        assert.ok(page.$('.ticket-item[data-ticket-id="t1"] .sla-badge--breach'));
        assert.ok(page.$('#stat-waiting').closest('.tstat').classList.contains('tstat-danger'));
        assert.match(page.text('.ticket-item[data-ticket-id="t2"]'), /Sobre Ana Souza/);
        assert.equal(page.text('#pending-count'), '1');
    });

    test('filtros: escalações de gestor e status', async () => {
        page = await openPage('chat-rh', { client: client(), now: NOW });
        await page.click('.tf-chip[data-filter="escalacao"]');
        assert.deepEqual(
            page.$$('#ticket-list .ticket-item').map((li) => li.dataset.ticketId),
            ['t2']
        );
        await page.click('.tf-chip[data-filter="bot"]');
        assert.deepEqual(
            page.$$('#ticket-list .ticket-item').map((li) => li.dataset.ticketId),
            ['t3']
        );
    });

    test('abrir ticket aguardando assume o atendimento e mostra a conversa escapada', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('.ticket-item[data-ticket-id="t1"]');
        assert.equal(c.tables.hr_tickets[0].status, 'em_atendimento');
        assert.equal(page.text('#colab-name'), 'Ana Souza');
        assert.equal(page.text('#colab-meta'), 'Analista · Financeiro');
        assert.equal(page.text('#status-chip-label'), 'Em atendimento');
        assert.equal(page.$('#messages-list .msg-bubble strong').textContent, 'Ana');
        assert.match(page.text('#messages-list'), /Preciso de ajuda <b>já<\/b>/);
        assert.match(page.text('#messages-list'), /Conversa transferida/);
    });

    test('responder grava como RH; resolver encerra', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('.ticket-item[data-ticket-id="t1"]');
        await page.fill('#hr-reply-input', 'Oi Ana, vamos resolver.');
        await page.click('#hr-reply-send');
        assert.deepEqual(c.writes('hr_ticket_messages', 'insert')[0].payload[0], {
            ticket_id: 't1',
            employee_id: null,
            role: 'rh',
            content: 'Oi Ana, vamos resolver.',
        });
        assert.match(page.text('#messages-list'), /Oi Ana, vamos resolver\./);

        await page.click('#btn-resolver');
        assert.equal(c.tables.hr_tickets[0].status, 'resolvido');
        assert.match(page.text('#messages-list'), /Atendimento encerrado pelo analista de RH/);
        assert.equal(page.$('#hr-reply-input').disabled, true);
    });

    test('se o banco recusar a mudança de status, a tela não finge que mudou', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        c.errors['hr_tickets:update'] = { message: 'RLS' };
        await page.click('.ticket-item[data-ticket-id="t3"]');
        page.window.document.getElementById('btn-resolver').style.display = 'flex';
        await page.click('#btn-resolver');
        assert.equal(c.tables.hr_tickets[2].status, 'bot');
        assert.ok(page.toasts().some((t) => /Não foi possível atualizar o atendimento/.test(t)));
        assert.ok(!page.toasts().some((t) => /Ticket encerrado/.test(t)));
    });

    test('resposta com erro volta para o campo', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('.ticket-item[data-ticket-id="t1"]');
        c.errors['hr_ticket_messages:insert'] = { message: 'offline' };
        await page.fill('#hr-reply-input', 'Resposta longa');
        await page.click('#hr-reply-send');
        assert.equal(page.$('#hr-reply-input').value, 'Resposta longa');
    });

    test('novo ticket em tempo real entra na fila', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        c.tables.hr_tickets.push({ id: 't9', employee_id: BIA.id, status: 'aguardando_rh', updated_at: '2026-06-17T09:59:00-03:00' });
        c.emit('hr_tickets', { eventType: 'INSERT', new: { id: 't9', employee_id: BIA.id, status: 'aguardando_rh', updated_at: '2026-06-17T09:59:00-03:00' } });
        await page.settle(20);
        assert.ok(page.$('.ticket-item[data-ticket-id="t9"]'));
        assert.equal(page.text('#stat-waiting'), '2');
    });

    test('feedback anônimo: badge de novos, filtro e marcar como lido/arquivar', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        assert.equal(page.text('#anon-feedback-badge'), '1');
        await page.click('#btn-open-anon-feedback');
        assert.match(page.text('#anon-feedback-list'), /Clima organizacional.*Clima tenso.*Gestão \/ liderança.*Falta feedback/);
        await page.click('[data-click="markAnonFeedback"][data-click-args*="f1"][data-click-args*="lido"]');
        assert.deepEqual(c.writes('anonymous_feedback', 'update')[0].payload, { status: 'lido' });
        assert.equal(page.$('#anon-feedback-badge').classList.contains('hidden'), true);
        await page.click('.af-chip[data-filter="arquivado"]');
        assert.match(page.text('#anon-feedback-list'), /Nenhum feedback com status "arquivado"/);
    });
});

describe('chat-rh.html — tempo real', () => {
    test('mensagem do colaborador chega na conversa aberta com o nome; a própria resposta não duplica', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('.ticket-item[data-ticket-id="t1"]');
        await page.settle();
        const antes = page.$$('#messages-list .message, #messages-list [class*="msg"]').length;

        c.tables.hr_ticket_messages_decrypted.push({
            id: 'x9',
            ticket_id: 't1',
            role: 'user',
            employee_id: ANA.id,
            content: 'Ainda aguardo',
            created_at: '2026-06-17T09:30:00-03:00',
        });
        c.emit('hr_ticket_messages', { eventType: 'INSERT', new: { id: 'x9', ticket_id: 't1', role: 'user', employee_id: ANA.id } });
        await page.waitFor(() => /Ainda aguardo/.test(page.text('#messages-list')));

        c.emit('hr_ticket_messages', { eventType: 'INSERT', new: { id: 'nao-existe', ticket_id: 't1', role: 'bot' } });
        await page.settle();
        assert.ok(page.$$('#messages-list .message, #messages-list [class*="msg"]').length > antes);
    });

    test('escalação de gestor em tempo real avisa quem escalou e sobre quem', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        c.tables.hr_tickets.push({
            id: 't9',
            employee_id: BIA.id,
            about_employee_id: ANA.id,
            status: 'aguardando_rh',
            subject: 'Comportamento',
            updated_at: '2026-06-17T09:00:00-03:00',
        });
        c.emit('hr_tickets', { eventType: 'INSERT', new: { id: 't9', employee_id: BIA.id, about_employee_id: ANA.id, status: 'aguardando_rh' } });
        await page.waitFor(() => page.toasts().some((t) => /Bia Lima escalou algo sobre Ana Souza/.test(t)));
        c.emit('hr_tickets', { eventType: 'INSERT', new: { id: 't9', employee_id: BIA.id } });
        await page.settle();
        assert.equal(page.$$('.ticket-item[data-ticket-id="t9"]').length, 1, 'o mesmo ticket não entra duas vezes');
    });

    test('mudança de status feita em outra aba atualiza o ticket aberto', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('.ticket-item[data-ticket-id="t1"]');
        await page.settle();
        c.emit('hr_tickets', { eventType: 'UPDATE', new: { id: 't1', status: 'resolvido' } });
        await page.settle();
        assert.match(page.text('.ticket-item[data-ticket-id="t1"]'), /Resolvido/i);
        assert.equal(page.$('.ticket-item[data-ticket-id="t1"]').classList.contains('active'), true, 'continua selecionado');
    });
});

describe('chat-rh.html — painel, histórico, teclado e tempo real', () => {
    test('no celular, o botão abre a fila e o fundo escuro fecha', async () => {
        page = await openPage('chat-rh', { client: client(), now: NOW });
        await page.click('#topbar-panels-btn');
        assert.ok(page.$('#chat-left').classList.contains('open'));
        await page.click('#chat-overlay');
        assert.equal(page.$('#chat-left').classList.contains('open'), false);
    });

    test('foto do colaborador aparece no cabeçalho; respostas antigas do RH aparecem no histórico', async () => {
        const c = client();
        c.tables.hr_tickets[0].employees = { ...anaEmb, avatar_url: 'https://cdn.exemplo.com/ana.png' };
        c.tables.hr_ticket_messages_decrypted.push({
            id: 'x4',
            ticket_id: 't1',
            role: 'rh',
            employee_id: 'outro-analista',
            content: 'Já estou vendo, Ana.',
            created_at: '2026-06-15T09:10:00-03:00',
        });
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('.ticket-item[data-ticket-id="t1"]');
        await page.settle();
        assert.equal(page.$('#colab-avatar').getAttribute('data-bg-img'), 'https://cdn.exemplo.com/ana.png');
        assert.match(page.$('#colab-avatar').style.backgroundImage, /ana\.png/);
        assert.equal(page.text('#colab-avatar'), '');
        assert.match(page.text('#messages-list'), /Já estou vendo, Ana\./);
        assert.ok(page.$('#messages-list .rh-avatar'), 'resposta de outro analista aparece com o ícone do RH');
    });

    test('Enter envia a resposta, Shift+Enter não; o botão acompanha o texto', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('.ticket-item[data-ticket-id="t1"]');
        await page.settle();
        const input = page.$('#hr-reply-input');
        await page.fill(input, '   ');
        assert.equal(page.$('#hr-reply-send').disabled, true);
        await page.fill(input, 'Vou verificar agora.');
        assert.equal(page.$('#hr-reply-send').disabled, false);
        await page.key(input, 'Enter', { shiftKey: true });
        assert.equal(c.writes('hr_ticket_messages', 'insert').length, 0);
        await page.key(input, 'Enter');
        await page.settle();
        assert.equal(c.writes('hr_ticket_messages', 'insert')[0].payload[0].content, 'Vou verificar agora.');
    });

    test('resposta de outro analista chega em tempo real na conversa aberta', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('.ticket-item[data-ticket-id="t1"]');
        await page.settle();
        c.tables.hr_ticket_messages_decrypted.push({
            id: 'x8',
            ticket_id: 't1',
            role: 'rh',
            employee_id: 'outro-analista',
            content: 'Assumi daqui.',
            created_at: '2026-06-17T09:40:00-03:00',
        });
        c.emit('hr_ticket_messages', { eventType: 'INSERT', new: { id: 'x8', ticket_id: 't1', role: 'rh', employee_id: 'outro-analista' } });
        await page.waitFor(() => /Assumi daqui/.test(page.text('#messages-list')));
    });

    test('feedback anônimo novo chega em tempo real com aviso; o modal abre e fecha', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('#btn-open-anon-feedback');
        assert.ok(page.$('#anon-feedback-modal').classList.contains('open'));
        c.tables.anonymous_feedback_decrypted.push({
            id: 'f3',
            categoria: 'clima',
            message: 'Barulho no andar',
            status: 'novo',
            created_at: '2026-06-17T09:45:00-03:00',
        });
        c.emit('anonymous_feedback', { eventType: 'INSERT', new: { id: 'f3' } });
        await page.waitFor(() => /Barulho no andar/.test(page.text('#anon-feedback-modal')));
        assert.ok(page.toasts().some((t) => /Novo feedback anônimo recebido/.test(t)));
        await page.click('[data-click="closeAnonFeedbackModal"]');
        assert.equal(page.$('#anon-feedback-modal').classList.contains('open'), false);
    });

    test('a cada minuto a fila recalcula o SLA, inclusive do ticket aberto', async () => {
        let periodico = null;
        page = await openPage('chat-rh', {
            client: client(),
            now: NOW,
            before: (w) => {
                const orig = w.setInterval;
                w.setInterval = (fn, ms) => (ms === 60000 ? ((periodico = fn), 0) : orig(fn, ms));
            },
        });
        const fila = page.text('#ticket-list');
        periodico();
        assert.equal(page.text('#ticket-list'), fila);
        await page.click('.ticket-item[data-ticket-id="t1"]');
        await page.settle();
        periodico();
        assert.deepEqual(page.pageErrors.map(String), []);
    });

    test('fila sem tickets explica que não há nada', async () => {
        page = await openPage('chat-rh', { client: client({ hr_tickets: [] }), now: NOW });
        assert.match(page.text('#ticket-list'), /Nenhum ticket encontrado/);
    });

    test('o aviso some sozinho depois de alguns segundos', async () => {
        page = await openPage('chat-rh', { client: client(), now: NOW });
        const w = page.window;
        const st = w.setTimeout;
        w.setTimeout = (fn, ms, ...a) => (ms === 4000 || ms === 400 ? (fn(...a), 0) : st(fn, ms, ...a));
        w.showToast('Aviso de teste', 'info');
        w.setTimeout = st;
        assert.deepEqual(page.toasts(), []);
    });
});
