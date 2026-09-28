const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, ANA, baseTables, AAL1_CHALLENGE } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const HOME_COLAB = 'http://localhost:4173/src/screens/inicio-colaborador.html';
const HOME_RH = 'http://localhost:4173/src/screens/inicio-rh.html';

function loginClient(user, { senha = 'senha-certa-123', mfa, extra = {} } = {}) {
    const client = new FakeSupabase({ tables: baseTables({ employees: [{ ...ANA }], ...extra }), mfa });
    client.handlers.signIn = ({ email, password }) => {
        if (email !== user.email || password !== senha) return { data: {}, error: { message: 'Invalid login credentials' } };
        client.auth.user = user;
        client.auth.session = { access_token: 't', user };
        return { data: { user, session: client.auth.session }, error: null };
    };
    return client;
}

async function entrar(p, perfil, email, senha) {
    await p.click(p.$(`#form-profile .profile-card[data-click-args*='"${perfil}"']`));
    await p.click('#btn-continue');
    await p.fill('#login-user', email);
    await p.fill('#login-pass', senha);
    await p.click('#btn-login');
}

async function confirmarChaveDeRecuperacao(p) {
    const check = await p.waitFor(() => p.$('#e2e-saved-check'), { message: 'chave de recuperação' });
    assert.match(p.text('.e2e-recovery'), /^[A-Z0-9]{4}(-[A-Z0-9]{4}){7}$/);
    await p.check(check);
    await p.click(p.$$('.e2e-dialog button').find((b) => b.textContent === 'Continuar'));
}

describe('login.html — voltar para a home', () => {
    test('na escolha de perfil o botão voltar leva à home', async () => {
        const client = loginClient(COLAB_USER);
        page = await openPage('login', { client });
        assert.equal(page.$('#nav-back-btn').style.display, 'flex');
        await page.click('#nav-back-btn');
        assert.deepEqual(page.navigations, ['http://localhost:4173/index.html']);

        await page.click(page.$(`#form-profile .profile-card[data-click-args*='"colaborador"']`));
        await page.click('#btn-continue');
        await page.click('#nav-back-btn');
        assert.ok(page.$('#form-profile').classList.contains('active'));
        assert.equal(page.$('#nav-back-btn').style.display, 'flex');
    });
});

describe('login.html — colaborador', () => {
    test('entra, cria as chaves de ponta a ponta, registra o acesso e vai para o início', async () => {
        const client = loginClient(COLAB_USER);
        page = await openPage('login', { client });
        await entrar(page, 'colaborador', 'ANA@empresa.com ', 'senha-certa-123');
        await confirmarChaveDeRecuperacao(page);
        await page.waitFor(() => page.navigations.length);

        assert.deepEqual(page.navigations, [HOME_COLAB]);
        assert.equal(client.calls.find((c) => c.auth === 'signInWithPassword').email, 'ana@empresa.com', 'e-mail normalizado');
        assert.equal(client.writes('e2e_keys', 'upsert').length, 1);
        assert.deepEqual(client.rpcCalls('record_access')[0].args, { p_kind: 'login' });
        assert.ok(client.tables.employees[0].last_access, 'último acesso gravado');
    });

    test('senha errada: avisa sem dizer qual campo errou e registra a falha', async () => {
        const client = loginClient(COLAB_USER);
        page = await openPage('login', { client });
        await entrar(page, 'colaborador', 'ana@empresa.com', 'errada-000000');
        assert.deepEqual(page.toasts(), ['E-mail ou senha incorretos.']);
        assert.deepEqual(client.rpcCalls('report_login_failure')[0].args, { p_email: 'ana@empresa.com' });
        assert.deepEqual(page.navigations, []);
    });

    test('colaborador tentando o card de Administrador é barrado e desconectado', async () => {
        const client = loginClient(COLAB_USER);
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'ana@empresa.com', 'senha-certa-123');
        assert.deepEqual(page.toasts(), ['Este e-mail não tem acesso ao painel Administrativo.']);
        assert.ok(client.calls.some((c) => c.auth === 'signOut'));
        assert.deepEqual(page.navigations, []);
    });

    test('conta sem perfil é desconectada', async () => {
        const client = loginClient(COLAB_USER);
        client.tables.profiles = [];
        page = await openPage('login', { client });
        await entrar(page, 'colaborador', 'ana@empresa.com', 'senha-certa-123');
        assert.deepEqual(page.toasts(), ['Perfil não encontrado. Entre em contato com o RH.']);
    });
});

describe('login.html — RH com verificação em duas etapas', () => {
    test('pede o código; código errado avisa e registra; código certo entra', async () => {
        const client = loginClient(RH_USER, { mfa: { ...AAL1_CHALLENGE, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] } });
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'rh@empresa.com', 'senha-certa-123');
        assert.ok(page.$('#form-mfa').classList.contains('active'));
        assert.equal(page.$('#btn-mfa').disabled, true);

        await page.fill('#mfa-code', '999999');
        await page.click('#btn-mfa');
        assert.equal(page.text('#mfa-code-err'), 'Código inválido ou expirado. Confira o app e tente de novo.');
        assert.equal(client.rpcCalls('report_mfa_failure').length, 1);

        await page.fill('#mfa-code', '123 456');
        await page.click('#btn-mfa');
        await confirmarChaveDeRecuperacao(page);
        await page.waitFor(() => page.navigations.length);
        assert.deepEqual(page.navigations, [HOME_RH]);
        assert.equal(client.writes('e2e_org_keys', 'insert').length, 1, 'primeiro RH cria a chave da organização');
    });

    test('código de recuperação desvincula o app e entra', async () => {
        const client = loginClient(RH_USER, { mfa: { ...AAL1_CHALLENGE, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] } });
        client.handlers.functions['mfa-recover'] = () => ({ data: { ok: true }, error: null });
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'rh@empresa.com', 'senha-certa-123');
        await page.click('#mfa-recovery-toggle');
        assert.equal(page.text('#mfa-code-label'), 'Código de recuperação');
        await page.fill('#mfa-code', 'abcde-fghjk');
        await page.click('#btn-mfa');
        assert.deepEqual(client.calls.find((c) => c.fn === 'mfa-recover').body, { code: 'ABCDEFGHJK' });
        await confirmarChaveDeRecuperacao(page);
        await page.waitFor(() => page.navigations.length);
        assert.deepEqual(page.navigations, [HOME_RH]);
    });

    test('código de recuperação já usado', async () => {
        const client = loginClient(RH_USER, { mfa: { ...AAL1_CHALLENGE, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] } });
        client.handlers.functions['mfa-recover'] = () => ({ data: null, error: { context: { status: 400 } } });
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'rh@empresa.com', 'senha-certa-123');
        await page.click('#mfa-recovery-toggle');
        await page.fill('#mfa-code', 'ABCDE-FGHJK');
        await page.click('#btn-mfa');
        assert.equal(page.text('#mfa-code-err'), 'Código de recuperação inválido ou já usado.');
        assert.deepEqual(page.navigations, []);
    });

    test('cancelar o segundo fator encerra a sessão e volta à escolha de perfil', async () => {
        const client = loginClient(RH_USER, { mfa: { ...AAL1_CHALLENGE, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] } });
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'rh@empresa.com', 'senha-certa-123');
        await page.click('#nav-back-btn');
        assert.ok(page.$('#form-profile').classList.contains('active'));
        assert.ok(client.calls.some((c) => c.auth === 'signOut'));
    });
});

describe('login.html — sessão existente, senha e primeiro acesso', () => {
    test('quem já tem sessão válida do perfil entra direto', async () => {
        const client = new FakeSupabase({ user: COLAB_USER, tables: baseTables() });
        page = await openPage('login', { client });
        await page.click(page.$(`#form-profile .profile-card[data-click-args*='"colaborador"']`));
        await page.click('#btn-continue');
        await page.waitFor(() => page.navigations.length);
        assert.deepEqual(page.navigations, [HOME_COLAB]);
    });

    test('esqueci a senha: valida o e-mail e envia o link', async () => {
        const client = new FakeSupabase({ tables: baseTables() });
        page = await openPage('login', { client });
        page.window.switchTab('forgot');
        await page.fill('#forgot-email', 'nao-e-email');
        await page.click('#btn-forgot-send');
        assert.equal(page.text('#forgot-email-err'), 'Informe um e-mail válido.');
        await page.fill('#forgot-email', 'Ana@Empresa.com');
        await page.click('#btn-forgot-send');
        assert.equal(client.calls.find((c) => c.auth === 'resetPasswordForEmail').email, 'ana@empresa.com');
        assert.equal(page.text('#forgot-email-shown'), 'ana@empresa.com');
    });

    test('link de redefinição: exige senha forte e igual, grava e desconecta', async () => {
        const client = new FakeSupabase({ user: COLAB_USER, tables: baseTables() });
        page = await openPage('login', { client });
        client.auth.emit('PASSWORD_RECOVERY');
        await page.settle();
        assert.ok(page.$('#form-forgot').classList.contains('active'));
        await page.fill('#new-pass', 'curta1');
        await page.fill('#confirm-pass', 'curta1');
        page.window.forgotValidatePass();
        assert.equal(page.text('#confirm-pass-err'), 'Mínimo 12 caracteres.');
        await page.fill('#new-pass', 'senhanova-forte-9');
        await page.fill('#confirm-pass', 'senhanova-forte-9');
        page.window.forgotValidatePass();
        assert.equal(page.$('#btn-reset').disabled, false);
        await page.click('#btn-reset');
        assert.deepEqual(client.calls.find((c) => c.auth === 'updateUser').attrs, { password: 'senhanova-forte-9' });
        assert.ok(client.calls.some((c) => c.auth === 'signOut'));
    });

    test('primeiro acesso por convite: confirma o e-mail do convite e cria a senha', async () => {
        const invited = { ...COLAB_USER, user_metadata: { first_access_pending: true } };
        const client = new FakeSupabase({ user: invited, tables: baseTables() });
        page = await openPage('login', { client, hash: '#type=invite' });
        assert.ok(page.$('#form-first-access').classList.contains('active'));
        assert.equal(page.$('#first-access-email').value, 'ana@empresa.com');
        await page.fill('#first-access-email', 'outra@empresa.com');
        page.window.onFirstAccessEmailInput();
        await page.waitFor(() => page.text('#first-access-email-err'), { timeout: 2000 });
        assert.equal(page.text('#first-access-email-err'), 'Utilize o e-mail do convite recebido.');

        page.window.openCreatePasswordModal();
        await page.fill('#create-pass-new', 'minha-senha-2026');
        await page.fill('#create-pass-confirm', 'minha-senha-2026');
        page.window.validateCreatePass();
        await page.click('#btn-create-pass');
        assert.deepEqual(client.calls.find((c) => c.auth === 'updateUser').attrs, { password: 'minha-senha-2026', data: { first_access_pending: false } });
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/login.html']);
    });
});

describe('login.html — erros de rede, validações e casos de borda', () => {
    const MFA_RH = () => ({ ...AAL1_CHALLENGE, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] });

    test('sem e-mail ou sem senha não tenta entrar; Enter no e-mail envia', async () => {
        const client = loginClient(COLAB_USER);
        page = await openPage('login', { client });
        await page.click(page.$(`#form-profile .profile-card[data-click-args*='"colaborador"']`));
        await page.click('#btn-continue');
        await page.window.handleLogin();
        assert.deepEqual(page.toasts(), ['Informe seu e-mail.']);
        await page.fill('#login-user', 'ana@empresa.com');
        await page.key(page.$('#login-user'), 'Tab');
        await page.key(page.$('#login-user'), 'Enter');
        assert.ok(page.toasts().includes('Informe sua senha.'));
        assert.equal(client.calls.filter((c) => c.auth === 'signInWithPassword').length, 0);
    });

    test('e-mail não confirmado tem mensagem própria e não conta como tentativa de invasão', async () => {
        const client = loginClient(COLAB_USER);
        client.handlers.signIn = () => ({ data: {}, error: { message: 'Email not confirmed' } });
        page = await openPage('login', { client });
        await entrar(page, 'colaborador', 'ana@empresa.com', 'qualquer-senha-1');
        assert.deepEqual(page.toasts(), ['Confirme seu e-mail antes de acessar.']);
        assert.equal(client.rpcCalls('report_login_failure').length, 0);
    });

    test('erro que não é de credencial não é reportado como falha de login', async () => {
        const client = loginClient(COLAB_USER);
        client.handlers.signIn = () => ({ data: {}, error: { message: 'Service unavailable' } });
        page = await openPage('login', { client });
        await entrar(page, 'colaborador', 'ana@empresa.com', 'qualquer-senha-1');
        assert.deepEqual(page.toasts(), ['E-mail ou senha incorretos.']);
        assert.equal(client.rpcCalls('report_login_failure').length, 0);
    });

    test('Administrador tentando o card de colaborador é barrado', async () => {
        const client = loginClient(RH_USER);
        page = await openPage('login', { client });
        await entrar(page, 'colaborador', 'rh@empresa.com', 'senha-certa-123');
        assert.deepEqual(page.toasts(), ['Este e-mail não tem acesso à área de colaborador.']);
        assert.ok(client.calls.some((c) => c.auth === 'signOut'));
    });

    test('queda de rede no login avisa e libera o botão', async () => {
        const client = loginClient(COLAB_USER);
        client.handlers.signIn = () => {
            throw new Error('Failed to fetch');
        };
        page = await openPage('login', { client });
        await entrar(page, 'colaborador', 'ana@empresa.com', 'senha-certa-123');
        assert.deepEqual(page.toasts(), ['Erro de conexão. Verifique sua internet e tente novamente.']);
        assert.equal(page.$('#btn-login').disabled, false);
    });

    test('sem conseguir ler o nível de segurança da conta, desconecta em vez de entrar', async () => {
        const client = loginClient(RH_USER, { mfa: MFA_RH() });
        client.auth.mfa.getAuthenticatorAssuranceLevel = async () => ({ data: null, error: { message: 'x' } });
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'rh@empresa.com', 'senha-certa-123');
        assert.deepEqual(page.toasts(), ['Não foi possível verificar a segurança da conta. Tente novamente.']);
        assert.ok(client.calls.some((c) => c.auth === 'signOut'));
        assert.deepEqual(page.navigations, []);
    });

    test('conta exige segundo fator mas não há fator verificado: desconecta', async () => {
        const client = loginClient(RH_USER, { mfa: { ...AAL1_CHALLENGE, factors: [] } });
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'rh@empresa.com', 'senha-certa-123');
        assert.deepEqual(page.toasts(), ['Não foi possível carregar o segundo fator da conta. Tente novamente.']);
        assert.ok(client.calls.some((c) => c.auth === 'signOut'));
    });

    test('sessão salva de outro perfil é descartada; sessão do mesmo perfil com 2º fator pendente pede o código', async () => {
        const outra = new FakeSupabase({ user: COLAB_USER, tables: baseTables() });
        page = await openPage('login', { client: outra });
        await page.click(page.$(`#form-profile .profile-card[data-click-args*='"Administrador"']`));
        await page.click('#btn-continue');
        await page.settle(20);
        assert.ok(outra.calls.some((c) => c.auth === 'signOut'));
        assert.deepEqual(page.navigations, []);
        page.close();

        const rh = new FakeSupabase({ user: RH_USER, tables: baseTables(), mfa: MFA_RH() });
        page = await openPage('login', { client: rh });
        await page.click(page.$(`#form-profile .profile-card[data-click-args*='"Administrador"']`));
        await page.click('#btn-continue');
        await page.waitFor(() => page.$('#form-mfa').classList.contains('active'));
        assert.deepEqual(page.navigations, []);
    });

    test('segundo fator: queda de rede avisa; alternar entre app e código de recuperação muda o campo', async () => {
        const client = loginClient(RH_USER, { mfa: MFA_RH() });
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'rh@empresa.com', 'senha-certa-123');
        client.auth.mfa.challengeAndVerify = async () => {
            throw new Error('Failed to fetch');
        };
        client.auth.mfa.verify = client.auth.mfa.challengeAndVerify;
        await page.fill('#mfa-code', '123456');
        await page.click('#btn-mfa');
        assert.ok(page.toasts().includes('Erro de conexão. Verifique sua internet e tente novamente.'));
        assert.equal(page.$('#btn-mfa').disabled, false);

        await page.click('#mfa-recovery-toggle');
        assert.equal(page.$('#mfa-code').placeholder, 'XXXXX-XXXXX');
        assert.equal(page.$('#mfa-code').hasAttribute('pattern'), false);
        await page.click('#mfa-recovery-toggle');
        assert.equal(page.text('#mfa-code-label'), 'Código');
        assert.equal(page.$('#mfa-code').getAttribute('pattern'), '[0-9]*');
    });

    test('código de recuperação: muitas tentativas, erro desconhecido e queda de rede têm mensagens próprias', async () => {
        const client = loginClient(RH_USER, { mfa: MFA_RH() });
        const respostas = [
            () => ({ data: null, error: { context: { status: 429 } } }),
            () => ({ data: null, error: { context: {} } }),
            () => {
                throw new Error('Failed to fetch');
            },
        ];
        client.handlers.functions['mfa-recover'] = () => respostas.shift()();
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'rh@empresa.com', 'senha-certa-123');
        await page.click('#mfa-recovery-toggle');
        await page.fill('#mfa-code', 'ABCDE-FGHJK');
        await page.click('#btn-mfa');
        assert.equal(page.text('#mfa-code-err'), 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
        await page.fill('#mfa-code', 'ABCDE-FGHJK');
        await page.click('#btn-mfa');
        assert.equal(page.text('#mfa-code-err'), 'Não foi possível usar o código agora. Tente de novo.');
        await page.fill('#mfa-code', 'ABCDE-FGHJK');
        await page.click('#btn-mfa');
        assert.ok(page.toasts().includes('Erro de conexão. Verifique sua internet e tente novamente.'));
        assert.deepEqual(page.navigations, []);
    });

    test('código de recuperação aceito mas a sessão não renova: pede para entrar de novo com a senha', async () => {
        const client = loginClient(RH_USER, { mfa: MFA_RH() });
        client.handlers.functions['mfa-recover'] = () => ({ data: { ok: true }, error: null });
        client.auth.refreshSession = async () => ({ data: {}, error: { message: 'refresh falhou' } });
        page = await openPage('login', { client });
        await entrar(page, 'Administrador', 'rh@empresa.com', 'senha-certa-123');
        await page.click('#mfa-recovery-toggle');
        await page.fill('#mfa-code', 'ABCDE-FGHJK');
        await page.click('#btn-mfa');
        assert.ok(page.toasts().includes('App autenticador desvinculado. Entre de novo com sua senha.'));
        assert.ok(page.$('#form-profile').classList.contains('active'));
        assert.deepEqual(page.navigations, []);
    });

    test('ponta a ponta: chave errada avisa e pede de novo; "recomeçar" gera nova chave e entra', async () => {
        const client = loginClient(COLAB_USER);
        page = await openPage('login', { client });
        const w = page.window;
        const escolhas = [{ action: 'recover', key: 'ERRADA' }, { action: 'reset' }];
        const mostradas = [];
        w.NexusE2E.afterLogin = async () => ({ status: 'needs-recovery' });
        w.NexusE2E.recover = async () => {
            throw new Error('chave incorreta');
        };
        w.NexusE2E.resetIdentity = async () => 'NOVA-CHAVE';
        w.NexusE2EUI.promptRecovery = async () => escolhas.shift();
        w.NexusE2EUI.showRecoveryKey = async (k) => mostradas.push(k);
        await entrar(page, 'colaborador', 'ana@empresa.com', 'senha-certa-123');
        await page.waitFor(() => page.navigations.length);
        assert.ok(page.toasts().includes('Chave de recuperação incorreta. Confira e tente de novo.'));
        assert.deepEqual(mostradas, ['NOVA-CHAVE']);
        assert.deepEqual(page.navigations, [HOME_COLAB]);
    });

    test('ponta a ponta: chave de recuperação certa recupera e entra', async () => {
        const client = loginClient(COLAB_USER);
        page = await openPage('login', { client });
        const w = page.window;
        const recuperadas = [];
        w.NexusE2E.afterLogin = async () => ({ status: 'needs-recovery' });
        w.NexusE2E.recover = async ({ recoveryKey }) => recuperadas.push(recoveryKey);
        w.NexusE2EUI.promptRecovery = async () => ({ action: 'recover', key: 'CHAVE-CERTA' });
        await entrar(page, 'colaborador', 'ana@empresa.com', 'senha-certa-123');
        await page.waitFor(() => page.navigations.length);
        assert.deepEqual(recuperadas, ['CHAVE-CERTA']);
    });

    test('ponta a ponta: falha inesperada não impede o login e explica que será pedida depois', async () => {
        const client = loginClient(COLAB_USER);
        page = await openPage('login', { client });
        page.window.NexusE2E.afterLogin = async () => {
            throw new Error('IndexedDB indisponível');
        };
        await entrar(page, 'colaborador', 'ana@empresa.com', 'senha-certa-123');
        await page.waitFor(() => page.navigations.length);
        assert.ok(page.toasts().some((t) => /Não foi possível preparar a criptografia de ponta a ponta/.test(t)));
        assert.deepEqual(page.navigations, [HOME_COLAB]);
    });

    test('esqueci a senha: erro do servidor avisa; voltar leva ao login do perfil ou à escolha de perfil', async () => {
        const client = new FakeSupabase({ tables: baseTables() });
        client.auth.resetPasswordForEmail = async () => ({ data: null, error: { message: 'x' } });
        page = await openPage('login', { client });
        await page.click(page.$(`#form-profile .profile-card[data-click-args*='"colaborador"']`));
        await page.click('#btn-continue');
        page.window.switchTab('forgot');
        await page.fill('#forgot-email', 'ana@empresa.com');
        await page.click('#btn-forgot-send');
        assert.equal(page.text('#forgot-email-err'), 'Erro ao enviar e-mail. Tente novamente.');

        page.window.backToLogin();
        assert.ok(page.$('#form-login').classList.contains('active'));
        assert.equal(page.$('#forgot-email').value, '');

        page.window.goToProfileSelection();
        page.window.switchTab('forgot');
        page.window.backToLogin();
        assert.ok(page.$('#form-profile').classList.contains('active'));
        page.window.switchTab('outra-aba');
        assert.ok(page.$('#form-profile').classList.contains('active'), 'aba desconhecida é ignorada');
        page.window.goToLogin();
        assert.ok(page.$('#form-profile').classList.contains('active'), 'sem perfil escolhido não vai para o login');
    });

    test('redefinir senha: erro do servidor avisa e não desconecta; botão desabilitado não envia', async () => {
        const client = new FakeSupabase({ user: COLAB_USER, tables: baseTables() });
        client.errors.auth = { message: 'x' };
        page = await openPage('login', { client });
        client.auth.emit('PASSWORD_RECOVERY');
        await page.settle();
        await page.window.forgotReset();
        assert.equal(client.calls.filter((c) => c.auth === 'updateUser').length, 0);
        await page.fill('#new-pass', 'senhanova-forte-9');
        await page.fill('#confirm-pass', 'senhanova-forte-8');
        page.window.forgotValidatePass();
        assert.equal(page.text('#confirm-pass-err'), 'As senhas não coincidem.');
        await page.fill('#confirm-pass', 'senhanova-forte-9');
        page.window.forgotValidatePass();
        await page.click('#btn-reset');
        assert.deepEqual(page.toasts(), ['Erro ao redefinir senha. Tente novamente.']);
        assert.equal(client.calls.filter((c) => c.auth === 'signOut').length, 0);
    });

    test('mostrar/ocultar senha alterna o campo e o rótulo de acessibilidade', async () => {
        page = await openPage('login', { client: new FakeSupabase({ tables: baseTables() }) });
        const btn = page.$(`[data-click="togglePw"][data-click-args*="login-pass"]`);
        await page.click(btn);
        assert.equal(page.$('#login-pass').type, 'text');
        assert.equal(btn.getAttribute('aria-label'), 'Ocultar senha');
        await page.click(btn);
        assert.equal(page.$('#login-pass').type, 'password');
        assert.equal(btn.getAttribute('aria-label'), 'Mostrar senha');
        page.window.togglePw('nao-existe', btn);
    });

    test('primeiro acesso: e-mail vazio ou inválido não libera; e-mail do convite libera; erro ao criar senha avisa', async () => {
        const invited = { ...COLAB_USER, user_metadata: { first_access_pending: true } };
        const client = new FakeSupabase({ user: invited, tables: baseTables() });
        client.errors.auth = { message: 'x' };
        page = await openPage('login', { client, hash: '#type=invite' });
        const btn = page.$('#btn-first-access');

        await page.fill('#first-access-email', '');
        page.window.onFirstAccessEmailInput();
        assert.equal(btn.disabled, true);
        assert.equal(page.text('#first-access-email-err'), '');

        await page.fill('#first-access-email', 'nao-e-email');
        page.window.onFirstAccessEmailInput();
        await new Promise((r) => setTimeout(r, 700));
        assert.equal(btn.disabled, true);
        assert.equal(page.text('#first-access-email-err'), '');

        await page.fill('#first-access-email', 'ANA@empresa.com');
        page.window.onFirstAccessEmailInput();
        await page.waitFor(() => !btn.disabled, { timeout: 2000 });

        page.window.openCreatePasswordModal();
        await page.fill('#create-pass-new', 'curta');
        await page.window.submitCreatePass();
        assert.equal(client.calls.filter((c) => c.auth === 'updateUser').length, 0, 'senha fraca não é enviada');
        await page.fill('#create-pass-new', 'minha-senha-2026');
        await page.fill('#create-pass-confirm', 'minha-senha-2026');
        page.window.validateCreatePass();
        await page.click('#btn-create-pass');
        assert.equal(page.text('#create-pass-err'), 'Erro ao criar senha. Tente novamente.');
        assert.equal(page.$('#btn-create-pass').disabled, false);
        assert.deepEqual(page.navigations, []);
    });

    test('convite aberto em sessão que chega depois (SIGNED_IN) também vai para o primeiro acesso', async () => {
        const invited = { ...COLAB_USER, user_metadata: { first_access_pending: true } };
        const client = new FakeSupabase({ tables: baseTables() });
        page = await openPage('login', { client });
        client.auth.emit('SIGNED_IN', { user: invited });
        await page.settle();
        assert.ok(page.$('#form-first-access').classList.contains('active'));
        client.auth.emit('SIGNED_IN', { user: invited });
        client.auth.emit('TOKEN_REFRESHED', { user: invited });
        client.auth.emit('SIGNED_IN', { user: COLAB_USER });
        await page.settle();
        assert.equal(page.$('#first-access-email').value, 'ana@empresa.com');
    });

    test('primeiro acesso sem e-mail na sessão pede um novo convite', async () => {
        const invited = { id: 'u-x', user_metadata: { first_access_pending: true } };
        const client = new FakeSupabase({ user: invited, tables: baseTables() });
        page = await openPage('login', { client, hash: '#type=invite' });
        await page.fill('#first-access-email', 'ana@empresa.com');
        page.window.onFirstAccessEmailInput();
        await page.waitFor(() => page.text('#first-access-email-err'), { timeout: 2000 });
        assert.equal(page.text('#first-access-email-err'), 'Sessão inválida. Solicite um novo convite ao RH.');
    });

    test('o aviso some sozinho depois de alguns segundos', async () => {
        page = await openPage('login', { client: new FakeSupabase({ tables: baseTables() }) });
        const w = page.window;
        const original = w.setTimeout;
        w.setTimeout = (fn, ms, ...a) => (ms >= 400 ? (fn(...a), 0) : original(fn, ms, ...a));
        await w.handleLogin();
        w.setTimeout = original;
        assert.deepEqual(page.toasts(), []);
    });
});
