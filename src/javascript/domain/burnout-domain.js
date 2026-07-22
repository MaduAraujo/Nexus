const BurnoutDomain = {
    TREND_MIN_SEMANAS_PIORA: 3,

    pontuarAlertasDia(alertasDia) {
        return (alertasDia || []).reduce((soma, a) => soma + (a.nivel === 'critico' ? 2 : 1), 0);
    },

    detectTrend(rows) {
        const porSemana = {};
        (rows || []).forEach((row) => {
            const wk = CLTDomain.weekStartKey(row.date);
            porSemana[wk] = (porSemana[wk] || 0) + BurnoutDomain.pontuarAlertasDia(row.alertas);
        });
        const scores = Object.keys(porSemana)
            .sort()
            .map((wk) => porSemana[wk]);
        if (scores.length < BurnoutDomain.TREND_MIN_SEMANAS_PIORA) return { piorando: false };

        let streak = 1;
        for (let i = scores.length - 1; i > 0; i--) {
            if (scores[i] >= scores[i - 1]) streak++;
            else break;
        }
        const scoreAtual = scores[scores.length - 1];
        const scoreInicial = scores[scores.length - streak];
        const piorando = streak >= BurnoutDomain.TREND_MIN_SEMANAS_PIORA && scoreAtual > scoreInicial && scoreAtual > 0;
        return piorando ? { piorando: true, semanas: streak } : { piorando: false };
    },
};

window.BurnoutDomain = BurnoutDomain;

if (typeof module !== 'undefined' && module.exports) module.exports = { BurnoutDomain };
