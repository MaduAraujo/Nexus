export function getJornadaMin(emp) {
    const tipo = String(emp?.contract_type || 'clt').toLowerCase();
    if (tipo === 'pj') return null;
    const workLoad = emp?.work_load || '';
    if (tipo === 'estagio' || tipo === 'estágio') return { '20h': 4 * 60, '30h': 6 * 60, '40h': 8 * 60 }[workLoad] ?? 6 * 60;
    if (tipo === 'aprendiz') {
        const semanal = workLoad.match(/^(\d+)h/);
        return semanal ? Math.min(Math.round((parseInt(semanal[1], 10) / 5) * 60), 8 * 60) : 6 * 60;
    }
    if (workLoad === '12x36') return 12 * 60;
    const m = workLoad.match(/^(\d+)h/);
    if (m) return Math.round((parseInt(m[1], 10) / 5) * 60);
    return 8 * 60;
}

function diffMin(a, b) {
    return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export function calcWorkedMin(rec) {
    if (!rec?.entrada) return 0;
    if (rec.saida_almoco) {
        const morning = diffMin(rec.entrada, rec.saida_almoco);
        const afternoon = rec.retorno_almoco && rec.saida ? diffMin(rec.retorno_almoco, rec.saida) : 0;
        return morning + afternoon;
    }
    return rec.saida ? diffMin(rec.entrada, rec.saida) : 0;
}

function isEstagio(emp) {
    const tipo = String(emp?.contract_type || '').toLowerCase();
    return tipo === 'estagio' || tipo === 'estágio';
}

export function jornadaNoDia(jornadaMin, dataISO, emp) {
    if (jornadaMin === null || !isEstagio(emp) || !dataISO || !Array.isArray(emp?.estagio_avaliacoes)) return jornadaMin;
    const dia = String(dataISO).slice(0, 10);
    const emProvas = emp.estagio_avaliacoes.some((p) => p?.inicio && p?.fim && p.inicio <= dia && dia <= p.fim);
    return emProvas ? Math.round(jornadaMin / 2) : jornadaMin;
}

export function calcBancoHorasLedger(records, adjustments, jornadaMin, vencimentoMeses, hoje = new Date(), emp) {
    if (jornadaMin === null) return { saldoMin: 0, proximoVencimento: null, minutosVencendo: 0, minutosVencidos: 0 };

    const byMonth = {};
    for (const r of records) {
        if (!r.entrada || !r.saida) continue;
        const s = calcWorkedMin(r) - jornadaNoDia(jornadaMin, r.date, emp);
        const mk = r.date.slice(0, 7);
        byMonth[mk] = (byMonth[mk] || 0) + s;
    }
    for (const a of adjustments) {
        const mk = a.date.slice(0, 7);
        const delta = a.tipo === 'credito' ? a.minutos : -a.minutos;
        byMonth[mk] = (byMonth[mk] || 0) + delta;
    }

    const keys = Object.keys(byMonth).sort();
    const queue = [];
    let saldoMin = 0;
    for (const mk of keys) {
        const net = byMonth[mk];
        saldoMin += net;
        if (net > 0) queue.push({ mk, remaining: net });
        else if (net < 0) {
            let debt = -net;
            while (debt > 0 && queue.length) {
                const oldest = queue[0];
                const consumed = Math.min(oldest.remaining, debt);
                oldest.remaining -= consumed;
                debt -= consumed;
                if (oldest.remaining <= 0) queue.shift();
            }
        }
    }

    let minutosVencendo = 0,
        minutosVencidos = 0,
        proximoVencimento = null;
    let proxExpiraDate = null;
    for (const bucket of queue) {
        const [y, m] = bucket.mk.split('-').map(Number);
        const expira = new Date(y, m - 1 + vencimentoMeses, 1);
        const diasRestantes = Math.round((expira.getTime() - hoje.getTime()) / 86400000);
        if (diasRestantes < 0) minutosVencidos += bucket.remaining;
        else if (diasRestantes <= 30) minutosVencendo += bucket.remaining;
        if (proxExpiraDate === null || expira < proxExpiraDate) proxExpiraDate = expira;
    }
    if (proxExpiraDate) proximoVencimento = proxExpiraDate.toISOString().slice(0, 10);

    return { saldoMin, proximoVencimento, minutosVencendo, minutosVencidos };
}

export function calcAcquisitivePeriod(admDate, today) {
    const start = new Date(admDate);
    while (new Date(start.getFullYear() + 1, start.getMonth(), start.getDate()) <= today) {
        start.setFullYear(start.getFullYear() + 1);
    }
    const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
    return { start, end };
}

export function monthsDiff(a, b) {
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function calcFeriasSnapshot(emp, vacations, today = new Date()) {
    if (!emp.admission_date) return null;
    const admDate = new Date(emp.admission_date + 'T00:00:00');
    const months = monthsDiff(admDate, today);
    const periods = Math.floor(months / 12);
    const mesesCompletos = Math.max(0, months - (today.getDate() < admDate.getDate() ? 1 : 0));
    const earned = isEstagio(emp) ? Math.floor((mesesCompletos * 30) / 12) : periods * 30;
    const taken = vacations.filter((v) => v.status === 'aprovado' || v.status === 'concluido').reduce((s, v) => s + v.days, 0);
    const saldoEstimado = Math.max(0, earned - taken);
    const period = calcAcquisitivePeriod(admDate, today);
    const diasRestantesCiclo = Math.ceil((period.end.getTime() - today.getTime()) / 86400000);
    return {
        saldo_estimado_dias: saldoEstimado,
        periodo_aquisitivo_atual: { inicio: period.start.toISOString().slice(0, 10), fim: period.end.toISOString().slice(0, 10) },
        dias_restantes_no_ciclo_atual: diasRestantesCiclo,
    };
}
