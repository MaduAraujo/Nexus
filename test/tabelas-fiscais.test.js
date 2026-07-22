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

test('aprendizInssAliquota é uma fração plausível (entre 0 e 1)', () => {
    assert.ok(TABELA_FISCAL.aprendizInssAliquota > 0 && TABELA_FISCAL.aprendizInssAliquota < 1);
});
