const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('../test-support/mock-supabase');

global.window = global;
global.window.location = { href: '' };

require('../src/javascript/shared/mfa.js');
const NexusAuth = require('../src/javascript/shared/auth.js');
const { ruleSummary, formatWhen } = require('../src/javascript/seguranca.js');

let rpcCalls;
let storage;

function clientWith(tables, user) {
    const client = createMockSupabase(tables, { user });
    client.rpc = (name, args) => {
        rpcCalls.push({ name, args });
        return Promise.resolve({ data: null, error: null });
    };
    return client;
}

beforeEach(() => {
    rpcCalls = [];
    storage = new Map();
    global.sessionStorage = {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(k, String(v)),
    };
});

describe('sinal de sessão para o alerta de acesso fora do horário', () => {
    test('RH que abre uma tela avisa o servidor uma vez, não a cada tela', async () => {
        global.sb = clientWith({ profiles: [{ id: 'u1', profile: 'Administrador', employee_id: null }] }, { id: 'u1' });
        await NexusAuth.requireProfile('Administrador');
        await NexusAuth.requireProfile('Administrador');
        assert.deepEqual(rpcCalls, [{ name: 'record_access', args: { p_kind: 'session' } }]);
    });

    test('depois de 30 minutos avisa de novo', async () => {
        global.sb = clientWith({ profiles: [{ id: 'u1', profile: 'Administrador', employee_id: null }] }, { id: 'u1' });
        await NexusAuth.requireProfile('Administrador');
        storage.set('nexus:sec-ping:u1', String(Date.now() - 31 * 60 * 1000));
        await NexusAuth.requireProfile('Administrador');
        assert.equal(rpcCalls.length, 2);
    });

    test('colaborador não dispara o sinal', async () => {
        global.sb = clientWith({ profiles: [{ id: 'u2', profile: 'colaborador', employee_id: null }] }, { id: 'u2' });
        await NexusAuth.requireProfile('colaborador');
        assert.equal(rpcCalls.length, 0);
    });

    test('falha na chamada não atrapalha a tela', async () => {
        global.sb = clientWith({ profiles: [{ id: 'u1', profile: 'Administrador', employee_id: null }] }, { id: 'u1' });
        global.sb.rpc = () => Promise.reject(new Error('rede'));
        const result = await NexusAuth.requireProfile('Administrador');
        assert.equal(result.user.id, 'u1');
    });

    test('sem rpc no cliente (mock simples) a tela abre normalmente', async () => {
        global.sb = createMockSupabase({ profiles: [{ id: 'u1', profile: 'Administrador', employee_id: null }] }, { user: { id: 'u1' } });
        const result = await NexusAuth.requireProfile('Administrador');
        assert.equal(result.user.id, 'u1');
    });
});

describe('registro de exportações', () => {
    test('envia a origem e a quantidade de registros', () => {
        global.sb = clientWith({}, { id: 'u1' });
        NexusAuth.logExport('colaboradores.xlsx', 42);
        assert.deepEqual(rpcCalls, [{ name: 'report_data_export', args: { p_source: 'colaboradores.xlsx', p_rows: 42 } }]);
    });

    test('quantidade inválida vira 0 e erro de rede não estoura', async () => {
        global.sb = clientWith({}, { id: 'u1' });
        global.sb.rpc = () => Promise.reject(new Error('rede'));
        assert.doesNotThrow(() => NexusAuth.logExport('ferias.csv', undefined));
        await new Promise((resolve) => setImmediate(resolve));
    });
});

describe('tela Segurança: texto das regras', () => {
    test('resume cada regra com os limites vindos do banco', () => {
        assert.equal(ruleSummary({ kind: 'login_failures', threshold: 5, window_minutes: 15 }), '5 falhas em 15 min na mesma conta');
        assert.equal(ruleSummary({ kind: 'mass_export', threshold: 5, threshold_rows: 500, window_minutes: 60 }), '5 exportações ou 500 registros em 60 min');
        assert.equal(ruleSummary({ kind: 'mass_download', threshold: 30, window_minutes: 10 }), '30 arquivos baixados em 10 min');
        assert.equal(
            ruleSummary({ kind: 'off_hours_access', params: { start_hour: 8, end_hour: 18, weekdays_only: true, profiles: ['Administrador'] } }),
            'fora de 8h–18h, dias úteis (Administrador)'
        );
    });

    test('formatWhen usa tempo relativo na primeira hora e ignora datas inválidas', () => {
        const now = new Date('2026-09-20T12:00:00Z');
        assert.equal(formatWhen('2026-09-20T11:58:00Z', now), 'há 2 min');
        assert.equal(formatWhen('2026-09-20T11:59:50Z', now), 'agora há pouco');
        assert.equal(formatWhen('lixo', now), '');
    });
});
