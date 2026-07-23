let myEmployee = null;
let myEmployeeId = null;
let recordsMap = {};
let adjRequests = [];
let userCoords = null;
let pendingStep = null;
let bankRequests = [];
let teamRequests = [];
let isManager = false;
let rejectingRequestId = null;
let leafletMap = null,
    userMarker = null,
    routeLine = null;
let selfieStream = null,
    capturedSelfieDataUrl = null;
let faceVerified = false;
let faceModelsPromise = null;
let referenceDescriptorPromise = null;
let holidaysMap = {};
let limiteExtraDiarioMin = CLTDomain.LIMITE_EXTRA_DIARIO_MIN_PADRAO;
let pendingExcessoLegalMin = 0;
let ajusteDatePicker = null,
    bankreqDatePicker = null;

const EMPRESA = {
    nome: 'Nexus',
    unidades: [
        { endereco: 'R. Augusta, 1508 - Consolação, São Paulo - SP', lat: -23.5591, lng: -46.6606, raioM: 200 },
        { endereco: 'R. Borges de Figueiredo, 510 - Mooca, São Paulo - SP', lat: -23.5552, lng: -46.6035, raioM: 200 },
    ],
    lat: -23.5591,
    lng: -46.6606,
    raioM: 200,
};

const pad0 = (n) => String(n).padStart(2, '0');
const $ = (id) => document.getElementById(id);

function positionFixedPopover(trigger, popover) {
    const margin = 8;
    const rect = trigger.getBoundingClientRect();
    const popW = popover.offsetWidth;
    const popH = popover.offsetHeight;

    let left = rect.left;
    left = Math.min(left, window.innerWidth - popW - margin);
    left = Math.max(margin, left);

    let top = rect.bottom + 12;
    if (top + popH > window.innerHeight - margin) {
        const above = rect.top - popH - 12;
        top = above >= margin ? above : Math.max(margin, window.innerHeight - popH - margin);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('colaborador', '*');
    if (!auth) return;
    myEmployeeId = auth.profile.employee_id;
    myEmployee = auth.employee;

    const { data: managed } = await sb.from('employees').select('id').eq('manager_id', myEmployeeId).limit(1);
    isManager = !!(managed && managed.length);

    loadFaceModels().catch((e) => console.error('Falha ao carregar modelos de verificação facial:', e));

    await loadData();
    setupRealtimeSync();

    renderSyncStatus();
    window.addEventListener('online', flushOfflineQueue);
    setInterval(() => {
        if (loadOfflineQueue().length) flushOfflineQueue();
    }, 20000);
    flushOfflineQueue();

    updateClock();
    setInterval(updateClock, 1000);

    setupMonthFilterPicker();
    ajusteDatePicker = createSimpleDayPicker('ajuste-data', updateAjusteBtnState);
    bankreqDatePicker = createSimpleDayPicker('bankreq-data', updateBankReqBtnState);
    setupHorarioPicker();
    setupTipoToggle();
    setupAnexoPicker();

    renderUI();
    initLocation();

    document.querySelectorAll('.modal-overlay').forEach((el) => {
        if (el.id === 'modal-ajuste' || el.id === 'modal-bank-request' || el.id === 'modal-confirmar') return;
        el.addEventListener('click', (e) => {
            if (e.target === el) closeModal(el.id);
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });
});

async function loadData() {
    const queries = [
        sb.from('time_records').select('*').eq('employee_id', myEmployeeId).order('date', { ascending: false }),
        sb.from('adjustment_requests').select('*').eq('employee_id', myEmployeeId).order('created_at', { ascending: false }),
        sb.from('bank_requests').select('*').eq('employee_id', myEmployeeId).order('created_at', { ascending: false }),
        sb.from('holidays').select('date,name'),
        sb.from('hr_settings').select('limite_extra_diario_min').eq('id', 1).single(),
    ];
    if (isManager) {
        queries.push(
            sb
                .from('bank_requests')
                .select('*, employees(name,dept)')
                .eq('manager_id_snapshot', myEmployeeId)
                .eq('status', 'pendente')
                .order('created_at', { ascending: false })
        );
    }
    const [{ data: records }, { data: adj }, { data: bankReq }, { data: hol }, { data: settings }, teamRes] = await Promise.all(queries);
    recordsMap = {};
    (records || []).forEach((r) => {
        recordsMap[r.date] = r;
    });
    adjRequests = adj || [];
    bankRequests = bankReq || [];
    holidaysMap = {};
    (hol || []).forEach((h) => {
        holidaysMap[h.date] = h;
    });
    if (settings?.limite_extra_diario_min != null) limiteExtraDiarioMin = settings.limite_extra_diario_min;
    teamRequests = isManager ? teamRes?.data || [] : [];
}

function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${pad0(d.getMonth() + 1)}-${pad0(d.getDate())}`;
}
function nowISO() {
    return new Date().toISOString();
}
function timeStr(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return `${pad0(d.getHours())}:${pad0(d.getMinutes())}`;
}
function minToStr(min) {
    const abs = Math.abs(min);
    return `${Math.floor(abs / 60)}h ${pad0(abs % 60)}min`;
}
function fmtDate(key) {
    const [y, m, d] = key.split('-');
    return `${d}/${m}/${y}`;
}
function diaSemana(key) {
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return dias[new Date(key + 'T12:00:00').getDay()];
}
function initials(name) {
    return (name || '?')
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || '')
        .join('');
}

function getJornadaMin() {
    return CLTDomain.resolveJornadaMin({ contractType: myEmployee?.contract_type, workLoad: myEmployee?.work_load });
}

function isFalta(rec) {
    return CLTDomain.isFalta(rec);
}

function calcWorkedMin(rec) {
    return CLTDomain.calcWorkedMin(rec);
}

function calcSaldoMin(rec) {
    return CLTDomain.calcSaldoMin(rec, getJornadaMin());
}

function getIntervaloMinObrigatorio() {
    return CLTDomain.getIntervaloMinObrigatorio(getJornadaMin());
}

function calcIntervaloDeficitMin(rec) {
    return CLTDomain.calcIntervaloDeficitMin(rec, getJornadaMin());
}

function weekStartKey(dateKey) {
    return CLTDomain.weekStartKey(dateKey);
}

function previewSaldoSaidaMin(rec) {
    const j = getJornadaMin();
    if (j === null) return null;
    const hyp = { ...rec, saida: nowISO() };
    return calcWorkedMin(hyp) - j;
}

function getTodayRec() {
    return recordsMap[todayKey()] || {};
}

function nextStep(rec) {
    if (!rec.entrada) return 'entrada';
    if (!rec.saida_almoco) return 'saida_almoco';
    if (!rec.retorno_almoco) return 'retorno_almoco';
    if (!rec.saida) return 'saida';
    return 'encerrado';
}

window.logout = async function () {
    await sb.auth.signOut();
    window.location.href = '../screens/login.html';
};

function updateClock() {
    const now = new Date();
    const el = $('ponto-hora'),
        elD = $('ponto-data');
    if (el) el.textContent = `${pad0(now.getHours())}:${pad0(now.getMinutes())}:${pad0(now.getSeconds())}`;
    if (elD) elD.textContent = `${pad0(now.getDate())}/${pad0(now.getMonth() + 1)}/${now.getFullYear()}`;
}

const STEP_META = {
    entrada: { label: 'Registrar Entrada', icon: 'fa-sign-in-alt', cls: '', dotCls: 'inativo', hint: '' },
    saida_almoco: { label: 'Saída para Almoço', icon: 'fa-coffee', cls: 'btn-almoco', dotCls: 'ativo', hint: 'Registre quando sair para o almoço.' },
    retorno_almoco: { label: 'Retorno do Almoço', icon: 'fa-utensils', cls: 'btn-retorno', dotCls: 'almoco', hint: 'Registre quando retornar do almoço.' },
    saida: { label: 'Registrar Saída', icon: 'fa-sign-out-alt', cls: 'btn-saida', dotCls: 'ativo', hint: 'Registre sua saída ao final do expediente.' },
    encerrado: {
        label: 'Jornada encerrada',
        icon: 'fa-check-circle',
        cls: 'btn-encerrado',
        dotCls: 'encerrado',
        hint: 'Todos os registros do dia foram concluídos.',
    },
};

function renderUI() {
    const rec = getTodayRec();
    const step = nextStep(rec);
    const meta = STEP_META[step];
    const btn = $('btn-ponto'),
        icon = $('btn-ponto-icon'),
        txt = $('btn-ponto-text');
    if (btn && icon && txt) {
        btn.className = `btn-ponto ${meta.cls}`;
        btn.disabled = step === 'encerrado';
        icon.className = `fas ${meta.icon}`;
        txt.textContent = meta.label;
    }
    const hint = $('ponto-hint');
    if (hint) hint.textContent = meta.hint;
    const dot = $('ponto-dot');
    if (dot) dot.className = `ponto-status-dot ${meta.dotCls}`;
    const stxt = $('ponto-status-text');
    if (stxt) stxt.textContent = getStatusText(rec, step);
    renderTimeline(rec, step);
    renderSaldo();
    renderStats();
    renderSolicitacoes();
    renderBankRequests();
    renderTeamApprovals();
    runBurnoutCheck();
    runCLTComplianceCheck();
    renderHistorico();
}

function getStatusText(rec, step) {
    if (step === 'entrada') return 'Jornada não iniciada hoje';
    if (step === 'saida_almoco') return `Em expediente desde ${timeStr(rec.entrada)}`;
    if (step === 'retorno_almoco') return `Em almoço desde ${timeStr(rec.saida_almoco)}`;
    if (step === 'saida') return `Retornou às ${timeStr(rec.retorno_almoco)}`;
    const saldo = calcSaldoMin(rec);
    if (getJornadaMin() === null) return `Jornada encerrada — ${minToStr(calcWorkedMin(rec))} registradas`;
    if (saldo === null) return 'Jornada encerrada';
    return saldo >= 0 ? `Jornada encerrada — +${minToStr(saldo)} extras` : `Jornada encerrada — ${minToStr(saldo)} em falta`;
}

function renderTimeline(rec, step) {
    const steps = ['entrada', 'saida_almoco', 'retorno_almoco', 'saida'];
    const ids = ['ts-entrada', 'ts-saida-almoco', 'ts-retorno', 'ts-saida'];
    const timeIds = ['ts-time-entrada', 'ts-time-saida-almoco', 'ts-time-retorno', 'ts-time-saida'];
    const lines = ['ts-line-1', 'ts-line-2', 'ts-line-3'];
    const stepIdx = steps.indexOf(step);
    ids.forEach((id, i) => {
        const el = $(id);
        if (!el) return;
        const done = rec[steps[i]];
        const curr = i === stepIdx;
        el.className = 'ts-step' + (done ? ' done' : curr ? ' current' : '');
        const t = $(timeIds[i]);
        if (t) t.textContent = done ? timeStr(done) : '—';
    });
    lines.forEach((id, i) => {
        const el = $(id);
        if (el) el.className = 'ts-line' + (rec[steps[i]] ? ' done' : '');
    });
}

function renderSaldo() {
    const jornadaMin = getJornadaMin();
    let totalMin = 0,
        diasCompletos = 0;
    Object.values(recordsMap).forEach((rec) => {
        if (isFalta(rec)) return;
        const s = calcSaldoMin(rec);
        if (s !== null) {
            totalMin += s;
            diasCompletos++;
        }
    });
    const icon = $('saldo-icon'),
        val = $('saldo-value'),
        sub = $('saldo-sub');
    if (jornadaMin === null) {
        let totalWorked = 0;
        Object.values(recordsMap).forEach((rec) => {
            if (!isFalta(rec) && rec.saida) totalWorked += calcWorkedMin(rec);
        });
        if (icon) icon.className = 'saldo-icon positivo';
        if (val) {
            val.textContent = minToStr(totalWorked);
            val.className = 'saldo-value';
        }
        if (sub) sub.textContent = `Total registrado em ${diasCompletos} dia(s) — PJ`;
        return;
    }
    if (diasCompletos === 0) {
        if (icon) icon.className = 'saldo-icon';
        if (val) {
            val.textContent = '0h 00min';
            val.className = 'saldo-value';
        }
        if (sub) sub.textContent = 'Nenhum dia finalizado';
        return;
    }
    const sign = totalMin > 0 ? '+' : totalMin < 0 ? '-' : '';
    const cls = totalMin > 0 ? 'positivo' : totalMin < 0 ? 'negativo' : 'positivo';
    if (icon) icon.className = `saldo-icon ${cls}`;
    if (val) {
        val.textContent = `${sign}${minToStr(totalMin)}`;
        val.className = `saldo-value ${totalMin !== 0 ? cls : ''}`;
    }
    if (sub) sub.textContent = `Saldo acumulado de ${diasCompletos} dia(s) registrado(s)`;
}

function renderStats() {
    const now = new Date();
    const mesKey = `${now.getFullYear()}-${pad0(now.getMonth() + 1)}`;
    let diasMes = 0,
        extrasMin = 0,
        faltaMin = 0;
    Object.entries(recordsMap).forEach(([key, rec]) => {
        if (!key.startsWith(mesKey) || isFalta(rec)) return;
        const s = calcSaldoMin(rec);
        if (s === null) return;
        diasMes++;
        if (s > 0) extrasMin += s;
        else if (s < 0) faltaMin += Math.abs(s);
    });
    const el_dias = $('stat-dias-mes');
    if (el_dias) el_dias.textContent = diasMes;
    const el_ext = $('stat-horas-extras');
    if (el_ext) el_ext.textContent = extrasMin ? minToStr(extrasMin) : '0h 00min';
    const el_flt = $('stat-horas-falta');
    if (el_flt) el_flt.textContent = faltaMin ? minToStr(faltaMin) : '0h 00min';
    const el_j = $('stat-jornada');
    if (el_j) {
        const j = getJornadaMin();
        el_j.textContent =
            j === null ? 'Autônomo' : myEmployee?.work_load === '12x36' ? 'Escala 12x36' : `${Math.floor(j / 60)}h${j % 60 ? pad0(j % 60) + 'min' : ''}/dia`;
    }
}

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function setupMonthFilterPicker() {
    const trigger = $('filter-month-trigger');
    const textEl = $('filter-month-text');
    const hidden = $('filter-month');
    const popover = $('filter-month-popover');
    const titleEl = $('filter-month-title');
    const gridEl = $('filter-month-grid');
    const prevBtn = $('filter-month-prev');
    const nextBtn = $('filter-month-next');
    if (!trigger || !popover) return;

    const today = new Date();
    let viewYear = today.getFullYear(),
        viewMonth = today.getMonth();

    function setTriggerText(year, month) {
        if (textEl) textEl.textContent = `${MESES_PT[month]} ${year}`;
    }

    function selectMonth(year, month) {
        hidden.value = `${year}-${pad0(month + 1)}`;
        setTriggerText(year, month);
    }

    function render() {
        titleEl.textContent = `${MESES_PT[viewMonth]} ${viewYear}`;
        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            cells.push({ day: d, muted: false, isToday });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map(
                (c) =>
                    `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}" data-day="${c.day}">${c.day}</button>`
            )
            .join('');
    }

    function reposition() {
        positionFixedPopover(trigger, popover);
    }

    function open() {
        const [selYear, selMonth] = (hidden.value || '').split('-').map(Number);
        viewYear = selYear || today.getFullYear();
        viewMonth = selMonth ? selMonth - 1 : today.getMonth();
        render();
        popover.classList.add('open');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        reposition();
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
        document.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
    }

    function close() {
        popover.classList.remove('open');
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
        document.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
    }

    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }
    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });

    gridEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-day]');
        if (!btn || btn.classList.contains('calendar-day--muted')) return;
        selectMonth(viewYear, viewMonth);
        close();
        renderHistorico();
    });

    prevBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
        reposition();
    });
    nextBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
        reposition();
    });

    selectMonth(today.getFullYear(), today.getMonth());
}

window.renderHistorico = function () {
    const tbody = $('historico-tbody');
    if (!tbody) return;
    const fmEl = $('filter-month');
    const now = new Date();
    const mesAtual = `${now.getFullYear()}-${pad0(now.getMonth() + 1)}`;
    if (fmEl && !fmEl.value) fmEl.value = mesAtual;
    const filtroMes = fmEl?.value || mesAtual;
    const dias = Object.entries(recordsMap)
        .filter(([k]) => k.startsWith(filtroMes))
        .sort(([a], [b]) => b.localeCompare(a));
    if (!dias.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-calendar-times"></i><p>Nenhum registro em ${filtroMes.split('-').reverse().join('/')}</p><span>Os registros de ponto aparecerão aqui</span></div></td></tr>`;
        return;
    }
    const jornadaMin = getJornadaMin();
    tbody.innerHTML = dias
        .map(([key, rec]) => {
            if (isFalta(rec))
                return `<tr class="row-falta"><td class="td-date">${fmtDate(key)}<span class="dia-semana">${diaSemana(key)}</span></td><td colspan="4" style="color:var(--text-tertiary);font-style:italic;font-size:.8rem">Sem registros</td><td>—</td><td>—</td><td><span class="badge badge-falta">Falta</span></td></tr>`;
            const worked = calcWorkedMin(rec),
                saldo = calcSaldoMin(rec);
            const workedStr = rec.saida ? minToStr(worked) : '—';
            let saldoStr = '—',
                saldoCls = 'zero';
            if (jornadaMin === null) {
                saldoStr = rec.saida ? minToStr(worked) : '—';
            } else if (saldo !== null) {
                saldoStr = (saldo >= 0 ? '+' : '-') + minToStr(saldo);
                saldoCls = saldo > 0 ? 'positivo' : saldo < 0 ? 'negativo' : 'zero';
            }
            const badge = getBadge(rec, saldo);
            const intervaloDeficit = calcIntervaloDeficitMin(rec);
            const intervaloTag =
                intervaloDeficit > 0
                    ? `<span class="badge badge-intervalo" title="Intervalo do art. 71 da CLT não cumprido — ${minToStr(intervaloDeficit)} devidos com adicional de 50%, pagos à parte (não entram no banco de horas)">Intervalo -${minToStr(intervaloDeficit)}</span>`
                    : '';
            const t = (f) => {
                const v = rec[f];
                if (!v) return `<span class="td-time missing">—</span>`;
                return `<span class="td-time ${rec[f + '_ajustado'] ? 'ajustado' : ''}">${timeStr(v)}</span>`;
            };
            return `<tr><td class="td-date">${fmtDate(key)}<span class="dia-semana">${diaSemana(key)}</span></td><td>${t('entrada')}</td><td>${t('saida_almoco')}</td><td>${t('retorno_almoco')}</td><td>${t('saida')}</td><td class="td-total">${workedStr}</td><td class="td-saldo ${saldoCls}">${saldoStr}</td><td><span class="badge ${badge.cls}">${badge.label}</span>${intervaloTag}</td></tr>`;
        })
        .join('');
};

function getBadge(rec, saldo) {
    if (isFalta(rec)) return { cls: 'badge-falta', label: 'Falta' };
    if (rec.ajustado) return { cls: 'badge-ajuste', label: 'Ajustado' };
    if (!rec.saida) return { cls: 'badge-ajuste', label: 'Incompleto' };
    if (saldo === null) return { cls: 'badge-normal', label: 'Normal' };
    if (saldo > 0) return { cls: 'badge-extra', label: 'Extra' };
    if (saldo < 0) return { cls: 'badge-falta', label: 'Falta' };
    return { cls: 'badge-normal', label: 'Normal' };
}

function renderSolicitacoes() {
    const pendentes = adjRequests.filter((a) => a.status === 'pendente');
    const section = $('section-solicitacoes'),
        list = $('solicitacoes-list');
    if (!section || !list) return;
    if (!pendentes.length) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');
    const tipoMap = {
        entrada: 'Correção de Entrada',
        'saida-almoco': 'Correção de Saída p/ Almoço',
        'retorno-almoco': 'Correção de Retorno',
        saida: 'Correção de Saída',
        falta: 'Justificativa de Falta',
    };
    list.innerHTML = pendentes
        .map(
            (a) =>
                `<div class="solicitacao-item"><div class="sol-icon"><i class="fas fa-edit"></i></div><div class="sol-info"><p class="sol-tipo">${tipoMap[a.tipo] || a.tipo}</p><p class="sol-meta">Data: ${a.date}${a.horario ? ` • Horário: ${a.horario}` : ''} • Enviado em ${new Date(a.created_at).toLocaleDateString('pt-BR')}</p></div><span class="badge-pendente"><i class="fas fa-hourglass-half"></i> Pendente</span></div>`
        )
        .join('');
}

function renderBankRequests() {
    const list = $('bank-requests-list');
    if (!list) return;
    if (!bankRequests.length) {
        list.innerHTML = `<p class="no-ajustes">Nenhuma solicitação enviada ainda.</p>`;
        return;
    }
    const STATUS_META = {
        pendente: { cls: 'badge-pendente', label: 'Pendente', icon: 'fa-hourglass-half' },
        aprovado: { cls: 'badge-aprovado', label: 'Aprovado', icon: 'fa-check' },
        rejeitado: { cls: 'badge-rejeitado', label: 'Rejeitado', icon: 'fa-xmark' },
    };
    list.innerHTML = bankRequests
        .map((r) => {
            const meta = STATUS_META[r.status] || STATUS_META.pendente;
            const tipoLabel = r.tipo === 'credito' ? 'Crédito' : 'Débito';
            const valor = `${r.tipo === 'credito' ? '+' : '-'}${minToStr(r.minutos)}`;
            const obs = r.status === 'rejeitado' && r.decision_obs ? `<p class="sol-obs"><i class="fas fa-comment"></i> ${esc(r.decision_obs)}</p>` : '';
            return `<div class="solicitacao-item"><div class="sol-icon"><i class="fas fa-clock-rotate-left"></i></div><div class="sol-info"><p class="sol-tipo">${tipoLabel} — ${valor}${r.anexo_name ? ` <i class="fas fa-paperclip" title="${esc(r.anexo_name)}"></i>` : ''}</p><p class="sol-meta">Data: ${fmtDate(r.date)} • ${esc(r.justificativa)}</p>${obs}</div><span class="badge-status ${meta.cls}"><i class="fas ${meta.icon}"></i> ${meta.label}</span></div>`;
        })
        .join('');
}

function renderTeamApprovals() {
    const section = $('section-team-approvals'),
        list = $('team-approvals-list');
    if (!section || !list) return;
    if (!isManager || !teamRequests.length) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');
    list.innerHTML = teamRequests
        .map((r) => {
            const empName = r.employees?.name || '—',
                empDept = r.employees?.dept || '—';
            const tipoLabel = r.tipo === 'credito' ? 'Crédito' : 'Débito';
            const valor = `${r.tipo === 'credito' ? '+' : '-'}${minToStr(r.minutos)}`;
            const anexoBtn = r.anexo_path
                ? `<button class="btn-link-anexo" onclick="viewBankRequestAnexo('${r.id}')"><i class="fas fa-paperclip"></i> Ver anexo</button>`
                : '';
            return `<div class="solicitacao-item"><div class="sol-icon"><i class="fas fa-user-clock"></i></div><div class="sol-info"><p class="sol-tipo">${esc(empName)} <span class="sol-dept">(${esc(empDept)})</span> — ${tipoLabel} ${valor}</p><p class="sol-meta">Data: ${fmtDate(r.date)} • ${esc(r.justificativa)}</p>${anexoBtn}</div><div class="aprovacao-actions"><button class="btn-approve" onclick="approveTeamRequest('${r.id}')" title="Aprovar"><i class="fas fa-check"></i></button><button class="btn-reject" onclick="openRejectModal('${r.id}')" title="Rejeitar"><i class="fas fa-xmark"></i></button></div></div>`;
        })
        .join('');
}

function setupTipoToggle() {
    const toggle = $('bankreq-tipo-toggle');
    const hidden = $('bankreq-tipo');
    if (!toggle || !hidden) return;
    toggle.addEventListener('click', (e) => {
        const btn = e.target.closest('.type-toggle-card');
        if (!btn) return;
        hidden.value = btn.dataset.tipo;
        toggle.querySelectorAll('.type-toggle-card').forEach((c) => c.classList.toggle('active', c === btn));
        updateBankReqBtnState();
    });
}

function setupAnexoPicker() {
    const btn = $('bankreq-anexo-btn');
    const input = $('bankreq-anexo');
    const nameEl = $('bankreq-anexo-name');
    if (!btn || !input) return;
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
        if (nameEl) nameEl.textContent = input.files?.[0]?.name || 'Nenhum arquivo selecionado';
    });
}

window.viewBankRequestAnexo = async function (id) {
    const r = [...bankRequests, ...teamRequests].find((x) => x.id === id);
    if (!r?.anexo_path) return;
    const { data, error } = await sb.storage.from('documents').createSignedUrl(r.anexo_path, 3600);
    if (error || !data?.signedUrl) {
        showToast('Não foi possível abrir o anexo.', 'error');
        return;
    }
    window.open(data.signedUrl, '_blank');
};

window.openModalBankRequest = function () {
    ['bankreq-horas', 'bankreq-minutos', 'bankreq-justificativa'].forEach((id) => {
        const el = $(id);
        if (el) el.value = '';
    });
    const tipo = $('bankreq-tipo');
    if (tipo) tipo.value = 'credito';
    document.querySelectorAll('#bankreq-tipo-toggle .type-toggle-card').forEach((c) => c.classList.toggle('active', c.dataset.tipo === 'credito'));
    const anexo = $('bankreq-anexo');
    if (anexo) anexo.value = '';
    const anexoName = $('bankreq-anexo-name');
    if (anexoName) anexoName.textContent = 'Nenhum arquivo selecionado';
    bankreqDatePicker?.reset();
    ['err-bankreq-data', 'err-bankreq-valor', 'err-bankreq-just'].forEach((id) => {
        const el = $(id);
        if (el) el.textContent = '';
    });
    updateBankReqBtnState();
    openModal('modal-bank-request');
};

function updateBankReqBtnState() {
    const btn = $('btn-bankreq-enviar');
    if (!btn) return;
    const data = $('bankreq-data')?.value || '';
    const horas = parseInt($('bankreq-horas')?.value || '0', 10);
    const mins = parseInt($('bankreq-minutos')?.value || '0', 10);
    const just = $('bankreq-justificativa')?.value.trim() || '';
    const total = (horas || 0) * 60 + (mins || 0);
    btn.disabled = !(data && total > 0 && just);
}
window.updateBankReqBtnState = updateBankReqBtnState;

window.enviarBankRequest = async function () {
    const tipo = $('bankreq-tipo')?.value || 'credito';
    const data = $('bankreq-data')?.value || '';
    const horas = parseInt($('bankreq-horas')?.value || '0', 10);
    const mins = parseInt($('bankreq-minutos')?.value || '0', 10);
    const just = $('bankreq-justificativa')?.value.trim() || '';
    const fileEl = $('bankreq-anexo');
    const file = fileEl?.files?.[0] || null;
    let ok = true;
    const setErr = (id, msg) => {
        const el = $(id);
        if (el) el.textContent = msg;
        if (msg) ok = false;
    };
    setErr('err-bankreq-data', data ? '' : 'Informe a data de referência.');
    const total = horas * 60 + mins;
    setErr('err-bankreq-valor', total > 0 ? '' : 'Informe um valor de horas/minutos maior que zero.');
    setErr('err-bankreq-just', just ? '' : 'A justificativa é obrigatória.');
    if (!ok) return;

    if (file && file.size > 10 * 1024 * 1024) {
        showToast('Arquivo muito grande (máx. 10 MB).', 'error');
        return;
    }

    let anexoPath = null,
        anexoName = null;
    if (file) {
        const storagePath = `${myEmployeeId}/banco-horas/${Date.now()}_${file.name}`;
        const { error: upErr } = await sb.storage.from('documents').upload(storagePath, file, { contentType: file.type });
        if (upErr) {
            showToast('Erro ao enviar o anexo.', 'error');
            return;
        }
        anexoPath = storagePath;
        anexoName = file.name;
        await sb.from('documents').insert({
            name: file.name,
            employee_id: myEmployeeId,
            category: 'banco_horas',
            tipo: 'Atestado/Comprovante',
            size_label: `${Math.round(file.size / 1024)} KB`,
            storage_path: storagePath,
            source: 'colaborador',
            status: 'aprovado',
        });
    }

    const { data: inserted, error } = await sb
        .from('bank_requests')
        .insert({
            employee_id: myEmployeeId,
            origem: 'colaborador',
            tipo,
            minutos: total,
            date: data,
            justificativa: just,
            anexo_path: anexoPath,
            anexo_name: anexoName,
            requires_approval_from: 'rh',
            created_by_name: myEmployee.name,
            created_by_email: myEmployee.email,
        })
        .select()
        .single();

    if (error) {
        showToast('Erro ao enviar solicitação.', 'error');
        return;
    }
    bankRequests.unshift(inserted);
    closeModal('modal-bank-request');
    showToast('Solicitação enviada! Aguarde aprovação do RH.', 'success');
    renderBankRequests();
};

window.approveTeamRequest = async function (id) {
    const { error } = await sb.rpc('approve_bank_request', {
        p_request_id: id,
        p_decision: 'aprovado',
        p_decided_by_name: myEmployee.name,
        p_decided_by_email: myEmployee.email,
    });
    if (error) {
        showToast(error.message || 'Erro ao aprovar solicitação.', 'error');
        return;
    }
    teamRequests = teamRequests.filter((r) => r.id !== id);
    renderTeamApprovals();
    showToast('Solicitação aprovada.', 'success');
};

window.openRejectModal = function (id) {
    rejectingRequestId = id;
    const el = $('reject-obs-text');
    if (el) el.value = '';
    const err = $('err-reject-obs');
    if (err) err.textContent = '';
    openModal('modal-reject-obs');
};

window.confirmRejectBankRequest = async function () {
    const obs = $('reject-obs-text')?.value.trim() || '';
    if (!obs) {
        const err = $('err-reject-obs');
        if (err) err.textContent = 'Informe o motivo da rejeição.';
        return;
    }
    const { error } = await sb.rpc('approve_bank_request', {
        p_request_id: rejectingRequestId,
        p_decision: 'rejeitado',
        p_obs: obs,
        p_decided_by_name: myEmployee.name,
        p_decided_by_email: myEmployee.email,
    });
    if (error) {
        showToast(error.message || 'Erro ao rejeitar solicitação.', 'error');
        return;
    }
    teamRequests = teamRequests.filter((r) => r.id !== rejectingRequestId);
    renderTeamApprovals();
    closeModal('modal-reject-obs');
    showToast('Solicitação rejeitada.', 'info');
};

const BURNOUT_EXTRAS_MIN = 60,
    BURNOUT_DIAS_CONSECUTIVOS = 3,
    BURNOUT_SEMANA_MIN = 5 * 60;

function detectBurnout() {
    const jornadaMin = getJornadaMin();
    const alertas = [];
    const diasEncerrados = Object.entries(recordsMap)
        .filter(([, rec]) => !isFalta(rec) && rec.saida)
        .sort(([a], [b]) => a.localeCompare(b));

    if (jornadaMin !== null) {
        let streak = 0,
            streakDias = [];
        for (const [key, rec] of diasEncerrados) {
            const s = calcSaldoMin(rec);
            if (s !== null && s >= BURNOUT_EXTRAS_MIN) {
                streak++;
                streakDias.push(key);
            } else {
                streak = 0;
                streakDias = [];
            }
        }
        if (streak >= BURNOUT_DIAS_CONSECUTIVOS) {
            alertas.push({
                tipo: 'extras_consecutivos',
                nivel: streak >= 5 ? 'critico' : 'atencao',
                titulo: `${streak} dias consecutivos com horas extras`,
                mensagem: `Você acumulou horas extras nos últimos ${streak} dias úteis.`,
                sugestao: 'Priorize sair no horário.',
                dias: streakDias.slice(-streak).map(fmtDate),
                streakCount: streak,
            });
        }
    }

    const hoje = todayKey();
    const ultimos7 = diasEncerrados.filter(([k]) => k !== hoje).slice(-7);
    const almocosPulados = ultimos7.filter(([, rec]) => rec.entrada && rec.saida && !rec.saida_almoco);
    if (almocosPulados.length >= 2) {
        alertas.push({
            tipo: 'almoco_pulado',
            nivel: almocosPulados.length >= 4 ? 'critico' : 'atencao',
            titulo: `Horário de almoço não registrado ${almocosPulados.length}x nos últimos 7 dias`,
            mensagem: 'Pausas para almoço são essenciais.',
            sugestao: 'Reserve pelo menos 30 minutos para pausar.',
            dias: almocosPulados.map(([k]) => fmtDate(k)),
            count: almocosPulados.length,
        });
    }

    if (jornadaMin !== null) {
        const now = new Date(),
            diaSemanaNum = now.getDay();
        const inicioSemana = new Date(now);
        inicioSemana.setDate(now.getDate() - (diaSemanaNum === 0 ? 6 : diaSemanaNum - 1));
        const inicioKey = `${inicioSemana.getFullYear()}-${pad0(inicioSemana.getMonth() + 1)}-${pad0(inicioSemana.getDate())}`;
        let extrasSemana = 0;
        diasEncerrados.forEach(([key, rec]) => {
            if (key < inicioKey) return;
            const s = calcSaldoMin(rec);
            if (s !== null && s > 0) extrasSemana += s;
        });
        if (extrasSemana >= BURNOUT_SEMANA_MIN) {
            alertas.push({
                tipo: 'sobrecarga_semanal',
                nivel: extrasSemana >= 8 * 60 ? 'critico' : 'atencao',
                titulo: `${minToStr(extrasSemana)} de extras esta semana`,
                mensagem: `Você acumulou ${minToStr(extrasSemana)} de horas extras.`,
                sugestao: 'Considere compensar saindo mais cedo.',
                extrasMin: extrasSemana,
            });
        }
    }
    return alertas;
}

async function notificarRH(alertas) {
    if (!alertas.length) return;
    const hoje = todayKey();
    const { data: existing } = await sb.from('burnout_alerts').select('id').eq('employee_id', myEmployeeId).eq('date', hoje).single();
    if (existing) return;
    await sb.from('burnout_alerts').insert({
        employee_id: myEmployeeId,
        date: hoje,
        alertas: alertas.map((a) => ({ tipo: a.tipo, nivel: a.nivel, titulo: a.titulo })),
        lido: false,
    });
}

function renderBurnoutCard(alertas) {
    const section = $('section-burnout');
    if (!section) return;
    if (!alertas.length) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');
    const nivelGeral = alertas.some((a) => a.nivel === 'critico') ? 'critico' : 'atencao';
    const iconePrincipal = nivelGeral === 'critico' ? 'fa-triangle-exclamation' : 'fa-heart-pulse';
    const tituloPrincipal = nivelGeral === 'critico' ? 'Atenção: Risco de Esgotamento' : 'Sugestão de Descanso';
    const itensHTML = alertas
        .map((a) => {
            const icone =
                { extras_consecutivos: 'fa-clock', almoco_pulado: 'fa-bowl-food', sobrecarga_semanal: 'fa-chart-line' }[a.tipo] || 'fa-circle-exclamation';
            const diasHTML = a.dias?.length ? `<div class="burnout-dias">${a.dias.map((d) => `<span class="burnout-dia-tag">${d}</span>`).join('')}</div>` : '';
            return `<div class="burnout-item burnout-item--${a.nivel}"><div class="burnout-item-icon"><i class="fas ${icone}"></i></div><div class="burnout-item-body"><p class="burnout-item-titulo">${a.titulo}</p><p class="burnout-item-msg">${a.mensagem}</p>${diasHTML}<p class="burnout-item-sugestao"><i class="fas fa-lightbulb"></i> ${a.sugestao}</p></div></div>`;
        })
        .join('');
    section.innerHTML = `<div class="burnout-card burnout-card--${nivelGeral}"><div class="burnout-header"><div class="burnout-header-left"><div class="burnout-badge-icon burnout-badge-icon--${nivelGeral}"><i class="fas ${iconePrincipal}"></i></div><div><p class="burnout-titulo">${tituloPrincipal}</p><p class="burnout-subtitulo">${nivelGeral === 'critico' ? 'O RH foi notificado. Cuide-se!' : 'Identificamos padrões que merecem atenção.'}</p></div></div><button class="burnout-dismiss" onclick="dismissBurnout()" title="Fechar"><i class="fas fa-times"></i></button></div><div class="burnout-items">${itensHTML}</div></div>`;
}

window.dismissBurnout = function () {
    const s = $('section-burnout');
    if (s) {
        s.classList.add('burnout-dismissing');
        setTimeout(() => s.classList.add('hidden'), 350);
    }
};

function runBurnoutCheck() {
    const alertas = detectBurnout();
    renderBurnoutCard(alertas);
    notificarRH(alertas);
}

function detectCLTAlerts() {
    const alertas = [];
    const mesKey = todayKey().slice(0, 7);

    if (getIntervaloMinObrigatorio() > 0) {
        let deficitTotalMin = 0,
            diasComDeficit = 0;
        Object.entries(recordsMap).forEach(([key, rec]) => {
            if (!key.startsWith(mesKey)) return;
            const d = calcIntervaloDeficitMin(rec);
            if (d > 0) {
                deficitTotalMin += d;
                diasComDeficit++;
            }
        });
        if (deficitTotalMin > 0) {
            const indenizacaoMin = Math.round(deficitTotalMin * CLTDomain.INTERVALO_INDENIZACAO_MULTIPLICADOR);
            alertas.push({
                tipo: 'intervalo_intrajornada',
                nivel: diasComDeficit >= 5 ? 'critico' : 'atencao',
                titulo: `Intervalo intrajornada não cumprido em ${diasComDeficit} dia${diasComDeficit > 1 ? 's' : ''} este mês`,
                mensagem: `O art. 71 da CLT exige ${minToStr(getIntervaloMinObrigatorio())} de pausa para almoço na sua jornada. O tempo suprimido é pago à parte com adicional de 50% — não é compensado em banco de horas.`,
                sugestao: `Total aproximado: ${minToStr(deficitTotalMin)} suprimidos (${minToStr(indenizacaoMin)} indenizáveis com o adicional). Regularize seus intervalos e avise o RH se precisar de ajuste.`,
            });
        }
    }

    const faltasNaoJustificadas = adjRequests.filter((a) => a.tipo === 'falta' && a.status !== 'aprovado');
    if (faltasNaoJustificadas.length) {
        const semanas = [...new Set(faltasNaoJustificadas.map((a) => weekStartKey(a.date)))];
        alertas.push({
            tipo: 'dsr_risco',
            nivel: 'atencao',
            titulo: `Risco de perda do DSR em ${semanas.length} semana${semanas.length > 1 ? 's' : ''}`,
            mensagem:
                'Faltas ainda não aprovadas pelo RH podem levar à perda do Descanso Semanal Remunerado da semana correspondente enquanto não forem justificadas.',
            sugestao: 'Acompanhe o status das suas solicitações em "Ajustes Pendentes".',
            dias: semanas.map(fmtDate),
        });
    }

    return alertas;
}

function renderCLTCard(alertas) {
    const section = $('section-clt');
    if (!section) return;
    if (!alertas.length) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');
    const nivelGeral = alertas.some((a) => a.nivel === 'critico') ? 'critico' : 'atencao';
    const itensHTML = alertas
        .map((a) => {
            const icone = { intervalo_intrajornada: 'fa-mug-saucer', dsr_risco: 'fa-calendar-xmark' }[a.tipo] || 'fa-scale-balanced';
            const diasHTML = a.dias?.length ? `<div class="burnout-dias">${a.dias.map((d) => `<span class="burnout-dia-tag">${d}</span>`).join('')}</div>` : '';
            return `<div class="burnout-item burnout-item--${a.nivel}"><div class="burnout-item-icon"><i class="fas ${icone}"></i></div><div class="burnout-item-body"><p class="burnout-item-titulo">${a.titulo}</p><p class="burnout-item-msg">${a.mensagem}</p>${diasHTML}<p class="burnout-item-sugestao"><i class="fas fa-lightbulb"></i> ${a.sugestao}</p></div></div>`;
        })
        .join('');
    section.innerHTML = `<div class="burnout-card burnout-card--${nivelGeral}"><div class="burnout-header"><div class="burnout-header-left"><div class="burnout-badge-icon burnout-badge-icon--${nivelGeral}"><i class="fas fa-scale-balanced"></i></div><div><p class="burnout-titulo">Conformidade CLT</p><p class="burnout-subtitulo">Intervalo intrajornada e DSR (art. 71 CLT / Lei 605/49)</p></div></div><button class="burnout-dismiss" onclick="dismissCLT()" title="Fechar"><i class="fas fa-times"></i></button></div><div class="burnout-items">${itensHTML}</div></div>`;
}

window.dismissCLT = function () {
    const s = $('section-clt');
    if (s) {
        s.classList.add('burnout-dismissing');
        setTimeout(() => s.classList.add('hidden'), 350);
    }
};

function runCLTComplianceCheck() {
    renderCLTCard(detectCLTAlerts());
}

window.abrirConfirmar = function () {
    const rec = getTodayRec();
    const step = nextStep(rec);
    if (step === 'encerrado') return;
    pendingStep = step;
    const now = new Date(),
        ini = initials(myEmployee.name),
        color = myEmployee.avatar_color || '#6366f1';
    const av = $('confirmar-avatar');
    if (av) {
        av.textContent = ini;
        av.style.background = color;
    }
    const nm = $('confirmar-nome');
    if (nm) nm.textContent = myEmployee.name || '—';
    const em = $('confirmar-email');
    if (em) em.textContent = myEmployee.email;
    const tipoLabels = { entrada: 'Entrada', saida_almoco: 'Saída para Almoço', retorno_almoco: 'Retorno do Almoço', saida: 'Saída' };
    const tp = $('confirmar-tipo');
    if (tp) tp.textContent = tipoLabels[step] || step;
    const da = $('confirmar-data');
    if (da) da.textContent = `${pad0(now.getDate())}/${pad0(now.getMonth() + 1)}/${now.getFullYear()}`;
    const locEl = $('confirmar-loc');
    if (locEl) {
        if (userCoords) {
            const d = haversineM(userCoords.lat, userCoords.lng, EMPRESA.lat, EMPRESA.lng);
            const dentro = d <= EMPRESA.raioM;
            locEl.textContent = dentro ? `Dentro da empresa (~${Math.round(d)} m)` : `Fora da empresa (~${Math.round(d)} m)`;
            locEl.style.color = dentro ? '#10b981' : '#ef4444';
        } else {
            locEl.textContent = 'Localização não obtida';
            locEl.style.color = '';
        }
    }
    clearInterval(window._confirmTimer);
    const hr = $('confirmar-hora');
    const tick = () => {
        const n = new Date();
        if (hr) hr.textContent = `${pad0(n.getHours())}:${pad0(n.getMinutes())}:${pad0(n.getSeconds())}`;
    };
    tick();
    window._confirmTimer = setInterval(tick, 1000);
    resetSelfieCapture();
    iniciarCameraSelfie();
    getReferenceDescriptor().catch(() => {});
    setupExcessoLegalCheck(rec, step);
    openModal('modal-confirmar');
};

function setupExcessoLegalCheck(rec, step) {
    const bloco = $('excesso-legal-bloco'),
        txt = $('excesso-legal-just');
    pendingExcessoLegalMin = 0;
    if (txt) txt.value = '';
    if (step === 'saida') {
        const saldoPreview = previewSaldoSaidaMin(rec);
        if (saldoPreview !== null && saldoPreview > limiteExtraDiarioMin) pendingExcessoLegalMin = saldoPreview;
    }
    if (bloco) bloco.classList.toggle('hidden', pendingExcessoLegalMin <= 0);
    const msg = $('excesso-legal-msg');
    if (msg && pendingExcessoLegalMin > 0) {
        msg.textContent = `Esta saída resultaria em ${minToStr(pendingExcessoLegalMin)} de horas extras hoje, acima do limite legal de ${minToStr(limiteExtraDiarioMin)}/dia (CLT art. 59, §1º). Informe o motivo para confirmar — o RH será notificado imediatamente.`;
    }
    updateConfirmBtnState();
}

window.onExcessoLegalJustInput = function () {
    updateConfirmBtnState();
};

function updateConfirmBtnState() {
    const confBtn = $('btn-confirmar-ponto');
    if (!confBtn) return;
    const justOk = pendingExcessoLegalMin <= 0 || !!$('excesso-legal-just')?.value.trim();
    confBtn.disabled = !capturedSelfieDataUrl || !justOk || !faceVerified;
}

function resetSelfieCapture() {
    capturedSelfieDataUrl = null;
    faceVerified = false;
    const video = $('selfie-video'),
        preview = $('selfie-preview');
    if (preview) {
        preview.classList.add('hidden');
        preview.src = '';
    }
    if (video) video.classList.remove('hidden');
    $('btn-selfie-shoot')?.classList.remove('hidden');
    $('btn-selfie-retake')?.classList.add('hidden');
    const hint = $('selfie-hint');
    if (hint) {
        hint.textContent = 'Uma selfie é obrigatória para confirmar o registro.';
        hint.classList.remove('selfie-hint--erro');
    }
    const fv = $('face-verify-status');
    if (fv) {
        fv.classList.add('hidden');
        fv.textContent = '';
    }
    updateConfirmBtnState();
}

function pararCameraSelfie() {
    if (selfieStream) {
        selfieStream.getTracks().forEach((t) => t.stop());
        selfieStream = null;
    }
}

async function iniciarCameraSelfie() {
    const video = $('selfie-video'),
        shootBtn = $('btn-selfie-shoot'),
        hint = $('selfie-hint');
    pararCameraSelfie();
    if (!navigator.mediaDevices?.getUserMedia) {
        if (shootBtn) shootBtn.disabled = true;
        if (hint) {
            hint.textContent = 'Câmera não disponível neste aparelho/navegador.';
            hint.classList.add('selfie-hint--erro');
        }
        return;
    }
    try {
        selfieStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        if (video) video.srcObject = selfieStream;
        if (shootBtn) shootBtn.disabled = false;
    } catch {
        if (shootBtn) shootBtn.disabled = true;
        if (hint) {
            hint.textContent = 'Não foi possível acessar a câmera. Permita o acesso para registrar o ponto.';
            hint.classList.add('selfie-hint--erro');
        }
    }
}

window.capturarSelfie = function () {
    const video = $('selfie-video'),
        canvas = $('selfie-canvas'),
        preview = $('selfie-preview');
    if (!video || !canvas || !video.videoWidth) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    capturedSelfieDataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (preview) {
        preview.src = capturedSelfieDataUrl;
        preview.classList.remove('hidden');
    }
    video.classList.add('hidden');
    $('btn-selfie-shoot')?.classList.add('hidden');
    $('btn-selfie-retake')?.classList.remove('hidden');
    updateConfirmBtnState();
    pararCameraSelfie();
    verificarIdentidadeSelfie(capturedSelfieDataUrl);
};

window.retomarSelfie = function () {
    capturedSelfieDataUrl = null;
    faceVerified = false;
    const video = $('selfie-video'),
        preview = $('selfie-preview');
    if (preview) preview.classList.add('hidden');
    if (video) video.classList.remove('hidden');
    $('btn-selfie-shoot')?.classList.remove('hidden');
    $('btn-selfie-retake')?.classList.add('hidden');
    const fv = $('face-verify-status');
    if (fv) {
        fv.classList.add('hidden');
        fv.textContent = '';
    }
    updateConfirmBtnState();
    iniciarCameraSelfie();
};

const FACE_MODELS_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
const FACE_MATCH_THRESHOLD = 0.55;

function loadFaceModels() {
    if (!faceModelsPromise) {
        faceModelsPromise = Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODELS_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_URL),
        ]);
    }
    return faceModelsPromise;
}

function getReferenceDescriptor() {
    if (!myEmployee?.avatar_url) return Promise.resolve(null);
    if (!referenceDescriptorPromise) {
        referenceDescriptorPromise = (async () => {
            try {
                await loadFaceModels();
                const img = await faceapi.fetchImage(myEmployee.avatar_url);
                const det = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
                return det ? det.descriptor : null;
            } catch (e) {
                console.error('Falha ao processar a foto de referência:', e);
                return null;
            }
        })();
    }
    return referenceDescriptorPromise;
}

async function verificarIdentidadeSelfie(selfieDataUrl) {
    const statusEl = $('face-verify-status');
    faceVerified = false;
    updateConfirmBtnState();
    if (!statusEl) return;

    const setStatus = (variant, html) => {
        statusEl.className = `face-verify-status face-verify-status--${variant}`;
        statusEl.innerHTML = html;
    };
    statusEl.classList.remove('hidden');
    setStatus('checking', '<i class="fas fa-spinner fa-spin"></i> Verificando identidade...');

    try {
        await loadFaceModels();
    } catch {
        faceVerified = true;
        setStatus('info', '<i class="fas fa-circle-info"></i> Verificação de identidade indisponível no momento.');
        updateConfirmBtnState();
        return;
    }

    const refDescriptor = await getReferenceDescriptor();
    if (!refDescriptor) {
        faceVerified = true;
        setStatus(
            'info',
            myEmployee?.avatar_url
                ? '<i class="fas fa-circle-info"></i> Não foi possível ler a foto de perfil cadastrada — verificação pulada.'
                : '<i class="fas fa-circle-info"></i> Sem foto de perfil cadastrada — verificação de identidade não realizada.'
        );
        updateConfirmBtnState();
        return;
    }

    let det = null;
    try {
        const img = await faceapi.fetchImage(selfieDataUrl);
        det = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
    } catch (e) {
        console.error('Falha ao processar a selfie para verificação facial:', e);
    }

    if (!det) {
        faceVerified = false;
        setStatus('erro', '<i class="fas fa-triangle-exclamation"></i> Não identificamos seu rosto na foto. Tire novamente de frente, com boa iluminação.');
        updateConfirmBtnState();
        return;
    }

    const distance = faceapi.euclideanDistance(refDescriptor, det.descriptor);
    if (distance <= FACE_MATCH_THRESHOLD) {
        faceVerified = true;
        setStatus('ok', '<i class="fas fa-circle-check"></i> Identidade confirmada.');
    } else {
        faceVerified = false;
        setStatus('erro', '<i class="fas fa-triangle-exclamation"></i> O rosto não confere com o cadastro deste colaborador. Tire a selfie novamente.');
    }
    updateConfirmBtnState();
}

function dataUrlToBlob(dataUrl) {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/data:(.*);base64/)[1];
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

window.confirmarRegistro = async function () {
    if (!pendingStep) return;

    if (!userCoords) {
        showToast(
            'Ative a localização para registrar o ponto. Permita o acesso à sua posição e tente novamente (use o botão de atualizar no mapa, mais abaixo).',
            'error'
        );
        return;
    }

    const dist = haversineM(userCoords.lat, userCoords.lng, EMPRESA.lat, EMPRESA.lng);
    if (dist > EMPRESA.raioM) {
        showToast(`Você está a ~${Math.round(dist)}m da empresa — fora do raio permitido de ${EMPRESA.raioM}m para registrar o ponto.`, 'error');
        return;
    }

    if (!capturedSelfieDataUrl) {
        showToast('Tire uma selfie para confirmar o registro.', 'error');
        return;
    }

    if (!faceVerified) {
        showToast('A verificação de identidade ainda não confirmou este rosto. Tire a selfie novamente.', 'error');
        return;
    }

    let justificativaExcesso = '';
    if (pendingExcessoLegalMin > 0) {
        justificativaExcesso = $('excesso-legal-just')?.value.trim() || '';
        if (!justificativaExcesso) {
            showToast('Informe o motivo do excesso de horas extras para confirmar a saída.', 'error');
            return;
        }
    }

    clearInterval(window._confirmTimer);
    pararCameraSelfie();
    closeModal('modal-confirmar');
    const step = pendingStep;
    const key = todayKey();
    const entry = {
        step,
        date: key,
        timestamp: nowISO(),
        loc: userCoords ? { lat: userCoords.lat, lng: userCoords.lng } : null,
        selfie: capturedSelfieDataUrl,
        excessoLegalMin: pendingExcessoLegalMin > 0 ? pendingExcessoLegalMin : 0,
        justificativaExcesso,
    };
    capturedSelfieDataUrl = null;
    pendingStep = null;
    pendingExcessoLegalMin = 0;

    const labels = {
        entrada: 'Entrada registrada!',
        saida_almoco: 'Saída para almoço registrada!',
        retorno_almoco: 'Retorno registrado!',
        saida: 'Saída registrada — bom descanso!',
    };

    if (!navigator.onLine) {
        applyLocalPunch(entry);
        queueOfflinePunch(entry);
        showToast('Sem conexão — ponto salvo no aparelho e será sincronizado automaticamente.', 'warning');
        renderUI();
        return;
    }

    const ok = await syncPunch(entry);
    if (!ok) {
        applyLocalPunch(entry);
        queueOfflinePunch(entry);
        showToast('Falha de conexão — ponto salvo no aparelho e será sincronizado automaticamente.', 'warning');
        renderUI();
        return;
    }
    showToast(labels[step] || 'Ponto registrado!', 'success');
    renderUI();
};

function offlineQueueKey() {
    return `nexus_ponto_offline_${myEmployeeId}`;
}

function loadOfflineQueue() {
    try {
        return JSON.parse(localStorage.getItem(offlineQueueKey()) || '[]');
    } catch {
        return [];
    }
}

function saveOfflineQueue(queue) {
    localStorage.setItem(offlineQueueKey(), JSON.stringify(queue));
}

function queueOfflinePunch(entry) {
    const queue = loadOfflineQueue();
    queue.push(entry);
    saveOfflineQueue(queue);
    renderSyncStatus();
}

function applyLocalPunch({ step, date, timestamp, loc }) {
    const rec = { ...(recordsMap[date] || {}), employee_id: myEmployeeId, date, [step]: timestamp };
    if (loc) rec[`${step}_loc`] = loc;
    recordsMap[date] = rec;
}

async function syncPunch({ step, date, loc, selfie, excessoLegalMin, justificativaExcesso }) {
    try {
        let selfiePath = null;
        if (selfie) {
            selfiePath = `${myEmployeeId}/${date}_${step}_${Date.now()}.jpg`;
            const { error: upErr } = await sb.storage.from('ponto-selfies').upload(selfiePath, dataUrlToBlob(selfie), { contentType: 'image/jpeg' });
            if (upErr) return false;
        }
        const { data: upserted, error } = await sb
            .rpc('punch_time_record', {
                p_date: date,
                p_step: step,
                p_loc: loc,
                p_selfie_path: selfiePath,
            })
            .single();
        if (error || !upserted) return false;
        recordsMap[date] = upserted;
        await sb.from('activity_logs').insert({
            employee_id: myEmployeeId,
            tipo: 'ponto',
            acao: step,
            date,
            valor_registrado: upserted[step],
            operator_email: myEmployee.email,
            operator_name: myEmployee.name,
            operator_profile: 'colaborador',
            justificativa: justificativaExcesso || null,
        });
        if (excessoLegalMin > 0 && justificativaExcesso) {
            await sb
                .rpc('report_daily_overtime_alert', {
                    p_titulo: `Limite legal de horas extras diárias excedido (${minToStr(excessoLegalMin)})`,
                    p_mensagem: `${myEmployee.name} registrou saída com ${minToStr(excessoLegalMin)} de horas extras hoje, acima do limite de ${minToStr(limiteExtraDiarioMin)}/dia (CLT art. 59, §1º). Justificativa: "${justificativaExcesso}"`,
                })
                .catch(() => {});
        }
        return true;
    } catch {
        return false;
    }
}

async function flushOfflineQueue() {
    if (!navigator.onLine) return;
    const queue = loadOfflineQueue();
    if (!queue.length) return;
    let synced = 0;
    while (queue.length) {
        const ok = await syncPunch(queue[0]);
        if (!ok) break;
        queue.shift();
        saveOfflineQueue(queue);
        synced++;
    }
    renderSyncStatus();
    if (synced) {
        renderUI();
        showToast(`${synced} registro${synced > 1 ? 's' : ''} de ponto sincronizado${synced > 1 ? 's' : ''}!`, 'success');
    }
}

function renderSyncStatus() {
    const el = $('ponto-sync-status');
    if (!el) return;
    const pending = loadOfflineQueue().length;
    if (!pending) {
        el.classList.add('hidden');
        return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<i class="fas fa-cloud-arrow-up"></i> ${pending} registro${pending > 1 ? 's' : ''} salvo${pending > 1 ? 's' : ''} offline — sincronizando quando a conexão voltar`;
}

function createSimpleDayPicker(prefix, onChange) {
    const trigger = $(`${prefix}-trigger`);
    const textEl = $(`${prefix}-text`);
    const hidden = $(prefix);
    const popover = $(`${prefix}-popover`);
    const titleEl = $(`${prefix}-title`);
    const gridEl = $(`${prefix}-grid`);
    const prevBtn = $(`${prefix}-prev`);
    const nextBtn = $(`${prefix}-next`);
    if (!trigger || !popover) return null;

    const today = new Date();
    let viewYear = today.getFullYear(),
        viewMonth = today.getMonth();

    function render() {
        titleEl.textContent = `${MESES_PT[viewMonth]} ${viewYear}`;
        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            cells.push({ day: d, muted: false, isToday });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map(
                (c) =>
                    `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}" data-day="${c.day}">${c.day}</button>`
            )
            .join('');
    }

    function reposition() {
        positionFixedPopover(trigger, popover);
    }

    function open() {
        render();
        popover.classList.add('open');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        reposition();
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
        document.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
    }

    function close() {
        popover.classList.remove('open');
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
        document.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
    }

    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }
    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });

    gridEl.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-day]');
        if (!btn || btn.classList.contains('calendar-day--muted')) return;
        const day = Number(btn.dataset.day);
        hidden.value = `${viewYear}-${pad0(viewMonth + 1)}-${pad0(day)}`;
        if (textEl) textEl.textContent = `${pad0(day)}/${pad0(viewMonth + 1)}/${viewYear}`;
        close();
        onChange?.();
    });

    prevBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
        reposition();
    });
    nextBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
        reposition();
    });

    return {
        reset() {
            hidden.value = '';
            if (textEl) textEl.textContent = 'Selecionar data';
            close();
            onChange?.();
        },
    };
}

function setupHorarioPicker() {
    const trigger = $('ajuste-horario-trigger');
    const textEl = $('ajuste-horario-text');
    const hidden = $('ajuste-horario');
    const popover = $('ajuste-horario-popover');
    const hoursCol = $('ajuste-horario-hours');
    const minsCol = $('ajuste-horario-minutes');
    if (!trigger || !popover) return;

    let hour = null,
        minute = null;

    hoursCol.innerHTML = Array.from({ length: 24 }, (_, h) => `<button type="button" class="time-item" data-hour="${h}">${pad0(h)}</button>`).join('');
    minsCol.innerHTML = Array.from({ length: 60 }, (_, m) => `<button type="button" class="time-item" data-min="${m}">${pad0(m)}</button>`).join('');

    function updateValue() {
        if (hour === null || minute === null) return;
        hidden.value = `${pad0(hour)}:${pad0(minute)}`;
        if (textEl) textEl.textContent = hidden.value;
        updateAjusteBtnState();
    }

    function markSelected(col, attr, value) {
        col.querySelectorAll('.time-item').forEach((btn) => btn.classList.toggle('time-item--selected', Number(btn.dataset[attr]) === value));
    }

    function reposition() {
        positionFixedPopover(trigger, popover);
    }

    function open() {
        popover.classList.add('open');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        reposition();
        (hoursCol.querySelector('.time-item--selected') || hoursCol.firstElementChild)?.scrollIntoView({ block: 'center' });
        (minsCol.querySelector('.time-item--selected') || minsCol.firstElementChild)?.scrollIntoView({ block: 'center' });
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
        document.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
    }

    function close() {
        popover.classList.remove('open');
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
        document.removeEventListener('scroll', reposition, true);
        window.removeEventListener('resize', reposition);
    }

    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }
    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });

    hoursCol.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-hour]');
        if (!btn) return;
        hour = Number(btn.dataset.hour);
        markSelected(hoursCol, 'hour', hour);
        updateValue();
    });

    minsCol.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-min]');
        if (!btn) return;
        minute = Number(btn.dataset.min);
        markSelected(minsCol, 'min', minute);
        updateValue();
    });

    window.resetHorarioPicker = function () {
        hour = null;
        minute = null;
        markSelected(hoursCol, 'hour', -1);
        markSelected(minsCol, 'min', -1);
        if (textEl) textEl.textContent = 'Selecionar horário';
        close();
    };
}

window.openModalAjuste = function () {
    ['ajuste-data', 'ajuste-horario', 'ajuste-justificativa'].forEach((id) => {
        const el = $(id);
        if (el) el.value = '';
    });
    const tipo = $('ajuste-tipo');
    if (tipo) tipo.value = '';
    ['err-ajuste-data', 'err-ajuste-tipo', 'err-ajuste-horario', 'err-ajuste-just'].forEach((id) => {
        const el = $(id);
        if (el) el.textContent = '';
    });
    const hg = $('ajuste-horario-group');
    if (hg) hg.classList.remove('hidden');
    ajusteDatePicker?.reset();
    window.resetHorarioPicker?.();
    updateAjusteBtnState();
    openModal('modal-ajuste');
};

window.onAjusteTipoChange = function () {
    const tipo = $('ajuste-tipo')?.value;
    const hg = $('ajuste-horario-group');
    if (hg) hg.classList.toggle('hidden', tipo === 'falta');
    updateAjusteBtnState();
};

function updateAjusteBtnState() {
    const btn = $('btn-ajuste-enviar');
    if (!btn) return;
    const data = $('ajuste-data')?.value.trim() || '';
    const tipo = $('ajuste-tipo')?.value || '';
    const hor = $('ajuste-horario')?.value || '';
    const just = $('ajuste-justificativa')?.value.trim() || '';
    const isFaltaType = tipo === 'falta';
    btn.disabled = !(data && tipo && (isFaltaType || hor) && just);
}
window.updateAjusteBtnState = updateAjusteBtnState;

window.enviarSolicitacao = async function () {
    const data = $('ajuste-data')?.value.trim() || '';
    const tipo = $('ajuste-tipo')?.value || '';
    const hor = $('ajuste-horario')?.value || '';
    const just = $('ajuste-justificativa')?.value.trim() || '';
    const isFaltaType = tipo === 'falta';
    let ok = true;
    const setErr = (id, msg) => {
        const el = $(id);
        if (el) el.textContent = msg;
        if (msg) ok = false;
    };
    setErr('err-ajuste-data', data ? '' : 'Informe a data.');
    setErr('err-ajuste-tipo', tipo ? '' : 'Selecione o tipo.');
    setErr('err-ajuste-horario', isFaltaType || hor ? '' : 'Informe o horário correto.');
    setErr('err-ajuste-just', just ? '' : 'A justificativa é obrigatória.');
    if (!ok) return;

    const { data: inserted, error } = await sb
        .from('adjustment_requests')
        .insert({
            employee_id: myEmployeeId,
            date: data,
            tipo,
            horario: isFaltaType ? null : hor,
            justificativa: just,
        })
        .select()
        .single();

    if (error) {
        showToast('Erro ao enviar solicitação.', 'error');
        return;
    }
    adjRequests.unshift(inserted);
    closeModal('modal-ajuste');
    showToast('Solicitação enviada! Aguarde aprovação do RH.', 'success');
    renderSolicitacoes();
};

function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const φ1 = (lat1 * Math.PI) / 180,
        φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180,
        Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

window.initLocation = function () {
    const dot = $('loc-dot'),
        stxt = $('loc-status-text'),
        locVal = $('map-loc-val'),
        distVal = $('map-dist-val'),
        refreshBtn = document.querySelector('.btn-refresh-loc');
    if (dot) dot.className = 'loc-dot loading';
    if (stxt) stxt.textContent = 'Verificando...';
    if (locVal) locVal.textContent = 'Aguardando permissão...';
    if (refreshBtn) refreshBtn.classList.add('spin');
    renderMapStatic(null);
    if (!navigator.geolocation) {
        if (stxt) stxt.textContent = 'GPS não disponível';
        if (dot) dot.className = 'loc-dot fora';
        if (refreshBtn) refreshBtn.classList.remove('spin');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            const distM = haversineM(userCoords.lat, userCoords.lng, EMPRESA.lat, EMPRESA.lng);
            const dentro = distM <= EMPRESA.raioM;
            if (dot) dot.className = `loc-dot ${dentro ? 'dentro' : 'fora'}`;
            if (stxt) stxt.textContent = dentro ? 'Dentro da empresa' : 'Fora da empresa';
            if (locVal) locVal.textContent = `${userCoords.lat.toFixed(5)}, ${userCoords.lng.toFixed(5)}`;
            if (distVal) distVal.textContent = distM < 1000 ? `${Math.round(distM)} m` : `${(distM / 1000).toFixed(1)} km`;
            renderMapStatic(userCoords);
            if (refreshBtn) refreshBtn.classList.remove('spin');
        },
        (err) => {
            const msg = err.code === 2 ? 'GPS indisponível' : err.code === 3 ? 'Tempo esgotado' : 'Localização negada';
            if (dot) dot.className = 'loc-dot fora';
            if (stxt) stxt.textContent = msg;
            if (locVal) locVal.textContent = msg;
            if (distVal) distVal.textContent = '—';
            renderMapStatic(null);
            if (refreshBtn) refreshBtn.classList.remove('spin');
        },
        { timeout: 10000, maximumAge: 30000 }
    );
};

function ensureLeafletMap() {
    if (leafletMap) return leafletMap;
    const el = $('map-leaflet');
    if (!el || typeof L === 'undefined') return null;

    leafletMap = L.map(el, { zoomControl: true, attributionControl: true }).setView([EMPRESA.lat, EMPRESA.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(leafletMap);

    const empresaIcon = L.divIcon({
        className: '',
        html: '<div class="map-marker-empresa"><i class="fas fa-building"></i></div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
    });
    L.marker([EMPRESA.lat, EMPRESA.lng], { icon: empresaIcon }).addTo(leafletMap).bindPopup(EMPRESA.nome);
    L.circle([EMPRESA.lat, EMPRESA.lng], {
        radius: EMPRESA.raioM,
        color: '#6366f1',
        weight: 1.5,
        dashArray: '6 3',
        fillColor: '#6366f1',
        fillOpacity: 0.08,
    }).addTo(leafletMap);

    return leafletMap;
}

function renderMapStatic(user) {
    const loading = $('map-loading'),
        empEl = $('map-empresa-nome');
    if (empEl) empEl.textContent = EMPRESA.nome;
    const map = ensureLeafletMap();
    if (!map) return;
    if (loading) loading.style.display = 'none';
    setTimeout(() => map.invalidateSize(), 0);

    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }

    if (!user) {
        map.setView([EMPRESA.lat, EMPRESA.lng], 16);
        return;
    }

    const dentro = haversineM(user.lat, user.lng, EMPRESA.lat, EMPRESA.lng) <= EMPRESA.raioM;
    const userIcon = L.divIcon({
        className: '',
        html: `<div class="map-marker-user ${dentro ? 'dentro' : ''}"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
    });
    userMarker = L.marker([user.lat, user.lng], { icon: userIcon })
        .addTo(map)
        .bindPopup(dentro ? 'Você (dentro da empresa)' : 'Você (fora da empresa)');
    routeLine = L.polyline(
        [
            [EMPRESA.lat, EMPRESA.lng],
            [user.lat, user.lng],
        ],
        {
            color: '#6366f1',
            weight: 2,
            dashArray: '6 4',
            opacity: 0.5,
        }
    ).addTo(map);

    map.fitBounds(
        L.latLngBounds([
            [EMPRESA.lat, EMPRESA.lng],
            [user.lat, user.lng],
        ]),
        { padding: [40, 40], maxZoom: 17 }
    );
}

function setupRealtimeSync() {
    sb.channel('ponto-colab')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'time_records', filter: `employee_id=eq.${myEmployeeId}` }, async () => {
            await loadData();
            renderUI();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'adjustment_requests', filter: `employee_id=eq.${myEmployeeId}` }, async () => {
            const { data } = await sb.from('adjustment_requests').select('*').eq('employee_id', myEmployeeId).order('created_at', { ascending: false });
            adjRequests = data || [];
            renderSolicitacoes();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_requests' }, async () => {
            await loadData();
            renderBankRequests();
            renderTeamApprovals();
        })
        .subscribe();
}

function openModal(id) {
    const el = $(id);
    if (el) {
        el.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}
window.closeModal = function (id) {
    const el = $(id);
    if (el) {
        el.classList.remove('open');
        document.body.style.overflow = '';
    }
    if (id === 'modal-confirmar') {
        clearInterval(window._confirmTimer);
        pararCameraSelfie();
    }
};
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach((el) => el.classList.remove('open'));
    document.body.style.overflow = '';
    clearInterval(window._confirmTimer);
    pararCameraSelfie();
}

window.showToast = function (title, type = 'success') {
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${title}</p>
        </div>
        <button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),400)">
            <i class="fas fa-times"></i>
        </button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
};

function showToast(msg, type) {
    window.showToast(msg, type);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadData,
        __setStateForTest(next) {
            if ('myEmployee' in next) myEmployee = next.myEmployee;
            if ('myEmployeeId' in next) myEmployeeId = next.myEmployeeId;
            if ('isManager' in next) isManager = next.isManager;
        },
        __getStateForTest() {
            return { recordsMap, adjRequests, bankRequests, holidaysMap, limiteExtraDiarioMin, teamRequests, isManager };
        },
    };
}
