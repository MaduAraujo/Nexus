const CLTDomain = {
    INTERVALO_INDENIZACAO_MULTIPLICADOR: 1.5,
    ADICIONAL_NOTURNO_PERCENTUAL: 0.2,
    NOTURNO_INICIO_HORA: 22,
    NOTURNO_FIM_HORA: 5,
    ADICIONAL_DOMINGO_FERIADO_PERCENTUAL: 1.0,
    LIMITE_EXTRA_DIARIO_MIN_PADRAO: 120,
    VALE_TRANSPORTE_DESCONTO_MAX_PERCENTUAL: 0.06,
    AVISO_PREVIO_MIN_DIAS: 30,
    AVISO_PREVIO_MAX_DIAS: 90,

    resolveJornadaMin({ contractType, workLoad } = {}) {
        const tipo = (contractType || 'clt').toLowerCase();
        if (tipo === 'pj') return null;
        if (tipo === 'estagio' || tipo === 'estágio' || tipo === 'aprendiz') return 6 * 60;
        const wl = workLoad || '';
        if (wl === '12x36') return 12 * 60;
        const m = wl.match(/^(\d+)h/);
        if (m) return Math.round((parseInt(m[1], 10) / 5) * 60);
        return 8 * 60;
    },

    diasAvisoPrevioIntegral(anosCompletos) {
        return Math.min(CLTDomain.AVISO_PREVIO_MIN_DIAS + 3 * Math.max(0, anosCompletos), CLTDomain.AVISO_PREVIO_MAX_DIAS);
    },

    isFalta(rec) {
        return !rec || !rec.entrada;
    },

    diffMin(a, b) {
        if (!a || !b) return 0;
        return Math.round((new Date(b) - new Date(a)) / 60000);
    },

    calcWorkedMin(rec) {
        if (!rec || !rec.entrada) return 0;
        if (rec.saida_almoco) {
            const morning = CLTDomain.diffMin(rec.entrada, rec.saida_almoco);
            const afternoon = rec.retorno_almoco && rec.saida ? CLTDomain.diffMin(rec.retorno_almoco, rec.saida) : 0;
            return morning + afternoon;
        }
        return rec.saida ? CLTDomain.diffMin(rec.entrada, rec.saida) : 0;
    },

    calcSaldoMin(rec, jornadaMin) {
        if (CLTDomain.isFalta(rec) || !rec.saida || jornadaMin === null) return null;
        return CLTDomain.calcWorkedMin(rec) - jornadaMin;
    },

    getIntervaloMinObrigatorio(jornadaMin) {
        if (jornadaMin === null) return 0;
        if (jornadaMin > 6 * 60) return 60;
        if (jornadaMin > 4 * 60) return 15;
        return 0;
    },

    calcIntervaloDeficitMin(rec, jornadaMin) {
        if (CLTDomain.isFalta(rec) || !rec.saida) return 0;
        const obrigatorio = CLTDomain.getIntervaloMinObrigatorio(jornadaMin);
        if (obrigatorio <= 0) return 0;
        const realizado = rec.saida_almoco && rec.retorno_almoco ? CLTDomain.diffMin(rec.saida_almoco, rec.retorno_almoco) : 0;
        return Math.max(0, obrigatorio - realizado);
    },

    isSunday(dateKey) {
        return new Date(`${dateKey}T12:00:00`).getDay() === 0;
    },

    weekStartKey(dateKey) {
        const d = new Date(`${dateKey}T12:00:00`);
        const dow = d.getDay();
        d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
        const pad0 = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad0(d.getMonth() + 1)}-${pad0(d.getDate())}`;
    },

    nightOverlapMin(start, end) {
        let total = 0;
        const cursor = new Date(start);
        cursor.setHours(0, 0, 0, 0);
        cursor.setDate(cursor.getDate() - 1);
        while (cursor <= end) {
            const winStart = new Date(cursor);
            winStart.setHours(CLTDomain.NOTURNO_INICIO_HORA, 0, 0, 0);
            const winEnd = new Date(winStart);
            winEnd.setDate(winEnd.getDate() + 1);
            winEnd.setHours(CLTDomain.NOTURNO_FIM_HORA, 0, 0, 0);
            const ovStart = start > winStart ? start : winStart;
            const ovEnd = end < winEnd ? end : winEnd;
            if (ovEnd > ovStart) total += Math.round((ovEnd - ovStart) / 60000);
            cursor.setDate(cursor.getDate() + 1);
        }
        return total;
    },

    workSegments(rec) {
        const segs = [];
        if (rec.entrada && rec.saida_almoco) segs.push([new Date(rec.entrada), new Date(rec.saida_almoco)]);
        if (rec.retorno_almoco && rec.saida) segs.push([new Date(rec.retorno_almoco), new Date(rec.saida)]);
        if (!rec.saida_almoco && rec.entrada && rec.saida) segs.push([new Date(rec.entrada), new Date(rec.saida)]);
        return segs;
    },

    isNoturno(rec) {
        return CLTDomain.workSegments(rec).some(([s, e]) => CLTDomain.nightOverlapMin(s, e) > 0);
    },

    getDivisorHoraMensal(jornadaMin, workLoad) {
        if (!jornadaMin) return 220;
        if (workLoad === '12x36') return 220;
        const horasSemanais = (jornadaMin / 60) * 5;
        return Math.round(horasSemanais * 5);
    },

    nextMonthKey(monthKey) {
        const [y, m] = monthKey.split('-').map(Number);
        const next = new Date(y, m, 1);
        const pad0 = (n) => String(n).padStart(2, '0');
        return `${next.getFullYear()}-${pad0(next.getMonth() + 1)}-01`;
    },

    computeBankLedgerStatus(monthlyNet, vencimentoMeses, hoje = new Date()) {
        const keys = Object.keys(monthlyNet).sort();
        const queue = [];
        keys.forEach((mk) => {
            const net = monthlyNet[mk];
            if (net > 0) {
                queue.push({ mk, remaining: net });
            } else if (net < 0) {
                let debt = -net;
                while (debt > 0 && queue.length) {
                    const oldest = queue[0];
                    const consumed = Math.min(oldest.remaining, debt);
                    oldest.remaining -= consumed;
                    debt -= consumed;
                    if (oldest.remaining <= 0) queue.shift();
                }
            }
        });

        if (!queue.length) {
            return { status: 'ok', minutosVencendo: 0, minutosVencidos: 0, proxExpira: null };
        }

        let minutosVencendo = 0,
            minutosVencidos = 0,
            pior = 'ok',
            proxExpira = null;
        queue.forEach((bucket) => {
            const [y, m] = bucket.mk.split('-').map(Number);
            const expira = new Date(y, m - 1 + vencimentoMeses, 1);
            const diasRestantes = Math.round((expira - hoje) / 86400000);
            if (diasRestantes < 0) {
                minutosVencidos += bucket.remaining;
                pior = 'vencido';
            } else if (diasRestantes <= 30) {
                minutosVencendo += bucket.remaining;
                if (pior !== 'vencido') pior = 'atencao';
            }
            if (proxExpira === null || expira < proxExpira) proxExpira = expira;
        });
        return { status: pior, minutosVencendo, minutosVencidos, proxExpira };
    },
};

window.CLTDomain = CLTDomain;

if (typeof module !== 'undefined' && module.exports) module.exports = { CLTDomain };
