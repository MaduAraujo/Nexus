const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, MANAGER_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

describe('inicio-rh.html', () => {
    test('saúda conforme a hora e mostra o Administrador', async () => {
        page = await openPage('inicio-rh', { client: new FakeSupabase({ user: RH_USER, tables: baseTables() }), now: '2026-06-17T15:00:00-03:00' });
        assert.equal(page.text('#welcome-greeting'), 'Boa tarde,');
        assert.equal(page.text('#welcome-name'), 'Administrador');
        assert.equal(page.text('#rh-sidebar-avatar'), 'ADM');
    });

    test('RH vinculado a um colaborador vê o próprio nome', async () => {
        const client = new FakeSupabase({ user: RH_USER, tables: baseTables() });
        client.tables.profiles.find((p) => p.id === RH_USER.id).employee_id = BIA.id;
        page = await openPage('inicio-rh', { client, now: '2026-06-17T08:00:00-03:00' });
        assert.equal(page.text('#welcome-greeting'), 'Bom dia,');
        assert.equal(page.text('#welcome-name'), 'Bia Lima');
        assert.equal(page.text('#welcome-avatar'), 'BL');
    });

    test('calendário do topo abre, navega e fecha com Esc; tema alterna e persiste', async () => {
        page = await openPage('inicio-rh', { client: new FakeSupabase({ user: RH_USER, tables: baseTables() }), now: '2026-06-17T20:00:00-03:00' });
        assert.equal(page.text('#welcome-greeting'), 'Boa noite,');
        await page.click('#topbar-date');
        assert.ok(page.$('#calendar-popover').classList.contains('open'));
        assert.equal(page.text('#calendar-title'), 'Junho 2026');
        assert.equal(page.text('.calendar-day--today'), '17');
        await page.click('#calendar-next');
        assert.equal(page.text('#calendar-title'), 'Julho 2026');
        await page.key(page.document, 'Escape');
        assert.ok(!page.$('#calendar-popover').classList.contains('open'));

        await page.click('#theme-toggle-btn');
        assert.equal(page.document.documentElement.getAttribute('data-theme'), 'dark');
        assert.equal(page.window.localStorage.getItem('nexus-theme'), 'dark');
    });

    test('sair encerra a sessão e volta ao login', async () => {
        const client = new FakeSupabase({ user: RH_USER, tables: baseTables() });
        page = await openPage('inicio-rh', { client });
        await page.window.logout();
        assert.ok(client.calls.some((c) => c.auth === 'signOut'));
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/login.html']);
    });
});

describe('inicio-colaborador.html', () => {
    const tarefas = [
        { id: 't1', dias: 30, ordem: 1, titulo: 'Conhecer a equipe', descricao: 'Almoço de boas-vindas' },
        { id: 't2', dias: 30, ordem: 2, titulo: 'Assinar contrato' },
        { id: 't3', dias: 60, ordem: 1, titulo: 'Primeiro 1:1' },
    ];

    function client(user = COLAB_USER, extra = {}) {
        return new FakeSupabase({
            user,
            tables: baseTables({
                messages: [
                    { id: 'm1', texto: 'Feriado na sexta', destino: 'Todos', created_at: '2026-06-10T10:00:00Z' },
                    { id: 'm2', texto: '<b>Fechamento</b>', destino: 'Financeiro', created_at: '2026-06-11T10:00:00Z' },
                ],
                onboarding_tasks: tarefas,
                onboarding_progress: [{ employee_id: ANA.id, task_id: 't1' }],
                vacations: [],
                documents: [],
                ...extra,
            }),
        });
    }

    test('mostra os dados do colaborador', async () => {
        page = await openPage('inicio-colaborador', { client: client() });
        assert.equal(page.text('#welcome-name'), 'Ana Souza');
        assert.equal(page.text('#welcome-avatar'), 'AS');
        assert.equal(page.text('#info-dept'), 'Financeiro');
        assert.equal(page.text('#info-admission'), '01/02/2024');
        assert.equal(page.text('#info-email'), 'ana@empresa.com');
    });

    test('onboarding aparece nos primeiros 100 dias e marcar/desmarcar grava o progresso', async () => {
        const c = client();
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).admission_date = '2026-05-20';
        page = await openPage('inicio-colaborador', { client: c, now: '2026-06-17T10:00:00-03:00' });
        assert.equal(page.visible('#onboarding-card'), true);
        assert.equal(page.text('#onboarding-progress-label'), '1/3');
        assert.match(page.text('#onboarding-stages'), /30 dias \(1\/2\).*Conhecer a equipe.*60 dias \(0\/1\)/);

        await page.check(page.$('#onboarding-stages input[data-change-args*="t2"]'));
        assert.deepEqual(c.writes('onboarding_progress', 'insert')[0].payload, [{ employee_id: ANA.id, task_id: 't2' }]);
        assert.equal(page.text('#onboarding-progress-label'), '2/3');

        await page.check(page.$('#onboarding-stages input[data-change-args*="t1"]'), false);
        assert.equal(c.writes('onboarding_progress', 'delete').length, 1);
        assert.equal(page.text('#onboarding-progress-label'), '1/3');
    });

    test('depois de 100 dias o onboarding some', async () => {
        page = await openPage('inicio-colaborador', { client: client(), now: '2026-06-17T10:00:00-03:00' });
        assert.equal(page.visible('#onboarding-card'), false);
    });

    test('gestor vê o atalho da equipe com férias pendentes', async () => {
        page = await openPage('inicio-colaborador', {
            client: client(MANAGER_USER, { vacations: [{ id: 'v1', employee_id: ANA.id, status: 'pendente' }] }),
        });
        assert.equal(page.visible('#quick-card-equipe'), true);
        assert.equal(page.text('#quick-equipe-desc'), '1 férias pendente');
    });

    test('quem não é gestor não vê a equipe', async () => {
        page = await openPage('inicio-colaborador', { client: client() });
        assert.equal(page.visible('#quick-card-equipe'), false);
    });

    test('alerta de documentos do RH para assinar', async () => {
        page = await openPage('inicio-colaborador', {
            client: client(COLAB_USER, {
                documents: [
                    {
                        id: 'd1',
                        employee_id: ANA.id,
                        source: 'Administrador',
                        is_current: true,
                        tipo: 'Contrato',
                        requer_assinatura: true,
                        assinado_em: null,
                        created_at: '2026-06-01T10:00:00Z',
                    },
                ],
            }),
        });
        assert.equal(page.visible('#docs-alert'), true);
        assert.equal(page.text('#docs-alert-title'), 'Você tem 1 documento do RH para assinar');
        assert.equal(page.text('#docs-alert-sub'), 'Contrato');
    });

    test('conta desativada pelo RH em tempo real desconecta o colaborador', async () => {
        const c = client();
        page = await openPage('inicio-colaborador', { client: c });
        c.emit('employees', { new: { id: ANA.id, status: 'Inativo' } });
        await page.settle();
        assert.match(page.toasts()[0], /Conta desativada pelo RH/);
        await page.waitFor(() => page.navigations.length, { timeout: 4000 });
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/login.html']);
    });
});

describe('comunicados-colaborador.html', () => {
    const MSGS = [
        { id: 'm1', texto: 'Feriado na sexta', destino: 'Todos', categoria: 'Institucional', created_at: '2026-06-16T10:00:00-03:00', anexos: [] },
        {
            id: 'm2',
            texto: '<p>Fechamento <b>contábil</b></p>',
            destino: 'P&D, Inovação',
            categoria: 'Urgente',
            created_at: '2026-06-17T09:30:00-03:00',
            anexos: [{ name: 'a.pdf' }],
        },
        { id: 'm3', texto: 'Só para TI', destino: 'TI', categoria: 'Institucional', created_at: '2026-06-17T09:00:00-03:00', anexos: [] },
    ];

    function client() {
        const c = new FakeSupabase({ user: COLAB_USER, tables: baseTables({ messages: MSGS, message_reads: [{ message_id: 'm1', employee_id: ANA.id }] }) });
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).dept = 'P&D, Inovação';
        return c;
    }

    test('lista os comunicados do departamento (mesmo com vírgula no nome) e de todos', async () => {
        page = await openPage('comunicados-colaborador', { client: client(), now: '2026-06-17T10:00:00-03:00' });
        assert.equal(page.$$('.comunicado-card').length, 2);
        assert.equal(page.text('#stat-total'), '2');
        assert.equal(page.text('#stat-dept'), '1');
        assert.equal(page.text('#unread-count'), '1');
        const novo = page.$('.comunicado-card.nao-lido');
        assert.equal(novo.dataset.id, 'm2');
        assert.match(page.text(novo), /Novo.*1.*Fechamento contábil.*há 30min/);
    });

    test('abrir marca como lido e mostra o texto formatado (sanitizado)', async () => {
        const c = client();
        page = await openPage('comunicados-colaborador', { client: c, now: '2026-06-17T10:00:00-03:00' });
        await page.click('.comunicado-card[data-id="m2"]');
        assert.equal(page.visible('#msg-modal'), true);
        assert.equal(page.$('#modal-body strong').textContent, 'contábil');
        assert.deepEqual(c.writes('message_reads', 'upsert')[0].payload, [{ message_id: 'm2', employee_id: ANA.id }]);
        assert.equal(page.$('#unread-badge').classList.contains('hidden'), true);
        await page.key(page.document, 'Escape');
        assert.equal(page.visible('#msg-modal'), false);
    });

    test('filtro de não lidos e busca', async () => {
        page = await openPage('comunicados-colaborador', { client: client(), now: '2026-06-17T10:00:00-03:00' });
        await page.click('.filter-btn[data-filter="nao-lidos"]');
        assert.deepEqual(
            page.$$('.comunicado-card').map((c) => c.dataset.id),
            ['m2']
        );
        await page.click('.filter-btn[data-filter="todos-vis"]');
        await page.fill('#search-input', 'feriado');
        assert.deepEqual(
            page.$$('.comunicado-card').map((c) => c.dataset.id),
            ['m1']
        );
        await page.fill('#search-input', 'inexistente');
        assert.match(page.text('#comunicados-list'), /Nenhum resultado para "inexistente"/);
    });

    test('marcar todos como lidos', async () => {
        const c = client();
        page = await openPage('comunicados-colaborador', { client: c, now: '2026-06-17T10:00:00-03:00' });
        await page.click('#btn-marcar-todos');
        assert.deepEqual(c.writes('message_reads', 'upsert')[0].payload, [{ message_id: 'm2', employee_id: ANA.id }]);
        assert.equal(page.$$('.comunicado-card.nao-lido').length, 0);
    });
});
