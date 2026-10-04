const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

require('../src/javascript/domain/clt-domain.js');
const { calcularRescisao, TIPOS_RESCISAO_PRAZO } = require('../src/javascript/domain/calculo-rescisao.js');

const base = {
    salario: 3000,
    admissao: new Date(2026, 0, 10),
    demissao: new Date(2026, 6, 9),
    contractType: 'Prazo determinado',
};

const descricoes = (r) => r.verbas.map((v) => v.descricao);

describe('rescisão do contrato por prazo determinado (CLT arts. 443, 479 e 480)', () => {
    test('término na data combinada: sem aviso prévio e sem multa de 40%', () => {
        const r = calcularRescisao({ ...base, tipo: 'prazo_termino' });
        assert.equal(r.prazoDeterminado, true);
        assert.equal(r.diasAviso, 0);
        assert.deepEqual(r.encargos, []);
        assert.deepEqual(descricoes(r), ['Saldo de Salário', '13º Salário Proporcional', 'Férias Proporcionais', '1/3 Constitucional de Férias']);
        assert.equal(r.label, TIPOS_RESCISAO_PRAZO.prazo_termino.label);
        assert.equal(r.aviso480, false);
    });

    test('dispensa antecipada sem justa causa: metade dos salários até o término (art. 479) e multa de 40%', () => {
        const r = calcularRescisao({ ...base, tipo: 'prazo_sem_justa_causa', contratoFim: new Date(2026, 7, 8) });
        const ind = r.verbas.find((v) => /479/.test(v.descricao));
        assert.equal(ind.dias, 30);
        assert.equal(ind.valor, 1500);
        assert.equal(r.encargos[0].valor, +(r.fgtsEstimado * 0.4).toFixed(2));
        assert.equal(r.diasAviso, 0);
    });

    test('sem término no cadastro a indenização do art. 479 não é calculada e o resultado avisa', () => {
        const r = calcularRescisao({ ...base, tipo: 'prazo_sem_justa_causa' });
        assert.equal(r.contratoFimAusente, true);
    });

    test('pedido antes do término: sem aviso, sem multa, desconta banco negativo e avisa do art. 480', () => {
        const r = calcularRescisao({ ...base, tipo: 'prazo_pedido', saldoBancoHorasMin: -120, jornadaMin: 480 });
        assert.equal(r.aviso480, true);
        assert.deepEqual(r.encargos, []);
        assert.ok(descricoes(r).includes('Desconto de Saldo Negativo de Banco de Horas'));
    });

    test('justa causa perde 13º e férias proporcionais', () => {
        const r = calcularRescisao({ ...base, tipo: 'prazo_justa_causa' });
        assert.deepEqual(descricoes(r), ['Saldo de Salário']);
    });

    test('os tipos da CLT viram o equivalente do prazo determinado; desconhecido vira término', () => {
        assert.equal(calcularRescisao({ ...base, tipo: 'sem_justa_causa' }).label, TIPOS_RESCISAO_PRAZO.prazo_sem_justa_causa.label);
        assert.equal(calcularRescisao({ ...base, tipo: 'pedido_demissao' }).label, TIPOS_RESCISAO_PRAZO.prazo_pedido.label);
        assert.equal(calcularRescisao({ ...base, tipo: 'justa_causa' }).label, TIPOS_RESCISAO_PRAZO.prazo_justa_causa.label);
        assert.equal(calcularRescisao({ ...base, tipo: 'acordo_mutuo' }).label, TIPOS_RESCISAO_PRAZO.prazo_termino.label);
    });
});

describe('encerramento do temporário (Lei 6.019/1974)', () => {
    test('não gera verbas nem custo: quem paga é a empresa de trabalho temporário', () => {
        const r = calcularRescisao({ ...base, contractType: 'Temporário', tipo: 'sem_justa_causa' });
        assert.equal(r.temporario, true);
        assert.deepEqual(r.verbas, []);
        assert.deepEqual(r.encargos, []);
        assert.equal(r.custoTotal, 0);
        assert.equal(r.mesesCasaAteDemissao, 6);
        assert.match(r.label, /empresa de trabalho temporário/);
    });

    test('demissão antes da admissão não dá meses negativos', () => {
        const r = calcularRescisao({ ...base, contractType: 'temporario', demissao: new Date(2025, 11, 1) });
        assert.equal(r.mesesCasaAteDemissao, 0);
        assert.equal(r.anosCompletos, 0);
    });
});
