const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const dia = (date, entrada, saida) => ({
    employee_id: ANA.id,
    date,
    entrada: `${date}T${entrada}:00-03:00`,
    saida_almoco: `${date}T12:00:00-03:00`,
    retorno_almoco: `${date}T13:00:00-03:00`,
    saida: `${date}T${saida}:00-03:00`,
});

function client({ emp = {}, extra = {}, signIn } = {}) {
    const c = new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({ time_records: [], bank_adjustments: [], vacations: [], push_subscriptions: [], ...extra }),
        signIn,
    });
    Object.assign(
        c.tables.employees_decrypted.find((e) => e.id === ANA.id),
        emp
    );
    return c;
}

describe('perfil-colaborador.html — dados', () => {
    test('mostra dados pessoais e profissionais', async () => {
        page = await openPage('perfil-colaborador', { client: client({ emp: { telefone: '(11) 9999-0000', bio: 'Contas a pagar' } }), now: NOW });
        assert.equal(page.text('#profile-hero-name'), 'Ana Souza');
        assert.equal(page.text('#profile-hero-sub'), 'Analista · Financeiro');
        assert.equal(page.text('#view-phone'), '(11) 9999-0000');
        assert.equal(page.text('#prof-admission'), '01/02/2024');
        assert.match(page.text('#prof-tenure'), /2 anos e 4 mês\(es\)/);
        assert.equal(page.text('#prof-profile'), 'Colaborador');
    });

    test('editar informações: nome obrigatório; salvar grava nome, telefone e bio', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        await page.click('[data-click="toggleEditInfo"]');
        assert.equal(page.$('#edit-name').value, 'Ana Souza');
        await page.fill('#edit-name', '');
        await page.click('[data-click="saveInfo"]');
        assert.deepEqual(page.toasts(), ['Informe o nome.']);
        assert.equal(c.writes('employees', 'update').length, 0);

        await page.fill('#edit-name', 'Ana Souza Lima');
        await page.fill('#edit-phone', '(11) 98888-7777');
        await page.fill('#edit-bio', 'Tesouraria');
        await page.click('[data-click="saveInfo"]');
        assert.deepEqual(c.writes('employees', 'update')[0].payload, { name: 'Ana Souza Lima', telefone: '(11) 98888-7777', bio: 'Tesouraria' });
        assert.equal(page.text('#profile-hero-name'), 'Ana Souza Lima');
        assert.equal(page.visible('#info-edit'), false);
    });

    test('foto: recusa não-imagem, envia imagem e grava a referência privada; mostra por link assinado; remover volta às iniciais', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        await page.setFiles('#photo-input', [page.file('cv.pdf', '%PDF', 'application/pdf')]);
        assert.deepEqual(page.toasts(), ['Selecione uma imagem válida.']);

        await page.setFiles('#photo-input', [page.file('eu.png', 'png', 'image/png')]);
        const up = c.calls.find((x) => x.storage === 'avatars' && x.op === 'upload');
        assert.equal(up.path, ANA.id);
        assert.match(c.writes('employees', 'update')[0].payload.avatar_url, /^avatars\/emp-ana\?v=\d+$/);
        assert.equal(
            c.calls.some((x) => x.op === 'getPublicUrl'),
            false
        );
        await page.settle();
        assert.equal(page.visible('#profile-avatar-img'), true);
        assert.equal(page.$('#profile-avatar-img').src, 'https://storage.test/avatars/emp-ana?token=t');

        await page.click('[data-click="removePhoto"]');
        assert.equal(c.writes('employees', 'update').at(-1).payload.avatar_url, null);
        assert.equal(page.text('#profile-avatar'), 'AS');
    });

    test('cor do avatar', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        await page.click('[data-click="openColorPicker"]');
        await page.click(page.$$('#color-swatches .color-swatch')[3]);
        assert.deepEqual(c.writes('employees', 'update')[0].payload, { avatar_color: '#10b981', avatar_url: null });
        assert.ok(page.$$('#color-swatches .color-swatch')[3].classList.contains('active'));
    });
});

describe('perfil-colaborador.html — resumo de férias e banco de horas', () => {
    test('férias disponíveis descontam o gozo e os 10 dias vendidos no abono', async () => {
        const c = client({
            extra: {
                vacations: [
                    { employee_id: ANA.id, days: 20, status: 'concluido', abono: true },
                    { employee_id: ANA.id, days: 10, status: 'pendente' },
                ],
            },
        });
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        assert.equal(page.text('#prof-highlight-ferias .prof-highlight-value'), '30 dias');
    });

    test('PJ: férias negociadas', async () => {
        const c = new FakeSupabase({ user: { ...COLAB_USER }, tables: baseTables({ time_records: [], bank_adjustments: [], vacations: [] }) });
        c.tables.profiles.find((p) => p.id === COLAB_USER.id).employee_id = CAIO.id;
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        assert.equal(page.text('#prof-highlight-ferias .prof-highlight-value'), 'Negociado');
        assert.match(page.text('#prof-banco-note'), /PJ/);
    });

    test('banco de horas usa a jornada do contrato (44h = 8h48/dia), não 8h fixas', async () => {
        const c = client({ emp: { work_load: '44h' }, extra: { time_records: [dia('2026-06-15', '08:00', '17:48'), dia('2026-06-16', '08:00', '18:18')] } });
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        assert.equal(page.text('#prof-banco-value'), '+0h 30min');
        assert.equal(page.text('#prof-banco-note'), 'Saldo de 2 dia(s) registrado(s)');
    });

    test('ajustes do RH entram no saldo; sem dias fechados mostra zero', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        assert.equal(page.text('#prof-banco-value'), '0h 00min');
        page.close();
        const c = client({ extra: { bank_adjustments: [{ employee_id: ANA.id, tipo: 'debito', minutos: 90, deleted_at: null }] } });
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        assert.equal(page.text('#prof-banco-value'), '-1h 30min');
    });
});

describe('perfil-colaborador.html — notificações e segurança', () => {
    test('preferência de notificação é gravada mesclada com os padrões', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        assert.equal(page.$('#notif-comunicados').checked, true);
        assert.equal(page.$('#notif-horas').checked, false);
        await page.check('#notif-comunicados', false);
        const prefs = c.writes('employees', 'update')[0].payload.notif_prefs;
        assert.equal(prefs.comunicados, false);
        assert.equal(prefs.seguranca, true);
    });

    test('ativar push pede permissão, assina e grava a inscrição; desativar remove', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW, push: { permission: 'granted' } });
        await page.check('#notif-push-browser');
        const [sub] = c.writes('push_subscriptions', 'upsert');
        assert.deepEqual(sub.payload[0], { employee_id: ANA.id, endpoint: 'https://push.test/sub-1', p256dh: 'p256', auth: 'auth' });
        assert.ok(page.toasts().includes('Notificações push ativadas.'));

        await page.check('#notif-push-browser', false);
        assert.equal(c.writes('push_subscriptions', 'delete').length, 1);
    });

    test('push negado pelo navegador desmarca o botão', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW, push: { permission: 'denied' } });
        await page.check('#notif-push-browser');
        assert.equal(page.$('#notif-push-browser').checked, false);
        assert.match(page.toasts().join(' '), /Permissão negada/);
    });

    test('sem suporte a push o botão fica desabilitado', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        assert.equal(page.$('#notif-push-browser').disabled, true);
        assert.equal(page.text('#notif-push-desc'), 'Não suportado neste navegador.');
    });

    test('trocar senha confere a atual, exige senha forte e troca', async () => {
        const c = client({
            signIn: ({ password }) => (password === 'atual-senha-1' ? { data: {}, error: null } : { data: {}, error: { message: 'Invalid' } }),
        });
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        await page.fill('#curr-pass', 'errada-senha-1');
        await page.fill('#new-pass-profile', 'nova-senha-2026');
        await page.fill('#confirm-pass-profile', 'nova-senha-2026');
        page.window.checkNewPass();
        assert.equal(page.text('#pw-match-msg'), 'Senhas coincidem ✓');
        await page.click('#btn-change-pw');
        assert.deepEqual(page.toasts(), ['Senha atual incorreta.']);

        await page.fill('#curr-pass', 'atual-senha-1');
        page.window.checkNewPass();
        await page.click('#btn-change-pw');
        assert.deepEqual(c.calls.find((x) => x.auth === 'updateUser').attrs, { password: 'nova-senha-2026' });
        assert.ok(page.toasts().includes('Senha alterada com sucesso!'));
        assert.equal(page.$('#curr-pass').value, '');
    });

    test('senha nova fraca é apontada', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        await page.fill('#curr-pass', 'x');
        await page.fill('#new-pass-profile', 'somenteletras');
        await page.fill('#confirm-pass-profile', 'somenteletras');
        page.window.checkNewPass();
        assert.equal(page.text('#pw-match-msg'), 'Use letras e números.');
        assert.equal(page.$('#btn-change-pw').disabled, true);
    });

    test('encerrar todas as sessões', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        await page.click('[data-click="logoutAll"]');
        assert.ok(c.calls.some((x) => x.auth === 'signOut'));
        await page.waitFor(() => page.navigations.length, { timeout: 3000 });
    });
});

describe('perfil-colaborador.html — falhas e casos de borda', () => {
    test('erros do banco ao salvar perfil, foto, cor e preferência avisam e não mudam a tela', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        c.errors['employees:update'] = { message: 'falhou' };

        await page.click('[data-click="toggleEditInfo"]');
        await page.fill('#edit-name', 'Outro Nome');
        await page.click('[data-click="saveInfo"]');
        assert.ok(page.toasts().includes('Erro ao salvar.'));
        assert.equal(page.text('#profile-hero-name'), 'Ana Souza');

        await page.setFiles('#photo-input', [page.file('eu.png', 'png', 'image/png')]);
        assert.ok(page.toasts().includes('Erro ao salvar foto.'));

        await page.click('[data-click="removePhoto"]');
        assert.ok(page.toasts().includes('Erro ao remover foto.'));

        await page.window.saveNotifPref('email', false);
        assert.ok(page.toasts().includes('Erro ao salvar preferência.'));
    });

    test('foto: acima de 10 MB é recusada e falha no Storage não grava a URL', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        const grande = page.file('grande.png', 'x', 'image/png');
        Object.defineProperty(grande, 'size', { value: 11 * 1024 * 1024 });
        await page.setFiles('#photo-input', [grande]);
        assert.ok(page.toasts().includes('Imagem deve ter no máximo 10 MB.'));

        c.errors['storage:avatars:upload'] = { message: 'quota' };
        await page.setFiles('#photo-input', [page.file('eu.png', 'png', 'image/png')]);
        assert.ok(page.toasts().includes('Erro ao enviar foto.'));
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('menus do avatar: abrir um fecha o outro', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        page.window.toggleAvatarMenu();
        assert.equal(page.$('#avatar-menu').classList.contains('open'), true);
        page.window.openColorPicker();
        assert.equal(page.$('#avatar-menu').classList.contains('open'), false);
        assert.equal(page.$('#color-picker').classList.contains('open'), true);
        page.window.toggleAvatarMenu();
        assert.equal(page.$('#color-picker').classList.contains('open'), false);
        page.window.toggleAvatarMenu();
        assert.equal(page.$('#avatar-menu').classList.contains('open'), false);
        page.window.openColorPicker();
        page.window.openColorPicker();
        assert.equal(page.$('#color-picker').classList.contains('open'), false);
    });

    test('iPhone sem o app instalado: push pede instalação antes', async () => {
        page = await openPage('perfil-colaborador', {
            client: client(),
            now: NOW,
            push: { permission: 'granted' },
            before: (w) =>
                Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }),
        });
        assert.equal(page.$('#notif-push-browser').disabled, true);
        assert.match(page.text('#notif-push-desc'), /Instale o app na Tela de Início/);
        await page.window.togglePushNotifications(true);
        assert.match(page.toasts().join(' '), /Instale o app primeiro/);
    });

    test('senha: falha do servidor avisa; falha ao migrar as chaves E2E avisa o que fazer', async () => {
        const c = client({ signIn: () => ({ data: {}, error: null }) });
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        const preencher = async () => {
            await page.fill('#curr-pass', 'atual-senha-1');
            await page.fill('#new-pass-profile', 'nova-senha-2026');
            await page.fill('#confirm-pass-profile', 'nova-senha-2026');
        };
        await preencher();
        c.errors['auth:updateUser'] = { message: 'weak' };
        await page.window.changePassword();
        assert.ok(page.toasts().includes('Erro ao alterar senha. Tente novamente.'));

        delete c.errors['auth:updateUser'];
        page.window.NexusE2E.rewrapPassword = async () => {
            throw new Error('sem chave');
        };
        await preencher();
        await page.window.changePassword();
        assert.match(page.toasts().join(' '), /chaves de ponta a ponta continuam na senha antiga/);

        await page.fill('#new-pass-profile', 'curta1');
        await page.window.changePassword();
        assert.ok(page.toasts().includes('Mínimo 12 caracteres.'));

        await page.fill('#new-pass-profile', 'nova-senha-2026');
        await page.fill('#confirm-pass-profile', 'outra-senha-2026');
        page.window.checkNewPass();
        assert.equal(page.text('#pw-match-msg'), 'As senhas não coincidem.');
        await page.fill('#confirm-pass-profile', '');
        page.window.checkNewPass();
        assert.equal(page.text('#pw-match-msg'), '');
    });

    test('mostrar/ocultar senha e trocar de aba', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        const btn = page.document.createElement('button');
        btn.innerHTML = '<i class="fas fa-eye"></i>';
        page.window.togglePwSmall('curr-pass', btn);
        assert.equal(page.$('#curr-pass').type, 'text');
        assert.equal(btn.querySelector('i').className, 'fas fa-eye-slash');
        page.window.togglePwSmall('curr-pass', btn);
        assert.equal(page.$('#curr-pass').type, 'password');

        const tab = page.$('.ptab:not(.active)');
        const alvo = tab.dataset.clickArgs ? JSON.parse(tab.dataset.clickArgs)[1] : null;
        if (alvo) {
            await page.click(tab);
            assert.equal(page.$(`#ptab-${alvo}`).classList.contains('active'), true);
        }
    });

    test('temporário tem férias proporcionais pagas pela agência (Lei 6.019, art. 12); sem admissão mostra traço', async () => {
        page = await openPage('perfil-colaborador', { client: client({ emp: { contract_type: 'temporario' } }), now: NOW });
        assert.equal(page.text('#prof-highlight-ferias .prof-highlight-value'), 'Proporcionais');
        page.close();
        page = await openPage('perfil-colaborador', { client: client({ emp: { admission_date: null } }), now: NOW });
        assert.equal(page.text('#prof-highlight-ferias .prof-highlight-value'), '—');
    });
});

describe('perfil-colaborador.html — férias por período, push e menus', () => {
    const ferias = () => ({ valor: page.text('#prof-highlight-ferias .prof-highlight-value'), nota: page.text('#prof-highlight-ferias .prof-highlight-note') });

    test('férias: antes de 1 ano mostra o acumulado; no aniversário, 30 dias; tudo gozado mostra só o acumulado', async () => {
        page = await openPage('perfil-colaborador', { client: client({ emp: { admission_date: '2026-01-10' } }), now: NOW });
        assert.deepEqual(ferias(), { valor: '12 dias acumulados', nota: 'Faltam 7 mês(es)' });
        page.close();

        page = await openPage('perfil-colaborador', { client: client({ emp: { admission_date: '2025-06-17' } }), now: NOW });
        assert.deepEqual(ferias(), { valor: '30 dias', nota: 'Próximo vencimento em 12 mês(es)' });
        page.close();

        const gozou = client({ emp: { admission_date: '2025-03-01' }, extra: { vacations: [{ employee_id: ANA.id, days: 30, status: 'concluido' }] } });
        page = await openPage('perfil-colaborador', { client: gozou, now: NOW });
        assert.deepEqual(ferias(), { valor: '7 dias acumulados', nota: 'Próximo vencimento em 8 mês(es)' });
    });

    test('navegador renovou a inscrição de push: a nova é gravada no servidor', async () => {
        const ouvintes = [];
        const c = client();
        page = await openPage('perfil-colaborador', {
            client: c,
            now: NOW,
            push: { permission: 'granted' },
            before: (w) => {
                w.navigator.serviceWorker.addEventListener = (tipo, cb) => ouvintes.push(cb);
            },
        });
        const nova = { endpoint: 'https://push.test/sub-2', keys: { p256dh: 'k2', auth: 'a2' } };
        for (const cb of ouvintes) {
            cb({ data: { type: 'OUTRA_COISA', subscription: nova } });
            cb({ data: { type: 'PUSH_SUBSCRIPTION_CHANGED' } });
            cb({ data: null });
        }
        await page.settle();
        assert.equal(c.writes('push_subscriptions', 'upsert').length, 0);
        for (const cb of ouvintes) cb({ data: { type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: nova } });
        await page.settle();
        assert.deepEqual(c.writes('push_subscriptions', 'upsert')[0].payload[0], {
            employee_id: ANA.id,
            endpoint: 'https://push.test/sub-2',
            p256dh: 'k2',
            auth: 'a2',
        });
    });

    test('desativar push sem inscrição só confirma; falha do navegador ao desativar não quebra a tela', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW, push: { permission: 'granted' } });
        await page.window.togglePushNotifications(false);
        assert.equal(c.writes('push_subscriptions', 'delete').length, 0);
        assert.ok(page.toasts().includes('Notificações push desativadas.'));

        page.window.navigator.serviceWorker.ready.then((reg) => {
            reg.pushManager.getSubscription = async () => {
                throw new Error('serviço indisponível');
            };
        });
        await page.settle();
        await page.window.togglePushNotifications(false);
        assert.equal(page.toasts().filter((t) => t === 'Notificações push desativadas.').length, 1);
        assert.deepEqual(page.pageErrors.map(String), []);
    });

    test('ativar push sem suporte do navegador avisa e desmarca', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        page.$('#notif-push-browser').checked = true;
        await page.window.togglePushNotifications(true);
        assert.ok(page.toasts().some((t) => /Não suportado/.test(t)));
        assert.equal(page.$('#notif-push-browser').checked, false);
    });

    test('se o servidor não gravar a inscrição, o push não fica como ativado', async () => {
        const c = client();
        c.errors['push_subscriptions:upsert'] = { message: 'RLS' };
        page = await openPage('perfil-colaborador', { client: c, now: NOW, push: { permission: 'granted' } });
        await page.check('#notif-push-browser');
        assert.ok(page.toasts().includes('Erro ao ativar notificações push.'));
        assert.equal(page.$('#notif-push-browser').checked, false);
    });

    test('sair encerra a sessão e volta ao login', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        await page.window.logout();
        assert.ok(c.calls.some((x) => x.auth === 'signOut'));
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/login.html']);
    });

    test('"Trocar foto" fecha o menu e abre o seletor de arquivo; Esc e clique fora fecham os menus', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        let abriu = 0;
        page.$('#photo-input').addEventListener('click', () => abriu++);
        page.window.toggleAvatarMenu();
        await page.click('[data-click="triggerPhotoUpload"]');
        assert.equal(abriu, 1);
        assert.equal(page.$('#avatar-menu').classList.contains('open'), false);

        page.window.toggleAvatarMenu();
        await page.key(page.document, 'a');
        assert.equal(page.$('#avatar-menu').classList.contains('open'), true);
        await page.key(page.document, 'Escape');
        assert.equal(page.$('#avatar-menu').classList.contains('open'), false);

        page.window.openColorPicker();
        await page.key(page.document, 'Escape');
        assert.equal(page.$('#color-picker').classList.contains('open'), false);

        page.window.toggleAvatarMenu();
        await page.click('#avatar-menu');
        assert.equal(page.$('#avatar-menu').classList.contains('open'), true, 'clique dentro do menu não fecha');
        await page.click(page.document.body);
        assert.equal(page.$('#avatar-menu').classList.contains('open'), false);
    });

    test('o aviso some sozinho depois de alguns segundos', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        const w = page.window;
        const original = w.setTimeout;
        w.setTimeout = (fn, ms, ...a) => (ms >= 400 && ms < 1000 ? (fn(...a), 0) : ms >= 4000 ? (fn(...a), 0) : original(fn, ms, ...a));
        await w.togglePushNotifications(true);
        w.setTimeout = original;
        assert.deepEqual(page.toasts(), []);
    });
});

describe('perfil-colaborador.html — cor, reposicionamento e tempo real', () => {
    test('erro ao salvar a cor avisa e mantém a cor antiga', async () => {
        const c = client({ emp: { avatar_color: '#6366f1' } });
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        c.errors['employees:update'] = { message: 'falhou' };
        page.window.openColorPicker();
        const outra = page.$$('#color-swatches .color-swatch').find((s) => !s.classList.contains('active'));
        await page.click(outra);
        assert.ok(page.toasts().includes('Erro ao salvar cor.'));
        assert.equal(page.$('#color-swatches .color-swatch.active').title, '#6366f1');
    });

    test('rolar ou redimensionar a tela reposiciona o menu aberto junto do botão', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        const w = page.window;
        const menu = page.$('#avatar-menu');
        const picker = page.$('#color-picker');
        let top = 100;
        page.$('#avatar-edit-btn').getBoundingClientRect = () => ({ top, bottom: top + 30, left: 50, right: 80, width: 30, height: 30 });

        w.dispatchEvent(new w.Event('scroll'));
        assert.equal(menu.style.top, '', 'fechado não é reposicionado');

        w.toggleAvatarMenu();
        const antes = menu.style.top;
        top = 300;
        w.dispatchEvent(new w.Event('scroll'));
        assert.notEqual(menu.style.top, antes);

        w.openColorPicker();
        const antesPicker = picker.style.top;
        top = 20;
        w.dispatchEvent(new w.Event('resize'));
        assert.notEqual(picker.style.top, antesPicker);
        w.dispatchEvent(new w.Event('resize'));
    });

    test('sem o botão do avatar, rolar e redimensionar não quebram', async () => {
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        page.$('#avatar-edit-btn').remove();
        page.window.dispatchEvent(new page.window.Event('scroll'));
        page.window.dispatchEvent(new page.window.Event('resize'));
        assert.deepEqual(page.pageErrors.map(String), []);
    });

    test('RH atualiza o cadastro: nome e cor mudam na hora', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        c.emit('employees', { new: { id: ANA.id, name: 'Ana Souza Lima', avatar_color: '#10b981', status: 'Ativo' } });
        await page.settle(20);
        assert.equal(page.text('#profile-hero-name'), 'Ana Souza Lima');
        assert.equal(page.$('#color-swatches .color-swatch.active').title, '#10b981');
    });

    test('conta desativada pelo RH em tempo real desconecta', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        c.emit('employees', { new: { id: ANA.id, status: 'Bloqueado' } });
        await page.settle();
        assert.ok(page.toasts().some((t) => /Conta desativada pelo RH/.test(t)));
        await page.waitFor(() => page.navigations.length, { timeout: 4000 });
        assert.ok(c.calls.some((x) => x.auth === 'signOut'));
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/login.html']);
    });
});
