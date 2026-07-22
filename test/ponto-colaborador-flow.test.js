const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('../test-support/mock-supabase');

global.window = global;
global.document = { addEventListener: () => {} };

require('../src/javascript/domain/clt-domain.js');
const ponto = require('../src/javascript/ponto-colaborador.js');

describe('loadData — colaborador comum (não gestor)', () => {
    before(async () => {
        global.sb = createMockSupabase({
            time_records: [
                { employee_id: 'c1', date: '2026-06-01', entrada: '2026-06-01T08:00:00', saida: '2026-06-01T17:00:00' },
                { employee_id: 'c2', date: '2026-06-01', entrada: '2026-06-01T08:00:00', saida: '2026-06-01T17:00:00' },
            ],
            adjustment_requests: [{ employee_id: 'c1', date: '2026-06-02', tipo: 'entrada', status: 'pendente', created_at: '2026-06-02T10:00:00' }],
            bank_requests: [
                { employee_id: 'c1', manager_id_snapshot: 'boss1', status: 'pendente', tipo: 'credito', minutos: 60, created_at: '2026-06-01T09:00:00' },
            ],
            holidays: [
                { date: '2026-06-07', name: 'Corpus Christi' },
                { date: '2026-06-15', name: 'Outro feriado' },
            ],
            hr_settings: [{ id: 1, limite_extra_diario_min: 90 }],
        });
        ponto.__setStateForTest({ myEmployeeId: 'c1', myEmployee: { contract_type: 'clt', work_load: '40h' }, isManager: false });
        await ponto.loadData();
    });

    test('só traz os próprios registros de ponto, nunca os de outro colaborador', () => {
        const { recordsMap } = ponto.__getStateForTest();
        assert.ok(recordsMap['2026-06-01']);
        assert.equal(Object.keys(recordsMap).length, 1);
    });

    test('carrega solicitações de ajuste e de banco de horas do próprio colaborador', () => {
        const { adjRequests, bankRequests } = ponto.__getStateForTest();
        assert.equal(adjRequests.length, 1);
        assert.equal(bankRequests.length, 1);
    });

    test('carrega feriados e configuração de limite de extra diário', () => {
        const { holidaysMap, limiteExtraDiarioMin } = ponto.__getStateForTest();
        assert.equal(Object.keys(holidaysMap).length, 2);
        assert.equal(limiteExtraDiarioMin, 90);
    });

    test('colaborador comum não recebe fila de aprovações de equipe', () => {
        const { teamRequests } = ponto.__getStateForTest();
        assert.deepEqual(teamRequests, []);
    });
});

describe('loadData — gestor (recebe fila de aprovação da equipe)', () => {
    before(async () => {
        global.sb = createMockSupabase({
            time_records: [],
            adjustment_requests: [],
            bank_requests: [
                {
                    employee_id: 'sub1',
                    manager_id_snapshot: 'm1',
                    status: 'pendente',
                    tipo: 'credito',
                    minutos: 30,
                    created_at: '2026-06-03T09:00:00',
                    employees: { name: 'Zeca', dept: 'TI' },
                },
                {
                    employee_id: 'sub2',
                    manager_id_snapshot: 'm1',
                    status: 'aprovado',
                    tipo: 'credito',
                    minutos: 30,
                    created_at: '2026-06-01T09:00:00',
                    employees: { name: 'Léo', dept: 'TI' },
                },
            ],
            holidays: [],
            hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
        });
        ponto.__setStateForTest({ myEmployeeId: 'm1', myEmployee: { contract_type: 'clt', work_load: '40h' }, isManager: true });
        await ponto.loadData();
    });

    test('gestor recebe só as solicitações pendentes da equipe (não as já decididas)', () => {
        const { teamRequests } = ponto.__getStateForTest();
        assert.equal(teamRequests.length, 1);
        assert.equal(teamRequests[0].employees.name, 'Zeca');
    });
});
