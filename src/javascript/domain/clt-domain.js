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

    isEstagio(contractType) {
        const t = String(contractType || '').toLowerCase();
        return t === 'estagio' || t === 'estágio';
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

    listarFaltasInjustificadas({ inicio, fim, registros = [], feriados = [], abonadas = [], afastamentos = [], primeiroRegistro = null, workLoad = '' }) {
        if (workLoad === '12x36' || !primeiroRegistro) return [];
        const pad0 = (n) => String(n).padStart(2, '0');
        const key = (d) => `${d.getFullYear()}-${pad0(d.getMonth() + 1)}-${pad0(d.getDate())}`;
        const comEntrada = new Set(registros.filter((r) => r.entrada).map((r) => r.date));
        const naoConta = new Set([...feriados, ...abonadas]);
        const afastado = (k) => afastamentos.some((a) => a.start_date <= k && k <= a.end_date);

        const faltas = [];
        const cursor = new Date(`${inicio}T12:00:00`);
        const ultimo = new Date(`${fim}T12:00:00`);
        for (; cursor <= ultimo; cursor.setDate(cursor.getDate() + 1)) {
            const k = key(cursor);
            const dow = cursor.getDay();
            if (dow === 0 || dow === 6 || k < primeiroRegistro || naoConta.has(k) || comEntrada.has(k) || afastado(k)) continue;
            faltas.push(k);
        }
        return faltas;
    },

    contarFaltasInjustificadas(params) {
        return CLTDomain.listarFaltasInjustificadas(params).length;
    },

    periodoGozoFerias({ start_date, end_date, days }) {
        const inicio = new Date(`${start_date}T12:00:00`);
        const dias = Number(days) || Math.round((new Date(`${end_date}T12:00:00`) - inicio) / 86400000) + 1;
        if (!(dias > 0)) return null;
        const fim = new Date(inicio);
        fim.setDate(fim.getDate() + dias - 1);
        const pad0 = (n) => String(n).padStart(2, '0');
        return { start_date, end_date: `${fim.getFullYear()}-${pad0(fim.getMonth() + 1)}-${pad0(fim.getDate())}`, dias };
    },

    DIAS_ABONO_PECUNIARIO: 10,

    diasConsumidosFerias({ days, abono }) {
        return (Number(days) || 0) + (abono ? CLTDomain.DIAS_ABONO_PECUNIARIO : 0);
    },

    DIAS_MINIMOS_PARA_AVO: 15,

    diasCorridosInclusive(inicio, fim) {
        const a = Date.UTC(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
        const b = Date.UTC(fim.getFullYear(), fim.getMonth(), fim.getDate());
        return Math.round((b - a) / 86400000) + 1;
    },

    avosDecimoTerceiro(inicio, fim) {
        if (!(inicio instanceof Date) || !(fim instanceof Date) || fim < inicio) return 0;
        let avos = 0;
        let mes = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
        while (mes <= fim) {
            const ultimoDoMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
            const de = mes < inicio ? inicio : mes;
            const ate = ultimoDoMes > fim ? fim : ultimoDoMes;
            if (CLTDomain.diasCorridosInclusive(de, ate) >= CLTDomain.DIAS_MINIMOS_PARA_AVO) avos++;
            mes = new Date(mes.getFullYear(), mes.getMonth() + 1, 1);
        }
        return avos;
    },

    avosPeriodoAquisitivo(inicio, fim) {
        if (!(inicio instanceof Date) || !(fim instanceof Date) || fim < inicio) return 0;
        const aniversarioMensal = (n) => new Date(inicio.getFullYear(), inicio.getMonth() + n, inicio.getDate());
        let meses = (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth());
        if (aniversarioMensal(meses) > fim) meses--;
        if (CLTDomain.diasCorridosInclusive(aniversarioMensal(meses), fim) >= CLTDomain.DIAS_MINIMOS_PARA_AVO) meses++;
        return Math.min(12, meses);
    },

    DIAS_VEDADOS_ANTES_DE_FOLGA: 2,

    motivoInicioFeriasVedado(inicioISO, { feriados = [], contractType, workLoad } = {}) {
        if (!inicioISO || CLTDomain.isEstagio(contractType)) return null;
        const [y, m, d] = inicioISO.split('-').map(Number);
        const datasFeriado = new Set(feriados.map((f) => (typeof f === 'string' ? f : f.date)));
        const dsrNoDomingo = workLoad !== '12x36';
        for (let i = 1; i <= CLTDomain.DIAS_VEDADOS_ANTES_DE_FOLGA; i++) {
            const dia = new Date(y, m - 1, d + i);
            const iso = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;
            const ddmm = `${String(dia.getDate()).padStart(2, '0')}/${String(dia.getMonth() + 1).padStart(2, '0')}`;
            if (datasFeriado.has(iso)) return `As férias não podem começar nos 2 dias antes de um feriado (${ddmm}) — art. 134 §3º da CLT.`;
            if (dsrNoDomingo && dia.getDay() === 0)
                return `As férias não podem começar nos 2 dias antes do descanso semanal (domingo, ${ddmm}) — art. 134 §3º da CLT.`;
        }
        return null;
    },

    feriadosQueContam(holidays = []) {
        return holidays.filter((h) => h.abrangencia !== 'facultativo').map((h) => h.date);
    },

    diasGozoNoMes(ferias = [], monthKey) {
        const [y, m] = monthKey.split('-').map(Number);
        const primeiro = new Date(y, m - 1, 1, 12);
        const ultimo = new Date(y, m, 0, 12);
        return ferias.reduce((total, v) => {
            const gozo = CLTDomain.periodoGozoFerias(v);
            if (!gozo) return total;
            const ini = new Date(`${gozo.start_date}T12:00:00`);
            const fim = new Date(`${gozo.end_date}T12:00:00`);
            const a = ini > primeiro ? ini : primeiro;
            const b = fim < ultimo ? fim : ultimo;
            return b < a ? total : total + Math.round((b - a) / 86400000) + 1;
        }, 0);
    },

    diasUteisGozoNoMes(ferias = [], monthKey) {
        const [y, m] = monthKey.split('-').map(Number);
        const dias = new Set();
        ferias.forEach((v) => {
            const gozo = CLTDomain.periodoGozoFerias(v);
            if (!gozo) return;
            const d = new Date(`${gozo.start_date}T12:00:00`);
            const fim = new Date(`${gozo.end_date}T12:00:00`);
            for (; d <= fim; d.setDate(d.getDate() + 1)) {
                if (d.getFullYear() === y && d.getMonth() === m - 1 && d.getDay() !== 0 && d.getDay() !== 6) dias.add(d.getDate());
            }
        });
        return dias.size;
    },

    DIAS_UTEIS_BENEFICIO: 22,

    diasBeneficioNoMes(ferias = [], monthKey) {
        return Math.max(0, CLTDomain.DIAS_UTEIS_BENEFICIO - CLTDomain.diasUteisGozoNoMes(ferias, monthKey));
    },

    diasSalarioNoMes(ferias = [], monthKey) {
        const [y, m] = monthKey.split('-').map(Number);
        const gozo = CLTDomain.diasGozoNoMes(ferias, monthKey);
        if (gozo >= new Date(y, m, 0).getDate()) return 0;
        return Math.max(0, 30 - gozo);
    },

    descontoFaltasDsr({ salario, faltas = [] }) {
        const diaria = Number(salario || 0) / 30;
        const semanas = new Set(faltas.map((d) => CLTDomain.weekStartKey(d))).size;
        return {
            dias: faltas.length,
            semanas,
            valorFaltas: +(diaria * faltas.length).toFixed(2),
            valorDsr: +(diaria * semanas).toFixed(2),
        };
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
