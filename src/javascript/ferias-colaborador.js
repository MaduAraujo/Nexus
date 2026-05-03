/* ferias-colaborador.js — Supabase */

let myEmployee    = null;   // dados do colaborador logado
let myEmployeeId  = null;   // UUID
let myVacations   = [];
let availableDays = 0;
let acquisitivePeriod = null;

// ─── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles')
        .select('profile, employee_id')
        .eq('id', user.id)
        .single();

    if (profile?.profile !== 'colaborador' || !profile.employee_id) {
        window.location.href = '../screens/login.html';
        return;
    }

    myEmployeeId = profile.employee_id;

    const { data: emp } = await sb.from('employees').select('*').eq('id', myEmployeeId).single();
    if (!emp) { window.location.href = '../screens/login.html'; return; }
    myEmployee = emp;

    loadSidebarInfo();
    await loadMyVacations();
    await autoExpireVacations();
    loadSummary();
    renderHistory();
    renderTimeline();
    setupRealtimeSync();
});

// ─── Sidebar ──────────────────────────────────────────────────

function loadSidebarInfo() {
    const name  = myEmployee.name || '—';
    const color = myEmployee.avatar_color || '#6366f1';
    const ini   = name.split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('');
    const avatarEl = document.getElementById('sidebar-avatar');
    const nameEl   = document.getElementById('sidebar-name');
    const roleEl   = document.getElementById('sidebar-role');
    if (avatarEl) { avatarEl.style.background = color; avatarEl.textContent = ini; }
    if (nameEl)   nameEl.textContent = name;
    if (roleEl)   roleEl.textContent = myEmployee.role || 'Colaborador';
}

window.logout = async function () {
    await sb.auth.signOut();
    window.location.href = '../screens/login.html';
};

// ─── Data ─────────────────────────────────────────────────────

async function loadMyVacations() {
    const { data } = await sb.from('vacations')
        .select('*')
        .eq('employee_id', myEmployeeId)
        .order('created_at', { ascending: false });
    myVacations = data || [];
}

async function autoExpireVacations() {
    const today = new Date().toISOString().split('T')[0];
    const toExpire = myVacations.filter(v => v.status === 'aprovado' && v.end_date < today);
    if (!toExpire.length) return;
    const ids = toExpire.map(v => v.id);
    await sb.from('vacations').update({ status: 'concluido' }).in('id', ids);
    toExpire.forEach(v => v.status = 'concluido');
}

// ─── Summary ──────────────────────────────────────────────────

function loadSummary() {
    const admission = myEmployee.admission_date;
    if (!admission) {
        ['val-saldo','val-periodo','val-vencer'].forEach(id => setEl(id, '—'));
        setEl('sub-saldo', 'Data de admissão não informada');
        return;
    }
    const today   = new Date();
    const admDate = new Date(admission + 'T00:00:00');
    const months  = monthsDiff(admDate, today);
    const periods = Math.floor(months / 12);
    const earned  = periods * 30;
    const taken   = myVacations
        .filter(v => v.status === 'aprovado' || v.status === 'concluido')
        .reduce((s, v) => s + v.days - (v.abono ? 10 : 0), 0);
    availableDays = Math.max(0, earned - taken);
    acquisitivePeriod = calcAcquisitivePeriod(admDate, today);
    const daysLeft = Math.ceil((acquisitivePeriod.end - today) / 86400000);

    setEl('val-saldo', `${availableDays} dias`);
    setEl('sub-saldo', periods < 1
        ? `Aguardando completar 12 meses (${12 - months} meses restantes)`
        : `${earned} ganhos · ${taken} utilizados`);
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
    if (periods < 1) { btn.disabled = true; btn.title = 'Disponível após 12 meses'; btn.style.opacity = '0.5'; }
    else if (availableDays <= 0) { btn.disabled = true; btn.title = 'Sem saldo de férias'; btn.style.opacity = '0.5'; }
}

function calcAcquisitivePeriod(admDate, today) {
    let start = new Date(admDate);
    while (new Date(start.getFullYear() + 1, start.getMonth(), start.getDate()) <= today) {
        start.setFullYear(start.getFullYear() + 1);
    }
    const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
    return { start, end };
}

// ─── Timeline ─────────────────────────────────────────────────

function renderTimeline() {
    const year = new Date().getFullYear();
    setEl('timeline-year', String(year));
    const monthsEl = document.getElementById('timeline-months');
    if (monthsEl) monthsEl.innerHTML = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map(m=>`<span>${m}</span>`).join('');
    const barsEl = document.getElementById('timeline-bars');
    if (!barsEl) return;
    const yearStart = new Date(year, 0, 1);
    const yearEnd   = new Date(year, 11, 31);
    const totalMs   = yearEnd - yearStart + 86400000;
    const toShow = myVacations.filter(v => {
        const s = new Date(v.start_date + 'T00:00:00');
        const e = new Date(v.end_date   + 'T00:00:00');
        return (s.getFullYear() === year || e.getFullYear() === year) && v.status !== 'recusado';
    });
    if (toShow.length === 0) { barsEl.innerHTML = '<span class="tl-empty">Sem férias registradas para este ano</span>'; return; }
    barsEl.innerHTML = '';
    toShow.forEach(v => {
        const s = clampDate(new Date(v.start_date + 'T00:00:00'), yearStart, yearEnd);
        const e = clampDate(new Date(v.end_date   + 'T00:00:00'), yearStart, yearEnd);
        const left  = ((s - yearStart) / totalMs) * 100;
        const width = Math.max(((e - s + 86400000) / totalMs) * 100, 0.5);
        const cls   = { aprovado:'tl-bar--approved', pendente:'tl-bar--pending', concluido:'tl-bar--concluded', recusado:'tl-bar--rejected' }[v.status] || '';
        const bar   = document.createElement('div');
        bar.className = `tl-bar ${cls}`;
        bar.style.left  = `${left}%`;
        bar.style.width = `${width}%`;
        bar.title = `${fmtBR(new Date(v.start_date+'T00:00:00'))} → ${fmtBR(new Date(v.end_date+'T00:00:00'))} · ${v.days} dias`;
        barsEl.appendChild(bar);
    });
    const todayPct = ((new Date() - yearStart) / totalMs) * 100;
    const marker = document.createElement('div');
    marker.className = 'tl-today'; marker.style.left = `${todayPct}%`; marker.title = 'Hoje';
    barsEl.appendChild(marker);
}

// ─── History ──────────────────────────────────────────────────

function renderHistory() {
    const list    = document.getElementById('history-list');
    const emptyEl = document.getElementById('history-empty');
    if (!list) return;
    list.querySelectorAll('.history-card').forEach(c => c.remove());
    const sorted = [...myVacations].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sorted.length === 0) { if (emptyEl) emptyEl.style.display = 'flex'; return; }
    if (emptyEl) emptyEl.style.display = 'none';
    sorted.forEach(v => list.appendChild(buildHistoryCard(v)));
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
                <p class="hc-period">${fmtBR(new Date(v.start_date+'T00:00:00'))} &rarr; ${fmtBR(new Date(v.end_date+'T00:00:00'))}</p>
                <div class="hc-meta">
                    <span class="hc-meta-item"><i class="fas fa-calendar-day"></i> ${v.days} dias</span>
                    ${v.abono ? '<span class="tag-abono"><i class="fas fa-hand-holding-usd"></i> Abono Pecuniário</span>' : ''}
                    <span class="hc-date">Solicitado em ${fmtBR(new Date(v.created_at))}</span>
                </div>
            </div>
        </div>
        <div class="hc-right">
            <span class="badge ${s.cls}"><i class="fas ${s.icon}"></i> ${s.label}</span>
            ${v.status === 'recusado' ? `<button class="btn-motivo" onclick="showReason(${JSON.stringify(v.rejection_reason || 'Motivo não informado.')})">Ver motivo</button>` : ''}
        </div>`;
    return el;
}

// ─── Request modal ────────────────────────────────────────────

window.openRequestModal = function () {
    const min    = new Date();
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
    document.getElementById('days-preview')?.setAttribute('class', 'days-preview');
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
    if (!startVal || !endVal) { if (countEl) countEl.textContent = 'Selecione as datas para ver o total de dias'; if (preview) preview.className = 'days-preview'; setConfirmDisabled(true); return; }
    const s    = new Date(startVal + 'T00:00:00');
    const e    = new Date(endVal   + 'T00:00:00');
    const days = Math.round((e - s) / 86400000) + 1;
    if (days <= 0) { if (countEl) countEl.textContent = 'A data de fim deve ser após o início'; if (preview) preview.className = 'days-preview days-preview--error'; setConfirmDisabled(true); return; }
    const today   = new Date(); today.setHours(0,0,0,0);
    const advance = Math.round((s - today) / 86400000);
    let errors = [];
    if (advance < 30) errors.push(`Antecedência mínima de 30 dias (a partir de ${fmtBR(addDays(today, 30))})`);
    if (days > availableDays) errors.push(`Saldo insuficiente — você tem apenas ${availableDays} dias disponíveis`);
    if (days < 5) errors.push('O período mínimo de férias é de 5 dias corridos');
    if (abonoEl) {
        if (days >= 20 && errors.length === 0) { abonoEl.disabled = false; if (hint) hint.textContent = 'Você pode converter 10 dias em pagamento adicional.'; }
        else { abonoEl.disabled = true; abonoEl.checked = false; if (hint) hint.textContent = days < 20 ? 'Disponível somente para 20 dias ou mais.' : ''; }
    }
    const abono = abonoEl?.checked && days >= 20;
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

window.submitRequest = async function () {
    const startVal = document.getElementById('req-start')?.value;
    const endVal   = document.getElementById('req-end')?.value;
    const abono    = document.getElementById('req-abono')?.checked ?? false;
    const obs      = document.getElementById('req-obs')?.value.trim() ?? '';
    if (!startVal || !endVal) { showAlert('<i class="fas fa-exclamation-triangle"></i> Selecione as datas de início e fim.'); return; }
    const s    = new Date(startVal + 'T00:00:00');
    const e    = new Date(endVal   + 'T00:00:00');
    const days = Math.round((e - s) / 86400000) + 1;
    const today = new Date(); today.setHours(0,0,0,0);
    if (Math.round((s - today) / 86400000) < 30) { showAlert('<i class="fas fa-exclamation-triangle"></i> Antecedência mínima de 30 dias.'); return; }
    if (days > availableDays) { showAlert(`<i class="fas fa-exclamation-triangle"></i> Saldo insuficiente (${availableDays} dias disponíveis).`); return; }
    if (days < 5) { showAlert('<i class="fas fa-exclamation-triangle"></i> Período mínimo de 5 dias.'); return; }

    const btn = document.getElementById('btn-confirm');
    if (btn) btn.disabled = true;

    const { data, error } = await sb.from('vacations').insert({
        employee_id: myEmployeeId,
        start_date:  startVal,
        end_date:    endVal,
        days,
        abono:       abono && days >= 20,
        obs,
        status:      'pendente',
    }).select().single();

    if (btn) btn.disabled = false;

    if (error) { showAlert('<i class="fas fa-exclamation-triangle"></i> Erro ao enviar solicitação. Tente novamente.'); return; }

    myVacations.unshift(data);
    closeRequestModal();
    showToast('Solicitação enviada! Aguardando aprovação do RH.', 'success');
    await autoExpireVacations();
    loadSummary(); renderHistory(); renderTimeline();
};

window.showReason = function (reason) {
    setEl('detail-reason', reason || 'Motivo não informado.');
    document.getElementById('detail-modal')?.classList.add('active');
};

window.closeDetailModal = function () {
    document.getElementById('detail-modal')?.classList.remove('active');
};

window.handleOverlayClick = function (e, modalId) {
    if (e.target === e.currentTarget) document.getElementById(modalId)?.classList.remove('active');
};

// ─── Realtime ─────────────────────────────────────────────────

function setupRealtimeSync() {
    sb.channel('vacations-colab')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vacations',
            filter: `employee_id=eq.${myEmployeeId}` }, async (payload) => {
            const STATUS_MSGS = {
                aprovado:  { text: 'Suas férias foram aprovadas pelo RH!', type: 'success' },
                recusado:  { text: 'Sua solicitação foi recusada. Veja o motivo no histórico.', type: 'error' },
                concluido: { text: 'Suas férias foram concluídas.', type: 'info' },
            };
            if (payload.old?.status && payload.new?.status !== payload.old?.status) {
                const m = STATUS_MSGS[payload.new.status];
                if (m) showToast(m.text, m.type);
            }
            await loadMyVacations();
            await autoExpireVacations();
            loadSummary(); renderHistory(); renderTimeline();
        })
        .subscribe();
}

// ─── Helpers ──────────────────────────────────────────────────

function addDays(d, n)    { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function clampDate(d, mn, mx) { return d < mn ? new Date(mn) : d > mx ? new Date(mx) : d; }
function fmtBR(d)         { if (!d || isNaN(d)) return '—'; return d.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric'}); }
function setEl(id, html)  { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function monthsDiff(a, b) { return (b.getFullYear()-a.getFullYear())*12 + b.getMonth()-a.getMonth(); }
function setConfirmDisabled(v) { const b = document.getElementById('btn-confirm'); if (b) b.disabled = v; }
function showAlert(html)  { const el = document.getElementById('modal-alert'); if (!el) return; el.innerHTML = html; el.classList.add('show'); }
function hideAlert()      { const el = document.getElementById('modal-alert'); if (el) { el.innerHTML = ''; el.classList.remove('show'); } }

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons  = { success:'fa-check', error:'fa-times', warning:'fa-exclamation-triangle', info:'fa-info-circle' };
    const titles = { success:'Sucesso', error:'Erro', warning:'Atenção', info:'Info' };
    const toast  = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<div class="toast-icon"><i class="fas ${icons[type]||'fa-check'}"></i></div><div class="toast-content"><p class="toast-title">${titles[type]||'Aviso'}</p><p class="toast-msg">${msg}</p></div><button class="toast-close" onclick="this.closest('.toast').remove()"><i class="fas fa-times"></i></button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 4000);
}
