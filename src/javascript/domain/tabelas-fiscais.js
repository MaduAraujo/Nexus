const TABELA_FISCAL = {
    inss: {
        vigencia: '2026-01',
        faixas: [
            { limite: 1621.0, aliquota: 0.075, deducao: 0 },
            { limite: 2902.84, aliquota: 0.09, deducao: 24.32 },
            { limite: 4354.27, aliquota: 0.12, deducao: 111.4 },
            { limite: 8475.55, aliquota: 0.14, deducao: 198.49 },
        ],
    },

    aprendizInssAliquota: 0.08,

    irrf: {
        vigencia: '2026-01',
        faixas: [
            { limite: 2428.8, aliquota: 0, deducao: 0 },
            { limite: 2826.65, aliquota: 0.075, deducao: 182.16 },
            { limite: 3751.05, aliquota: 0.15, deducao: 394.16 },
            { limite: 4664.68, aliquota: 0.225, deducao: 675.49 },
            { limite: Infinity, aliquota: 0.275, deducao: 908.73 },
        ],
    },
};

window.TABELA_FISCAL = TABELA_FISCAL;

if (typeof module !== 'undefined' && module.exports) module.exports = { TABELA_FISCAL };
