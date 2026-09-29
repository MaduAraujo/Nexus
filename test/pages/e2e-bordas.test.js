const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, baseTables } = require('../../test-support/page-fixtures');

const RH2_USER = { id: 'u-rh2', email: 'rh2@empresa.com', factors: [] };

let abertas = [];
afterEach(() => {
    abertas.forEach((p) => p.close());
    abertas = [];
});

function novoMundo() {
    const tables = baseTables({ e2e_keys: [], e2e_org_keys: [], e2e_org_key_grants: [], e2e_channel_keys: [] });
    tables.profiles.push({ id: RH2_USER.id, profile: 'Administrador', employee_id: null });
    return { tables };
}

function rpcs(mundo) {
    return {
        e2e_admins_pending_grant: () =>
            mundo.tables.e2e_keys
                .filter((k) => mundo.tables.profiles.some((p) => p.id === k.user_id && p.profile === 'Administrador'))
                .filter((k) => !mundo.tables.e2e_org_key_grants.some((g) => g.recipient_fp === k.fingerprint))
                .map((k) => ({ user_id: k.user_id, public_key: k.public_key, fingerprint: k.fingerprint })),
    };
}

async function sessao(mundo, user, errors = {}) {
    const client = new FakeSupabase({ user, tables: {}, rpc: rpcs(mundo), errors });
    client.tables = mundo.tables;
    const page = await openPage('login', { client });
    abertas.push(page);
    return { client, page, e2e: (codigo) => page.eval(`NexusE2E.${codigo}`) };
}

async function entrar(mundo, user, senha, isAdmin = false, errors = {}) {
    const s = await sessao(mundo, user, errors);
    const r = await s.e2e(`afterLogin({ password: ${JSON.stringify(senha)}, isAdmin: ${isAdmin} })`);
    return { ...s, r };
}

describe('NexusE2E — bordas', () => {
    test('sem sessão: nada registrado e bloquear não faz nada', async () => {
        const s = await sessao(novoMundo(), null);
        assert.deepEqual({ ...(await s.e2e('status()')) }, { registered: false, unlocked: false, org: false });
        await s.e2e('lock()');
        assert.equal((await s.e2e('afterLogin({ password: "x", isAdmin: false })')).status, 'skipped');
    });

    test('bloquear outro usuário mantém a própria chave; bloquear a si mesmo a esquece; repetir não quebra', async () => {
        const ana = await entrar(novoMundo(), COLAB_USER, 'senha-da-ana-1');
        await ana.e2e('lock("outro-usuario")');
        assert.equal((await ana.e2e('status()')).unlocked, true);
        await ana.e2e('lock()');
        assert.equal((await ana.e2e('status()')).unlocked, false);
        await ana.e2e('lock()');
        assert.equal((await ana.e2e('status()')).registered, true);
    });

    test('sair da conta mesmo se a sessão não puder ser lida', async () => {
        const ana = await entrar(novoMundo(), COLAB_USER, 'senha-da-ana-1');
        await ana.page.eval(`sb.auth.getSession = async () => { throw new Error('offline'); }; sb.auth.signOut()`);
        assert.ok(ana.client.calls.some((c) => c.auth === 'signOut'));
    });

    test('erro ao ler ou gravar a chave própria é repassado', async () => {
        const mundo = novoMundo();
        const leitura = await sessao(mundo, COLAB_USER, { 'e2e_keys:select': { message: 'RLS leitura' } });
        await assert.rejects(leitura.e2e('afterLogin({ password: "senha-1", isAdmin: false })'), { message: 'RLS leitura' });
        const gravacao = await sessao(mundo, COLAB_USER, { 'e2e_keys:upsert': { message: 'RLS gravação' } });
        await assert.rejects(gravacao.e2e('afterLogin({ password: "senha-1", isAdmin: false })'), { message: 'RLS gravação' });
    });

    test('admin que não consegue criar a chave do RH (nem na segunda tentativa) segue sem ela', async () => {
        const rh = await entrar(novoMundo(), RH_USER, 'senha-rh-1', true, { 'e2e_org_keys:insert': { message: 'conflito' } });
        assert.equal(rh.r.status, 'created');
        assert.equal((await rh.e2e('status()')).org, false);
    });

    test('falha ao entregar a chave do RH a si mesmo deixa o admin sem ela', async () => {
        const rh = await entrar(novoMundo(), RH_USER, 'senha-rh-1', true, { 'e2e_org_key_grants:insert': { message: 'RLS' } });
        assert.equal((await rh.e2e('status()')).org, false);
    });

    test('admin cuja entrega da chave do RH sumiu não consegue repassá-la', async () => {
        const mundo = novoMundo();
        const rh1 = await entrar(mundo, RH_USER, 'senha-rh-1', true);
        await entrar(mundo, RH2_USER, 'senha-rh-2', true);
        mundo.tables.e2e_org_key_grants.length = 0;
        assert.equal(await rh1.e2e('grantPendingAdmins()'), 0);
    });

    test('erro ao gravar a senha nova na recuperação é repassado', async () => {
        const mundo = novoMundo();
        const { r } = await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        const ana = await sessao(mundo, COLAB_USER, { 'e2e_keys:update': { message: 'RLS' } });
        await assert.rejects(ana.e2e(`recover({ recoveryKey: ${JSON.stringify(r.recoveryKey)}, password: 'nova-senha-1', isAdmin: false })`), {
            message: 'RLS',
        });
    });

    test('chave apagada enquanto a senha é digitada: o desbloqueio falha sem quebrar', async () => {
        const mundo = novoMundo();
        await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        const ana = await sessao(mundo, COLAB_USER);
        ana.page.window.__apagar = () => {
            mundo.tables.e2e_keys.length = 0;
        };
        await ana.page.eval(
            `NexusE2EUI.promptPassword = async (tentar) => { window.__apagar(); window.__resultado = await tentar('senha-da-ana-1'); return false; }`
        );
        assert.equal(await ana.e2e('ensureUnlocked()'), null);
        assert.equal(ana.page.window.__resultado, false);
    });

    test('canal cujos membros não puderam ser lidos não cifra', async () => {
        const mundo = novoMundo();
        await entrar(mundo, RH_USER, 'senha-rh-1', true);
        const rh = await sessao(mundo, RH_USER, { 'rpc:e2e_channel_member_keys': { message: 'falhou' } });
        await rh.e2e(`afterLogin({ password: 'senha-rh-1', isAdmin: true })`);
        assert.equal(await rh.e2e(`channelReady('canal-1', { isDm: false })`), false);
    });
});
