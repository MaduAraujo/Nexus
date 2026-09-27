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

function calcINSS(salBase) {
    if (salBase <= 0) return 0;
    const faixas = TABELA_FISCAL.inss.faixas;
    const teto = faixas[faixas.length - 1].limite;
    const base = Math.min(salBase, teto);
    for (const f of faixas) {
        if (base <= f.limite) return +(base * f.aliquota - f.deducao).toFixed(2);
    }
    return 0;
}

function calcIRRF(base) {
    for (const f of TABELA_FISCAL.irrf.faixas) {
        if (base <= f.limite) return f.aliquota > 0 ? +(base * f.aliquota - f.deducao).toFixed(2) : 0;
    }
    return 0;
}

function calcINSSContrato(base, contractType) {
    const tipo = String(contractType || '').toLowerCase();
    if (tipo === 'estagio' || tipo === 'estágio' || tipo === 'pj') return 0;
    if (tipo === 'aprendiz') return +(Math.max(0, base) * TABELA_FISCAL.aprendizInssAliquota).toFixed(2);
    return calcINSS(base);
}

window.TABELA_FISCAL = TABELA_FISCAL;
window.Impostos = { calcINSS, calcIRRF, calcINSSContrato };

if (typeof module !== 'undefined' && module.exports) module.exports = { TABELA_FISCAL, calcINSS, calcIRRF, calcINSSContrato };
