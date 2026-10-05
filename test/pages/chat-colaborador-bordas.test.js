const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const CANAIS = [
    { id: 'ch-geral', slug: 'geral', name: 'geral', kind: 'channel', icon: 'globe' },
    { id: 'ch-x', slug: 'x', name: 'x', kind: 'channel', icon: 'nada' },
];

function client(extra = {}, opts = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({
            chat_channels: CANAIS,
            chat_channel_members: [],
            chat_messages: [],
            chat_messages_decrypted: [],
            hr_tickets: [],
            hr_ticket_hidden: [],
            hr_ticket_messages: [],
            hr_ticket_messages_decrypted: [],
            kudos: [],
            anonymous_feedback: [],
            e2e_keys: [],
            ...extra,
        }),
        rpc: {
            colleague_directory: [
                { id: BIA.id, name: 'Bia  Lima', dept: null, role: null, avatar_url: 'https://storage.test/bia.jpg' },
                { id: CAIO.id, name: CAIO.name, dept: CAIO.dept, role: CAIO.role },
            ],
            get_or_create_dm: () => 'dm-ana-caio',
            e2e_channel_member_keys: [],
        },
        ...opts,
    });
}

const ticket = (id, extra = {}) => ({
    id,
    employee_id: ANA.id,
    subject: 'Dúvida',
    status: 'bot',
    created_at: '2026-06-17T09:30:00-03:00',
    updated_at: '2026-06-17T09:30:00-03:00',
    ...extra,
});

describe('chat-colaborador.html — bordas', () => {
    test('falhas ao ler canais, participações, atendimentos e mural deixam tudo vazio', async () => {
        page = await openPage('chat-colaborador', {
            client: client(
                {},
                {
                    errors: {
                        chat_channels: { message: 'a' },
                        chat_channel_members: { message: 'b' },
                        hr_tickets: { message: 'c' },
                        hr_ticket_hidden: { message: 'd' },
                        kudos: { message: 'e' },
                    },
                }
            ),
            now: NOW,
        });
        assert.match(page.text('#channel-list'), /Nenhum canal disponível/);
        assert.match(page.text('#dm-list'), /Nenhuma conversa ainda/);
        assert.match(page.text('#ticket-list'), /Nenhuma conversa ainda/);
        assert.match(page.text('#kudos-wall'), /Nenhum reconhecimento/);
    });

    test('sem setor não entra em canal de departamento; ícone desconhecido usa #; voltar à aba reabre o canal aberto', async () => {
        const c = client();
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).dept = null;
        page = await openPage('chat-colaborador', { client: c, now: NOW });
        assert.deepEqual(
            c.writes('chat_channel_members', 'upsert').map((w) => w.payload[0].channel_id),
            ['ch-geral']
        );
        assert.ok(page.$('.channel-item[data-channel-id="ch-x"] .fa-hashtag'));
        await page.click('#tab-social');
        await page.click('#tab-rh');
        await page.click('#tab-social');
        assert.equal(page.visible('#chat-welcome'), true);
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        await page.click('#tab-rh');
        assert.equal(page.visible('#chat-welcome'), true);
        await page.click('#tab-social');
        assert.equal(page.visible('#chat-area'), true);
    });

    test('mensagens: autor fora do diretório, colega com foto, troca rápida de canal e Enter sem canal', async () => {
        const c = client({
            chat_messages_decrypted: [
                { id: 'm1', channel_id: 'ch-geral', employee_id: 'sumiu', content: 'Oi', created_at: '2026-06-17T09:00:00-03:00' },
                { id: 'm2', channel_id: 'ch-geral', employee_id: BIA.id, content: 'Olá', created_at: '2026-06-17T09:01:00-03:00' },
                { id: 'm3', channel_id: 'ch-x', employee_id: CAIO.id, content: 'Canal X', created_at: '2026-06-17T09:02:00-03:00' },
            ],
        });
        page = await openPage('chat-colaborador', { client: c, now: NOW });
        page.$('#chat-input').value = 'teste';
        await page.key('#chat-input', 'Enter');
        assert.equal(c.writes('chat_messages', 'insert').length, 0);

        page.$('.channel-item[data-channel-id="ch-geral"]').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        page.$('.channel-item[data-channel-id="ch-x"]').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        await page.settle(30);
        assert.equal(page.text('#messages-list'), 'CP Caio Prado Canal X 09:02');
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        const avatares = page.$$('#messages-list .msg-avatar');
        assert.equal(avatares[0].textContent.trim(), '?');
        assert.equal(avatares[1].getAttribute('data-bg-img'), 'https://storage.test/bia.jpg');
    });

    test('falha ao ler as mensagens do canal mostra a conversa vazia', async () => {
        page = await openPage('chat-colaborador', { client: client({}, { errors: { chat_messages_decrypted: { message: 'x' } } }), now: NOW });
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        assert.equal(page.$$('#messages-list .msg-group').length, 0);
    });

    test('tempo real: mensagem própria e mensagem que não carrega são ignoradas; no atendimento, a mensagem do canal vira contador', async () => {
        let resumo = [];
        const c = client({ hr_tickets: [ticket('t1')] }, { rpc: { ...client().handlers.rpc, chat_unread_summary: () => resumo } });
        page = await openPage('chat-colaborador', { client: c, now: NOW });
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        c.emit('chat_messages', { new: { id: 'eu', channel_id: 'ch-geral', employee_id: ANA.id } });
        c.emit('chat_messages', { new: { id: 'sumiu', channel_id: 'ch-geral', employee_id: BIA.id } });
        await page.settle();
        assert.equal(page.$$('#messages-list .msg-group').length, 0);

        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"]');
        c.tables.chat_messages_decrypted.push({
            id: 'n1',
            channel_id: 'ch-geral',
            employee_id: BIA.id,
            content: 'Novidade',
            created_at: '2026-06-17T09:59:00-03:00',
        });
        resumo = [{ kind: 'channel', thread: 'ch-geral', unread: 1 }];
        c.emit('chat_messages', { new: { id: 'n1', channel_id: 'ch-geral', employee_id: BIA.id } });
        await page.waitFor(() => page.text('#badge-ch-geral') === '1');
        assert.ok(page.$('.channel-item[data-channel-id="ch-geral"]').classList.contains('has-unread'));
        assert.equal(page.visible('#social-tab-badge'), true);
    });

    test('DMs: colega com foto e sem cargo, DM de alguém fora do diretório some, reabrir lista mantém ativa e contador', async () => {
        const c = client({
            chat_channel_members: [
                { employee_id: ANA.id, channel_id: 'dm1', chat_channels: { id: 'dm1', kind: 'dm', dm_key: `${ANA.id}:${BIA.id}` } },
                { employee_id: ANA.id, channel_id: 'dm2', chat_channels: { id: 'dm2', kind: 'dm', dm_key: `${ANA.id}:sumiu` } },
            ],
        });
        page = await openPage('chat-colaborador', { client: c, now: NOW });
        assert.equal(page.$$('.dm-item').length, 1);
        assert.equal(page.$('.dm-item .dm-avatar').getAttribute('data-bg-img'), 'https://storage.test/bia.jpg');
        await page.click('.dm-item[data-channel-id="dm1"]');
        assert.equal(page.text('#chat-area-desc'), 'Offline');

        c.emit('chat_messages', { new: { id: 'q1', channel_id: 'dm1', employee_id: BIA.id } });
        c.emit('chat_messages', { new: { id: 'q2', channel_id: 'dm-desconhecida', employee_id: BIA.id } });
        await page.settle();
        assert.ok(page.$('.dm-item[data-channel-id="dm1"]').classList.contains('active'));

        await page.click('#dm-new-btn');
        await page.fill('#dm-search', 'lima');
        assert.equal(page.$$('.dm-picker-item').length, 1);
        await page.fill('#dm-search', '');
        const itens = page.$$('.dm-picker-item');
        itens[1].dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        itens[1].dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        await page.settle(30);
        assert.equal(c.rpcCalls('get_or_create_dm').length, 1);
    });

    test('DM com mensagem não lida aparece com contador ao redesenhar a lista', async () => {
        const c = client(
            {
                chat_channel_members: [{ employee_id: ANA.id, channel_id: 'dm1', chat_channels: { id: 'dm1', kind: 'dm', dm_key: `${ANA.id}:${BIA.id}` } }],
            },
            { rpc: { ...client().handlers.rpc, chat_unread_summary: [{ kind: 'channel', thread: 'dm1', unread: 3 }] } }
        );
        page = await openPage('chat-colaborador', { client: c, now: NOW });
        await page.click('#dm-new-btn');
        await page.click(page.$$('.dm-picker-item').find((b) => b.dataset.id === CAIO.id));
        await page.settle(30);
        assert.equal(page.text('#badge-dm1'), '3');
        assert.equal(page.visible('#badge-dm1'), true);
        assert.ok(page.$('.dm-item[data-channel-id="dm1"]').classList.contains('has-unread'));
    });

    test('atendimentos: situação desconhecida, sem assunto, horas atrás, erros de mensagens e da saudação, segundo atendimento', async () => {
        const c = client({
            hr_tickets: [
                ticket('t1', { subject: null, status: 'pausado', updated_at: '2026-06-17T05:00:00-03:00' }),
                ticket('t2', { status: 'resolvido', updated_at: '2026-06-17T09:40:00-03:00', hr: true }),
            ],
        });
        c.errors['hr_ticket_messages_decrypted:select'] = { message: 'x' };
        c.errors['hr_ticket_messages:insert'] = { message: 'y' };
        page = await openPage('chat-colaborador', { client: c, now: NOW });
        await page.click('#tab-rh');
        const item = page.$('.ticket-item[data-ticket-id="t1"]');
        assert.match(item.textContent, /pausado/);
        assert.match(item.textContent, /5h atrás/);
        assert.ok(item.querySelector('.tsd-bot'));
        assert.match(page.text('.ticket-item[data-ticket-id="t2"]'), /20min atrás/);
        await page.click(item);
        assert.equal(page.text('#hr-area-name'), 'Atendimento RH');
        assert.equal(page.text('#hr-area-status'), 'Bot');
        assert.equal(page.text('#hr-status-label'), 'pausado');
        assert.match(page.text('#hr-messages-list'), /Sou o Agente de Atendimento RH/);

        await page.click('.ticket-item[data-ticket-id="t2"]');
        c.emit('hr_tickets', { eventType: 'UPDATE', new: { id: 't2', status: 'resolvido' } });
        c.emit('hr_tickets', { eventType: 'UPDATE', new: { id: 't2', status: 'arquivado' } });
        await page.settle();
        assert.equal(page.$$('#hr-messages-list .csat-prompt').length, 1);
        assert.equal(page.text('#hr-area-status'), 'arquivado');
    });

    test('atendimento escalado não conversa com o bot; voltar à aba RH reabre o atendimento', async () => {
        const c = client({ hr_tickets: [ticket('t1', { status: 'aguardando_rh' })] });
        page = await openPage('chat-colaborador', { client: c, now: NOW });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"]');
        const antes = c.writes('hr_ticket_messages', 'insert').length;
        page.$('#hr-input').value = 'oi';
        await page.key('#hr-input', 'Enter');
        assert.equal(c.writes('hr_ticket_messages', 'insert').length, antes);
        await page.click('#tab-social');
        await page.click('#tab-rh');
        assert.equal(page.visible('#hr-area'), true);
    });

    test('assistente: erro sem mensagem, linhas que não são dados, JSON inválido e resposta vazia', async () => {
        const respostas = [
            async () => new Response('{}', { status: 500 }),
            async () => new Response(': ping\ndata: {quebrado\ndata: [DONE]\n', { status: 200 }),
        ];
        const c = client({ hr_tickets: [ticket('t1')] });
        c.errors['hr_ticket_messages_decrypted:select'] = { message: 'x' };
        page = await openPage('chat-colaborador', {
            client: c,
            now: NOW,
            fetch: async (url, init) => (String(url).includes('ai-employee-chat') ? respostas.shift()(url, init) : new Response('{}')),
        });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"]');
        await page.fill('#hr-input', 'Qual meu saldo?');
        await page.key('#hr-input', 'Enter');
        await page.waitFor(() => /Erro 500/.test(page.text('#hr-messages-list')));
        await page.fill('#hr-input', 'De novo');
        await page.key('#hr-input', 'Enter');
        await page.waitFor(() => /Não consegui responder agora\.$/.test(page.$$('#hr-messages-list .msg-group.is-bot .msg-bubble').at(-1).textContent));
    });

    test('pedir analista e apagar a conversa antes da transferência não transfere', async () => {
        const c = client({ hr_tickets: [ticket('t1')] });
        page = await openPage('chat-colaborador', { client: c, now: NOW, confirm: () => true });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"]');
        page.$('#hr-input').value = 'quero um analista';
        page.$('#hr-input').dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await page.settle();
        await page.click('.ticket-item[data-ticket-id="t1"] [data-action="me"]');
        await new Promise((r) => setTimeout(r, 900));
        await page.settle();
        assert.equal(c.writes('hr_tickets', 'update').length, 0);
    });

    test('mural: autor e destinatário desconhecidos e categoria nova; colega sem setor no seletor', async () => {
        page = await openPage('chat-colaborador', {
            client: client({
                kudos: [{ id: 'k1', from_employee_id: 'x', to_employee_id: 'y', categoria: 'nova', message: 'Oi', created_at: '2026-06-16T10:00:00-03:00' }],
            }),
            now: NOW,
        });
        assert.match(page.text('#kudos-wall'), /— — nova Oi/);
        page.window.openKudosModal();
        assert.equal(page.$(`#kudos-colleague option[value="${BIA.id}"]`).textContent, 'Bia  Lima');
    });
});
