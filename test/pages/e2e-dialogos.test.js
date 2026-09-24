const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const HOME_COLAB = 'http://localhost:4173/src/screens/inicio-colaborador.html';

async function criarChaves(client, senha, isAdmin) {
    const p = await openPage('login', { client });
    try {
        const r = await p.eval(`NexusE2E.afterLogin({ password: ${JSON.stringify(senha)}, isAdmin: ${isAdmin} })`);
        assert.equal(r.status, 'created');
        return r.recoveryKey;
    } finally {
        p.close();
    }
}

const botao = (p, texto) => p.$$('.e2e-dialog button').find((b) => b.textContent === texto);

describe('diálogos de ponta a ponta (e2e-ui.js)', () => {
    test('navegador novo pede a senha para desbloquear: senha errada avisa, certa desbloqueia', async () => {
        const client = new FakeSupabase({ user: RH_USER, tables: baseTables({ security_alerts: [], security_rules: [] }) });
        await criarChaves(client, 'senha-correta-1', true);

        page = await openPage('seguranca', { client });
        const input = await page.waitFor(() => page.$('.e2e-dialog input[type="password"]'), { message: 'pede a senha' });
        assert.match(page.text('.e2e-dialog'), /Desbloquear dados cifrados/);

        input.value = 'senha-errada-1';
        await page.click(botao(page, 'Desbloquear'));
        await page.waitFor(() => page.text('.e2e-error') === 'Senha incorreta.');

        input.value = 'senha-correta-1';
        await page.key(input, 'Enter');
        await page.waitFor(() => !page.$('.e2e-dialog'));
        await page.waitFor(() => /Proteger arquivos antigos/.test(page.text('#e2e-card')), { timeout: 8000 });
    });

    test('"Agora não" mantém bloqueado e oferece desbloquear depois', async () => {
        const client = new FakeSupabase({ user: RH_USER, tables: baseTables({ security_alerts: [], security_rules: [] }) });
        await criarChaves(client, 'senha-correta-1', true);
        page = await openPage('seguranca', { client });
        await page.waitFor(() => botao(page, 'Agora não'));
        await page.click(botao(page, 'Agora não'));
        await page.waitFor(() => /bloqueadas neste navegador/.test(page.text('#e2e-card')));
    });

    test('senha trocada fora do app: pede a chave de recuperação, valida o formato e recupera', async () => {
        const client = new FakeSupabase({ user: COLAB_USER, tables: baseTables({ employees: [] }) });
        const recoveryKey = await criarChaves(client, 'senha-antiga-123', false);
        client.auth.session = null;
        client.handlers.signIn = ({ password }) => {
            if (password !== 'senha-nova-456') return { data: {}, error: { message: 'Invalid login credentials' } };
            client.auth.session = { access_token: 't', user: COLAB_USER };
            return { data: { user: COLAB_USER, session: client.auth.session }, error: null };
        };

        page = await openPage('login', { client });
        await page.click(page.$(`#form-profile .profile-card[data-click-args*='"colaborador"']`));
        await page.click('#btn-continue');
        await page.fill('#login-user', COLAB_USER.email);
        await page.fill('#login-pass', 'senha-nova-456');
        await page.click('#btn-login');

        const input = await page.waitFor(() => page.$('.e2e-dialog input[type="text"]'), { message: 'pede a chave' });
        assert.match(page.text('.e2e-dialog'), /Recuperar acesso aos dados cifrados/);
        input.value = 'formato-errado';
        await page.click(botao(page, 'Recuperar'));
        assert.match(page.text('.e2e-error'), /Formato inválido/);

        input.value = recoveryKey;
        await page.click(botao(page, 'Recuperar'));
        await page.waitFor(() => page.navigations.length, { timeout: 8000 });
        assert.deepEqual(page.navigations, [HOME_COLAB]);
        assert.equal(client.writes('e2e_keys', 'update').length, 1, 'chaves re-cifradas com a senha nova');
    });

    test('"Não tenho a chave" cria chaves novas depois de confirmar e mostra a nova chave', async () => {
        const client = new FakeSupabase({ user: COLAB_USER, tables: baseTables({ employees: [] }) });
        await criarChaves(client, 'senha-antiga-123', false);
        client.auth.session = null;
        client.handlers.signIn = () => {
            client.auth.session = { access_token: 't', user: COLAB_USER };
            return { data: { user: COLAB_USER, session: client.auth.session }, error: null };
        };

        page = await openPage('login', { client });
        await page.click(page.$(`#form-profile .profile-card[data-click-args*='"colaborador"']`));
        await page.click('#btn-continue');
        await page.fill('#login-user', COLAB_USER.email);
        await page.fill('#login-pass', 'senha-nova-456');
        await page.click('#btn-login');
        await page.waitFor(() => botao(page, 'Não tenho a chave'));
        await page.click(botao(page, 'Não tenho a chave'));
        assert.match(page.confirms.at(-1), /Sem a chave de recuperação/);

        await page.waitFor(() => page.$('#e2e-saved-check'), { timeout: 8000 });
        await page.click(botao(page, 'Copiar'));
        assert.equal(page.clipboard.length, 1);
        await page.click(botao(page, 'Baixar .txt'));
        assert.equal(page.downloads.at(-1).name, 'nexus-chave-de-recuperacao.txt');
        assert.equal(botao(page, 'Continuar').disabled, true, 'só continua depois de confirmar que guardou');
        await page.check('#e2e-saved-check');
        await page.click(botao(page, 'Continuar'));
        await page.waitFor(() => page.navigations.length, { timeout: 8000 });
        assert.equal(client.writes('e2e_keys', 'upsert').length, 2, 'identidade nova');
    });
});
