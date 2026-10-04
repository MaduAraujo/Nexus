const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

globalThis.window ??= globalThis;
const { calcINSS, calcIRRFMensal, calcPensaoAlimenticia, TABELA_FISCAL } = require('../src/javascript/domain/tabelas-fiscais.js');
const { CLTDomain } = require('../src/javascript/domain/clt-domain.js');

describe('calcPensaoAlimenticia', () => {
    test('percentual do líquido: 30% do que sobra depois de INSS e IRRF, com a pensão abatida da base do IRRF', () => {
        const inss = calcINSS(8000);
        const r = calcPensaoAlimenticia({ tipo: 'percentual', valor: 30, rendimento: 8000, inss });
        assert.deepEqual(r, { pensao: 1975.14, irrf: 494.69 });
        assert.equal(r.irrf, calcIRRFMensal({ rendimento: 8000, inss, pensao: r.pensao }));
        assert.ok(r.irrf < calcIRRFMensal({ rendimento: 8000, inss }));
    });

    test('valor fixo é limitado ao rendimento; percentual do salário mínimo usa a tabela vigente', () => {
        assert.equal(calcPensaoAlimenticia({ tipo: 'valor-fixo', valor: 1000, rendimento: 8000, inss: 0 }).pensao, 1000);
        assert.equal(calcPensaoAlimenticia({ tipo: 'valor-fixo', valor: 9000, rendimento: 3000, inss: 0 }).pensao, 3000);
        assert.equal(
            calcPensaoAlimenticia({ tipo: 'salario-minimo', valor: 30, rendimento: 3000 }).pensao,
            +(TABELA_FISCAL.salarioMinimo.valor * 0.3).toFixed(2)
        );
    });

    test('sem valor ou sem rendimento não há pensão; percentual acima de 100% é tratado como 100%', () => {
        const semValor = calcPensaoAlimenticia({ tipo: 'percentual', valor: 0, rendimento: 8000, inss: 500 });
        assert.deepEqual(semValor, { pensao: 0, irrf: calcIRRFMensal({ rendimento: 8000, inss: 500 }) });
        assert.equal(calcPensaoAlimenticia({ tipo: 'percentual', valor: 30, rendimento: 0 }).pensao, 0);
        assert.equal(calcPensaoAlimenticia({ tipo: 'percentual', valor: 'x', rendimento: 1000 }).pensao, 0);
        const total = calcPensaoAlimenticia({ tipo: 'percentual', valor: 150, rendimento: 3000, inss: 0 });
        assert.equal(total.pensao, +(3000 - total.irrf).toFixed(2));
    });

    test('a pensão entra nas deduções legais do IRRF, mas o desconto simplificado continua valendo quando é maior', () => {
        assert.equal(calcIRRFMensal({ rendimento: 9000, inss: 0, pensao: 100 }), calcIRRFMensal({ rendimento: 9000, inss: 0 }));
        assert.ok(calcIRRFMensal({ rendimento: 9000, inss: 0, pensao: 2000 }) < calcIRRFMensal({ rendimento: 9000, inss: 0 }));
        assert.equal(calcIRRFMensal({ rendimento: 9000, inss: 0, pensao: -5 }), calcIRRFMensal({ rendimento: 9000, inss: 0 }));
    });
});

describe('CLTDomain — pensão, piso e convenção', () => {
    test('validarPensao exige tipo e valor e limita o percentual', () => {
        assert.equal(CLTDomain.validarPensao({ tipo: '', valor: 10 }), 'Escolha o tipo da pensão alimentícia.');
        assert.match(CLTDomain.validarPensao({ tipo: 'percentual', valor: null }), /Informe o valor/);
        assert.match(CLTDomain.validarPensao({ tipo: 'salario-minimo', valor: 101 }), /100%/);
        assert.equal(CLTDomain.validarPensao({ tipo: 'valor-fixo', valor: 5000 }), null);
        assert.equal(CLTDomain.validarPensao({ tipo: 'percentual', valor: 100 }), null);
        assert.equal(CLTDomain.validarPensao(), 'Escolha o tipo da pensão alimentícia.');
    });

    test('pisoProporcional segue as horas semanais, com 44h como teto e jornada sem horas (12x36) valendo o piso cheio', () => {
        assert.equal(CLTDomain.pisoProporcional({ piso: 2200, workLoad: '44h' }), 2200);
        assert.equal(CLTDomain.pisoProporcional({ piso: 2200, workLoad: '30h' }), 1500);
        assert.equal(CLTDomain.pisoProporcional({ piso: 2200, workLoad: '48h' }), 2200);
        assert.equal(CLTDomain.pisoProporcional({ piso: 2200, workLoad: '12x36' }), 2200);
        assert.equal(CLTDomain.pisoProporcional({ piso: 2200 }), 2200);
        assert.ok(Number.isNaN(CLTDomain.pisoProporcional()));
    });

    test('convencaoVigente compara as datas da vigência', () => {
        const cct = { vigencia_inicio: '2026-01-01', vigencia_fim: '2026-12-31' };
        assert.equal(CLTDomain.convencaoVigente(cct, '2026-01-01'), true);
        assert.equal(CLTDomain.convencaoVigente(cct, '2026-12-31'), true);
        assert.equal(CLTDomain.convencaoVigente(cct, '2027-01-01'), false);
        assert.equal(CLTDomain.convencaoVigente(cct, '2025-12-31'), false);
        assert.equal(CLTDomain.convencaoVigente(null, '2026-06-01'), false);
    });
});
