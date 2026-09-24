const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const CANAIS = [
    { id: 'ch-geral', slug: 'geral', name: 'geral', kind: 'channel', icon: 'globe', description: 'Todo mundo' },
    { id: 'ch-fin', slug: 'financeiro', name: 'financeiro', kind: 'channel', dept: 'Financeiro', icon: 'dollar-sign' },
    { id: 'ch-ti', slug: 'ti', name: 'ti', kind: 'channel', dept: 'TI', icon: 'code' },
];

function client(extra = {}, opts = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({
            chat_channels: CANAIS,
            chat_channel_members: [],
            chat_messages: [],
            chat_messages_decrypted: [
                { id: 'm1', channel_id: 'ch-geral', employee_id: BIA.id, content: 'Bom dia <time>!', created_at: '2026-06-17T09:00:00-03:00' },
            ],
            hr_tickets: [],
            hr_ticket_hidden: [],
            hr_ticket_messages: [],
            hr_ticket_messages_decrypted: [],
            kudos: [
                {
                    id: 'k1',
                    from_employee_id: BIA.id,
                    to_employee_id: ANA.id,
                    categoria: 'colaboracao',
                    message: 'Valeu pela ajuda',
                    created_at: '2026-06-16T10:00:00-03:00',
                },
            ],
            anonymous_feedback: [],
            e2e_keys: [],
            ...extra,
        }),
        rpc: {
            colleague_directory: [
                { id: BIA.id, name: BIA.name, dept: BIA.dept, role: BIA.role },
                { id: CAIO.id, name: CAIO.name, dept: CAIO.dept, role: CAIO.role },
            ],
            get_or_create_dm: () => 'dm-ana-caio',
            e2e_channel_member_keys: [],
        },
        ...opts,
    });
}

function sse(...parts) {
    const body = parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n`).join('') + 'data: [DONE]\n';
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('chat-colaborador.html — canais', () => {
    test('entra no #geral e no canal do próprio departamento; separa "meus canais" dos outros', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        const joined = c.writes('chat_channel_members', 'upsert').map((w) => w.payload[0].channel_id);
        assert.deepEqual(joined.sort(), ['ch-fin', 'ch-geral']);
        assert.match(page.text('#channel-list'), /Meus canais financeiro 0 Outros canais geral 0 ti 0/);
    });

    test('abrir um canal mostra as mensagens (escapadas) e enviar grava a mensagem', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        assert.equal(page.text('#chat-area-name'), '#geral');
        assert.match(page.text('#messages-list'), /Bia Lima Bom dia <time>!/);
        assert.equal(page.$('#messages-list time'), null);

        await page.fill('#chat-input', 'Oi, pessoal');
        await page.click('#chat-send-btn');
        assert.deepEqual(c.writes('chat_messages', 'insert')[0].payload, [{ channel_id: 'ch-geral', employee_id: ANA.id, content: 'Oi, pessoal' }]);
        assert.match(page.text('#messages-list'), /Oi, pessoal/);
    });

    test('se o envio falhar, o texto volta para o campo', async () => {
        const c = client();
        c.errors['chat_messages:insert'] = { message: 'offline' };
        page = await openPage('chat-colaborador', { client: c });
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        await page.fill('#chat-input', 'Mensagem importante');
        await page.click('#chat-send-btn');
        assert.equal(page.$('#chat-input').value, 'Mensagem importante');
        assert.ok(page.toasts().some((t) => /Erro ao enviar mensagem/.test(t)));
    });

    test('mensagem nova de outra pessoa chega em tempo real; "digitando" aparece; presença conta online', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        c.tables.chat_messages_decrypted.push({
            id: 'm2',
            channel_id: 'ch-geral',
            employee_id: CAIO.id,
            content: 'Chegou!',
            created_at: '2026-06-17T09:05:00-03:00',
        });
        c.emit('chat_messages', { new: { id: 'm2', channel_id: 'ch-geral', employee_id: CAIO.id } });
        await page.settle();
        assert.match(page.text('#messages-list'), /Caio Prado Chegou!/);

        c.emitBroadcast('typing:ch-geral', 'typing', { employee_id: CAIO.id, name: 'Caio' });
        assert.equal(page.text('#typing-text'), 'Caio está digitando...');

        c.emitPresence({ [ANA.id]: [{}], [CAIO.id]: [{}] });
        assert.equal(page.text('#presence-number'), '2');
    });
});

describe('chat-colaborador.html — conversas diretas', () => {
    test('nova conversa: busca o colega, cria a DM e abre como privada', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#dm-new-btn');
        await page.fill('#dm-search', 'caio');
        assert.equal(page.$$('.dm-picker-item').length, 1);
        await page.click('.dm-picker-item');
        assert.deepEqual(c.rpcCalls('get_or_create_dm')[0].args, { p_other: CAIO.id });
        assert.equal(page.text('#chat-area-name'), 'Caio Prado');
        assert.match(page.text('#compliance-hint-text'), /Conversa privada/);
        assert.match(page.text('#dm-list'), /Caio Prado/);
    });

    test('lista as DMs existentes a partir das participações', async () => {
        const c = client({
            chat_channel_members: [{ employee_id: ANA.id, channel_id: 'dm1', chat_channels: { id: 'dm1', kind: 'dm', dm_key: `${ANA.id}:${BIA.id}` } }],
        });
        page = await openPage('chat-colaborador', { client: c });
        assert.match(page.text('#dm-list'), /Bia Lima/);
    });
});

describe('chat-colaborador.html — atendimento RH', () => {
    test('novo atendimento: bot cumprimenta; pergunta vai para a IA em streaming e a resposta é gravada', async () => {
        const c = client();
        page = await openPage('chat-colaborador', {
            client: c,
            fetch: async (url, init) => {
                assert.match(url, /\/functions\/v1\/ai-employee-chat$/);
                assert.equal(JSON.parse(init.body).message, 'Qual meu saldo de férias?');
                return sse('Você tem ', '**30 dias**.');
            },
        });
        await page.click('#tab-rh');
        await page.click('#new-ticket-btn');
        assert.equal(c.writes('hr_tickets', 'insert')[0].payload[0].status, 'bot');
        assert.match(page.text('#hr-messages-list'), /Olá, Ana! Sou o Agente de Atendimento RH/);

        await page.click('.qr-btn[data-qr="Qual meu saldo de férias?"]');
        await page.waitFor(() => /30 dias/.test(page.text('#hr-messages-list')));
        assert.equal(page.$('#hr-messages-list strong').textContent, '30 dias');
        const gravadas = c.writes('hr_ticket_messages', 'insert').map((w) => [w.payload[0].role, w.payload[0].content]);
        assert.deepEqual(gravadas.slice(-2), [
            ['user', 'Qual meu saldo de férias?'],
            ['bot', 'Você tem **30 dias**.'],
        ]);
    });

    test('IA fora do ar: resposta de fallback honesta', async () => {
        page = await openPage('chat-colaborador', { client: client(), fetch: async () => new Response('{"error":"quota"}', { status: 503 }) });
        await page.click('#tab-rh');
        await page.click('#new-ticket-btn');
        await page.click('.qr-btn[data-qr="Meu último holerite"]');
        await page.waitFor(() => /Não consegui responder agora \(quota\)/.test(page.text('#hr-messages-list')));
    });

    test('"Falar com analista" transfere para o RH e bloqueia o bot', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#tab-rh');
        await page.click('#new-ticket-btn');
        await page.click('.qr-btn[data-qr="Falar com analista"]');
        await page.waitFor(() => c.tables.hr_tickets[0].status === 'aguardando_rh', { timeout: 3000 });
        assert.match(page.text('#hr-messages-list'), /Conversa transferida para analista de RH/);
        assert.equal(page.text('#hr-area-status'), 'Aguardando analista de RH');
    });

    test('atendimento resolvido pede avaliação (CSAT) e grava a nota', async () => {
        const c = client({
            hr_tickets: [{ id: 't1', employee_id: ANA.id, subject: 'Dúvida', status: 'resolvido', created_at: '2026-06-10', updated_at: '2026-06-11' }],
        });
        c.tables.hr_ticket_messages_decrypted.push({ id: 'x', ticket_id: 't1', role: 'rh', content: 'Resolvido!', created_at: '2026-06-11T10:00:00Z' });
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"]');
        assert.match(page.text('#hr-messages-list'), /Analista RH Resolvido!/);
        await page.click('.csat-star[data-rating="5"]');
        assert.equal(c.tables.hr_tickets[0].csat_rating, 5);
        assert.match(page.text('#hr-messages-list'), /Obrigado pela avaliação/);
    });

    test('apagar só para mim esconde o atendimento; para todos apaga', async () => {
        const c = client({
            hr_tickets: [
                { id: 't1', employee_id: ANA.id, subject: 'A', status: 'bot', updated_at: '2026-06-11' },
                { id: 't2', employee_id: ANA.id, subject: 'B', status: 'bot', updated_at: '2026-06-10' },
            ],
        });
        page = await openPage('chat-colaborador', { client: c });
        await page.click('.ticket-item[data-ticket-id="t1"] [data-action="me"]');
        assert.deepEqual(c.writes('hr_ticket_hidden', 'upsert')[0].payload, [{ employee_id: ANA.id, ticket_id: 't1' }]);
        await page.click('.ticket-item[data-ticket-id="t2"] [data-action="all"]');
        assert.equal(c.writes('hr_tickets', 'delete').length, 1);
        assert.match(page.text('#ticket-list'), /Nenhuma conversa ainda/);
    });
});

describe('chat-colaborador.html — reconhecimento e feedback anônimo', () => {
    test('mural de kudos e novo reconhecimento', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#tab-kudos');
        assert.match(page.text('#kudos-wall'), /Bia Lima Ana Souza Colaboração Valeu pela ajuda/);
        await page.click('#btn-dar-reconhecimento');
        page.$('#kudos-colleague').value = CAIO.id;
        await page.fill('#kudos-message', 'Deploy impecável');
        await page.click('#kudos-submit-btn');
        assert.deepEqual(c.writes('kudos', 'insert')[0].payload[0], {
            from_employee_id: ANA.id,
            to_employee_id: CAIO.id,
            categoria: 'colaboracao',
            message: 'Deploy impecável',
        });
        assert.match(page.text('#kudos-wall'), /Ana Souza Caio Prado.*Deploy impecável/);
    });

    test('feedback anônimo não envia nenhum identificador', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#anon-feedback-btn');
        await page.fill('#anon-message', 'Precisamos de mais treinamentos');
        await page.click('#anon-submit-btn');
        assert.deepEqual(c.writes('anonymous_feedback', 'insert')[0].payload, [
            { categoria: page.$('#anon-categoria').value || 'outro', message: 'Precisamos de mais treinamentos' },
        ]);
    });
});
