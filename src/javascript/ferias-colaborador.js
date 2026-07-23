let myEmployee = null;
let myEmployeeId = null;
let myVacations = [];
let colleagues = [];
let availableDays = 0;
let acquisitivePeriod = null;

function positionFixedPopover(trigger, popover) {
    const margin = 8;
    const rect = trigger.getBoundingClientRect();
    const popW = popover.offsetWidth;
    const popH = popover.offsetHeight;

    let left = rect.left;
    left = Math.min(left, window.innerWidth - popW - margin);
    left = Math.max(margin, left);

    let top = rect.bottom + 8;
    if (top + popH > window.innerHeight - margin) {
        const above = rect.top - popH - 8;
        top = above >= margin ? above : Math.max(margin, window.innerHeight - popH - margin);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('colaborador', '*');
    if (!auth) return;
    myEmployeeId = auth.profile.employee_id;
    myEmployee = auth.employee;

    loadSidebarInfo();
    applyContractTypeUI();
    setupDatePickers();
    setupTimelineYearPicker();
    await loadMyVacations();
    await loadColleagues();
    await autoExpireVacations();
    await loadSummary();
    renderHistory();
    renderTimeline();
    renderExpiredBanner();
    setupRealtimeSync();
});

function isEstagioOuAprendiz(emp) {
    const t = (emp?.contract_type || '').toLowerCase();
    return t === 'estagio' || t === 'estágio' || t === 'aprendiz';
}

function applyContractTypeUI() {
    if (!isEstagioOuAprendiz(myEmployee)) return;
    const abonoRow = document.getElementById('req-abono')?.closest('.form-group');
    if (abonoRow) abonoRow.style.display = 'none';
    const hint = document.createElement('p');
    hint.className = 'form-hint-block';
    hint.innerHTML = '<i class="fas fa-circle-info"></i> Como estagiário, seu recesso remunerado segue a Lei do Estágio (11.788/2008) — sem abono pecuniário.';
    document.getElementById('req-obs')?.closest('.form-group')?.before(hint);
}

function loadSidebarInfo() {
    const name = myEmployee.name || '—';
    const color = myEmployee.avatar_color || '#6366f1';
    const ini = name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || '')
        .join('');
    const avatarEl = document.getElementById('sidebar-avatar');
    const nameEl = document.getElementById('sidebar-name');
    const roleEl = document.getElementById('sidebar-role');
    if (avatarEl) {
        if (myEmployee.avatar_url) {
            avatarEl.style.background = `url(${myEmployee.avatar_url}) center/cover`;
            avatarEl.textContent = '';
        } else {
            avatarEl.style.background = color;
            avatarEl.textContent = ini;
        }
    }
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = myEmployee.role || 'Colaborador';
}

window.logout = async function () {
    await sb.auth.signOut();
    window.location.href = '../screens/login.html';
};

async function loadMyVacations() {
    const { data } = await sb.from('vacations').select('*').eq('employee_id', myEmployeeId).order('created_at', { ascending: false });
    myVacations = data || [];
}

async function loadColleagues() {
    const { data } = await sb.from('colleague_directory').select('id,name,dept').neq('id', myEmployeeId);
    colleagues = (data || []).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function getColleague(id) {
    return colleagues.find((c) => c.id === id) || null;
}

function populateSubstitutoSelect() {
    const sel = document.getElementById('req-substituto');
    if (!sel) return;
    sel.innerHTML =
        '<option value="">Nenhum</option>' +
        colleagues.map((c) => `<option value="${c.id}">${escHtml(c.name)}${c.dept ? ' — ' + escHtml(c.dept) : ''}</option>`).join('');
}

async function autoExpireVacations() {
    const today = new Date().toISOString().split('T')[0];
    const toExpire = myVacations.filter((v) => v.status === 'aprovado' && v.end_date < today);
    if (!toExpire.length) return;
    const ids = toExpire.map((v) => v.id);
    await sb.from('vacations').update({ status: 'concluido' }).in('id', ids);
    toExpire.forEach((v) => (v.status = 'concluido'));
}

const TABELA_FALTAS = [
    { max: 5, dias: 30 },
    { max: 14, dias: 24 },
    { max: 23, dias: 18 },
    { max: 32, dias: 12 },
    { max: Infinity, dias: 0 },
];
function diasDireitoPorFaltas(faltas) {
    return TABELA_FALTAS.find((f) => faltas <= f.max).dias;
}

function buildAcquisitiveCycles(admDate, today) {
    const cycles = [];
    let cursor = new Date(admDate);
    while (cursor <= today) {
        const end = new Date(cursor.getFullYear() + 1, cursor.getMonth(), cursor.getDate() - 1);
        cycles.push({ start: new Date(cursor), end });
        cursor = new Date(cursor.getFullYear() + 1, cursor.getMonth(), cursor.getDate());
    }
    return cycles;
}

function idadeEm(birthDate, ref) {
    if (!birthDate) return null;
    const b = new Date(birthDate + 'T00:00:00');
    let idade = ref.getFullYear() - b.getFullYear();
    if (ref.getMonth() < b.getMonth() || (ref.getMonth() === b.getMonth() && ref.getDate() < b.getDate())) idade--;
    return idade;
}

function countFractionsInCycle(cycle) {
    if (!cycle) return [];
    return myVacations.filter(
        (v) =>
            v.status !== 'recusado' &&
            v.status !== 'cancelado' &&
            new Date(v.start_date + 'T00:00:00') >= cycle.start &&
            new Date(v.start_date + 'T00:00:00') <= cycle.end
    );
}

async function calcFaltasInjustificadas(cycleStart, cycleEnd) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rangeEnd = cycleEnd < today ? cycleEnd : today;
    if (rangeEnd < cycleStart) return 0;
    const fmt = (d) => d.toISOString().split('T')[0];

    const [{ data: recs }, { data: hols }, { data: adjs }] = await Promise.all([
        sb.from('time_records').select('date,entrada').eq('employee_id', myEmployeeId).gte('date', fmt(cycleStart)).lte('date', fmt(rangeEnd)),
        sb.from('holidays').select('date'),
        sb
            .from('adjustment_requests')
            .select('date')
            .eq('employee_id', myEmployeeId)
            .eq('tipo', 'falta')
            .eq('status', 'aprovado')
            .gte('date', fmt(cycleStart))
            .lte('date', fmt(rangeEnd)),
    ]);
    const recMap = {};
    (recs || []).forEach((r) => {
        recMap[r.date] = r;
    });
    const holidaySet = new Set((hols || []).map((h) => h.date));
    const justifiedSet = new Set((adjs || []).map((a) => a.date));

    let faltas = 0;
    for (let d = new Date(cycleStart); d <= rangeEnd; d.setDate(d.getDate() + 1)) {
        const key = fmt(d);
        if (d.getDay() === 0 || holidaySet.has(key) || justifiedSet.has(key)) continue;
        const rec = recMap[key];
        if (!rec || !rec.entrada) faltas++;
    }
    return faltas;
}

function computeFeriasVencidas() {
    if (!myEmployee?.admission_date || isEstagioOuAprendiz(myEmployee)) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const admDate = new Date(myEmployee.admission_date + 'T00:00:00');
    const closedCycles = buildAcquisitiveCycles(admDate, today).filter((c) => c.end < today);
    if (!closedCycles.length) return null;

    let usedRemaining = myVacations.filter((v) => v.status === 'aprovado' || v.status === 'concluido').reduce((sum, v) => sum + (v.days || 0), 0);

    let expiredDays = 0,
        oldestConcessivo = null;
    closedCycles.forEach((cycle) => {
        const consumed = Math.min(usedRemaining, 30);
        usedRemaining -= consumed;
        const pending = 30 - consumed;
        if (pending > 0) {
            const concessivo = new Date(cycle.end.getFullYear() + 1, cycle.end.getMonth(), cycle.end.getDate());
            if (today > concessivo) {
                expiredDays += pending;
                if (!oldestConcessivo) oldestConcessivo = concessivo;
            }
        }
    });
    return expiredDays > 0 ? { days: expiredDays, since: oldestConcessivo } : null;
}

function renderExpiredBanner() {
    const el = document.getElementById('expired-banner');
    if (!el) return;
    const vencida = computeFeriasVencidas();
    if (!vencida) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.innerHTML = `<i class="fas fa-triangle-exclamation"></i> Você tem <strong>${vencida.days} dias de férias vencidas</strong> desde ${vencida.since.toLocaleDateString('pt-BR')}. Por lei, o pagamento desses dias deve ser em dobro (art. 137 da CLT) — fale com o RH.`;
    el.classList.remove('hidden');
}

async function loadSummary() {
    const admission = myEmployee.admission_date;
    if (!admission) {
        ['val-saldo', 'val-periodo', 'val-vencer'].forEach((id) => setEl(id, '—'));
        setEl('sub-saldo', 'Data de admissão não informada');
        return;
    }
    const today = new Date();
    const admDate = new Date(admission + 'T00:00:00');
    const months = monthsDiff(admDate, today);
    const periods = Math.floor(months / 12);
    const estagio = isEstagioOuAprendiz(myEmployee);

    let earned = 0;
    if (estagio) {
        earned = periods * 30;
    } else {
        const closedCycles = buildAcquisitiveCycles(admDate, today).filter((c) => c.end < today);
        for (const cycle of closedCycles) {
            const faltas = await calcFaltasInjustificadas(cycle.start, cycle.end);
            earned += diasDireitoPorFaltas(faltas);
        }
    }
    const taken = myVacations.filter((v) => v.status === 'aprovado' || v.status === 'concluido').reduce((s, v) => s + v.days - (v.abono ? 10 : 0), 0);
    availableDays = Math.max(0, earned - taken);
    acquisitivePeriod = calcAcquisitivePeriod(admDate, today);
    const daysLeft = Math.ceil((acquisitivePeriod.end - today) / 86400000);
    const reducedByFaltas = !estagio && periods > 0 ? periods * 30 - earned : 0;

    setEl('val-saldo', `${availableDays} dias`);
    setEl(
        'sub-saldo',
        periods < 1
            ? `Aguardando completar 12 meses (${12 - months} meses restantes)`
            : `${earned} ganhos · ${taken} utilizados${reducedByFaltas > 0 ? ` · reduzido em ${reducedByFaltas}d por faltas` : ''}`
    );
    setEl('val-periodo', `${fmtBR(acquisitivePeriod.start)} – ${fmtBR(acquisitivePeriod.end)}`);
    setEl('sub-periodo', `${daysLeft} dias restantes no ciclo`);

    const card = document.getElementById('card-vencer');
    if (availableDays > 0 && daysLeft <= 60) {
        setEl('val-vencer', `${availableDays} dias`);
        setEl('sub-vencer', `⚠ Vencem em ${daysLeft} dias!`);
        card?.classList.add('summary-card--danger');
    } else if (availableDays > 0 && daysLeft <= 120) {
        setEl('val-vencer', `${availableDays} dias`);
        setEl('sub-vencer', `Vencem em ${daysLeft} dias`);
        card?.classList.add('summary-card--warning');
    } else {
        setEl('val-vencer', `${availableDays} dias`);
        setEl('sub-vencer', availableDays > 0 ? 'Nenhum alerta no momento' : 'Saldo zerado');
    }

    updateRequestBtn(periods);
}

function updateRequestBtn(periods) {
    const btn = document.getElementById('btn-solicitar');
    if (!btn) return;
    if (periods < 1) {
        btn.disabled = true;
        btn.title = 'Disponível após 12 meses';
        btn.style.opacity = '0.5';
    } else if (availableDays <= 0) {
        btn.disabled = true;
        btn.title = 'Sem saldo de férias';
        btn.style.opacity = '0.5';
    }
}

function calcAcquisitivePeriod(admDate, today) {
    const start = new Date(admDate);
    while (new Date(start.getFullYear() + 1, start.getMonth(), start.getDate()) <= today) {
        start.setFullYear(start.getFullYear() + 1);
    }
    const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
    return { start, end };
}

let timelineYear = new Date().getFullYear();

function closeTimelineYearPopover() {
    const popover = document.getElementById('timeline-year-popover');
    const trigger = document.getElementById('timeline-year-trigger');
    popover?.classList.remove('open');
    trigger?.classList.remove('active');
    trigger?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onTimelineYearOutsideClick);
    document.removeEventListener('keydown', onTimelineYearEscape);
}

function onTimelineYearOutsideClick(e) {
    const popover = document.getElementById('timeline-year-popover');
    const trigger = document.getElementById('timeline-year-trigger');
    if (!popover || !trigger) return;
    if (!popover.contains(e.target) && !trigger.contains(e.target)) closeTimelineYearPopover();
}
function onTimelineYearEscape(e) {
    if (e.key === 'Escape') closeTimelineYearPopover();
}

function openTimelineYearPopover() {
    const popover = document.getElementById('timeline-year-popover');
    const trigger = document.getElementById('timeline-year-trigger');
    if (!popover || !trigger) return;

    const currentYear = new Date().getFullYear();
    const years = new Set();
    for (let y = currentYear - 6; y <= currentYear; y++) years.add(y);
    myVacations.forEach((v) => {
        years.add(new Date(v.start_date + 'T00:00:00').getFullYear());
        years.add(new Date(v.end_date + 'T00:00:00').getFullYear());
    });
    if (myEmployee?.admission_date) years.add(new Date(myEmployee.admission_date + 'T00:00:00').getFullYear());
    const sorted = [...years].sort((a, b) => b - a);

    popover.innerHTML = sorted
        .map(
            (y) =>
                `<button type="button" class="timeline-year-option${y === timelineYear ? ' timeline-year-option--selected' : ''}" data-year="${y}">${y}</button>`
        )
        .join('');

    popover.classList.add('open');
    trigger.classList.add('active');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onTimelineYearOutsideClick);
    document.addEventListener('keydown', onTimelineYearEscape);
}

function setupTimelineYearPicker() {
    const trigger = document.getElementById('timeline-year-trigger');
    const popover = document.getElementById('timeline-year-popover');
    if (!trigger || !popover) return;

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? closeTimelineYearPopover() : openTimelineYearPopover();
    });

    popover.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-year]');
        if (!btn) return;
        timelineYear = Number(btn.dataset.year);
        closeTimelineYearPopover();
        renderTimeline();
    });
}

function renderTimeline() {
    const year = timelineYear;
    setEl('timeline-year', String(year));
    const monthsEl = document.getElementById('timeline-months');
    if (monthsEl)
        monthsEl.innerHTML = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'].map((m) => `<span>${m}</span>`).join('');
    const barsEl = document.getElementById('timeline-bars');
    if (!barsEl) return;
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const totalMs = yearEnd - yearStart + 86400000;
    const toShow = myVacations.filter((v) => {
        const s = new Date(v.start_date + 'T00:00:00');
        const e = new Date(v.end_date + 'T00:00:00');
        return (s.getFullYear() === year || e.getFullYear() === year) && v.status !== 'recusado' && v.status !== 'cancelado';
    });
    if (toShow.length === 0) {
        barsEl.innerHTML = '<span class="tl-empty">Sem férias registradas para este ano</span>';
        return;
    }
    barsEl.innerHTML = '';
    toShow.forEach((v) => {
        const s = clampDate(new Date(v.start_date + 'T00:00:00'), yearStart, yearEnd);
        const e = clampDate(new Date(v.end_date + 'T00:00:00'), yearStart, yearEnd);
        const left = ((s - yearStart) / totalMs) * 100;
        const width = Math.max(((e - s + 86400000) / totalMs) * 100, 0.5);
        const cls = { aprovado: 'tl-bar--approved', pendente: 'tl-bar--pending', concluido: 'tl-bar--concluded', recusado: 'tl-bar--rejected' }[v.status] || '';
        const bar = document.createElement('div');
        bar.className = `tl-bar ${cls}`;
        bar.style.left = `${left}%`;
        bar.style.width = `${width}%`;
        bar.title = `${fmtBR(new Date(v.start_date + 'T00:00:00'))} → ${fmtBR(new Date(v.end_date + 'T00:00:00'))} · ${v.days} dias`;
        barsEl.appendChild(bar);
    });
    if (year === new Date().getFullYear()) {
        const todayPct = ((new Date() - yearStart) / totalMs) * 100;
        const marker = document.createElement('div');
        marker.className = 'tl-today';
        marker.style.left = `${todayPct}%`;
        marker.title = 'Hoje';
        barsEl.appendChild(marker);
    }
}

function icsDate(dateStr) {
    return dateStr.replace(/-/g, '');
}

function icsDateExclusiveEnd(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function buildIcsContent(title, startDate, endDate, description) {
    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const uid = `ferias-${startDate}-${endDate}-${Math.random().toString(36).slice(2)}@nexus`;
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Nexus//Ferias//PT-BR',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${icsDate(startDate)}`,
        `DTEND;VALUE=DATE:${icsDateExclusiveEnd(endDate)}`,
        `SUMMARY:${title}`,
        `DESCRIPTION:${description}`,
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');
}

window.downloadIcs = function (id) {
    const v = myVacations.find((v) => v.id === id);
    if (!v) return;
    const title = `Férias — ${myEmployee.name}`;
    const desc = `Período de férias de ${fmtBR(new Date(v.start_date + 'T00:00:00'))} a ${fmtBR(new Date(v.end_date + 'T00:00:00'))} (${v.days} dias).`;
    const blob = new Blob([buildIcsContent(title, v.start_date, v.end_date, desc)], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `minhas_ferias_${v.start_date}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};

window.openGoogleCalendar = function (id) {
    const v = myVacations.find((v) => v.id === id);
    if (!v) return;
    const title = encodeURIComponent(`Férias — ${myEmployee.name}`);
    const details = encodeURIComponent(
        `Período de férias de ${fmtBR(new Date(v.start_date + 'T00:00:00'))} a ${fmtBR(new Date(v.end_date + 'T00:00:00'))} (${v.days} dias).`
    );
    const dates = `${icsDate(v.start_date)}/${icsDateExclusiveEnd(v.end_date)}`;
    window.open(`https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}`, '_blank');
};

function renderHistory() {
    const list = document.getElementById('history-list');
    const emptyEl = document.getElementById('history-empty');
    if (!list) return;
    list.querySelectorAll('.history-card').forEach((c) => c.remove());
    const sorted = [...myVacations].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sorted.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    sorted.forEach((v, i) => list.appendChild(buildHistoryCard(v, i)));
}

function buildHistoryCard(v, i = 0) {
    const STATUS = {
        pendente: { label: 'Pendente', cls: 'badge--pending', icon: 'fa-clock' },
        aprovado: { label: 'Aprovado', cls: 'badge--approved', icon: 'fa-check-circle' },
        recusado: { label: 'Recusado', cls: 'badge--rejected', icon: 'fa-times-circle' },
        concluido: { label: 'Concluído', cls: 'badge--concluded', icon: 'fa-flag-checkered' },
        cancelado: { label: 'Cancelado', cls: 'badge--cancelled', icon: 'fa-ban' },
    };
    const s = STATUS[v.status] || STATUS.pendente;
    const substituto = v.substituto_id ? getColleague(v.substituto_id) : null;
    const el = document.createElement('div');
    el.className = 'history-card';
    el.style.animationDelay = `${Math.min(i * 0.05, 0.4)}s`;
    el.innerHTML = `
        <div class="hc-left">
            <div class="hc-icon"><i class="fas fa-umbrella-beach"></i></div>
            <div class="hc-info">
                <p class="hc-period">${fmtBR(new Date(v.start_date + 'T00:00:00'))} &rarr; ${fmtBR(new Date(v.end_date + 'T00:00:00'))}</p>
                <div class="hc-meta">
                    <span class="hc-meta-item"><i class="fas fa-calendar-day"></i> ${v.days} dias</span>
                    ${v.abono ? '<span class="tag-abono"><i class="fas fa-hand-holding-usd"></i> Abono Pecuniário</span>' : ''}
                    ${v.coletiva ? '<span class="tag-abono tag-coletiva"><i class="fas fa-users"></i> Coletiva</span>' : ''}
                    ${substituto ? `<span class="hc-meta-item"><i class="fas fa-user-group"></i> Cobertura: ${escHtml(substituto.name)}</span>` : ''}
                    <span class="hc-date">Solicitado em ${fmtBR(new Date(v.created_at))}</span>
                </div>
            </div>
        </div>
        <div class="hc-right">
            <span class="badge ${s.cls}"><i class="fas ${s.icon}"></i> ${s.label}</span>
            ${v.status === 'recusado' ? `<button class="btn-motivo" onclick="showReason(${JSON.stringify(v.rejection_reason || 'Motivo não informado.')})">Ver motivo</button>` : ''}
            ${v.status === 'pendente' ? `<button class="btn-motivo btn-motivo--danger" onclick="cancelRequest('${v.id}')">Cancelar</button>` : ''}
            ${
                v.status === 'aprovado' || v.status === 'concluido'
                    ? `
                <div class="hc-cal-actions">
                    <button class="btn-cal-sm" title="Adicionar ao Google Calendar" onclick="openGoogleCalendar('${v.id}')"><i class="fab fa-google"></i></button>
                    <button class="btn-cal-sm" title="Baixar .ics (Outlook)" onclick="downloadIcs('${v.id}')"><i class="fas fa-file-arrow-down"></i></button>
                </div>`
                    : ''
            }
        </div>`;
    return el;
}

window.cancelRequest = async function (id) {
    if (!confirm('Cancelar esta solicitação de férias pendente?')) return;
    const { error } = await sb.from('vacations').update({ status: 'cancelado' }).eq('id', id).eq('status', 'pendente');
    if (error) {
        showToast('Erro ao cancelar. Tente novamente.', 'error');
        return;
    }
    const vac = myVacations.find((v) => v.id === id);
    if (vac) vac.status = 'cancelado';
    renderHistory();
    renderTimeline();
    await loadSummary();
    showToast('Solicitação cancelada.', 'info');
};

let openModalCount = 0;
function lockBodyScroll() {
    openModalCount++;
    document.body.style.overflow = 'hidden';
}
function unlockBodyScroll() {
    openModalCount = Math.max(0, openModalCount - 1);
    if (openModalCount === 0) document.body.style.overflow = '';
}

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

let startPicker = null;
let endPicker = null;
const allDatePickers = [];

function createDatePicker(prefix, { getMin, getMax, onSelect } = {}) {
    const trigger = document.getElementById(`${prefix}-trigger`);
    const textEl = document.getElementById(`${prefix}-text`);
    const hidden = document.getElementById(prefix);
    const popover = document.getElementById(`${prefix}-popover`);
    const titleEl = document.getElementById(`${prefix}-title`);
    const gridEl = document.getElementById(`${prefix}-grid`);
    const prevBtn = document.getElementById(`${prefix}-prev`);
    const nextBtn = document.getElementById(`${prefix}-next`);
    if (!trigger || !popover) return null;

    let viewYear,
        viewMonth,
        selected = null;

    const sameDay = (a, b) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    function render() {
        titleEl.textContent = `${MESES_PT[viewMonth]} ${viewYear}`;
        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const min = getMin?.() || null;
        const max = getMax?.() || null;

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(viewYear, viewMonth, d);
            cells.push({
                day: d,
                muted: false,
                date,
                isToday: sameDay(date, today),
                isSelected: sameDay(date, selected),
                disabled: (min && date < min) || (max && date > max),
            });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map((c) => {
                if (c.muted) return `<button type="button" class="calendar-day calendar-day--muted" disabled>${c.day}</button>`;
                const cls = ['calendar-day'];
                if (c.isToday) cls.push('calendar-day--today');
                if (c.isSelected) cls.push('calendar-day--selected');
                return `<button type="button" class="${cls.join(' ')}" data-date="${toISO(c.date)}" ${c.disabled ? 'disabled' : ''}>${c.day}</button>`;
            })
            .join('');
    }

    function reposition() {
        positionFixedPopover(trigger, popover);
    }

    function open() {
        allDatePickers.forEach((p) => p !== api && p.close());
        const base = selected || getMin?.() || new Date();
        viewYear = base.getFullYear();
        viewMonth = base.getMonth();
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
        const btn = e.target.closest('button[data-date]');
        if (!btn || btn.disabled) return;
        const [y, m, d] = btn.dataset.date.split('-').map(Number);
        selected = new Date(y, m - 1, d);
        if (hidden) hidden.value = btn.dataset.date;
        if (textEl) textEl.textContent = fmtBR(selected);
        render();
        close();
        onSelect?.();
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

    const api = {
        close,
        reset() {
            selected = null;
            if (hidden) hidden.value = '';
            if (textEl) textEl.textContent = 'Selecionar data';
            close();
        },
    };
    allDatePickers.push(api);
    return api;
}

function setupDatePickers() {
    startPicker = createDatePicker('req-start', {
        getMin: () => addDays(new Date(new Date().setHours(0, 0, 0, 0)), 30),
        onSelect: () => calcDays(),
    });
    endPicker = createDatePicker('req-end', {
        getMin: () => {
            const v = document.getElementById('req-start')?.value;
            return v ? new Date(v + 'T00:00:00') : addDays(new Date(new Date().setHours(0, 0, 0, 0)), 30);
        },
        onSelect: () => calcDays(),
    });
}

function currentCycleFor(refDate) {
    if (!myEmployee?.admission_date) return null;
    const admDate = new Date(myEmployee.admission_date + 'T00:00:00');
    const cycles = buildAcquisitiveCycles(admDate, refDate);
    return cycles.length ? cycles[cycles.length - 1] : null;
}

function renderFractionInfo(refDate) {
    const el = document.getElementById('fraction-info');
    if (!el || isEstagioOuAprendiz(myEmployee)) {
        if (el) el.classList.add('hidden');
        return;
    }
    const cycle = currentCycleFor(refDate);
    const count = countFractionsInCycle(cycle).length;
    el.innerHTML = `<i class="fas fa-layer-group"></i> Fração <strong>${count + 1} de 3</strong> permitidas neste período aquisitivo (art. 134 §1º CLT).`;
    el.classList.remove('hidden');
}

window.openRequestModal = function () {
    startPicker?.reset();
    endPicker?.reset();
    const abonoEl = document.getElementById('req-abono');
    if (abonoEl) {
        abonoEl.checked = false;
        abonoEl.disabled = true;
    }
    const obs = document.getElementById('req-obs');
    if (obs) obs.value = '';
    populateSubstitutoSelect();
    setEl('days-count', 'Define as datas para ver o total de dias');
    document.getElementById('days-preview')?.setAttribute('class', 'days-preview');
    renderFractionInfo(new Date());
    hideAlert();
    setConfirmDisabled(true);
    document.getElementById('request-modal')?.classList.add('open');
    lockBodyScroll();
};

window.closeRequestModal = function () {
    document.getElementById('request-modal')?.classList.remove('open');
    unlockBodyScroll();
};

function fmtBRLFerias(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function updateValorFeriasPreview(days, abono) {
    const wrap = document.getElementById('valor-ferias-preview');
    if (!wrap) return;
    const salario = Number(myEmployee?.salary) || 0;
    if (!salario || !days || days <= 0) {
        wrap.classList.add('hidden');
        return;
    }

    const diaria = salario / 30;
    const diasDescanso = abono ? days - 10 : days;
    const valorFerias = diaria * diasDescanso;
    const tercoFerias = valorFerias / 3;
    const valorAbono = abono ? diaria * 10 : 0;
    const tercoAbono = abono ? valorAbono / 3 : 0;
    const total = valorFerias + tercoFerias + valorAbono + tercoAbono;

    const rows = [
        `<div class="vfp-row"><span>Férias (${diasDescanso}d)</span><strong>${fmtBRLFerias(valorFerias)}</strong></div>`,
        `<div class="vfp-row"><span>1/3 constitucional</span><strong>${fmtBRLFerias(tercoFerias)}</strong></div>`,
    ];
    if (abono) {
        rows.push(`<div class="vfp-row"><span>Abono pecuniário (10d)</span><strong>${fmtBRLFerias(valorAbono)}</strong></div>`);
        rows.push(`<div class="vfp-row"><span>1/3 sobre o abono</span><strong>${fmtBRLFerias(tercoAbono)}</strong></div>`);
    }
    setEl('valor-ferias-rows', rows.join(''));
    setEl('valor-ferias-total', fmtBRLFerias(total));
    wrap.classList.remove('hidden');
}

window.calcDays = function () {
    const startVal = document.getElementById('req-start')?.value;
    const endVal = document.getElementById('req-end')?.value;
    const abonoEl = document.getElementById('req-abono');
    const preview = document.getElementById('days-preview');
    const countEl = document.getElementById('days-count');
    const hint = document.getElementById('abono-hint');
    hideAlert();
    if (!startVal || !endVal) {
        if (countEl) countEl.textContent = 'Define as datas para ver o total de dias';
        if (preview) preview.className = 'days-preview';
        setConfirmDisabled(true);
        document.getElementById('valor-ferias-preview')?.classList.add('hidden');
        return;
    }
    const s = new Date(startVal + 'T00:00:00');
    const e = new Date(endVal + 'T00:00:00');
    const days = Math.round((e - s) / 86400000) + 1;
    if (days <= 0) {
        if (countEl) countEl.textContent = 'A data de fim deve ser após o início';
        if (preview) preview.className = 'days-preview days-preview--error';
        setConfirmDisabled(true);
        document.getElementById('valor-ferias-preview')?.classList.add('hidden');
        return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const advance = Math.round((s - today) / 86400000);
    const errors = [];
    if (advance < 30) errors.push(`Antecedência mínima de 30 dias (a partir de ${fmtBR(addDays(today, 30))})`);
    if (days > availableDays) errors.push(`Saldo insuficiente — você tem apenas ${availableDays} dias disponíveis`);
    if (days < 5) errors.push('O período mínimo de férias é de 5 dias corridos');

    renderFractionInfo(s);
    if (!isEstagioOuAprendiz(myEmployee)) {
        const cycle = currentCycleFor(s);
        const others = countFractionsInCycle(cycle);
        const fractionNumber = others.length + 1;
        if (fractionNumber > 3) errors.push('Você já utilizou as 3 frações de férias permitidas neste período aquisitivo (art. 134 §1º CLT)');
        else if (fractionNumber === 3 && !others.some((v) => (v.days || 0) >= 14) && days < 14)
            errors.push('Ao menos uma fração deve ter 14 dias corridos ou mais — esta seria sua última fração disponível neste ciclo (art. 134 §1º CLT)');
        const idade = idadeEm(myEmployee.birth_date, s);
        if (idade !== null && (idade < 18 || idade >= 50) && fractionNumber > 1)
            errors.push('Menores de 18 ou maiores de 50 anos devem gozar as férias em período único (art. 134 §2º CLT)');
    }

    if (abonoEl) {
        if (days >= 20 && errors.length === 0) {
            abonoEl.disabled = false;
            if (hint) hint.textContent = 'Você pode converter 10 dias em pagamento adicional.';
        } else {
            abonoEl.disabled = true;
            abonoEl.checked = false;
            if (hint) hint.textContent = days < 20 ? 'Disponível somente para 20 dias ou mais.' : '';
        }
    }
    const abono = abonoEl?.checked && days >= 20;
    let daysText = `${days} ${days === 1 ? 'dia selecionado' : 'dias selecionados'}`;
    if (abono) daysText += ` · ${days - 10} de descanso + 10 de abono`;
    if (countEl) countEl.textContent = daysText;
    if (errors.length > 0) {
        showAlert(errors.map((e) => `<i class="fas fa-exclamation-triangle"></i> ${e}`).join('<br>'));
        if (preview) preview.className = 'days-preview days-preview--error';
        setConfirmDisabled(true);
        document.getElementById('valor-ferias-preview')?.classList.add('hidden');
    } else {
        if (preview) preview.className = 'days-preview days-preview--ok';
        setConfirmDisabled(false);
        updateValorFeriasPreview(days, abono);
    }
};

window.submitRequest = async function () {
    const startVal = document.getElementById('req-start')?.value;
    const endVal = document.getElementById('req-end')?.value;
    const abono = document.getElementById('req-abono')?.checked ?? false;
    const substitutoId = document.getElementById('req-substituto')?.value || null;
    const obs = document.getElementById('req-obs')?.value.trim() ?? '';
    if (!startVal || !endVal) {
        showAlert('<i class="fas fa-exclamation-triangle"></i> Selecione as datas de início e fim.');
        return;
    }
    const s = new Date(startVal + 'T00:00:00');
    const e = new Date(endVal + 'T00:00:00');
    const days = Math.round((e - s) / 86400000) + 1;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (Math.round((s - today) / 86400000) < 30) {
        showAlert('<i class="fas fa-exclamation-triangle"></i> Antecedência mínima de 30 dias.');
        return;
    }
    if (days > availableDays) {
        showAlert(`<i class="fas fa-exclamation-triangle"></i> Saldo insuficiente (${availableDays} dias disponíveis).`);
        return;
    }
    if (days < 5) {
        showAlert('<i class="fas fa-exclamation-triangle"></i> Período mínimo de 5 dias.');
        return;
    }

    if (!isEstagioOuAprendiz(myEmployee)) {
        const cycle = currentCycleFor(s);
        const others = countFractionsInCycle(cycle);
        const fractionNumber = others.length + 1;
        if (fractionNumber > 3) {
            showAlert('<i class="fas fa-exclamation-triangle"></i> Você já utilizou as 3 frações de férias permitidas neste período aquisitivo.');
            return;
        }
        if (fractionNumber === 3 && !others.some((v) => (v.days || 0) >= 14) && days < 14) {
            showAlert('<i class="fas fa-exclamation-triangle"></i> Ao menos uma fração deve ter 14 dias corridos ou mais.');
            return;
        }
        const idade = idadeEm(myEmployee.birth_date, s);
        if (idade !== null && (idade < 18 || idade >= 50) && fractionNumber > 1) {
            showAlert('<i class="fas fa-exclamation-triangle"></i> Menores de 18 ou maiores de 50 anos devem gozar as férias em período único.');
            return;
        }
    }

    const btn = document.getElementById('btn-confirm');
    if (btn) btn.disabled = true;

    const { data, error } = await sb
        .from('vacations')
        .insert({
            employee_id: myEmployeeId,
            start_date: startVal,
            end_date: endVal,
            days,
            abono: abono && days >= 20,
            substituto_id: substitutoId,
            obs,
            status: 'pendente',
        })
        .select()
        .single();

    if (btn) btn.disabled = false;

    if (error) {
        showAlert('<i class="fas fa-exclamation-triangle"></i> Erro ao enviar solicitação. Tente novamente.');
        return;
    }

    myVacations.unshift(data);
    closeRequestModal();
    showToast('Solicitação enviada! Aguardando aprovação do RH.', 'success');
    await autoExpireVacations();
    await loadSummary();
    renderHistory();
    renderTimeline();
    renderExpiredBanner();
};

window.showReason = function (reason) {
    setEl('detail-reason', reason || 'Motivo não informado.');
    document.getElementById('detail-modal')?.classList.add('open');
    lockBodyScroll();
};

window.closeDetailModal = function () {
    document.getElementById('detail-modal')?.classList.remove('open');
    unlockBodyScroll();
};

window.handleOverlayClick = function (e, modalId) {
    if (e.target !== e.currentTarget) return;
    if (modalId === 'request-modal') {
        closeRequestModal();
        return;
    }
    if (modalId === 'detail-modal') {
        closeDetailModal();
        return;
    }
    document.getElementById(modalId)?.classList.remove('open');
};

function setupRealtimeSync() {
    sb.channel('vacations-colab')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vacations', filter: `employee_id=eq.${myEmployeeId}` }, async (payload) => {
            const STATUS_MSGS = {
                aprovado: { text: 'Suas férias foram aprovadas pelo RH!', type: 'success' },
                recusado: { text: 'Sua solicitação foi recusada. Veja o motivo no histórico.', type: 'error' },
                concluido: { text: 'Suas férias foram concluídas.', type: 'info' },
            };
            if (payload.old?.status && payload.new?.status !== payload.old?.status) {
                const m = STATUS_MSGS[payload.new.status];
                if (m) showToast(m.text, m.type);
            }
            await loadMyVacations();
            await autoExpireVacations();
            await loadSummary();
            renderHistory();
            renderTimeline();
            renderExpiredBanner();
        })
        .subscribe();
}

function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}
function clampDate(d, mn, mx) {
    return d < mn ? new Date(mn) : d > mx ? new Date(mx) : d;
}
function fmtBR(d) {
    if (!d || isNaN(d)) return '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function escHtml(str) {
    if (typeof str !== 'string') return str ?? '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function setEl(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}
function monthsDiff(a, b) {
    return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
}
function setConfirmDisabled(v) {
    const b = document.getElementById('btn-confirm');
    if (b) b.disabled = v;
}
function showAlert(html) {
    const el = document.getElementById('modal-alert');
    if (!el) return;
    el.innerHTML = html;
    el.classList.add('show');
}
function hideAlert() {
    const el = document.getElementById('modal-alert');
    if (el) {
        el.innerHTML = '';
        el.classList.remove('show');
    }
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    const titles = { success: 'Sucesso', error: 'Erro', warning: 'Atenção', info: 'Info' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<div class="toast-icon"><i class="fas ${icons[type] || 'fa-check'}"></i></div><div class="toast-content"><p class="toast-title">${titles[type] || 'Aviso'}</p><p class="toast-msg">${msg}</p></div><button class="toast-close" onclick="this.closest('.toast').remove()"><i class="fas fa-times"></i></button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}
