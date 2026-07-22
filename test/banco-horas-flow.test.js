const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('../test-support/mock-supabase');

global.window = global;
global.document = { addEventListener: () => {} };

require('../src/javascript/domain/clt-domain.js');
const rh = require('../src/javascript/banco-horas-rh.js');

const TABLES = {
    employees: [
        {
            id: 'e1',
            name: 'Carla Vencido',
            dept: 'RH',
            role: 'Analista',
            status: 'Ativo',
            admission_date: '2018-01-01',
            contract_type: 'clt',
            work_load: '40h',
            salary: 4000,
            manager_id: null,
        },
        {
            id: 'e2',
            name: 'Bruno Extras',
            dept: 'TI',
            role: 'Dev',
            status: 'Ativo',
            admission_date: '2021-03-01',
            contract_type: 'clt',
            work_load: '40h',
            salary: 6000,
            manager_id: null,
        },
        {
            id: 'e3',
            name: 'Consultor PJ',
            dept: 'Consultoria',
            role: 'Consultor',
            status: 'Ativo',
            admission_date: '2022-01-01',
            contract_type: 'pj',
            work_load: '',
            salary: 8000,
            manager_id: null,
        },
        {
            id: 'e4',
            name: 'Ex Funcionario',
            dept: 'TI',
            role: 'Dev',
            status: 'Inativo',
            admission_date: '2019-01-01',
            contract_type: 'clt',
            work_load: '40h',
            salary: 5000,
            manager_id: null,
        },
    ],
    time_records: [
        {
            employee_id: 'e2',
            date: '2026-06-01',
            entrada: '2026-06-01T08:00:00',
            saida_almoco: '2026-06-01T12:00:00',
            retorno_almoco: '2026-06-01T13:00:00',
            saida: '2026-06-01T18:00:00',
        },
        { employee_id: 'e2', date: '2026-06-02', entrada: '2026-06-02T08:00:00', saida: '2026-06-02T11:00:00' },
    ],
    bank_adjustments: [
        { employee_id: 'e1', tipo: 'credito', minutos: 100, date: '2015-06-10', deleted_at: null },
        { employee_id: 'e1', tipo: 'credito', minutos: 9999, date: '2010-01-01', deleted_at: '2010-02-01' },
        { employee_id: 'e2', tipo: 'debito', minutos: 20, date: '2026-06-15', deleted_at: null },
    ],
    holidays: [{ date: '2026-06-07', name: 'Corpus Christi' }],
    vacations: [
        { employee_id: 'e2', start_date: '2026-06-20', end_date: '2026-06-25', status: 'aprovado' },
        { employee_id: 'e2', start_date: '2026-01-01', end_date: '2026-01-05', status: 'pendente' },
    ],
    hr_settings: [{ id: 1, banco_horas_vencimento_meses: 6, limite_extra_diario_min: 120 }],
};

before(async () => {
    global.sb = createMockSupabase(TABLES);
    rh.__setCurrentMonthForTest('2026-06');
    await rh.loadStaticComplianceData();
    await rh.loadAllData();
    await rh.loadBankLedger();
});

describe('loadStaticComplianceData', () => {
    test('carrega feriados por data', () => {
        const { holidaysMap } = rh.__getStateForTest();
        assert.ok(holidaysMap['2026-06-07']);
        assert.equal(holidaysMap['2026-06-07'].name, 'Corpus Christi');
    });

    test('só considera férias aprovadas/concluídas (ignora pendente)', () => {
        const { vacationsByEmp } = rh.__getStateForTest();
        assert.equal(vacationsByEmp['e2'].length, 1);
        assert.equal(vacationsByEmp['e2'][0].status, 'aprovado');
    });

    test('carrega configurações de RH (vencimento do banco de horas, limite de extra diário)', () => {
        const { hrSettings } = rh.__getStateForTest();
        assert.equal(hrSettings.banco_horas_vencimento_meses, 6);
        assert.equal(hrSettings.limite_extra_diario_min, 120);
    });
});

describe('loadAllData', () => {
    test('só traz colaboradores Ativos (exclui desligados)', () => {
        const { allEmps } = rh.__getStateForTest();
        assert.equal(allEmps.length, 3);
        assert.ok(!allEmps.some((e) => e.id === 'e4'));
    });

    test('agrupa registros de ponto do mês por colaborador e data', () => {
        const { timeRecordsMap } = rh.__getStateForTest();
        assert.ok(timeRecordsMap['e2']['2026-06-01']);
        assert.ok(timeRecordsMap['e2']['2026-06-02']);
    });
});

describe('loadBankLedger + buildAllBalances (integração ponta a ponta com Supabase mockado)', () => {
    test('crédito antigo sem consumo/débito posterior fica "vencido"', () => {
        const balance = rh.buildAllBalances('2026-06').find((b) => b.emp.id === 'e1');
        assert.equal(balance.ledger.status, 'vencido');
        assert.equal(balance.ledger.minutosVencidos, 100);
    });

    test('ajuste soft-deleted não entra na conta do banco de horas', () => {
        const balance = rh.buildAllBalances('2026-06').find((b) => b.emp.id === 'e1');
        assert.equal(balance.ledger.minutosVencidos, 100);
    });

    test('calcula extras, faltas e ajuste líquido do mês a partir dos registros de ponto', () => {
        const balance = rh.buildAllBalances('2026-06').find((b) => b.emp.id === 'e2');
        assert.equal(balance.extrasMin, 60);
        assert.equal(balance.faltaMin, 300);
        assert.equal(balance.ajusteMin, -20);
        assert.equal(balance.saldoLiquido, 60 - 300 - 20);
        assert.equal(balance.diasCompletos, 2);
    });

    test('déficit de intervalo intrajornada é contado no dia sem registro de almoço', () => {
        const balance = rh.buildAllBalances('2026-06').find((b) => b.emp.id === 'e2');
        assert.equal(balance.diasIntervaloIrregular, 1);
        assert.equal(balance.intervaloDeficitMin, 60);
    });

    test('PJ não tem jornada, saldo nem ledger (fora do escopo de banco de horas)', () => {
        const balance = rh.buildAllBalances('2026-06').find((b) => b.emp.id === 'e3');
        assert.equal(balance.isPJ, true);
        assert.equal(balance.saldoLiquido, null);
        assert.equal(balance.ledger, null);
    });
});
