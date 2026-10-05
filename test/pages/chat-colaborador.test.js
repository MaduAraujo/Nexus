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
        assert.equal(page.text('#compliance-hint-text'), 'Criptografia de ponta a ponta indisponível nesta conversa no momento');
        assert.equal(page.$('#compliance-hint-icon').className, 'fas fa-lock-open');
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

    test('apagar esconde o atendimento só para o colaborador; não há exclusão do histórico do RH', async () => {
        const c = client({
            hr_tickets: [
                { id: 't1', employee_id: ANA.id, subject: 'A', status: 'bot', updated_at: '2026-06-11' },
                { id: 't2', employee_id: ANA.id, subject: 'B', status: 'bot', updated_at: '2026-06-10' },
            ],
        });
        page = await openPage('chat-colaborador', { client: c });
        assert.equal(page.$$('[data-action="all"]').length, 0, 'sem opção de apagar para todos');
        await page.click('.ticket-item[data-ticket-id="t1"] [data-action="me"]');
        assert.match(page.confirms.at(-1), /continua guardado pelo RH/);
        assert.deepEqual(c.writes('hr_ticket_hidden', 'upsert')[0].payload, [{ employee_id: ANA.id, ticket_id: 't1' }]);
        await page.click('.ticket-item[data-ticket-id="t2"] [data-action="me"]');
        assert.equal(c.writes('hr_tickets', 'delete').length, 0);
        assert.equal(c.tables.hr_tickets.length, 2, 'os atendimentos continuam no banco');
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

describe('chat-colaborador.html — atendimento em tempo real e validações', () => {
    test('resposta do RH chega sem recarregar; atendimento resolvido pede avaliação na hora', async () => {
        const c = client({
            hr_tickets: [{ id: 't1', employee_id: ANA.id, subject: 'Dúvida', status: 'aguardando_rh', created_at: '2026-06-10', updated_at: '2026-06-11' }],
        });
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"]');

        c.tables.hr_ticket_messages_decrypted.push({
            id: 'r1',
            ticket_id: 't1',
            role: 'rh',
            content: 'Olá, <b>vou verificar</b>',
            created_at: '2026-06-17T10:00:00Z',
        });
        c.emit('hr_ticket_messages', { eventType: 'INSERT', new: { id: 'r1', ticket_id: 't1', role: 'rh' } });
        await page.waitFor(() => /vou verificar/.test(page.text('#hr-messages-list')));
        assert.equal(page.$$('#hr-messages-list b').length, 0, 'resposta do RH não vira HTML');

        c.emit('hr_ticket_messages', { eventType: 'INSERT', new: { id: 'u9', ticket_id: 't1', role: 'user' } });
        await page.settle();

        c.tables.hr_tickets[0].status = 'resolvido';
        c.emit('hr_tickets', { eventType: 'UPDATE', new: { ...c.tables.hr_tickets[0] } });
        await page.waitFor(() => page.$('.csat-star'));
        assert.equal(page.text('#hr-area-status'), 'Resolvido');
    });

    test('reconhecimento sem colega ou mensagem é barrado; falha do banco avisa sem fechar', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#tab-kudos');
        await page.click('#btn-dar-reconhecimento');
        await page.click('#kudos-submit-btn');
        assert.equal(page.text('#kudos-error'), 'Selecione um colega e escreva uma mensagem.');
        page.$('#kudos-colleague').value = CAIO.id;
        await page.fill('#kudos-message', 'Obrigada!');
        c.errors['kudos:insert'] = { message: 'falhou' };
        await page.click('#kudos-submit-btn');
        assert.equal(page.text('#kudos-error'), 'Não foi possível publicar. Tente novamente.');
    });

    test('feedback anônimo vazio não envia; falha do banco mostra erro', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#anon-feedback-btn');
        assert.equal(page.$('#anon-submit-btn').disabled, true);
        await page.window.submitAnonFeedback();
        assert.equal(page.text('#anon-error'), 'Escreva sua mensagem antes de enviar.');
        await page.fill('#anon-message', 'Precisamos de mais pausas');
        c.errors['anonymous_feedback:insert'] = { message: 'falhou' };
        await page.click('#anon-submit-btn');
        assert.equal(page.text('#anon-error'), 'Não foi possível enviar. Tente novamente.');
        page.window.closeAnonFeedbackModal();
        assert.equal(page.$('#anon-feedback-modal').classList.contains('open'), false);
    });
});

describe('chat-colaborador.html — ponta a ponta, DMs e erros', () => {
    function comE2E(p, { cifra }) {
        p.window.NexusE2E.channelReady = async () => true;
        p.window.NexusE2E.encryptMessage = cifra;
    }

    test('canal cifrado: se a cifragem falha, NADA vai em texto aberto e o texto volta ao campo', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        comE2E(page, {
            cifra: async () => {
                throw new Error('sem chave');
            },
        });
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        await page.settle();
        assert.equal(page.text('#compliance-hint-text'), 'As mensagens são protegidas com a criptografia de ponta a ponta.');
        await page.fill('#chat-input', 'Segredo da equipe');
        await page.click('#chat-send-btn');
        assert.equal(c.writes('chat_messages', 'insert').length, 0);
        assert.equal(page.$('#chat-input').value, 'Segredo da equipe');
        assert.ok(page.toasts().some((t) => /Não foi possível cifrar a mensagem/.test(t)));
    });

    test('canal cifrado: grava só o texto cifrado', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        comE2E(page, { cifra: async (texto) => `nexus-e2e:v1:${Buffer.from(texto).toString('base64')}` });
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        await page.settle();
        await page.fill('#chat-input', 'Segredo da equipe');
        await page.click('#chat-send-btn');
        const [ins] = c.writes('chat_messages', 'insert');
        assert.match(ins.payload[0].content, /^nexus-e2e:v1:/);
        assert.doesNotMatch(ins.payload[0].content, /Segredo/);
    });

    test('DM cifrada avisa que as mensagens são protegidas de ponta a ponta; falha ao criar a conversa avisa', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        comE2E(page, { cifra: async () => 'x' });
        await page.click('#dm-new-btn');
        await page.fill('#dm-search', 'caio');
        await page.click('.dm-picker-item');
        await page.settle();
        assert.equal(page.text('#compliance-hint-text'), 'As mensagens são protegidas com a criptografia de ponta a ponta.');
        page.close();

        const falha = client(
            {},
            {
                rpc: {
                    get_or_create_dm: { error: { message: 'bloqueado' } },
                    colleague_directory: [{ id: CAIO.id, name: CAIO.name, dept: CAIO.dept }],
                    e2e_channel_member_keys: [],
                },
            }
        );
        page = await openPage('chat-colaborador', { client: falha });
        await page.click('#dm-new-btn');
        await page.fill('#dm-search', 'caio');
        await page.click('.dm-picker-item');
        await page.settle();
        assert.equal(page.text('#dm-error'), 'Não foi possível abrir a conversa. Tente novamente.');
        await page.key(page.document, 'Escape');
        assert.equal(page.$('#dm-modal').classList.contains('open'), false);
    });

    test('mensagem nova em outra DM acende o contador; na conversa aberta, não', async () => {
        const c = client({
            chat_channel_members: [{ employee_id: ANA.id, channel_id: 'dm1', chat_channels: { id: 'dm1', kind: 'dm', dm_key: `${ANA.id}:${BIA.id}` } }],
        });
        page = await openPage('chat-colaborador', { client: c });
        c.emit('chat_messages', { new: { id: 'z1', channel_id: 'dm1', employee_id: BIA.id } });
        await page.settle();
        assert.equal(page.text('#badge-dm1'), '1');
        c.emit('chat_messages', { new: { id: 'z2', channel_id: 'dm1', employee_id: ANA.id } });
        c.emit('chat_messages', { new: { id: 'z3', channel_id: 'ch-geral', employee_id: BIA.id } });
        await page.settle();
        assert.equal(page.text('#badge-dm1'), '1', 'mensagem própria e de canal não contam como DM');
    });

    test('criar atendimento com erro avisa; avaliação que falha não agradece', async () => {
        const c = client({
            hr_tickets: [{ id: 't1', employee_id: ANA.id, subject: 'Dúvida', status: 'resolvido', created_at: '2026-06-10', updated_at: '2026-06-11' }],
        });
        c.errors['hr_tickets:insert'] = { message: 'falhou' };
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#tab-rh');
        await page.click('#new-ticket-btn');
        await page.settle();
        assert.ok(page.toasts().some((t) => /Erro|erro|Não foi possível/.test(t)));

        await page.click('.ticket-item[data-ticket-id="t1"]');
        c.errors['hr_tickets:update'] = { message: 'falhou' };
        await page.click('.csat-star[data-rating="4"]');
        await page.settle();
        assert.doesNotMatch(page.text('#hr-messages-list'), /Obrigado pela avaliação/);
    });
});

describe('chat-colaborador.html — painel, teclado, cifra e atendimentos', () => {
    test('no celular, o botão abre a lista de canais e o fundo escuro fecha', async () => {
        page = await openPage('chat-colaborador', { client: client() });
        await page.click('#topbar-panels-btn');
        assert.ok(page.$('#chat-left').classList.contains('open'));
        assert.ok(page.$('#chat-overlay').classList.contains('active'));
        await page.click('#chat-overlay');
        assert.equal(page.$('#chat-left').classList.contains('open'), false);
    });

    test('abrir um canal público de outro departamento faz a pessoa entrar nele', async () => {
        const c = client();
        page = await openPage('chat-colaborador', { client: c });
        const antes = c.writes('chat_channel_members', 'upsert').length;
        await page.click('.channel-item[data-channel-id="ch-ti"]');
        const novos = c.writes('chat_channel_members', 'upsert').slice(antes);
        assert.deepEqual(
            novos.map((w) => w.payload[0].channel_id),
            ['ch-ti']
        );
        assert.equal(page.text('#chat-area-name'), '#ti');
        assert.match(page.text('#channel-list'), /Meus canais .*ti/);
    });

    test('mensagem cifrada: abre com a chave deste acesso; sem a chave, avisa em vez de mostrar lixo', async () => {
        const c = client({
            chat_messages_decrypted: [
                { id: 'e1', channel_id: 'ch-geral', employee_id: BIA.id, content: 'e2e:v1:1:aaa:bbb', created_at: '2026-06-17T09:00:00-03:00' },
                { id: 'e2', channel_id: 'ch-geral', employee_id: BIA.id, content: 'e2e:v1:1:ccc:ddd', created_at: '2026-06-17T09:01:00-03:00' },
            ],
        });
        page = await openPage('chat-colaborador', { client: c });
        page.window.NexusE2E.decryptMessage = async (content) => (content.includes('aaa') ? 'Reunião às 15h' : null);
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        await page.settle();
        const t = page.text('#messages-list');
        assert.match(t, /Reunião às 15h/);
        assert.match(t, /Mensagem cifrada de ponta a ponta que não abre com as chaves deste acesso/);
        assert.doesNotMatch(t, /e2e:v1/);
    });

    test('"digitando" some sozinho; Enter envia e Shift+Enter não', async () => {
        const c = client();
        const agendados = [];
        page = await openPage('chat-colaborador', { client: c });
        await page.click('.channel-item[data-channel-id="ch-geral"]');
        const w = page.window;
        const st = w.setTimeout;
        w.setTimeout = (fn, ms) => (ms === 2500 ? (agendados.push(fn), 0) : st(fn, ms));
        c.emitBroadcast('typing:ch-geral', 'typing', { employee_id: ANA.id, name: 'Eu mesma' });
        assert.equal(page.$('#typing-indicator').classList.contains('hidden'), true, 'a própria digitação não aparece');
        c.emitBroadcast('typing:ch-geral', 'typing', { employee_id: CAIO.id });
        assert.equal(page.text('#typing-text'), 'alguém está digitando...');
        w.setTimeout = st;
        agendados.forEach((f) => f());
        assert.equal(page.$('#typing-indicator').classList.contains('hidden'), true);

        await page.fill('#chat-input', 'linha 1');
        await page.key(page.$('#chat-input'), 'Enter', { shiftKey: true });
        assert.equal(c.writes('chat_messages', 'insert').length, 0);
        await page.key(page.$('#chat-input'), 'Enter');
        assert.equal(c.writes('chat_messages', 'insert')[0].payload[0].content, 'linha 1');
    });

    test('DM aberta mostra se o colega está online; busca sem resultado avisa', async () => {
        const c = client({
            chat_channel_members: [{ employee_id: ANA.id, channel_id: 'dm1', chat_channels: { id: 'dm1', kind: 'dm', dm_key: `${ANA.id}:${BIA.id}` } }],
        });
        page = await openPage('chat-colaborador', { client: c });
        await page.click('.dm-item[data-other-id="' + BIA.id + '"]');
        const offline = page.text('#chat-area-desc');
        c.emitPresence({ [ANA.id]: [{}], [BIA.id]: [{}] });
        assert.notEqual(page.text('#chat-area-desc'), offline);
        assert.match(page.text('#chat-area-desc'), /online/i);
        assert.ok(page.$(`.dm-item[data-other-id="${BIA.id}"]`).classList.contains('online'));

        await page.click('#dm-new-btn');
        await page.fill('#dm-search', 'ninguém com esse nome');
        assert.match(page.text('#dm-picker-list'), /Nenhum colega encontrado/);
    });

    test('menu do atendimento abre e fecha; apagar o atendimento aberto volta à tela inicial', async () => {
        const c = client({
            hr_tickets: [
                { id: 't1', employee_id: ANA.id, subject: 'A', status: 'bot', updated_at: '2026-06-11' },
                { id: 't2', employee_id: ANA.id, subject: 'B', status: 'bot', updated_at: '2026-06-10' },
            ],
        });
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#tab-rh');
        const menu = (id) => page.$(`.ticket-item[data-ticket-id="${id}"] .ticket-menu-dropdown`);
        await page.click('.ticket-item[data-ticket-id="t1"] .ticket-menu-btn');
        assert.ok(menu('t1').classList.contains('open'));
        await page.click('.ticket-item[data-ticket-id="t2"] .ticket-menu-btn');
        assert.equal(menu('t1').classList.contains('open'), false, 'abrir um fecha o outro');
        assert.ok(menu('t2').classList.contains('open'));
        await page.click('.ticket-item[data-ticket-id="t2"] .ticket-menu-btn');
        assert.equal(menu('t2').classList.contains('open'), false);

        await page.click('.ticket-item[data-ticket-id="t1"]');
        await page.click('.ticket-item[data-ticket-id="t1"] [data-action="me"]');
        assert.equal(page.$('.ticket-item[data-ticket-id="t1"]'), null);
        assert.equal(page.$$('.ticket-item.active').length, 0);
        assert.ok(page.toasts().some((t) => /Conversa apagada para você/.test(t)));
    });

    test('apagar atendimento: cancelar não apaga; erro do banco avisa e mantém na lista', async () => {
        const c = client({ hr_tickets: [{ id: 't1', employee_id: ANA.id, subject: 'A', status: 'bot', updated_at: '2026-06-11' }] });
        page = await openPage('chat-colaborador', { client: c, confirm: false });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"] [data-action="me"]');
        assert.equal(c.writes('hr_ticket_hidden', 'upsert').length, 0);
        page.close();

        const e = client({ hr_tickets: [{ id: 't1', employee_id: ANA.id, subject: 'A', status: 'bot', updated_at: '2026-06-11' }] });
        e.errors['hr_ticket_hidden:upsert'] = { message: 'RLS' };
        page = await openPage('chat-colaborador', { client: e });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"] [data-action="me"]');
        assert.ok(page.toasts().some((t) => /Erro ao apagar conversa/.test(t)));
        assert.ok(page.$('.ticket-item[data-ticket-id="t1"]'));
    });

    test('avaliação: passar o mouse acende as estrelas até a escolhida; sair apaga', async () => {
        const c = client({
            hr_tickets: [{ id: 't1', employee_id: ANA.id, subject: 'Dúvida', status: 'resolvido', created_at: '2026-06-10', updated_at: '2026-06-11' }],
        });
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"]');
        const estrelas = page.$$('.csat-star');
        estrelas[2].dispatchEvent(new page.window.MouseEvent('mouseenter'));
        assert.deepEqual(
            estrelas.map((s) => s.classList.contains('active')),
            [true, true, true, false, false]
        );
        estrelas[2].closest('.csat-prompt').dispatchEvent(new page.window.MouseEvent('mouseleave'));
        assert.deepEqual(
            estrelas.map((s) => s.classList.contains('active')),
            [false, false, false, false, false]
        );
    });
});

describe('chat-colaborador.html — estados vazios, histórico do bot e digitação no atendimento', () => {
    test('sem canais e sem reconhecimentos, as listas explicam que estão vazias', async () => {
        page = await openPage('chat-colaborador', { client: client({ chat_channels: [], kudos: [] }) });
        assert.match(page.text('#channel-list'), /Nenhum canal disponível/);
        await page.click('#tab-kudos');
        assert.match(page.text('#kudos-wall'), /Nenhum reconhecimento ainda/);
    });

    test('reabrir um atendimento mostra também as respostas antigas do bot', async () => {
        const c = client({ hr_tickets: [{ id: 't1', employee_id: ANA.id, subject: 'Férias', status: 'bot', updated_at: '2026-06-11' }] });
        c.tables.hr_ticket_messages_decrypted.push(
            { id: 'a', ticket_id: 't1', role: 'user', content: 'Quando posso tirar férias?', created_at: '2026-06-11T10:00:00Z' },
            { id: 'b', ticket_id: 't1', role: 'bot', content: 'Você pode pedir com **30 dias** de antecedência.', created_at: '2026-06-11T10:00:05Z' }
        );
        page = await openPage('chat-colaborador', { client: c });
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"]');
        assert.match(page.text('#hr-messages-list'), /Quando posso tirar férias\?.*Você pode pedir com 30 dias de antecedência/);
    });

    test('digitar e Enter envia a pergunta; Shift+Enter não; depois da resposta dá para chamar um analista', async () => {
        const c = client();
        const perguntas = [];
        page = await openPage('chat-colaborador', {
            client: c,
            fetch: async (url, init) => {
                perguntas.push(JSON.parse(init.body).message);
                return sse('Resposta da IA.');
            },
        });
        await page.click('#tab-rh');
        const input = page.$('#hr-input');
        await page.fill(input, 'x');
        page.$('#hr-send-btn').click();
        assert.equal(perguntas.length, 0, 'sem atendimento aberto, nada é enviado');

        await page.click('#new-ticket-btn');
        await page.fill(input, '   ');
        assert.equal(page.$('#hr-send-btn').disabled, true);
        await page.fill(input, 'Como peço adiantamento?');
        assert.equal(page.$('#hr-send-btn').disabled, false);
        await page.key(input, 'Enter', { shiftKey: true });
        assert.equal(perguntas.length, 0);
        await page.key(input, 'Enter');
        await page.waitFor(() => /Resposta da IA/.test(page.text('#hr-messages-list')));
        assert.deepEqual(perguntas, ['Como peço adiantamento?']);
        assert.equal(input.value, '');

        const botoes = page.$$('.qr-btn[data-qr="Falar com analista"]');
        await page.click(botoes[botoes.length - 1]);
        await page.waitFor(() => c.tables.hr_tickets[0].status === 'aguardando_rh', { timeout: 3000 });
        assert.ok(
            page.$$('.qr-btn').every((b) => b.disabled),
            'as respostas rápidas ficam desabilitadas'
        );
    });

    test('o aviso some sozinho depois de alguns segundos', async () => {
        const c = client({ hr_tickets: [{ id: 't1', employee_id: ANA.id, subject: 'A', status: 'bot', updated_at: '2026-06-11' }] });
        c.errors['hr_ticket_hidden:upsert'] = { message: 'RLS' };
        page = await openPage('chat-colaborador', { client: c });
        const w = page.window;
        const st = w.setTimeout;
        w.setTimeout = (fn, ms, ...a) => (ms >= 400 && ms <= 4000 ? (fn(...a), 0) : st(fn, ms, ...a));
        await page.click('#tab-rh');
        await page.click('.ticket-item[data-ticket-id="t1"] [data-action="me"]');
        w.setTimeout = st;
        assert.equal(
            page.toasts().some((t) => /Erro ao apagar conversa/.test(t)),
            false
        );
    });
});
