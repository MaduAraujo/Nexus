const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, MANAGER_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

const CAIO_USER = { id: 'u-caio', email: 'caio@empresa.com', factors: [] };
const RH2_USER = { id: 'u-rh2', email: 'rh2@empresa.com', factors: [] };
const EMP_DO_USER = { [COLAB_USER.id]: ANA.id, [MANAGER_USER.id]: BIA.id, [CAIO_USER.id]: CAIO.id };

let abertas = [];
afterEach(() => {
    abertas.forEach((p) => p.close());
    abertas = [];
});

function novoMundo() {
    const tables = baseTables({ e2e_keys: [], e2e_org_keys: [], e2e_org_key_grants: [], e2e_channel_keys: [] });
    tables.profiles.push({ id: CAIO_USER.id, profile: 'colaborador', employee_id: CAIO.id }, { id: RH2_USER.id, profile: 'Administrador', employee_id: null });
    return { tables, membros: {} };
}

function chaveDoUsuario(tables, userId) {
    return tables.e2e_keys.find((k) => k.user_id === userId) || null;
}

function rpcs(mundo) {
    return {
        e2e_admins_pending_grant: () =>
            mundo.tables.profiles
                .filter((p) => p.profile === 'Administrador')
                .map((p) => chaveDoUsuario(mundo.tables, p.id))
                .filter((k) => k && !mundo.tables.e2e_org_key_grants.some((g) => g.recipient_fp === k.fingerprint))
                .map((k) => ({ user_id: k.user_id, public_key: k.public_key, fingerprint: k.fingerprint })),
        e2e_employee_key: ({ p_employee_id }) => {
            const userId = Object.keys(EMP_DO_USER).find((u) => EMP_DO_USER[u] === p_employee_id);
            const k = chaveDoUsuario(mundo.tables, userId);
            return k ? [{ public_key: k.public_key, fingerprint: k.fingerprint }] : [];
        },
        e2e_channel_member_keys: ({ p_channel }) =>
            (mundo.membros[p_channel] || []).map((empId) => {
                const userId = Object.keys(EMP_DO_USER).find((u) => EMP_DO_USER[u] === empId);
                const k = chaveDoUsuario(mundo.tables, userId);
                return { employee_id: empId, public_key: k?.public_key || null, fingerprint: k?.fingerprint || null };
            }),
    };
}

async function sessao(mundo, user, errors = {}) {
    const client = new FakeSupabase({ user, tables: {}, rpc: rpcs(mundo), errors });
    client.tables = mundo.tables;
    const page = await openPage('login', { client });
    abertas.push(page);
    const e2e = (codigo) => page.eval(`NexusE2E.${codigo}`);
    return { client, page, e2e };
}

async function entrar(mundo, user, senha, isAdmin = false) {
    const s = await sessao(mundo, user);
    const r = await s.e2e(`afterLogin({ password: ${JSON.stringify(senha)}, isAdmin: ${isAdmin} })`);
    return { ...s, r };
}

const texto = (bytes) => Buffer.from(bytes).toString('utf8');
const semPlano = (p) => new p.window.TextEncoder().encode('holerite de junho');

describe('NexusE2E — sessão e senha', () => {
    test('login com chaves já existentes: senha certa desbloqueia, errada pede recuperação, sem senha não faz nada', async () => {
        const mundo = novoMundo();
        const primeiro = await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        assert.equal(primeiro.r.status, 'created');

        const certo = await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        assert.equal(certo.r.status, 'unlocked');
        assert.deepEqual({ ...(await certo.e2e('status()')) }, { registered: true, unlocked: true, org: false });

        const errado = await entrar(mundo, COLAB_USER, 'senha-errada-99');
        assert.equal(errado.r.status, 'needs-recovery');
        assert.deepEqual({ ...(await errado.e2e('status()')) }, { registered: true, unlocked: false, org: false });

        const semSenha = await sessao(mundo, COLAB_USER);
        assert.equal((await semSenha.e2e('afterLogin({ password: "", isAdmin: false })')).status, 'skipped');
        assert.equal(mundo.tables.e2e_keys.length, 1, 'não cria segunda identidade');
    });

    test('trocar a senha re-cifra a chave: a nova desbloqueia e a antiga deixa de abrir', async () => {
        const mundo = novoMundo();
        const ana = await entrar(mundo, COLAB_USER, 'senha-antiga-1');
        const publicaAntes = JSON.stringify(chaveDoUsuario(mundo.tables, COLAB_USER.id).public_key);

        await ana.e2e(`rewrapPassword('senha-antiga-1', 'senha-nova-22')`);
        assert.equal(ana.client.writes('e2e_keys', 'update').length, 1);
        assert.equal(JSON.stringify(chaveDoUsuario(mundo.tables, COLAB_USER.id).public_key), publicaAntes, 'a identidade continua a mesma');

        assert.equal((await entrar(mundo, COLAB_USER, 'senha-nova-22')).r.status, 'unlocked');
        assert.equal((await entrar(mundo, COLAB_USER, 'senha-antiga-1')).r.status, 'needs-recovery');
    });

    test('trocar a senha sem chaves criadas não grava nada; com a senha atual errada, falha sem gravar', async () => {
        const mundo = novoMundo();
        const bia = await sessao(mundo, MANAGER_USER);
        await bia.e2e(`rewrapPassword('a', 'b')`);
        assert.equal(bia.client.writes('e2e_keys', 'update').length, 0);

        const ana = await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        await assert.rejects(ana.e2e(`rewrapPassword('outra-senha', 'nova')`));
        assert.equal(ana.client.writes('e2e_keys', 'update').length, 0);
    });

    test('erro do banco ao gravar a senha nova é repassado para a tela avisar', async () => {
        const mundo = novoMundo();
        await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        const ana = await sessao(mundo, COLAB_USER, { 'e2e_keys:update': { message: 'RLS' } });
        await assert.rejects(ana.e2e(`rewrapPassword('senha-da-ana-1', 'senha-nova-2')`), { message: 'RLS' });
    });
});

describe('NexusE2E — chave do RH compartilhada entre administradores', () => {
    test('admin com a chave do RH entrega a chave a um admin novo, que passa a ter acesso', async () => {
        const mundo = novoMundo();
        const rh1 = await entrar(mundo, RH_USER, 'senha-rh-1', true);
        assert.equal((await rh1.e2e('status()')).org, true);

        const rh2 = await entrar(mundo, RH2_USER, 'senha-rh-2', true);
        assert.equal((await rh2.e2e('status()')).org, false, 'sem grant ainda');

        assert.equal(await rh1.e2e('grantPendingAdmins()'), 1);
        assert.equal(mundo.tables.e2e_org_key_grants.length, 2);
        assert.equal(await rh1.e2e('grantPendingAdmins()'), 0, 'ninguém mais pendente');

        const rh2Depois = await entrar(mundo, RH2_USER, 'senha-rh-2', true);
        assert.equal((await rh2Depois.e2e('status()')).org, true);
    });

    test('quem não tem a chave do RH não entrega nada', async () => {
        const mundo = novoMundo();
        await entrar(mundo, RH_USER, 'senha-rh-1', true);
        const rh2 = await entrar(mundo, RH2_USER, 'senha-rh-2', true);
        assert.equal(await rh2.e2e('grantPendingAdmins()'), 0);
        const ana = await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        assert.equal(await ana.e2e('grantPendingAdmins()'), 0);
        assert.equal(mundo.tables.e2e_org_key_grants.length, 1);
    });
});

describe('NexusE2E — arquivos', () => {
    test('arquivo cifrado para o colaborador abre para ele e para o RH, e só para eles', async () => {
        const mundo = novoMundo();
        const rh = await entrar(mundo, RH_USER, 'senha-rh-1', true);
        const ana = await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        const bia = await entrar(mundo, MANAGER_USER, 'senha-da-bia-1');

        rh.page.window.plano = semPlano(rh.page);
        const opts = `{ bucket: 'documents', path: 'emp-ana/holerite.pdf', mime: 'application/pdf'`;
        const cifrado = await rh.e2e(`encryptFile(window.plano, ${opts}, employeeId: '${ANA.id}' })`);
        assert.equal(await rh.e2e(`isEncryptedFile(window.plano)`), false);
        assert.equal(ana.page.eval('NexusE2E.isEncryptedFile')(cifrado), true);

        for (const quem of [ana, rh]) {
            quem.page.window.cifrado = cifrado;
            const aberto = await quem.e2e(`decryptFile(window.cifrado, { bucket: 'documents', path: 'emp-ana/holerite.pdf' })`);
            assert.equal(aberto.mime, 'application/pdf');
            assert.equal(texto(aberto.bytes), 'holerite de junho');
        }
        bia.page.window.cifrado = cifrado;
        await assert.rejects(bia.e2e(`decryptFile(window.cifrado, { bucket: 'documents', path: 'emp-ana/holerite.pdf' })`), /nenhuma das suas chaves/);
        ana.page.window.cifrado = cifrado;
        await assert.rejects(ana.e2e(`decryptFile(window.cifrado, { bucket: 'documents', path: 'emp-bia/holerite.pdf' })`), 'caminho diferente não abre');
    });

    test('sem destinatários válidos o arquivo não é cifrado (a tela decide o que fazer)', async () => {
        const mundo = novoMundo();
        const rh = await entrar(mundo, RH_USER, 'senha-rh-1', true);
        rh.page.window.plano = semPlano(rh.page);
        assert.equal(await rh.e2e(`encryptFile(window.plano, { bucket: 'documents', path: 'x', mime: 'application/pdf', employeeId: '${CAIO.id}' })`), null);
        assert.equal(await rh.e2e(`encryptFile(window.plano, { bucket: 'documents', path: 'x', mime: 'application/pdf', employeeId: null })`), null);
        assert.equal(await rh.e2e(`recipientsFor('${CAIO.id}')`), null);

        const semRh = novoMundo();
        const ana = await entrar(semRh, COLAB_USER, 'senha-da-ana-1');
        assert.equal(await ana.e2e(`recipientsFor('${ANA.id}')`), null, 'sem chave do RH ninguém cifra');
    });

    test('encryptFileFor cifra para a lista informada', async () => {
        const mundo = novoMundo();
        const rh = await entrar(mundo, RH_USER, 'senha-rh-1', true);
        await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        const destinos = await rh.e2e(`recipientsFor('${ANA.id}')`);
        rh.page.window.destinos = destinos;
        rh.page.window.plano = semPlano(rh.page);
        const cifrado = await rh.e2e(`encryptFileFor(window.plano, { bucket: 'documents', path: 'p', mime: 'application/pdf', recipients: window.destinos })`);
        rh.page.window.cifrado = cifrado;
        assert.deepEqual([...(await rh.e2e('fileRecipients(window.cifrado)'))].sort(), Array.from(destinos, (d) => d.fingerprint).sort());
    });

    test('sem chaves neste acesso não há como abrir', async () => {
        const mundo = novoMundo();
        const rh = await entrar(mundo, RH_USER, 'senha-rh-1', true);
        await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        rh.page.window.plano = semPlano(rh.page);
        const cifrado = await rh.e2e(`encryptFile(window.plano, { bucket: 'documents', path: 'p', mime: 'application/pdf', employeeId: '${ANA.id}' })`);
        const caio = await sessao(mundo, CAIO_USER);
        caio.page.window.cifrado = cifrado;
        await assert.rejects(caio.e2e(`decryptFile(window.cifrado, { bucket: 'documents', path: 'p' })`));
    });
});

describe('NexusE2E — mensagens de canal e DM', () => {
    async function time(mundo) {
        const rh = await entrar(mundo, RH_USER, 'senha-rh-1', true);
        const ana = await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        const bia = await entrar(mundo, MANAGER_USER, 'senha-da-bia-1');
        const caio = await entrar(mundo, CAIO_USER, 'senha-do-caio-1');
        return { rh, ana, bia, caio };
    }
    const enviar = (s, canal, txt, meuId, isDm = false) =>
        s.e2e(`encryptMessage(${JSON.stringify(txt)}, { channelId: '${canal}', myEmployeeId: '${meuId}', isDm: ${isDm} })`);
    const ler = (s, canal, conteudo, remetente) => s.e2e(`decryptMessage(${JSON.stringify(conteudo)}, { channelId: '${canal}', senderId: '${remetente}' })`);

    test('canal de grupo: membros e RH leem; quem não é membro não lê; a chave é reaproveitada', async () => {
        const mundo = novoMundo();
        const { rh, ana, bia, caio } = await time(mundo);
        mundo.membros.c1 = [ANA.id, BIA.id];

        assert.equal(await ana.e2e(`channelReady('c1', { isDm: false })`), true);
        const msg = await enviar(ana, 'c1', 'reunião às 15h', ANA.id);
        assert.equal(await ana.e2e(`isEncryptedMessage(${JSON.stringify(msg)})`), true);
        assert.doesNotMatch(msg, /reunião/);

        assert.equal(await ler(bia, 'c1', msg, ANA.id), 'reunião às 15h');
        assert.equal(await ler(rh, 'c1', msg, ANA.id), 'reunião às 15h', 'RH lê pela chave da organização');
        assert.equal(await ler(caio, 'c1', msg, ANA.id), null);
        await assert.rejects(ler(bia, 'c1', msg, BIA.id), 'remetente trocado não passa na autenticação');

        const antes = mundo.tables.e2e_channel_keys.length;
        assert.equal(antes, 3, 'Ana, Bia e a chave do RH');
        await enviar(bia, 'c1', 'ok', BIA.id);
        assert.equal(mundo.tables.e2e_channel_keys.length, antes, 'mesma versão, sem regravar');
    });

    test('membro novo recebe a chave atual e lê o histórico', async () => {
        const mundo = novoMundo();
        const { ana, caio } = await time(mundo);
        mundo.membros.c1 = [ANA.id, BIA.id];
        const antiga = await enviar(ana, 'c1', 'boas-vindas', ANA.id);

        mundo.membros.c1.push(CAIO.id);
        await enviar(ana, 'c1', 'segunda', ANA.id);
        const doCaio = mundo.tables.e2e_channel_keys.filter((k) => k.employee_id === CAIO.id);
        assert.deepEqual(
            doCaio.map((k) => k.key_version),
            [1]
        );
        assert.equal(await ler(caio, 'c1', antiga, ANA.id), 'boas-vindas');
    });

    test('quando alguém sai do canal a chave gira e quem saiu não lê as novas', async () => {
        const mundo = novoMundo();
        const { ana, bia } = await time(mundo);
        mundo.membros.c1 = [ANA.id, BIA.id, CAIO.id];
        const v1 = await enviar(ana, 'c1', 'antes', ANA.id);

        mundo.membros.c1 = [ANA.id, CAIO.id];
        const v2 = await enviar(ana, 'c1', 'depois', ANA.id);
        assert.match(v1, /^e2e:v1:1:/);
        assert.match(v2, /^e2e:v1:2:/);
        assert.equal(await ler(bia, 'c1', v1, ANA.id), 'antes');
        assert.equal(await ler(bia, 'c1', v2, ANA.id), null);
    });

    test('DM só cifra quando os dois têm chave, e o RH não lê DM', async () => {
        const mundo = novoMundo();
        const { rh, ana, bia } = await time(mundo);
        mundo.membros.dm1 = [ANA.id, BIA.id];
        const msg = await enviar(ana, 'dm1', 'particular', ANA.id, true);
        assert.equal(await ler(bia, 'dm1', msg, ANA.id), 'particular');
        assert.equal(await ler(rh, 'dm1', msg, ANA.id), null);
        assert.equal(mundo.tables.e2e_channel_keys.length, 2);

        const semChave = novoMundo();
        const ana2 = await entrar(semChave, COLAB_USER, 'senha-da-ana-1');
        semChave.membros.dm2 = [ANA.id, BIA.id];
        assert.equal(await enviar(ana2, 'dm2', 'x', ANA.id, true), null, 'Bia sem chave: não cifra');
        assert.equal(await ana2.e2e(`channelReady('dm2', { isDm: true })`), false);
    });

    test('quem não é membro, ou está bloqueado, não cifra', async () => {
        const mundo = novoMundo();
        const { caio } = await time(mundo);
        mundo.membros.c1 = [ANA.id, BIA.id];
        assert.equal(await enviar(caio, 'c1', 'x', CAIO.id), null);

        const bloqueada = await sessao(mundo, COLAB_USER);
        bloqueada.page.window.NexusE2EUI.promptPassword = async () => false;
        assert.equal(await enviar(bloqueada, 'c1', 'x', ANA.id), null);
        assert.equal(await ler(bloqueada, 'c1', 'e2e:v1:1:a:b', ANA.id), null);
    });

    test('grupo sem chave do RH não cifra; conteúdo sem versão não é lido', async () => {
        const mundo = novoMundo();
        const ana = await entrar(mundo, COLAB_USER, 'senha-da-ana-1');
        await entrar(mundo, MANAGER_USER, 'senha-da-bia-1');
        mundo.membros.c1 = [ANA.id, BIA.id];
        assert.equal(await enviar(ana, 'c1', 'x', ANA.id), null);
        assert.equal(await ler(ana, 'c1', 'e2e:v1:abc:x:y', ANA.id), null);
    });

    test('dois membros criam a chave do canal ao mesmo tempo: quem perde a corrida usa a chave de quem ganhou', async () => {
        const mundo = novoMundo();
        const { bia } = await time(mundo);
        mundo.membros.c1 = [ANA.id, BIA.id];
        await enviar(bia, 'c1', 'primeira', BIA.id);

        let leituras = 0;
        const ana = await sessao(mundo, COLAB_USER, {
            'e2e_channel_keys:select': () => (leituras++ === 0 ? { message: 'lido antes de a Bia gravar' } : null),
            'e2e_channel_keys:insert': { message: 'duplicate key value violates unique constraint' },
        });
        ana.page.window.NexusE2EUI.promptPassword = async (tentar) => tentar('senha-da-ana-1');
        const msg = await enviar(ana, 'c1', 'resposta', ANA.id);
        assert.match(msg, /^e2e:v1:1:/);
        assert.equal(await ler(bia, 'c1', msg, ANA.id), 'resposta');
    });

    test('falha ao gravar a chave nova do canal: não envia com chave que ninguém mais tem', async () => {
        const mundo = novoMundo();
        await time(mundo);
        mundo.membros.c1 = [ANA.id, BIA.id];
        const ana = await sessao(mundo, COLAB_USER, { 'e2e_channel_keys:insert': { message: 'duplicate key' } });
        ana.page.window.NexusE2EUI.promptPassword = async (tentar) => tentar('senha-da-ana-1');
        assert.equal(await enviar(ana, 'c1', 'x', ANA.id), null);
        assert.equal(mundo.tables.e2e_channel_keys.length, 0);
    });
});
