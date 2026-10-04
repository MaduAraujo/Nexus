const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

const { TABELA_FISCAL } = require('../src/javascript/domain/tabelas-fiscais.js');

describe('TABELA_FISCAL.inss', () => {
    test('faixas em ordem crescente de limite', () => {
        const faixas = TABELA_FISCAL.inss.faixas;
        for (let i = 1; i < faixas.length; i++) {
            assert.ok(faixas[i].limite > faixas[i - 1].limite, `faixa ${i} deveria ter limite maior que a faixa ${i - 1}`);
        }
    });

    test('alíquotas estritamente crescentes (tabela progressiva)', () => {
        const faixas = TABELA_FISCAL.inss.faixas;
        for (let i = 1; i < faixas.length; i++) {
            assert.ok(faixas[i].aliquota > faixas[i - 1].aliquota, `alíquota da faixa ${i} deveria ser maior que a da faixa ${i - 1}`);
        }
    });

    test('nenhuma faixa tem limite, alíquota ou dedução negativos', () => {
        for (const f of TABELA_FISCAL.inss.faixas) {
            assert.ok(f.limite > 0);
            assert.ok(f.aliquota >= 0);
            assert.ok(f.deducao >= 0);
        }
    });

    test('vigência no formato YYYY-MM', () => {
        assert.match(TABELA_FISCAL.inss.vigencia, /^\d{4}-\d{2}$/);
    });
});

describe('TABELA_FISCAL.irrf', () => {
    test('última faixa cobre o restante (limite Infinity)', () => {
        const faixas = TABELA_FISCAL.irrf.faixas;
        assert.equal(faixas[faixas.length - 1].limite, Infinity);
    });

    test('primeira faixa é isenta', () => {
        assert.equal(TABELA_FISCAL.irrf.faixas[0].aliquota, 0);
    });

    test('faixas em ordem crescente de limite', () => {
        const faixas = TABELA_FISCAL.irrf.faixas;
        for (let i = 1; i < faixas.length; i++) {
            assert.ok(faixas[i].limite > faixas[i - 1].limite, `faixa ${i} deveria ter limite maior que a faixa ${i - 1}`);
        }
    });

    test('alíquotas não decrescem entre faixas', () => {
        const faixas = TABELA_FISCAL.irrf.faixas;
        for (let i = 1; i < faixas.length; i++) {
            assert.ok(faixas[i].aliquota >= faixas[i - 1].aliquota);
        }
    });

    test('vigência no formato YYYY-MM', () => {
        assert.match(TABELA_FISCAL.irrf.vigencia, /^\d{4}-\d{2}$/);
    });
});

describe('aprendiz: INSS normal e salário mínimo de referência', () => {
    const { calcINSS, calcINSSContrato } = require('../src/javascript/domain/tabelas-fiscais.js');

    test('INSS do aprendiz segue a tabela progressiva, como qualquer empregado', () => {
        assert.equal(calcINSSContrato(1500, 'aprendiz'), calcINSS(1500));
        assert.equal(calcINSSContrato(3000, 'Aprendiz'), calcINSS(3000));
    });

    test('salário mínimo com vigência', () => {
        assert.ok(TABELA_FISCAL.salarioMinimo.valor > 0);
        assert.match(TABELA_FISCAL.salarioMinimo.vigencia, /^\d{4}-\d{2}$/);
    });
});

describe('entradas inválidas nunca propagam NaN para a folha', () => {
    const { calcINSS, calcIRRF, calcINSSContrato } = require('../src/javascript/domain/tabelas-fiscais.js');

    test('base não numérica dá zero de INSS e de IRRF', () => {
        assert.equal(calcINSS(NaN), 0);
        assert.equal(calcIRRF(NaN), 0);
        assert.equal(calcINSSContrato(NaN, 'clt'), 0);
    });

    test('contrato não informado é tratado como CLT', () => {
        assert.equal(calcINSSContrato(3000, undefined), calcINSS(3000));
        assert.equal(calcINSSContrato(3000, null), calcINSS(3000));
    });
});

describe('IRRF 2026 com o redutor da Lei 15.270/2025', () => {
    const { calcINSS, calcIRRF, calcIRRFMensal, reducaoIRRF } = require('../src/javascript/domain/tabelas-fiscais.js');

    test('rendimento de até R$ 5.000 fica isento', () => {
        for (const r of [1621, 2500, 3500, 4999.99, 5000]) assert.equal(calcIRRFMensal({ rendimento: r, inss: calcINSS(r) }), 0, `rendimento ${r}`);
    });

    test('entre R$ 5.000,01 e R$ 7.350 a redução cai em linha reta: 978,62 − 0,133145 × rendimento', () => {
        const inss = calcINSS(6000);
        const imposto = calcIRRF(6000 - inss);
        assert.equal(calcIRRFMensal({ rendimento: 6000, inss }), +(imposto - (978.62 - 0.133145 * 6000)).toFixed(2));
        assert.equal(calcIRRFMensal({ rendimento: 6000, inss }), 385.1);
    });

    test('acima de R$ 7.350 não há redução', () => {
        const inss = calcINSS(10000);
        assert.equal(calcIRRFMensal({ rendimento: 10000, inss }), calcIRRF(10000 - inss));
        assert.equal(reducaoIRRF(7350.01, 500), 0);
    });

    test('a redução nunca passa do imposto e não se aplica sem rendimento ou sem imposto', () => {
        assert.equal(reducaoIRRF(4000, 100), 100);
        assert.equal(reducaoIRRF(0, 100), 0);
        assert.equal(reducaoIRRF(4000, 0), 0);
    });

    test('dependentes deduzem R$ 189,59 cada; vale o desconto simplificado de R$ 607,20 quando ele é maior', () => {
        const inss = calcINSS(10000);
        assert.equal(calcIRRFMensal({ rendimento: 10000, inss, dependentes: 2 }), calcIRRF(10000 - inss - 2 * 189.59));
        assert.equal(calcIRRFMensal({ rendimento: 8000, inss: 0 }), calcIRRF(8000 - 607.2));
        assert.equal(calcIRRFMensal({ rendimento: 8000, inss: 0, dependentes: 'x' }), calcIRRF(8000 - 607.2));
        assert.equal(calcIRRFMensal({ rendimento: -5 }), 0);
    });
});
