let currentFilter = 'todos';
let currentSearch = '';
let rejectingId = null;
let editingId = null;
let vacations = [];
let employees = [];
let rhUserEmail = null;

function dbToVacation(row) {
    return {
        id: row.id,
        employeeId: row.employee_id,
        startDate: row.start_date,
        endDate: row.end_date,
        days: row.days,
        status: row.status,
        abono: row.abono,
        coletiva: row.coletiva || false,
        substitutoId: row.substituto_id || null,
        obs: row.obs,
        rejectionReason: row.rejection_reason,
        approvedAt: row.approved_at,
        rejectedAt: row.rejected_at,
        createdAt: row.created_at,
    };
}

function dbToEmp(row) {
    return {
        id: row.id,
        name: row.name,
        dept: row.dept,
        role: row.role,
        admissionDate: row.admission_date,
        birthDate: row.birth_date,
        contractType: (row.contract_type || 'clt').toLowerCase(),
        status: row.status,
        avatarUrl: row.avatar_url,
        avatarColor: row.avatar_color,
    };
}

function isEstagioOuAprendiz(emp) {
    const t = emp?.contractType || '';
    return t === 'estagio' || t === 'estágio' || t === 'aprendiz';
}

async function fetchData() {
    const [{ data: vData }, { data: eData }] = await Promise.all([
        sb.from('vacations').select('*').order('created_at', { ascending: false }),
        sb.from('employees').select('id,name,dept,role,admission_date,birth_date,contract_type,status,avatar_url,avatar_color'),
    ]);
    vacations = (vData || []).map(dbToVacation);
    employees = (eData || []).map(dbToEmp);
}

function getEmployee(empId) {
    return employees.find((e) => e.id === empId) || null;
}

function initials(name) {
    return (name || '?')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || '')
        .join('');
}

function nameToColor(name) {
    const p = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#f97316', '#0ea5e9', '#14b8a6'];
    let h = 0;
    for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) | 0;
    return p[Math.abs(h) % p.length];
}

function empAvatarHtml(emp) {
    if (emp?.avatarUrl) return `<div class="emp-avatar" style="background-image:url('${emp.avatarUrl}')"></div>`;
    return `<div class="emp-avatar" style="background:${emp?.avatarColor || nameToColor(emp?.name)}">${initials(emp?.name)}</div>`;
}

async function loadRhSidebar() {
    const auth = await NexusAuth.requireProfile('Administrador');
    if (!auth) return;
    rhUserEmail = auth.user.email;

    const nameEl = document.getElementById('rh-sidebar-name');
    const roleEl = document.getElementById('rh-sidebar-role');
    const avatarEl = document.getElementById('rh-sidebar-avatar');
    if (!nameEl) return;
    nameEl.textContent = 'Administrador';
    if (roleEl) roleEl.textContent = 'Recursos Humanos';
    if (avatarEl) avatarEl.textContent = 'ADM';
}

async function autoExpireVacations() {
    const today = new Date().toISOString().split('T')[0];
    const toExpire = vacations.filter((v) => v.status === 'aprovado' && v.endDate < today);
    if (!toExpire.length) return;
    const ids = toExpire.map((v) => v.id);
    await sb.from('vacations').update({ status: 'concluido' }).in('id', ids);
    toExpire.forEach((v) => (v.status = 'concluido'));
}

function loadKPIs() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in15 = new Date(today);
    in15.setDate(in15.getDate() + 15);

    let pending = 0,
        upcoming = 0,
        active = 0,
        expired = 0;

    vacations.forEach((v) => {
        const start = new Date(v.startDate + 'T00:00:00');
        const end = new Date(v.endDate + 'T00:00:00');
        if (v.status === 'pendente') pending++;
        if (v.status === 'aprovado' && start > today && start <= in15) upcoming++;
        if (v.status === 'aprovado' && start <= today && end >= today) active++;
    });

    employees.forEach((emp) => {
        if (computeFeriasVencidas(emp, today)) expired++;
    });

    document.getElementById('kpi-pending').textContent = pending;
    document.getElementById('kpi-upcoming').textContent = upcoming;
    document.getElementById('kpi-active').textContent = active;
    const expiredEl = document.getElementById('kpi-expired');
    if (expiredEl) expiredEl.textContent = expired;
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

function currentCycleOf(emp, today) {
    if (!emp?.admissionDate) return null;
    const admDate = new Date(emp.admissionDate + 'T00:00:00');
    const cycles = buildAcquisitiveCycles(admDate, today);
    return cycles.length ? cycles[cycles.length - 1] : null;
}

function countFractionsInCycle(empId, cycle) {
    if (!cycle) return [];
    return vacations.filter(
        (v) =>
            v.employeeId === empId &&
            v.status !== 'recusado' &&
            v.status !== 'cancelado' &&
            new Date(v.startDate + 'T00:00:00') >= cycle.start &&
            new Date(v.startDate + 'T00:00:00') <= cycle.end
    );
}

function idadeEm(birthDate, ref) {
    if (!birthDate) return null;
    const b = new Date(birthDate + 'T00:00:00');
    let idade = ref.getFullYear() - b.getFullYear();
    if (ref.getMonth() < b.getMonth() || (ref.getMonth() === b.getMonth() && ref.getDate() < b.getDate())) idade--;
    return idade;
}

function computeFeriasVencidas(emp, today) {
    if (!emp?.admissionDate || isEstagioOuAprendiz(emp)) return null;
    const admDate = new Date(emp.admissionDate + 'T00:00:00');
    const closedCycles = buildAcquisitiveCycles(admDate, today).filter((c) => c.end < today);
    if (!closedCycles.length) return null;

    let usedRemaining = vacations
        .filter((v) => v.employeeId === emp.id && (v.status === 'aprovado' || v.status === 'concluido'))
        .reduce((sum, v) => sum + (v.days || 0), 0);

    let expiredDays = 0,
        oldestConcessivo = null;
    closedCycles.forEach((cycle) => {
        const earned = 30;
        const consumed = Math.min(usedRemaining, earned);
        usedRemaining -= consumed;
        const pending = earned - consumed;
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

async function calcFaltasInjustificadas(empId, cycleStart, cycleEnd) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rangeEnd = cycleEnd < today ? cycleEnd : today;
    if (rangeEnd < cycleStart) return 0;
    const fmt = (d) => d.toISOString().split('T')[0];

    const [{ data: recs }, { data: hols }, { data: adjs }] = await Promise.all([
        sb.from('time_records').select('date,entrada').eq('employee_id', empId).gte('date', fmt(cycleStart)).lte('date', fmt(rangeEnd)),
        sb.from('holidays').select('date'),
        sb
            .from('adjustment_requests')
            .select('date')
            .eq('employee_id', empId)
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

function renderTable() {
    const filtered = applyFilters(vacations);
    const tbody = document.getElementById('requests-tbody');
    const countEl = document.getElementById('table-count');
    tbody.innerHTML = '';

    const visibleIds = new Set(filtered.map((v) => v.id));
    selectedIds.forEach((id) => {
        if (!visibleIds.has(id)) selectedIds.delete(id);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr id="empty-row"><td colspan="7"><div class="table-empty"><i class="fas fa-umbrella-beach"></i><p>Nenhuma solicitação encontrada.</p></div></td></tr>`;
        countEl.textContent = '';
        updateBulkBar();
        return;
    }

    filtered.sort((a, b) => new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate));

    filtered.forEach((v) => {
        const emp = getEmployee(v.employeeId);
        const name = emp ? emp.name : '—';
        const dept = emp ? emp.dept || '—' : '—';
        const tr = document.createElement('tr');
        tr.dataset.id = v.id;
        tr.innerHTML = `
            <td class="select-cell">${v.status === 'pendente' ? `<label class="checkbox-label row-check"><input type="checkbox" data-id="${v.id}" ${selectedIds.has(v.id) ? 'checked' : ''} onchange="toggleRowSelect('${v.id}', this.checked)"><span class="checkbox-box"></span></label>` : ''}</td>
            <td class="col-employee"><div class="emp-cell">${empAvatarHtml(emp)}<div><div class="emp-name">${escHtml(name)}</div><div class="emp-dept">${escHtml(dept)}</div></div></div></td>
            <td><div class="period-dates">${formatDate(v.startDate)} → ${formatDate(v.endDate)}</div></td>
            <td><strong>${v.days || '—'}</strong></td>
            <td>${v.abono ? '<span class="badge-abono"><i class="fas fa-coins"></i> Abono</span>' : '<span class="badge-no-abono">—</span>'}</td>
            <td>${buildBadge(v.status)}${v.coletiva ? ' <span class="badge-coletiva" title="Férias coletivas">Coletiva</span>' : ''}</td>
            <td class="col-actions"><div class="actions-cell">${buildActions(v)}</div></td>`;
        tbody.appendChild(tr);
    });

    countEl.textContent = `${filtered.length} solicitaç${filtered.length === 1 ? 'ão' : 'ões'} encontrada${filtered.length === 1 ? '' : 's'}`;
    updateBulkBar();
}

const selectedIds = new Set();

window.toggleRowSelect = function (id, checked) {
    checked ? selectedIds.add(id) : selectedIds.delete(id);
    updateBulkBar();
};

window.toggleSelectAll = function (checked) {
    document.querySelectorAll('#requests-tbody .row-check input').forEach((cb) => {
        cb.checked = checked;
        checked ? selectedIds.add(cb.dataset.id) : selectedIds.delete(cb.dataset.id);
    });
    updateBulkBar();
};

function updateBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const countEl = document.getElementById('bulk-count');
    const selectAll = document.getElementById('select-all-check');
    if (selectAll) {
        const rowChecks = document.querySelectorAll('#requests-tbody .row-check input');
        selectAll.checked = rowChecks.length > 0 && [...rowChecks].every((cb) => cb.checked);
        selectAll.disabled = rowChecks.length === 0;
    }
    if (!bar) return;
    if (selectedIds.size > 0) {
        bar.classList.add('open');
        if (countEl) countEl.textContent = `${selectedIds.size} selecionada${selectedIds.size === 1 ? '' : 's'}`;
    } else {
        bar.classList.remove('open');
    }
}

window.bulkApprove = async function () {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const targets = ids.map((id) => vacations.find((v) => v.id === id)).filter(Boolean);
    const conflicts = targets.filter((v) => checkDeptConflict(v));
    if (conflicts.length > 0) {
        const names = conflicts
            .map((v) => getEmployee(v.employeeId)?.name || '?')
            .slice(0, 5)
            .join(', ');
        if (
            !confirm(
                `${conflicts.length} das solicitações selecionadas têm conflito de equipe (colegas do mesmo departamento já de férias no período): ${names}. Deseja aprovar todas mesmo assim?`
            )
        )
            return;
    } else if (!confirm(`Aprovar ${ids.length} solicitaç${ids.length === 1 ? 'ão' : 'ões'} selecionada${ids.length === 1 ? '' : 's'}?`)) return;

    const nowIso = new Date().toISOString();
    const { error } = await sb
        .from('vacations')
        .update({ status: 'aprovado', approved_at: nowIso, decided_by_name: 'Administrador', decided_by_email: rhUserEmail })
        .in('id', ids);
    if (error) {
        showToast('Erro ao aprovar em lote.', 'error');
        return;
    }
    targets.forEach((v) => {
        v.status = 'aprovado';
        v.approvedAt = nowIso;
    });
    selectedIds.clear();
    await autoExpireVacations();
    loadKPIs();
    renderTable();
    showToast(`${ids.length} solicitaç${ids.length === 1 ? 'ão aprovada' : 'ões aprovadas'} com sucesso!`, 'success');
};

window.bulkReject = function () {
    if (selectedIds.size === 0) return;
    rejectingId = [...selectedIds];
    document.getElementById('reject-sub').textContent = `${rejectingId.length} solicitações selecionadas`;
    document.getElementById('reject-reason').value = '';
    clearAlert('reject-alert');
    openModal('reject-modal');
};

function buildBadge(status) {
    const map = { pendente: 'Pendente', aprovado: 'Aprovado', concluido: 'Concluído', recusado: 'Recusado', cancelado: 'Cancelado' };
    return `<span class="badge badge--${status}">${map[status] || status}</span>`;
}

function buildActions(v) {
    let html = `<button class="btn-action btn-action--view" title="Ver detalhes" onclick="openViewModal('${v.id}')"><i class="fas fa-eye"></i></button>`;
    if (v.status === 'pendente') {
        html += `<button class="btn-action btn-action--approve" title="Aprovar" onclick="approveRequest('${v.id}')"><i class="fas fa-check"></i></button>`;
        html += `<button class="btn-action btn-action--reject"  title="Recusar" onclick="openRejectModal('${v.id}')"><i class="fas fa-times"></i></button>`;
    }
    if ((v.status === 'aprovado' || v.status === 'concluido') && !v.coletiva) {
        html += `<button class="btn-action btn-action--receipt" title="Gerar recibo" onclick="generateReceipt('${v.id}')"><i class="fas fa-file-invoice"></i></button>`;
    }
    if (v.status === 'aprovado' || v.status === 'pendente') {
        html += `<button class="btn-action btn-action--edit" title="Editar" onclick="openEditModal('${v.id}')"><i class="fas fa-pen"></i></button>`;
    }
    return html;
}

function applyFilters(list) {
    return list.filter((v) => {
        if (currentFilter !== 'todos' && v.status !== currentFilter) return false;
        if (currentSearch) {
            const emp = getEmployee(v.employeeId);
            const name = emp ? emp.name.toLowerCase() : '';
            const dept = emp ? (emp.dept || '').toLowerCase() : '';
            const q = currentSearch.toLowerCase();
            if (!name.includes(q) && !dept.includes(q)) return false;
        }
        return true;
    });
}

window.setFilter = function (btn) {
    document.querySelectorAll('.filter-dropdown-chips .chip').forEach((c) => c.classList.remove('chip--active'));
    btn.classList.add('chip--active');
    currentFilter = btn.dataset.filter;
    updateFilterBtn();
    closeFilterDropdown();
    renderTable();
};

const FILTER_LABELS = { todos: 'Filtro', pendente: 'Pendente', aprovado: 'Aprovado', concluido: 'Concluído', recusado: 'Recusado', cancelado: 'Cancelado' };

const KPI_MODAL_CONFIG = {
    pendente: { title: 'Aguardando Aprovação', sub: 'Solicitações pendentes de análise', icon: 'fa-clock' },
    upcoming: { title: 'Saem nos Próximos 15 Dias', sub: 'Colaboradores com férias aprovadas', icon: 'fa-calendar-check' },
    ativas: { title: 'Atualmente de Férias', sub: 'Colaboradores de férias hoje', icon: 'fa-plane-departure' },
};

window.openKpiModal = function (type) {
    const config = KPI_MODAL_CONFIG[type];
    if (!config) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in15 = new Date(today);
    in15.setDate(in15.getDate() + 15);

    let items = [];
    if (type === 'pendente') {
        items = vacations
            .filter((v) => v.status === 'pendente')
            .map((v) => {
                const emp = getEmployee(v.employeeId);
                return {
                    name: emp?.name || '—',
                    dept: `${emp?.dept || '—'} · ${formatDate(v.startDate)} → ${formatDate(v.endDate)}`,
                    badge: `${v.days || '—'}d`,
                };
            });
    } else if (type === 'upcoming') {
        items = vacations
            .filter((v) => v.status === 'aprovado' && new Date(v.startDate + 'T00:00:00') > today && new Date(v.startDate + 'T00:00:00') <= in15)
            .map((v) => {
                const emp = getEmployee(v.employeeId);
                return { name: emp?.name || '—', dept: `${emp?.dept || '—'} · sai em ${formatDate(v.startDate)}`, badge: `${v.days || '—'}d` };
            });
    } else if (type === 'ativas') {
        items = vacations
            .filter((v) => v.status === 'aprovado' && new Date(v.startDate + 'T00:00:00') <= today && new Date(v.endDate + 'T00:00:00') >= today)
            .map((v) => {
                const emp = getEmployee(v.employeeId);
                const daysLeft = Math.ceil((new Date(v.endDate + 'T00:00:00') - today) / 86400000);
                return { name: emp?.name || '—', dept: `${emp?.dept || '—'} · volta em ${formatDate(v.endDate)}`, badge: `${daysLeft}d` };
            });
    }

    document.getElementById('kpi-info-icon').innerHTML = `<i class="fas ${config.icon}"></i>`;
    document.getElementById('kpi-info-title').textContent = config.title;
    document.getElementById('kpi-info-sub').textContent = config.sub;
    const body = document.getElementById('kpi-info-body');
    body.innerHTML =
        items.length === 0
            ? `<div class="table-empty"><i class="fas fa-circle-check"></i><p>Nenhum registro no momento.</p></div>`
            : items
                  .map(
                      (it) => `
            <div class="expired-row">
                <div>
                    <div class="expired-name">${escHtml(it.name)}</div>
                    <div class="expired-dept">${escHtml(it.dept)}</div>
                </div>
                <div class="expired-days">${escHtml(it.badge)}</div>
            </div>`
                  )
                  .join('');
    openModal('kpi-info-modal');
};

window.closeKpiInfoModal = function () {
    closeModal('kpi-info-modal');
};

function updateFilterBtn() {
    const label = document.getElementById('filter-label');
    const btnEl = document.getElementById('btn-filter');
    if (label) label.textContent = FILTER_LABELS[currentFilter] ?? 'Filtro';
    btnEl?.classList.toggle('filtered', currentFilter !== 'todos');
}

function openFilterDropdown() {
    closeExportDropdown();
    document.getElementById('btn-filter')?.classList.add('open');
    document.getElementById('filter-dropdown-menu')?.classList.add('open');
    document.getElementById('filter-chevron')?.classList.add('open');
}

function closeFilterDropdown() {
    document.getElementById('btn-filter')?.classList.remove('open');
    document.getElementById('filter-dropdown-menu')?.classList.remove('open');
    document.getElementById('filter-chevron')?.classList.remove('open');
}

function setupFilterDropdown() {
    const btn = document.getElementById('btn-filter');
    const menu = document.getElementById('filter-dropdown-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.contains('open') ? closeFilterDropdown() : openFilterDropdown();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closeFilterDropdown);
}

function closeExportDropdown() {
    document.getElementById('export-dropdown-menu')?.classList.remove('open');
    document.getElementById('export-chevron')?.classList.remove('open');
}

function setupExportDropdown() {
    const btn = document.getElementById('btn-export');
    const menu = document.getElementById('export-dropdown-menu');
    const chevron = document.getElementById('export-chevron');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const opening = !menu.classList.contains('open');
        if (opening) closeFilterDropdown();
        menu.classList.toggle('open', opening);
        chevron?.classList.toggle('open', opening);
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closeExportDropdown);
    document.getElementById('export-pdf-btn')?.addEventListener('click', () => {
        closeExportDropdown();
        exportVacationsPDF();
    });
    document.getElementById('export-csv-btn')?.addEventListener('click', () => {
        closeExportDropdown();
        exportVacationsCSV();
    });
}

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

window.switchTab = function (btn, tabName) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');
    if (tabName === 'calendar') {
        renderGantt();
        renderCobertura();
    }
};

function checkDeptConflict(vacation) {
    const emp = getEmployee(vacation.employeeId);
    const dept = emp?.dept;
    if (!dept) return null;
    const start = new Date(vacation.startDate + 'T00:00:00');
    const end = new Date(vacation.endDate + 'T00:00:00');
    const conflicts = vacations.filter((v) => {
        if (v.id === vacation.id || v.status !== 'aprovado') return false;
        const otherEmp = getEmployee(v.employeeId);
        if (otherEmp?.dept !== dept) return false;
        const vStart = new Date(v.startDate + 'T00:00:00');
        const vEnd = new Date(v.endDate + 'T00:00:00');
        return start <= vEnd && end >= vStart;
    });
    return conflicts.length > 0 ? { dept, count: conflicts.length, names: conflicts.map((v) => getEmployee(v.employeeId)?.name || '?') } : null;
}

window.approveRequest = async function (id) {
    const vac = vacations.find((v) => v.id === id);
    if (!vac) return;
    const conflict = checkDeptConflict(vac);
    if (conflict) {
        const names = conflict.names.slice(0, 3).join(', ') + (conflict.names.length > 3 ? '…' : '');
        const ok = confirm(
            `Atenção: ${conflict.count} colaborador(es) do departamento "${conflict.dept}" já está(ão) de férias no mesmo período:\n${names}\n\nDeseja aprovar mesmo assim?`
        );
        if (!ok) return;
    }
    const { error } = await sb
        .from('vacations')
        .update({ status: 'aprovado', approved_at: new Date().toISOString(), decided_by_name: 'Administrador', decided_by_email: rhUserEmail })
        .eq('id', id);
    if (error) {
        showToast('Erro ao aprovar.', 'error');
        return;
    }
    vac.status = 'aprovado';
    vac.approvedAt = new Date().toISOString();
    await autoExpireVacations();
    loadKPIs();
    renderTable();
    showToast('Solicitação aprovada com sucesso!', 'success');
};

window.openRejectModal = function (id) {
    rejectingId = id;
    const v = vacations.find((v) => v.id === id);
    const emp = v ? getEmployee(v.employeeId) : null;
    document.getElementById('reject-sub').textContent = emp ? `Colaborador: ${emp.name}` : 'Informe o motivo da recusa';
    document.getElementById('reject-reason').value = '';
    clearAlert('reject-alert');
    openModal('reject-modal');
};

window.closeRejectModal = function () {
    closeModal('reject-modal');
    rejectingId = null;
};

window.prefillRejectReason = function (text) {
    const el = document.getElementById('reject-reason');
    if (el) {
        el.value = text;
        el.focus();
    }
};

window.confirmReject = async function () {
    const reason = document.getElementById('reject-reason').value.trim();
    if (!reason) {
        showAlert('reject-alert', 'Informe o motivo da recusa.', 'error');
        return;
    }
    const ids = Array.isArray(rejectingId) ? rejectingId : [rejectingId];
    const nowIso = new Date().toISOString();
    const { error } = await sb
        .from('vacations')
        .update({
            status: 'recusado',
            rejection_reason: reason,
            rejected_at: nowIso,
            decided_by_name: 'Administrador',
            decided_by_email: rhUserEmail,
        })
        .in('id', ids);
    if (error) {
        showToast('Erro ao recusar.', 'error');
        return;
    }
    ids.forEach((id) => {
        const vac = vacations.find((v) => v.id === id);
        if (vac) {
            vac.status = 'recusado';
            vac.rejectionReason = reason;
        }
    });
    selectedIds.clear();
    loadKPIs();
    renderTable();
    closeRejectModal();
    showToast(ids.length > 1 ? `${ids.length} solicitações recusadas.` : 'Solicitação recusada.', 'info');
};

window.openAddModal = function () {
    editingId = null;
    document.getElementById('add-modal-title').textContent = 'Nova Solicitação';
    ['add-employee', 'add-obs'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    setDatePickerValue('add-start', '');
    setDatePickerValue('add-end', '');
    document.getElementById('add-status').value = 'pendente';
    document.getElementById('add-abono').checked = false;
    document.getElementById('add-days-count').textContent = 'Selecione as datas';
    document.getElementById('add-days-preview')?.classList.remove('has-value');
    document.getElementById('add-emp-saldo-info')?.classList.add('hidden');
    document.getElementById('add-emp-ferias-info')?.classList.add('hidden');
    populateSubstitutoSelect(null, '');
    clearAlert('add-alert');
    openModal('add-modal');
};

window.openEditModal = function (id) {
    const v = vacations.find((v) => v.id === id);
    if (!v) return;
    editingId = id;
    document.getElementById('add-modal-title').textContent = 'Editar Solicitação';
    document.getElementById('add-employee').value = v.employeeId;
    setDatePickerValue('add-start', v.startDate);
    setDatePickerValue('add-end', v.endDate);
    document.getElementById('add-status').value = v.status;
    document.getElementById('add-abono').checked = v.abono || false;
    document.getElementById('add-obs').value = v.obs || '';
    populateSubstitutoSelect(v.employeeId, v.substitutoId);
    calcAddDays();
    clearAlert('add-alert');
    openModal('add-modal');
    renderEmpSaldoBanco();
    renderEmpFeriasInfo(v.employeeId);
};

window.onAddEmployeeChange = function () {
    const empId = document.getElementById('add-employee')?.value;
    renderEmpSaldoBanco();
    renderEmpFeriasInfo(empId);
    const currentSubstituto = document.getElementById('add-substituto')?.value;
    populateSubstitutoSelect(empId, currentSubstituto);
};

async function renderEmpFeriasInfo(empId) {
    const el = document.getElementById('add-emp-ferias-info');
    if (!el) return;
    const abonoEl = document.getElementById('add-abono');
    if (!empId) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    const emp = getEmployee(empId);
    if (!emp?.admissionDate) {
        el.classList.add('hidden');
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cycle = currentCycleOf(emp, today);
    if (!cycle) {
        el.classList.add('hidden');
        return;
    }

    const estagio = isEstagioOuAprendiz(emp);
    const fractions = countFractionsInCycle(empId, cycle);
    const idade = idadeEm(emp.birthDate, today);
    const singlePeriodOnly = !estagio && idade !== null && (idade < 18 || idade >= 50);

    let html = `<i class="fas fa-umbrella-beach"></i> Ciclo atual: <strong>${fractions.length}/3</strong> fraç${fractions.length === 1 ? 'ão utilizada' : 'ões utilizadas'}`;
    let negativo = false;

    if (estagio) {
        html += ' · estagiário/aprendiz: recesso remunerado, sem abono pecuniário';
        if (abonoEl) {
            abonoEl.checked = false;
            abonoEl.disabled = true;
        }
    } else {
        const faltas = await calcFaltasInjustificadas(empId, cycle.start, cycle.end);
        const direito = diasDireitoPorFaltas(faltas);
        html += ` · direito a <strong>${direito} dias</strong> neste ciclo`;
        if (faltas > 0) html += ` (${faltas} falta${faltas === 1 ? '' : 's'} injustificada${faltas === 1 ? '' : 's'})`;
        negativo = direito < 30;
        if (abonoEl) abonoEl.disabled = false;
    }
    if (singlePeriodOnly) {
        html += `<br><i class="fas fa-triangle-exclamation"></i> Menor de 18 ou 50 anos ou mais: férias devem ser gozadas em período único (art. 134 §2º CLT).`;
        negativo = true;
    }

    el.innerHTML = html;
    el.className = `add-emp-ferias-info${negativo ? ' negativo' : ''}`;
    el.classList.remove('hidden');
}

async function renderEmpSaldoBanco() {
    const el = document.getElementById('add-emp-saldo-info');
    if (!el) return;
    const empId = document.getElementById('add-employee')?.value;
    if (!empId) {
        el.classList.add('hidden');
        return;
    }
    const emp = getEmployee(empId);
    const tipo = (emp?.contractType || 'clt').toLowerCase();
    if (tipo === 'pj') {
        el.classList.add('hidden');
        return;
    }
    const jornadaMin = tipo === 'estagio' || tipo === 'estágio' || tipo === 'aprendiz' ? 360 : 480;

    const now = new Date();
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [{ data: recs }, { data: adjs }] = await Promise.all([
        sb.from('time_records').select('entrada,saida_almoco,retorno_almoco,saida').eq('employee_id', empId).gte('date', `${mk}-01`),
        sb.from('bank_adjustments').select('tipo,minutos').eq('employee_id', empId).gte('date', `${mk}-01`).is('deleted_at', null),
    ]);
    const diffMin = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);
    let net = 0;
    (recs || []).forEach((r) => {
        if (!r.entrada || !r.saida) return;
        const worked = r.saida_almoco
            ? diffMin(r.entrada, r.saida_almoco) + (r.retorno_almoco && r.saida ? diffMin(r.retorno_almoco, r.saida) : 0)
            : diffMin(r.entrada, r.saida);
        net += worked - jornadaMin;
    });
    (adjs || []).forEach((a) => {
        net += a.tipo === 'credito' ? a.minutos : -a.minutos;
    });

    const abs = Math.abs(net),
        h = Math.floor(abs / 60),
        m = String(abs % 60).padStart(2, '0');
    const sinal = net > 0 ? '+' : net < 0 ? '-' : '';
    el.innerHTML = `<i class="fas fa-clock"></i> Saldo do banco de horas (mês atual, referência): <strong>${sinal}${h}h ${m}min</strong>`;
    el.className = `add-emp-saldo-info ${net > 0 ? 'positivo' : net < 0 ? 'negativo' : ''}`;
}

window.closeAddModal = function () {
    closeModal('add-modal');
    editingId = null;
};

window.calcAddDays = function () {
    const s = document.getElementById('add-start').value;
    const e = document.getElementById('add-end').value;
    const preview = document.getElementById('add-days-preview');
    const countSpan = document.getElementById('add-days-count');
    if (!s || !e) {
        countSpan.textContent = 'Selecione as datas';
        preview?.classList.remove('has-value');
        return;
    }
    const start = new Date(s + 'T00:00:00');
    const end = new Date(e + 'T00:00:00');
    if (end < start) {
        countSpan.textContent = 'Data de fim inválida';
        preview?.classList.remove('has-value');
        return;
    }
    const days = Math.round((end - start) / 86400000) + 1;
    countSpan.textContent = `${days} dia${days !== 1 ? 's' : ''} de férias`;
    preview?.classList.add('has-value');
};

window.submitAdd = async function () {
    const empId = document.getElementById('add-employee').value;
    const start = document.getElementById('add-start').value;
    const end = document.getElementById('add-end').value;
    const status = document.getElementById('add-status').value;
    const abono = document.getElementById('add-abono').checked;
    const substitutoId = document.getElementById('add-substituto')?.value || null;
    const obs = document.getElementById('add-obs').value.trim();

    if (!empId) {
        showAlert('add-alert', 'Selecione um colaborador.', 'error');
        return;
    }
    if (!start || !end) {
        showAlert('add-alert', 'Informe o período completo.', 'error');
        return;
    }
    const sDate = new Date(start + 'T00:00:00');
    const eDate = new Date(end + 'T00:00:00');
    if (eDate < sDate) {
        showAlert('add-alert', 'Data de fim deve ser após a data de início.', 'error');
        return;
    }
    const days = Math.round((eDate - sDate) / 86400000) + 1;
    if (days < 5) {
        showAlert('add-alert', 'O período mínimo de férias é de 5 dias.', 'error');
        return;
    }

    const emp = getEmployee(empId);
    if (emp?.admissionDate && status !== 'recusado' && status !== 'cancelado') {
        const cycle = currentCycleOf(emp, sDate) || currentCycleOf(emp, new Date());
        if (cycle) {
            const others = countFractionsInCycle(empId, cycle).filter((v) => v.id !== editingId);
            const fractionNumber = others.length + 1;
            if (fractionNumber > 3) {
                if (
                    !confirm(
                        `Este colaborador já tem ${others.length} frações de férias neste ciclo aquisitivo. A CLT permite no máximo 3 (art. 134 §1º). Deseja registrar mesmo assim?`
                    )
                )
                    return;
            } else if (fractionNumber === 3 && !others.some((v) => (v.days || 0) >= 14) && days < 14) {
                if (
                    !confirm(
                        'Nenhuma fração deste ciclo tem 14 dias corridos ou mais. A CLT exige que ao menos uma tenha no mínimo 14 dias (art. 134 §1º). Deseja registrar mesmo assim?'
                    )
                )
                    return;
            }
            const idade = idadeEm(emp.birthDate, sDate);
            if (!isEstagioOuAprendiz(emp) && idade !== null && (idade < 18 || idade >= 50) && fractionNumber > 1) {
                if (
                    !confirm(
                        'Colaboradores com menos de 18 ou 50 anos ou mais devem gozar férias em período único (art. 134 §2º CLT). Deseja registrar mesmo assim?'
                    )
                )
                    return;
            }
        }
    }

    if (editingId) {
        const { error } = await sb
            .from('vacations')
            .update({ employee_id: empId, start_date: start, end_date: end, days, status, abono, obs, substituto_id: substitutoId })
            .eq('id', editingId);
        if (error) {
            showAlert('add-alert', 'Erro ao salvar. Tente novamente.', 'error');
            return;
        }
        const idx = vacations.findIndex((v) => v.id === editingId);
        if (idx !== -1) Object.assign(vacations[idx], { employeeId: empId, startDate: start, endDate: end, days, status, abono, obs, substitutoId });
        showToast('Solicitação atualizada!', 'success');
    } else {
        const { data, error } = await sb
            .from('vacations')
            .insert({ employee_id: empId, start_date: start, end_date: end, days, status, abono, obs, substituto_id: substitutoId })
            .select()
            .single();
        if (error) {
            showAlert('add-alert', 'Erro ao registrar. Tente novamente.', 'error');
            return;
        }
        vacations.unshift(dbToVacation(data));
        showToast('Solicitação registrada!', 'success');
    }

    await autoExpireVacations();
    loadKPIs();
    renderTable();
    closeAddModal();
};

function populateEmployeeSelect() {
    const sel = document.getElementById('add-employee');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione o colaborador...</option>';
    employees
        .filter((e) => e.status !== 'Inativo')
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .forEach((e) => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `${e.name} — ${e.dept || 'Sem departamento'}`;
            sel.appendChild(opt);
        });
}

function populateSubstitutoSelect(excludeId, selectedId) {
    const sel = document.getElementById('add-substituto');
    if (!sel) return;
    sel.innerHTML = '<option value="">Nenhum</option>';
    employees
        .filter((e) => e.status !== 'Inativo' && e.id !== excludeId)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .forEach((e) => {
            const opt = document.createElement('option');
            opt.value = e.id;
            opt.textContent = `${e.name} — ${e.dept || 'Sem departamento'}`;
            sel.appendChild(opt);
        });
    sel.value = selectedId || '';
}

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const datePickers = {};

function setDatePickerValue(fieldId, isoDate) {
    const hidden = document.getElementById(fieldId);
    const text = document.getElementById(`${fieldId}-text`);
    if (hidden) hidden.value = isoDate;
    if (text) text.textContent = isoDate ? formatDate(isoDate) : 'Selecionar data';
    const picker = datePickers[fieldId];
    if (picker) picker.selected = isoDate || null;
}

function setupDatePicker(fieldId) {
    const trigger = document.getElementById(`${fieldId}-trigger`);
    const popover = document.getElementById(`${fieldId}-popover`);
    const hidden = document.getElementById(fieldId);
    if (!trigger || !popover || !hidden) return;
    const titleEl = popover.querySelector('.calendar-title');
    const gridEl = popover.querySelector('.calendar-grid');
    const prevBtn = popover.querySelector('[data-nav="prev"]');
    const nextBtn = popover.querySelector('[data-nav="next"]');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const state = { viewYear: today.getFullYear(), viewMonth: today.getMonth(), selected: null };
    datePickers[fieldId] = state;

    function render() {
        titleEl.textContent = `${MESES_PT[state.viewMonth]} ${state.viewYear}`;
        const startOffset = new Date(state.viewYear, state.viewMonth, 1).getDay();
        const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(state.viewYear, state.viewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const iso = `${state.viewYear}-${String(state.viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            cells.push({ day: d, muted: false, iso, isToday: iso === formatIso(today), isSelected: iso === state.selected });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map(
                (c) =>
                    `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}${c.isSelected ? ' calendar-day--selected' : ''}" ${c.muted ? 'disabled' : `data-iso="${c.iso}"`}>${c.day}</button>`
            )
            .join('');
    }

    function formatIso(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function positionPopover() {
        const rect = trigger.getBoundingClientRect();
        const popW = popover.offsetWidth || 280;
        const modal = trigger.closest('.modal-content');
        const bounds = modal ? modal.getBoundingClientRect() : null;
        const minLeft = Math.max(12, bounds ? bounds.left : 12);
        const maxLeft = Math.min(window.innerWidth - popW - 12, bounds ? bounds.right - popW : window.innerWidth - popW - 12);
        let left = rect.right - popW;
        if (left < minLeft) left = Math.min(rect.left, maxLeft);
        left = Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft));
        const top = rect.bottom + 8;
        const cb = popover.offsetParent ? popover.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
        popover.style.left = `${left - cb.left}px`;
        popover.style.top = `${top - cb.top}px`;
    }
    function onReposition() {
        if (popover.classList.contains('open')) positionPopover();
    }

    function open() {
        document.querySelectorAll('.calendar-popover.open').forEach((p) => {
            if (p !== popover) p.classList.remove('open');
        });
        if (state.selected) {
            const [y, m] = state.selected.split('-');
            state.viewYear = +y;
            state.viewMonth = +m - 1;
        }
        render();
        popover.classList.add('open');
        positionPopover();
        trigger.classList.add('active');
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
        window.addEventListener('scroll', onReposition, true);
        window.addEventListener('resize', onReposition);
    }
    function close() {
        popover.classList.remove('open');
        trigger.classList.remove('active');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
        window.removeEventListener('scroll', onReposition, true);
        window.removeEventListener('resize', onReposition);
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
    prevBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        state.viewMonth--;
        if (state.viewMonth < 0) {
            state.viewMonth = 11;
            state.viewYear--;
        }
        render();
    });
    nextBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        state.viewMonth++;
        if (state.viewMonth > 11) {
            state.viewMonth = 0;
            state.viewYear++;
        }
        render();
    });
    gridEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.calendar-day[data-iso]');
        if (!btn) return;
        setDatePickerValue(fieldId, btn.dataset.iso);
        hidden.dispatchEvent(new Event('change'));
        close();
    });
}

function populateColetivaDeptSelect() {
    const sel = document.getElementById('coletiva-dept');
    if (!sel) return;
    const depts = [...new Set(employees.filter((e) => e.status !== 'Inativo' && e.dept).map((e) => e.dept))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    sel.innerHTML = '<option value="">Toda a empresa</option>' + depts.map((d) => `<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('');
}

window.openColetivaModal = function () {
    populateColetivaDeptSelect();
    setDatePickerValue('coletiva-start', '');
    setDatePickerValue('coletiva-end', '');
    document.getElementById('coletiva-obs').value = '';
    clearAlert('coletiva-alert');
    openModal('coletiva-modal');
};

window.closeColetivaModal = function () {
    closeModal('coletiva-modal');
};

window.submitColetiva = async function () {
    const dept = document.getElementById('coletiva-dept').value;
    const start = document.getElementById('coletiva-start').value;
    const end = document.getElementById('coletiva-end').value;
    const obs = document.getElementById('coletiva-obs').value.trim();

    if (!start || !end) {
        showAlert('coletiva-alert', 'Informe o período completo.', 'error');
        return;
    }
    const sDate = new Date(start + 'T00:00:00');
    const eDate = new Date(end + 'T00:00:00');
    if (eDate < sDate) {
        showAlert('coletiva-alert', 'Data de fim deve ser após a data de início.', 'error');
        return;
    }
    const days = Math.round((eDate - sDate) / 86400000) + 1;

    const targets = employees.filter((e) => e.status !== 'Inativo' && (!dept || e.dept === dept) && !isEstagioOuAprendiz(e));
    if (targets.length === 0) {
        showAlert('coletiva-alert', 'Nenhum colaborador elegível encontrado para este filtro.', 'error');
        return;
    }

    const skipped = [];
    const rows = [];
    targets.forEach((emp) => {
        const overlapping = vacations.some(
            (v) =>
                v.employeeId === emp.id &&
                v.status !== 'recusado' &&
                v.status !== 'cancelado' &&
                sDate <= new Date(v.endDate + 'T00:00:00') &&
                eDate >= new Date(v.startDate + 'T00:00:00')
        );
        if (overlapping) {
            skipped.push(emp.name);
            return;
        }
        rows.push({
            employee_id: emp.id,
            start_date: start,
            end_date: end,
            days,
            status: 'aprovado',
            abono: false,
            obs: obs || 'Férias coletivas',
            coletiva: true,
            approved_at: new Date().toISOString(),
            decided_by_name: 'Administrador',
            decided_by_email: rhUserEmail,
        });
    });

    if (rows.length === 0) {
        showAlert('coletiva-alert', 'Todos os colaboradores elegíveis já possuem férias no período informado.', 'error');
        return;
    }

    const { data, error } = await sb.from('vacations').insert(rows).select();
    if (error) {
        showAlert('coletiva-alert', 'Erro ao registrar férias coletivas. Tente novamente.', 'error');
        return;
    }
    (data || []).forEach((row) => vacations.unshift(dbToVacation(row)));

    await autoExpireVacations();
    loadKPIs();
    renderTable();
    if (document.getElementById('tab-calendar')?.classList.contains('active')) renderGantt();
    closeColetivaModal();
    showToast(
        `Férias coletivas registradas para ${rows.length} colaborador${rows.length === 1 ? '' : 'es'}${skipped.length ? ` (${skipped.length} pulado${skipped.length === 1 ? '' : 's'} por conflito de datas)` : ''}.`,
        'success'
    );
};

window.openViewModal = function (id) {
    const v = vacations.find((v) => v.id === id);
    if (!v) return;
    const emp = getEmployee(v.employeeId);
    const name = emp ? emp.name : '—';
    const dept = emp ? emp.dept || '—' : '—';

    let fractionInfo = '—';
    if (emp?.admissionDate) {
        const cycle = currentCycleOf(emp, new Date(v.startDate + 'T00:00:00'));
        if (cycle) {
            const fractions = countFractionsInCycle(emp.id, cycle).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
            const idx = fractions.findIndex((f) => f.id === v.id);
            if (idx !== -1) fractionInfo = `${idx + 1}/3 no ciclo`;
        }
    }

    const rows = [
        { label: 'Colaborador', value: escHtml(name) },
        { label: 'Departamento', value: escHtml(dept) },
        { label: 'Data de Início', value: formatDate(v.startDate) },
        { label: 'Data de Fim', value: formatDate(v.endDate) },
        { label: 'Dias', value: v.days || '—' },
        { label: 'Fração no ciclo', value: fractionInfo },
        { label: 'Abono Pecuniário', value: v.abono ? 'Sim' : 'Não' },
        { label: 'Substituto / Cobertura', value: v.substitutoId ? escHtml(getEmployee(v.substitutoId)?.name || '—') : '—' },
        { label: 'Status', value: buildBadge(v.status) + (v.coletiva ? ' <span class="badge-coletiva">Coletiva</span>' : '') },
        ...(v.obs ? [{ label: 'Observação', value: escHtml(v.obs) }] : []),
        ...(v.rejectionReason ? [{ label: 'Motivo da Recusa', value: escHtml(v.rejectionReason) }] : []),
        { label: 'Criado em', value: v.createdAt ? new Date(v.createdAt).toLocaleDateString('pt-BR') : '—' },
    ];
    const rowsHtml = rows
        .map((r) => `<div class="view-row"><span class="view-row-label">${r.label}</span><span class="view-row-value">${r.value}</span></div>`)
        .join('');
    const calendarActions =
        v.status === 'aprovado' || v.status === 'concluido'
            ? `<div class="view-calendar-actions">
                <button class="btn-cal" onclick="openGoogleCalendar('${v.id}')"><i class="fab fa-google"></i> Google Calendar</button>
                <button class="btn-cal" onclick="downloadIcs('${v.id}')"><i class="fas fa-file-arrow-down"></i> Baixar .ics (Outlook)</button>
           </div>`
            : '';
    document.getElementById('view-body').innerHTML = rowsHtml + calendarActions;
    openModal('view-modal');
};

window.closeViewModal = function () {
    closeModal('view-modal');
};

window.generateReceipt = function (id) {
    const v = vacations.find((v) => v.id === id);
    if (!v) return;
    const emp = getEmployee(v.employeeId);
    const win = window.open('', '_blank');
    if (!win) {
        showToast('Permita pop-ups para gerar o recibo.', 'error');
        return;
    }
    const hoje = new Date().toLocaleDateString('pt-BR');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Recibo de Férias — ${escHtml(emp?.name || '')}</title>
        <style>
            body{font-family:Arial,sans-serif;padding:40px;color:#111;max-width:720px;margin:0 auto;}
            h1{font-size:18px;margin-bottom:2px;} .sub{color:#555;font-size:13px;margin-bottom:24px;}
            table{width:100%;border-collapse:collapse;margin:18px 0;}
            td{padding:8px 4px;border-bottom:1px solid #ddd;font-size:14px;vertical-align:top;}
            td.label{color:#666;width:220px;}
            .box{border:1px solid #ccc;border-radius:8px;padding:16px;margin-top:20px;font-size:12.5px;color:#444;line-height:1.6;}
            .sign{margin-top:70px;display:flex;justify-content:space-between;}
            .sign div{width:45%;border-top:1px solid #333;text-align:center;padding-top:6px;font-size:12.5px;}
            @media print { body{padding:0;} }
        </style></head><body>
        <h1>Recibo e Aviso de Concessão de Férias</h1>
        <p class="sub">Emitido em ${hoje} · Nexus RH</p>
        <table>
            <tr><td class="label">Colaborador</td><td>${escHtml(emp?.name || '—')}</td></tr>
            <tr><td class="label">Departamento / Função</td><td>${escHtml(emp?.dept || '—')} ${emp?.role ? '/ ' + escHtml(emp.role) : ''}</td></tr>
            <tr><td class="label">Período de Gozo</td><td>${formatDate(v.startDate)} a ${formatDate(v.endDate)} (${v.days} dias corridos)</td></tr>
            <tr><td class="label">Abono Pecuniário (⅓ vendido)</td><td>${v.abono ? 'Sim — 10 dias convertidos em pagamento adicional' : 'Não'}</td></tr>
            <tr><td class="label">Substituto / Cobertura</td><td>${escHtml(v.substitutoId ? getEmployee(v.substitutoId)?.name || '—' : '—')}</td></tr>
            <tr><td class="label">Natureza</td><td>${v.coletiva ? 'Férias coletivas' : 'Férias individuais'}</td></tr>
        </table>
        <div class="box">
            Este documento formaliza a concessão de férias, com comunicação ao colaborador com antecedência
            mínima de 30 dias, nos termos do art. 135 da CLT. O pagamento da remuneração de férias, acrescida
            do terço constitucional (art. 7º, XVII, CF/88), deve ocorrer até 2 dias antes do início do período de gozo.
        </div>
        <div class="sign">
            <div>Assinatura do Colaborador</div>
            <div>Assinatura do RH</div>
        </div>
        <script>window.onload = () => window.print();<\/script>
        </body></html>`);
    win.document.close();
};

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
        'PRODID:-//Nexus RH//Ferias//PT-BR',
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
    const v = vacations.find((v) => v.id === id);
    if (!v) return;
    const emp = getEmployee(v.employeeId);
    const title = `Férias — ${emp?.name || 'Colaborador'}`;
    const desc = `Período de férias de ${formatDate(v.startDate)} a ${formatDate(v.endDate)} (${v.days} dias).`;
    const blob = new Blob([buildIcsContent(title, v.startDate, v.endDate, desc)], { type: 'text/calendar;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ferias_${(emp?.name || 'colaborador').replace(/\s+/g, '_')}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};

window.openGoogleCalendar = function (id) {
    const v = vacations.find((v) => v.id === id);
    if (!v) return;
    const emp = getEmployee(v.employeeId);
    const title = encodeURIComponent(`Férias — ${emp?.name || 'Colaborador'}`);
    const details = encodeURIComponent(`Período de férias de ${formatDate(v.startDate)} a ${formatDate(v.endDate)} (${v.days} dias).`);
    const dates = `${icsDate(v.startDate)}/${icsDateExclusiveEnd(v.endDate)}`;
    window.open(`https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}`, '_blank');
};

const STATUS_LABELS_EXPORT = { pendente: 'Pendente', aprovado: 'Aprovado', concluido: 'Concluído', recusado: 'Recusado', cancelado: 'Cancelado' };

function buildExportRows() {
    return applyFilters(vacations)
        .sort((a, b) => new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate))
        .map((v) => {
            const emp = getEmployee(v.employeeId);
            const sub = getEmployee(v.substitutoId);
            return {
                nome: emp?.name || '—',
                dept: emp?.dept || '—',
                inicio: formatDate(v.startDate),
                fim: formatDate(v.endDate),
                dias: v.days || '—',
                status: STATUS_LABELS_EXPORT[v.status] || v.status,
                abono: v.abono ? 'Sim' : 'Não',
                coletiva: v.coletiva ? 'Sim' : 'Não',
                substituto: sub?.name || '—',
                obs: v.obs || '',
            };
        });
}

window.exportVacationsCSV = function () {
    const rows = buildExportRows();
    if (rows.length === 0) {
        showToast('Nenhuma solicitação para exportar com o filtro atual.', 'error');
        return;
    }
    const header = ['Colaborador', 'Departamento', 'Início', 'Fim', 'Dias', 'Status', 'Abono', 'Coletiva', 'Substituto', 'Observação'];
    const escCsv = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [header.map(escCsv).join(';')];
    rows.forEach((r) => lines.push([r.nome, r.dept, r.inicio, r.fim, r.dias, r.status, r.abono, r.coletiva, r.substituto, r.obs].map(escCsv).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ferias_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('CSV exportado com sucesso!', 'success');
};

window.exportVacationsPDF = function () {
    const rows = buildExportRows();
    if (rows.length === 0) {
        showToast('Nenhuma solicitação para exportar com o filtro atual.', 'error');
        return;
    }
    const win = window.open('', '_blank');
    if (!win) {
        showToast('Permita pop-ups para exportar o PDF.', 'error');
        return;
    }
    const hoje = new Date().toLocaleDateString('pt-BR');
    const tableRows = rows
        .map(
            (r) => `<tr>
        <td>${escHtml(r.nome)}</td><td>${escHtml(r.dept)}</td><td>${r.inicio} → ${r.fim}</td>
        <td>${r.dias}</td><td>${escHtml(r.status)}</td><td>${r.abono}</td><td>${escHtml(r.substituto)}</td>
    </tr>`
        )
        .join('');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Calendário de Férias</title>
        <style>
            body{font-family:Arial,sans-serif;padding:32px;color:#111;}
            h1{font-size:18px;margin-bottom:2px;} .sub{color:#555;font-size:12.5px;margin-bottom:18px;}
            table{width:100%;border-collapse:collapse;font-size:11.5px;}
            th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;}
            th{background:#f3f4f6;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:#555;}
            @media print { body{padding:0;} }
        </style></head><body>
        <h1>Calendário de Férias</h1>
        <p class="sub">Exportado em ${hoje} · ${rows.length} solicitaç${rows.length === 1 ? 'ão' : 'ões'} · Nexus RH</p>
        <table>
            <thead><tr><th>Colaborador</th><th>Depto</th><th>Período</th><th>Dias</th><th>Status</th><th>Abono</th><th>Substituto</th></tr></thead>
            <tbody>${tableRows}</tbody>
        </table>
        <script>window.onload = () => window.print();<\/script>
        </body></html>`);
    win.document.close();
};

window.openExpiredModal = function () {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const items = employees
        .map((emp) => ({ emp, vencida: computeFeriasVencidas(emp, today) }))
        .filter((x) => x.vencida)
        .sort((a, b) => b.vencida.days - a.vencida.days);

    const body = document.getElementById('expired-body');
    if (!body) return;
    if (items.length === 0) {
        body.innerHTML = `<div class="table-empty"><i class="fas fa-circle-check"></i><p>Nenhuma férias vencida no momento.</p></div>`;
    } else {
        body.innerHTML = items
            .map(
                ({ emp, vencida }) => `
            <div class="expired-row">
                <div>
                    <div class="expired-name">${escHtml(emp.name)}</div>
                    <div class="expired-dept">${escHtml(emp.dept || '—')} · vencida desde ${vencida.since ? vencida.since.toLocaleDateString('pt-BR') : '—'}</div>
                </div>
                <div class="expired-days">${vencida.days}d</div>
            </div>`
            )
            .join('');
    }
    openModal('expired-modal');
};

window.closeExpiredModal = function () {
    closeModal('expired-modal');
};

let calendarYear = new Date().getFullYear();

function deptColor(dept) {
    return nameToColor(dept || '—');
}

function renderGantt() {
    const year = calendarYear;
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const totalDays = (yearEnd - yearStart) / 86400000 + 1;

    const yearLabel = document.getElementById('calendar-year-label');
    if (yearLabel) yearLabel.textContent = String(year);

    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);
    const currentMonthIdx = today0.getFullYear() === year ? today0.getMonth() : -1;
    document.getElementById('gantt-months').innerHTML = months
        .map((m, i) => `<div class="gantt-month-cell${i === currentMonthIdx ? ' current' : ''}">${m}</div>`)
        .join('');

    const toShow = vacations.filter(
        (v) =>
            (v.status === 'aprovado' || v.status === 'concluido') &&
            new Date(v.endDate + 'T00:00:00') >= yearStart &&
            new Date(v.startDate + 'T00:00:00') <= yearEnd
    );

    const rowsEl = document.getElementById('gantt-rows');
    if (toShow.length === 0) {
        rowsEl.innerHTML = `<div class="gantt-empty"><i class="fas fa-calendar-alt"></i><p>Nenhuma férias aprovada em ${year}.</p></div>`;
        return;
    }

    const byEmp = {};
    toShow.forEach((v) => {
        if (!byEmp[v.employeeId]) byEmp[v.employeeId] = [];
        byEmp[v.employeeId].push(v);
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayPct = today >= yearStart && today <= yearEnd ? ((today - yearStart) / 86400000 / totalDays) * 100 : null;

    rowsEl.innerHTML = '';
    Object.keys(byEmp).forEach((empId, empIdx) => {
        const emp = getEmployee(empId);
        const name = emp ? emp.name : `ID ${empId}`;
        const dept = emp ? emp.dept || '' : '';
        const row = document.createElement('div');
        row.className = 'gantt-row';
        const barsDiv = document.createElement('div');
        barsDiv.className = 'gantt-row-bars';
        if (todayPct !== null) {
            const todayLine = document.createElement('div');
            todayLine.className = 'gantt-today-line' + (empIdx === 0 ? ' gantt-today-line--labeled' : '');
            todayLine.style.left = todayPct + '%';
            barsDiv.appendChild(todayLine);
        }
        byEmp[empId].forEach((v) => {
            const vStart = new Date(v.startDate + 'T00:00:00');
            const vEnd = new Date(v.endDate + 'T00:00:00');
            const clampedStart = vStart < yearStart ? yearStart : vStart;
            const clampedEnd = vEnd > yearEnd ? yearEnd : vEnd;
            const leftPct = ((clampedStart - yearStart) / 86400000 / totalDays) * 100;
            const widthPct = (((clampedEnd - clampedStart) / 86400000 + 1) / totalDays) * 100;
            const isActive = v.status === 'aprovado' && vStart <= today && vEnd >= today;
            const statusClass = isActive ? 'gantt-bar--active' : v.status === 'aprovado' ? 'gantt-bar--approved' : 'gantt-bar--concluded';
            const bar = document.createElement('div');
            bar.className = `gantt-bar ${statusClass}`;
            bar.style.left = leftPct + '%';
            bar.style.width = Math.max(widthPct, 0.3) + '%';
            bar.dataset.name = name;
            bar.dataset.dept = dept;
            bar.dataset.start = v.startDate;
            bar.dataset.end = v.endDate;
            bar.dataset.days = v.days || '—';
            bar.dataset.status = isActive ? 'Em gozo agora' : v.status === 'aprovado' ? 'Aprovado' : 'Concluído';
            bar.addEventListener('mouseenter', showGanttTooltip);
            bar.addEventListener('mousemove', positionGanttTooltip);
            bar.addEventListener('mouseleave', hideGanttTooltip);
            barsDiv.appendChild(bar);
        });
        const gAvatar = emp?.avatarUrl
            ? `<div class="g-avatar" style="background-image:url('${emp.avatarUrl}')"></div>`
            : `<div class="g-avatar" style="background:${emp?.avatarColor || nameToColor(name)}">${initials(name)}</div>`;
        row.innerHTML = `<div class="gantt-row-label">${gAvatar}<div><div class="g-name">${escHtml(name)}</div>${dept ? `<div class="g-dept"><span class="g-dept-dot" style="background:${deptColor(dept)}"></span><span class="g-dept-name">${escHtml(dept)}</span></div>` : ''}</div></div>`;
        row.appendChild(barsDiv);
        rowsEl.appendChild(row);
    });
}

function showGanttTooltip(e) {
    const tip = document.getElementById('gantt-tooltip');
    if (!tip) return;
    const bar = e.currentTarget;
    const { name, dept, start, end, days, status } = bar.dataset;
    tip.innerHTML = `
        <div class="gantt-tooltip-name">${escHtml(name)}</div>
        ${dept ? `<div class="gantt-tooltip-dept">${escHtml(dept)}</div>` : ''}
        <div class="gantt-tooltip-row"><i class="fas fa-calendar-day"></i>${formatDate(start)} → ${formatDate(end)}</div>
        <div class="gantt-tooltip-row"><i class="fas fa-umbrella-beach"></i>${escHtml(String(days))} dias · ${escHtml(status)}</div>`;
    tip.classList.add('show');
    positionGanttTooltip(e);
}
function positionGanttTooltip(e) {
    const tip = document.getElementById('gantt-tooltip');
    if (!tip || !tip.classList.contains('show')) return;
    const pad = 14;
    let left = e.clientX + pad;
    let top = e.clientY + pad;
    const rect = tip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - 8) left = e.clientX - rect.width - pad;
    if (top + rect.height > window.innerHeight - 8) top = e.clientY - rect.height - pad;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}
function hideGanttTooltip() {
    document.getElementById('gantt-tooltip')?.classList.remove('show');
}

function setupCalendarYearNav() {
    document.getElementById('year-prev')?.addEventListener('click', () => {
        calendarYear--;
        renderGantt();
        renderCobertura();
    });
    document.getElementById('year-next')?.addEventListener('click', () => {
        calendarYear++;
        renderGantt();
        renderCobertura();
    });
}

function renderCobertura() {
    const wrap = document.getElementById('cobertura-wrap');
    if (!wrap) return;
    const year = calendarYear;
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    const deptHeadcount = {};
    employees.forEach((e) => {
        if (e.status !== 'Inativo' && e.dept) deptHeadcount[e.dept] = (deptHeadcount[e.dept] || 0) + 1;
    });

    const deptEvents = {};
    vacations.forEach((v) => {
        if (v.status !== 'aprovado' && v.status !== 'concluido') return;
        const emp = getEmployee(v.employeeId);
        if (!emp?.dept) return;
        const start = new Date(v.startDate + 'T00:00:00');
        const end = new Date(v.endDate + 'T00:00:00');
        if (end < yearStart || start > yearEnd) return;
        const s = start < yearStart ? yearStart : start;
        const e = end > yearEnd ? yearEnd : end;
        if (!deptEvents[emp.dept]) deptEvents[emp.dept] = [];
        const dayAfter = new Date(e);
        dayAfter.setDate(dayAfter.getDate() + 1);
        deptEvents[emp.dept].push({ date: s, delta: 1 }, { date: dayAfter, delta: -1 });
    });

    const results = Object.keys(deptHeadcount)
        .map((dept) => {
            const headcount = deptHeadcount[dept];
            const events = (deptEvents[dept] || []).sort((a, b) => a.date - b.date || a.delta - b.delta);
            let running = 0,
                max = 0;
            events.forEach((ev) => {
                running += ev.delta;
                if (running > max) max = running;
            });
            const threshold = Math.max(1, Math.ceil(headcount * 0.3));
            return { dept, headcount, max, risk: max > threshold };
        })
        .sort((a, b) => b.max / b.headcount - a.max / a.headcount);

    if (results.length === 0) {
        wrap.innerHTML = '<p class="cobertura-empty">Nenhum departamento cadastrado.</p>';
        return;
    }

    wrap.innerHTML = results
        .map(
            (r) => `
        <div class="cobertura-item${r.risk ? ' cobertura-item--risk' : ''}">
            <div class="cobertura-item-top">
                <span class="cobertura-dept"><span class="cobertura-dept-dot" style="background:${deptColor(r.dept)}"></span>${escHtml(r.dept)}</span>
                <span class="cobertura-count">${r.max}/${r.headcount}</span>
            </div>
            <span class="cobertura-bar-wrap"><span class="cobertura-bar" style="width:${Math.min(100, (r.max / r.headcount) * 100)}%"></span></span>
            ${r.risk ? '<span class="cobertura-risk-badge"><i class="fas fa-triangle-exclamation"></i>Risco de cobertura</span>' : ''}
        </div>`
        )
        .join('');
}

function setupRealtimeSync() {
    sb.channel('vacations-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vacations' }, async () => {
            const { data } = await sb.from('vacations').select('*').order('created_at', { ascending: false });
            vacations = (data || []).map(dbToVacation);
            await autoExpireVacations();
            loadKPIs();
            renderTable();
            if (document.getElementById('tab-calendar')?.classList.contains('active')) {
                renderGantt();
                renderCobertura();
            }
        })
        .subscribe();
}

function openModal(id) {
    document.getElementById(id).classList.add('open');
    document.body.style.overflow = 'hidden';
}
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    document.body.style.overflow = '';
}
window.handleOverlayClick = function (e, id) {
    if (e.target === document.getElementById(id)) closeModal(id);
};
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

function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const topbar = document.getElementById('topbar-menu-btn');
    const overlay = document.getElementById('sidebar-overlay');
    const wrapper = document.querySelector('.main-wrapper');
    const isMobile = () => window.innerWidth <= 768;
    const open = () => {
        sidebar?.classList.add('open');
        overlay?.classList.add('active');
        document.body.style.overflow = 'hidden';
    };
    const close = () => {
        sidebar?.classList.remove('open');
        overlay?.classList.remove('active');
        document.body.style.overflow = '';
    };
    toggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        isMobile()
            ? sidebar?.classList.contains('open')
                ? close()
                : open()
            : (() => {
                  const c = sidebar?.classList.toggle('collapsed');
                  wrapper?.classList.toggle('sidebar-collapsed', c);
              })();
    });
    topbar?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar?.classList.contains('open') ? close() : open();
    });
    overlay?.addEventListener('click', close);
    window.addEventListener('resize', () => {
        if (!isMobile()) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isMobile()) close();
    });
}

function showToast(msg, type = 'success') {
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${escHtml(msg)}</p>
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
}

function formatDate(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
}
function escHtml(str) {
    if (typeof str !== 'string') return str ?? '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function setTodayDate() {
    const el = document.getElementById('today-date');
    if (!el) return;
    el.textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

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
    setupFilterDropdown();
    setupExportDropdown();
    setupDatePicker('coletiva-start');
    setupDatePicker('coletiva-end');
    setupDatePicker('add-start');
    setupDatePicker('add-end');
    setupCalendarYearNav();
    setupRealtimeSync();

    const deepLinkReqId = new URLSearchParams(location.search).get('req');
    if (deepLinkReqId) {
        document.querySelector('.tab-btn[data-tab="requests"]')?.click();
        const row = document.querySelector(`#requests-tbody tr[data-id="${deepLinkReqId}"]`);
        if (row) {
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });
            row.classList.add('row-deep-link-highlight');
            setTimeout(() => row.classList.remove('row-deep-link-highlight'), 2600);
        }
    }
});
