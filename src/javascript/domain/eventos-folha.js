const SEM_DIREITO_13 = ['pj', 'estagio', 'estágio'];

function isElegivel13(contractType) {
    const ct = String(contractType || 'clt').toLowerCase();
    return !SEM_DIREITO_13.includes(ct);
}

function calcAvos13(inicio, fim) {
    return Math.min(12, CLTDomain.avosDecimoTerceiro(inicio, fim));
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

const SEM_RECIBO_FERIAS = ['pj', 'estagio', 'estágio'];

function proventosFerias({ contractType, salario, startDate, dias, abono }) {
    if (SEM_RECIBO_FERIAS.includes(String(contractType || 'clt').toLowerCase()) || !Number(salario)) return null;
    const diasDescanso = Number(dias) || 0;
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

const DIAS_ANTECEDENCIA_PAGAMENTO_FERIAS = 2;
const pad2 = (n) => String(n).padStart(2, '0');

function mesReciboFerias(startDate) {
    return `${startDate.slice(0, 7)}-F${startDate.slice(8, 10)}`;
}

function inicioDoReciboFerias(mes) {
    const m = /^(\d{4}-\d{2})-F(\d{2})$/.exec(mes || '');
    return m ? `${m[1]}-${m[2]}` : null;
}

function pagarFeriasAte(startDate) {
    const d = new Date(`${startDate}T12:00:00`);
    d.setDate(d.getDate() - DIAS_ANTECEDENCIA_PAGAMENTO_FERIAS);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function diasPorCompetencia(startDate, dias) {
    const out = {};
    const d = new Date(`${startDate}T12:00:00`);
    for (let i = 0; i < dias; i++, d.setDate(d.getDate() + 1)) {
        const k = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
        out[k] = (out[k] || 0) + 1;
    }
    return out;
}

function reciboFerias({ contractType, salario, startDate, dias, abono }) {
    const evento = proventosFerias({ contractType, salario, startDate, dias, abono });
    if (!evento) return null;
    const { calcIRRF, calcINSSContrato } = window.Impostos;
    const base = +evento.proventos
        .filter((p) => p.cod === '040' || p.cod === '041')
        .reduce((s, p) => s + p.valor, 0)
        .toFixed(2);
    const aprendiz = String(contractType || '').toLowerCase() === 'aprendiz';
    const porMes = diasPorCompetencia(startDate, Number(dias) || 0);
    const meses = Object.keys(porMes).sort();
    const descontos = [];
    let inss = 0,
        baseDistribuida = 0;
    meses.forEach((mes, i) => {
        const baseMes = i === meses.length - 1 ? +(base - baseDistribuida).toFixed(2) : +((base * porMes[mes]) / Number(dias)).toFixed(2);
        baseDistribuida = +(baseDistribuida + baseMes).toFixed(2);
        const inssMes = calcINSSContrato(baseMes, contractType);
        inss = +(inss + inssMes).toFixed(2);
        if (inssMes > 0) {
            const [ano, mm] = mes.split('-');
            descontos.push({
                cod: '901',
                descricao: meses.length > 1 ? `INSS sobre férias — competência ${mm}/${ano}` : 'INSS sobre férias',
                referencia: `${porMes[mes]} dias`,
                valor: inssMes,
                competencia: mes,
                base: baseMes,
            });
        }
    });
    const irrf = aprendiz ? 0 : calcIRRF(base - inss);
    if (irrf > 0) descontos.push({ cod: '906', descricao: 'IRRF sobre férias', referencia: 'Tabela', valor: irrf });
    const totalProventos = +evento.proventos.reduce((s, p) => s + p.valor, 0).toFixed(2);
    const totalDescontos = +descontos.reduce((s, d) => s + d.valor, 0).toFixed(2);
    const [y, m, d] = startDate.split('-');
    return {
        mes: mesReciboFerias(startDate),
        mesFormatado: `Recibo de Férias — gozo a partir de ${d}/${m}/${y}`,
        competencia: evento.competencia,
        pagarAte: pagarFeriasAte(startDate),
        proventos: evento.proventos,
        descontos,
        totalProventos,
        totalDescontos,
        liquido: +(totalProventos - totalDescontos).toFixed(2),
    };
}

window.EventosFolha = {
    isElegivel13,
    calcAvos13,
    calcDecimoTerceiroIntegral,
    calcParcela13,
    calcAdiantamentoFerias,
    proventosFerias,
    reciboFerias,
    mesReciboFerias,
    inicioDoReciboFerias,
    pagarFeriasAte,
    diasPorCompetencia,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        isElegivel13,
        calcAvos13,
        calcDecimoTerceiroIntegral,
        calcParcela13,
        calcAdiantamentoFerias,
        proventosFerias,
        reciboFerias,
        mesReciboFerias,
        inicioDoReciboFerias,
        pagarFeriasAte,
        diasPorCompetencia,
    };
}
