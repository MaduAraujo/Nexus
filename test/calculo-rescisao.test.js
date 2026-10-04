const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

require('../src/javascript/domain/clt-domain.js');
require('../src/javascript/domain/estagio-domain.js');
const { calcularRescisao, getDivisorHoraMensal } = require('../src/javascript/domain/calculo-rescisao.js');

describe('justa_causa', () => {
    test('sem 13º, sem férias proporcionais, sem aviso, sem multa FGTS', () => {
        const r = calcularRescisao({
            tipo: 'justa_causa',
            salario: 3000,
            admissao: new Date(2020, 0, 10),
            demissao: new Date(2026, 2, 15),
            diasFeriasGozados: 180,
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
            diasFeriasGozados: 60,
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

        assert.equal(
            r.verbas.find((v) => v.descricao === '13º Salário Proporcional').dias,
            '2/12',
            'janeiro cheio + 25 dias de fevereiro (aviso projetado até 25/02)'
        );
        assert.equal(r.verbas.find((v) => v.descricao === 'Férias Proporcionais').dias, '2/12', '10/01 a 09/02 + 16 dias a partir de 10/02');
        assert.equal(r.totalVerbas, 6766.67);
        assert.equal(r.totalEncargos, 2400);
        assert.equal(r.custoTotal, 9166.67);
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
            diasFeriasGozados: 60,
        });
        assert.equal(r.diasAviso, 0);
        assert.equal(r.encargos.length, 0, 'pedido de demissão não gera multa de FGTS');

        const descontoBanco = r.verbas.find((v) => v.descricao.includes('Desconto de Saldo Negativo'));
        assert.ok(descontoBanco, 'saldo negativo de banco de horas deveria ser descontado neste tipo');
        assert.equal(descontoBanco.valor, -30);
        assert.equal(r.verbas.find((v) => v.descricao === '13º Salário Proporcional').dias, '1/12', '20 dias trabalhados em janeiro fecham 1/12');
        assert.equal(r.custoTotal, 2220);
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
            diasFeriasGozados: 60,
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

        assert.equal(r.verbas.find((v) => v.descricao === '13º Salário Proporcional').dias, '1/12', 'no acordo o aviso não projeta: 20 dias de janeiro');
        assert.equal(r.verbas.find((v) => v.descricao === 'Férias Proporcionais').dias, '0/12', '10/01 a 20/01 são só 11 dias');
        assert.equal(r.custoTotal, 5232);
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

    test('com "estágio" acentuado e ano completo já gozado, o recesso do ciclo vencido não se repete', () => {
        const r = calcularRescisao({
            tipo: 'pedido_demissao',
            salario: 1200,
            admissao: new Date(2025, 0, 10),
            demissao: new Date(2026, 0, 20),
            contractType: 'estágio',
            recessoGozadoDias: 30,
        });
        assert.deepEqual(
            r.verbas.map((v) => v.descricao),
            ['Saldo de Bolsa']
        );
        assert.equal(r.anosCompletos, 1);
        assert.deepEqual([r.recessoDevidoDias, r.recessoGozadoDias], [30, 30]);
    });

    test('recesso de ano completo que não foi gozado é pago no desligamento (art. 13)', () => {
        const r = calcularRescisao({
            tipo: 'pedido_demissao',
            salario: 1200,
            admissao: new Date(2025, 0, 10),
            demissao: new Date(2026, 1, 9),
            contractType: 'estagio',
            recessoGozadoDias: 10,
        });
        assert.deepEqual(r.verbas[1], { descricao: 'Recesso Proporcional (Lei 11.788 art. 13)', dias: 23, valor: 920 });
        assert.equal(r.recessoDevidoDias, 33);
    });
});

describe('PJ — encerramento de contrato de prestação de serviços, não rescisão CLT', () => {
    for (const tipo of ['sem_justa_causa', 'pedido_demissao', 'acordo_mutuo', 'justa_causa']) {
        test(`${tipo}: só o saldo de serviços do mês; sem aviso, 13º, férias, 1/3, banco de horas, FGTS ou multa`, () => {
            const r = calcularRescisao({
                tipo,
                salario: 9000,
                admissao: new Date(2022, 2, 1),
                demissao: new Date(2026, 5, 10),
                contractType: 'PJ',
                saldoBancoHorasMin: 1200,
                jornadaMin: null,
                mediaAdicionaisHabituais: 500,
            });
            assert.deepEqual(r.verbas, [{ descricao: 'Saldo de Serviços Prestados no Mês', dias: 10, valor: 3000 }]);
            assert.deepEqual(r.encargos, []);
            assert.deepEqual([r.diasAviso, r.fgtsEstimado, r.totalEncargos, r.totalVerbas, r.custoTotal], [0, 0, 0, 3000, 3000]);
            assert.equal(r.label, 'Encerramento de Contrato de Prestação de Serviços (PJ)');
            assert.equal(r.pj, true);
            assert.equal(r.anosCompletos, 4);
        });
    }
});

describe('ramos de regra que faltavam', () => {
    test('estágio: desligado antes do "dia de aniversário" no mês não conta o mês incompleto no recesso', () => {
        const antes = calcularRescisao({
            tipo: 'sem_justa_causa',
            contractType: 'estagio',
            salario: 1500,
            admissao: new Date(2025, 0, 20),
            demissao: new Date(2025, 6, 10),
        });
        const depois = calcularRescisao({
            tipo: 'sem_justa_causa',
            contractType: 'estagio',
            salario: 1500,
            admissao: new Date(2025, 0, 20),
            demissao: new Date(2025, 6, 25),
        });
        const dias = (r) => r.verbas.find((v) => /Recesso Proporcional/.test(v.descricao))?.dias;
        assert.equal(dias(antes), 13, '5 meses completos (20/01 a 19/06) = 12,5 dias, arredondado');
        assert.equal(dias(depois), 15, '6 meses completos = 15 dias');
    });

    test('tipo de rescisão desconhecido é calculado como sem justa causa (o caso mais protetivo)', () => {
        const base = { salario: 3000, admissao: new Date(2024, 0, 10), demissao: new Date(2026, 0, 20), jornadaMin: 480 };
        const desconhecido = calcularRescisao({ ...base, tipo: 'tipo_que_nao_existe' });
        const semJusta = calcularRescisao({ ...base, tipo: 'sem_justa_causa' });
        assert.deepEqual(desconhecido.verbas, semJusta.verbas);
        assert.equal(desconhecido.custoTotal, semJusta.custoTotal);
    });

    test('férias proporcionais contam do último aniversário da admissão, mesmo quando o deste ano ainda não chegou', () => {
        const r = calcularRescisao({
            tipo: 'sem_justa_causa',
            salario: 3000,
            admissao: new Date(2024, 9, 10),
            demissao: new Date(2026, 4, 1),
            jornadaMin: 480,
        });
        const prop = r.verbas.find((v) => /Férias Proporcionais/.test(v.descricao));
        assert.ok(prop, 'há férias proporcionais');
        assert.equal(prop.dias, '8/12', 'aviso de 33 dias projeta até 03/06/2026: 7 meses de 10/10 a 09/05 + 25 dias a partir de 10/05');
    });
});

describe('13º proporcional na rescisão de quem entrou no próprio ano', () => {
    test('conta a partir da admissão, não de 1º de janeiro', () => {
        const r = calcularRescisao({
            tipo: 'pedido_demissao',
            salario: 3000,
            admissao: new Date(2026, 2, 20),
            demissao: new Date(2026, 7, 10),
            jornadaMin: 480,
        });
        assert.equal(
            r.verbas.find((v) => v.descricao === '13º Salário Proporcional').dias,
            '4/12',
            'março (12 dias) e agosto (10 dias) não fecham 15; abril a julho são 4'
        );
    });
});
