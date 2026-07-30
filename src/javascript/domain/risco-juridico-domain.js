const RiscoJuridicoDomain = {
    PESO_PRAZO_CRITICO: 30,
    PESO_PRAZO_ATENCAO: 12,
    PESO_POR_EXCESSO_HORAS: 8,
    TETO_EXCESSO_HORAS: 32,
    PESO_POR_DIA_INTERVALO: 4,
    TETO_INTERVALO: 24,
    PESO_POR_AJUSTE_REJEITADO: 10,
    TETO_AJUSTE_REJEITADO: 30,

    LIMIAR_CRITICO: 60,
    LIMIAR_ATENCAO: 30,

    nivelDoScore(score) {
        if (score >= RiscoJuridicoDomain.LIMIAR_CRITICO) return 'critico';
        if (score >= RiscoJuridicoDomain.LIMIAR_ATENCAO) return 'atencao';
        return 'ok';
    },

    scoreColaborador({ prazosLegais = [], excessoHorasOcorrencias = 0, diasIntervaloNaoCumprido = 0, ajustesRejeitados = 0 } = {}) {
        const fatores = [];
        let score = 0;

        prazosLegais.forEach((p) => {
            const peso = p.nivel === 'critico' ? RiscoJuridicoDomain.PESO_PRAZO_CRITICO : RiscoJuridicoDomain.PESO_PRAZO_ATENCAO;
            score += peso;
            fatores.push({ tipo: 'prazo_legal', nivel: p.nivel, label: p.titulo, peso });
        });

        if (excessoHorasOcorrencias > 0) {
            const peso = Math.min(RiscoJuridicoDomain.TETO_EXCESSO_HORAS, excessoHorasOcorrencias * RiscoJuridicoDomain.PESO_POR_EXCESSO_HORAS);
            score += peso;
            fatores.push({
                tipo: 'excesso_horas',
                nivel: excessoHorasOcorrencias >= 3 ? 'critico' : 'atencao',
                label: `${excessoHorasOcorrencias} dia(s) com jornada além do limite legal diário (CLT art. 59 §1º)`,
                peso,
            });
        }

        if (diasIntervaloNaoCumprido > 0) {
            const peso = Math.min(RiscoJuridicoDomain.TETO_INTERVALO, diasIntervaloNaoCumprido * RiscoJuridicoDomain.PESO_POR_DIA_INTERVALO);
            score += peso;
            fatores.push({
                tipo: 'intervalo',
                nivel: diasIntervaloNaoCumprido >= 5 ? 'critico' : 'atencao',
                label: `${diasIntervaloNaoCumprido} dia(s) sem intervalo intrajornada completo (CLT art. 71)`,
                peso,
            });
        }

        if (ajustesRejeitados > 0) {
            const peso = Math.min(RiscoJuridicoDomain.TETO_AJUSTE_REJEITADO, ajustesRejeitados * RiscoJuridicoDomain.PESO_POR_AJUSTE_REJEITADO);
            score += peso;
            fatores.push({
                tipo: 'rejeicao_ajuste',
                nivel: ajustesRejeitados >= 3 ? 'critico' : 'atencao',
                label: `${ajustesRejeitados} justificativa(s) de ajuste de ponto rejeitada(s) no período`,
                peso,
            });
        }

        const scoreFinal = Math.min(100, score);
        return { score: scoreFinal, nivel: RiscoJuridicoDomain.nivelDoScore(scoreFinal), fatores };
    },

    scoreEmpresa(scoresColaboradores) {
        if (!scoresColaboradores.length) return { mediaScore: 0, nivel: 'ok', criticos: 0, atencao: 0 };
        const soma = scoresColaboradores.reduce((acc, s) => acc + s.score, 0);
        const mediaScore = Math.round(soma / scoresColaboradores.length);
        return {
            mediaScore,
            nivel: RiscoJuridicoDomain.nivelDoScore(mediaScore),
            criticos: scoresColaboradores.filter((s) => s.nivel === 'critico').length,
            atencao: scoresColaboradores.filter((s) => s.nivel === 'atencao').length,
        };
    },
};

window.RiscoJuridicoDomain = RiscoJuridicoDomain;

if (typeof module !== 'undefined' && module.exports) module.exports = { RiscoJuridicoDomain };
