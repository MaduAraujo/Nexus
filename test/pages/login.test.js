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
