const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

const { CLTDomain } = require('../src/javascript/domain/clt-domain.js');

const reg = (entrada, saida, extra = {}) => ({ entrada, saida, ...extra });

describe('adicional noturno com prorrogação (Súmula 60, II, do TST)', () => {
    test('jornada predominantemente noturna que passa das 5h: as horas depois das 5h também são noturnas', () => {
        assert.equal(CLTDomain.noturnoMinRegistro(reg('2026-03-02T23:00:00', '2026-03-03T07:00:00')), 480);
        assert.equal(
            CLTDomain.noturnoMinRegistro(
                reg('2026-03-02T19:00:00', '2026-03-03T07:00:00', { saida_almoco: '2026-03-03T00:00:00', retorno_almoco: '2026-03-03T01:00:00' })
            ),
            480
        );
    });

    test('jornada que termina antes das 5h ou que é majoritariamente diurna não tem prorrogação', () => {
        assert.equal(CLTDomain.noturnoMinRegistro(reg('2026-03-02T22:00:00', '2026-03-03T04:00:00')), 360);
        assert.equal(CLTDomain.noturnoMinRegistro(reg('2026-03-03T03:00:00', '2026-03-03T12:00:00')), 120);
        assert.equal(CLTDomain.noturnoMinRegistro(reg('2026-03-03T08:00:00', '2026-03-03T17:00:00')), 0);
    });

    test('pausa depois das 5h não conta como prorrogação', () => {
        const r = reg('2026-03-02T22:00:00', '2026-03-03T07:00:00', { saida_almoco: '2026-03-03T05:00:00', retorno_almoco: '2026-03-03T06:00:00' });
        assert.equal(CLTDomain.noturnoMinRegistro(r), 420 + 60);
    });
});

describe('intervalo intrajornada pela jornada realmente trabalhada (CLT art. 71; Súmula 437, IV)', () => {
    test('contrato de 6h que trabalhou 7h sem pausa deve 1h de intervalo', () => {
        assert.equal(CLTDomain.calcIntervaloDeficitMin(reg('2026-03-02T08:00:00', '2026-03-02T15:00:00'), 360), 60);
    });

    test('contrato de 6h que trabalhou 6h deve só 15 minutos', () => {
        assert.equal(CLTDomain.calcIntervaloDeficitMin(reg('2026-03-02T08:00:00', '2026-03-02T14:00:00'), 360), 15);
    });

    test('PJ (sem jornada) não tem intervalo controlado', () => {
        assert.equal(CLTDomain.calcIntervaloDeficitMin(reg('2026-03-02T08:00:00', '2026-03-02T18:00:00'), null), 0);
    });
});

describe('reflexo no DSR das variáveis (Lei 605/49 art. 7º; Súmula 172 do TST)', () => {
    test('valor ÷ dias úteis × domingos e feriados do mês', () => {
        assert.deepEqual(CLTDomain.diasUteisEDescansoNoMes('2026-03', ['2026-03-20']), { uteis: 25, descanso: 6 });
        assert.equal(CLTDomain.reflexoDsr(1000, '2026-03', ['2026-03-20']), 240);
        assert.deepEqual(CLTDomain.diasUteisEDescansoNoMes('2026-02'), { uteis: 24, descanso: 4 });
    });

    test('sem variáveis não há reflexo', () => {
        assert.equal(CLTDomain.reflexoDsr(0, '2026-03'), 0);
        assert.equal(CLTDomain.reflexoDsr(NaN, '2026-03'), 0);
    });
});

describe('periculosidade e insalubridade (CLT arts. 192 e 193)', () => {
    test('periculosidade é 30% do salário', () => {
        assert.deepEqual(CLTDomain.adicionalRisco({ salario: 3000, periculosidade: true }), {
            tipo: 'periculosidade',
            cod: '023',
            percentual: 0.3,
            valor: 900,
            descricao: 'Adicional de Periculosidade (30% do salário — CLT art. 193 §1º)',
        });
    });

    test('insalubridade é 10/20/40% do salário mínimo', () => {
        assert.equal(CLTDomain.adicionalRisco({ salario: 3000, grauInsalubridade: 'minimo', salarioMinimo: 1621 }).valor, 162.1);
        assert.equal(CLTDomain.adicionalRisco({ salario: 3000, grauInsalubridade: 'medio', salarioMinimo: 1621 }).valor, 324.2);
        const max = CLTDomain.adicionalRisco({ salario: 3000, grauInsalubridade: 'maximo', salarioMinimo: 1621 });
        assert.equal(max.valor, 648.4);
        assert.match(max.descricao, /40% do salário mínimo/);
    });

    test('não acumulam: fica o mais vantajoso (art. 193 §2º)', () => {
        assert.equal(
            CLTDomain.adicionalRisco({ salario: 3000, periculosidade: true, grauInsalubridade: 'maximo', salarioMinimo: 1621 }).tipo,
            'periculosidade'
        );
        assert.equal(CLTDomain.adicionalRisco({ salario: 1621, periculosidade: true, grauInsalubridade: 'maximo', salarioMinimo: 1621 }).tipo, 'insalubridade');
    });

    test('sem adicional retorna null', () => {
        assert.equal(CLTDomain.adicionalRisco({ salario: 3000 }), null);
        assert.equal(CLTDomain.adicionalRisco({ salario: 3000, grauInsalubridade: 'xyz', salarioMinimo: 1621 }), null);
        assert.equal(CLTDomain.adicionalRisco(), null);
    });
});

describe('banco de horas vencido vira hora extra (CLT art. 59 §5º)', () => {
    test('separa por mês de origem só o saldo que já venceu até o fim da competência', () => {
        const net = { '2026-01': 300, '2026-02': -100, '2026-03': 200 };
        assert.deepEqual(CLTDomain.bucketsVencidosNoMes(net, 6, '2026-06'), []);
        assert.deepEqual(CLTDomain.bucketsVencidosNoMes(net, 6, '2026-07'), [{ mk: '2026-01', minutos: 200 }]);
        assert.deepEqual(CLTDomain.bucketsVencidosNoMes(net, 6, '2026-09'), [
            { mk: '2026-01', minutos: 200 },
            { mk: '2026-03', minutos: 200 },
        ]);
    });

    test('saldo de meses depois da competência não entra', () => {
        assert.deepEqual(CLTDomain.bucketsVencidosNoMes({ '2026-08': 60 }, 0, '2026-07'), []);
    });

    test('o status do banco continua igual depois da refatoração', () => {
        const r = CLTDomain.computeBankLedgerStatus({ '2026-01': 300 }, 6, new Date(2026, 6, 15));
        assert.equal(r.status, 'vencido');
        assert.equal(r.minutosVencidos, 300);
    });
});

describe('estabilidade provisória na rescisão', () => {
    const base = { estabilidadeAte: '2026-08-31', motivo: 'gestante', demissaoISO: '2026-05-10' };

    test('bloqueia dispensa sem justa causa e acordo dentro do período', () => {
        for (const tipo of CLTDomain.TIPOS_DISPENSA_SEM_JUSTA_CAUSA) {
            const r = CLTDomain.avaliarEstabilidade({ ...base, tipo });
            assert.equal(r.bloqueia, true, tipo);
            assert.match(r.mensagem, /31\/08\/2026/);
            assert.match(r.mensagem, /Gestante/);
        }
    });

    test('pedido de demissão e justa causa só avisam', () => {
        assert.match(CLTDomain.avaliarEstabilidade({ ...base, tipo: 'pedido_demissao' }).mensagem, /art\. 500/);
        assert.equal(CLTDomain.avaliarEstabilidade({ ...base, tipo: 'prazo_pedido' }).bloqueia, false);
        assert.match(CLTDomain.avaliarEstabilidade({ ...base, tipo: 'justa_causa' }).mensagem, /revertida/);
        const termino = CLTDomain.avaliarEstabilidade({ ...base, tipo: 'prazo_termino', motivo: 'xyz' });
        assert.equal(termino.bloqueia, false);
        assert.match(termino.mensagem, /Outra garantia/);
    });

    test('fora do período ou sem data não há aviso', () => {
        assert.equal(CLTDomain.avaliarEstabilidade({ ...base, demissaoISO: '2026-09-01', tipo: 'sem_justa_causa' }), null);
        assert.equal(CLTDomain.avaliarEstabilidade({ demissaoISO: '2026-05-10', tipo: 'sem_justa_causa' }), null);
        assert.equal(CLTDomain.avaliarEstabilidade(), null);
    });
});

describe('prorrogação noturna só depois de trabalho noturno', () => {
    test('trabalho à tarde antes da noite não vira prorrogação', () => {
        const r = {
            entrada: '2026-07-07T18:00:00',
            saida_almoco: '2026-07-07T22:00:00',
            retorno_almoco: '2026-07-07T23:00:00',
            saida: '2026-07-08T03:00:00',
        };
        assert.equal(CLTDomain.noturnoMinRegistro(r), 240);
    });
});
