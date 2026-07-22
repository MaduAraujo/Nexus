const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

const { CLTDomain } = require('../src/javascript/domain/clt-domain.js');

describe('resolveJornadaMin', () => {
    test('PJ não tem jornada (retorna null)', () => {
        assert.equal(CLTDomain.resolveJornadaMin({ contractType: 'pj', workLoad: '40h' }), null);
    });

    test('estágio/aprendiz usam jornada reduzida de 6h/dia', () => {
        assert.equal(CLTDomain.resolveJornadaMin({ contractType: 'estagio', workLoad: '40h' }), 6 * 60);
        assert.equal(CLTDomain.resolveJornadaMin({ contractType: 'aprendiz', workLoad: '40h' }), 6 * 60);
    });

    test('escala 12x36 usa jornada de 12h/dia', () => {
        assert.equal(CLTDomain.resolveJornadaMin({ contractType: 'clt', workLoad: '12x36' }), 12 * 60);
    });

    test('deriva a jornada diária a partir da carga semanal (ex: 40h/semana → 8h/dia)', () => {
        assert.equal(CLTDomain.resolveJornadaMin({ contractType: 'clt', workLoad: '40h' }), 8 * 60);
        assert.equal(CLTDomain.resolveJornadaMin({ contractType: 'clt', workLoad: '44h' }), Math.round((44 / 5) * 60));
    });

    test('sem carga horária informada, assume 8h/dia', () => {
        assert.equal(CLTDomain.resolveJornadaMin({ contractType: 'clt', workLoad: '' }), 8 * 60);
    });
});

describe('getIntervaloMinObrigatorio', () => {
    test('sem jornada (PJ), não exige intervalo', () => {
        assert.equal(CLTDomain.getIntervaloMinObrigatorio(null), 0);
    });

    test('jornada > 6h exige 1h de intervalo', () => {
        assert.equal(CLTDomain.getIntervaloMinObrigatorio(8 * 60), 60);
    });

    test('jornada entre 4h e 6h exige 15min de intervalo', () => {
        assert.equal(CLTDomain.getIntervaloMinObrigatorio(5 * 60), 15);
    });

    test('jornada <= 4h não exige intervalo', () => {
        assert.equal(CLTDomain.getIntervaloMinObrigatorio(4 * 60), 0);
    });
});

describe('calcIntervaloDeficitMin', () => {
    test('sem registro de saída, não há déficit', () => {
        const rec = { entrada: '2026-01-05T08:00:00' };
        assert.equal(CLTDomain.calcIntervaloDeficitMin(rec, 8 * 60), 0);
    });

    test('intervalo cumprido integralmente não gera déficit', () => {
        const rec = {
            entrada: '2026-01-05T08:00:00',
            saida_almoco: '2026-01-05T12:00:00',
            retorno_almoco: '2026-01-05T13:00:00',
            saida: '2026-01-05T17:00:00',
        };
        assert.equal(CLTDomain.calcIntervaloDeficitMin(rec, 8 * 60), 0);
    });

    test('intervalo parcial gera déficit proporcional', () => {
        const rec = {
            entrada: '2026-01-05T08:00:00',
            saida_almoco: '2026-01-05T12:00:00',
            retorno_almoco: '2026-01-05T12:30:00',
            saida: '2026-01-05T17:00:00',
        };
        assert.equal(CLTDomain.calcIntervaloDeficitMin(rec, 8 * 60), 30);
    });
});

describe('calcWorkedMin / calcSaldoMin', () => {
    test('dia com almoço soma manhã + tarde', () => {
        const rec = {
            entrada: '2026-01-05T08:00:00',
            saida_almoco: '2026-01-05T12:00:00',
            retorno_almoco: '2026-01-05T13:00:00',
            saida: '2026-01-05T17:00:00',
        };
        assert.equal(CLTDomain.calcWorkedMin(rec), 8 * 60);
        assert.equal(CLTDomain.calcSaldoMin(rec, 8 * 60), 0);
    });

    test('dia sem almoço usa entrada/saída direto', () => {
        const rec = { entrada: '2026-01-05T08:00:00', saida: '2026-01-05T12:00:00' };
        assert.equal(CLTDomain.calcWorkedMin(rec), 4 * 60);
    });

    test('falta (sem entrada) não tem saldo calculável', () => {
        assert.equal(CLTDomain.calcSaldoMin({}, 8 * 60), null);
    });
});

describe('nightOverlapMin (adicional noturno, 22h-5h)', () => {
    test('turno inteiramente diurno não tem sobreposição noturna', () => {
        const start = new Date('2026-01-05T08:00:00');
        const end = new Date('2026-01-05T17:00:00');
        assert.equal(CLTDomain.nightOverlapMin(start, end), 0);
    });

    test('turno que cruza a meia-noite soma a sobreposição dos dois dias', () => {
        const start = new Date('2026-01-05T21:00:00');
        const end = new Date('2026-01-06T02:00:00');
        assert.equal(CLTDomain.nightOverlapMin(start, end), 4 * 60);
    });
});

describe('isSunday / weekStartKey', () => {
    test('identifica corretamente um domingo', () => {
        assert.equal(CLTDomain.isSunday('2026-01-04'), true);
        assert.equal(CLTDomain.isSunday('2026-01-05'), false);
    });

    test('semana começa na segunda-feira', () => {
        assert.equal(CLTDomain.weekStartKey('2026-01-07'), '2026-01-05');
        assert.equal(CLTDomain.weekStartKey('2026-01-04'), '2025-12-29');
    });
});

describe('computeBankLedgerStatus (consumo FIFO e vencimento do banco de horas)', () => {
    test('sem saldo credor acumulado, status ok e nada a vencer', () => {
        const r = CLTDomain.computeBankLedgerStatus({}, 6, new Date('2026-06-01'));
        assert.deepEqual(r, { status: 'ok', minutosVencendo: 0, minutosVencidos: 0, proxExpira: null });
    });

    test('saldo credor dentro do prazo não gera alerta', () => {
        const r = CLTDomain.computeBankLedgerStatus({ '2026-05': 120 }, 6, new Date('2026-06-01'));
        assert.equal(r.status, 'ok');
        assert.equal(r.minutosVencendo, 0);
        assert.equal(r.minutosVencidos, 0);
    });

    test('débito de um mês consome o crédito mais antigo primeiro (FIFO)', () => {
        const r = CLTDomain.computeBankLedgerStatus({ '2025-11': 100, '2025-12': 50, '2026-01': -80 }, 6, new Date('2026-04-15'));
        assert.equal(r.status, 'atencao');
        assert.equal(r.minutosVencendo, 20);
        assert.equal(r.minutosVencidos, 0);
    });

    test('crédito a até 30 dias do vencimento entra em status "atencao"', () => {
        const r = CLTDomain.computeBankLedgerStatus({ '2025-12': 60 }, 6, new Date('2026-05-12'));
        assert.equal(r.status, 'atencao');
        assert.equal(r.minutosVencendo, 60);
        assert.equal(r.minutosVencidos, 0);
        assert.deepEqual(r.proxExpira, new Date(2026, 5, 1));
    });

    test('crédito já além do prazo de compensação entra em status "vencido"', () => {
        const r = CLTDomain.computeBankLedgerStatus({ '2025-12': 60 }, 6, new Date('2026-07-01'));
        assert.equal(r.status, 'vencido');
        assert.equal(r.minutosVencendo, 0);
        assert.equal(r.minutosVencidos, 60);
    });

    test('mistura de buckets vencidos e a vencer: status reflete o pior caso', () => {
        const r = CLTDomain.computeBankLedgerStatus({ '2025-11': 30, '2025-12': 40 }, 6, new Date('2026-05-20'));
        assert.equal(r.status, 'vencido');
        assert.equal(r.minutosVencidos, 30);
        assert.equal(r.minutosVencendo, 40);
    });
});

describe('getDivisorHoraMensal', () => {
    test('usa 220 quando a jornada não é informada', () => {
        assert.equal(CLTDomain.getDivisorHoraMensal(null, ''), 220);
    });

    test('usa 220 para escala 12x36, independentemente da jornada diária', () => {
        assert.equal(CLTDomain.getDivisorHoraMensal(720, '12x36'), 220);
    });

    test('deriva o divisor da jornada real para jornada de 8h/dia (5 dias/semana)', () => {
        assert.equal(CLTDomain.getDivisorHoraMensal(480, ''), 200);
    });
});
