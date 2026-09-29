const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function client({ tickets = [], messages = [], feedback = [], errors = {} } = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            hr_tickets: tickets,
            hr_ticket_messages: [],
            hr_ticket_messages_decrypted: messages,
            anonymous_feedback: [],
            anonymous_feedback_decrypted: feedback,
        }),
        errors,
    });
}

describe('chat-rh.html — bordas', () => {
    test('falhas ao ler tickets e feedbacks mostram listas vazias', async () => {
        page = await openPage('chat-rh', {
            client: client({ errors: { hr_tickets: { message: 'a' }, anonymous_feedback_decrypted: { message: 'b' } } }),
            now: NOW,
        });
        assert.match(page.text('#ticket-list'), /Nenhum ticket encontrado/);
        assert.match(page.text('#anon-feedback-list'), /Nenhum feedback/);
    });

    test('ticket sem colaborador, com situação desconhecida, esperando há horas (alerta de SLA) e escalação', async () => {
        const c = client({
            tickets: [
                { id: 't1', employee_id: ANA.id, status: 'aguardando_rh', updated_at: '2026-06-17T05:00:00-03:00', employees: null, about: { name: BIA.name } },
                {
                    id: 't2',
                    employee_id: BIA.id,
                    status: 'arquivado',
                    updated_at: '2026-06-17T04:00:00-03:00',
                    employees: { name: 'Bia  Lima', avatar_url: 'https://storage.test/b.jpg' },
                },
                { id: 't3', employee_id: BIA.id, status: 'arquivado', updated_at: '2026-06-17T03:00:00-03:00', employees: { name: 'Bia  Lima' } },
            ],
            messages: [
                { id: 'm1', ticket_id: 't1', role: 'user', employee_id: 'sumiu', content: 'Oi', created_at: '2026-06-17T05:00:00-03:00' },
                { id: 'm2', ticket_id: 't2', role: 'user', employee_id: BIA.id, content: 'Olá', created_at: '2026-06-17T04:00:00-03:00' },
            ],
        });
        c.tables.employees.find((e) => e.id === BIA.id).avatar_url = 'https://storage.test/b.jpg';
        page = await openPage('chat-rh', { client: c, now: NOW });
        const itens = page.$$('#ticket-list .ticket-item');
        assert.equal(itens[0].dataset.ticketId, 't1');
        assert.match(itens[0].textContent, /Colaborador/);
        assert.ok(itens[0].querySelector('.sla-badge--warn'));
        assert.match(itens[0].textContent, /5h/);
        assert.match(itens[1].textContent, /arquivado/);
        assert.ok(itens[1].querySelector('.tsd-bot'));
        assert.equal(page.$('#ticket-list .ticket-item[data-ticket-id="t3"] .ti-avatar').textContent, 'BL');

        await page.click(itens[0]);
        assert.equal(page.text('#colab-name'), 'Colaborador');
        assert.match(page.text('#colab-meta'), /Escalação sobre Bia Lima/);
        assert.match(page.text('#messages-list'), /Colaborador Oi/);

        await page.click(page.$('#ticket-list .ticket-item[data-ticket-id="t2"]'));
        assert.equal(page.text('#status-chip-label'), 'arquivado');
        assert.ok(page.$('#status-chip-dot').classList.contains('offline'));
        assert.equal(page.$('#messages-list .msg-avatar').getAttribute('data-bg-img'), 'https://storage.test/b.jpg');
    });

    test('falha ao ler mensagens ou autores não quebra a conversa', async () => {
        const tickets = [{ id: 't1', employee_id: ANA.id, status: 'em_atendimento', updated_at: '2026-06-17T09:00:00-03:00', employees: { name: ANA.name } }];
        const messages = [{ id: 'm1', ticket_id: 't1', role: 'user', employee_id: ANA.id, content: 'Oi', created_at: '2026-06-17T09:00:00-03:00' }];
        page = await openPage('chat-rh', { client: client({ tickets, messages, errors: { hr_ticket_messages_decrypted: { message: 'x' } } }), now: NOW });
        await page.click('#ticket-list .ticket-item');
        assert.equal(page.$$('#messages-list .msg-group').length, 0);
        page.close();
        page = await openPage('chat-rh', { client: client({ tickets, messages, errors: { 'employees:select': { message: 'x' } } }), now: NOW });
        await page.click('#ticket-list .ticket-item');
        assert.match(page.text('#messages-list'), /Colaborador Oi/);
    });

    test('sem ticket escolhido, mudar a situação e responder não fazem nada', async () => {
        const c = client({
            tickets: [{ id: 't1', employee_id: ANA.id, status: 'aguardando_rh', updated_at: '2026-06-17T09:00:00-03:00', employees: { name: ANA.name } }],
        });
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('#btn-em-atend');
        page.$('#hr-reply-input').value = 'Olá';
        await page.key('#hr-reply-input', 'Enter');
        assert.equal(c.writes('hr_tickets', 'update').length, 0);
        assert.equal(c.writes('hr_ticket_messages', 'insert').length, 0);
    });

    test('tempo real: a própria resposta não duplica; autor que não carrega aparece como Colaborador', async () => {
        const c = client({
            tickets: [{ id: 't1', employee_id: ANA.id, status: 'em_atendimento', updated_at: '2026-06-17T09:00:00-03:00', employees: { name: ANA.name } }],
            messages: [{ id: 'm9', ticket_id: 't1', role: 'user', employee_id: 'sumiu', content: 'Novo', created_at: '2026-06-17T09:30:00-03:00' }],
        });
        c.tables.hr_ticket_messages_decrypted = [];
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('#ticket-list .ticket-item');
        c.emit('hr_ticket_messages', { eventType: 'INSERT', new: { id: 'eu', ticket_id: 't1', role: 'rh', employee_id: null } });
        c.tables.hr_ticket_messages_decrypted = [
            { id: 'm9', ticket_id: 't1', role: 'user', employee_id: 'sumiu', content: 'Novo', created_at: '2026-06-17T09:30:00-03:00' },
        ];
        c.emit('hr_ticket_messages', { eventType: 'INSERT', new: { id: 'm9', ticket_id: 't1', role: 'user', employee_id: 'sumiu' } });
        await page.waitFor(() => /Novo/.test(page.text('#messages-list')));
        assert.equal(page.$$('#messages-list .msg-group').length, 1);
        assert.match(page.text('#messages-list'), /Colaborador Novo/);
    });

    test('ticket novo sem colaborador cadastrado: escalação sem nomes e ticket comum sem texto extra', async () => {
        const c = client();
        page = await openPage('chat-rh', { client: c, now: NOW });
        c.emit('hr_tickets', {
            eventType: 'INSERT',
            new: { id: 't8', employee_id: 'sumiu', about_employee_id: 'sumiu-tambem', status: 'aguardando_rh', updated_at: '2026-06-17T09:59:00-03:00' },
        });
        await page.waitFor(() => page.toasts().some((t) => /Gestor escalou algo sobre um colaborador/.test(t)));
        c.emit('hr_tickets', {
            eventType: 'INSERT',
            new: { id: 't7', employee_id: 'sumiu', status: 'aguardando_rh', updated_at: '2026-06-17T09:59:00-03:00' },
        });
        await page.waitFor(() => page.toasts().filter((t) => /^Novo ticket de atendimento$/.test(t)).length === 1);
    });

    test('feedback anônimo: categoria desconhecida, arquivado sem botão de arquivar e falha ao marcar', async () => {
        const c = client({ feedback: [{ id: 'f1', categoria: 'nova', message: 'x', status: 'arquivado', created_at: '2026-06-16T10:00:00-03:00' }] });
        c.errors['anonymous_feedback:update'] = { message: 'RLS' };
        page = await openPage('chat-rh', { client: c, now: NOW });
        assert.match(page.text('#anon-feedback-list'), /nova/);
        assert.doesNotMatch(page.text('#anon-feedback-list'), /Arquivar/);
        await page.click('[data-click="markAnonFeedback"]');
        assert.match(page.text('#anon-feedback-list'), /Marcar como lido/);
    });
});
