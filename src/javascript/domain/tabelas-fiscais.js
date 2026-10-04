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

    salarioMinimo: { vigencia: '2026-01', valor: 1621.0 },

    irrf: {
        vigencia: '2026-01',
        faixas: [
            { limite: 2428.8, aliquota: 0, deducao: 0 },
            { limite: 2826.65, aliquota: 0.075, deducao: 182.16 },
            { limite: 3751.05, aliquota: 0.15, deducao: 394.16 },
            { limite: 4664.68, aliquota: 0.225, deducao: 675.49 },
            { limite: Infinity, aliquota: 0.275, deducao: 908.73 },
        ],
        deducaoDependente: 189.59,
        descontoSimplificado: 607.2,
        reducao: { isentoAte: 5000, reducaoMaxima: 312.89, faixaAte: 7350, constante: 978.62, fator: 0.133145 },
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

function reducaoIRRF(rendimento, imposto) {
    const r = TABELA_FISCAL.irrf.reducao;
    if (!(rendimento > 0) || !(imposto > 0) || rendimento > r.faixaAte) return 0;
    const reducao = rendimento <= r.isentoAte ? r.reducaoMaxima : r.constante - r.fator * rendimento;
    return +Math.min(imposto, Math.max(0, reducao)).toFixed(2);
}

function calcIRRFMensal({ rendimento, inss = 0, dependentes = 0, pensao = 0 }) {
    const t = TABELA_FISCAL.irrf;
    const bruto = Math.max(0, Number(rendimento) || 0);
    const legais = Math.max(0, Number(inss) || 0) + Math.max(0, parseInt(dependentes, 10) || 0) * t.deducaoDependente + Math.max(0, Number(pensao) || 0);
    const deducao = Math.max(legais, t.descontoSimplificado);
    const imposto = calcIRRF(+(bruto - deducao).toFixed(2));
    return +(imposto - reducaoIRRF(bruto, imposto)).toFixed(2);
}

function calcPensaoAlimenticia({ tipo, valor, rendimento, inss = 0, dependentes = 0 }) {
    const v = Math.max(0, Number(valor) || 0);
    const bruto = Math.max(0, Number(rendimento) || 0);
    const semPensao = calcIRRFMensal({ rendimento: bruto, inss, dependentes });
    if (!v || !bruto) return { pensao: 0, irrf: semPensao };
    if (tipo === 'valor-fixo' || tipo === 'salario-minimo') {
        const pensao = +Math.min(tipo === 'valor-fixo' ? v : (TABELA_FISCAL.salarioMinimo.valor * v) / 100, bruto).toFixed(2);
        return { pensao, irrf: calcIRRFMensal({ rendimento: bruto, inss, dependentes, pensao }) };
    }
    const fator = Math.min(v, 100) / 100;
    let pensao = 0;
    let irrf = semPensao;
    for (let i = 0; i < 50; i++) {
        const proxima = +(fator * Math.max(0, bruto - inss - irrf)).toFixed(2);
        irrf = calcIRRFMensal({ rendimento: bruto, inss, dependentes, pensao: proxima });
        if (Math.abs(proxima - pensao) < 0.01) {
            pensao = proxima;
            break;
        }
        pensao = proxima;
    }
    return { pensao, irrf };
}

function calcINSSContrato(base, contractType) {
    const tipo = String(contractType || '').toLowerCase();
    if (tipo === 'estagio' || tipo === 'estágio' || tipo === 'pj') return 0;
    return calcINSS(base);
}

window.TABELA_FISCAL = TABELA_FISCAL;
window.Impostos = { calcINSS, calcIRRF, calcIRRFMensal, reducaoIRRF, calcINSSContrato, calcPensaoAlimenticia };

if (typeof module !== 'undefined' && module.exports)
    module.exports = { TABELA_FISCAL, calcINSS, calcIRRF, calcIRRFMensal, reducaoIRRF, calcINSSContrato, calcPensaoAlimenticia };
