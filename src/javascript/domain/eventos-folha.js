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

const MESES_FOLHA = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function proventosFerias({ contractType, salario, startDate, dias, abono }) {
    if (String(contractType || 'clt').toLowerCase() === 'pj' || !Number(salario)) return null;
    const diasDescanso = abono ? Math.max(0, dias - 10) : dias;
    const r = calcAdiantamentoFerias({ salario: Number(salario), dias: diasDescanso, abono: !!abono });
    if (r.total <= 0) return null;
    const proventos = [
        { cod: '040', descricao: 'Adiantamento de Férias', referencia: `${diasDescanso} dias`, valor: r.ferias },
        { cod: '041', descricao: '1/3 Constitucional de Férias', referencia: '—', valor: r.tercoFerias },
    ];
    if (r.abonoPecuniario > 0) {
        proventos.push({ cod: '042', descricao: 'Abono Pecuniário (venda de férias)', referencia: '10 dias', valor: r.abonoPecuniario });
        proventos.push({ cod: '043', descricao: '1/3 sobre Abono Pecuniário', referencia: '—', valor: r.tercoAbono });
    }
    const [year, monthNum] = startDate.slice(0, 7).split('-');
    const month = parseInt(monthNum, 10);
    return {
        mes: `${year}-${monthNum}`,
        mesFormatado: `${MESES_FOLHA[month - 1]} ${year}`,
        competencia: `${monthNum}/${year}`,
        proventos,
    };
}

window.EventosFolha = {
    isElegivel13,
    calcAvos13,
    calcDecimoTerceiroIntegral,
    calcParcela13,
    calcAdiantamentoFerias,
    proventosFerias,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { isElegivel13, calcAvos13, calcDecimoTerceiroIntegral, calcParcela13, calcAdiantamentoFerias, proventosFerias };
}
