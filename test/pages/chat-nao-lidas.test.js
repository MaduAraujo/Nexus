const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

const CANAIS = [
    { id: 'ch-geral', slug: 'geral', name: 'geral', kind: 'channel', icon: 'globe' },
    { id: 'ch-ti', slug: 'ti', name: 'ti', kind: 'channel', icon: 'code' },
];

function colab(resumo, extra = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({
            chat_channels: CANAIS,
            chat_channel_members: [],
            chat_messages: [],
            chat_messages_decrypted: [],
            hr_tickets: [
                {
                    id: 't1',
                    employee_id: ANA.id,
                    subject: 'Férias',
                    status: 'em_atendimento',
                    created_at: '2026-06-17T09:00:00-03:00',
                    updated_at: '2026-06-17T09:30:00-03:00',
                },
            ],
            hr_ticket_hidden: [],
            hr_ticket_messages: [],
            hr_ticket_messages_decrypted: [
                { id: 'r1', ticket_id: 't1', role: 'rh', employee_id: null, content: 'Olá, Ana', created_at: '2026-06-17T09:30:00-03:00' },
            ],
            kudos: [],
            anonymous_feedback: [],
            e2e_keys: [],
            ...extra,
        }),
        rpc: {
            colleague_directory: [{ id: BIA.id, name: BIA.name, dept: BIA.dept, role: BIA.role }],
            e2e_channel_member_keys: [],
            chat_unread_summary: typeof resumo === 'function' ? resumo : () => resumo,
        },
    });
}

function rh(resumo) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            hr_tickets: [
                { id: 't1', employee_id: ANA.id, status: 'aguardando_rh', updated_at: '2026-06-17T09:00:00-03:00', employees: { name: ANA.name } },
                { id: 't2', employee_id: BIA.id, status: 'em_atendimento', updated_at: '2026-06-17T08:00:00-03:00', employees: { name: BIA.name } },
            ],
            hr_ticket_messages: [],
            hr_ticket_messages_decrypted: [],
            anonymous_feedback: [],
            anonymous_feedback_decrypted: [],
        }),
        rpc: { chat_unread_summary: typeof resumo === 'function' ? resumo : () => resumo },
    });
}

describe('sidebar — número de mensagens não lidas', () => {
    test('início do colaborador mostra o total no link do Chat e atualiza em tempo real', async () => {
        let resumo = [
            { kind: 'channel', thread: 'ch-geral', unread: 2 },
            { kind: 'ticket', thread: 't1', unread: 1 },
        ];
        const c = colab(() => resumo);
        page = await openPage('inicio-colaborador', { client: c, now: NOW });
        await page.waitFor(() => page.$('a[href*="chat-colaborador.html"] .nav-badge'));
        assert.equal(page.text('a[href*="chat-colaborador.html"] .nav-badge'), '3');
        assert.equal(page.visible('a[href*="chat-colaborador.html"] .nav-badge'), true);

        resumo = [];
        c.emit('chat_reads', { new: {} });
        await page.waitFor(() => !page.visible('a[href*="chat-colaborador.html"] .nav-badge'));
    });

    test('início do RH mostra o total no link de Atendimento', async () => {
        page = await openPage('inicio-rh', { client: rh([{ kind: 'ticket', thread: 't1', unread: 4 }]), now: NOW });
        await page.waitFor(() => page.text('a[href*="chat-rh.html"] .nav-badge') === '4');
    });
});

describe('chat-colaborador.html — sinalização de nova mensagem', () => {
    test('canal e atendimento com não lidas ficam destacados, com contador e aviso nas abas', async () => {
        page = await openPage('chat-colaborador', {
            client: colab([
                { kind: 'channel', thread: 'ch-ti', unread: 120 },
                { kind: 'ticket', thread: 't1', unread: 2 },
            ]),
            now: NOW,
        });
        await page.waitFor(() => page.text('#badge-ch-ti') === '99+');
        assert.ok(page.$('.channel-item[data-channel-id="ch-ti"]').classList.contains('has-unread'));
        assert.equal(page.$('.channel-item[data-channel-id="ch-geral"]').classList.contains('has-unread'), false);
        assert.equal(page.visible('#badge-ch-geral'), false);
        assert.equal(page.text('#social-tab-badge'), '99+');
        assert.equal(page.text('#rh-tab-badge'), '2');
        assert.ok(page.$('.ticket-item[data-ticket-id="t1"]').classList.contains('has-unread'));
        assert.equal(page.text('.ticket-item[data-ticket-id="t1"] .ch-badge'), '2');
    });

    test('abrir o atendimento marca como lido; ir para o mural tira a conversa de foco', async () => {
        const c = colab([{ kind: 'ticket', thread: 't1', unread: 1 }]);
        page = await openPage('chat-colaborador', { client: c, now: NOW });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"]');
        assert.deepEqual(c.rpcCalls('chat_mark_read').at(-1).args, { p_kind: 'ticket', p_thread: 't1' });
        assert.equal(page.visible('#rh-tab-badge'), false);

        await page.click('#tab-kudos');
        await page.window.NexusChatUnread.atualizar();
        assert.equal(page.text('#rh-tab-badge'), '1', 'fora da conversa, a próxima resposta volta a contar');
    });

    test('link do push com ?canal= abre o canal direto', async () => {
        const c = colab([]);
        page = await openPage('chat-colaborador', { client: c, now: NOW, query: '?canal=ch-ti' });
        await page.waitFor(() => page.text('#chat-area-name') === '#ti');
        assert.deepEqual(c.rpcCalls('chat_mark_read').at(-1).args, { p_kind: 'channel', p_thread: 'ch-ti' });
    });

    test('link do push com ?ticket= abre a aba do RH no atendimento; ticket que não é meu é ignorado', async () => {
        page = await openPage('chat-colaborador', { client: colab([]), now: NOW, query: '?ticket=t1' });
        await page.waitFor(() => page.visible('#hr-area'));
        assert.ok(page.$('#tab-rh').classList.contains('active'));
        assert.ok(page.$('.ticket-item[data-ticket-id="t1"]').classList.contains('active'));
        page.close();

        page = await openPage('chat-colaborador', { client: colab([]), now: NOW, query: '?ticket=outro' });
        assert.ok(page.$('#tab-social').classList.contains('active'));
        assert.equal(page.visible('#hr-area'), false);
    });
});

describe('chat-rh.html — sinalização de nova mensagem', () => {
    test('ticket com mensagens não lidas mostra o contador no lugar do ponto de espera', async () => {
        page = await openPage('chat-rh', { client: rh([{ kind: 'ticket', thread: 't2', unread: 3 }]), now: NOW });
        await page.waitFor(() => page.text('.ticket-item[data-ticket-id="t2"] .ti-unread') === '3');
        assert.ok(page.$('.ticket-item[data-ticket-id="t2"]').classList.contains('has-unread'));
        assert.ok(page.$('.ticket-item[data-ticket-id="t1"] .ti-new-dot'));
        assert.equal(page.$('.ticket-item[data-ticket-id="t1"] .ti-unread'), null);
    });

    test('abrir o ticket marca como lido e mantém a seleção ao redesenhar', async () => {
        const c = rh([{ kind: 'ticket', thread: 't2', unread: 3 }]);
        page = await openPage('chat-rh', { client: c, now: NOW });
        await page.click('.ticket-item[data-ticket-id="t2"]');
        assert.deepEqual(c.rpcCalls('chat_mark_read').at(-1).args, { p_kind: 'ticket', p_thread: 't2' });
        assert.equal(page.$('.ticket-item[data-ticket-id="t2"] .ti-unread'), null);
        assert.ok(page.$('.ticket-item[data-ticket-id="t2"]').classList.contains('active'));
    });

    test('link do push com ?ticket= abre o ticket direto', async () => {
        const c = rh([]);
        page = await openPage('chat-rh', { client: c, now: NOW, query: '?ticket=t1' });
        await page.waitFor(() => page.$('.ticket-item[data-ticket-id="t1"]')?.classList.contains('active'));
        assert.equal(page.text('#colab-name'), ANA.name);
    });
});
