const SEM_DIREITO_13 = ['pj', 'estagio', 'estágio'];

function isElegivel13(contractType) {
    const ct = String(contractType || 'clt').toLowerCase();
    return !SEM_DIREITO_13.includes(ct);
}

function diffInMonths13(start, end) {
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

function calcAvos13(inicio, fim) {
    let meses = diffInMonths13(inicio, fim) + 1;
    if (fim.getDate() < 15) meses -= 1;
    return Math.max(0, Math.min(12, meses));
}

function calcDecimoTerceiroIntegral({ salario, admissaoISO, anoBase, mediaAdicionaisHabituais = 0 }) {
    const admissao = admissaoISO ? new Date(admissaoISO + 'T00:00:00') : new Date(anoBase, 0, 1);
    const inicioAno = new Date(anoBase, 0, 1);
    const fimAno = new Date(anoBase, 11, 31);
    const inicio = admissao > inicioAno ? admissao : inicioAno;
    const avos = calcAvos13(inicio, fimAno);
    const base = Number(salario || 0) + Number(mediaAdicionaisHabituais || 0);
    const valorIntegral = +((base / 12) * avos).toFixed(2);
    return { avos, valorIntegral };
}

function calcParcela13({ valorIntegral, parcela }) {
    const primeira = +(valorIntegral / 2).toFixed(2);
    if (parcela === 1) return { valor: primeira };
    return { valor: +(valorIntegral - primeira).toFixed(2) };
}

function calcAdiantamentoFerias({ salario, dias, abono = false }) {
    const diaria = Number(salario || 0) / 30;
    const ferias = +(diaria * dias).toFixed(2);
    const tercoFerias = +(ferias / 3).toFixed(2);
    let abonoPecuniario = 0,
        tercoAbono = 0;
    if (abono) {
        abonoPecuniario = +(diaria * 10).toFixed(2);
        tercoAbono = +(abonoPecuniario / 3).toFixed(2);
    }
    const total = +(ferias + tercoFerias + abonoPecuniario + tercoAbono).toFixed(2);
    return { ferias, tercoFerias, abonoPecuniario, tercoAbono, total };
}

window.EventosFolha = {
    isElegivel13,
    calcAvos13,
    calcDecimoTerceiroIntegral,
    calcParcela13,
    calcAdiantamentoFerias,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isElegivel13, calcAvos13, calcDecimoTerceiroIntegral, calcParcela13, calcAdiantamentoFerias };
}
