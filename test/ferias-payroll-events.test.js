const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let ferias;

function fakeEl() {
    return {
        textContent: '',
        innerHTML: '',
        dataset: {},
        appendChild() {},
        remove() {},
        classList: { add() {}, remove() {}, toggle: () => false, contains: () => false },
    };
}

before(() => {
    global.window = global;
    global.document = {
        addEventListener: () => {},
        querySelectorAll: () => [],
        querySelector: () => null,
        getElementById: () => fakeEl(),
        createElement: () => fakeEl(),
    };
    global.location = { search: '' };
    global.requestAnimationFrame = (cb) => cb();
    global.setTimeout = (cb) => cb();
    global.dargs = (...values) => JSON.stringify(values);
    require('../src/javascript/domain/eventos-folha.js');
    ferias = require('../src/javascript/ferias.js');
});

function emp(overrides = {}) {
    return { id: 'e1', name: 'Ana Fixture', contractType: 'clt', salary: 3000, ...overrides };
}

beforeEach(() => {
    ferias.__setStateForTest({ employees: [emp()], vacations: [] });
});

describe('gerarEventoAdiantamentoFerias', () => {
    test('chama apply_ferias_payroll_event com o mês/competência derivados da data de início e os proventos calculados', async () => {
        const calls = [];
        global.sb = { rpc: async (name, params) => (calls.push({ name, params }), { error: null }) };

        await ferias.gerarEventoAdiantamentoFerias({ employeeId: 'e1', startDate: '2026-07-10', days: 20, abono: false });

        assert.equal(calls.length, 1);
        assert.equal(calls[0].name, 'apply_ferias_payroll_event');
        assert.equal(calls[0].params.p_employee_id, 'e1');
        assert.equal(calls[0].params.p_mes, '2026-07');
        assert.equal(calls[0].params.p_mes_formatado, 'Julho 2026');
        assert.equal(calls[0].params.p_competencia, '07/2026');
        assert.deepEqual(
            calls[0].params.p_novos_proventos.map((p) => p.cod),
            ['040', '041']
        );
    });

    test('com abono pecuniário, inclui os proventos 042/043 também', async () => {
        const calls = [];
        global.sb = { rpc: async (name, params) => (calls.push({ name, params }), { error: null }) };

        await ferias.gerarEventoAdiantamentoFerias({ employeeId: 'e1', startDate: '2026-07-10', days: 20, abono: true });

        assert.deepEqual(
            calls[0].params.p_novos_proventos.map((p) => p.cod),
            ['040', '041', '042', '043']
        );
    });

    test('PJ não gera evento (não tem direito a férias remuneradas neste sistema)', async () => {
        ferias.__setStateForTest({ employees: [emp({ contractType: 'pj' })] });
        let called = false;
        global.sb = { rpc: async () => ((called = true), { error: null }) };

        await ferias.gerarEventoAdiantamentoFerias({ employeeId: 'e1', startDate: '2026-07-10', days: 20, abono: false });
        assert.equal(called, false);
    });

    test('colaborador sem salário cadastrado não gera evento (não quebra)', async () => {
        ferias.__setStateForTest({ employees: [emp({ salary: null })] });
        let called = false;
        global.sb = { rpc: async () => ((called = true), { error: null }) };

        await ferias.gerarEventoAdiantamentoFerias({ employeeId: 'e1', startDate: '2026-07-10', days: 20, abono: false });
        assert.equal(called, false);
    });

    test('colaborador desconhecido (removido, id inválido) não quebra', async () => {
        let called = false;
        global.sb = { rpc: async () => ((called = true), { error: null }) };
        await ferias.gerarEventoAdiantamentoFerias({ employeeId: 'nao-existe', startDate: '2026-07-10', days: 20, abono: false });
        assert.equal(called, false);
    });
});

describe('reverterEventoAdiantamentoFerias', () => {
    test('chama revert_ferias_payroll_event com o employee_id e o mês derivado da data de início', async () => {
        const calls = [];
        global.sb = { rpc: async (name, params) => (calls.push({ name, params }), { error: null }) };

        await ferias.reverterEventoAdiantamentoFerias({ employeeId: 'e1', startDate: '2026-07-10' });

        assert.deepEqual(calls, [{ name: 'revert_ferias_payroll_event', params: { p_employee_id: 'e1', p_mes: '2026-07' } }]);
    });
});

describe('cancelApprovedVacation', () => {
    beforeEach(() => {
        global.confirm = () => true;
    });

    test('cancela a solicitação e reverte o evento de folha do mês certo', async () => {
        const dbCalls = [];
        ferias.__setStateForTest({
            employees: [emp()],
            vacations: [{ id: 'v1', employeeId: 'e1', startDate: '2026-07-10', status: 'aprovado' }],
        });
        global.sb = {
            from(table) {
                return {
                    update(patch) {
                        dbCalls.push({ table, patch });
                        return { eq: () => Promise.resolve({ error: null }) };
                    },
                };
            },
            rpc: async (name, params) => (dbCalls.push({ rpc: name, params }), { error: null }),
        };

        await ferias.cancelApprovedVacation('v1');

        const { vacations } = ferias.__getStateForTest();
        assert.equal(vacations[0].status, 'cancelado');
        assert.deepEqual(dbCalls[0], { table: 'vacations', patch: { status: 'cancelado' } });
        assert.deepEqual(dbCalls[1], { rpc: 'revert_ferias_payroll_event', params: { p_employee_id: 'e1', p_mes: '2026-07' } });
    });

    test('sem confirmação do usuário, não faz nada', async () => {
        global.confirm = () => false;
        let touched = false;
        ferias.__setStateForTest({
            employees: [emp()],
            vacations: [{ id: 'v1', employeeId: 'e1', startDate: '2026-07-10', status: 'aprovado' }],
        });
        global.sb = {
            from() {
                touched = true;
                return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
            },
            rpc: async () => ((touched = true), { error: null }),
        };

        await ferias.cancelApprovedVacation('v1');
        assert.equal(touched, false);
        assert.equal(ferias.__getStateForTest().vacations[0].status, 'aprovado');
    });

    test('id de solicitação que não existe não quebra', async () => {
        ferias.__setStateForTest({ employees: [emp()], vacations: [] });
        await ferias.cancelApprovedVacation('nao-existe');
    });
});
