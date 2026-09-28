const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../src/javascript/domain/clt-domain.js');
require('../src/javascript/domain/tabelas-fiscais.js');

const {
    isElegivel13,
    calcAvos13,
    calcDecimoTerceiroIntegral,
    calcParcela13,
    calcAdiantamentoFerias,
    proventosFerias,
} = require('../src/javascript/domain/eventos-folha.js');

describe('isElegivel13', () => {
    test('CLT em qualquer variação tem direito', () => {
        assert.equal(isElegivel13('CLT'), true);
        assert.equal(isElegivel13('CLT - Prazo Indeterminado'), true);
        assert.equal(isElegivel13('CLT - Prazo Determinado'), true);
    });
    test('Aprendiz e Temporário têm direito', () => {
        assert.equal(isElegivel13('Aprendiz'), true);
        assert.equal(isElegivel13('Temporário'), true);
    });
    test('PJ e Estágio não têm direito', () => {
        assert.equal(isElegivel13('PJ'), false);
        assert.equal(isElegivel13('Estágio'), false);
        assert.equal(isElegivel13('estagio'), false);
    });
    test('sem contract_type informado, assume CLT (tem direito)', () => {
        assert.equal(isElegivel13(null), true);
    });
});

describe('calcAvos13', () => {
    test('ano inteiro trabalhado = 12/12', () => {
        assert.equal(calcAvos13(new Date(2026, 0, 1), new Date(2026, 11, 31)), 12);
    });
    test('menos de 15 dias trabalhados no mês final não conta esse mês', () => {
        assert.equal(calcAvos13(new Date(2026, 6, 1), new Date(2026, 11, 10)), 5);
    });
    test('15 dias ou mais no mês final já conta esse mês inteiro', () => {
        assert.equal(calcAvos13(new Date(2026, 6, 1), new Date(2026, 11, 15)), 6);
    });
    test('nunca passa de 12 nem fica negativo', () => {
        assert.equal(calcAvos13(new Date(2020, 0, 1), new Date(2026, 11, 31)), 12);
        assert.equal(calcAvos13(new Date(2026, 11, 20), new Date(2026, 11, 10)), 0);
    });
});

describe('calcDecimoTerceiroIntegral', () => {
    test('colaborador ativo o ano inteiro recebe o salário integral', () => {
        const r = calcDecimoTerceiroIntegral({ salario: 3000, admissaoISO: '2020-01-10', anoBase: 2026 });
        assert.equal(r.avos, 12);
        assert.equal(r.valorIntegral, 3000);
    });
    test('admitido em março conta a partir de março (10 meses até dezembro)', () => {
        const r = calcDecimoTerceiroIntegral({ salario: 1200, admissaoISO: '2026-03-10', anoBase: 2026 });
        assert.equal(r.avos, 10);
        assert.equal(r.valorIntegral, +((1200 / 12) * 10).toFixed(2));
    });
    test('considera médias de adicionais habituais na base de cálculo', () => {
        const r = calcDecimoTerceiroIntegral({ salario: 3000, admissaoISO: '2020-01-10', anoBase: 2026, mediaAdicionaisHabituais: 300 });
        assert.equal(r.valorIntegral, 3300);
    });
});

describe('calcParcela13', () => {
    test('1ª parcela é metade do valor integral', () => {
        assert.equal(calcParcela13({ valorIntegral: 3000, parcela: 1 }).valor, 1500);
    });
    test('2ª parcela é o restante (cobre arredondamento de centavos ímpares)', () => {
        const r1 = calcParcela13({ valorIntegral: 3001, parcela: 1 });
        const r2 = calcParcela13({ valorIntegral: 3001, parcela: 2 });
        assert.equal(r1.valor + r2.valor, 3001);
    });
});

describe('calcAdiantamentoFerias', () => {
    test('30 dias de férias, sem abono: 1 salário + 1/3', () => {
        const r = calcAdiantamentoFerias({ salario: 3000, dias: 30, abono: false });
        assert.equal(r.ferias, 3000);
        assert.equal(r.tercoFerias, 1000);
        assert.equal(r.abonoPecuniario, 0);
        assert.equal(r.total, 4000);
    });
    test('20 dias de férias + 10 dias de abono pecuniário (venda de 1/3)', () => {
        const r = calcAdiantamentoFerias({ salario: 3000, dias: 20, abono: true });
        assert.equal(r.ferias, 2000);
        assert.equal(r.tercoFerias, +(2000 / 3).toFixed(2));
        assert.equal(r.abonoPecuniario, 1000);
        assert.equal(r.tercoAbono, +(1000 / 3).toFixed(2));
        assert.equal(r.total, +(r.ferias + r.tercoFerias + r.abonoPecuniario + r.tercoAbono).toFixed(2));
    });
});

describe('proventosFerias', () => {
    test('30 dias sem abono: férias + 1/3 na competência do início', () => {
        const r = proventosFerias({ contractType: 'clt', salario: 3000, startDate: '2026-07-06', dias: 30, abono: false });
        assert.deepEqual(r.mes, '2026-07');
        assert.equal(r.competencia, '07/2026');
        assert.equal(r.mesFormatado, 'Julho 2026');
        assert.deepEqual(
            r.proventos.map((p) => [p.cod, p.referencia, p.valor]),
            [
                ['040', '30 dias', 3000],
                ['041', '—', 1000],
            ]
        );
    });

    test('20 dias de gozo com abono: paga os 20 de descanso + os 10 vendidos à parte', () => {
        const r = proventosFerias({ contractType: 'clt', salario: 3000, startDate: '2026-07-06', dias: 20, abono: true });
        assert.deepEqual(
            r.proventos.map((p) => [p.cod, p.referencia, p.valor]),
            [
                ['040', '20 dias', 2000],
                ['041', '—', 666.67],
                ['042', '10 dias', 1000],
                ['043', '—', 333.33],
            ]
        );
    });

    test('PJ ou sem salário não geram lançamento', () => {
        assert.equal(proventosFerias({ contractType: 'pj', salario: 9000, startDate: '2026-07-06', dias: 30 }), null);
        assert.equal(proventosFerias({ contractType: 'clt', salario: 0, startDate: '2026-07-06', dias: 30 }), null);
    });
});

describe('reciboFerias (recibo próprio, pago até 2 dias antes do gozo — CLT art. 145)', () => {
    const { reciboFerias, mesReciboFerias, inicioDoReciboFerias, pagarFeriasAte } = require('../src/javascript/domain/eventos-folha.js');
    const { calcINSS, calcIRRF } = require('../src/javascript/domain/tabelas-fiscais.js');

    test('chave, vencimento e competência do recibo', () => {
        assert.equal(mesReciboFerias('2026-07-13'), '2026-07-F13');
        assert.equal(inicioDoReciboFerias('2026-07-F13'), '2026-07-13');
        assert.equal(inicioDoReciboFerias('2026-07'), null);
        assert.equal(pagarFeriasAte('2026-07-01'), '2026-06-29', 'vira o mês para trás');
    });

    test('INSS e IRRF sobre férias + 1/3; abono (042/043) isento dos dois', () => {
        const r = reciboFerias({ contractType: 'clt', salario: 4000, startDate: '2026-07-06', dias: 20, abono: true });
        const base = 2666.67 + 888.89;
        const inss = calcINSS(base);
        assert.deepEqual(
            r.descontos.map((d) => [d.cod, d.valor]),
            [
                ['901', inss],
                ['906', calcIRRF(base - inss)],
            ]
        );
        assert.deepEqual([r.descontos[0].competencia, r.descontos[0].base], ['2026-07', base]);
        assert.equal(r.totalProventos, +(base + 1333.33 + 444.44).toFixed(2));
        assert.equal(r.liquido, +(r.totalProventos - r.totalDescontos).toFixed(2));
        assert.deepEqual([r.mes, r.pagarAte, r.competencia], ['2026-07-F06', '2026-07-04', '07/2026']);
        assert.match(r.mesFormatado, /Recibo de Férias — gozo a partir de 06\/07\/2026/);
    });

    test('férias que atravessam o mês: base e INSS separados por competência; IRRF uma vez, sobre o total', () => {
        const r = reciboFerias({ contractType: 'clt', salario: 3000, startDate: '2026-07-25', dias: 15, abono: false });
        const base = 1500 + 500;
        const julho = +((base * 7) / 15).toFixed(2);
        const agosto = +(base - julho).toFixed(2);
        const inss = r.descontos.filter((d) => d.cod === '901');
        assert.deepEqual(
            inss.map((d) => [d.competencia, d.referencia, d.base, d.valor]),
            [
                ['2026-07', '7 dias', julho, calcINSS(julho)],
                ['2026-08', '8 dias', agosto, calcINSS(agosto)],
            ]
        );
        assert.match(inss[1].descricao, /competência 08\/2026/);
        const totalInss = +(calcINSS(julho) + calcINSS(agosto)).toFixed(2);
        assert.equal(r.descontos.find((d) => d.cod === '906')?.valor ?? 0, calcIRRF(base - totalInss));
    });

    test('dias de gozo por competência', () => {
        const { diasPorCompetencia } = require('../src/javascript/domain/eventos-folha.js');
        assert.deepEqual(diasPorCompetencia('2026-12-20', 20), { '2026-12': 12, '2027-01': 8 });
        assert.deepEqual(diasPorCompetencia('2026-07-01', 10), { '2026-07': 10 });
    });

    test('aprendiz: INSS de 8% e sem IRRF; PJ não tem recibo', () => {
        const r = reciboFerias({ contractType: 'aprendiz', salario: 1500, startDate: '2026-07-01', dias: 30, abono: false });
        assert.deepEqual(
            r.descontos.map((d) => [d.cod, d.valor]),
            [['901', +((1500 + 500) * 0.08).toFixed(2)]]
        );
        assert.equal(reciboFerias({ contractType: 'pj', salario: 9000, startDate: '2026-07-13', dias: 30 }), null);
    });
});

describe('estágio: recesso pago com a bolsa, sem 1/3 nem recibo de férias', () => {
    const { reciboFerias } = require('../src/javascript/domain/eventos-folha.js');
    const { calcINSSContrato } = require('../src/javascript/domain/tabelas-fiscais.js');

    test('sem proventos de férias e sem recibo', () => {
        for (const contractType of ['estagio', 'estágio']) {
            assert.equal(proventosFerias({ contractType, salario: 1500, startDate: '2026-07-06', dias: 15 }), null);
            assert.equal(reciboFerias({ contractType, salario: 1500, startDate: '2026-07-06', dias: 15 }), null);
        }
    });

    test('bolsa de estágio não tem INSS', () => {
        assert.equal(calcINSSContrato(1500, 'estagio'), 0);
        assert.equal(calcINSSContrato(1500, 'pj'), 0);
        assert.ok(calcINSSContrato(1500, 'clt') > 0);
    });
});

describe('13º da folha: mês de admissão com menos de 15 dias não conta', () => {
    test('admitido em 20/03 recebe 9/12 (abril a dezembro), não 10/12', () => {
        const r = calcDecimoTerceiroIntegral({ salario: 1200, admissaoISO: '2026-03-20', anoBase: 2026 });
        assert.equal(r.avos, 9);
        assert.equal(r.valorIntegral, 900);
    });

    test('admitido em 10/03 recebe 10/12 (março tem 22 dias trabalhados)', () => {
        const r = calcDecimoTerceiroIntegral({ salario: 1200, admissaoISO: '2026-03-10', anoBase: 2026 });
        assert.equal(r.avos, 10);
    });
});

describe('recibo de férias: quem não tem direito e competência inválida', () => {
    const { inicioDoReciboFerias, mesReciboFerias } = require('../src/javascript/domain/eventos-folha.js');

    test('PJ, estagiário, salário zerado e período sem dias não geram recibo', () => {
        const base = { salario: 3000, startDate: '2026-08-03', dias: 20, abono: false };
        assert.equal(proventosFerias({ ...base, contractType: 'pj' }), null);
        assert.equal(proventosFerias({ ...base, contractType: 'Estagio' }), null);
        assert.equal(proventosFerias({ ...base, contractType: 'clt', salario: 0 }), null);
        assert.equal(proventosFerias({ ...base, contractType: 'clt', dias: 0 }), null);
        assert.ok(proventosFerias({ ...base, contractType: undefined }), 'sem tipo informado é CLT e tem direito');
    });

    test('a competência do recibo guarda o dia de início e só é lida se estiver no formato certo', () => {
        const mes = mesReciboFerias('2026-08-03');
        assert.equal(mes, '2026-08-F03');
        assert.equal(inicioDoReciboFerias(mes), '2026-08-03');
        assert.equal(inicioDoReciboFerias('2026-08'), null);
        assert.equal(inicioDoReciboFerias(''), null);
        assert.equal(inicioDoReciboFerias(undefined), null);
    });
});
