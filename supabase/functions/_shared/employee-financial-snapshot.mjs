// Cálculos de banco de horas e férias usados pelo assistente de IA do colaborador (ai-employee-chat)
// para responder com números reais em vez de estimativa alucinada. Puro — sem chamada de rede, sem
// Deno.* — testável a partir do Node. `getJornadaMin`/`calcWorkedMin` duplicam de propósito a mesma
// lógica de equipe-colaborador.js (getJornadaMin/calcWorkedMinEquipe): um lado é front-end (browser),
// o outro Edge Function (Deno) — unificar exigiria um módulo importável nos dois runtimes, fora do
// escopo desta extração.

export function getJornadaMin(emp) {
    const tipo = String(emp?.contract_type || 'clt').toLowerCase();
    if (tipo === 'pj') return null;
    if (tipo === 'estagio' || tipo === 'estágio' || tipo === 'aprendiz') return 6 * 60;
    const workLoad = emp?.work_load || '';
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

// Banco de horas por competência (mês), consumindo o saldo mais antigo primeiro (FIFO) — é assim que
// se decide quanto já venceu (passou do prazo sem ser compensado) e quanto vence nos próximos 30 dias.
// `hoje` é injetável para o teste ser determinístico.
export function calcBancoHorasLedger(records, adjustments, jornadaMin, vencimentoMeses, hoje = new Date()) {
    if (jornadaMin === null) return { saldoMin: 0, proximoVencimento: null, minutosVencendo: 0, minutosVencidos: 0 };

    const byMonth = {};
    for (const r of records) {
        if (!r.entrada || !r.saida) continue;
        const s = calcWorkedMin(r) - jornadaMin;
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

// Período aquisitivo de férias atual (CLT, art. 130): ciclo de 1 ano a partir da admissão, avançando
// ano a ano até conter a data de hoje.
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

// Estimativa simplificada de saldo de férias: 30 dias por período aquisitivo completo (12 meses),
// menos os dias já usufruídos (abono pecuniário desconta 10 dias do total gozado). Não desconta faltas
// injustificadas — por isso o assistente sempre avisa que é aproximado (ver buildSystem no index.ts).
export function calcFeriasSnapshot(emp, vacations, today = new Date()) {
    if (!emp.admission_date) return null;
    const admDate = new Date(emp.admission_date + 'T00:00:00');
    const months = monthsDiff(admDate, today);
    const periods = Math.floor(months / 12);
    const earned = periods * 30;
    const taken = vacations.filter((v) => v.status === 'aprovado' || v.status === 'concluido').reduce((s, v) => s + v.days - (v.abono ? 10 : 0), 0);
    const saldoEstimado = Math.max(0, earned - taken);
    const period = calcAcquisitivePeriod(admDate, today);
    const diasRestantesCiclo = Math.ceil((period.end.getTime() - today.getTime()) / 86400000);
    return {
        saldo_estimado_dias: saldoEstimado,
        periodo_aquisitivo_atual: { inicio: period.start.toISOString().slice(0, 10), fim: period.end.toISOString().slice(0, 10) },
        dias_restantes_no_ciclo_atual: diasRestantesCiclo,
    };
}
