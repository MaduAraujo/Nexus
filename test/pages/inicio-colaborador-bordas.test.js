const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, MANAGER_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const celular = (w) => Object.defineProperty(w, 'innerWidth', { configurable: true, value: 390 });

function client(user = COLAB_USER, extra = {}, opts = {}) {
    return new FakeSupabase({
        user,
        tables: baseTables({ messages: [], onboarding_tasks: [], onboarding_progress: [], vacations: [], documents: [], ...extra }),
        ...opts,
    });
}

const docRH = (id, extra = {}) => ({
    id,
    employee_id: ANA.id,
    name: `${id}.pdf`,
    tipo: `Tipo ${id}`,
    is_current: true,
    source: 'Administrador',
    requer_assinatura: false,
    assinado_em: null,
    status: 'aprovado',
    created_at: '2026-06-16T10:00:00Z',
    ...extra,
});

describe('inicio-colaborador.html — bordas', () => {
    test('à noite a saudação é "Boa noite"', async () => {
        page = await openPage('inicio-colaborador', { client: client(), now: '2026-06-17T20:00:00-03:00' });
        assert.equal(page.text('#welcome-greeting'), 'Boa noite,');
    });

    test('à tarde, cadastro incompleto (sem cargo, setor, admissão e situação) mostra traços e padrões', async () => {
        const c = client();
        Object.assign(
            c.tables.employees_decrypted.find((e) => e.id === ANA.id),
            { name: 'Ana  Souza', role: null, dept: null, admission_date: null, status: null }
        );
        page = await openPage('inicio-colaborador', { client: c, now: '2026-06-17T15:00:00-03:00' });
        assert.equal(page.text('#welcome-greeting'), 'Boa tarde,');
        assert.equal(page.text('#welcome-avatar'), 'AS');
        assert.equal(page.text('#sidebar-role'), 'Colaborador');
        assert.equal(page.text('#info-role'), '—');
        assert.equal(page.text('#info-admission'), '—');
        assert.equal(page.text('#welcome-status'), 'Ativo');
        assert.equal(page.visible('#onboarding-card'), false);
    });

    test('a cor da situação muda para férias e para outras situações', async () => {
        const c = client();
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).status = 'Férias';
        page = await openPage('inicio-colaborador', { client: c });
        assert.equal(page.$('#welcome-badge i').style.color, 'rgb(250, 204, 21)');
        c.emit('employees', { new: { id: ANA.id, status: 'Afastado' } });
        await page.settle();
        assert.equal(page.$('#welcome-badge i').style.color, 'rgb(248, 113, 113)');
    });

    test('onboarding: etapa já passada ganha a bandeira; falha ao ler o progresso não quebra', async () => {
        const c = client(COLAB_USER, {
            onboarding_tasks: [
                { id: 't1', dias: 30, ordem: 1, titulo: 'Conhecer a equipe' },
                { id: 't2', dias: 60, ordem: 1, titulo: 'Primeiro 1:1' },
            ],
        });
        c.errors['onboarding_progress:select'] = { message: 'x' };
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).admission_date = '2026-05-01';
        page = await openPage('inicio-colaborador', { client: c, now: '2026-06-17T10:00:00-03:00' });
        assert.equal(page.visible('#onboarding-card'), true);
        assert.ok(page.$('#onboarding-stages .fa-flag-checkered'));
        assert.ok(page.$('#onboarding-stages .fa-hourglass-half'));
        assert.equal(page.text('#onboarding-progress-label'), '0/2');
    });

    test('falha ao ler as tarefas de onboarding esconde o cartão', async () => {
        const c = client(COLAB_USER, {}, { errors: { 'onboarding_tasks:select': { message: 'x' } } });
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).admission_date = '2026-06-01';
        page = await openPage('inicio-colaborador', { client: c, now: '2026-06-17T10:00:00-03:00' });
        assert.equal(page.visible('#onboarding-card'), false);
    });

    test('gestor: falha ao ler a equipe esconde o atalho; falha ao ler as férias pendentes mostra "Aprovar férias"', async () => {
        page = await openPage('inicio-colaborador', { client: client(MANAGER_USER, {}, { errors: { 'employees:select': { message: 'x' } } }) });
        assert.equal(page.visible('#quick-card-equipe'), false);
        page.close();
        page = await openPage('inicio-colaborador', { client: client(MANAGER_USER, {}, { errors: { 'vacations:select': { message: 'x' } } }) });
        assert.equal(page.visible('#quick-card-equipe'), true);
        assert.equal(page.text('#quick-equipe-desc'), 'Aprovar férias');
    });

    test('documentos novos do RH: plural; falha ao ler o que já foi visto conta tudo como novo; documento a assinar tem prioridade', async () => {
        const c = client(COLAB_USER, { documents: [docRH('a'), docRH('b')] });
        page = await openPage('inicio-colaborador', {
            client: c,
            before(w) {
                const original = w.Storage.prototype.getItem;
                w.Storage.prototype.getItem = function (k) {
                    if (String(k).startsWith('nexus:docs-seen')) throw new Error('bloqueado');
                    return original.call(this, k);
                };
            },
        });
        assert.equal(page.text('#docs-alert-title'), '2 novos documentos enviados pelo RH');
        c.tables.documents.push(docRH('c', { requer_assinatura: true }));
        c.emit('documents', { eventType: 'INSERT', new: { id: 'c', employee_id: ANA.id } });
        await page.waitFor(() => /para assinar/.test(page.text('#docs-alert-title')));
        assert.equal(page.text('#docs-alert-sub'), 'Tipo c');
    });

    test('falha ao ler os documentos esconde o aviso', async () => {
        page = await openPage('inicio-colaborador', { client: client(COLAB_USER, {}, { errors: { 'documents:select': { message: 'x' } } }) });
        assert.equal(page.visible('#docs-alert'), false);
    });

    test('celular: os botões de menu também fecham o menu aberto', async () => {
        page = await openPage('inicio-colaborador', { client: client(), before: celular });
        await page.click('#topbar-menu-btn');
        await page.click('#topbar-menu-btn');
        assert.equal(page.$('#sidebar').classList.contains('open'), false);
        await page.click('#sidebar-toggle');
        await page.click('#sidebar-toggle');
        assert.equal(page.$('#sidebar').classList.contains('open'), false);
    });

    test('calendário: outra tecla não fecha, Esc fecha e clicar de novo no topo também fecha', async () => {
        page = await openPage('inicio-colaborador', { client: client() });
        await page.click('#topbar-date');
        await page.key(page.document, 'a');
        assert.equal(page.$('#calendar-popover').classList.contains('open'), true);
        await page.key(page.document, 'Escape');
        assert.equal(page.$('#calendar-popover').classList.contains('open'), false);
        await page.click('#topbar-date');
        await page.click('#topbar-date');
        assert.equal(page.$('#calendar-popover').classList.contains('open'), false);
    });
});
