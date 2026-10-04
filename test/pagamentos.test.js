const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.document = { addEventListener: () => {} };

global.TABELA_FISCAL = require('../src/javascript/domain/tabelas-fiscais.js').TABELA_FISCAL;
require('../src/javascript/domain/clt-domain.js');

const { calcINSS, calcIRRF, calcRow, parseCurrency } = require('../src/javascript/pagamentos.js');

describe('calcINSS', () => {
    test('retorna 0 para salário zero ou negativo', () => {
        assert.equal(calcINSS(0), 0);
        assert.equal(calcINSS(-500), 0);
    });

    test('primeira faixa (7,5%, sem parcela a deduzir)', () => {
        assert.equal(calcINSS(1000), 75);
    });

    test('congela no teto acima da última faixa', () => {
        const noTeto = calcINSS(8475.55);
        assert.equal(calcINSS(20000), noTeto);
        assert.equal(calcINSS(100000), noTeto);
    });

    test('é progressivo (sobe conforme o salário sobe)', () => {
        assert.ok(calcINSS(2000) > calcINSS(1000));
        assert.ok(calcINSS(4000) > calcINSS(2000));
        assert.ok(calcINSS(9000) > calcINSS(4000));
    });
});

describe('calcIRRF', () => {
    test('isento abaixo do primeiro limite', () => {
        assert.equal(calcIRRF(2000), 0);
        assert.equal(calcIRRF(2428.8), 0);
    });

    test('passa a descontar acima do primeiro limite', () => {
        assert.ok(calcIRRF(2826.65) > 0);
    });

    test('nunca é negativo, mesmo colado numa fronteira de faixa', () => {
        for (const base of [2428.81, 2826.66, 3751.06, 4664.69, 10000, 50000]) {
            assert.ok(calcIRRF(base) >= 0, `irrf(${base}) não deveria ser negativo`);
        }
    });

    test('sem teto — segue descontando em bases muito altas', () => {
        assert.ok(calcIRRF(50000) > calcIRRF(10000));
    });
});

describe('parseCurrency', () => {
    test('converte string em formato brasileiro completo (R$ 1.234,56)', () => {
        assert.equal(parseCurrency('R$ 1.234,56'), 1234.56);
    });

    test('aceita string simples com vírgula decimal', () => {
        assert.equal(parseCurrency('25,00'), 25);
    });

    test('retorna 0 para valores vazios/nulos/undefined', () => {
        assert.equal(parseCurrency(''), 0);
        assert.equal(parseCurrency(null), 0);
        assert.equal(parseCurrency(undefined), 0);
    });

    test('retorna 0 para texto sem número', () => {
        assert.equal(parseCurrency('abc'), 0);
    });
});

describe('calcRow', () => {
    test('CLT sem benefícios: bruto = salário, com INSS/IRRF descontados', () => {
        const r = calcRow({ salary: 8000, contractType: 'clt' });
        assert.equal(r.isPJ, false);
        assert.equal(r.bruto, 8000);
        assert.ok(r.inss > 0);
        assert.ok(r.irrf > 0);
        assert.equal(r.liquido, +(r.bruto - r.inss - r.irrf).toFixed(2));
    });

    test('PJ não sofre INSS/IRRF nem desconto de VT', () => {
        const r = calcRow({ salary: 5000, contractType: 'pj' });
        assert.equal(r.isPJ, true);
        assert.equal(r.inss, 0);
        assert.equal(r.irrf, 0);
        assert.equal(r.descontos, 0);
        assert.equal(r.liquido, 5000);
    });

    test('Aprendiz paga INSS pela tabela progressiva e IRRF pela tabela normal', () => {
        const r = calcRow({ salary: 1200, contractType: 'aprendiz' });
        assert.equal(r.inss, 90);
        assert.equal(r.irrf, 0);
        const alto = calcRow({ salary: 8000, contractType: 'Aprendiz' });
        assert.equal(alto.inss, calcRow({ salary: 8000, contractType: 'clt' }).inss);
        assert.ok(alto.irrf > 0);
    });

    test('benefícios (VR/VA/VT) somam ao bruto; desconto de VT é limitado a 6% do salário', () => {
        const r = calcRow({
            salary: 4000,
            contractType: 'clt',
            benValeRefeicao: '25,00',
            benValeAlimentacao: '400,00',
            valeTransporte: 'sim',
            conducoesdia: '2',
            valorPassagem: '4,50',
        });
        const vtBruto = 4.5 * 2 * 22;
        assert.equal(r.benef, +(25 * 22 + 400 + vtBruto).toFixed(2));
        const descVT = +(r.descontos - r.inss - r.irrf).toFixed(2);
        assert.ok(descVT > 0);
        assert.ok(descVT <= +(4000 * 0.06).toFixed(2) + 0.01, 'desconto de VT não deveria passar de 6% do salário');
    });

    test('até R$ 5 mil não há IRRF (Lei 15.270/2025); dependentes reduzem o IRRF', () => {
        assert.equal(calcRow({ salary: 4900, contractType: 'clt' }).irrf, 0);
        assert.ok(calcRow({ salary: 9000, contractType: 'clt', dependentes: 3 }).irrf < calcRow({ salary: 9000, contractType: 'clt' }).irrf);
    });

    test('periculosidade entra no bruto e na base do INSS/IRRF; PJ e estágio não recebem', () => {
        const r = calcRow({ salary: 3000, contractType: 'clt', adicionalPericulosidade: true });
        assert.equal(r.bruto, 3900);
        assert.equal(r.inss, calcINSS(3900));
        assert.equal(calcRow({ salary: 3000, contractType: 'pj', adicionalPericulosidade: true }).bruto, 3000);
        assert.equal(calcRow({ salary: 1500, contractType: 'estagio', grauInsalubridade: 'maximo' }).bruto, 1500);
    });

    test('salário ausente/inválido não quebra o cálculo', () => {
        const r = calcRow({ contractType: 'clt' });
        assert.equal(r.salary, 0);
        assert.equal(r.bruto, 0);
        assert.equal(r.inss, 0);
    });
});
