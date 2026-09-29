const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

describe('login.html — bordas', () => {
    test('senha forte exige letras e números', async () => {
        page = await openPage('login', { client: new FakeSupabase({ tables: baseTables() }) });
        assert.deepEqual(
            JSON.parse(page.eval(`JSON.stringify([passwordProblem('abcdefghijkl'), passwordProblem('123456789012'), passwordProblem('abcdef123456')])`)),
            ['Use letras e números.', 'Use letras e números.', '']
        );
    });

    test('segundo fator pedido sem fator verificado não devolve fator', async () => {
        page = await openPage('login', { client: new FakeSupabase({ tables: baseTables() }) });
        const id = await page.eval(`
            NexusMfa.assurance = async () => ({ currentLevel: 'aal1', nextLevel: 'aal2' });
            NexusMfa.listFactors = async () => ({ verified: [] });
            pendingMfaFactorId('Administrador');
        `);
        assert.equal(id, null);
    });

    test('sessão retomada de um perfil que o usuário já trocou por outro não navega', async () => {
        page = await openPage('login', { client: new FakeSupabase({ user: RH_USER, tables: baseTables() }) });
        await page.eval(`selectedProfileType = 'colaborador'; resumeProfileSession('Administrador')`);
        await page.settle();
        assert.deepEqual(page.navigations, []);
    });

    test('ações do segundo fator sem desafio pendente, ou com o botão desabilitado, não fazem nada', async () => {
        const client = new FakeSupabase({ tables: baseTables() });
        page = await openPage('login', { client });
        await page.eval('toggleMfaRecovery(); submitMfaCode()');
        await page.eval(
            `_mfaPending = { factorId: 'f1', profile: { profile: 'Administrador' }, recovery: false }; document.getElementById('btn-mfa').disabled = true; submitMfaCode()`
        );
        await page.settle();
        assert.equal(page.$('#mfa-code').value, '');
        assert.equal(page.$('#btn-mfa').disabled, true);
    });

    test('login sem senha digitada (sessão retomada) não mexe nas chaves de ponta a ponta', async () => {
        page = await openPage('login', { client: new FakeSupabase({ tables: baseTables() }) });
        await page.eval(
            `window.__chamou = false; NexusE2E.afterLogin = async () => { window.__chamou = true; return {}; }; setupEndToEnd({ profile: 'colaborador' })`
        );
        assert.equal(page.window.__chamou, false);
    });

    test('aviso de segurança que falha de imediato não impede o fluxo', async () => {
        page = await openPage('login', { client: new FakeSupabase({ tables: baseTables() }) });
        await page.eval(`sb.rpc = () => { throw new Error('offline'); }; reportSecurity('record_access', {})`);
    });

    test('criar senha: senha fraca e senhas diferentes explicam o problema', async () => {
        page = await openPage('login', { client: new FakeSupabase({ tables: baseTables() }) });
        page.$('#create-pass-new').value = 'curta';
        page.$('#create-pass-confirm').value = 'curta';
        page.eval('validateCreatePass()');
        assert.match(page.text('#create-pass-err'), /Mínimo 12 caracteres/);
        page.$('#create-pass-new').value = 'senha-forte-123';
        page.$('#create-pass-confirm').value = 'senha-forte-124';
        page.eval('validateCreatePass()');
        assert.equal(page.text('#create-pass-err'), 'As senhas não coincidem.');
    });

    test('evento de login sem sessão não abre o primeiro acesso', async () => {
        const client = new FakeSupabase({ tables: baseTables() });
        page = await openPage('login', { client });
        client.auth.emit('SIGNED_IN', null);
        await page.settle();
        assert.equal(page.$('#form-first-access').classList.contains('active'), false);
    });

    test('link de redefinição que chega antes de a sessão ser lida mostra só a troca de senha', async () => {
        page = await openPage('login', {
            client: new FakeSupabase({ user: RH_USER, tables: baseTables() }),
            before(w, client) {
                const original = client.auth.getSession.bind(client.auth);
                client.auth.getSession = async () => {
                    client.auth.emit('PASSWORD_RECOVERY');
                    return original();
                };
            },
        });
        assert.ok(page.$('#form-forgot').classList.contains('active'));
        assert.deepEqual(page.navigations, []);
    });
});
