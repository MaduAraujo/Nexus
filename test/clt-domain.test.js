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

describe('contarFaltasInjustificadas (CLT arts. 130 e 131)', () => {
    const base = { inicio: '2026-06-15', fim: '2026-06-21', primeiroRegistro: '2026-01-02', workLoad: '40h' };
    const presente = (date) => ({ date, entrada: `${date}T08:00:00-03:00` });

    test('dia útil sem entrada é falta; fim de semana não', () => {
        const registros = ['2026-06-15', '2026-06-16', '2026-06-18'].map(presente);
        assert.equal(CLTDomain.contarFaltasInjustificadas({ ...base, registros }), 2);
    });

    test('registro sem entrada (só saída, por exemplo) conta como falta', () => {
        const registros = [{ date: '2026-06-15', entrada: null, saida: '2026-06-15T18:00:00-03:00' }];
        assert.equal(CLTDomain.contarFaltasInjustificadas({ ...base, registros }), 5);
    });

    test('feriado e falta abonada não contam', () => {
        assert.equal(CLTDomain.contarFaltasInjustificadas({ ...base, feriados: ['2026-06-18'], abonadas: ['2026-06-19'] }), 3);
    });

    test('dias de férias e de atestado aprovados não contam (art. 131)', () => {
        const afastamentos = [
            { start_date: '2026-06-10', end_date: '2026-06-16' },
            { start_date: '2026-06-19', end_date: '2026-06-19' },
        ];
        assert.equal(CLTDomain.contarFaltasInjustificadas({ ...base, afastamentos }), 2);
    });

    test('antes do primeiro registro de ponto não há dado: não é falta', () => {
        assert.equal(CLTDomain.contarFaltasInjustificadas({ ...base, primeiroRegistro: '2026-06-18' }), 2);
        assert.equal(CLTDomain.contarFaltasInjustificadas({ ...base, primeiroRegistro: null }), 0);
    });

    test('escala 12x36 não é inferida dos registros', () => {
        assert.equal(CLTDomain.contarFaltasInjustificadas({ ...base, workLoad: '12x36' }), 0);
    });
});

describe('listarFaltasInjustificadas + descontoFaltasDsr (fonte única de falta; Lei 605/49 art. 6º)', () => {
    const base = { inicio: '2026-06-15', fim: '2026-06-30', primeiroRegistro: '2026-01-02', workLoad: '40h' };
    const presente = (date) => ({ date, entrada: `${date}T08:00:00-03:00` });

    test('devolve as datas, e a contagem usada nas férias é o tamanho dessa mesma lista', () => {
        const registros = ['2026-06-15', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-22', '2026-06-23', '2026-06-24', '2026-06-25', '2026-06-26'].map(
            presente
        );
        const faltas = CLTDomain.listarFaltasInjustificadas({ ...base, registros });
        assert.deepEqual(faltas, ['2026-06-16', '2026-06-29', '2026-06-30']);
        assert.equal(CLTDomain.contarFaltasInjustificadas({ ...base, registros }), faltas.length);
    });

    test('desconta o dia de cada falta e um DSR por semana com falta', () => {
        const r = CLTDomain.descontoFaltasDsr({ salario: 3000, faltas: ['2026-06-16', '2026-06-29', '2026-06-30'] });
        assert.deepEqual(r, { dias: 3, semanas: 2, valorFaltas: 300, valorDsr: 200 });
    });

    test('sem faltas, sem desconto', () => {
        assert.deepEqual(CLTDomain.descontoFaltasDsr({ salario: 3000 }), { dias: 0, semanas: 0, valorFaltas: 0, valorDsr: 0 });
    });
});

describe('férias no salário do mês (sem pagar os dias de gozo em dobro)', () => {
    test('o registro de férias é só o gozo: o abono não mexe no calendário', () => {
        const comAbono = { start_date: '2026-07-06', end_date: '2026-07-25', days: 20, abono: true };
        assert.deepEqual(CLTDomain.periodoGozoFerias(comAbono), { start_date: '2026-07-06', end_date: '2026-07-25', dias: 20 });
        assert.equal(CLTDomain.periodoGozoFerias({ start_date: '2026-07-13', end_date: '2026-07-22' }).dias, 10, 'sem days usa as datas');
        assert.equal(CLTDomain.periodoGozoFerias({ start_date: '2026-07-13', end_date: '2026-07-12', days: 0 }), null);
    });

    test('o saldo consome o gozo e mais os 10 dias vendidos', () => {
        assert.equal(CLTDomain.diasConsumidosFerias({ days: 20, abono: true }), 30);
        assert.equal(CLTDomain.diasConsumidosFerias({ days: 15, abono: false }), 15);
        assert.equal(CLTDomain.diasConsumidosFerias({}), 0);
    });

    test('dias de gozo por mês quando as férias atravessam a virada', () => {
        const ferias = [{ start_date: '2026-07-25', end_date: '2026-08-08', days: 15, abono: false }];
        assert.equal(CLTDomain.diasGozoNoMes(ferias, '2026-07'), 7);
        assert.equal(CLTDomain.diasGozoNoMes(ferias, '2026-08'), 8);
        assert.equal(CLTDomain.diasGozoNoMes(ferias, '2026-09'), 0);
        assert.equal(CLTDomain.diasSalarioNoMes(ferias, '2026-07'), 23);
        assert.equal(CLTDomain.diasSalarioNoMes(ferias, '2026-08'), 22);
        assert.equal(CLTDomain.diasSalarioNoMes([], '2026-08'), 30);
    });

    test('férias cobrindo o mês inteiro zeram o salário, inclusive em fevereiro', () => {
        assert.equal(CLTDomain.diasSalarioNoMes([{ start_date: '2027-02-01', end_date: '2027-03-02', days: 30 }], '2027-02'), 0);
        assert.equal(CLTDomain.diasSalarioNoMes([{ start_date: '2026-07-01', end_date: '2026-07-30', days: 30 }], '2026-07'), 0);
    });
});

describe('motivoInicioFeriasVedado (art. 134 §3º: início vedado nos 2 dias antes de feriado ou DSR)', () => {
    const vedado = (iso, opts) => CLTDomain.motivoInicioFeriasVedado(iso, opts);

    test('sexta e sábado antecedem o domingo (DSR) e são vedados; segunda a quinta são livres', () => {
        assert.match(vedado('2026-08-07'), /2 dias antes do descanso semanal \(domingo, 09\/08\)/);
        assert.match(vedado('2026-08-08'), /domingo, 09\/08/);
        for (const livre of ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06']) assert.equal(vedado(livre), null, livre);
    });

    test('começar no próprio domingo não é vedado pela regra', () => {
        assert.equal(vedado('2026-08-09'), null);
    });

    test('os 2 dias antes de um feriado são vedados, mesmo no meio da semana', () => {
        const feriados = ['2026-09-07'];
        assert.match(vedado('2026-09-05', { feriados }), /descanso semanal|feriado/);
        assert.match(vedado('2026-09-03', { feriados: ['2026-09-05'] }), /feriado \(05\/09\)/);
        assert.match(vedado('2026-09-04', { feriados: ['2026-09-05'] }), /feriado \(05\/09\)/);
        assert.equal(vedado('2026-09-02', { feriados: ['2026-09-05'] }), null, 'três dias antes pode');
        assert.match(vedado('2026-11-13', { feriados: [{ date: '2026-11-15' }] }), /feriado \(15\/11\)/, 'aceita a linha da tabela');
    });

    test('feriado na virada de mês e de ano', () => {
        assert.match(vedado('2026-12-30', { feriados: ['2027-01-01'] }), /feriado \(01\/01\)/);
        assert.match(vedado('2026-03-31', { feriados: ['2026-04-02'] }), /feriado \(02\/04\)/);
    });

    test('escala 12x36 não tem domingo fixo de descanso: só os feriados valem', () => {
        assert.equal(vedado('2026-08-07', { workLoad: '12x36' }), null);
        assert.match(vedado('2026-08-05', { workLoad: '12x36', feriados: ['2026-08-07'] }), /feriado/);
    });

    test('estagiário segue a Lei do Estágio (recesso), não a CLT; aprendiz é CLT e segue a regra', () => {
        assert.equal(vedado('2026-08-07', { contractType: 'estagio' }), null);
        assert.equal(vedado('2026-08-07', { contractType: 'estágio' }), null);
        assert.match(vedado('2026-08-07', { contractType: 'aprendiz' }), /descanso semanal/);
    });

    test('sem data não há o que vedar', () => {
        assert.equal(vedado(''), null);
        assert.equal(vedado(null), null);
    });

    test('ponto facultativo não é feriado e não conta', () => {
        const tabela = [
            { date: '2026-02-17', abrangencia: 'facultativo' },
            { date: '2026-04-21', abrangencia: 'nacional' },
            { date: '2026-07-09', abrangencia: 'estadual' },
            { date: '2026-01-25', abrangencia: 'municipal' },
        ];
        assert.deepEqual(CLTDomain.feriadosQueContam(tabela), ['2026-04-21', '2026-07-09', '2026-01-25']);
        assert.deepEqual(CLTDomain.feriadosQueContam(), []);
    });
});
