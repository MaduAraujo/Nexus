const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

require('../src/javascript/domain/clt-domain.js');
const { calcularRescisao, getDivisorHoraMensal } = require('../src/javascript/domain/calculo-rescisao.js');

describe('justa_causa', () => {
    test('sem 13º, sem férias proporcionais, sem aviso, sem multa FGTS', () => {
        const r = calcularRescisao({
            tipo: 'justa_causa',
            salario: 3000,
            admissao: new Date(2020, 0, 10),
            demissao: new Date(2026, 2, 15),
        });
        assert.equal(r.diasAviso, 0);
        assert.deepEqual(r.verbas, [{ descricao: 'Saldo de Salário', dias: 15, valor: 1500 }]);
        assert.deepEqual(r.encargos, []);
        assert.equal(r.totalVerbas, 1500);
        assert.equal(r.totalEncargos, 0);
        assert.equal(r.custoTotal, 1500);
    });
});

describe('sem_justa_causa', () => {
    test('aviso prévio integral + 13º/férias proporcionais projetados + multa de 40% do FGTS', () => {
        const r = calcularRescisao({
            tipo: 'sem_justa_causa',
            salario: 3000,
            admissao: new Date(2024, 0, 10),
            demissao: new Date(2026, 0, 20),
        });
        assert.equal(r.anosCompletos, 2);
        assert.equal(r.diasAviso, 36);
        assert.equal(r.fgtsEstimado, 6000);

        const aviso = r.verbas.find((v) => v.descricao === 'Aviso Prévio Indenizado');
        assert.ok(aviso, 'deveria ter aviso prévio integral (não parcial)');
        assert.equal(aviso.valor, 3600);

        const multa = r.encargos.find((e) => e.descricao.includes('40%'));
        assert.ok(multa, 'deveria ter multa de 40% sobre o FGTS');
        assert.equal(multa.valor, 2400);

        assert.equal(r.totalVerbas, 6183.33);
        assert.equal(r.totalEncargos, 2400);
        assert.equal(r.custoTotal, 8583.33);
    });
});

describe('pedido_demissao', () => {
    test('sem aviso, sem multa FGTS, e desconta saldo negativo de banco de horas', () => {
        const r = calcularRescisao({
            tipo: 'pedido_demissao',
            salario: 3000,
            admissao: new Date(2024, 0, 10),
            demissao: new Date(2026, 0, 20),
            saldoBancoHorasMin: -120,
            jornadaMin: 480,
        });
        assert.equal(r.diasAviso, 0);
        assert.equal(r.encargos.length, 0, 'pedido de demissão não gera multa de FGTS');

        const descontoBanco = r.verbas.find((v) => v.descricao.includes('Desconto de Saldo Negativo'));
        assert.ok(descontoBanco, 'saldo negativo de banco de horas deveria ser descontado neste tipo');
        assert.equal(descontoBanco.valor, -30);
        assert.equal(r.custoTotal, 1970);
    });
});

describe('acordo_mutuo', () => {
    test('aviso prévio parcial (50%), multa de 20% do FGTS, e paga saldo positivo de banco de horas', () => {
        const r = calcularRescisao({
            tipo: 'acordo_mutuo',
            salario: 3000,
            admissao: new Date(2024, 0, 10),
            demissao: new Date(2026, 0, 20),
            saldoBancoHorasMin: 120,
            jornadaMin: 480,
        });
        assert.equal(r.diasAviso, 18);

        const aviso = r.verbas.find((v) => v.descricao.includes('parcial'));
        assert.ok(aviso, 'aviso prévio deveria estar marcado como parcial');
        assert.equal(aviso.valor, 1800);

        const multa = r.encargos.find((e) => e.descricao.includes('20%'));
        assert.ok(multa);
        assert.equal(multa.valor, 1152);

        const saldoBanco = r.verbas.find((v) => v.descricao === 'Saldo de Banco de Horas');
        assert.ok(saldoBanco, 'saldo positivo de banco de horas deveria ser pago neste tipo');
        assert.equal(saldoBanco.valor, 30);

        assert.equal(r.custoTotal, 4982);
    });
});

describe('getDivisorHoraMensal', () => {
    test('usa 220 quando a jornada não é informada', () => {
        assert.equal(getDivisorHoraMensal(null, ''), 220);
    });

    test('usa 220 para escala 12x36, independentemente da jornada diária', () => {
        assert.equal(getDivisorHoraMensal(720, '12x36'), 220);
    });

    test('deriva o divisor da jornada real para jornada de 8h/dia (5 dias/semana)', () => {
        assert.equal(getDivisorHoraMensal(480, ''), 200);
    });
});

test('regra geral: custoTotal nunca é menor que a soma de verbas + encargos individuais', () => {
    const r = calcularRescisao({
        tipo: 'sem_justa_causa',
        salario: 5000,
        admissao: new Date(2021, 5, 1),
        demissao: new Date(2026, 6, 10),
    });
    const somaVerbas = r.verbas.reduce((s, v) => s + v.valor, 0);
    const somaEncargos = r.encargos.reduce((s, e) => s + e.valor, 0);
    assert.equal(r.totalVerbas, +somaVerbas.toFixed(2));
    assert.equal(r.totalEncargos, +somaEncargos.toFixed(2));
    assert.equal(r.custoTotal, +(r.totalVerbas + r.totalEncargos).toFixed(2));
});

describe('estágio (Lei 11.788/08) — não é rescisão CLT', () => {
    test('só saldo de bolsa e recesso proporcional; sem aviso, 13º, 1/3, FGTS ou multa', () => {
        const r = calcularRescisao({
            tipo: 'sem_justa_causa',
            salario: 1500,
            admissao: new Date(2025, 8, 1),
            demissao: new Date(2026, 2, 15),
            contractType: 'estagio',
            saldoBancoHorasMin: 600,
        });
        assert.deepEqual(r.verbas, [
            { descricao: 'Saldo de Bolsa', dias: 15, valor: 750 },
            { descricao: 'Recesso Proporcional (Lei 11.788 art. 13)', dias: 15, valor: 750 },
        ]);
        assert.deepEqual([r.diasAviso, r.fgtsEstimado, r.totalEncargos, r.custoTotal], [0, 0, 0, 1500]);
        assert.ok(!r.verbas.some((v) => /13º|1\/3|Aviso|Banco de Horas/.test(v.descricao)));
    });

    test('com "estágio" acentuado e ano completo, o recesso do ciclo já vencido não se repete', () => {
        const r = calcularRescisao({
            tipo: 'pedido_demissao',
            salario: 1200,
            admissao: new Date(2025, 0, 10),
            demissao: new Date(2026, 0, 20),
            contractType: 'estágio',
        });
        assert.deepEqual(
            r.verbas.map((v) => v.descricao),
            ['Saldo de Bolsa']
        );
        assert.equal(r.anosCompletos, 1);
    });
});
