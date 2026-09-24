const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

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

    test('30 dias com abono: 20 de descanso + 10 vendidos (não 30 + 10)', () => {
        const r = proventosFerias({ contractType: 'clt', salario: 3000, startDate: '2026-07-06', dias: 30, abono: true });
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
