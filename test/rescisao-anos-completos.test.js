const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

require('../src/javascript/domain/clt-domain.js');
require('../src/javascript/domain/estagio-domain.js');
const { calcularRescisao } = require('../src/javascript/domain/calculo-rescisao.js');

const rescisao = (admissao, demissao) => calcularRescisao({ tipo: 'sem_justa_causa', salario: 3000, admissao, demissao });

describe('rescisão — anos completos para o aviso prévio (Lei 12.506/2011)', () => {
    test('faltando dias para fechar o ano, ainda não conta o ano', () => {
        const r = rescisao(new Date(2020, 5, 20), new Date(2021, 5, 10));
        assert.equal(r.anosCompletos, 0);
        assert.equal(r.diasAviso, 30);
    });

    test('no dia do aniversário de admissão, o ano conta', () => {
        const r = rescisao(new Date(2020, 5, 20), new Date(2021, 5, 20));
        assert.equal(r.anosCompletos, 1);
        assert.equal(r.diasAviso, 33);
    });

    test('dois anos e alguns meses contam dois anos', () => {
        assert.equal(rescisao(new Date(2020, 0, 31), new Date(2022, 3, 15)).anosCompletos, 2);
    });
});
