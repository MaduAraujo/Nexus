/* ════════════════════════════════════════════
   ferias-rh.js — Gestão de Férias (RH)
   ════════════════════════════════════════════ */

const VACATIONS_KEY = 'nexus_vacations';
const EMPLOYEES_KEY = 'nexus_employees';

let currentFilter = 'todos';
let currentSearch  = '';
let rejectingId    = null;
let editingId      = null;

/* ════════════════════════════
   Init
════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    setTodayDate();
    setupSidebar();
    loadRhSidebar();
    autoExpireVacations();
    loadKPIs();
    renderTable();
    renderGantt();
    populateEmployeeSelect();
    setupSearchListeners();
    setupRealtimeSync();
});

function loadRhSidebar() {
    try {
        const s = JSON.parse(localStorage.getItem('nexus_session') || 'null');
        const nameEl   = document.getElementById('rh-sidebar-name');
        const roleEl   = document.getElementById('rh-sidebar-role');
        const avatarEl = document.getElementById('rh-sidebar-avatar');
        if (!nameEl) return;
        const name = (s && s.name) ? s.name : 'Administrador';
        const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'RH';
        nameEl.textContent   = name;
        if (roleEl)   roleEl.textContent   = 'Recursos Humanos';
        if (avatarEl) avatarEl.textContent = initials;
    } catch {}
}

function setTodayDate() {
    const el = document.getElementById('today-date');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/* ════════════════════════════
   Storage helpers
════════════════════════════ */
function getVacations() {
    try { return JSON.parse(localStorage.getItem(VACATIONS_KEY)) || []; } catch { return []; }
}
function saveVacations(list) {
    localStorage.setItem(VACATIONS_KEY, JSON.stringify(list));
}
function getEmployees() {
    try { return JSON.parse(localStorage.getItem(EMPLOYEES_KEY)) || []; } catch { return []; }
}
function getEmployee(id) {
    return getEmployees().find(e => String(e.id) === String(id)) || null;
}

/* ════════════════════════════
   Auto-expire
════════════════════════════ */
function autoExpireVacations() {
    const today = new Date(); today.setHours(0,0,0,0);
    const list = getVacations();
    let changed = false;
    list.forEach(v => {
        if (v.status === 'aprovado') {
            const end = new Date(v.endDate + 'T00:00:00');
            if (end < today) { v.status = 'concluido'; changed = true; }
        }
    });
    if (changed) saveVacations(list);
}

/* ════════════════════════════
   KPIs
════════════════════════════ */
function loadKPIs() {
    const vacations = getVacations();
    const today = new Date(); today.setHours(0,0,0,0);
    const in15 = new Date(today); in15.setDate(in15.getDate() + 15);
    const in60 = new Date(today); in60.setDate(in60.getDate() + 60);

    let pending = 0, upcoming = 0, active = 0, risk = 0;

    vacations.forEach(v => {
        const start = new Date(v.startDate + 'T00:00:00');
        const end   = new Date(v.endDate   + 'T00:00:00');

        if (v.status === 'pendente') pending++;

        if ((v.status === 'aprovado') && start > today && start <= in15) upcoming++;

        if ((v.status === 'aprovado') && start <= today && end >= today) active++;
    });

    /* Risk: employees whose vacation period expires within 60 days */
    const employees = getEmployees();
    employees.forEach(emp => {
        if (!emp.admissionDate) return;
        const adm = new Date(emp.admissionDate + 'T00:00:00');
        const expiry = nextAnniversary(adm, today);
        if (expiry > today && expiry <= in60) {
            const taken = vacationsTakenInCycle(vacations, String(emp.id), adm, today);
            if (taken < 30) risk++;
        }
    });

    document.getElementById('kpi-pending').textContent  = pending;
    document.getElementById('kpi-upcoming').textContent = upcoming;
    document.getElementById('kpi-active').textContent   = active;
    document.getElementById('kpi-risk').textContent     = risk;
}

function nextAnniversary(admDate, today) {
    const ann = new Date(admDate);
    ann.setFullYear(today.getFullYear());
    if (ann <= today) ann.setFullYear(ann.getFullYear() + 1);
    return ann;
}

function vacationsTakenInCycle(vacations, empId, admDate, today) {
    const cycleStart = new Date(admDate);
    while (true) {
        const cycleEnd = new Date(cycleStart);
        cycleEnd.setFullYear(cycleEnd.getFullYear() + 1);
        if (cycleEnd > today) break;
        cycleStart.setFullYear(cycleStart.getFullYear() + 1);
    }
    return vacations
        .filter(v => String(v.employeeId) === String(empId) && (v.status === 'aprovado' || v.status === 'concluido'))
        .filter(v => { const s = new Date(v.startDate + 'T00:00:00'); return s >= cycleStart; })
        .reduce((sum, v) => sum + (v.days || 0), 0);
}

/* ════════════════════════════
   Table rendering
════════════════════════════ */
function renderTable() {
    const vacations = getVacations();
    const filtered  = applyFilters(vacations);
    const tbody     = document.getElementById('requests-tbody');
    const countEl   = document.getElementById('table-count');

    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr id="empty-row">
                <td colspan="6">
                    <div class="table-empty">
                        <i class="fas fa-umbrella-beach"></i>
                        <p>Nenhuma solicitação encontrada.</p>
                    </div>
                </td>
            </tr>`;
        countEl.textContent = '';
        return;
    }

    filtered.sort((a, b) => new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate));

    filtered.forEach(v => {
        const emp = getEmployee(v.employeeId);
        const name = emp ? emp.name : `ID ${v.employeeId}`;
        const dept = emp ? (emp.department || emp.cargo || '—') : '—';
        const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

        const startFmt = formatDate(v.startDate);
        const endFmt   = formatDate(v.endDate);
        const badge    = buildBadge(v.status);
        const actions  = buildActions(v);
        const financ   = (v.abono || v.hasAbono)
            ? `<span class="badge-abono"><i class="fas fa-coins"></i> Abono</span>`
            : `<span class="badge-no-abono">—</span>`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="emp-cell">
                    <div class="emp-avatar">${initials}</div>
                    <div>
                        <div class="emp-name">${escHtml(name)}</div>
                        <div class="emp-dept">${escHtml(dept)}</div>
                    </div>
                </div>
            </td>
            <td>
                <div class="period-dates">${startFmt} → ${endFmt}</div>
            </td>
            <td><strong>${v.days || '—'}</strong></td>
            <td>${financ}</td>
            <td>${badge}</td>
            <td><div class="actions-cell">${actions}</div></td>`;
        tbody.appendChild(tr);
    });

    countEl.textContent = `${filtered.length} solicitaç${filtered.length === 1 ? 'ão' : 'ões'} encontrada${filtered.length === 1 ? '' : 's'}`;
}

function buildBadge(status) {
    const map = {
        pendente:  'Pendente',
        aprovado:  'Aprovado',
        concluido: 'Concluído',
        recusado:  'Recusado',
    };
    return `<span class="badge badge--${status}">${map[status] || status}</span>`;
}

function buildActions(v) {
    let html = `<button class="btn-action btn-action--view" title="Ver detalhes" onclick="openViewModal('${v.id}')"><i class="fas fa-eye"></i></button>`;
    if (v.status === 'pendente') {
        html += `<button class="btn-action btn-action--approve" title="Aprovar" onclick="approveRequest('${v.id}')"><i class="fas fa-check"></i></button>`;
        html += `<button class="btn-action btn-action--reject"  title="Recusar"  onclick="openRejectModal('${v.id}')"><i class="fas fa-times"></i></button>`;
    }
    if (v.status === 'aprovado' || v.status === 'pendente') {
        html += `<button class="btn-action btn-action--edit" title="Editar" onclick="openEditModal('${v.id}')"><i class="fas fa-pen"></i></button>`;
    }
    return html;
}

/* ════════════════════════════
   Filters
════════════════════════════ */
function applyFilters(list) {
    if (!list) {
        renderTable();
        return;
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const in60  = new Date(today); in60.setDate(in60.getDate() + 60);

    return list.filter(v => {
        /* Status chip */
        if (currentFilter !== 'todos') {
            if (currentFilter === 'risco') {
                const emp = getEmployee(v.employeeId);
                if (!emp || !emp.admissionDate) return false;
                const adm    = new Date(emp.admissionDate + 'T00:00:00');
                const expiry = nextAnniversary(adm, today);
                if (!(expiry > today && expiry <= in60)) return false;
            } else {
                if (v.status !== currentFilter) return false;
            }
        }
        /* Search */
        if (currentSearch) {
            const emp  = getEmployee(v.employeeId);
            const name = emp ? emp.name.toLowerCase() : '';
            const dept = emp ? (emp.department || emp.cargo || '').toLowerCase() : '';
            const q    = currentSearch.toLowerCase();
            if (!name.includes(q) && !dept.includes(q)) return false;
        }
        return true;
    });
}

function setFilter(btn) {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
    btn.classList.add('chip--active');
    currentFilter = btn.dataset.filter;
    renderTable();
}

function clearSearch() {
    document.getElementById('search-input').value = '';
    currentSearch = '';
    document.getElementById('search-clear').classList.add('hidden');
    renderTable();
}

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

/* ════════════════════════════
   Tab switching
════════════════════════════ */
function switchTab(btn, tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');
    if (tabName === 'calendar') renderGantt();
}

/* ════════════════════════════
   Approve / Reject
════════════════════════════ */
function approveRequest(id) {
    const list = getVacations();
    const idx  = list.findIndex(v => v.id === id);
    if (idx === -1) return;
    list[idx].status     = 'aprovado';
    list[idx].approvedAt = new Date().toISOString();
    saveVacations(list);
    autoExpireVacations();
    loadKPIs();
    renderTable();
    showToast('Solicitação aprovada com sucesso!', 'success');
}

function openRejectModal(id) {
    rejectingId = id;
    const v   = getVacations().find(v => v.id === id);
    const emp = v ? getEmployee(v.employeeId) : null;
    document.getElementById('reject-sub').textContent = emp ? `Colaborador: ${emp.name}` : 'Informe o motivo da recusa';
    document.getElementById('reject-reason').value = '';
    clearAlert('reject-alert');
    openModal('reject-modal');
}

function closeRejectModal() { closeModal('reject-modal'); rejectingId = null; }

function confirmReject() {
    const reason = document.getElementById('reject-reason').value.trim();
    if (!reason) { showAlert('reject-alert', 'Informe o motivo da recusa.', 'error'); return; }
    const list = getVacations();
    const idx  = list.findIndex(v => v.id === rejectingId);
    if (idx === -1) { closeRejectModal(); return; }
    list[idx].status          = 'recusado';
    list[idx].rejectionReason = reason;
    list[idx].rejectedAt      = new Date().toISOString();
    saveVacations(list);
    loadKPIs();
    renderTable();
    closeRejectModal();
    showToast('Solicitação recusada.', 'info');
}

/* ════════════════════════════
   Add / Edit modal
════════════════════════════ */
function openAddModal() {
    editingId = null;
    document.getElementById('add-modal-title').textContent = 'Nova Solicitação';
    document.getElementById('add-employee').value = '';
    document.getElementById('add-start').value    = '';
    document.getElementById('add-end').value      = '';
    document.getElementById('add-status').value   = 'pendente';
    document.getElementById('add-abono').checked  = false;
    document.getElementById('add-obs').value      = '';
    document.getElementById('add-days-count').textContent = 'Selecione as datas';
    document.getElementById('add-days-preview').classList.remove('has-value');
    clearAlert('add-alert');
    openModal('add-modal');
}

function openEditModal(id) {
    const v = getVacations().find(v => v.id === id);
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
}

function closeAddModal() { closeModal('add-modal'); editingId = null; }

function calcAddDays() {
    const s = document.getElementById('add-start').value;
    const e = document.getElementById('add-end').value;
    const preview   = document.getElementById('add-days-preview');
    const countSpan = document.getElementById('add-days-count');
    if (!s || !e) { countSpan.textContent = 'Selecione as datas'; preview.classList.remove('has-value'); return; }
    const start = new Date(s + 'T00:00:00');
    const end   = new Date(e + 'T00:00:00');
    if (end < start) { countSpan.textContent = 'Data de fim inválida'; preview.classList.remove('has-value'); return; }
    const days = Math.round((end - start) / 86400000) + 1;
    countSpan.textContent = `${days} dia${days !== 1 ? 's' : ''} de férias`;
    preview.classList.add('has-value');
}

function submitAdd() {
    const empId = document.getElementById('add-employee').value;
    const start = document.getElementById('add-start').value;
    const end   = document.getElementById('add-end').value;
    const status= document.getElementById('add-status').value;
    const abono = document.getElementById('add-abono').checked;
    const obs   = document.getElementById('add-obs').value.trim();

    if (!empId) { showAlert('add-alert', 'Selecione um colaborador.', 'error'); return; }
    if (!start || !end) { showAlert('add-alert', 'Informe o período completo.', 'error'); return; }
    const sDate = new Date(start + 'T00:00:00');
    const eDate = new Date(end   + 'T00:00:00');
    if (eDate < sDate) { showAlert('add-alert', 'Data de fim deve ser após a data de início.', 'error'); return; }

    const days = Math.round((eDate - sDate) / 86400000) + 1;
    if (days < 5) { showAlert('add-alert', 'O período mínimo de férias é de 5 dias.', 'error'); return; }

    const list = getVacations();

    if (editingId) {
        const idx = list.findIndex(v => v.id === editingId);
        if (idx !== -1) {
            list[idx] = { ...list[idx], employeeId: empId, startDate: start, endDate: end, days, status, abono, obs };
            saveVacations(list);
            showToast('Solicitação atualizada!', 'success');
        }
    } else {
        const entry = {
            id:         'v_' + Date.now(),
            employeeId: empId,
            startDate:  start,
            endDate:    end,
            days,
            status,
            abono,
            obs,
            createdAt:  new Date().toISOString(),
        };
        list.push(entry);
        saveVacations(list);
        showToast('Solicitação registrada!', 'success');
    }

    autoExpireVacations();
    loadKPIs();
    renderTable();
    closeAddModal();
}

function populateEmployeeSelect() {
    const sel = document.getElementById('add-employee');
    const employees = getEmployees();
    sel.innerHTML = '<option value="">Selecione o colaborador...</option>';
    employees
        .filter(e => e.status !== 'Inativo' && e.status !== 'Bloqueado')
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `${e.name} — ${e.department || e.cargo || 'Sem departamento'}`;
            sel.appendChild(opt);
        });
}

/* ════════════════════════════
   View modal
════════════════════════════ */
function openViewModal(id) {
    const v   = getVacations().find(v => v.id === id);
    if (!v) return;
    const emp = getEmployee(v.employeeId);
    const name= emp ? emp.name : `ID ${v.employeeId}`;
    const dept= emp ? (emp.department || emp.cargo || '—') : '—';

    const rows = [
        { label: 'Colaborador',   value: escHtml(name) },
        { label: 'Departamento',  value: escHtml(dept) },
        { label: 'Data de Início',value: formatDate(v.startDate) },
        { label: 'Data de Fim',   value: formatDate(v.endDate) },
        { label: 'Dias',          value: v.days || '—' },
        { label: 'Abono Pecuniário', value: v.abono ? 'Sim' : 'Não' },
        { label: 'Status',        value: buildBadge(v.status) },
        ...(v.obs ? [{ label: 'Observação', value: escHtml(v.obs) }] : []),
        ...(v.rejectionReason ? [{ label: 'Motivo da Recusa', value: escHtml(v.rejectionReason) }] : []),
        { label: 'Criado em',     value: v.createdAt ? new Date(v.createdAt).toLocaleDateString('pt-BR') : '—' },
    ];

    document.getElementById('view-body').innerHTML = rows.map(r =>
        `<div class="view-row">
            <span class="view-row-label">${r.label}</span>
            <span class="view-row-value">${r.value}</span>
        </div>`
    ).join('');

    openModal('view-modal');
}

function closeViewModal() { closeModal('view-modal'); }

/* ════════════════════════════
   Gantt
════════════════════════════ */
function renderGantt() {
    const year       = new Date().getFullYear();
    const yearStart  = new Date(year, 0, 1);
    const yearEnd    = new Date(year, 11, 31);
    const totalDays  = (yearEnd - yearStart) / 86400000 + 1;

    /* Month headers */
    const monthsEl = document.getElementById('gantt-months');
    const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    monthsEl.innerHTML = months.map(m => `<div class="gantt-month-cell">${m}</div>`).join('');

    /* Vacations to show */
    const vacations = getVacations().filter(v =>
        (v.status === 'aprovado' || v.status === 'concluido') &&
        (new Date(v.endDate + 'T00:00:00') >= yearStart) &&
        (new Date(v.startDate + 'T00:00:00') <= yearEnd)
    );

    const rowsEl = document.getElementById('gantt-rows');

    if (vacations.length === 0) {
        rowsEl.innerHTML = `<div class="gantt-empty"><i class="fas fa-calendar-alt"></i><p>Nenhuma férias aprovada este ano.</p></div>`;
        return;
    }

    /* Group by employee */
    const byEmp = {};
    vacations.forEach(v => {
        if (!byEmp[v.employeeId]) byEmp[v.employeeId] = [];
        byEmp[v.employeeId].push(v);
    });

    rowsEl.innerHTML = '';

    Object.keys(byEmp).forEach(empId => {
        const emp  = getEmployee(empId);
        const name = emp ? emp.name : `ID ${empId}`;
        const dept = emp ? (emp.department || emp.cargo || '') : '';
        const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

        const row = document.createElement('div');
        row.className = 'gantt-row';

        const labelDiv = `
            <div class="gantt-row-label">
                <div class="g-avatar">${initials}</div>
                <div>
                    <div class="g-name">${escHtml(name)}</div>
                    ${dept ? `<div class="g-dept">${escHtml(dept)}</div>` : ''}
                </div>
            </div>`;

        const barsDiv = document.createElement('div');
        barsDiv.className = 'gantt-row-bars';

        byEmp[empId].forEach(v => {
            const vStart = new Date(v.startDate + 'T00:00:00');
            const vEnd   = new Date(v.endDate   + 'T00:00:00');
            const clampedStart = vStart < yearStart ? yearStart : vStart;
            const clampedEnd   = vEnd   > yearEnd   ? yearEnd   : vEnd;

            const leftDays  = (clampedStart - yearStart) / 86400000;
            const widthDays = (clampedEnd   - clampedStart) / 86400000 + 1;

            const leftPct  = (leftDays  / totalDays) * 100;
            const widthPct = (widthDays / totalDays) * 100;

            const bar = document.createElement('div');
            const cls = v.status === 'aprovado' ? 'gantt-bar--approved' : 'gantt-bar--concluded';
            bar.className = `gantt-bar ${cls}`;
            bar.style.left  = leftPct  + '%';
            bar.style.width = Math.max(widthPct, .3) + '%';
            bar.title       = `${name}: ${formatDate(v.startDate)} → ${formatDate(v.endDate)} (${v.days}d)`;
            barsDiv.appendChild(bar);
        });

        row.innerHTML = labelDiv;
        row.appendChild(barsDiv);
        rowsEl.appendChild(row);
    });
}

/* ════════════════════════════
   Modal helpers
════════════════════════════ */
function openModal(id) {
    document.getElementById(id).classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    document.body.style.overflow = '';
}
function handleOverlayClick(e, id) {
    if (e.target === document.getElementById(id)) closeModal(id);
}

function showAlert(id, msg, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className = 'modal-alert ' + type;
}
function clearAlert(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'modal-alert';
    el.textContent = '';
}

/* ════════════════════════════
   Realtime sync
════════════════════════════ */
function setupRealtimeSync() {
    window.addEventListener('storage', (e) => {
        if (e.key !== VACATIONS_KEY) return;
        autoExpireVacations();
        loadKPIs();
        renderTable();
        renderGantt();
    });
}

/* ════════════════════════════
   Sidebar
════════════════════════════ */
function setupSidebar() {
    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');

    const SIDEBAR_STATE_KEY = 'sidebarState_ferias';
    const isMobile = () => window.innerWidth <= 768;

    function openMobileSidebar() {
        sidebar?.classList.add('open');
        sidebarOverlay?.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeMobileSidebar() {
        sidebar?.classList.remove('open');
        sidebarOverlay?.classList.remove('active');
        document.body.style.overflow = '';
    }

    sidebarToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isMobile()) {
            sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar();
        } else {
            const collapsed = sidebar?.classList.toggle('collapsed');
            mainWrapper?.classList.toggle('sidebar-collapsed', collapsed);
            localStorage.setItem(SIDEBAR_STATE_KEY, collapsed ? 'collapsed' : 'expanded');
        }
    });

    topbarMenuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar();
    });

    sidebarOverlay?.addEventListener('click', closeMobileSidebar);

    if (!isMobile() && localStorage.getItem(SIDEBAR_STATE_KEY) === 'collapsed') {
        sidebar?.classList.add('collapsed');
        mainWrapper?.classList.add('sidebar-collapsed');
    }

    window.addEventListener('resize', () => {
        if (!isMobile()) closeMobileSidebar();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isMobile()) closeMobileSidebar();
    });
}

/* ════════════════════════════
   Toast
════════════════════════════ */
function showToast(msg, type = 'success') {
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas ${icons[type] || icons.success} toast-icon"></i><span>${escHtml(msg)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/* ════════════════════════════
   Utils
════════════════════════════ */
function formatDate(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
}

function escHtml(str) {
    if (typeof str !== 'string') return str ?? '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
