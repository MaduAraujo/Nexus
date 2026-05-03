/* ════════════════════════════════════════════
   ferias.js — Gestão de Férias (RH) — Supabase
   ════════════════════════════════════════════ */

let currentFilter = 'todos';
let currentSearch  = '';
let rejectingId    = null;
let editingId      = null;
let vacations      = [];
let employees      = [];

// ─── Mappers ─────────────────────────────────────────────────

function dbToVacation(row) {
    return {
        id:              row.id,
        employeeId:      row.employee_id,
        startDate:       row.start_date,
        endDate:         row.end_date,
        days:            row.days,
        status:          row.status,
        abono:           row.abono,
        obs:             row.obs,
        rejectionReason: row.rejection_reason,
        approvedAt:      row.approved_at,
        rejectedAt:      row.rejected_at,
        createdAt:       row.created_at,
    };
}

function dbToEmp(row) {
    return {
        id:            row.id,
        name:          row.name,
        dept:          row.dept,
        role:          row.role,
        admissionDate: row.admission_date,
        status:        row.status,
    };
}

// ─── Data helpers ─────────────────────────────────────────────

async function fetchData() {
    const [{ data: vData }, { data: eData }] = await Promise.all([
        sb.from('vacations').select('*').order('created_at', { ascending: false }),
        sb.from('employees').select('id,name,dept,role,admission_date,status'),
    ]);
    vacations = (vData || []).map(dbToVacation);
    employees = (eData || []).map(dbToEmp);
}

function getEmployee(empId) {
    return employees.find(e => e.id === empId) || null;
}

// ─── Session ─────────────────────────────────────────────────

async function loadRhSidebar() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }
    const { data: profile } = await sb.from('profiles').select('profile').eq('id', user.id).single();
    if (profile?.profile !== 'rh') { window.location.href = '../screens/login.html'; return; }

    const nameEl   = document.getElementById('rh-sidebar-name');
    const roleEl   = document.getElementById('rh-sidebar-role');
    const avatarEl = document.getElementById('rh-sidebar-avatar');
    if (!nameEl) return;
    const displayName = user.email?.split('@')[0] || 'Administrador';
    nameEl.textContent   = displayName;
    if (roleEl)   roleEl.textContent   = 'Recursos Humanos';
    if (avatarEl) avatarEl.textContent = displayName.slice(0, 2).toUpperCase();
}

async function logout() {
    await sb.auth.signOut();
    window.location.href = '../screens/login.html';
}

// ─── Auto-expire ──────────────────────────────────────────────

async function autoExpireVacations() {
    const today = new Date().toISOString().split('T')[0];
    const toExpire = vacations.filter(v => v.status === 'aprovado' && v.endDate < today);
    if (!toExpire.length) return;
    const ids = toExpire.map(v => v.id);
    await sb.from('vacations').update({ status: 'concluido' }).in('id', ids);
    toExpire.forEach(v => v.status = 'concluido');
}

// ─── KPIs ─────────────────────────────────────────────────────

function loadKPIs() {
    const today = new Date(); today.setHours(0,0,0,0);
    const in15  = new Date(today); in15.setDate(in15.getDate() + 15);
    const in30  = new Date(today); in30.setDate(in30.getDate() + 30);
    const in60  = new Date(today); in60.setDate(in60.getDate() + 60);

    let pending = 0, upcoming = 0, active = 0, risk = 0, risk30 = 0;

    vacations.forEach(v => {
        const start = new Date(v.startDate + 'T00:00:00');
        const end   = new Date(v.endDate   + 'T00:00:00');
        if (v.status === 'pendente') pending++;
        if (v.status === 'aprovado' && start > today && start <= in15) upcoming++;
        if (v.status === 'aprovado' && start <= today && end >= today) active++;
    });

    employees.forEach(emp => {
        if (!emp.admissionDate) return;
        const adm    = new Date(emp.admissionDate + 'T00:00:00');
        const expiry = nextAnniversary(adm, today);
        if (expiry > today && expiry <= in60) {
            const taken = vacationsTakenInCycle(emp.id, adm, today);
            if (taken < 30) { risk++; if (expiry <= in30) risk30++; }
        }
    });

    document.getElementById('kpi-pending').textContent  = pending;
    document.getElementById('kpi-upcoming').textContent = upcoming;
    document.getElementById('kpi-active').textContent   = active;
    document.getElementById('kpi-risk').textContent     = risk;

    const riskCard = document.querySelector('.kpi--risk');
    if (riskCard) {
        let urgentEl = riskCard.querySelector('.kpi-risk-urgent');
        if (risk30 > 0) {
            if (!urgentEl) { urgentEl = document.createElement('span'); urgentEl.className = 'kpi-risk-urgent'; riskCard.querySelector('.kpi-body')?.appendChild(urgentEl); }
            urgentEl.textContent = `⚠ ${risk30} vencem em até 30 dias`;
            urgentEl.style.cssText = 'font-size:11px;font-weight:700;color:#dc2626;margin-top:2px;';
        } else if (urgentEl) { urgentEl.remove(); }
        riskCard.style.borderColor = risk30 > 0 ? '#fca5a5' : '';
    }
}

function nextAnniversary(admDate, today) {
    const ann = new Date(admDate);
    ann.setFullYear(today.getFullYear());
    if (ann <= today) ann.setFullYear(ann.getFullYear() + 1);
    return ann;
}

function vacationsTakenInCycle(empId, admDate, today) {
    let cycleStart = new Date(admDate);
    while (true) {
        const cycleEnd = new Date(cycleStart);
        cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
        if (cycleEnd > today) break;
        cycleStart.setFullYear(cycleStart.getFullYear() + 1);
    }
    return vacations
        .filter(v => v.employeeId === empId && (v.status === 'aprovado' || v.status === 'concluido'))
        .filter(v => new Date(v.startDate + 'T00:00:00') >= cycleStart)
        .reduce((sum, v) => sum + (v.days || 0), 0);
}

// ─── Table ────────────────────────────────────────────────────

function renderTable() {
    const filtered = applyFilters(vacations);
    const tbody    = document.getElementById('requests-tbody');
    const countEl  = document.getElementById('table-count');
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr id="empty-row"><td colspan="6"><div class="table-empty"><i class="fas fa-umbrella-beach"></i><p>Nenhuma solicitação encontrada.</p></div></td></tr>`;
        countEl.textContent = '';
        return;
    }

    filtered.sort((a, b) => new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate));

    filtered.forEach(v => {
        const emp  = getEmployee(v.employeeId);
        const name = emp ? emp.name : '—';
        const dept = emp ? (emp.dept || '—') : '—';
        const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="emp-cell"><div class="emp-avatar">${initials}</div><div><div class="emp-name">${escHtml(name)}</div><div class="emp-dept">${escHtml(dept)}</div></div></div></td>
            <td><div class="period-dates">${formatDate(v.startDate)} → ${formatDate(v.endDate)}</div></td>
            <td><strong>${v.days || '—'}</strong></td>
            <td>${v.abono ? '<span class="badge-abono"><i class="fas fa-coins"></i> Abono</span>' : '<span class="badge-no-abono">—</span>'}</td>
            <td>${buildBadge(v.status)}</td>
            <td><div class="actions-cell">${buildActions(v)}</div></td>`;
        tbody.appendChild(tr);
    });

    countEl.textContent = `${filtered.length} solicitaç${filtered.length === 1 ? 'ão' : 'ões'} encontrada${filtered.length === 1 ? '' : 's'}`;
}

function buildBadge(status) {
    const map = { pendente: 'Pendente', aprovado: 'Aprovado', concluido: 'Concluído', recusado: 'Recusado' };
    return `<span class="badge badge--${status}">${map[status] || status}</span>`;
}

function buildActions(v) {
    let html = `<button class="btn-action btn-action--view" title="Ver detalhes" onclick="openViewModal('${v.id}')"><i class="fas fa-eye"></i></button>`;
    if (v.status === 'pendente') {
        html += `<button class="btn-action btn-action--approve" title="Aprovar" onclick="approveRequest('${v.id}')"><i class="fas fa-check"></i></button>`;
        html += `<button class="btn-action btn-action--reject"  title="Recusar" onclick="openRejectModal('${v.id}')"><i class="fas fa-times"></i></button>`;
    }
    if (v.status === 'aprovado' || v.status === 'pendente') {
        html += `<button class="btn-action btn-action--edit" title="Editar" onclick="openEditModal('${v.id}')"><i class="fas fa-pen"></i></button>`;
    }
    return html;
}

// ─── Filters ──────────────────────────────────────────────────

function applyFilters(list) {
    const today = new Date(); today.setHours(0,0,0,0);
    const in60  = new Date(today); in60.setDate(in60.getDate() + 60);
    return list.filter(v => {
        if (currentFilter !== 'todos') {
            if (currentFilter === 'risco') {
                const emp = getEmployee(v.employeeId);
                if (!emp?.admissionDate) return false;
                const expiry = nextAnniversary(new Date(emp.admissionDate + 'T00:00:00'), today);
                if (!(expiry > today && expiry <= in60)) return false;
            } else {
                if (v.status !== currentFilter) return false;
            }
        }
        if (currentSearch) {
            const emp  = getEmployee(v.employeeId);
            const name = emp ? emp.name.toLowerCase() : '';
            const dept = emp ? (emp.dept || '').toLowerCase() : '';
            const q    = currentSearch.toLowerCase();
            if (!name.includes(q) && !dept.includes(q)) return false;
        }
        return true;
    });
}

window.setFilter = function (btn) {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    btn.classList.add('chip--active');
    currentFilter = btn.dataset.filter;
    renderTable();
};

window.clearSearch = function () {
    document.getElementById('search-input').value = '';
    currentSearch = '';
    document.getElementById('search-clear').classList.add('hidden');
    renderTable();
};

function setupSearchListeners() {
    const input = document.getElementById('search-input');
    const clear = document.getElementById('search-clear');
    if (!input) return;
    input.addEventListener('input', () => {
        currentSearch = input.value.trim();
        clear.classList.toggle('hidden', !currentSearch);
        renderTable();
    });
}

// ─── Tab ──────────────────────────────────────────────────────

window.switchTab = function (btn, tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');
    if (tabName === 'calendar') renderGantt();
};

// ─── Approve / Reject ────────────────────────────────────────

function checkDeptConflict(vacation) {
    const emp  = getEmployee(vacation.employeeId);
    const dept = emp?.dept;
    if (!dept) return null;
    const start = new Date(vacation.startDate + 'T00:00:00');
    const end   = new Date(vacation.endDate   + 'T00:00:00');
    const conflicts = vacations.filter(v => {
        if (v.id === vacation.id || v.status !== 'aprovado') return false;
        const otherEmp  = getEmployee(v.employeeId);
        if (otherEmp?.dept !== dept) return false;
        const vStart = new Date(v.startDate + 'T00:00:00');
        const vEnd   = new Date(v.endDate   + 'T00:00:00');
        return start <= vEnd && end >= vStart;
    });
    return conflicts.length > 0 ? { dept, count: conflicts.length, names: conflicts.map(v => getEmployee(v.employeeId)?.name || '?') } : null;
}

window.approveRequest = async function (id) {
    const vac = vacations.find(v => v.id === id);
    if (!vac) return;
    const conflict = checkDeptConflict(vac);
    if (conflict) {
        const names = conflict.names.slice(0, 3).join(', ') + (conflict.names.length > 3 ? '…' : '');
        const ok = confirm(`Atenção: ${conflict.count} colaborador(es) do departamento "${conflict.dept}" já está(ão) de férias no mesmo período:\n${names}\n\nDeseja aprovar mesmo assim?`);
        if (!ok) return;
    }
    const { error } = await sb.from('vacations').update({ status: 'aprovado', approved_at: new Date().toISOString() }).eq('id', id);
    if (error) { showToast('Erro ao aprovar.', 'error'); return; }
    vac.status = 'aprovado'; vac.approvedAt = new Date().toISOString();
    await autoExpireVacations();
    loadKPIs(); renderTable();
    showToast('Solicitação aprovada com sucesso!', 'success');
};

window.openRejectModal = function (id) {
    rejectingId = id;
    const v   = vacations.find(v => v.id === id);
    const emp = v ? getEmployee(v.employeeId) : null;
    document.getElementById('reject-sub').textContent = emp ? `Colaborador: ${emp.name}` : 'Informe o motivo da recusa';
    document.getElementById('reject-reason').value = '';
    clearAlert('reject-alert');
    openModal('reject-modal');
};

window.closeRejectModal = function () { closeModal('reject-modal'); rejectingId = null; };

window.prefillRejectReason = function (text) {
    const el = document.getElementById('reject-reason');
    if (el) { el.value = text; el.focus(); }
};

window.confirmReject = async function () {
    const reason = document.getElementById('reject-reason').value.trim();
    if (!reason) { showAlert('reject-alert', 'Informe o motivo da recusa.', 'error'); return; }
    const { error } = await sb.from('vacations').update({
        status: 'recusado',
        rejection_reason: reason,
        rejected_at: new Date().toISOString()
    }).eq('id', rejectingId);
    if (error) { showToast('Erro ao recusar.', 'error'); return; }
    const vac = vacations.find(v => v.id === rejectingId);
    if (vac) { vac.status = 'recusado'; vac.rejectionReason = reason; }
    loadKPIs(); renderTable();
    closeRejectModal();
    showToast('Solicitação recusada.', 'info');
};

// ─── Add / Edit modal ────────────────────────────────────────

window.openAddModal = function () {
    editingId = null;
    document.getElementById('add-modal-title').textContent = 'Nova Solicitação';
    ['add-employee','add-start','add-end','add-obs'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('add-status').value  = 'pendente';
    document.getElementById('add-abono').checked = false;
    document.getElementById('add-days-count').textContent = 'Selecione as datas';
    document.getElementById('add-days-preview')?.classList.remove('has-value');
    clearAlert('add-alert');
    openModal('add-modal');
};

window.openEditModal = function (id) {
    const v = vacations.find(v => v.id === id);
    if (!v) return;
    editingId = id;
    document.getElementById('add-modal-title').textContent = 'Editar Solicitação';
    document.getElementById('add-employee').value = v.employeeId;
    document.getElementById('add-start').value    = v.startDate;
    document.getElementById('add-end').value      = v.endDate;
    document.getElementById('add-status').value   = v.status;
    document.getElementById('add-abono').checked  = v.abono || false;
    document.getElementById('add-obs').value      = v.obs || '';
    calcAddDays();
    clearAlert('add-alert');
    openModal('add-modal');
};

window.closeAddModal = function () { closeModal('add-modal'); editingId = null; };

window.calcAddDays = function () {
    const s = document.getElementById('add-start').value;
    const e = document.getElementById('add-end').value;
    const preview   = document.getElementById('add-days-preview');
    const countSpan = document.getElementById('add-days-count');
    if (!s || !e) { countSpan.textContent = 'Selecione as datas'; preview?.classList.remove('has-value'); return; }
    const start = new Date(s + 'T00:00:00');
    const end   = new Date(e + 'T00:00:00');
    if (end < start) { countSpan.textContent = 'Data de fim inválida'; preview?.classList.remove('has-value'); return; }
    const days = Math.round((end - start) / 86400000) + 1;
    countSpan.textContent = `${days} dia${days !== 1 ? 's' : ''} de férias`;
    preview?.classList.add('has-value');
};

window.submitAdd = async function () {
    const empId  = document.getElementById('add-employee').value;
    const start  = document.getElementById('add-start').value;
    const end    = document.getElementById('add-end').value;
    const status = document.getElementById('add-status').value;
    const abono  = document.getElementById('add-abono').checked;
    const obs    = document.getElementById('add-obs').value.trim();

    if (!empId) { showAlert('add-alert', 'Selecione um colaborador.', 'error'); return; }
    if (!start || !end) { showAlert('add-alert', 'Informe o período completo.', 'error'); return; }
    const sDate = new Date(start + 'T00:00:00');
    const eDate = new Date(end   + 'T00:00:00');
    if (eDate < sDate) { showAlert('add-alert', 'Data de fim deve ser após a data de início.', 'error'); return; }
    const days = Math.round((eDate - sDate) / 86400000) + 1;
    if (days < 5) { showAlert('add-alert', 'O período mínimo de férias é de 5 dias.', 'error'); return; }

    if (editingId) {
        const { error } = await sb.from('vacations').update({ employee_id: empId, start_date: start, end_date: end, days, status, abono, obs }).eq('id', editingId);
        if (error) { showAlert('add-alert', 'Erro ao salvar. Tente novamente.', 'error'); return; }
        const idx = vacations.findIndex(v => v.id === editingId);
        if (idx !== -1) Object.assign(vacations[idx], { employeeId: empId, startDate: start, endDate: end, days, status, abono, obs });
        showToast('Solicitação atualizada!', 'success');
    } else {
        const { data, error } = await sb.from('vacations').insert({ employee_id: empId, start_date: start, end_date: end, days, status, abono, obs }).select().single();
        if (error) { showAlert('add-alert', 'Erro ao registrar. Tente novamente.', 'error'); return; }
        vacations.unshift(dbToVacation(data));
        showToast('Solicitação registrada!', 'success');
    }

    await autoExpireVacations();
    loadKPIs(); renderTable();
    closeAddModal();
};

function populateEmployeeSelect() {
    const sel = document.getElementById('add-employee');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione o colaborador...</option>';
    employees
        .filter(e => e.status !== 'Inativo')
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `${e.name} — ${e.dept || 'Sem departamento'}`;
            sel.appendChild(opt);
        });
}

// ─── View modal ───────────────────────────────────────────────

window.openViewModal = function (id) {
    const v   = vacations.find(v => v.id === id);
    if (!v) return;
    const emp  = getEmployee(v.employeeId);
    const name = emp ? emp.name : '—';
    const dept = emp ? (emp.dept || '—') : '—';
    const rows = [
        { label: 'Colaborador',      value: escHtml(name) },
        { label: 'Departamento',     value: escHtml(dept) },
        { label: 'Data de Início',   value: formatDate(v.startDate) },
        { label: 'Data de Fim',      value: formatDate(v.endDate) },
        { label: 'Dias',             value: v.days || '—' },
        { label: 'Abono Pecuniário', value: v.abono ? 'Sim' : 'Não' },
        { label: 'Status',           value: buildBadge(v.status) },
        ...(v.obs ? [{ label: 'Observação', value: escHtml(v.obs) }] : []),
        ...(v.rejectionReason ? [{ label: 'Motivo da Recusa', value: escHtml(v.rejectionReason) }] : []),
        { label: 'Criado em',        value: v.createdAt ? new Date(v.createdAt).toLocaleDateString('pt-BR') : '—' },
    ];
    document.getElementById('view-body').innerHTML = rows.map(r =>
        `<div class="view-row"><span class="view-row-label">${r.label}</span><span class="view-row-value">${r.value}</span></div>`
    ).join('');
    openModal('view-modal');
};

window.closeViewModal = function () { closeModal('view-modal'); };

// ─── Gantt ────────────────────────────────────────────────────

function renderGantt() {
    const year = new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd   = new Date(year, 11, 31);
    const totalDays = (yearEnd - yearStart) / 86400000 + 1;

    const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    document.getElementById('gantt-months').innerHTML = months.map(m => `<div class="gantt-month-cell">${m}</div>`).join('');

    const toShow = vacations.filter(v =>
        (v.status === 'aprovado' || v.status === 'concluido') &&
        new Date(v.endDate   + 'T00:00:00') >= yearStart &&
        new Date(v.startDate + 'T00:00:00') <= yearEnd
    );

    const rowsEl = document.getElementById('gantt-rows');
    if (toShow.length === 0) {
        rowsEl.innerHTML = `<div class="gantt-empty"><i class="fas fa-calendar-alt"></i><p>Nenhuma férias aprovada este ano.</p></div>`;
        return;
    }

    const byEmp = {};
    toShow.forEach(v => { if (!byEmp[v.employeeId]) byEmp[v.employeeId] = []; byEmp[v.employeeId].push(v); });

    rowsEl.innerHTML = '';
    Object.keys(byEmp).forEach(empId => {
        const emp  = getEmployee(empId);
        const name = emp ? emp.name : `ID ${empId}`;
        const dept = emp ? (emp.dept || '') : '';
        const row  = document.createElement('div');
        row.className = 'gantt-row';
        const barsDiv = document.createElement('div');
        barsDiv.className = 'gantt-row-bars';
        byEmp[empId].forEach(v => {
            const vStart = new Date(v.startDate + 'T00:00:00');
            const vEnd   = new Date(v.endDate   + 'T00:00:00');
            const clampedStart = vStart < yearStart ? yearStart : vStart;
            const clampedEnd   = vEnd   > yearEnd   ? yearEnd   : vEnd;
            const leftPct  = ((clampedStart - yearStart) / 86400000 / totalDays) * 100;
            const widthPct = ((clampedEnd   - clampedStart) / 86400000 + 1) / totalDays * 100;
            const bar = document.createElement('div');
            bar.className = `gantt-bar ${v.status === 'aprovado' ? 'gantt-bar--approved' : 'gantt-bar--concluded'}`;
            bar.style.left  = leftPct  + '%';
            bar.style.width = Math.max(widthPct, .3) + '%';
            bar.title = `${name}: ${formatDate(v.startDate)} → ${formatDate(v.endDate)} (${v.days}d)`;
            barsDiv.appendChild(bar);
        });
        row.innerHTML = `<div class="gantt-row-label"><div class="g-avatar">${name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div><div><div class="g-name">${escHtml(name)}</div>${dept?`<div class="g-dept">${escHtml(dept)}</div>`:''}</div></div>`;
        row.appendChild(barsDiv);
        rowsEl.appendChild(row);
    });
}

// ─── Realtime ─────────────────────────────────────────────────

function setupRealtimeSync() {
    sb.channel('vacations-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vacations' }, async () => {
            const { data } = await sb.from('vacations').select('*').order('created_at', { ascending: false });
            vacations = (data || []).map(dbToVacation);
            await autoExpireVacations();
            loadKPIs(); renderTable(); renderGantt();
        })
        .subscribe();
}

// ─── Modal helpers ────────────────────────────────────────────

function openModal(id)  { document.getElementById(id).classList.add('open');    document.body.style.overflow = 'hidden'; }
function closeModal(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow = ''; }
window.handleOverlayClick = function (e, id) { if (e.target === document.getElementById(id)) closeModal(id); };
function showAlert(id, msg, type) { const el = document.getElementById(id); if (!el) return; el.textContent = msg; el.className = 'modal-alert ' + type; }
function clearAlert(id) { const el = document.getElementById(id); if (!el) return; el.className = 'modal-alert'; el.textContent = ''; }

// ─── Sidebar ──────────────────────────────────────────────────

function setupSidebar() {
    const sidebar  = document.getElementById('sidebar');
    const toggle   = document.getElementById('sidebar-toggle');
    const topbar   = document.getElementById('topbar-menu-btn');
    const overlay  = document.getElementById('sidebar-overlay');
    const wrapper  = document.querySelector('.main-wrapper');
    const isMobile = () => window.innerWidth <= 768;
    const open  = () => { sidebar?.classList.add('open');    overlay?.classList.add('active');    document.body.style.overflow = 'hidden'; };
    const close = () => { sidebar?.classList.remove('open'); overlay?.classList.remove('active'); document.body.style.overflow = ''; };
    toggle?.addEventListener('click', e => { e.stopPropagation(); isMobile() ? (sidebar?.classList.contains('open') ? close() : open()) : (() => { const c = sidebar?.classList.toggle('collapsed'); wrapper?.classList.toggle('sidebar-collapsed', c); })(); });
    topbar?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? close() : open(); });
    overlay?.addEventListener('click', close);
    window.addEventListener('resize', () => { if (!isMobile()) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isMobile()) close(); });
}

// ─── Toast ────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas ${icons[type] || icons.success} toast-icon"></i><span>${escHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('hide'); setTimeout(() => toast.remove(), 300); }, 3000);
}

// ─── Utils ────────────────────────────────────────────────────

function formatDate(str) { if (!str) return '—'; const [y,m,d] = str.split('-'); return `${d}/${m}/${y}`; }
function escHtml(str) { if (typeof str !== 'string') return str ?? ''; return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setTodayDate() { const el = document.getElementById('today-date'); if (!el) return; el.textContent = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }); }

// ─── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    setTodayDate();
    setupSidebar();
    await loadRhSidebar();
    await fetchData();
    await autoExpireVacations();
    loadKPIs();
    renderTable();
    renderGantt();
    populateEmployeeSelect();
    setupSearchListeners();
    setupRealtimeSync();
});
