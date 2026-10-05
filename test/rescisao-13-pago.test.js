const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

require('../src/javascript/domain/clt-domain.js');
require('../src/javascript/domain/estagio-domain.js');
const { calcularRescisao } = require('../src/javascript/domain/calculo-rescisao.js');

const verba = (r, inicio) => r.verbas.find((v) => v.descricao.startsWith(inicio));
const base = { salario: 3000, admissao: new Date(2020, 0, 1), demissao: new Date(2026, 11, 10) };

describe('rescisão — 13º já pago no ano', () => {
    test('a 1ª parcela paga em novembro é descontada do 13º proporcional', () => {
        const r = calcularRescisao({ ...base, tipo: 'pedido_demissao', decimoTerceiroPagoNoAno: 1500 });
        assert.equal(verba(r, '13º Salário Proporcional').valor, 2750, '11/12: em dezembro só 10 dias');
        const desconto = verba(r, '13º já pago no ano (adiantamento)');
        assert.equal(desconto.valor, -1500);
        const semDesconto = calcularRescisao({ ...base, tipo: 'pedido_demissao' });
        assert.equal(r.totalVerbas, +(semDesconto.totalVerbas - 1500).toFixed(2));
    });

    test('na justa causa não há 13º proporcional: o adiantamento é compensado até uma remuneração', () => {
        const r = calcularRescisao({ ...base, tipo: 'justa_causa', decimoTerceiroPagoNoAno: 4000 });
        assert.equal(verba(r, '13º Salário Proporcional'), undefined);
        const desconto = verba(r, '13º já pago no ano, descontado');
        assert.equal(desconto.valor, -3000, 'limitado a 1 salário (CLT art. 477 §5º)');
    });

    test('sem 13º pago no ano, nada muda', () => {
        const r = calcularRescisao({ ...base, tipo: 'sem_justa_causa', decimoTerceiroPagoNoAno: 0 });
        assert.equal(
            r.verbas.some((v) => /já pago no ano/.test(v.descricao)),
            false
        );
    });
});
