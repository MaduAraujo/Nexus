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
