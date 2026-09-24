const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let sfx;

before(async () => {
    sfx = await import('../supabase/functions/_shared/employee-financial-snapshot.mjs');
});

describe('getJornadaMin / calcWorkedMin (mesma regra de equipe-colaborador.js)', () => {
    test('PJ não tem jornada; CLT 40h dá 480min; estágio dá 360min fixos', () => {
        assert.equal(sfx.getJornadaMin({ contract_type: 'pj' }), null);
        assert.equal(sfx.getJornadaMin({ contract_type: 'clt', work_load: '40h' }), 480);
        assert.equal(sfx.getJornadaMin({ contract_type: 'estagio' }), 360);
    });

    test('calcWorkedMin desconta o intervalo de almoço', () => {
        const rec = {
            entrada: '2026-06-01T08:00:00',
            saida_almoco: '2026-06-01T12:00:00',
            retorno_almoco: '2026-06-01T13:00:00',
            saida: '2026-06-01T17:00:00',
        };
        assert.equal(sfx.calcWorkedMin(rec), 480);
    });
});

describe('calcBancoHorasLedger', () => {
    test('PJ (jornadaMin null) sempre devolve ledger zerado, mesmo com registros', () => {
        const ledger = sfx.calcBancoHorasLedger([{ date: '2026-01-05', entrada: '08:00', saida: '20:00' }], [], null, 6);
        assert.deepEqual(ledger, { saldoMin: 0, proximoVencimento: null, minutosVencendo: 0, minutosVencidos: 0 });
    });

    test('sem registros nem ajustes: saldo zero, sem vencimento', () => {
        const ledger = sfx.calcBancoHorasLedger([], [], 480, 6);
        assert.deepEqual(ledger, { saldoMin: 0, proximoVencimento: null, minutosVencendo: 0, minutosVencidos: 0 });
    });

    test('mês com saldo positivo: soma no total e cria um vencimento vencimentoMeses depois', () => {
        const records = [{ date: '2026-01-05', entrada: '2026-01-05T08:00:00', saida: '2026-01-05T18:00:00' }];
        const ledger = sfx.calcBancoHorasLedger(records, [], 480, 6, new Date('2026-02-01'));
        assert.equal(ledger.saldoMin, 120);
        assert.equal(ledger.proximoVencimento, '2026-07-01');
    });

    test('registro sem saída (dia em aberto) não entra no cálculo', () => {
        const records = [{ date: '2026-01-05', entrada: '2026-01-05T08:00:00' }];
        const ledger = sfx.calcBancoHorasLedger(records, [], 480, 6);
        assert.equal(ledger.saldoMin, 0);
    });

    test('ajuste manual de crédito e débito entram no saldo do mês', () => {
        const adjustments = [
            { date: '2026-01-10', tipo: 'credito', minutos: 60 },
            { date: '2026-01-15', tipo: 'debito', minutos: 20 },
        ];
        const ledger = sfx.calcBancoHorasLedger([], adjustments, 480, 6, new Date('2026-02-01'));
        assert.equal(ledger.saldoMin, 40);
    });

    test('débito de um mês posterior consome o crédito do mês mais antigo primeiro (FIFO)', () => {
        const adjustments = [
            { date: '2026-01-10', tipo: 'credito', minutos: 100 },
            { date: '2026-02-10', tipo: 'credito', minutos: 50 },
            { date: '2026-03-10', tipo: 'debito', minutos: 100 },
        ];
        const ledger = sfx.calcBancoHorasLedger([], adjustments, 480, 6, new Date('2026-04-01'));
        assert.equal(ledger.saldoMin, 50);
        assert.equal(ledger.minutosVencendo + ledger.minutosVencidos, 0);
        assert.equal(ledger.proximoVencimento, '2026-08-01');
    });

    test('crédito com vencimento no passado conta como minutosVencidos', () => {
        const adjustments = [{ date: '2026-01-10', tipo: 'credito', minutos: 100 }];
        const ledger = sfx.calcBancoHorasLedger([], adjustments, 480, 1, new Date('2026-06-01'));
        assert.equal(ledger.minutosVencidos, 100);
        assert.equal(ledger.minutosVencendo, 0);
    });

    test('crédito vencendo dentro de 30 dias conta em minutosVencendo, não em vencidos', () => {
        const adjustments = [{ date: '2026-01-01', tipo: 'credito', minutos: 100 }];
        const ledger = sfx.calcBancoHorasLedger([], adjustments, 480, 1, new Date('2026-01-12'));
        assert.equal(ledger.minutosVencendo, 100);
        assert.equal(ledger.minutosVencidos, 0);
    });

    test('crédito com folga grande até o vencimento não conta em nenhum dos dois', () => {
        const adjustments = [{ date: '2026-01-01', tipo: 'credito', minutos: 100 }];
        const ledger = sfx.calcBancoHorasLedger([], adjustments, 480, 12, new Date('2026-01-05'));
        assert.equal(ledger.minutosVencendo, 0);
        assert.equal(ledger.minutosVencidos, 0);
    });

    test('débito maior que todo o histórico de crédito não gera erro nem bucket negativo', () => {
        const adjustments = [
            { date: '2026-01-10', tipo: 'credito', minutos: 30 },
            { date: '2026-02-10', tipo: 'debito', minutos: 100 },
        ];
        const ledger = sfx.calcBancoHorasLedger([], adjustments, 480, 6, new Date('2026-03-01'));
        assert.equal(ledger.saldoMin, -70);
        assert.equal(ledger.minutosVencendo, 0);
        assert.equal(ledger.minutosVencidos, 0);
    });
});

describe('calcFeriasSnapshot', () => {
    test('sem data de admissão, não estima nada', () => {
        assert.equal(sfx.calcFeriasSnapshot({}, []), null);
    });

    test('exatamente 1 ano de casa, sem férias tiradas: 30 dias de saldo', () => {
        const snap = sfx.calcFeriasSnapshot({ admission_date: '2025-01-01' }, [], new Date('2026-01-02'));
        assert.equal(snap.saldo_estimado_dias, 30);
    });

    test('menos de 1 ano de casa: ainda não completou período aquisitivo, saldo 0', () => {
        const snap = sfx.calcFeriasSnapshot({ admission_date: '2026-01-01' }, [], new Date('2026-06-01'));
        assert.equal(snap.saldo_estimado_dias, 0);
    });

    test('2 anos de casa com 1 período de 20 dias já tirado (aprovado): 60 - 20 = 40', () => {
        const snap = sfx.calcFeriasSnapshot({ admission_date: '2024-01-01' }, [{ status: 'aprovado', days: 20, abono: false }], new Date('2026-01-02'));
        assert.equal(snap.saldo_estimado_dias, 40);
    });

    test('férias pendentes (ainda não aprovadas) não descontam do saldo', () => {
        const snap = sfx.calcFeriasSnapshot({ admission_date: '2025-01-01' }, [{ status: 'pendente', days: 15, abono: false }], new Date('2026-01-02'));
        assert.equal(snap.saldo_estimado_dias, 30);
    });

    test('abono pecuniário: os 10 dias vendidos também saem do direito (CLT art. 143)', () => {
        const snap = sfx.calcFeriasSnapshot({ admission_date: '2025-01-01' }, [{ status: 'aprovado', days: 30, abono: true }], new Date('2026-01-02'));
        assert.equal(snap.saldo_estimado_dias, 0);
    });

    test('saldo nunca fica negativo mesmo tirando mais do que o direito (nunca deveria acontecer, mas não quebra)', () => {
        const snap = sfx.calcFeriasSnapshot({ admission_date: '2025-01-01' }, [{ status: 'aprovado', days: 30, abono: false }], new Date('2025-06-01'));
        assert.equal(snap.saldo_estimado_dias, 0);
    });

    test('período aquisitivo atual reflete o ciclo de 1 ano mais recente já iniciado', () => {
        const snap = sfx.calcFeriasSnapshot({ admission_date: '2024-03-10' }, [], new Date('2026-04-01'));
        assert.equal(snap.periodo_aquisitivo_atual.inicio, '2026-03-10');
        assert.equal(snap.periodo_aquisitivo_atual.fim, '2027-03-09');
    });
});
