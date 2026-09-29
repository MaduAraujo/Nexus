const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T14:00:00-03:00';

const msg = (id, extra = {}) => ({
    id,
    texto: `<p>Aviso ${id}</p>`,
    destino: 'Todos',
    categoria: 'Institucional',
    created_at: '2026-06-16T10:00:00Z',
    ...extra,
});

function client(messages = [], reads = [], opts = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({ messages, message_reads: reads, onboarding_tasks: [], onboarding_progress: [], vacations: [], documents: [] }),
        ...opts,
    });
}

const abrir = (c, extra = {}) => openPage('inicio-colaborador', { client: c, now: NOW, ...extra });

describe('inicio-colaborador.html — sino de avisos', () => {
    test('sem comunicados não lidos, o sino fica sem número e a lista avisa que não há nada novo', async () => {
        page = await abrir(client([msg('m1')], [{ message_id: 'm1', employee_id: ANA.id }]));
        assert.equal(page.visible('#notif-badge'), false);
        assert.equal(page.$('#notif-bell').getAttribute('aria-label'), 'Avisos: nenhum não lido');
        assert.equal(page.$('#notif-bell').classList.contains('has-unread'), false);
        assert.equal(page.text('#notif-count'), '');
        assert.match(page.text('#notif-list'), /Nenhum aviso novo/);
    });

    test('conta só os não lidos para Todos e para o setor da pessoa, com o urgente destacado e link para abrir', async () => {
        const c = client(
            [
                msg('m1', { created_at: '2026-06-16T12:00:00Z' }),
                msg('m2', { destino: 'Financeiro', categoria: 'Urgente', texto: '<p>Prazo do <b>ponto</b></p>' }),
                msg('m3', { destino: 'TI' }),
                msg('m4'),
            ],
            [{ message_id: 'm4', employee_id: ANA.id }]
        );
        page = await abrir(c);
        assert.equal(page.text('#notif-badge'), '2');
        assert.equal(page.visible('#notif-badge'), true);
        assert.equal(page.$('#notif-bell').getAttribute('aria-label'), 'Avisos: 2 não lidos');
        assert.equal(page.text('#notif-count'), '2 não lidos');
        const itens = [...page.document.querySelectorAll('.notif-item')];
        assert.equal(itens.length, 2);
        assert.equal(itens[0].getAttribute('href'), '../screens/comunicados-colaborador.html?id=m1');
        assert.equal(itens[1].classList.contains('notif-item--urgente'), true);
        assert.match(itens[1].textContent, /Urgente/);
        assert.match(itens[1].textContent, /Prazo do ponto/);
        assert.equal(itens[1].innerHTML.includes('<b>'), false);
    });

    test('um único não lido usa o singular', async () => {
        page = await abrir(client([msg('m1')]));
        assert.equal(page.$('#notif-bell').getAttribute('aria-label'), 'Avisos: 1 não lido');
        assert.equal(page.text('#notif-count'), '1 não lido');
    });

    test('mais de 9 não lidos mostra "9+" e a lista traz só os 6 mais recentes', async () => {
        const muitos = Array.from({ length: 11 }, (_, i) => msg(`m${i}`, { created_at: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00Z` }));
        page = await abrir(client(muitos));
        assert.equal(page.text('#notif-badge'), '9+');
        assert.equal(page.text('#notif-count'), '11 não lidos');
        assert.equal(page.document.querySelectorAll('.notif-item').length, 6);
        assert.equal(page.document.querySelector('.notif-item').getAttribute('href'), '../screens/comunicados-colaborador.html?id=m10');
    });

    test('texto longo é resumido na lista', async () => {
        page = await abrir(client([msg('m1', { texto: `<p>${'a'.repeat(150)}</p>` })]));
        assert.equal(page.text('.notif-item-text'), `${'a'.repeat(110)}…`);
    });

    test('pessoa sem setor vê só os comunicados para Todos', async () => {
        const c = client([msg('m1'), msg('m2', { destino: 'Financeiro' })]);
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).dept = null;
        c.tables.employees.find((e) => e.id === ANA.id).dept = null;
        page = await abrir(c);
        assert.equal(page.text('#notif-badge'), '1');
    });

    test('se a leitura dos comunicados falhar, o sino fica vazio em vez de quebrar a tela', async () => {
        page = await abrir(client([msg('m1')], [], { errors: { 'messages:select': { message: 'falhou' } } }));
        assert.equal(page.visible('#notif-badge'), false);
        assert.deepEqual(page.pageErrors, []);
    });

    test('se a leitura dos já lidos falhar, todos contam como não lidos', async () => {
        page = await abrir(
            client([msg('m1'), msg('m2')], [{ message_id: 'm1', employee_id: ANA.id }], { errors: { 'message_reads:select': { message: 'falhou' } } })
        );
        assert.equal(page.text('#notif-badge'), '2');
    });

    test('o sino abre e fecha a lista; clique fora e Esc fecham; clique dentro mantém aberta', async () => {
        page = await abrir(client([msg('m1')]));
        const bell = page.$('#notif-bell');
        const pop = page.$('#notif-popover');

        await page.click('#notif-bell');
        assert.equal(pop.classList.contains('open'), true);
        assert.equal(bell.getAttribute('aria-expanded'), 'true');
        assert.equal(bell.classList.contains('active'), true);

        await page.click('.notif-title');
        assert.equal(pop.classList.contains('open'), true);

        await page.click('#notif-bell');
        assert.equal(pop.classList.contains('open'), false);
        assert.equal(bell.getAttribute('aria-expanded'), 'false');

        await page.click('#notif-bell');
        await page.click('#welcome-name');
        assert.equal(pop.classList.contains('open'), false);

        await page.click('#notif-bell');
        await page.key('#notif-bell', 'Enter');
        assert.equal(pop.classList.contains('open'), true);
        await page.key('#notif-bell', 'Escape');
        assert.equal(pop.classList.contains('open'), false);
        assert.equal(bell.classList.contains('active'), false);
    });

    test('comunicado novo com a tela aberta atualiza o sino e mostra um aviso na tela, uma vez só', async () => {
        const c = client([msg('m1')]);
        page = await abrir(c);
        assert.equal(page.text('#notif-badge'), '1');
        assert.equal(page.toasts().length, 0);

        c.tables.messages.push(msg('m2', { texto: '<p>Reunião geral amanhã</p>', created_at: '2026-06-17T16:00:00Z' }));
        c.emit('messages', { new: { id: 'm2' } });
        await page.settle();
        assert.equal(page.text('#notif-badge'), '2');
        assert.equal(page.toasts().length, 1);
        assert.match(page.toasts()[0], /Novo comunicado do RH/);
        assert.match(page.toasts()[0], /Reunião geral amanhã/);

        c.emit('messages', { new: { id: 'm2' } });
        await page.settle();
        assert.equal(page.toasts().length, 1);
    });

    test('voltar para a aba recarrega o sino; esconder a aba não consulta de novo', async () => {
        const c = client([msg('m1')]);
        page = await abrir(c);
        const doc = page.document;
        const consultas = () => c.calls.filter((x) => x.table === 'messages').length;

        c.tables.message_reads.push({ message_id: 'm1', employee_id: ANA.id });
        Object.defineProperty(doc, 'visibilityState', { configurable: true, value: 'hidden' });
        const antes = consultas();
        doc.dispatchEvent(new page.window.Event('visibilitychange'));
        await page.settle();
        assert.equal(consultas(), antes);
        assert.equal(page.text('#notif-badge'), '1');

        Object.defineProperty(doc, 'visibilityState', { configurable: true, value: 'visible' });
        doc.dispatchEvent(new page.window.Event('visibilitychange'));
        await page.settle();
        assert.equal(page.visible('#notif-badge'), false);
    });
});

describe('comunicados-colaborador.html — abrir pelo link do sino', () => {
    test('?id= de um comunicado visível abre o comunicado', async () => {
        page = await openPage('comunicados-colaborador', { client: client([msg('m1', { texto: '<p>Olá, equipe</p>' })]), now: NOW, query: '?id=m1' });
        assert.equal(page.visible('#msg-modal'), true);
        assert.match(page.text('#modal-body'), /Olá, equipe/);
    });

    test('?id= de um comunicado que a pessoa não vê não abre nada', async () => {
        page = await openPage('comunicados-colaborador', { client: client([msg('m1'), msg('m9', { destino: 'TI' })]), now: NOW, query: '?id=m9' });
        assert.equal(page.visible('#msg-modal'), false);
    });
});
