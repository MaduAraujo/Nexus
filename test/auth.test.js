const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('../test-support/mock-supabase');

global.window = global;
global.window.location = { href: '' };

require('../src/javascript/shared/mfa.js');
const NexusAuth = require('../src/javascript/shared/auth.js');

beforeEach(() => {
    global.window.location.href = '';
});

describe('requireProfile', () => {
    test('sem sessão ativa, redireciona pro login e não retorna dados', async () => {
        global.sb = createMockSupabase({}, { user: null });
        const result = await NexusAuth.requireProfile('Administrador');
        assert.equal(result, null);
        assert.equal(global.window.location.href, '../screens/login.html');
    });

    test('perfil do usuário diferente do exigido, redireciona pro login', async () => {
        global.sb = createMockSupabase({ profiles: [{ id: 'u1', profile: 'colaborador', employee_id: 'e1' }] }, { user: { id: 'u1' } });
        const result = await NexusAuth.requireProfile('Administrador');
        assert.equal(result, null);
        assert.equal(global.window.location.href, '../screens/login.html');
    });

    test('perfil correto sem exigir dados de colaborador, retorna user+profile e não redireciona', async () => {
        global.sb = createMockSupabase({ profiles: [{ id: 'u1', profile: 'Administrador', employee_id: null }] }, { user: { id: 'u1' } });
        const result = await NexusAuth.requireProfile('Administrador');
        assert.equal(global.window.location.href, '');
        assert.equal(result.user.id, 'u1');
        assert.equal(result.profile.profile, 'Administrador');
        assert.equal(result.employee, null);
    });

    test('perfil correto mas colaborador sem employee_id vinculado, redireciona ao pedir dados de colaborador', async () => {
        global.sb = createMockSupabase({ profiles: [{ id: 'u2', profile: 'colaborador', employee_id: null }] }, { user: { id: 'u2' } });
        const result = await NexusAuth.requireProfile('colaborador', '*');
        assert.equal(result, null);
        assert.equal(global.window.location.href, '../screens/login.html');
    });

    test('employee_id aponta pra um funcionário que não existe (ex.: desligado), redireciona', async () => {
        global.sb = createMockSupabase(
            { profiles: [{ id: 'u3', profile: 'colaborador', employee_id: 'ghost' }], employees_decrypted: [] },
            { user: { id: 'u3' } }
        );
        const result = await NexusAuth.requireProfile('colaborador', 'name,dept');
        assert.equal(result, null);
        assert.equal(global.window.location.href, '../screens/login.html');
    });

    test('perfil correto + colaborador com employee_id válido, retorna user+profile+employee', async () => {
        global.sb = createMockSupabase(
            {
                profiles: [{ id: 'u4', profile: 'colaborador', employee_id: 'e4' }],
                employees_decrypted: [{ id: 'e4', name: 'Ana Souza', dept: 'TI' }],
            },
            { user: { id: 'u4' } }
        );
        const result = await NexusAuth.requireProfile('colaborador', 'name,dept');
        assert.equal(global.window.location.href, '');
        assert.equal(result.employee.name, 'Ana Souza');
        assert.equal(result.employee.dept, 'TI');
    });
});

describe('requireProfile e o segundo fator', () => {
    const admin = { profiles: [{ id: 'a1', profile: 'Administrador', employee_id: null }] };
    const colab = { profiles: [{ id: 'c1', profile: 'colaborador', employee_id: null }] };
    const comFator = { currentLevel: 'aal1', nextLevel: 'aal2' };
    const semFator = { currentLevel: 'aal1', nextLevel: 'aal1' };

    test('fator ativo mas código não digitado (aal1 → aal2): volta ao login e não retorna dados', async () => {
        global.sb = createMockSupabase(admin, { user: { id: 'a1' }, mfaLevel: comFator });
        assert.equal(await NexusAuth.requireProfile('Administrador'), null);
        assert.equal(global.window.location.href, '../screens/login.html');
    });

    test('vale para colaborador que optou pelo MFA', async () => {
        global.sb = createMockSupabase(colab, { user: { id: 'c1' }, mfaLevel: comFator });
        assert.equal(await NexusAuth.requireProfile('colaborador'), null);
        assert.equal(global.window.location.href, '../screens/login.html');
    });

    test('Administrador sem nenhum fator é levado à tela de ativação', async () => {
        global.sb = createMockSupabase(admin, { user: { id: 'a1' }, mfaLevel: semFator });
        assert.equal(await NexusAuth.requireProfile('Administrador'), null);
        assert.equal(global.window.location.href, '../screens/seguranca.html');
    });

    test('a própria tela de ativação pode abrir sem fator (allowMfaSetup)', async () => {
        global.sb = createMockSupabase(admin, { user: { id: 'a1' }, mfaLevel: semFator });
        const result = await NexusAuth.requireProfile('Administrador', undefined, { allowMfaSetup: true });
        assert.equal(result.user.id, 'a1');
        assert.equal(global.window.location.href, '');
    });

    test('allowMfaSetup não dispensa o código de quem já tem fator', async () => {
        global.sb = createMockSupabase(admin, { user: { id: 'a1' }, mfaLevel: comFator });
        assert.equal(await NexusAuth.requireProfile('Administrador', undefined, { allowMfaSetup: true }), null);
        assert.equal(global.window.location.href, '../screens/login.html');
    });

    test('colaborador sem fator entra normalmente (MFA opcional)', async () => {
        global.sb = createMockSupabase(colab, { user: { id: 'c1' }, mfaLevel: semFator });
        const result = await NexusAuth.requireProfile('colaborador');
        assert.equal(result.user.id, 'c1');
        assert.equal(global.window.location.href, '');
    });

    test('falha ao consultar o nível de segurança nega o acesso', async () => {
        global.sb = createMockSupabase(admin, { user: { id: 'a1' }, mfaError: { message: 'boom' } });
        assert.equal(await NexusAuth.requireProfile('Administrador'), null);
        assert.equal(global.window.location.href, '../screens/login.html');
    });
});

describe('getUser', () => {
    test('retorna null quando não há usuário autenticado', async () => {
        global.sb = createMockSupabase({}, { user: null });
        assert.equal(await NexusAuth.getUser(), null);
    });

    test('retorna o usuário quando autenticado', async () => {
        global.sb = createMockSupabase({}, { user: { id: 'u9', email: 'ana@nexus.com' } });
        const user = await NexusAuth.getUser();
        assert.equal(user.id, 'u9');
    });
});

describe('registro de acessos e exportações', () => {
    const inserts = [];
    const sbCom = ({ user = { id: 'u1', email: 'rh@nexus.com' }, falhaInsert = false, rpc } = {}) => ({
        auth: { getUser: async () => ({ data: { user }, error: null }) },
        from: () => ({
            insert: async (row) => {
                if (falhaInsert) throw new Error('rede');
                inserts.push(row);
                return { error: null };
            },
        }),
        ...(rpc ? { rpc } : {}),
    });

    beforeEach(() => inserts.splice(0));

    test('acesso a dado pessoal grava quem acessou; sem colaborador não grava nada', async () => {
        global.sb = sbCom();
        await NexusAuth.logAccess(null, 'holerite', 'x');
        assert.equal(inserts.length, 0);
        await NexusAuth.logAccess('e1', 'holerite', '07/2026');
        assert.deepEqual(inserts[0], { employee_id: 'e1', tipo: 'holerite', detalhe: '07/2026', accessed_by_name: 'rh', accessed_by_email: 'rh@nexus.com' });
    });

    test('sem detalhe e sem e-mail do usuário grava nulos em vez de "undefined"', async () => {
        global.sb = sbCom({ user: { id: 'u1' } });
        await NexusAuth.logAccess('e1', 'documento');
        assert.deepEqual(inserts[0], { employee_id: 'e1', tipo: 'documento', detalhe: null, accessed_by_name: null, accessed_by_email: null });
        global.sb = sbCom({ user: null });
        await NexusAuth.logAccess('e2', 'documento', '');
        assert.equal(inserts[1].accessed_by_email, null);
    });

    test('falha ao gravar o registro não interrompe quem estava abrindo o dado', async () => {
        global.sb = sbCom({ falhaInsert: true });
        await assert.doesNotReject(NexusAuth.logAccess('e1', 'holerite', 'x'));
    });

    test('exportação é registrada com a quantidade de linhas; valor inválido vira zero; cliente sem RPC é ignorado', async () => {
        const chamadas = [];
        global.sb = sbCom({ rpc: async (nome, args) => (chamadas.push([nome, args]), { error: null }) });
        NexusAuth.logExport('folha', 12);
        NexusAuth.logExport('ferias', 'muitas');
        assert.deepEqual(chamadas, [
            ['report_data_export', { p_source: 'folha', p_rows: 12 }],
            ['report_data_export', { p_source: 'ferias', p_rows: 0 }],
        ]);
        global.sb = sbCom();
        assert.doesNotThrow(() => NexusAuth.logExport('folha', 1));
    });

    test('registro de sessão do RH segue mesmo com o armazenamento da aba bloqueado', async () => {
        const chamadas = [];
        global.sb = createMockSupabase({ profiles: [{ id: 'rh1', profile: 'Administrador' }] }, { user: { id: 'rh1', email: 'rh@nexus.com' } });
        global.sb.rpc = async (nome, args) => (chamadas.push([nome, args]), { error: null });
        const original = Object.getOwnPropertyDescriptor(global, 'sessionStorage');
        Object.defineProperty(global, 'sessionStorage', {
            configurable: true,
            get() {
                throw new Error('bloqueado');
            },
        });
        try {
            const r = await NexusAuth.requireProfile('Administrador');
            assert.ok(r);
            assert.deepEqual(chamadas.at(-1), ['record_access', { p_kind: 'session' }]);
        } finally {
            if (original) Object.defineProperty(global, 'sessionStorage', original);
            else delete global.sessionStorage;
        }
    });
});

describe('registro de sessão do RH a cada 30 minutos', () => {
    test('com registro recente não chama de novo; sem registro, registra e guarda a hora', async () => {
        const guardado = new Map();
        const original = Object.getOwnPropertyDescriptor(global, 'sessionStorage');
        Object.defineProperty(global, 'sessionStorage', {
            configurable: true,
            value: { getItem: (k) => guardado.get(k) ?? null, setItem: (k, v) => guardado.set(k, v) },
        });
        const chamadas = [];
        const montar = () => {
            global.sb = createMockSupabase({ profiles: [{ id: 'rh2', profile: 'Administrador' }] }, { user: { id: 'rh2', email: 'rh@nexus.com' } });
            global.sb.rpc = async (nome) => (chamadas.push(nome), { error: null });
        };
        try {
            montar();
            await NexusAuth.requireProfile('Administrador');
            assert.deepEqual(chamadas, ['record_access']);
            assert.ok(Number(guardado.get('nexus:sec-ping:rh2')) > 0);
            montar();
            await NexusAuth.requireProfile('Administrador');
            assert.deepEqual(chamadas, ['record_access'], 'dentro de 30 minutos não registra de novo');
        } finally {
            if (original) Object.defineProperty(global, 'sessionStorage', original);
            else delete global.sessionStorage;
        }
    });
});
