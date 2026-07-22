const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('../test-support/mock-supabase');

global.window = global;
global.window.location = { href: '' };

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
        global.sb = createMockSupabase({ profiles: [{ id: 'u3', profile: 'colaborador', employee_id: 'ghost' }], employees: [] }, { user: { id: 'u3' } });
        const result = await NexusAuth.requireProfile('colaborador', 'name,dept');
        assert.equal(result, null);
        assert.equal(global.window.location.href, '../screens/login.html');
    });

    test('perfil correto + colaborador com employee_id válido, retorna user+profile+employee', async () => {
        global.sb = createMockSupabase(
            {
                profiles: [{ id: 'u4', profile: 'colaborador', employee_id: 'e4' }],
                employees: [{ id: 'e4', name: 'Ana Souza', dept: 'TI' }],
            },
            { user: { id: 'u4' } }
        );
        const result = await NexusAuth.requireProfile('colaborador', 'name,dept');
        assert.equal(global.window.location.href, '');
        assert.equal(result.employee.name, 'Ana Souza');
        assert.equal(result.employee.dept, 'TI');
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