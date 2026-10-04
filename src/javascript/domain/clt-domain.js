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
    ADICIONAL_HORA_EXTRA_PERCENTUAL: 0.5,
    PERICULOSIDADE_PERCENTUAL: 0.3,
    INSALUBRIDADE_PERCENTUAL: { minimo: 0.1, medio: 0.2, maximo: 0.4 },
    PRAZO_PAGAMENTO_RESCISAO_DIAS: 10,
    DIAS_AVISO_EMPREGADO: 30,

    resolveJornadaMin({ contractType, workLoad } = {}) {
        const tipo = (contractType || 'clt').toLowerCase();
        if (tipo === 'pj') return null;
        const wl = workLoad || '';
        if (tipo === 'estagio' || tipo === 'estágio') return CLTDomain.ESTAGIO_JORNADA_MIN[wl] ?? 6 * 60;
        if (tipo === 'aprendiz') {
            const semanal = wl.match(/^(\d+)h/);
            if (!semanal) return CLTDomain.APRENDIZ_JORNADA_MAX_MIN;
            return Math.min(Math.round((parseInt(semanal[1], 10) / 5) * 60), CLTDomain.APRENDIZ_JORNADA_MAX_FUNDAMENTAL_MIN);
        }
        if (wl === '12x36') return 12 * 60;
        const m = wl.match(/^(\d+)h/);
        if (m) return Math.round((parseInt(m[1], 10) / 5) * 60);
        return 8 * 60;
    },

    ESTAGIO_JORNADA_MIN: { '20h': 4 * 60, '30h': 6 * 60, '40h': 8 * 60 },

    estagioEmProvas(dataISO, avaliacoes) {
        if (!dataISO || !Array.isArray(avaliacoes)) return false;
        const dia = String(dataISO).slice(0, 10);
        return avaliacoes.some((p) => p?.inicio && p?.fim && p.inicio <= dia && dia <= p.fim);
    },

    jornadaNoDia(jornadaMin, dataISO, { contractType, avaliacoes } = {}) {
        if (jornadaMin === null || jornadaMin === undefined) return jornadaMin;
        if (!CLTDomain.isEstagio(contractType) || !CLTDomain.estagioEmProvas(dataISO, avaliacoes)) return jornadaMin;
        return Math.round(jornadaMin / 2);
    },

    APRENDIZ_IDADE_MIN: 14,
    APRENDIZ_IDADE_MAX: 24,
    APRENDIZ_PRAZO_MAX_ANOS: 2,
    APRENDIZ_JORNADA_MAX_MIN: 6 * 60,
    APRENDIZ_JORNADA_MAX_FUNDAMENTAL_MIN: 8 * 60,
    MAIORIDADE: 18,
    TOLERANCIA_MARCACAO_DIARIA_MIN: 10,
    FGTS_ALIQUOTA: 0.08,
    FGTS_ALIQUOTA_APRENDIZ: 0.02,

    aliquotaFGTS(contractType) {
        if (CLTDomain.isEstagio(contractType) || CLTDomain.isPJ(contractType)) return 0;
        return CLTDomain.isAprendiz(contractType) ? CLTDomain.FGTS_ALIQUOTA_APRENDIZ : CLTDomain.FGTS_ALIQUOTA;
    },

    isAprendiz(contractType) {
        return String(contractType || '').toLowerCase() === 'aprendiz';
    },

    limiteExtraDiarioMin(contractType, padrao = CLTDomain.LIMITE_EXTRA_DIARIO_MIN_PADRAO) {
        return CLTDomain.isAprendiz(contractType) ? CLTDomain.TOLERANCIA_MARCACAO_DIARIA_MIN : padrao;
    },

    idadeEm(nascimentoISO, dataISO) {
        if (!nascimentoISO || !dataISO) return null;
        const [ny, nm, nd] = String(nascimentoISO).slice(0, 10).split('-').map(Number);
        const [dy, dm, dd] = String(dataISO).slice(0, 10).split('-').map(Number);
        if (!ny || !dy) return null;
        return dy - ny - (dm < nm || (dm === nm && dd < nd) ? 1 : 0);
    },

    somaAnosISO(dataISO, anos) {
        const [y, m, d] = String(dataISO).slice(0, 10).split('-').map(Number);
        const alvo = new Date(y + anos, m - 1, d);
        if (alvo.getMonth() !== m - 1) alvo.setDate(0);
        const pad0 = (n) => String(n).padStart(2, '0');
        return `${alvo.getFullYear()}-${pad0(alvo.getMonth() + 1)}-${pad0(alvo.getDate())}`;
    },

    APRENDIZ_COTA_BASE_MINIMA: 7,
    APRENDIZ_COTA_MIN_PERCENTUAL: 0.05,
    APRENDIZ_COTA_MAX_PERCENTUAL: 0.15,

    cotaAprendiz(base) {
        const n = Math.max(0, Number(base) || 0);
        if (n < CLTDomain.APRENDIZ_COTA_BASE_MINIMA) return { obrigatoria: false, minimo: 0, maximo: Math.floor(n * CLTDomain.APRENDIZ_COTA_MAX_PERCENTUAL) };
        return {
            obrigatoria: true,
            minimo: Math.ceil(+(n * CLTDomain.APRENDIZ_COTA_MIN_PERCENTUAL).toFixed(6)),
            maximo: Math.floor(+(n * CLTDomain.APRENDIZ_COTA_MAX_PERCENTUAL).toFixed(6)),
        };
    },

    salarioMinimoAprendiz({ salarioMinimo, workLoad }) {
        const jornadaMin = CLTDomain.resolveJornadaMin({ contractType: 'aprendiz', workLoad });
        return +((salarioMinimo / 220) * CLTDomain.getDivisorHoraMensal(jornadaMin, workLoad)).toFixed(2);
    },

    validarAprendiz({ birthDate, admissionDate, contractEndDate, pcd = false, workLoad, fundamentalCompleto = false, salary, salarioMinimo } = {}) {
        const erros = [];
        const idade = CLTDomain.idadeEm(birthDate, admissionDate);
        if (!birthDate) erros.push('Informe a data de nascimento do aprendiz (CLT art. 428).');
        else if (idade !== null && idade < CLTDomain.APRENDIZ_IDADE_MIN) erros.push('O aprendiz precisa ter pelo menos 14 anos na admissão (CLT art. 428).');
        else if (idade !== null && idade >= CLTDomain.APRENDIZ_IDADE_MAX && !pcd)
            erros.push('O aprendiz precisa ter menos de 24 anos na admissão, salvo pessoa com deficiência (CLT art. 428 §5º).');
        if (!contractEndDate) erros.push('Informe a data de término do contrato de aprendizagem (CLT art. 428).');
        else if (admissionDate) {
            if (contractEndDate <= admissionDate) erros.push('O término do contrato de aprendizagem deve ser depois da admissão.');
            else if (!pcd && contractEndDate > CLTDomain.somaAnosISO(admissionDate, CLTDomain.APRENDIZ_PRAZO_MAX_ANOS))
                erros.push('O contrato de aprendizagem não pode passar de 2 anos, salvo pessoa com deficiência (CLT art. 428 §3º).');
            if (!pcd && birthDate && contractEndDate >= CLTDomain.somaAnosISO(birthDate, CLTDomain.APRENDIZ_IDADE_MAX))
                erros.push('O contrato termina depois de o aprendiz completar 24 anos — ajuste o término (CLT art. 433).');
        }
        const wl = workLoad || '';
        const semanal = wl.match(/^(\d+)h/);
        const jornadaDiaria = semanal ? (parseInt(semanal[1], 10) / 5) * 60 : null;
        const teto = fundamentalCompleto ? CLTDomain.APRENDIZ_JORNADA_MAX_FUNDAMENTAL_MIN : CLTDomain.APRENDIZ_JORNADA_MAX_MIN;
        if (wl === '12x36' || (jornadaDiaria !== null && jornadaDiaria > teto))
            erros.push(
                fundamentalCompleto
                    ? 'A jornada do aprendiz não pode passar de 8 horas por dia, já contando as aulas teóricas (CLT art. 432 §1º).'
                    : 'A jornada do aprendiz não pode passar de 6 horas por dia; até 8 horas só para quem já concluiu o ensino fundamental (CLT art. 432).'
            );
        if (salarioMinimo > 0 && Number(salary) > 0) {
            const piso = CLTDomain.salarioMinimoAprendiz({ salarioMinimo, workLoad: wl });
            if (Number(salary) < piso)
                erros.push(
                    `O salário do aprendiz não pode ser menor que o salário mínimo hora proporcional à jornada (R$ ${piso.toFixed(2).replace('.', ',')}) — CLT art. 428 §2º.`
                );
        }
        return erros;
    },

    isEstagio(contractType) {
        const t = String(contractType || '').toLowerCase();
        return t === 'estagio' || t === 'estágio';
    },

    isPJ(contractType) {
        return String(contractType || '').toLowerCase() === 'pj';
    },

    TEMPORARIO_PRAZO_MAX_DIAS: 270,
    TEMPORARIO_INTERVALO_RECONTRATACAO_DIAS: 90,
    PRAZO_DETERMINADO_MAX_ANOS: 2,
    PRAZO_DETERMINADO_INTERVALO_RECONTRATACAO_MESES: 6,

    isTemporario(contractType) {
        const t = String(contractType || '').toLowerCase();
        return t === 'temporário' || t === 'temporario';
    },

    isPrazoDeterminado(contractType) {
        return String(contractType || '').toLowerCase() === 'prazo determinado';
    },

    temTerminoContrato(contractType) {
        return (
            CLTDomain.isEstagio(contractType) ||
            CLTDomain.isAprendiz(contractType) ||
            CLTDomain.isTemporario(contractType) ||
            CLTDomain.isPrazoDeterminado(contractType)
        );
    },

    validarContratoAPrazo({ contractType, admissionDate, contractEndDate, isProbation = false } = {}) {
        const temporario = CLTDomain.isTemporario(contractType);
        if (!temporario && !CLTDomain.isPrazoDeterminado(contractType)) return null;
        if (isProbation) {
            return temporario
                ? 'O contrato temporário não admite contrato de experiência (Lei 6.019/1974, art. 10 §4º).'
                : 'O contrato de experiência já é um contrato por prazo determinado (CLT art. 443 §2º, c): cadastre como CLT com experiência ou como prazo determinado sem experiência.';
        }
        if (!contractEndDate) {
            return temporario
                ? 'Informe a data de término do contrato temporário (Lei 6.019/1974, art. 10).'
                : 'Informe a data de término do contrato por prazo determinado (CLT art. 443).';
        }
        if (!admissionDate) return null;
        if (contractEndDate <= admissionDate) return 'O término do contrato deve ser depois da admissão.';
        if (temporario) {
            const [ay, am, ad] = admissionDate.split('-').map(Number);
            const [ey, em, ed] = contractEndDate.split('-').map(Number);
            const dias = CLTDomain.diasCorridosInclusive(new Date(ay, am - 1, ad), new Date(ey, em - 1, ed));
            if (dias > CLTDomain.TEMPORARIO_PRAZO_MAX_DIAS)
                return 'O contrato temporário não pode passar de 180 dias, mais 90 de prorrogação: 270 dias no total (Lei 6.019/1974, art. 10 §§1º e 2º).';
            return null;
        }
        if (contractEndDate > CLTDomain.somaAnosISO(admissionDate, CLTDomain.PRAZO_DETERMINADO_MAX_ANOS))
            return 'O contrato por prazo determinado não pode passar de 2 anos (CLT art. 445).';
        return null;
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
        if (CLTDomain.isFalta(rec) || !rec.saida || jornadaMin === null) return 0;
        const obrigatorio = CLTDomain.getIntervaloMinObrigatorio(Math.max(jornadaMin, CLTDomain.calcWorkedMin(rec)));
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

    noturnoMinRegistro(rec) {
        const segs = CLTDomain.workSegments(rec);
        const noturno = segs.reduce((t, [a, b]) => t + CLTDomain.nightOverlapMin(a, b), 0);
        const trabalhado = segs.reduce((t, [a, b]) => t + Math.max(0, Math.round((b - a) / 60000)), 0);
        if (noturno <= 0 || noturno * 2 < trabalhado) return noturno;
        const ultimoFim = segs[segs.length - 1][1];
        const corte = new Date(ultimoFim);
        corte.setHours(CLTDomain.NOTURNO_FIM_HORA, 0, 0, 0);
        if (corte > ultimoFim) corte.setDate(corte.getDate() - 1);
        const inicioJanela = new Date(corte);
        inicioJanela.setDate(inicioJanela.getDate() - 1);
        inicioJanela.setHours(CLTDomain.NOTURNO_INICIO_HORA, 0, 0, 0);
        if (!segs.some(([a, b]) => a < corte && b > inicioJanela)) return noturno;
        const limite = new Date(corte);
        limite.setHours(CLTDomain.NOTURNO_INICIO_HORA, 0, 0, 0);
        const prorrogacao = segs.reduce((t, [a, b]) => {
            const ini = a > corte ? a : corte;
            const fim = b < limite ? b : limite;
            return fim > ini ? t + Math.round((fim - ini) / 60000) : t;
        }, 0);
        return noturno + prorrogacao;
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
        if (!inicioISO || CLTDomain.isEstagio(contractType) || CLTDomain.isPJ(contractType)) return null;
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

    bankBuckets(monthlyNet) {
        const queue = [];
        Object.keys(monthlyNet)
            .sort()
            .forEach((mk) => {
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
        return queue;
    },

    expiraBucket(mk, vencimentoMeses) {
        const [y, m] = mk.split('-').map(Number);
        return new Date(y, m - 1 + vencimentoMeses, 1);
    },

    bucketsVencidosNoMes(monthlyNet, vencimentoMeses, monthKey) {
        const [y, m] = monthKey.split('-').map(Number);
        const fimDoMes = new Date(y, m, 0, 12);
        return CLTDomain.bankBuckets(monthlyNet)
            .filter((b) => b.mk <= monthKey && CLTDomain.expiraBucket(b.mk, vencimentoMeses) <= fimDoMes)
            .map((b) => ({ mk: b.mk, minutos: b.remaining }));
    },

    computeBankLedgerStatus(monthlyNet, vencimentoMeses, hoje = new Date()) {
        const queue = CLTDomain.bankBuckets(monthlyNet);
        if (!queue.length) {
            return { status: 'ok', minutosVencendo: 0, minutosVencidos: 0, proxExpira: null };
        }

        let minutosVencendo = 0,
            minutosVencidos = 0,
            pior = 'ok',
            proxExpira = null;
        queue.forEach((bucket) => {
            const expira = CLTDomain.expiraBucket(bucket.mk, vencimentoMeses);
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

    adicionalRisco({ salario, periculosidade = false, grauInsalubridade = null, salarioMinimo = 0 } = {}) {
        const peric = periculosidade ? +(Number(salario || 0) * CLTDomain.PERICULOSIDADE_PERCENTUAL).toFixed(2) : 0;
        const pctInsal = CLTDomain.INSALUBRIDADE_PERCENTUAL[grauInsalubridade] || 0;
        const insal = +(Number(salarioMinimo || 0) * pctInsal).toFixed(2);
        if (peric <= 0 && insal <= 0) return null;
        if (peric >= insal)
            return {
                tipo: 'periculosidade',
                cod: '023',
                percentual: CLTDomain.PERICULOSIDADE_PERCENTUAL,
                valor: peric,
                descricao: 'Adicional de Periculosidade (30% do salário — CLT art. 193 §1º)',
            };
        return {
            tipo: 'insalubridade',
            cod: '024',
            percentual: pctInsal,
            valor: insal,
            descricao: `Adicional de Insalubridade (${Math.round(pctInsal * 100)}% do salário mínimo — CLT art. 192)`,
        };
    },

    diasUteisEDescansoNoMes(monthKey, feriados = []) {
        const [y, m] = monthKey.split('-').map(Number);
        const datas = new Set(feriados);
        const pad0 = (n) => String(n).padStart(2, '0');
        let uteis = 0,
            descanso = 0;
        for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
            if (new Date(y, m - 1, d).getDay() === 0 || datas.has(`${y}-${pad0(m)}-${pad0(d)}`)) descanso++;
            else uteis++;
        }
        return { uteis, descanso };
    },

    reflexoDsr(valorVariaveis, monthKey, feriados = []) {
        if (!(valorVariaveis > 0)) return 0;
        const { uteis, descanso } = CLTDomain.diasUteisEDescansoNoMes(monthKey, feriados);
        return +((valorVariaveis / uteis) * descanso).toFixed(2);
    },

    MOTIVOS_ESTABILIDADE: {
        gestante: 'Gestante — da confirmação da gravidez até 5 meses após o parto (ADCT art. 10, II, b)',
        acidente_trabalho: 'Acidente de trabalho — 12 meses após o fim do auxílio-doença acidentário (Lei 8.213/91 art. 118)',
        cipa: 'Membro eleito da CIPA — da candidatura até 1 ano após o fim do mandato (ADCT art. 10, II, a)',
        dirigente_sindical: 'Dirigente sindical — da candidatura até 1 ano após o fim do mandato (CLT art. 543 §3º)',
        outra: 'Outra garantia de emprego (convenção coletiva ou acordo)',
    },

    TIPOS_DISPENSA_SEM_JUSTA_CAUSA: ['sem_justa_causa', 'acordo_mutuo', 'aprendiz_sem_justa_causa', 'aprendiz_desempenho', 'prazo_sem_justa_causa'],
    TIPOS_PEDIDO_DEMISSAO: ['pedido_demissao', 'aprendiz_pedido', 'prazo_pedido'],
    TIPOS_JUSTA_CAUSA: ['justa_causa', 'aprendiz_falta_grave', 'prazo_justa_causa'],

    validarPensao({ tipo, valor } = {}) {
        if (!['percentual', 'valor-fixo', 'salario-minimo'].includes(tipo)) return 'Escolha o tipo da pensão alimentícia.';
        const v = Number(valor);
        if (!(v > 0)) return 'Informe o valor da pensão alimentícia definido na decisão judicial.';
        if (tipo !== 'valor-fixo' && v > 100) return 'O percentual da pensão alimentícia não pode passar de 100%.';
        return null;
    },

    pisoProporcional({ piso, workLoad } = {}) {
        const m = String(workLoad || '').match(/^(\d+)h$/);
        const horas = m ? Math.min(Number(m[1]), 44) : 44;
        return +((Number(piso) * horas) / 44).toFixed(2);
    },

    convencaoVigente(cct, hojeISO) {
        return !!cct && cct.vigencia_inicio <= hojeISO && hojeISO <= cct.vigencia_fim;
    },

    avaliarEstabilidade({ estabilidadeAte, motivo, demissaoISO, tipo } = {}) {
        if (!estabilidadeAte || !demissaoISO || demissaoISO > estabilidadeAte) return null;
        const ate = estabilidadeAte.split('-').reverse().join('/');
        const rotulo = CLTDomain.MOTIVOS_ESTABILIDADE[motivo] || CLTDomain.MOTIVOS_ESTABILIDADE.outra;
        const inicio = `Colaborador com estabilidade até ${ate} (${rotulo}).`;
        if (CLTDomain.TIPOS_DISPENSA_SEM_JUSTA_CAUSA.includes(tipo))
            return {
                bloqueia: true,
                mensagem: `${inicio} A dispensa sem justa causa nesse período é nula e obriga a reintegrar ou a indenizar todo o período.`,
            };
        if (CLTDomain.TIPOS_PEDIDO_DEMISSAO.includes(tipo))
            return {
                bloqueia: false,
                mensagem: `${inicio} O pedido de demissão de empregado estável só vale com assistência do sindicato ou do Ministério do Trabalho (CLT art. 500).`,
            };
        if (CLTDomain.TIPOS_JUSTA_CAUSA.includes(tipo))
            return {
                bloqueia: false,
                mensagem: `${inicio} Documente bem a falta grave: se a justa causa for revertida na Justiça, a empresa paga todo o período de estabilidade.`,
            };
        return {
            bloqueia: false,
            mensagem: `${inicio} Confirme com o jurídico antes de encerrar o contrato nesse período (para gestante, Súmula 244, III, do TST).`,
        };
    },
};

window.CLTDomain = CLTDomain;

if (typeof module !== 'undefined' && module.exports) module.exports = { CLTDomain };
