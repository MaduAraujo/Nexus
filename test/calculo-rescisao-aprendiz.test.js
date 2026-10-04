const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

require('../src/javascript/domain/clt-domain.js');
const { calcularRescisao, TIPOS_RESCISAO_APRENDIZ } = require('../src/javascript/domain/calculo-rescisao.js');

const base = {
    salario: 1200,
    admissao: new Date(2025, 2, 10),
    demissao: new Date(2026, 2, 9),
    contractType: 'Aprendiz',
};

const descricoes = (r) => r.verbas.map((v) => v.descricao);

describe('rescisão do aprendiz (CLT art. 433)', () => {
    test('término do contrato: sem aviso, sem multa, FGTS de 2%', () => {
        const r = calcularRescisao({ ...base, tipo: 'aprendiz_termino' });
        assert.equal(r.aprendiz, true);
        assert.equal(r.diasAviso, 0);
        assert.deepEqual(r.encargos, []);
        assert.equal(r.fgtsEstimado, +(1200 * 0.02 * 12).toFixed(2));
        assert.deepEqual(descricoes(r), ['Saldo de Salário', '13º Salário Proporcional', 'Férias Proporcionais', '1/3 Constitucional de Férias']);
        assert.match(r.label, /Término do contrato de aprendizagem/);
        assert.equal(r.contratoFimAusente, false);
    });

    test('hipóteses antecipadas do art. 433 não pagam a indenização dos arts. 479/480', () => {
        for (const tipo of ['aprendiz_desempenho', 'aprendiz_ausencia_escolar', 'aprendiz_pedido']) {
            const r = calcularRescisao({ ...base, tipo, contratoFim: new Date(2027, 2, 9) });
            assert.ok(!descricoes(r).some((d) => /479/.test(d)), tipo);
            assert.deepEqual(r.encargos, [], tipo);
            assert.ok(descricoes(r).includes('Férias Proporcionais'), tipo);
        }
    });

    test('falta disciplinar grave perde 13º e férias proporcionais', () => {
        const r = calcularRescisao({ ...base, tipo: 'aprendiz_falta_grave' });
        assert.deepEqual(descricoes(r), ['Saldo de Salário']);
    });

    test('dispensa antecipada sem justa causa: metade dos salários até o término (art. 479) e multa de 40% sobre o FGTS de 2%', () => {
        const r = calcularRescisao({ ...base, tipo: 'aprendiz_sem_justa_causa', contratoFim: new Date(2026, 3, 8) });
        const ind = r.verbas.find((v) => /479/.test(v.descricao));
        assert.equal(ind.dias, 30);
        assert.equal(ind.valor, 600);
        assert.equal(r.encargos[0].valor, +(r.fgtsEstimado * 0.4).toFixed(2));
        assert.equal(r.diasAviso, 0);
    });

    test('sem a data de término a indenização não é calculada e o resultado avisa', () => {
        const r = calcularRescisao({ ...base, tipo: 'aprendiz_sem_justa_causa' });
        assert.equal(r.contratoFimAusente, true);
        assert.ok(!descricoes(r).some((d) => /479/.test(d)));
    });

    test('término já passado não gera indenização negativa', () => {
        const r = calcularRescisao({ ...base, tipo: 'aprendiz_sem_justa_causa', contratoFim: new Date(2026, 2, 1) });
        assert.ok(!descricoes(r).some((d) => /479/.test(d)));
        assert.equal(r.contratoFimAusente, false);
    });

    test('tipos genéricos da CLT viram a hipótese equivalente do aprendiz', () => {
        assert.equal(calcularRescisao({ ...base, tipo: 'sem_justa_causa' }).label, TIPOS_RESCISAO_APRENDIZ.aprendiz_sem_justa_causa.label);
        assert.equal(calcularRescisao({ ...base, tipo: 'pedido_demissao' }).label, TIPOS_RESCISAO_APRENDIZ.aprendiz_pedido.label);
        assert.equal(calcularRescisao({ ...base, tipo: 'justa_causa' }).label, TIPOS_RESCISAO_APRENDIZ.aprendiz_falta_grave.label);
        assert.equal(calcularRescisao({ ...base, tipo: 'acordo_mutuo' }).label, TIPOS_RESCISAO_APRENDIZ.aprendiz_termino.label);
    });

    test('horas a mais do aprendiz são pagas com 50% e saldo negativo não é descontado', () => {
        const extra = calcularRescisao({ ...base, tipo: 'aprendiz_pedido', saldoBancoHorasMin: 120, jornadaMin: 360, workLoad: '30h' });
        const v = extra.verbas.find((x) => /Horas Excedentes do Aprendiz/.test(x.descricao));
        assert.equal(v.valor, +((1200 / 150) * 2 * 1.5).toFixed(2));
        const neg = calcularRescisao({ ...base, tipo: 'aprendiz_pedido', saldoBancoHorasMin: -120, jornadaMin: 360, workLoad: '30h' });
        assert.ok(!neg.verbas.some((x) => /Banco de Horas/.test(x.descricao)));
    });

    test('empregado CLT comum continua com FGTS de 8% e não recebe as marcas do aprendiz', () => {
        const r = calcularRescisao({ ...base, contractType: 'CLT', tipo: 'pedido_demissao' });
        assert.equal(r.fgtsEstimado, +(1200 * 0.08 * 12).toFixed(2));
        assert.equal(r.aprendiz, false);
        assert.equal(r.contratoFimAusente, false);
    });
});
