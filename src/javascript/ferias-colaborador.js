const VACATIONS_KEY = 'nexus_vacations';
let session = null;
let availableDays = 0;
let acquisitivePeriod = null;

document.addEventListener('DOMContentLoaded', () => {
    session = JSON.parse(localStorage.getItem('nexus_session') || 'null');
    if (!session || session.profile !== 'colaborador') {
        window.location.href = '../screens/login.html';
        return;
    }
    autoExpireVacations();
    loadSummary();
    renderHistory();
    renderTimeline();
    setupRealtimeSync();
});

// ── Vacation calculation ──────────────────────────────

function autoExpireVacations() {
    const today = todayDate();
    const vacs  = getVacations();
    let changed = false;
    vacs.forEach(v => {
        if (v.status === 'aprovado' && v.endDate < today) {
            v.status    = 'concluido';
            v.concludedAt = new Date().toISOString();
            changed = true;
        }
    });
    if (changed) saveVacations(vacs);
}

function loadSummary() {
    const admission = session.admissionDate;
    if (!admission) {
        setEl('val-saldo',   '—');
        setEl('val-periodo', '—');
        setEl('val-vencer',  '—');
        setEl('sub-saldo',   'Data de admissão não informada');
        return;
    }

    const today    = new Date();
    const admDate  = new Date(admission + 'T00:00:00');
    const months   = monthsDiff(admDate, today);
    const periods  = Math.floor(months / 12);
    const earned   = periods * 30;

    const myVacs   = getMyVacations();
    const taken    = myVacs
        .filter(v => v.status === 'aprovado' || v.status === 'concluido')
        .reduce((s, v) => s + v.days - (v.hasAbono ? 10 : 0), 0);

    availableDays  = Math.max(0, earned - taken);

    // Acquisition period
    acquisitivePeriod = calcAcquisitivePeriod(admDate, today);

    const daysLeft = Math.ceil((acquisitivePeriod.end - today) / 86400000);

    // Saldo card
    setEl('val-saldo', `${availableDays} dias`);
    if (periods < 1) {
        setEl('sub-saldo', `Aguardando completar 12 meses (${12 - months} meses restantes)`);
    } else {
        setEl('sub-saldo', `${earned} ganhos · ${taken} utilizados`);
    }

    // Período aquisitivo card
    setEl('val-periodo', `${fmtBR(acquisitivePeriod.start)} – ${fmtBR(acquisitivePeriod.end)}`);
    setEl('sub-periodo', `${daysLeft} dias restantes no ciclo`);

    // Vencer card
    const card = document.getElementById('card-vencer');
    if (availableDays > 0 && daysLeft <= 60) {
        setEl('val-vencer',  `${availableDays} dias`);
        setEl('sub-vencer',  `⚠ Vencem em ${daysLeft} dias!`);
        card?.classList.add('summary-card--danger');
        document.querySelector('#card-vencer .summary-icon-wrap')?.classList.replace('summary-icon--warning', 'summary-icon--danger');
    } else if (availableDays > 0 && daysLeft <= 120) {
        setEl('val-vencer',  `${availableDays} dias`);
        setEl('sub-vencer',  `Vencem em ${daysLeft} dias`);
        card?.classList.add('summary-card--warning');
    } else {
        setEl('val-vencer',  availableDays > 0 ? `${availableDays} dias` : '0 dias');
        setEl('sub-vencer',  availableDays > 0 ? 'Nenhum alerta no momento' : 'Saldo zerado');
    }

    updateRequestBtn(periods);
}

function updateRequestBtn(periods) {
    const btn = document.getElementById('btn-solicitar');
    if (!btn) return;
    if (periods < 1) {
        btn.disabled = true;
        btn.title    = 'Disponível após 12 meses de trabalho';
        btn.style.opacity = '0.5';
    } else if (availableDays <= 0) {
        btn.disabled = true;
        btn.title    = 'Sem saldo de férias disponível';
        btn.style.opacity = '0.5';
    }
}

function calcAcquisitivePeriod(admDate, today) {
    let start = new Date(admDate);
    while (new Date(start.getFullYear() + 1, start.getMonth(), start.getDate()) <= today) {
        start.setFullYear(start.getFullYear() + 1);
    }
    const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
    return { start, end };
}

// ── Timeline ─────────────────────────────────────────

function renderTimeline() {
    const year  = new Date().getFullYear();
    setEl('timeline-year', String(year));

    const monthsEl = document.getElementById('timeline-months');
    if (monthsEl) {
        const labels = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        monthsEl.innerHTML = labels.map(m => `<span>${m}</span>`).join('');
    }

    const barsEl = document.getElementById('timeline-bars');
    if (!barsEl) return;

    const yearStart = new Date(year, 0, 1);
    const yearEnd   = new Date(year, 11, 31);
    const totalMs   = yearEnd - yearStart + 86400000;

    const myVacs = getMyVacations().filter(v => {
        const s = new Date(v.startDate + 'T00:00:00');
        const e = new Date(v.endDate   + 'T00:00:00');
        return (s.getFullYear() === year || e.getFullYear() === year) && v.status !== 'recusado';
    });

    if (myVacs.length === 0) {
        barsEl.innerHTML = '<span class="tl-empty">Sem férias registradas para este ano</span>';
    } else {
        barsEl.innerHTML = '';
        myVacs.forEach(v => {
            const s = clampDate(new Date(v.startDate + 'T00:00:00'), yearStart, yearEnd);
            const e = clampDate(new Date(v.endDate   + 'T00:00:00'), yearStart, yearEnd);
            const left  = ((s - yearStart) / totalMs) * 100;
            const width = Math.max(((e - s + 86400000) / totalMs) * 100, 0.5);
            const cls   = { aprovado:'tl-bar--approved', pendente:'tl-bar--pending', concluido:'tl-bar--concluded', recusado:'tl-bar--rejected' }[v.status] || '';
            const bar   = document.createElement('div');
            bar.className = `tl-bar ${cls}`;
            bar.style.left  = `${left}%`;
            bar.style.width = `${width}%`;
            bar.title = `${fmtBR(new Date(v.startDate + 'T00:00:00'))} → ${fmtBR(new Date(v.endDate + 'T00:00:00'))} · ${v.days} dias`;
            barsEl.appendChild(bar);
        });
    }

    // Today marker
    const today    = new Date();
    if (today.getFullYear() === year) {
        const todayPct = ((today - yearStart) / totalMs) * 100;
        const marker   = document.createElement('div');
        marker.className = 'tl-today';
        marker.style.left = `${todayPct}%`;
        marker.title = 'Hoje';
        barsEl.appendChild(marker);
    }
}

// ── History ───────────────────────────────────────────

function renderHistory() {
    const list    = document.getElementById('history-list');
    const emptyEl = document.getElementById('history-empty');
    if (!list) return;

    list.querySelectorAll('.history-card').forEach(c => c.remove());

    const myVacs = getMyVacations().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (myVacs.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    myVacs.forEach(v => list.appendChild(buildHistoryCard(v)));
}

function buildHistoryCard(v) {
    const STATUS = {
        pendente:  { label:'Pendente',  cls:'badge--pending',   icon:'fa-clock' },
        aprovado:  { label:'Aprovado',  cls:'badge--approved',  icon:'fa-check-circle' },
        recusado:  { label:'Recusado',  cls:'badge--rejected',  icon:'fa-times-circle' },
        concluido: { label:'Concluído', cls:'badge--concluded', icon:'fa-flag-checkered' },
    };
    const s  = STATUS[v.status] || STATUS.pendente;
    const el = document.createElement('div');
    el.className = 'history-card';
    el.innerHTML = `
        <div class="hc-left">
            <div class="hc-icon"><i class="fas fa-umbrella-beach"></i></div>
            <div class="hc-info">
                <p class="hc-period">${fmtBR(new Date(v.startDate+'T00:00:00'))} &rarr; ${fmtBR(new Date(v.endDate+'T00:00:00'))}</p>
                <div class="hc-meta">
                    <span class="hc-meta-item"><i class="fas fa-calendar-day"></i> ${v.days} dias</span>
                    ${v.hasAbono ? '<span class="tag-abono"><i class="fas fa-hand-holding-usd"></i> Abono Pecuniário</span>' : ''}
                    <span class="hc-date">Solicitado em ${fmtBR(new Date(v.createdAt))}</span>
                </div>
            </div>
        </div>
        <div class="hc-right">
            <span class="badge ${s.cls}"><i class="fas ${s.icon}"></i> ${s.label}</span>
            ${v.status === 'recusado'
                ? `<button class="btn-motivo" onclick="showReason(${JSON.stringify(v.rejectionReason || 'Motivo não informado.')})">Ver motivo</button>`
                : ''}
        </div>`;
    return el;
}

// ── Request Modal ─────────────────────────────────────

window.openRequestModal = function () {
    const min = new Date();
    min.setDate(min.getDate() + 30);
    const minStr = min.toISOString().split('T')[0];

    const startEl = document.getElementById('req-start');
    const endEl   = document.getElementById('req-end');
    if (startEl) { startEl.min = minStr; startEl.value = ''; }
    if (endEl)   { endEl.min   = minStr; endEl.value   = ''; }

    const abonoEl = document.getElementById('req-abono');
    if (abonoEl)  { abonoEl.checked = false; abonoEl.disabled = true; }

    const obs = document.getElementById('req-obs');
    if (obs) obs.value = '';

    setEl('days-count', 'Selecione as datas para ver o total de dias');
    const preview = document.getElementById('days-preview');
    if (preview) preview.className = 'days-preview';

    hideAlert();
    setConfirmDisabled(true);

    document.getElementById('request-modal')?.classList.add('active');
};

window.closeRequestModal = function () {
    document.getElementById('request-modal')?.classList.remove('active');
};

window.calcDays = function () {
    const startVal = document.getElementById('req-start')?.value;
    const endVal   = document.getElementById('req-end')?.value;
    const abonoEl  = document.getElementById('req-abono');
    const preview  = document.getElementById('days-preview');
    const countEl  = document.getElementById('days-count');
    const hint     = document.getElementById('abono-hint');

    hideAlert();
    if (!startVal || !endVal) {
        if (countEl) countEl.textContent = 'Selecione as datas para ver o total de dias';
        if (preview) preview.className = 'days-preview';
        setConfirmDisabled(true);
        return;
    }

    const s    = new Date(startVal + 'T00:00:00');
    const e    = new Date(endVal   + 'T00:00:00');
    const days = Math.round((e - s) / 86400000) + 1;

    if (days <= 0) {
        if (countEl) countEl.textContent = 'A data de fim deve ser após o início';
        if (preview) preview.className = 'days-preview days-preview--error';
        setConfirmDisabled(true);
        return;
    }

    const today   = new Date(); today.setHours(0,0,0,0);
    const advance = Math.round((s - today) / 86400000);
    let errors    = [];

    if (advance < 30) errors.push(`Antecedência mínima de 30 dias (selecione a partir de ${fmtBR(addDays(today, 30))})`);
    if (days > availableDays) errors.push(`Saldo insuficiente — você tem apenas ${availableDays} dias disponíveis`);
    if (days < 5)  errors.push('O período mínimo de férias é de 5 dias corridos');

    // Abono toggle
    if (abonoEl) {
        if (days >= 20 && errors.length === 0) {
            abonoEl.disabled = false;
            if (hint) hint.textContent = 'Você pode converter 10 dias em pagamento adicional (abono pecuniário).';
        } else {
            abonoEl.disabled = true;
            abonoEl.checked  = false;
            if (hint) hint.textContent = days < 20 ? 'Disponível somente para períodos de 20 dias ou mais.' : '';
        }
    }

    const abono  = abonoEl?.checked && days >= 20;
    let daysText = `${days} ${days === 1 ? 'dia selecionado' : 'dias selecionados'}`;
    if (abono) daysText += ` · ${days - 10} de descanso + 10 de abono`;

    if (countEl) countEl.textContent = daysText;

    if (errors.length > 0) {
        showAlert(errors.map(e => `<i class="fas fa-exclamation-triangle"></i> ${e}`).join('<br>'));
        if (preview) preview.className = 'days-preview days-preview--error';
        setConfirmDisabled(true);
    } else {
        if (preview) preview.className = 'days-preview days-preview--ok';
        setConfirmDisabled(false);
    }
};

window.submitRequest = function () {
    const startVal = document.getElementById('req-start')?.value;
    const endVal   = document.getElementById('req-end')?.value;
    const abono    = document.getElementById('req-abono')?.checked ?? false;
    const obs      = document.getElementById('req-obs')?.value.trim() ?? '';

    if (!startVal || !endVal) { showAlert('<i class="fas fa-exclamation-triangle"></i> Selecione as datas de início e fim.'); return; }

    const s    = new Date(startVal + 'T00:00:00');
    const e    = new Date(endVal   + 'T00:00:00');
    const days = Math.round((e - s) / 86400000) + 1;

    const today   = new Date(); today.setHours(0,0,0,0);
    const advance = Math.round((s - today) / 86400000);

    if (advance < 30) { showAlert('<i class="fas fa-exclamation-triangle"></i> Antecedência mínima de 30 dias.'); return; }
    if (days > availableDays) { showAlert(`<i class="fas fa-exclamation-triangle"></i> Saldo insuficiente (${availableDays} dias disponíveis).`); return; }
    if (days < 5)  { showAlert('<i class="fas fa-exclamation-triangle"></i> Período mínimo de 5 dias.'); return; }

    const vacs = getVacations();
    const req  = {
        id:              `vac_${Date.now()}`,
        employeeId:      session.employeeId || null,
        employeeEmail:   session.email,
        employeeName:    session.name,
        employeeDept:    session.dept     || '—',
        employeeRole:    session.role     || '—',
        startDate:       startVal,
        endDate:         endVal,
        days,
        hasAbono:        abono && days >= 20,
        observation:     obs,
        status:          'pendente',
        rejectionReason: '',
        createdAt:       new Date().toISOString(),
        approvedAt:      null,
        approvedBy:      null,
    };

    vacs.push(req);
    saveVacations(vacs);

    closeRequestModal();
    showToast('Solicitação enviada! Aguardando aprovação do RH.', 'success');

    autoExpireVacations();
    loadSummary();
    renderHistory();
    renderTimeline();
};

window.showReason = function (reason) {
    setEl('detail-reason', reason || 'Motivo não informado.');
    document.getElementById('detail-modal')?.classList.add('active');
};

window.closeDetailModal = function () {
    document.getElementById('detail-modal')?.classList.remove('active');
};

window.handleOverlayClick = function (e, modalId) {
    if (e.target === e.currentTarget) {
        document.getElementById(modalId)?.classList.remove('active');
    }
};

// ── Realtime sync ────────────────────────────────────

function setupRealtimeSync() {
    window.addEventListener('storage', (e) => {
        if (e.key !== VACATIONS_KEY || !session) return;

        const prevList = e.oldValue ? JSON.parse(e.oldValue) : [];
        const nextList = e.newValue ? JSON.parse(e.newValue) : [];

        const myPrev = prevList.filter(v => v.employeeEmail === session.email);
        const myNext = nextList.filter(v => v.employeeEmail === session.email);

        const STATUS_MSGS = {
            aprovado:  { text: 'Suas férias foram aprovadas pelo RH!', type: 'success' },
            recusado:  { text: 'Sua solicitação foi recusada. Veja o motivo no histórico.', type: 'error' },
            concluido: { text: 'Suas férias foram concluídas.', type: 'info' },
        };

        myNext.forEach(v => {
            const prev = myPrev.find(p => p.id === v.id);
            if (prev && prev.status !== v.status) {
                const m = STATUS_MSGS[v.status];
                if (m) showToast(m.text, m.type);
            }
        });

        autoExpireVacations();
        loadSummary();
        renderHistory();
        renderTimeline();
    });
}

// ── Helpers ───────────────────────────────────────────

function getVacations()      { return JSON.parse(localStorage.getItem(VACATIONS_KEY) || '[]'); }
function saveVacations(v)    { localStorage.setItem(VACATIONS_KEY, JSON.stringify(v)); }
function getMyVacations()    { return getVacations().filter(v => v.employeeEmail === session.email); }
function todayDate()         { return new Date().toISOString().split('T')[0]; }
function addDays(d, n)       { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function clampDate(d, min, max) { return d < min ? new Date(min) : d > max ? new Date(max) : d; }
function fmtBR(d)            { if (!d || isNaN(d)) return '—'; return d.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric'}); }
function setEl(id, html)     { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function monthsDiff(a, b)    { return (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth(); }
function setConfirmDisabled(v) { const b = document.getElementById('btn-confirm'); if (b) b.disabled = v; }

function showAlert(html) {
    const el = document.getElementById('modal-alert');
    if (!el) return;
    el.innerHTML = html;
    el.classList.add('show');
}
function hideAlert() {
    const el = document.getElementById('modal-alert');
    if (el) { el.innerHTML = ''; el.classList.remove('show'); }
}

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success:'fa-check', error:'fa-times', warning:'fa-exclamation-triangle', info:'fa-info-circle' };
    const titles = { success:'Sucesso', error:'Erro', warning:'Atenção', info:'Info' };
    const toast  = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || 'fa-check'}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${titles[type] || 'Aviso'}</p>
            <p class="toast-msg">${msg}</p>
        </div>
        <button class="toast-close" onclick="this.closest('.toast').remove()"><i class="fas fa-times"></i></button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 4000);
}

window.logout = function () {
    localStorage.removeItem('nexus_session');
    window.location.href = '../screens/login.html';
};
