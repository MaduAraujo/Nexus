const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

const { RiscoJuridicoDomain } = require('../src/javascript/domain/risco-juridico-domain.js');

describe('scoreColaborador — sem nenhum sinal', () => {
    test('score 0, nível ok, sem fatores', () => {
        const r = RiscoJuridicoDomain.scoreColaborador({});
        assert.equal(r.score, 0);
        assert.equal(r.nivel, 'ok');
        assert.deepEqual(r.fatores, []);
    });
});

describe('scoreColaborador — prazo legal (compliance_alerts)', () => {
    test('prazo crítico pesa mais que prazo em atenção', () => {
        const critico = RiscoJuridicoDomain.scoreColaborador({ prazosLegais: [{ nivel: 'critico', titulo: 'Férias vencidas' }] });
        const atencao = RiscoJuridicoDomain.scoreColaborador({ prazosLegais: [{ nivel: 'atencao', titulo: 'Experiência vence em 10d' }] });
        assert.ok(critico.score > atencao.score);
        assert.equal(critico.fatores[0].tipo, 'prazo_legal');
    });

    test('múltiplos prazos somam pontuação', () => {
        const r = RiscoJuridicoDomain.scoreColaborador({
            prazosLegais: [
                { nivel: 'critico', titulo: 'Férias vencidas' },
                { nivel: 'critico', titulo: 'Aviso prévio vencido' },
            ],
        });
        assert.equal(r.score, RiscoJuridicoDomain.PESO_PRAZO_CRITICO * 2);
        assert.equal(r.fatores.length, 2);
    });
});

describe('scoreColaborador — excesso de horas além do limite legal diário', () => {
    test('cresce com o número de ocorrências, respeitando o teto', () => {
        const uma = RiscoJuridicoDomain.scoreColaborador({ excessoHorasOcorrencias: 1 });
        const tres = RiscoJuridicoDomain.scoreColaborador({ excessoHorasOcorrencias: 3 });
        const muitas = RiscoJuridicoDomain.scoreColaborador({ excessoHorasOcorrencias: 50 });
        assert.ok(uma.score > 0 && uma.score < tres.score);
        assert.equal(muitas.score, RiscoJuridicoDomain.TETO_EXCESSO_HORAS);
    });

    test('3 ou mais ocorrências marcam o fator como crítico', () => {
        const r = RiscoJuridicoDomain.scoreColaborador({ excessoHorasOcorrencias: 3 });
        assert.equal(r.fatores[0].nivel, 'critico');
    });
});

describe('scoreColaborador — intervalo intrajornada não cumprido (CLT art. 71)', () => {
    test('cresce com os dias de déficit, respeitando o teto', () => {
        const r = RiscoJuridicoDomain.scoreColaborador({ diasIntervaloNaoCumprido: 100 });
        assert.equal(r.score, RiscoJuridicoDomain.TETO_INTERVALO);
    });
});

describe('scoreColaborador — padrão de rejeição de ajustes de ponto', () => {
    test('cresce com o número de ajustes rejeitados, respeitando o teto', () => {
        const r = RiscoJuridicoDomain.scoreColaborador({ ajustesRejeitados: 100 });
        assert.equal(r.score, RiscoJuridicoDomain.TETO_AJUSTE_REJEITADO);
    });
});

describe('scoreColaborador — combinação de fatores', () => {
    test('score final nunca passa de 100 mesmo somando todos os tetos', () => {
        const r = RiscoJuridicoDomain.scoreColaborador({
            prazosLegais: [
                { nivel: 'critico', titulo: 'a' },
                { nivel: 'critico', titulo: 'b' },
                { nivel: 'critico', titulo: 'c' },
                { nivel: 'critico', titulo: 'd' },
            ],
            excessoHorasOcorrencias: 50,
            diasIntervaloNaoCumprido: 50,
            ajustesRejeitados: 50,
        });
        assert.equal(r.score, 100);
        assert.equal(r.nivel, 'critico');
        assert.equal(r.fatores.length, 7);
    });
});

describe('nivelDoScore', () => {
    test('respeita os limiares de atenção e crítico', () => {
        assert.equal(RiscoJuridicoDomain.nivelDoScore(0), 'ok');
        assert.equal(RiscoJuridicoDomain.nivelDoScore(29), 'ok');
        assert.equal(RiscoJuridicoDomain.nivelDoScore(30), 'atencao');
        assert.equal(RiscoJuridicoDomain.nivelDoScore(59), 'atencao');
        assert.equal(RiscoJuridicoDomain.nivelDoScore(60), 'critico');
        assert.equal(RiscoJuridicoDomain.nivelDoScore(100), 'critico');
    });
});

describe('scoreEmpresa', () => {
    test('sem colaboradores, retorna estado neutro', () => {
        const r = RiscoJuridicoDomain.scoreEmpresa([]);
        assert.deepEqual(r, { mediaScore: 0, nivel: 'ok', criticos: 0, atencao: 0 });
    });

    test('agrega média e contagem de níveis críticos/atenção', () => {
        const scores = [
            { score: 80, nivel: 'critico' },
            { score: 40, nivel: 'atencao' },
            { score: 0, nivel: 'ok' },
        ];
        const r = RiscoJuridicoDomain.scoreEmpresa(scores);
        assert.equal(r.mediaScore, 40);
        assert.equal(r.criticos, 1);
        assert.equal(r.atencao, 1);
        assert.equal(r.nivel, 'atencao');
    });
});
