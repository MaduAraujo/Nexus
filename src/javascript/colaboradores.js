let employees = [];
let currentEmployeeId = null;
let currentStep = 1;
const totalSteps = 6;
let lastRenderedEmployees = [];
let currentPage = 1;
const PAGE_SIZE = 5;
let currentDeptFilter = '';
const selectedIds = new Set();

function dbToEmployee(row) {
    return {
        id: row.id,
        name: row.name,
        role: row.role,
        cpf: row.cpf,
        rg: row.rg,
        telefone: row.telefone,
        email: row.email,
        admissionDate: row.admission_date,
        contractType: row.contract_type,
        salaryType: row.salary_type,
        workLoad: row.work_load,
        dept: row.dept,
        managerId: row.manager_id,
        birthDate: row.birth_date,
        gender: row.gender,
        salary: row.salary,
        status: row.status,
        terminationDate: row.termination_date,
        seguroVida: row.seguro_vida ? 'sim' : 'nao',
        seguradora: row.seguradora,
        possuiDependentes: row.possui_dependentes ? 'sim' : 'nao',
        qtdDependentes: row.qtd_dependentes,
        pcd: row.pcd ? 'sim' : 'nao',
        deficiencia: row.deficiencia,
        racaCor: row.raca_cor === 'Branca' ? 'Branco' : row.raca_cor,
        isProbation: row.is_probation ? 'sim' : 'nao',
        probationEndDate: row.probation_end_date,
        isAvisoPrevio: row.is_aviso_previo ? 'sim' : 'nao',
        avisoPrevioEndDate: row.aviso_previo_end_date,
        pensaoAlimenticia: row.pensao_alimenticia ? 'sim' : 'nao',
        tipoPensao: row.tipo_pensao,
        valeTransporte: row.vale_transporte ? 'sim' : 'nao',
        valorPassagem: row.valor_passagem,
        conducoesdia: row.conducoes_dia,
        valeRefeicao: row.vale_refeicao,
        valeAlimentacao: row.vale_alimentacao,
        formaPagamento: row.forma_pagamento,
        tipoChavePix: row.tipo_chave_pix,
        chavePix: row.chave_pix,
        banco: row.banco,
        tipoConta: row.tipo_conta,
        agencia: row.agencia,
        conta: row.conta,
        avatarColor: row.avatar_color,
        avatarUrl: row.avatar_url,
        lastAccess: row.last_access,
        authUserId: row.auth_user_id,
    };
}

function employeeToDb(emp) {
    const parseVal = (v) =>
        v
            ? parseFloat(
                  String(v)
                      .replace(/[R$\s.]/g, '')
                      .replace(',', '.')
              ) || null
            : null;
    return {
        name: emp.name,
        role: emp.role || null,
        cpf: emp.cpf,
        rg: emp.rg || null,
        telefone: emp.telefone || null,
        email: emp.email,
        admission_date: emp.admissionDate || null,
        contract_type: emp.contractType || null,
        salary_type: emp.salaryType || null,
        work_load: emp.workLoad || null,
        dept: emp.dept || null,
        manager_id: emp.managerId || null,
        salary: emp.salary || null,
        status: emp.status || 'Ativo',
        termination_date: emp.terminationDate || null,
        seguro_vida: emp.seguroVida === 'sim',
        seguradora: emp.seguroVida === 'sim' ? emp.seguradora || null : null,
        possui_dependentes: emp.possuiDependentes === 'sim',
        qtd_dependentes: emp.possuiDependentes === 'sim' ? parseInt(emp.qtdDependentes) || null : null,
        pcd: emp.pcd === 'sim',
        deficiencia: emp.pcd === 'sim' ? emp.deficiencia || null : null,
        raca_cor: emp.racaCor || null,
        gender: emp.gender || null,
        is_probation: emp.isProbation === 'sim',
        probation_end_date: emp.isProbation === 'sim' ? emp.probationEndDate || null : null,
        is_aviso_previo: emp.isAvisoPrevio === 'sim',
        aviso_previo_end_date: emp.isAvisoPrevio === 'sim' ? emp.avisoPrevioEndDate || null : null,
        pensao_alimenticia: emp.pensaoAlimenticia === 'sim',
        tipo_pensao: emp.pensaoAlimenticia === 'sim' ? emp.tipoPensao || null : null,
        vale_transporte: emp.valeTransporte === 'sim',
        valor_passagem: emp.valeTransporte === 'sim' ? parseVal(emp.valorPassagem) : null,
        conducoes_dia: emp.valeTransporte === 'sim' ? parseInt(emp.conducoesdia) || null : null,
        vale_refeicao: parseVal(emp.valeRefeicao) || null,
        vale_alimentacao: parseVal(emp.valeAlimentacao) || null,
        forma_pagamento: emp.formaPagamento || null,
        tipo_chave_pix: emp.formaPagamento === 'pix' ? emp.tipoChavePix || null : null,
        chave_pix: emp.formaPagamento === 'pix' ? emp.chavePix || null : null,
        banco: emp.formaPagamento === 'conta' ? emp.banco || null : null,
        tipo_conta: emp.formaPagamento === 'conta' ? emp.tipoConta || null : null,
        agencia: emp.formaPagamento === 'conta' ? emp.agencia || null : null,
        conta: emp.formaPagamento === 'conta' ? emp.conta || null : null,
        avatar_color: emp.avatarColor || getRandomAvatarColor(),
    };
}

async function fetchEmployees() {
    const { data, error } = await sb.from('employees_decrypted').select('*').order('created_at', { ascending: false });
    if (error) {
        console.error('[Nexus] fetchEmployees:', error);
        return;
    }
    employees = (data || []).map(dbToEmployee);
}

async function insertEmployee(dbData) {
    const { data: created, error } = await sb.from('employees').insert(dbData).select('id').single();
    if (error) throw error;
    const { data: row, error: readError } = await sb.from('employees_decrypted').select('*').eq('id', created.id).single();
    if (readError) throw readError;
    return row;
}

async function inviteEmployee(email) {
    const {
        data: { session },
    } = await sb.auth.getSession();
    if (!session) throw new Error('Sessão expirada. Faça login novamente.');

    const loginUrl = 'https://nexus-nine-zeta.vercel.app/src/screens/login.html';

    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-employee`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email, redirectTo: loginUrl }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao enviar convite');
    }
    return res.json();
}

async function logEmployeeEdit(empId, empName, changes) {
    if (!changes.length) return;
    const user = await NexusAuth.getUser();
    await sb.from('employee_audit').insert({
        employee_id: empId,
        changes,
        operator_name: user?.email?.split('@')[0] || 'RH',
        operator_email: user?.email || '',
    });
}

async function fetchEmployeeAudit(employeeId) {
    const { data, error } = await sb
        .from('employee_audit_decrypted')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) {
        console.error('[Nexus] fetchEmployeeAudit:', error);
        return [];
    }
    return data || [];
}

function setupRealtimeSync() {
    sb.channel('employees-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, async () => {
            await fetchEmployees();
            const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
            applyStatusFilter(activeFilter);
            renderAlertsBanner();
            renderStatsRow();
        })
        .subscribe();
}

async function loadRhSidebar() {
    const auth = await NexusAuth.requireProfile('Administrador');
    if (!auth) return;

    const nameEl = document.getElementById('rh-sidebar-name');
    const roleEl = document.getElementById('rh-sidebar-role');
    const avatarEl = document.getElementById('rh-sidebar-avatar');
    if (!nameEl) return;

    nameEl.textContent = 'Administrador';
    if (roleEl) roleEl.textContent = 'Recursos Humanos';
    if (avatarEl) avatarEl.textContent = 'ADM';
}

function getInitials(name) {
    return (name || '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('');
}

function avatarHtml(emp, sizeClass) {
    if (emp.avatarUrl) {
        return `<img class="${sizeClass}-img" src="${escapeHtml(emp.avatarUrl)}" alt="${escHtml(emp.name)}">`;
    }
    return `<div class="${sizeClass}" data-bg="${escHtml(emp.avatarColor || '#6366f1')}">${getInitials(emp.name)}</div>`;
}

function getRandomAvatarColor() {
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#06b6d4', '#84cc16', '#f97316'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function isValidCPF(cpf) {
    const cleaned = cpf.replace(/\D/g, '');
    if (cleaned.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cleaned)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(cleaned.charAt(i)) * (10 - i);
    let rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(cleaned.charAt(9))) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(cleaned.charAt(i)) * (11 - i);
    rev = 11 - (sum % 11);
    if (rev === 10 || rev === 11) rev = 0;
    if (rev !== parseInt(cleaned.charAt(10))) return false;
    return true;
}

function showToast(title, msg, type = 'success') {
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${escapeHtml(title)}</p>
            ${msg ? `<p class="toast-msg">${escapeHtml(msg)}</p>` : ''}
        </div>
        <button class="toast-close" data-click="dismissToast">
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

const formatDateBR = (dateStr) => {
    if (!dateStr) return '-';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
};

const formatCurrency = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const getBadgeClass = (status) => ({ Ativo: 'badge--ativo', Inativo: 'badge--inativo', Férias: 'badge--ferias', Afastado: 'badge--afastado' })[status] || '';

function getProbationStatus(emp) {
    if (emp.isProbation !== 'sim' || !emp.probationEndDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(emp.probationEndDate + 'T00:00:00');
    const diffDays = Math.round((end - today) / 86400000);
    let cls = null;
    if (diffDays < 0) cls = 'badge--probation-expired';
    else if (diffDays <= 15) cls = 'badge--probation-warning';
    const label =
        diffDays < 0 ? `Experiência vencida há ${Math.abs(diffDays)}d` : diffDays === 0 ? 'Experiência vence hoje' : `Experiência vence em ${diffDays}d`;
    return { diffDays, cls, label };
}

function getAvisoPrevioStatus(emp) {
    if (emp.isAvisoPrevio !== 'sim' || !emp.avisoPrevioEndDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(emp.avisoPrevioEndDate + 'T00:00:00');
    const diffDays = Math.round((end - today) / 86400000);
    let cls = null;
    if (diffDays < 0) cls = 'badge--aviso-previo-expired';
    else if (diffDays <= 15) cls = 'badge--aviso-previo-warning';
    const label =
        diffDays < 0 ? `Aviso prévio venceu há ${Math.abs(diffDays)}d` : diffDays === 0 ? 'Aviso prévio termina hoje' : `Aviso prévio termina em ${diffDays}d`;
    return { diffDays, cls, label };
}

let expiringDocuments = [];

async function fetchExpiringDocuments() {
    const { data, error } = await sb.from('documents').select('id,employee_id,name,tipo,data_validade').not('data_validade', 'is', null);
    if (error) {
        console.error('[Nexus] fetchExpiringDocuments:', error);
        expiringDocuments = [];
        return;
    }
    expiringDocuments = data || [];
}

function getDocAlertInfo(dataValidade) {
    if (!dataValidade) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(dataValidade + 'T00:00:00');
    const diffDays = Math.round((end - today) / 86400000);
    if (diffDays < 0) return { diffDays, expired: true };
    if (diffDays <= 30) return { diffDays, expired: false };
    return null;
}

function computeEmployeeAlerts(emp) {
    const alerts = [];
    const probation = getProbationStatus(emp);
    if (probation && probation.cls) alerts.push({ type: 'experiencia', label: probation.label });

    const avisoPrevio = getAvisoPrevioStatus(emp);
    if (avisoPrevio && avisoPrevio.cls) alerts.push({ type: 'aviso_previo', label: avisoPrevio.label });

    if (emp.birthDate && emp.status === 'Ativo') {
        const birth = new Date(emp.birthDate + 'T00:00:00');
        if (birth.getMonth() === new Date().getMonth()) {
            alerts.push({
                type: 'aniversario',
                label: `Aniversário em ${String(birth.getDate()).padStart(2, '0')}/${String(birth.getMonth() + 1).padStart(2, '0')}`,
            });
        }
    }

    const hasDocAlert = expiringDocuments.some((d) => d.employee_id === emp.id && getDocAlertInfo(d.data_validade));
    if (hasDocAlert) alerts.push({ type: 'documento', label: 'Documento vencendo/vencido' });

    return alerts;
}

function renderStatsRow() {
    const total = employees.length;
    const ativos = employees.filter((e) => e.status === 'Ativo').length;
    const ferias = employees.filter((e) => e.status === 'Férias').length;
    const afastados = employees.filter((e) => e.status === 'Afastado').length;
    const inativos = employees.filter((e) => e.status === 'Inativo').length;
    const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    set('kpi-total', total);
    set('kpi-ativos', ativos);
    set('kpi-ferias', ferias);
    set('kpi-afastados', afastados);
    set('kpi-inativos', inativos);
}

function renderAlertsBanner() {
    const banner = document.getElementById('alerts-banner');
    if (!banner) return;

    let countExperiencia = 0,
        countAniversario = 0,
        countDocumento = 0;
    employees.forEach((emp) => {
        computeEmployeeAlerts(emp).forEach((a) => {
            if (a.type === 'experiencia') countExperiencia++;
            else if (a.type === 'aniversario') countAniversario++;
            else if (a.type === 'documento') countDocumento++;
        });
    });

    document.getElementById('alert-count-experiencia').textContent = countExperiencia;
    document.getElementById('alert-count-aniversario').textContent = countAniversario;
    document.getElementById('alert-count-documento').textContent = countDocumento;

    banner.classList.toggle('hidden', countExperiencia === 0 && countAniversario === 0 && countDocumento === 0);
}

window.filterByAlert = function (type) {
    const filtered = employees.filter((emp) => computeEmployeeAlerts(emp).some((a) => a.type === type));
    document.querySelectorAll('.btn-filter').forEach((b) => b.classList.remove('active'));
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    document.getElementById('search-clear')?.classList.add('hidden');
    currentPage = 1;
    renderTable(filtered, 'todos');
};

function setupDocumentsAlertSync() {
    sb.channel('documents-alerts-colaboradores')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, async () => {
            await fetchExpiringDocuments();
            renderAlertsBanner();
        })
        .subscribe();
}

let searchToastTimeout = null;

window.filterTable = function () {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    const query = input.value.toLowerCase().trim();
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    if (clearBtn) clearBtn.classList.toggle('hidden', query.length === 0);
    currentPage = 1;
    let filtered = getFilteredByStatus(activeFilter);
    if (query) {
        filtered = filtered.filter((e) => e.name?.toLowerCase().includes(query) || e.dept?.toLowerCase().includes(query) || e.cpf?.includes(query));
        clearTimeout(searchToastTimeout);
        if (filtered.length === 0) {
            searchToastTimeout = setTimeout(() => {
                showToast('Colaborador Não Encontrado!', `Nenhum resultado para "${query}".`, 'warning');
            }, 600);
        }
    } else {
        clearTimeout(searchToastTimeout);
    }
    renderTable(filtered, activeFilter);
};

window.clearSearch = function () {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    if (input) input.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    clearTimeout(searchToastTimeout);
    filterTable();
};

function getFilteredByStatus(filter) {
    let filtered = employees;
    if (filter === 'ativos') filtered = filtered.filter((e) => e.status === 'Ativo');
    else if (filter === 'inativos') filtered = filtered.filter((e) => e.status === 'Inativo');
    else if (filter === 'ferias') filtered = filtered.filter((e) => e.status === 'Férias');
    else if (filter === 'afastados') filtered = filtered.filter((e) => e.status === 'Afastado');

    if (currentDeptFilter) filtered = filtered.filter((e) => e.dept === currentDeptFilter);

    return filtered;
}

function populateDeptFilterOptions() {
    const container = document.getElementById('dept-filter-list');
    if (!container) return;

    const depts = [...new Set(employees.map((e) => e.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!depts.includes(currentDeptFilter)) currentDeptFilter = '';

    const btnHtml = (value, label) =>
        `<button type="button" class="btn-filter btn-filter-dept${currentDeptFilter === value ? ' active' : ''}" data-dept="${escHtml(value)}">${escHtml(label)}</button>`;

    container.innerHTML = btnHtml('', 'Todos') + depts.map((d) => btnHtml(d, d)).join('');

    container.querySelectorAll('.btn-filter-dept').forEach((btn) => {
        btn.addEventListener('click', () => {
            currentDeptFilter = btn.getAttribute('data-dept') || '';
            container.querySelectorAll('.btn-filter-dept').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            filterTable();
            closeFilterMenu();
        });
    });
}

window.toggleFilterMenu = function (event) {
    event.stopPropagation();
    const btn = document.getElementById('btn-filter-trigger');
    const menu = document.getElementById('filter-menu');
    if (!btn || !menu) return;
    const opening = !menu.classList.contains('open');
    if (opening) closeExportMenu();
    menu.classList.toggle('open', opening);
    btn.classList.toggle('open', opening);
};

function closeFilterMenu() {
    document.getElementById('filter-menu')?.classList.remove('open');
    document.getElementById('btn-filter-trigger')?.classList.remove('open');
}

function setupFilters() {
    document.getElementById('filter-menu')?.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closeFilterMenu);
    document.querySelectorAll('.btn-filter').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-filter').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            clearSearch();
            applyStatusFilter(btn.getAttribute('data-filter'));
            closeFilterMenu();
        });
    });
}

function applyStatusFilter(filter) {
    populateDeptFilterOptions();
    renderTable(getFilteredByStatus(filter), filter);
}

const EMPTY_STATES = {
    todos: { icon: 'fa-users-slash', title: 'Nenhum colaborador cadastrado', sub: 'Clique em "Novo Colaborador" para começar' },
    ativos: { icon: 'fa-user-check', title: 'Nenhum colaborador ativo', sub: '' },
    inativos: { icon: 'fa-user-times', title: 'Nenhum colaborador inativo', sub: '' },
    ferias: { icon: 'fa-umbrella-beach', title: 'Nenhum colaborador de férias', sub: '' },
    afastados: { icon: 'fa-user-clock', title: 'Nenhum colaborador afastado', sub: '' },
};

function renderTable(data, filter) {
    const tbody = document.getElementById('employee-list-body');
    if (!tbody) return;
    lastRenderedEmployees = data;
    tbody.innerHTML = '';
    if (data.length === 0) {
        const activeFilter = filter || document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
        const es = EMPTY_STATES[activeFilter] || EMPTY_STATES.todos;
        tbody.innerHTML = `
            <tr class="empty-row" id="empty-row">
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fas ${es.icon}"></i>
                        <p>${escapeHtml(es.title)}</p>
                        ${es.sub ? `<span>${es.sub}</span>` : ''}
                    </div>
                </td>
            </tr>`;
        renderPagination(0);
        updateSelectAllCheckboxState([]);
        renderBulkActionsBar();
        return;
    }

    const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = data.slice(start, start + PAGE_SIZE);

    pageData.forEach((emp, index) => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = () => window.openDrawer(emp.id);
        const empAlerts = computeEmployeeAlerts(emp);
        const bellHtml = empAlerts.length ? `<i class="fas fa-bell bell-alert-icon" title="${empAlerts.map((a) => a.label).join(' · ')}"></i>` : '';
        tr.innerHTML = `
            <td class="td-checkbox" data-click="noop" data-click-stop>
                <input type="checkbox" class="row-checkbox" ${selectedIds.has(emp.id) ? 'checked' : ''} data-change="toggleRowSelection" data-change-args="${dargs(emp.id, { $: 'this.checked' })}">
            </td>
            <td>#${start + index + 1}</td>
            <td class="employee-name-cell">
                ${avatarHtml(emp, 'table-avatar')}
                <strong>${escapeHtml(emp.name)}</strong> ${bellHtml}
            </td>
            <td><span class="badge ${getBadgeClass(emp.status)}">${emp.status}</span></td>
            <td>${escapeHtml(emp.dept) || '-'}</td>
            <td>${escapeHtml(emp.role) || '-'}</td>
            <td>${formatDateBR(emp.admissionDate)}</td>`;
        tbody.appendChild(tr);
    });

    renderPagination(data.length);
    updateSelectAllCheckboxState(pageData);
    renderBulkActionsBar();
}

function getCurrentPageData() {
    const start = (currentPage - 1) * PAGE_SIZE;
    return lastRenderedEmployees.slice(start, start + PAGE_SIZE);
}

function updateSelectAllCheckboxState(pageData) {
    const headerCb = document.getElementById('select-all-checkbox');
    if (!headerCb) return;
    if (!pageData.length) {
        headerCb.checked = false;
        headerCb.indeterminate = false;
        return;
    }
    const selectedCount = pageData.filter((e) => selectedIds.has(e.id)).length;
    headerCb.checked = selectedCount === pageData.length;
    headerCb.indeterminate = selectedCount > 0 && selectedCount < pageData.length;
}

function renderBulkActionsBar() {
    const bar = document.getElementById('bulk-actions-bar');
    if (!bar) return;
    bar.classList.toggle('hidden', selectedIds.size === 0);
    const countEl = document.getElementById('bulk-selected-count');
    if (countEl) countEl.textContent = selectedIds.size;
}

window.toggleRowSelection = function (id, checked) {
    if (checked) selectedIds.add(id);
    else selectedIds.delete(id);
    updateSelectAllCheckboxState(getCurrentPageData());
    renderBulkActionsBar();
};

window.toggleSelectAll = function (checkbox) {
    getCurrentPageData().forEach((e) => {
        if (checkbox.checked) selectedIds.add(e.id);
        else selectedIds.delete(e.id);
    });
    renderTable(lastRenderedEmployees);
};

window.clearSelection = function () {
    selectedIds.clear();
    renderTable(lastRenderedEmployees);
};

window.bulkUpdateStatus = async function (newStatus) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const targets = employees.filter((e) => ids.includes(e.id) && e.status !== newStatus);
    if (!targets.length) {
        showToast('Nada a Fazer', 'Os colaboradores selecionados já estão com este status.', 'warning');
        return;
    }
    if (!confirm(`Alterar o status de ${targets.length} colaborador(es) para "${newStatus}"?`)) return;

    const targetIds = targets.map((e) => e.id);
    const { error } = await sb.from('employees').update({ status: newStatus }).in('id', targetIds);
    if (error) {
        showToast('Erro!', 'Não foi possível atualizar o status em lote.', 'error');
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    if (newStatus === 'Inativo') {
        const noTerminationIds = targets.filter((e) => !e.terminationDate).map((e) => e.id);
        if (noTerminationIds.length) {
            await sb.from('employees').update({ termination_date: today }).in('id', noTerminationIds);
        }
        await sb
            .from('vacations')
            .update({ status: 'recusado', rejection_reason: 'Colaborador inativado pelo RH.', rejected_at: new Date().toISOString() })
            .in('employee_id', targetIds)
            .eq('status', 'pendente');
    }

    const user = await NexusAuth.getUser();
    const auditRows = targets.map((e) => ({
        employee_id: e.id,
        changes: [{ field: 'status', label: 'Status', oldValue: e.status, newValue: newStatus }],
        operator_name: user?.email?.split('@')[0] || 'RH',
        operator_email: user?.email || '',
    }));
    await sb.from('employee_audit').insert(auditRows);

    targets.forEach((e) => {
        const idx = employees.findIndex((x) => x.id === e.id);
        if (idx === -1) return;
        employees[idx].status = newStatus;
        if (newStatus === 'Inativo' && !employees[idx].terminationDate) employees[idx].terminationDate = today;
    });

    selectedIds.clear();
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    applyStatusFilter(activeFilter);
    renderStatsRow();
    renderAlertsBanner();
    showToast('Status Atualizado!', `${targets.length} colaborador(es) atualizado(s) para "${newStatus}".`, 'success');
};

window.bulkDeleteEmployees = async function () {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!confirm(`Tem certeza que deseja excluir ${ids.length} colaborador(es)?\n\nO acesso ao sistema também será removido.`)) return;

    const { error } = await sb.from('employees').delete().in('id', ids);
    if (error) {
        showToast('Erro!', 'Não foi possível excluir os colaboradores selecionados.', 'error');
        return;
    }

    employees = employees.filter((e) => !ids.includes(e.id));
    selectedIds.clear();
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    applyStatusFilter(activeFilter);
    renderStatsRow();
    showToast('Colaboradores Excluídos!', `${ids.length} colaborador(es) removido(s) do sistema.`, 'error');
};

window.goToPage = function (page) {
    currentPage = page;
    renderTable(lastRenderedEmployees);
};

function renderPagination(totalItems) {
    const container = document.getElementById('table-pagination');
    if (!container) return;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="pagination-controls">
            <button type="button" class="pagination-btn" data-click="goToPage" data-click-args="${dargs(currentPage - 1)}" ${currentPage === 1 ? 'disabled' : ''} aria-label="Página anterior">
                <i class="fas fa-chevron-left"></i>
            </button>
            <button type="button" class="pagination-btn" data-click="goToPage" data-click-args="${dargs(currentPage + 1)}" ${currentPage === totalPages ? 'disabled' : ''} aria-label="Próxima página">
                <i class="fas fa-chevron-right"></i>
            </button>
        </div>`;
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function buildExportRows() {
    return lastRenderedEmployees.map((emp) => ({
        nome: emp.name,
        cpf: emp.cpf || '',
        email: emp.email || '',
        cargo: emp.role || '',
        dept: emp.dept || '',
        status: emp.status || '',
        contrato: emp.contractType || '',
        admissao: formatDateBR(emp.admissionDate),
        salario: formatCurrency(emp.salary),
    }));
}

function closeExportMenu() {
    document.getElementById('export-menu')?.classList.remove('open');
    document.getElementById('btn-export')?.classList.remove('open');
}

function setupExportDropdown() {
    const btn = document.getElementById('btn-export');
    const menu = document.getElementById('export-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const opening = !menu.classList.contains('open');
        if (opening) closeFilterMenu();
        menu.classList.toggle('open', opening);
        btn.classList.toggle('open', opening);
    });
    document.addEventListener('click', closeExportMenu);
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('export-csv-btn')?.addEventListener('click', () => {
        closeExportMenu();
        exportEmployeesCSV();
    });
    document.getElementById('export-pdf-btn')?.addEventListener('click', () => {
        closeExportMenu();
        exportEmployeesPDF();
    });
}

function exportEmployeesCSV() {
    const rows = buildExportRows();
    if (rows.length === 0) {
        showToast('Nada para Exportar', 'Nenhum colaborador para exportar com o filtro atual.', 'warning');
        return;
    }
    if (typeof XLSX === 'undefined') {
        showToast('Erro!', 'Biblioteca Excel não carregada.', 'error');
        return;
    }
    const header = ['Nome', 'CPF', 'Email', 'Cargo', 'Departamento', 'Status', 'Tipo de Contrato', 'Admissão', 'Salário'];
    const body = rows.map((r) => [r.nome, r.cpf, r.email, r.cargo, r.dept, r.status, r.contrato, r.admissao, r.salario]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), 'Colaboradores');
    XLSX.writeFile(wb, `colaboradores_${new Date().toISOString().slice(0, 10)}.xlsx`);
    NexusAuth.logExport('colaboradores.xlsx', rows.length);
    showToast('Exportação Concluída!', 'O arquivo Excel foi baixado.', 'success');
}

function exportEmployeesPDF() {
    const rows = buildExportRows();
    if (rows.length === 0) {
        showToast('Nada para Exportar', 'Nenhum colaborador para exportar com o filtro atual.', 'warning');
        return;
    }
    const win = window.open('', '_blank');
    if (!win) {
        showToast('Erro!', 'Permita pop-ups para exportar o PDF.', 'error');
        return;
    }
    const hoje = new Date().toLocaleDateString('pt-BR');
    const tableRows = rows
        .map(
            (r) => `<tr>
        <td>${escHtml(r.nome)}</td><td>${escHtml(r.cpf)}</td><td>${escHtml(r.email)}</td>
        <td>${escHtml(r.cargo)}</td><td>${escHtml(r.dept)}</td><td>${escHtml(r.status)}</td>
        <td>${escHtml(r.contrato)}</td><td>${r.admissao}</td><td>${r.salario}</td>
    </tr>`
        )
        .join('');
    const cssHref = new URL('../styles/colaboradores-print.css', window.location.href).href;
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Colaboradores</title>
        <link rel="stylesheet" href="${cssHref}"></head><body>
        <h1>Nexus RH — Colaboradores</h1>
        <p class="sub">Exportado em ${hoje} · ${rows.length} colaborador${rows.length === 1 ? '' : 'es'}</p>
        <table>
            <thead><tr><th>Nome</th><th>CPF</th><th>Email</th><th>Cargo</th><th>Depto</th><th>Status</th><th>Contrato</th><th>Admissão</th><th>Salário</th></tr></thead>
            <tbody>${tableRows}</tbody>
        </table>
        </body></html>`);
    win.document.close();
    NexusAuth.logExport('colaboradores.pdf', rows.length);
    printWhenLoaded(win);
}

let importRows = [];

const IMPORT_COLUMN_ALIASES = {
    name: ['nome', 'nomecompleto'],
    cpf: ['cpf'],
    email: ['email'],
    admissionDate: ['datadeadmissao', 'dataadmissao', 'admissao'],
    contractType: ['tipodecontrato', 'contrato'],
    dept: ['departamento', 'depto', 'dept'],
    role: ['cargo', 'funcao'],
    workLoad: ['jornadadetrabalho', 'jornada', 'cargahoraria'],
    salary: ['salario', 'salariors'],
    salaryType: ['tipodesalario'],
};
const IMPORT_FIELD_LABELS = {
    name: 'Nome',
    cpf: 'CPF',
    email: 'Email',
    admissionDate: 'Data de Admissão',
    contractType: 'Tipo de Contrato',
    dept: 'Departamento',
    workLoad: 'Jornada de Trabalho',
    salary: 'Salário',
    salaryType: 'Tipo de Salário',
};
const IMPORT_REQUIRED_FIELDS = ['name', 'cpf', 'email', 'admissionDate', 'contractType', 'dept', 'workLoad', 'salary', 'salaryType'];

function normalizeHeader(h) {
    return String(h || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function mapImportHeaders(headerRow) {
    const map = {};
    (headerRow || []).forEach((h, idx) => {
        const norm = normalizeHeader(h);
        for (const [field, aliases] of Object.entries(IMPORT_COLUMN_ALIASES)) {
            if (aliases.includes(norm)) {
                map[idx] = field;
                break;
            }
        }
    });
    return map;
}

function parseImportDate(v) {
    if (!v) return null;
    v = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseImportSalary(v) {
    if (!v) return null;
    const cleaned = String(v).replace(/[R$\s]/g, '');
    const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
    const num = parseFloat(normalized);
    return isNaN(num) ? null : num;
}

async function readImportFile(file) {
    const isCsv = /\.csv$/i.test(file.name);
    const workbook = isCsv ? XLSX.read(await file.text(), { type: 'string' }) : XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
}

function buildImportRow(rawRow, headerMap, index) {
    const get = (field) => {
        const idx = Object.keys(headerMap).find((k) => headerMap[k] === field);
        return idx !== undefined ? String(rawRow[idx] ?? '').trim() : '';
    };

    const errors = [];
    const name = get('name');
    if (!name) errors.push('Nome é obrigatório.');

    const cpfRaw = get('cpf');
    if (!cpfRaw) errors.push('CPF é obrigatório.');
    else if (!isValidCPF(cpfRaw)) errors.push('CPF inválido.');
    else if (employees.some((e) => e.cpf.replace(/\D/g, '') === cpfRaw.replace(/\D/g, ''))) errors.push('CPF já cadastrado.');

    const email = get('email').toLowerCase();
    if (!email) errors.push('Email é obrigatório.');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email inválido.');
    else if (employees.some((e) => e.email.toLowerCase() === email)) errors.push('Email já cadastrado.');

    const admissionDate = parseImportDate(get('admissionDate'));
    if (!admissionDate) errors.push('Data de admissão inválida.');

    const contractType = get('contractType');
    if (!contractType) errors.push('Tipo de contrato é obrigatório.');

    const dept = get('dept');
    if (!dept) errors.push('Departamento é obrigatório.');

    const workLoad = get('workLoad');
    if (!workLoad) errors.push('Jornada de trabalho é obrigatória.');

    const salary = parseImportSalary(get('salary'));
    if (!salary || salary <= 0) errors.push('Salário inválido.');

    const salaryType = get('salaryType');
    if (!salaryType) errors.push('Tipo de salário é obrigatório.');

    const role = get('role');

    return {
        index,
        mapped: { name, cpf: cpfRaw, email, admissionDate, contractType, dept, role, workLoad, salary, salaryType },
        errors,
        status: errors.length ? 'error' : 'ok',
    };
}

function dedupeImportRows(rows) {
    const cpfSeen = new Set(),
        emailSeen = new Set();
    rows.forEach((r) => {
        const cpf = r.mapped.cpf.replace(/\D/g, '');
        const email = r.mapped.email;
        if (cpf) {
            if (cpfSeen.has(cpf)) {
                r.errors.push('CPF duplicado na planilha.');
                r.status = 'error';
            } else cpfSeen.add(cpf);
        }
        if (email) {
            if (emailSeen.has(email)) {
                r.errors.push('Email duplicado na planilha.');
                r.status = 'error';
            } else emailSeen.add(email);
        }
    });
    return rows;
}

async function processImportFile(file) {
    if (!file) return;
    try {
        const rows = await readImportFile(file);
        if (!rows.length) {
            showToast('Arquivo Vazio!', 'A planilha não contém dados.', 'warning');
            return;
        }

        const headerMap = mapImportHeaders(rows[0]);
        const foundFields = Object.values(headerMap);
        const missingFields = IMPORT_REQUIRED_FIELDS.filter((f) => !foundFields.includes(f));
        if (missingFields.length) {
            showToast(
                'Colunas Ausentes!',
                `Não encontramos: ${missingFields.map((f) => IMPORT_FIELD_LABELS[f]).join(', ')}. Baixe o modelo para conferir.`,
                'error'
            );
            return;
        }

        const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
        if (!dataRows.length) {
            showToast('Arquivo Vazio!', 'Nenhum colaborador encontrado na planilha.', 'warning');
            return;
        }

        importRows = dedupeImportRows(dataRows.map((r, i) => buildImportRow(r, headerMap, i)));
        renderImportPreview();
        document.getElementById('import-step-upload')?.classList.add('hidden');
        document.getElementById('import-step-preview')?.classList.remove('hidden');
        document.getElementById('btn-import-confirm')?.classList.toggle('hidden', !importRows.some((r) => r.status === 'ok'));
    } catch (err) {
        console.error('[Nexus] import parse:', err);
        showToast('Erro ao Ler Arquivo!', 'Verifique se o arquivo é uma planilha válida (.xlsx, .xls ou .csv).', 'error');
    }
}

function renderImportPreview() {
    const body = document.getElementById('import-preview-body');
    const summary = document.getElementById('import-summary');
    if (!body) return;

    const okCount = importRows.filter((r) => r.status === 'ok').length;
    const errorCount = importRows.length - okCount;
    if (summary) {
        summary.innerHTML =
            `<strong>${importRows.length}</strong> registro${importRows.length === 1 ? '' : 's'} encontrado${importRows.length === 1 ? '' : 's'}` +
            ` · <strong>${okCount}</strong> pronto${okCount === 1 ? '' : 's'} para importar` +
            (errorCount ? ` · <strong>${errorCount}</strong> com erro` : '');
    }

    body.innerHTML = importRows
        .map((r, i) => {
            const m = r.mapped;
            const statusBadge =
                r.status === 'ok'
                    ? `<span class="import-status-badge import-status-ok">OK</span>`
                    : `<span class="import-status-badge import-status-error" title="${escHtml(r.errors.join(' '))}">Erro</span>`;
            const detailErrors = r.errors.length
                ? `<div class="import-detail-errors"><strong>Erros</strong><span>${escHtml(r.errors.join(' · '))}</span></div>`
                : '';
            return `
            <tr class="import-row${r.status === 'error' ? ' import-row-error' : ''}" data-click="toggleImportRowDetail" data-click-args="${dargs(i)}">
                <td>${escHtml(m.name) || '—'}</td>
                <td>${escHtml(m.cpf) || '—'}</td>
                <td>${escHtml(m.email) || '—'}</td>
                <td>${escHtml(m.dept) || '—'} ${statusBadge}</td>
            </tr>
            <tr class="import-row-detail hidden" id="import-detail-${i}">
                <td colspan="4">
                    <div class="import-detail-grid">
                        <div><strong>Cargo</strong><span>${escHtml(m.role) || '—'}</span></div>
                        <div><strong>Admissão</strong><span>${m.admissionDate ? formatDateBR(m.admissionDate) : '—'}</span></div>
                        <div><strong>Contrato</strong><span>${escHtml(m.contractType) || '—'}</span></div>
                        <div><strong>Jornada</strong><span>${escHtml(m.workLoad) || '—'}</span></div>
                        <div><strong>Salário</strong><span>${m.salary ? formatCurrency(m.salary) : '—'}</span></div>
                        <div><strong>Tipo Salário</strong><span>${escHtml(m.salaryType) || '—'}</span></div>
                        ${detailErrors}
                    </div>
                </td>
            </tr>`;
        })
        .join('');
}

window.toggleImportRowDetail = function (i) {
    document.getElementById(`import-detail-${i}`)?.classList.toggle('hidden');
};

window.handleImportFileSelected = function (event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) processImportFile(file);
};

function setupImportDropzone() {
    const dropzone = document.getElementById('import-dropzone');
    if (!dropzone) return;
    ['dragenter', 'dragover'].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        })
    );
    ['dragleave', 'drop'].forEach((evt) =>
        dropzone.addEventListener(evt, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        })
    );
    dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) processImportFile(file);
    });
}

window.downloadImportTemplate = function () {
    if (typeof XLSX === 'undefined') {
        showToast('Erro!', 'Biblioteca Excel não carregada.', 'error');
        return;
    }
    const header = [
        'Nome',
        'CPF',
        'Email',
        'Data de Admissão',
        'Tipo de Contrato',
        'Departamento',
        'Cargo',
        'Jornada de Trabalho',
        'Salário',
        'Tipo de Salário',
    ];
    const example = [
        'Maria Souza',
        '123.456.789-00',
        'maria.souza@empresa.com',
        '2025-01-15',
        'CLT',
        'Financeiro',
        'Analista Financeiro',
        '40h',
        '3500',
        'Mensal Fixo',
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, example]), 'Colaboradores');
    XLSX.writeFile(wb, 'modelo_importacao_colaboradores.xlsx');
};

function resetImportModal() {
    importRows = [];
    const fileInput = document.getElementById('import-file-input');
    if (fileInput) fileInput.value = '';
    document.getElementById('import-step-upload')?.classList.remove('hidden');
    document.getElementById('import-step-preview')?.classList.add('hidden');
    document.getElementById('btn-import-confirm')?.classList.add('hidden');
    document.getElementById('import-progress')?.classList.add('hidden');
    const summary = document.getElementById('import-summary');
    if (summary) summary.innerHTML = '';
    const body = document.getElementById('import-preview-body');
    if (body) body.innerHTML = '';
}

window.openImportModal = function () {
    resetImportModal();
    document.getElementById('import-overlay')?.classList.add('open');
    document.body.style.overflow = 'hidden';
};

window.closeImportModal = function () {
    document.getElementById('import-overlay')?.classList.remove('open');
    document.body.style.overflow = '';
    resetImportModal();
};

window.confirmImport = async function () {
    const okRows = importRows.filter((r) => r.status === 'ok');
    if (!okRows.length) return;

    const confirmBtn = document.getElementById('btn-import-confirm');
    const progressEl = document.getElementById('import-progress');
    if (confirmBtn) confirmBtn.disabled = true;
    progressEl?.classList.remove('hidden');

    let successCount = 0,
        failCount = 0;
    for (let i = 0; i < okRows.length; i++) {
        const row = okRows[i];
        if (progressEl) progressEl.textContent = `Importando ${i + 1} de ${okRows.length}…`;
        try {
            const dbData = employeeToDb({ ...row.mapped, status: 'Ativo' });
            const inserted = await insertEmployee(dbData);
            employees.unshift(dbToEmployee(inserted));

            try {
                const invite = await inviteEmployee(row.mapped.email);
                if (invite?.id) {
                    await sb.from('profiles').insert({ id: invite.id, profile: 'colaborador', employee_id: inserted.id });
                    await sb.from('employees').update({ auth_user_id: invite.id }).eq('id', inserted.id);
                }
            } catch (inviteErr) {
                console.error('[Nexus] Convite não enviado (import):', inviteErr.message);
            }
            successCount++;
        } catch (err) {
            console.error('[Nexus] import row failed:', err);
            failCount++;
        }
    }

    if (confirmBtn) confirmBtn.disabled = false;
    progressEl?.classList.add('hidden');

    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    applyStatusFilter(activeFilter);
    renderStatsRow();
    closeImportModal();
    showToast(
        'Importação Concluída!',
        `${successCount} colaborador${successCount === 1 ? '' : 'es'} importado${successCount === 1 ? '' : 's'}${failCount ? `, ${failCount} com falha` : ''}.`,
        failCount ? 'warning' : 'success'
    );
};

window.openDrawer = function (id) {
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    currentEmployeeId = emp.id;
    NexusAuth.logAccess(emp.id, 'perfil_completo', emp.name);

    const avatarEl = document.getElementById('drawer-avatar');
    const avatarImgEl = document.getElementById('drawer-avatar-img');
    if (avatarEl) {
        avatarEl.textContent = getInitials(emp.name);
        avatarEl.style.background = emp.avatarColor || '#6366f1';
    }
    if (avatarImgEl) {
        if (emp.avatarUrl) {
            avatarImgEl.src = emp.avatarUrl;
            avatarImgEl.classList.remove('hidden');
            avatarEl?.classList.add('hidden');
        } else {
            avatarImgEl.classList.add('hidden');
            avatarEl?.classList.remove('hidden');
        }
    }

    document.getElementById('view-name').textContent = emp.name;
    document.getElementById('view-role').textContent = emp.role || '—';
    document.getElementById('view-dept').textContent = emp.dept || '—';
    document.getElementById('view-salary').textContent = formatCurrency(emp.salary);
    document.getElementById('view-date').textContent = formatDateBR(emp.admissionDate);
    document.getElementById('view-contract').textContent = emp.contractType || '—';
    document.getElementById('view-email').textContent = emp.email || '—';
    document.getElementById('view-raca-cor').textContent = emp.racaCor || '—';

    const probationWrap = document.getElementById('view-probation-wrap');
    const probationInfo = getProbationStatus(emp);
    if (probationInfo) {
        probationWrap.classList.remove('hidden');
        const badgeEl = document.getElementById('view-probation');
        badgeEl.textContent = probationInfo.label;
        badgeEl.className = 'badge ' + (probationInfo.cls || 'badge--ativo');
    } else {
        probationWrap.classList.add('hidden');
    }

    const avisoPrevioWrap = document.getElementById('view-aviso-previo-wrap');
    const avisoPrevioInfo = getAvisoPrevioStatus(emp);
    if (avisoPrevioInfo) {
        avisoPrevioWrap.classList.remove('hidden');
        const badgeEl = document.getElementById('view-aviso-previo');
        badgeEl.textContent = avisoPrevioInfo.label;
        badgeEl.className = 'badge ' + (avisoPrevioInfo.cls || 'badge--ativo');
    } else {
        avisoPrevioWrap.classList.add('hidden');
    }

    document.getElementById('employee-drawer').classList.add('active');
    document.getElementById('drawer-overlay').classList.add('active');
};

window.closeDrawer = function () {
    document.getElementById('employee-drawer').classList.remove('active');
    document.getElementById('drawer-overlay').classList.remove('active');
    closeDropdownMenu();
};

window.toggleDropdown = function (event) {
    event.stopPropagation();
    const dd = document.getElementById('drawer-dropdown');
    const btn = document.getElementById('btn-drawer-options');
    if (!dd || !btn) return;
    if (!dd.classList.contains('show')) {
        const rect = btn.getBoundingClientRect();
        dd.style.top = `${rect.bottom + 6}px`;
        dd.style.right = `${window.innerWidth - rect.right}px`;
    }
    dd.classList.toggle('show');
};

function closeDropdownMenu() {
    document.getElementById('drawer-dropdown')?.classList.remove('show');
    backToMainMenu();
}

window.backToMainMenu = function () {
    document.getElementById('main-menu-options')?.classList.remove('hidden');
    document.getElementById('status-submenu-options')?.classList.add('hidden');
};

window.showStatusSubmenu = function () {
    const emp = employees.find((e) => e.id === currentEmployeeId);
    if (!emp) return;
    const dynamicOptions = document.getElementById('dynamic-status-options');
    if (!dynamicOptions) return;
    dynamicOptions.innerHTML = '';
    if (emp.status === 'Ativo') {
        dynamicOptions.innerHTML =
            `<a href="#" data-click="updateStatus" data-click-args="[&quot;Inativo&quot;]"><i class="fas fa-user-slash"></i> Inativo</a>` +
            `<a href="#" data-click="updateStatus" data-click-args="[&quot;Férias&quot;]"><i class="fas fa-umbrella-beach"></i> Férias</a>` +
            `<a href="#" data-click="updateStatus" data-click-args="[&quot;Afastado&quot;]"><i class="fas fa-user-clock"></i> Afastado</a>`;
    } else if (emp.status === 'Férias') {
        dynamicOptions.innerHTML = `<a href="#" data-click="updateStatus" data-click-args="[&quot;Ativo&quot;]"><i class="fas fa-check"></i> Voltar das Férias</a>`;
    } else if (emp.status === 'Afastado') {
        dynamicOptions.innerHTML = `<a href="#" data-click="updateStatus" data-click-args="[&quot;Ativo&quot;]"><i class="fas fa-check"></i> Voltar do Afastamento</a>`;
    } else if (emp.status === 'Inativo') {
        dynamicOptions.innerHTML = `<p class="status-locked-note">Status Inativo é permanente.</p>`;
    }
    document.getElementById('main-menu-options')?.classList.add('hidden');
    document.getElementById('status-submenu-options')?.classList.remove('hidden');
};

window.updateStatus = async function (newStatus) {
    const index = employees.findIndex((e) => e.id === currentEmployeeId);
    if (index === -1) return;

    const oldStatus = employees[index].status;
    const updateData = { status: newStatus };
    if (newStatus === 'Inativo' && !employees[index].terminationDate) {
        updateData.termination_date = new Date().toISOString().split('T')[0];
    }

    const { error } = await sb.from('employees').update(updateData).eq('id', currentEmployeeId);
    if (error) {
        showToast('Erro!', 'Não foi possível atualizar o status.', 'error');
        return;
    }

    if (newStatus === 'Inativo') {
        await sb
            .from('vacations')
            .update({ status: 'recusado', rejection_reason: 'Colaborador inativado pelo RH.', rejected_at: new Date().toISOString() })
            .eq('employee_id', currentEmployeeId)
            .eq('status', 'pendente');
    }

    employees[index].status = newStatus;
    if (updateData.termination_date) employees[index].terminationDate = updateData.termination_date;

    await logEmployeeEdit(currentEmployeeId, employees[index].name, [{ field: 'status', label: 'Status', oldValue: oldStatus, newValue: newStatus }]);

    openDrawer(currentEmployeeId);
    document.getElementById('drawer-dropdown').classList.remove('show');
    setTimeout(backToMainMenu, 300);
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    applyStatusFilter(activeFilter);
    renderStatsRow();
    renderAlertsBanner();
    const msgs = {
        Ativo: 'Colaborador marcado como Ativo.',
        Inativo: 'Colaborador marcado como Inativo.',
        Férias: 'Colaborador marcado como em Férias.',
        Afastado: 'Colaborador marcado como Afastado.',
    };
    showToast('Status Atualizado!', msgs[newStatus] || `Status: ${newStatus}`, 'success');
};

window.handleDeleteEmployee = async function () {
    const emp = employees.find((e) => e.id === currentEmployeeId);
    if (!emp) return;
    if (!confirm(`Tem certeza que deseja excluir ${emp.name}?\n\nO acesso ao sistema também será removido.`)) return;
    const { error } = await sb.from('employees').delete().eq('id', currentEmployeeId);
    if (error) {
        showToast('Erro!', 'Não foi possível excluir o colaborador.', 'error');
        return;
    }
    employees = employees.filter((e) => e.id !== currentEmployeeId);
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    applyStatusFilter(activeFilter);
    renderStatsRow();
    closeDrawer();
    showToast('Colaborador Excluído!', 'O colaborador foi removido do sistema.', 'error');
};

function renderAuditTimeline(entries) {
    const body = document.getElementById('audit-history-body');
    if (!body) return;
    if (!entries.length) {
        body.innerHTML = `<div class="empty-state"><i class="fas fa-clock-rotate-left"></i><p>Nenhuma alteração registrada</p></div>`;
        return;
    }
    body.innerHTML = entries
        .map((entry) => {
            const when = new Date(entry.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            const changesHtml = (entry.changes || [])
                .map(
                    (c) =>
                        `<div class="audit-timeline-field"><strong>${escapeHtml(c.label)}:</strong> ${escapeHtml(c.oldValue) || '—'} → ${escapeHtml(c.newValue) || '—'}</div>`
                )
                .join('');
            return `
            <div class="audit-timeline-item">
                <div class="audit-timeline-header">
                    <span class="audit-timeline-operator">${escapeHtml(entry.operator_name) || 'RH'}</span>
                    <span class="audit-timeline-date">${when}</span>
                </div>
                ${changesHtml}
            </div>`;
        })
        .join('');
}

window.handleShowHistory = async function () {
    const id = currentEmployeeId;
    if (!id) return;
    document.getElementById('drawer-dropdown')?.classList.remove('show');
    backToMainMenu();
    document.getElementById('audit-history-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    const body = document.getElementById('audit-history-body');
    if (body) body.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando histórico…</p></div>`;
    const entries = await fetchEmployeeAudit(id);
    renderAuditTimeline(entries);
};

window.closeAuditHistoryModal = function () {
    document.getElementById('audit-history-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

const LGPD_TIPO_META = {
    perfil_completo: { icon: 'fa-id-card', label: 'Perfil completo (CPF/RG/salário/dados bancários)' },
    documento: { icon: 'fa-file-lines', label: 'Documento' },
    holerite: { icon: 'fa-file-invoice-dollar', label: 'Holerite' },
    selfie_ponto: { icon: 'fa-camera', label: 'Selfie de ponto' },
};

async function fetchDataAccessLog(employeeId) {
    const { data, error } = await sb.from('data_access_log').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(50);
    if (error) {
        console.error('[Nexus] fetchDataAccessLog:', error);
        return [];
    }
    return data || [];
}

function renderAccessLogTimeline(entries) {
    const body = document.getElementById('lgpd-access-log-body');
    if (!body) return;
    if (!entries.length) {
        body.innerHTML = `<div class="empty-state"><i class="fas fa-eye-slash"></i><p>Nenhum acesso registrado ainda</p></div>`;
        return;
    }
    body.innerHTML = entries
        .map((entry) => {
            const meta = LGPD_TIPO_META[entry.tipo] || { icon: 'fa-eye', label: entry.tipo };
            const when = new Date(entry.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            return `
            <div class="audit-timeline-item">
                <div class="audit-timeline-header">
                    <span class="audit-timeline-operator"><i class="fas ${meta.icon}"></i> ${escapeHtml(entry.accessed_by_name) || 'RH'}</span>
                    <span class="audit-timeline-date">${when}</span>
                </div>
                <div class="audit-timeline-field">${escapeHtml(meta.label)}${entry.detalhe ? ` — ${escHtml(entry.detalhe)}` : ''}</div>
            </div>`;
        })
        .join('');
}

const AI_DECISION_TABLE_LABEL = {
    vacations: 'Férias',
    adjustment_requests: 'Ajuste de ponto',
    burnout_alerts: 'Alerta de burnout',
};

async function fetchAiDecisionLog(employeeId) {
    const { data, error } = await sb
        .from('ai_decision_log_decrypted')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) {
        console.error('[Nexus] fetchAiDecisionLog:', error);
        return [];
    }
    return data || [];
}

function renderAiDecisionLogTimeline(entries) {
    const body = document.getElementById('lgpd-ai-decisions-body');
    if (!body) return;
    if (!entries.length) {
        body.innerHTML = `<div class="empty-state"><i class="fas fa-robot"></i><p>Nenhuma decisão da IA registrada ainda</p></div>`;
        return;
    }
    body.innerHTML = entries
        .map((entry) => {
            const label = AI_DECISION_TABLE_LABEL[entry.target_table] || entry.target_table;
            const when = new Date(entry.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
            return `
            <div class="audit-timeline-item">
                <div class="audit-timeline-header">
                    <span class="audit-timeline-operator"><i class="fas fa-robot"></i> Confirmado por ${escHtml(entry.decided_by_name || 'RH')}</span>
                    <span class="audit-timeline-date">${when}</span>
                </div>
                <div class="audit-timeline-field">${label}: ${escHtml(entry.ai_message)}</div>
            </div>`;
        })
        .join('');
}

window.handleShowLgpd = async function () {
    const id = currentEmployeeId;
    if (!id) return;
    const emp = employees.find((e) => e.id === id);
    document.getElementById('drawer-dropdown')?.classList.remove('show');
    backToMainMenu();
    document.getElementById('lgpd-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';

    const anonBtn = document.getElementById('btn-anonymize-lgpd');
    const hint = document.getElementById('lgpd-anonymize-hint');
    const canAnonymize = emp?.status === 'Inativo' && !String(emp?.cpf || '').startsWith('ANONIMIZADO-');
    if (anonBtn) anonBtn.disabled = !canAnonymize;
    if (hint) {
        hint.textContent =
            emp?.status !== 'Inativo'
                ? 'Anonimização só é permitida para colaboradores desligados (status Inativo) — os registros de folha/ponto têm prazo legal de guarda e precisam continuar identificáveis enquanto o vínculo está ativo.'
                : String(emp?.cpf || '').startsWith('ANONIMIZADO-')
                  ? 'Os dados deste colaborador já foram anonimizados.'
                  : 'Sobrescreve nome, CPF, RG, contato, dados bancários e demais identificadores diretos. Não pode ser desfeito.';
    }

    const body = document.getElementById('lgpd-access-log-body');
    if (body) body.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando log de acessos…</p></div>`;
    const aiBody = document.getElementById('lgpd-ai-decisions-body');
    if (aiBody) aiBody.innerHTML = `<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Carregando decisões da IA…</p></div>`;

    const [entries, aiEntries] = await Promise.all([fetchDataAccessLog(id), fetchAiDecisionLog(id)]);
    renderAccessLogTimeline(entries);
    renderAiDecisionLogTimeline(aiEntries);
};

window.closeLgpdModal = function () {
    document.getElementById('lgpd-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

window.exportEmployeeDataLGPD = function () {
    const emp = employees.find((e) => e.id === currentEmployeeId);
    if (!emp) return;
    const { authUserId: _authUserId, managerId: _managerId, avatarColor: _avatarColor, ...personalData } = emp;
    const payload = {
        exportado_em: new Date().toISOString(),
        finalidade: 'Portabilidade de dados pessoais a pedido do titular (LGPD art. 18, V)',
        dados: personalData,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dados-${(emp.name || 'colaborador').replace(/\s+/g, '_')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    NexusAuth.logAccess(emp.id, 'perfil_completo', 'Exportação de dados (portabilidade LGPD)');
    NexusAuth.logExport('colaborador-lgpd.json', 1);
    showToast('Dados exportados', 'O arquivo JSON foi baixado.', 'success');
};

window.confirmAnonymizeEmployee = async function () {
    const emp = employees.find((e) => e.id === currentEmployeeId);
    if (!emp) return;
    if (!confirm(`Anonimizar os dados de ${emp.name}? Isso sobrescreve nome, CPF, RG, contato e dados bancários de forma irreversível.`)) return;

    const user = await NexusAuth.getUser();
    const { error } = await sb.rpc('anonymize_employee', {
        p_employee_id: emp.id,
        p_anonymized_by_name: user?.email?.split('@')[0] || 'RH',
        p_anonymized_by_email: user?.email || null,
    });
    if (error) {
        showToast('Erro ao anonimizar', error.message, 'error');
        return;
    }
    showToast('Dados anonimizados', `Os dados de ${emp.name} foram anonimizados.`, 'success');
    closeLgpdModal();
    closeDrawer();
    await fetchEmployees();
};

function buildOrgTree(list) {
    const nodeById = new Map(list.map((emp) => [emp.id, { emp, children: [] }]));
    const roots = [];

    function hasCycle(id, seen) {
        if (seen.has(id)) return true;
        const node = nodeById.get(id);
        if (!node || !node.emp.managerId) return false;
        seen.add(id);
        return hasCycle(node.emp.managerId, seen);
    }

    nodeById.forEach((node, id) => {
        const managerId = node.emp.managerId;
        if (managerId && nodeById.has(managerId) && managerId !== id && !hasCycle(id, new Set())) {
            nodeById.get(managerId).children.push(node);
        } else {
            roots.push(node);
        }
    });

    return roots;
}

function renderOrgNode(node) {
    const inactive = node.emp.status !== 'Ativo' ? ' org-node--inactive' : '';
    const childrenHtml = node.children.length ? `<ul>${node.children.map(renderOrgNode).join('')}</ul>` : '';
    return `<li class="org-node${inactive}">
        <div class="org-card" data-click="openOrgEmployee" data-click-args="${dargs(node.emp.id)}">
            <strong>${escHtml(node.emp.name)}</strong>
            <small>${escHtml(node.emp.role || '—')}</small>
            ${node.emp.dept ? `<span class="org-card-dept">${escHtml(node.emp.dept)}</span>` : ''}
        </div>
        ${childrenHtml}
    </li>`;
}

function createSelectField(id, onChange) {
    const trigger = document.getElementById(`${id}-trigger`);
    const popover = document.getElementById(`${id}-popover`);
    const label = document.getElementById(`${id}-label`);
    const hidden = document.getElementById(id);
    if (!trigger || !popover || !label || !hidden) return null;

    function open() {
        popover.classList.add('open');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
    }
    function close() {
        popover.classList.remove('open');
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
    }
    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }
    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    function setValue(value) {
        const opts = Array.from(popover.querySelectorAll('.select-option'));
        const opt = opts.find((o) => o.dataset.value === String(value));
        hidden.value = opt ? opt.dataset.value : '';
        label.textContent = opt ? opt.textContent : 'Selecione';
        label.classList.toggle('select-placeholder', !opt);
        opts.forEach((o) => o.classList.toggle('selected', o === opt));
        close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });
    popover.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('.select-option');
        if (!btn) return;
        setValue(btn.dataset.value);
        onChange?.();
    });

    return { setValue };
}

let orgDeptField = null;

function populateOrgChartDeptFilter() {
    const popover = document.getElementById('orgchart-dept-filter-popover');
    const hidden = document.getElementById('orgchart-dept-filter');
    if (!popover || !hidden) return;
    const current = hidden.value;
    const depts = [...new Set(employees.map((e) => e.dept).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    popover.innerHTML =
        '<button type="button" class="select-option" role="option" data-value="">Todos</button>' +
        depts.map((d) => `<button type="button" class="select-option" role="option" data-value="${escHtml(d)}">${escHtml(d)}</button>`).join('');
    orgDeptField?.setValue(depts.includes(current) ? current : '');
}

window.renderOrgChart = function () {
    const container = document.getElementById('orgchart-container');
    if (!container) return;
    const dept = document.getElementById('orgchart-dept-filter')?.value || '';
    const list = dept ? employees.filter((e) => e.dept === dept) : employees;
    const roots = buildOrgTree(list);
    container.innerHTML = roots.length
        ? `<ul class="org-tree">${roots.map(renderOrgNode).join('')}</ul>`
        : `<div class="empty-state"><i class="fas fa-sitemap"></i><p>${dept ? 'Nenhum colaborador neste departamento' : 'Nenhum colaborador cadastrado'}</p></div>`;
};

window.openOrgChart = function () {
    populateOrgChartDeptFilter();
    renderOrgChart();
    document.getElementById('orgchart-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
};

window.openOrgEmployee = function (id) {
    closeOrgChart();
    openDrawer(id);
};

window.closeOrgChart = function () {
    document.getElementById('orgchart-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

let onboardingTasksCache = [];

async function fetchOnboardingTasks() {
    const { data, error } = await sb.from('onboarding_tasks').select('*').order('dias', { ascending: true }).order('ordem', { ascending: true });
    if (error) {
        console.error('[Nexus] fetchOnboardingTasks:', error);
        onboardingTasksCache = [];
        return;
    }
    onboardingTasksCache = data || [];
}

function renderOnboardingTasksGroup(dias) {
    const container = document.getElementById(`onb-tasks-${dias}`);
    if (!container) return;
    const items = onboardingTasksCache.filter((t) => t.dias === dias);
    if (!items.length) {
        container.innerHTML = `<p class="onb-empty">Nenhuma tarefa cadastrada para esta etapa.</p>`;
        return;
    }
    container.innerHTML = items
        .map(
            (t) => `
        <div class="onb-chip">
            <div class="onb-chip-body">
                <div class="onb-chip-title">${escHtml(t.titulo)}</div>
                ${t.descricao ? `<div class="onb-chip-desc">${escHtml(t.descricao)}</div>` : ''}
            </div>
            <button type="button" data-click="removeOnboardingTask" data-click-args="${dargs(t.id)}" aria-label="Remover"><i class="fas fa-xmark"></i></button>
        </div>`
        )
        .join('');
}

function renderOnboardingTasksModal() {
    [30, 60, 90].forEach(renderOnboardingTasksGroup);
}

window.openOnboardingTasksModal = async function () {
    document.getElementById('onboarding-tasks-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    await fetchOnboardingTasks();
    renderOnboardingTasksModal();
};

window.closeOnboardingTasksModal = function () {
    document.getElementById('onboarding-tasks-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

window.addOnboardingTask = async function (dias) {
    const titleInput = document.getElementById(`onb-add-title-${dias}`);
    const descInput = document.getElementById(`onb-add-desc-${dias}`);
    const titulo = titleInput?.value.trim();
    if (!titulo) return;
    const descricao = descInput?.value.trim() || null;

    const ordem = onboardingTasksCache.filter((t) => t.dias === dias).length + 1;
    const { data, error } = await sb.from('onboarding_tasks').insert({ titulo, descricao, dias, ordem }).select().single();
    if (error) {
        showToast('Erro', 'Não foi possível adicionar a tarefa.', 'error');
        return;
    }

    onboardingTasksCache.push(data);
    titleInput.value = '';
    descInput.value = '';
    renderOnboardingTasksGroup(dias);
    showToast('Tarefa adicionada', `"${titulo}" agora faz parte da jornada de ${dias} dias.`, 'success');
};

window.removeOnboardingTask = async function (id) {
    const { error } = await sb.from('onboarding_tasks').delete().eq('id', id);
    if (error) {
        showToast('Erro', 'Não foi possível remover a tarefa.', 'error');
        return;
    }
    const task = onboardingTasksCache.find((t) => t.id === id);
    onboardingTasksCache = onboardingTasksCache.filter((t) => t.id !== id);
    if (task) renderOnboardingTasksGroup(task.dias);
    showToast('Tarefa removida', 'O checklist de integração foi atualizado.', 'success');
};

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function setDateFieldValue(input, iso) {
    if (!input) return;
    input.dataset.value = iso || '';
    if (!iso) {
        input.value = '';
        return;
    }
    const [y, m, d] = iso.split('-');
    input.value = `${d}/${m}/${y}`;
}

function getDateFieldValue(id) {
    return document.getElementById(id)?.dataset.value || '';
}

function resetDateFields() {
    document.querySelectorAll('.date-input').forEach((input) => setDateFieldValue(input, ''));
}

function initDateField(field) {
    const input = field.querySelector('.date-input');
    const popover = field.querySelector('.calendar-popover');
    const titleEl = field.querySelector('[data-cal-title]');
    const gridEl = field.querySelector('[data-cal-grid]');
    const prevBtn = field.querySelector('[data-cal-prev]');
    const nextBtn = field.querySelector('[data-cal-next]');
    if (!input || !popover) return;

    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();

    function syncViewToValue() {
        const iso = input.dataset.value;
        if (iso) {
            const [y, m] = iso.split('-').map(Number);
            viewYear = y;
            viewMonth = m - 1;
        } else {
            viewYear = today.getFullYear();
            viewMonth = today.getMonth();
        }
    }

    function render() {
        titleEl.textContent = `${MESES_PT[viewMonth]} ${viewYear}`;
        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
        const selectedIso = input.dataset.value || '';

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            cells.push({ day: d, muted: false, isToday, iso, selected: iso === selectedIso });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map((c) => {
                if (c.muted) return `<button type="button" class="calendar-day calendar-day--muted" disabled>${c.day}</button>`;
                const cls = ['calendar-day'];
                if (c.isToday) cls.push('calendar-day--today');
                if (c.selected) cls.push('calendar-day--selected');
                return `<button type="button" class="${cls.join(' ')}" data-iso="${c.iso}">${c.day}</button>`;
            })
            .join('');
    }

    function open() {
        syncViewToValue();
        render();
        popover.classList.add('open');
        field.classList.add('active');
    }

    function close() {
        popover.classList.remove('open');
        field.classList.remove('active');
    }

    input.addEventListener('click', () => (popover.classList.contains('open') ? close() : open()));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            popover.classList.contains('open') ? close() : open();
        }
    });
    field.querySelector('.date-field-icon')?.addEventListener('click', () => {
        popover.classList.contains('open') ? close() : open();
    });

    prevBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
    });
    nextBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
    });

    gridEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.calendar-day');
        if (!btn || btn.disabled) return;
        setDateFieldValue(input, btn.getAttribute('data-iso'));
        close();
    });

    document.addEventListener('click', (e) => {
        if (!field.contains(e.target)) close();
    });
}

function setupDateFields() {
    document.querySelectorAll('.date-field').forEach(initDateField);
}

let pendingRegDocs = [];
let pendingRegDocTipo = 'Outros';
const admissionalDocTypes = ['RG', 'CPF', 'Comprovante de Residência', 'Exame Admissional', 'Carteira de Trabalho', 'Contrato de Trabalho'];

const REG_DOC_RETENTION_YEARS = {
    'Contrato de Trabalho': 30,
    'Carteira de Trabalho': 30,
    'Exame Admissional': 20,
    RG: 5,
    CPF: 5,
    'Comprovante de Residência': 5,
};
const REG_DOC_TYPE_ICONS = {
    RG: 'fa-id-card',
    CPF: 'fa-address-card',
    'Comprovante de Residência': 'fa-house-chimney',
    'Exame Admissional': 'fa-notes-medical',
    'Carteira de Trabalho': 'fa-book',
    'Contrato de Trabalho': 'fa-file-signature',
    Outros: 'fa-file',
};

function regDocTypeIcon(tipo) {
    return REG_DOC_TYPE_ICONS[tipo] || 'fa-file-lines';
}

let admissionalReqs = [];

async function fetchAdmissionalDocTypes() {
    const { data, error } = await sb
        .from('document_requirements')
        .select('tipo,category,contract_type')
        .eq('category', 'admissional')
        .eq('obrigatorio', true)
        .order('tipo');
    if (error) {
        console.error('[Nexus] fetchAdmissionalDocTypes:', error);
        return;
    }
    admissionalReqs = data || [];
}

function getAdmissionalDocTypes() {
    if (!admissionalReqs.length) return admissionalDocTypes;
    return RequisitosDocumentos.requiredTipos(admissionalReqs, 'admissional', document.getElementById('contract-type')?.value);
}

function computeRegDocRetentionDate(tipo) {
    const years = REG_DOC_RETENTION_YEARS[tipo] ?? 5;
    const d = new Date();
    d.setFullYear(d.getFullYear() + years);
    return d.toISOString().slice(0, 10);
}

function formatFileSize(bytes) {
    const sizeKB = Math.round(bytes / 1024);
    return sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
}

function renderRegDocList() {
    const list = document.getElementById('reg-doc-list');
    const consentWrap = document.getElementById('reg-doc-consent-wrap');
    if (!list) return;
    const tipoOptions = [...getAdmissionalDocTypes(), 'Outros'];
    list.innerHTML = pendingRegDocs
        .map(
            (doc, i) => `
        <div class="reg-doc-item">
            <i class="fas fa-file-alt"></i>
            <div class="reg-doc-item-info">
                <span class="reg-doc-item-name" title="${escHtml(doc.file.name)}">${escHtml(doc.file.name)}</span>
                <span class="reg-doc-item-size">${formatFileSize(doc.file.size)}</span>
            </div>
            <select class="reg-doc-item-tipo" data-change="updateRegDocTipo" data-change-args="${dargs(i, { $: 'this.value' })}" aria-label="Tipo do documento">
                ${(tipoOptions.includes(doc.tipo) ? tipoOptions : [...tipoOptions, doc.tipo]).map((t) => `<option value="${t}" ${doc.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <button type="button" class="reg-doc-item-remove" data-click="removeRegDoc" data-click-args="${dargs(i)}" aria-label="Remover documento">
                <i class="fas fa-times"></i>
            </button>
        </div>`
        )
        .join('');
    if (consentWrap) consentWrap.classList.toggle('hidden', pendingRegDocs.length === 0);
}

function renderRegDocTypeList() {
    const list = document.getElementById('reg-doc-type-list');
    if (!list) return;
    const types = [...getAdmissionalDocTypes(), 'Outros'];
    list.innerHTML = types
        .map((tipo) => {
            const attached = pendingRegDocs.some((d) => d.tipo === tipo);
            const required = tipo !== 'Outros';
            return `
            <button type="button" class="reg-doc-type-item${attached ? ' reg-doc-type-item--attached' : ''}" data-click="selectRegDocType" data-click-args="${dargs(tipo)}">
                <div class="reg-doc-type-icon"><i class="fas ${regDocTypeIcon(tipo)}"></i></div>
                <div class="reg-doc-type-info">
                    <span class="reg-doc-type-name">${escHtml(tipo)}</span>
                    <span class="reg-doc-type-status">${required ? 'Obrigatório' : 'Opcional'}</span>
                </div>
                <i class="fas ${attached ? 'fa-check-circle reg-doc-type-check' : 'fa-chevron-right reg-doc-type-arrow'}"></i>
            </button>`;
        })
        .join('');
}

window.openRegDocModal = function () {
    renderRegDocTypeList();
    document.getElementById('reg-doc-modal')?.classList.add('open');
};

window.closeRegDocModal = function () {
    document.getElementById('reg-doc-modal')?.classList.remove('open');
};

window.selectRegDocType = function (tipo) {
    pendingRegDocTipo = tipo;
    closeRegDocModal();
    document.getElementById('reg-doc-input')?.click();
};

window.handleRegDocSelect = function (event) {
    const files = Array.from(event.target.files || []);
    files.forEach((file) => pendingRegDocs.push({ file, tipo: pendingRegDocTipo || 'Outros' }));
    event.target.value = '';
    pendingRegDocTipo = 'Outros';
    renderRegDocList();
};

window.updateRegDocTipo = function (index, tipo) {
    if (pendingRegDocs[index]) pendingRegDocs[index].tipo = tipo;
};

window.removeRegDoc = function (index) {
    pendingRegDocs.splice(index, 1);
    renderRegDocList();
};

function resetRegDocs() {
    pendingRegDocs = [];
    pendingRegDocTipo = 'Outros';
    const consentCheckbox = document.getElementById('reg-doc-lgpd-consent');
    if (consentCheckbox) consentCheckbox.checked = false;
    renderRegDocList();
}

async function uploadPendingRegDocs(employeeId) {
    if (!pendingRegDocs.length) return 0;
    const user = await NexusAuth.getUser();
    const consent = !!document.getElementById('reg-doc-lgpd-consent')?.checked;
    let uploaded = 0;

    for (const doc of pendingRegDocs) {
        const storagePath = `rh/${Date.now()}_${doc.file.name.replace(/\s/g, '_')}`;
        const { error: uploadError } = await NexusFiles.upload('documents', storagePath, doc.file, { employeeId });
        if (uploadError) continue;

        const { error: docError } = await sb.from('documents').insert({
            name: doc.file.name,
            employee_id: employeeId,
            category: 'admissional',
            tipo: doc.tipo || 'Outros',
            size_label: formatFileSize(doc.file.size),
            storage_path: storagePath,
            source: 'Administrador',
            created_by: user?.id || null,
            retido_ate: computeRegDocRetentionDate(doc.tipo),
            lgpd_consentimento: consent,
            lgpd_consentimento_em: consent ? new Date().toISOString() : null,
        });
        if (!docError) uploaded++;
    }

    resetRegDocs();
    return uploaded;
}

window.switchTab = function (event, tabId) {
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
    else document.querySelector(`[onclick*="${tabId}"]`)?.classList.add('active');
    document.getElementById(tabId)?.classList.add('active');
};

function populateManagerSelect(excludeId) {
    const sel = document.getElementById('manager-id');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML =
        '<option value="">Selecione</option>' +
        employees
            .filter((e) => e.status !== 'Inativo' && e.id !== excludeId)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map((e) => `<option value="${e.id}">${escapeHtml(e.name)}${e.role ? ' — ' + escapeHtml(e.role) : ''}</option>`)
            .join('');
    sel.value = current;
}

function setFormHeader(icon, title) {
    const iconEl = document.getElementById('form-header-icon');
    const titleEl = document.getElementById('form-title');
    if (iconEl) iconEl.innerHTML = `<i class="fas ${icon}"></i>`;
    if (titleEl) titleEl.textContent = title;
}

window.handleBackClick = function () {
    const formContainer = document.getElementById('form-container');
    if (formContainer && !formContainer.classList.contains('hidden')) {
        toggleForm();
        return false;
    }
    return true;
};

window.toggleForm = function () {
    const formContainer = document.getElementById('form-container');
    const listSection = document.getElementById('list-section');
    const form = document.getElementById('employee-form');
    const kpiGrid = document.querySelector('.kpi-grid');
    const headerActions = document.querySelector('.header-actions');
    if (formContainer && formContainer.classList.contains('hidden')) {
        formContainer.classList.remove('hidden');
        listSection?.classList.add('hidden');
        kpiGrid?.classList.add('hidden');
        headerActions?.classList.add('hidden');
        document.getElementById('alerts-banner')?.classList.add('hidden');
        resetStepper();
        resetConditionalFields();
        populateManagerSelect(null);
        resetRegDocs();
        populateRoleDropdown('role-popover', '');
        roleField?.setValue('');
    } else {
        formContainer?.classList.add('hidden');
        listSection?.classList.remove('hidden');
        kpiGrid?.classList.remove('hidden');
        headerActions?.classList.remove('hidden');
        renderAlertsBanner();
        form?.reset();
        resetDateFields();
        document.getElementById('employee-id').value = '';
        setFormHeader('fa-user-plus', 'Novo Colaborador');
        const btnSimple = document.getElementById('btn-save-simple');
        const btnStepper = document.getElementById('btn-save');
        if (btnSimple) btnSimple.textContent = 'Cadastrar';
        if (btnStepper) btnStepper.textContent = 'Cadastrar';
        resetStepper();
        resetConditionalFields();
        resetRegDocs();
    }
};

function setupFormListener() {
    const form = document.getElementById('employee-form');
    if (!form) return;
    document.getElementById('btn-save')?.addEventListener('click', () => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
    document.getElementById('btn-save-simple')?.addEventListener('click', () => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const idField = document.getElementById('employee-id').value;

        const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input[required], #tab-obrigatorios select[required]');
        if (!Array.from(mandatoryFields).every((f) => f.value.trim() !== '')) {
            showToast('Campos Obrigatórios!', 'Preencha todos os campos obrigatórios.', 'warning');
            return;
        }

        const cpfDigitado = document.getElementById('cpf').value.trim();
        if (!isValidCPF(cpfDigitado)) {
            showToast('CPF Inválido!', 'Verifique o CPF informado.', 'error');
            return;
        }

        const emailDigitado = document.getElementById('email').value.trim().toLowerCase();

        const cpfDuplicado = employees.some((emp) => emp.cpf === cpfDigitado && emp.id !== idField);
        if (cpfDuplicado) {
            showToast('CPF Duplicado!', 'Já existe um colaborador com este CPF.', 'error');
            return;
        }
        const emailDuplicado = employees.some((emp) => emp.email.toLowerCase() === emailDigitado && emp.id !== idField);
        if (emailDuplicado) {
            showToast('Email Duplicado!', 'Já existe um colaborador com este email.', 'error');
            return;
        }

        const seguroVida = document.querySelector('input[name="seguro-vida"]:checked')?.value || 'nao';
        const possuiDependentes = document.querySelector('input[name="possui-dependentes"]:checked')?.value || 'nao';
        const pcd = document.querySelector('input[name="pcd"]:checked')?.value || 'nao';
        const pensaoAlimenticia = document.querySelector('input[name="pensao-alimenticia"]:checked')?.value || 'nao';
        const valeTransporte = document.querySelector('input[name="vale-transporte"]:checked')?.value || 'nao';
        const isProbation = document.querySelector('input[name="em-experiencia"]:checked')?.value || 'nao';
        const isAvisoPrevio = document.querySelector('input[name="em-aviso-previo"]:checked')?.value || 'nao';
        const formaPagamento = document.querySelector('input[name="forma-pagamento"]:checked')?.value || '';
        const gender = document.querySelector('input[name="sexo"]:checked')?.value || '';
        const bancoValue = document.getElementById('banco')?.value || '';
        const bancoNome = bancoValue === 'outro' ? document.getElementById('banco-outro')?.value || '' : bancoValue;

        const admissionDateVal = getDateFieldValue('admission-date');

        if (isProbation === 'sim') {
            const probationEndVal = getDateFieldValue('probation-end-date');
            if (!probationEndVal) {
                showToast('Data Obrigatória!', 'Informe o fim do período de experiência.', 'error');
                return;
            }
            if (admissionDateVal) {
                const diffDays = Math.round((new Date(probationEndVal + 'T00:00:00') - new Date(admissionDateVal + 'T00:00:00')) / 86400000);
                if (diffDays <= 0) {
                    showToast('Data Inválida!', 'O fim da experiência deve ser posterior à data de admissão.', 'error');
                    return;
                }
                if (diffDays > 90) {
                    showToast(
                        'Limite Legal Excedido!',
                        `O período de experiência não pode ultrapassar 90 dias (CLT, art. 445, parágrafo único). Data informada resulta em ${diffDays} dias.`,
                        'error'
                    );
                    return;
                }
            }
        }

        if (isAvisoPrevio === 'sim') {
            const avisoPrevioEndVal = getDateFieldValue('aviso-previo-end-date');
            if (!avisoPrevioEndVal) {
                showToast('Data Obrigatória!', 'Informe o fim do aviso prévio.', 'error');
                return;
            }
            const hojeAviso = new Date();
            hojeAviso.setHours(0, 0, 0, 0);
            const diasAviso = Math.round((new Date(avisoPrevioEndVal + 'T00:00:00') - hojeAviso) / 86400000);
            if (diasAviso < 30) {
                showToast('Prazo Mínimo Não Atendido!', 'O aviso prévio deve ter no mínimo 30 dias (Lei 12.506/2011).', 'error');
                return;
            }
            let diasMaximosAviso = 90;
            if (admissionDateVal) {
                const admDate = new Date(admissionDateVal + 'T00:00:00');
                let anosCompletos = hojeAviso.getFullYear() - admDate.getFullYear();
                if (hojeAviso.getMonth() < admDate.getMonth() || (hojeAviso.getMonth() === admDate.getMonth() && hojeAviso.getDate() < admDate.getDate())) {
                    anosCompletos--;
                }
                diasMaximosAviso = CLTDomain.diasAvisoPrevioIntegral(Math.max(0, anosCompletos));
            }
            if (diasAviso > diasMaximosAviso) {
                showToast(
                    'Limite Legal Excedido!',
                    `O aviso prévio deste colaborador não pode ultrapassar ${diasMaximosAviso} dias (Lei 12.506/2011 — 30 dias + 3 por ano completo de casa, máx. 90). Data informada resulta em ${diasAviso} dias.`,
                    'error'
                );
                return;
            }
        }

        const empData = {
            name: document.getElementById('name').value.trim(),
            role: document.getElementById('role').value.trim(),
            cpf: cpfDigitado,
            rg: document.getElementById('rg')?.value || '',
            telefone: document.getElementById('telefone')?.value || '',
            email: emailDigitado,
            admissionDate: admissionDateVal,
            contractType: document.getElementById('contract-type').value,
            salaryType: document.getElementById('salary-type').value,
            workLoad: document.getElementById('work-load').value,
            dept: document.getElementById('dept').value,
            managerId: document.getElementById('manager-id')?.value || null,
            salary: Number(document.getElementById('salary').value.replace(/\D/g, '')) / 100,
            status: 'Ativo',
            gender,
            seguroVida,
            seguradora: seguroVida === 'sim' ? document.getElementById('seguradora')?.value || '' : '',
            possuiDependentes,
            qtdDependentes: possuiDependentes === 'sim' ? document.getElementById('qtd-dependentes')?.value || '' : '',
            pcd,
            deficiencia: pcd === 'sim' ? document.getElementById('tipo-deficiencia')?.value || '' : '',
            racaCor: document.getElementById('raca-cor')?.value || '',
            isProbation,
            probationEndDate: isProbation === 'sim' ? getDateFieldValue('probation-end-date') : '',
            isAvisoPrevio,
            avisoPrevioEndDate: isAvisoPrevio === 'sim' ? getDateFieldValue('aviso-previo-end-date') : '',
            pensaoAlimenticia,
            tipoPensao: pensaoAlimenticia === 'sim' ? document.querySelector('input[name="tipo-pensao"]:checked')?.value || '' : '',
            valeTransporte,
            valorPassagem: valeTransporte === 'sim' ? document.getElementById('valor-passagem')?.value || '' : '',
            conducoesdia: valeTransporte === 'sim' ? document.getElementById('conducoes-dia')?.value || '' : '',
            valeRefeicao: document.getElementById('ben-vale-refeicao')?.value || '',
            valeAlimentacao: document.getElementById('ben-vale-alimentacao')?.value || '',
            formaPagamento,
            tipoChavePix: formaPagamento === 'pix' ? document.getElementById('tipo-chave-pix')?.value || '' : '',
            chavePix: formaPagamento === 'pix' ? document.getElementById('chave-pix')?.value || '' : '',
            banco: formaPagamento === 'conta' ? bancoNome : '',
            tipoConta: formaPagamento === 'conta' ? document.getElementById('tipo-conta')?.value || '' : '',
            agencia: formaPagamento === 'conta' ? document.getElementById('agencia')?.value || '' : '',
            conta: formaPagamento === 'conta' ? document.getElementById('conta')?.value || '' : '',
        };

        const isEditing = !!idField;
        const dbData = employeeToDb(empData);

        const btns = document.querySelectorAll('#btn-save, #btn-save-simple');
        btns.forEach((b) => (b.disabled = true));

        try {
            let successMsg = isEditing ? 'Os dados foram atualizados com sucesso.' : 'Colaborador registrado.';
            if (isEditing) {
                const old = employees.find((e) => e.id === idField);
                const TRACKED = [
                    { key: 'name', label: 'Nome' },
                    { key: 'role', label: 'Cargo' },
                    { key: 'dept', label: 'Departamento' },
                    { key: 'salary', label: 'Salário', fmt: (v) => `R$ ${Number(v).toFixed(2)}` },
                    { key: 'contractType', label: 'Tipo de Contrato' },
                    { key: 'email', label: 'E-mail' },
                    { key: 'admissionDate', label: 'Data de Admissão' },
                ];
                const changes = TRACKED.reduce((acc, { key, label, fmt }) => {
                    if (String(old?.[key] ?? '') !== String(empData[key] ?? '')) {
                        acc.push({
                            field: key,
                            label,
                            oldValue: fmt ? fmt(old?.[key]) : String(old?.[key] ?? '—'),
                            newValue: fmt ? fmt(empData[key]) : String(empData[key] ?? '—'),
                        });
                    }
                    return acc;
                }, []);

                dbData.status = old?.status || 'Ativo';
                const { error } = await sb.from('employees').update(dbData).eq('id', idField);
                if (error) throw error;
                await logEmployeeEdit(idField, empData.name, changes);
                const idx = employees.findIndex((e) => e.id === idField);
                if (idx !== -1) employees[idx] = { ...employees[idx], ...empData, id: idField };

                const docsUploaded = await uploadPendingRegDocs(idField);
                if (docsUploaded) successMsg += ` ${docsUploaded} documento${docsUploaded > 1 ? 's' : ''} anexado${docsUploaded > 1 ? 's' : ''}.`;
            } else {
                const inserted = await insertEmployee(dbData);
                const newEmp = dbToEmployee(inserted);
                employees.unshift(newEmp);
                let inviteSent = false;
                try {
                    const invite = await inviteEmployee(empData.email);
                    if (invite?.id) {
                        await sb.from('profiles').insert({
                            id: invite.id,
                            profile: 'colaborador',
                            employee_id: inserted.id,
                        });
                        await sb.from('employees').update({ auth_user_id: invite.id }).eq('id', inserted.id);
                        inviteSent = true;
                    }
                } catch (err) {
                    console.error('[Nexus] Convite não enviado:', err.message);
                    showToast('Aviso de Convite', `Colaborador cadastrado, mas o e-mail de acesso não foi enviado: ${err.message}`, 'warning');
                }
                successMsg = inviteSent
                    ? 'Colaborador registrado. Um e-mail de acesso foi enviado.'
                    : 'Colaborador registrado. O e-mail de acesso poderá ser reenviado depois.';

                const docsUploaded = await uploadPendingRegDocs(inserted.id);
                if (docsUploaded) successMsg += ` ${docsUploaded} documento${docsUploaded > 1 ? 's' : ''} de admissão anexado${docsUploaded > 1 ? 's' : ''}.`;
            }

            const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
            applyStatusFilter(activeFilter);
            renderStatsRow();
            showToast(isEditing ? 'Colaborador Atualizado!' : 'Colaborador Cadastrado!', successMsg, 'success');
            toggleForm();
        } catch (err) {
            console.error('[Nexus] save employee:', err);
            const detail = err?.message || err?.details || err?.code || 'Tente novamente.';
            showToast('Erro!', detail, 'error');
        } finally {
            btns.forEach((b) => (b.disabled = false));
        }
    });
}

window.handleEditFromDrawer = function () {
    const id = currentEmployeeId;
    closeDrawer();
    if (id) editEmployee(id);
};

window.handlePromoteEmployee = function () {
    const id = currentEmployeeId;
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    document.getElementById('drawer-dropdown')?.classList.remove('show');
    backToMainMenu();

    const infoEl = document.getElementById('promote-current-info');
    if (infoEl) infoEl.textContent = `Atual: ${emp.role || '—'} · ${emp.contractType || '—'} · ${formatCurrency(emp.salary)}`;

    const contractInput = document.getElementById('promote-contract-type');
    const salaryInput = document.getElementById('promote-salary');
    const motivoInput = document.getElementById('promote-motivo');
    populateRoleDropdown('promote-role-popover', emp.role || '');
    promoteRoleField?.setValue(emp.role || '');
    if (contractInput) contractInput.value = emp.contractType || 'CLT';
    if (salaryInput) {
        const salaryRaw = emp.salary || 0;
        salaryInput.value =
            'R$ ' +
            salaryRaw
                .toFixed(2)
                .replace('.', ',')
                .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
    if (motivoInput) motivoInput.value = '';
    window.updatePromoteBtnState();

    document.getElementById('promote-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('promote-role-trigger')?.focus(), 50);
};

window.closePromoteModal = function () {
    document.getElementById('promote-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

window.updatePromoteBtnState = function () {
    const btn = document.getElementById('btn-promote-submit');
    if (!btn) return;
    const emp = employees.find((e) => e.id === currentEmployeeId);
    if (!emp) {
        btn.disabled = true;
        return;
    }
    const newRole = document.getElementById('promote-role')?.value.trim() || '';
    const newContractType = document.getElementById('promote-contract-type')?.value || '';
    const newSalaryCents = Number((document.getElementById('promote-salary')?.value || '').replace(/\D/g, ''));
    const roleChanged = newRole && newRole !== (emp.role || '');
    const contractChanged = newContractType && newContractType !== (emp.contractType || '');
    btn.disabled = !((roleChanged || contractChanged) && newSalaryCents > 0);
};

window.submitPromotion = async function () {
    const btn = document.getElementById('btn-promote-submit');
    const id = currentEmployeeId;
    const emp = employees.find((e) => e.id === id);
    if (!emp || !id) return;

    const newRole = document.getElementById('promote-role').value.trim();
    const newContractType = document.getElementById('promote-contract-type').value;
    const newSalary = Number(document.getElementById('promote-salary').value.replace(/\D/g, '')) / 100;
    const motivo = document.getElementById('promote-motivo').value.trim();

    const roleChanged = newRole && newRole !== (emp.role || '');
    const contractChanged = newContractType && newContractType !== (emp.contractType || '');

    if (!newRole || !newContractType || !(newSalary > 0) || !(roleChanged || contractChanged)) {
        showToast('Campos obrigatórios', 'Informe cargo, tipo de contrato e salário — pelo menos cargo ou tipo de contrato precisa mudar.', 'warning');
        return;
    }

    const changes = [];
    if (roleChanged) changes.push({ field: 'role', label: 'Cargo', oldValue: emp.role || '—', newValue: newRole });
    if (contractChanged) {
        changes.push({ field: 'contractType', label: 'Tipo de Contrato', oldValue: emp.contractType || '—', newValue: newContractType });
    }
    if (Number(newSalary.toFixed(2)) !== Number((emp.salary || 0).toFixed(2))) {
        changes.push({
            field: 'salary',
            label: 'Salário',
            oldValue: `R$ ${Number(emp.salary || 0).toFixed(2)}`,
            newValue: `R$ ${newSalary.toFixed(2)}`,
        });
    }
    if (motivo) changes.push({ field: 'motivo', label: 'Motivo da Promoção', oldValue: '—', newValue: motivo });

    if (btn) btn.disabled = true;
    try {
        const { error } = await sb.from('employees').update({ role: newRole, contract_type: newContractType, salary: newSalary }).eq('id', id);
        if (error) throw error;
        await logEmployeeEdit(id, emp.name, changes);

        const idx = employees.findIndex((e) => e.id === id);
        if (idx !== -1) employees[idx] = { ...employees[idx], role: newRole, contractType: newContractType, salary: newSalary };

        const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
        applyStatusFilter(activeFilter);
        renderStatsRow();
        window.openDrawer(id);

        window.closePromoteModal();
        const summary =
            roleChanged && contractChanged
                ? `agora é ${newRole} (${newContractType})`
                : roleChanged
                  ? `agora é ${newRole}`
                  : `agora está em ${newContractType}`;
        showToast('Colaborador Promovido!', `${emp.name} ${summary}.`, 'success');
    } catch (err) {
        console.error('[Nexus] submitPromotion:', err);
        showToast('Erro!', 'Não foi possível registrar a promoção. Tente novamente.', 'error');
        if (btn) btn.disabled = false;
    }
};

let jobTitles = [];
let jobTitlesPublic = [];
let roleField = null;
let promoteRoleField = null;

async function fetchJobTitlesPublic() {
    const { data } = await sb.rpc('job_titles_public');
    jobTitlesPublic = data || [];
}

function populateRoleDropdown(popoverId, currentValue) {
    const popover = document.getElementById(popoverId);
    if (!popover) return;
    const titles = jobTitlesPublic.map((t) => t.title);
    const extra = currentValue && !titles.includes(currentValue) ? [currentValue] : [];
    popover.innerHTML = [...extra, ...titles]
        .map((t) => `<button type="button" class="select-option" role="option" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
        .join('');
}

async function fetchJobTitlesFull() {
    const { data } = await sb.from('job_titles').select('*').order('track', { ascending: true, nullsFirst: false }).order('level').order('title');
    jobTitles = data || [];
}

function renderJobTitlesList() {
    const wrap = document.getElementById('job-titles-list');
    if (!wrap) return;
    if (!jobTitles.length) {
        wrap.innerHTML = `<p class="onb-empty">Nenhum cargo cadastrado ainda.</p>`;
        return;
    }
    wrap.innerHTML = jobTitles
        .map((t) => {
            const range =
                t.salary_min || t.salary_max
                    ? `${t.salary_min ? formatCurrency(t.salary_min) : '—'} a ${t.salary_max ? formatCurrency(t.salary_max) : '—'}`
                    : 'Faixa salarial não definida';
            const meta = [t.track, t.level].filter(Boolean).join(' · ') || 'Sem trilha/nível definido';
            const inactiveBadge = t.active ? '' : `<span class="jt-inactive-badge">Inativo</span>`;
            return `<div class="onb-chip">
                <div class="onb-chip-body">
                    <div class="onb-chip-title">${escapeHtml(t.title)}${inactiveBadge}</div>
                    <div class="onb-chip-desc">${escapeHtml(meta)} · ${escapeHtml(range)}</div>
                </div>
                <button type="button" data-click="toggleJobTitleActive" data-click-args="${dargs(t.id, t.active)}" title="${t.active ? 'Desativar' : 'Ativar'}" aria-label="${t.active ? 'Desativar' : 'Ativar'}">
                    <i class="fas ${t.active ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                </button>
                <button type="button" data-click="deleteJobTitle" data-click-args="${dargs(t.id)}" title="Excluir" aria-label="Excluir">
                    <i class="fas fa-trash"></i>
                </button>
            </div>`;
        })
        .join('');
}

window.openJobTitlesModal = async function () {
    document.getElementById('job-titles-list').innerHTML = `<p class="onb-empty">Carregando…</p>`;
    document.getElementById('job-titles-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    await fetchJobTitlesFull();
    renderJobTitlesList();
};

window.closeJobTitlesModal = function () {
    document.getElementById('job-titles-modal')?.classList.remove('open');
    document.body.style.overflow = '';
    ['jt-add-title', 'jt-add-track', 'jt-add-level', 'jt-add-salary-min', 'jt-add-salary-max'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
};

window.addJobTitle = async function () {
    const title = document.getElementById('jt-add-title')?.value.trim();
    if (!title) {
        showToast('Campo obrigatório', 'Informe o nome do cargo.', 'warning');
        return;
    }
    const track = document.getElementById('jt-add-track')?.value.trim() || null;
    const level = document.getElementById('jt-add-level')?.value.trim() || null;
    const parseSalary = (id) => {
        const raw = document.getElementById(id)?.value.replace(/\D/g, '') || '';
        return raw ? Number(raw) / 100 : null;
    };
    const salaryMin = parseSalary('jt-add-salary-min');
    const salaryMax = parseSalary('jt-add-salary-max');
    if (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin) {
        showToast('Faixa inválida', 'O salário máximo precisa ser maior ou igual ao mínimo.', 'warning');
        return;
    }

    const { error } = await sb.from('job_titles').insert({ title, track, level, salary_min: salaryMin, salary_max: salaryMax });
    if (error) {
        showToast('Erro!', error.code === '23505' ? 'Já existe um cargo com esse nome.' : 'Não foi possível adicionar o cargo.', 'error');
        return;
    }
    ['jt-add-title', 'jt-add-track', 'jt-add-level', 'jt-add-salary-min', 'jt-add-salary-max'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    await fetchJobTitlesFull();
    renderJobTitlesList();
    await fetchJobTitlesPublic();
    showToast('Cargo Adicionado!', `"${title}" agora está disponível no catálogo.`, 'success');
};

window.toggleJobTitleActive = async function (id, currentActive) {
    const { error } = await sb.from('job_titles').update({ active: !currentActive }).eq('id', id);
    if (error) {
        showToast('Erro!', 'Não foi possível atualizar o cargo.', 'error');
        return;
    }
    await fetchJobTitlesFull();
    renderJobTitlesList();
    await fetchJobTitlesPublic();
};

window.deleteJobTitle = async function (id) {
    if (!confirmDelete()) return;
    const { error } = await sb.from('job_titles').delete().eq('id', id);
    if (error) {
        showToast('Erro!', 'Não foi possível excluir o cargo.', 'error');
        return;
    }
    await fetchJobTitlesFull();
    renderJobTitlesList();
    await fetchJobTitlesPublic();
    showToast('Cargo Excluído!', 'O cargo foi removido do catálogo.', 'error');
};

const TRAINING_STATUS_LABEL = {
    pendente: 'Pendente',
    em_andamento: 'Em andamento',
    concluido: 'Concluído',
    aguardando_aprovacao: 'Aguardando aprovação',
    recusado: 'Recusado',
    cancelado: 'Cancelado',
};

let trainingsCatalogFull = [];
let trainingsCatalogPublic = [];
let trainingsEmployeeId = null;
let employeeTrainings = [];
let trAssignCatalogField = null;

async function fetchTrainingsCatalogPublic() {
    const { data } = await sb.from('trainings').select('id,title,category,duration_hours').eq('active', true).order('title');
    trainingsCatalogPublic = data || [];
}

async function fetchTrainingsCatalogFull() {
    const { data } = await sb.from('trainings').select('*').order('title');
    trainingsCatalogFull = data || [];
}

function renderTrainingsCatalogList() {
    const wrap = document.getElementById('trainings-catalog-list');
    if (!wrap) return;
    if (!trainingsCatalogFull.length) {
        wrap.innerHTML = `<p class="onb-empty">Nenhum treinamento cadastrado ainda.</p>`;
        return;
    }
    wrap.innerHTML = trainingsCatalogFull
        .map((t) => {
            const meta = [t.category, t.provider, t.duration_hours ? `${t.duration_hours}h` : null].filter(Boolean).join(' · ') || 'Sem detalhes definidos';
            const inactiveBadge = t.active ? '' : `<span class="jt-inactive-badge">Inativo</span>`;
            return `<div class="onb-chip">
                <div class="onb-chip-body">
                    <div class="onb-chip-title">${escapeHtml(t.title)}${inactiveBadge}</div>
                    <div class="onb-chip-desc">${escapeHtml(meta)}</div>
                </div>
                <button type="button" data-click="toggleTrainingCatalogActive" data-click-args="${dargs(t.id, t.active)}" title="${t.active ? 'Desativar' : 'Ativar'}" aria-label="${t.active ? 'Desativar' : 'Ativar'}">
                    <i class="fas ${t.active ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                </button>
                <button type="button" data-click="deleteTrainingCatalog" data-click-args="${dargs(t.id)}" title="Excluir" aria-label="Excluir">
                    <i class="fas fa-trash"></i>
                </button>
            </div>`;
        })
        .join('');
}

window.openTrainingsCatalogModal = async function () {
    document.getElementById('trainings-catalog-list').innerHTML = `<p class="onb-empty">Carregando…</p>`;
    document.getElementById('trainings-catalog-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    await fetchTrainingsCatalogFull();
    renderTrainingsCatalogList();
};

window.closeTrainingsCatalogModal = function () {
    document.getElementById('trainings-catalog-modal')?.classList.remove('open');
    document.body.style.overflow = '';
    ['tc-add-title', 'tc-add-category', 'tc-add-provider', 'tc-add-hours'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
};

window.addTrainingCatalog = async function () {
    const title = document.getElementById('tc-add-title')?.value.trim();
    if (!title) {
        showToast('Campo obrigatório', 'Informe o nome do treinamento.', 'warning');
        return;
    }
    const category = document.getElementById('tc-add-category')?.value.trim() || null;
    const provider = document.getElementById('tc-add-provider')?.value.trim() || null;
    const hoursRaw = document.getElementById('tc-add-hours')?.value.trim();
    const hours = hoursRaw ? Number(hoursRaw.replace(',', '.')) : null;
    if (hoursRaw && (Number.isNaN(hours) || hours < 0)) {
        showToast('Valor inválido', 'Informe a carga horária em número de horas.', 'warning');
        return;
    }

    const { error } = await sb.from('trainings').insert({ title, category, provider, duration_hours: hours });
    if (error) {
        showToast('Erro!', error.code === '23505' ? 'Já existe um treinamento com esse nome.' : 'Não foi possível adicionar o treinamento.', 'error');
        return;
    }
    ['tc-add-title', 'tc-add-category', 'tc-add-provider', 'tc-add-hours'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    await fetchTrainingsCatalogFull();
    renderTrainingsCatalogList();
    await fetchTrainingsCatalogPublic();
    showToast('Treinamento Adicionado!', `"${title}" agora está disponível no catálogo.`, 'success');
};

window.toggleTrainingCatalogActive = async function (id, currentActive) {
    const { error } = await sb.from('trainings').update({ active: !currentActive }).eq('id', id);
    if (error) {
        showToast('Erro!', 'Não foi possível atualizar o treinamento.', 'error');
        return;
    }
    await fetchTrainingsCatalogFull();
    renderTrainingsCatalogList();
    await fetchTrainingsCatalogPublic();
};

window.deleteTrainingCatalog = async function (id) {
    if (!confirmDelete()) return;
    const { error } = await sb.from('trainings').delete().eq('id', id);
    if (error) {
        showToast('Erro!', 'Não foi possível excluir o treinamento.', 'error');
        return;
    }
    await fetchTrainingsCatalogFull();
    renderTrainingsCatalogList();
    await fetchTrainingsCatalogPublic();
    showToast('Treinamento Excluído!', 'O treinamento foi removido do catálogo.', 'error');
};

async function fetchEmployeeTrainings(employeeId) {
    const { data } = await sb
        .from('employee_trainings')
        .select('id,title,category,provider,hours,source,status,completion_date,certificate_url,notes,assigned_by_name,created_at')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });
    employeeTrainings = data || [];
}

function renderTrainingsList() {
    const wrap = document.getElementById('trainings-list');
    if (!wrap) return;
    if (!employeeTrainings.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhum treinamento registrado ainda.</p>`;
        return;
    }
    wrap.innerHTML = employeeTrainings
        .map((t) => {
            const label = TRAINING_STATUS_LABEL[t.status] || t.status;
            const bits = [t.category, t.provider, t.hours ? `${t.hours}h` : null, t.source === 'autodeclarado' ? 'Autodeclarado' : null].filter(Boolean);
            if (t.certificate_url) bits.push(`<a href="${escapeHtml(t.certificate_url)}" target="_blank" rel="noopener">Certificado</a>`);
            let actions = '';
            if (t.status === 'aguardando_aprovacao') {
                actions = `<button type="button" class="training-action-btn training-action-btn--approve" data-click="approveTraining" data-click-args="${dargs(t.id)}">Aprovar</button>
                    <button type="button" class="training-action-btn training-action-btn--reject" data-click="rejectTraining" data-click-args="${dargs(t.id)}">Recusar</button>`;
            } else if (t.status === 'pendente' || t.status === 'em_andamento') {
                actions = `<button type="button" class="training-action-btn training-action-btn--complete" data-click="completeTraining" data-click-args="${dargs(t.id)}">Concluir</button>`;
            }
            return `<div class="training-item">
                <div class="training-info">
                    <span class="training-title">${escapeHtml(t.title)}</span>
                    <span class="training-meta">${bits.join(' · ') || '—'}</span>
                </div>
                <span class="goal-status-badge goal-status-badge--${t.status}">${label}</span>
                ${actions}
            </div>`;
        })
        .join('');
}

window.handleOpenTrainings = async function () {
    const id = currentEmployeeId;
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    document.getElementById('drawer-dropdown')?.classList.remove('show');
    backToMainMenu();

    trainingsEmployeeId = id;
    const nameEl = document.getElementById('trainings-emp-name');
    if (nameEl) nameEl.textContent = emp.name;
    document.getElementById('trainings-list').innerHTML = `<p class="performance-empty">Carregando…</p>`;
    document.getElementById('tr-assign-title').value = '';
    document.getElementById('tr-assign-hours').value = '';
    trAssignCatalogField?.setValue('');
    document.getElementById('trainings-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';

    const popover = document.getElementById('tr-assign-catalog-popover');
    if (popover) {
        popover.innerHTML = trainingsCatalogPublic
            .map((t) => `<button type="button" class="select-option" role="option" data-value="${t.id}">${escapeHtml(t.title)}</button>`)
            .join('');
    }

    await fetchEmployeeTrainings(id);
    renderTrainingsList();
};

window.closeTrainingsModal = function () {
    document.getElementById('trainings-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

window.assignTraining = async function () {
    if (!trainingsEmployeeId) return;
    const catalogId = document.getElementById('tr-assign-catalog')?.value || null;
    const catalogEntry = catalogId ? trainingsCatalogPublic.find((t) => t.id === catalogId) : null;
    const typedTitle = document.getElementById('tr-assign-title')?.value.trim();
    const title = catalogEntry?.title || typedTitle;
    if (!title) {
        showToast('Campo obrigatório', 'Escolha um treinamento do catálogo ou digite o nome.', 'warning');
        return;
    }
    const hoursRaw = document.getElementById('tr-assign-hours')?.value.trim();
    const hours = hoursRaw ? Number(hoursRaw.replace(',', '.')) : catalogEntry?.duration_hours || null;

    const { error } = await sb.from('employee_trainings').insert({
        employee_id: trainingsEmployeeId,
        training_id: catalogEntry?.id || null,
        title,
        category: catalogEntry?.category || null,
        hours,
        assigned_by_name: 'RH',
    });
    if (error) {
        showToast('Erro!', 'Não foi possível atribuir o treinamento.', 'error');
        return;
    }
    document.getElementById('tr-assign-title').value = '';
    document.getElementById('tr-assign-hours').value = '';
    trAssignCatalogField?.setValue('');
    await fetchEmployeeTrainings(trainingsEmployeeId);
    renderTrainingsList();
    showToast('Treinamento Atribuído!', `"${title}" foi atribuído ao colaborador.`, 'success');
};

window.approveTraining = async function (id) {
    const { error } = await sb
        .from('employee_trainings')
        .update({ status: 'concluido', completion_date: new Date().toISOString().slice(0, 10) })
        .eq('id', id);
    if (error) {
        showToast('Erro!', 'Não foi possível aprovar o treinamento.', 'error');
        return;
    }
    await fetchEmployeeTrainings(trainingsEmployeeId);
    renderTrainingsList();
    showToast('Treinamento Aprovado!', 'O curso autodeclarado foi confirmado.', 'success');
};

window.rejectTraining = async function (id) {
    const { error } = await sb.from('employee_trainings').update({ status: 'recusado' }).eq('id', id);
    if (error) {
        showToast('Erro!', 'Não foi possível recusar o treinamento.', 'error');
        return;
    }
    await fetchEmployeeTrainings(trainingsEmployeeId);
    renderTrainingsList();
    showToast('Treinamento Recusado!', 'O curso autodeclarado foi recusado.', 'info');
};

window.completeTraining = async function (id) {
    const { error } = await sb
        .from('employee_trainings')
        .update({ status: 'concluido', completion_date: new Date().toISOString().slice(0, 10) })
        .eq('id', id);
    if (error) {
        showToast('Erro!', 'Não foi possível concluir o treinamento.', 'error');
        return;
    }
    await fetchEmployeeTrainings(trainingsEmployeeId);
    renderTrainingsList();
    showToast('Treinamento Concluído!', 'O registro foi marcado como concluído.', 'success');
};

const DISCIPLINARY_TYPE_LABEL = { advertencia_verbal: 'Advertência Verbal', advertencia_escrita: 'Advertência Escrita', suspensao: 'Suspensão' };

let disciplinaryEmployeeId = null;
let disciplinaryActions = [];
let daTypeField = null;

async function fetchDisciplinaryActions(employeeId) {
    const { data } = await sb
        .from('disciplinary_actions')
        .select('id,type,reason,description,suspension_days,occurred_at,created_by_name,acknowledged_at,created_at')
        .eq('employee_id', employeeId)
        .order('occurred_at', { ascending: false });
    disciplinaryActions = data || [];
}

function renderDisciplinaryList() {
    const wrap = document.getElementById('disciplinary-list');
    if (!wrap) return;
    if (!disciplinaryActions.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhuma medida disciplinar registrada.</p>`;
        return;
    }
    wrap.innerHTML = disciplinaryActions
        .map((d) => {
            const label = DISCIPLINARY_TYPE_LABEL[d.type] || d.type;
            const bits = [formatDateBR(d.occurred_at), d.suspension_days ? `${d.suspension_days} dia${d.suspension_days > 1 ? 's' : ''}` : null].filter(
                Boolean
            );
            const ack = d.acknowledged_at
                ? `<span class="disciplinary-ack-badge disciplinary-ack-badge--done"><i class="fas fa-check"></i> Ciente em ${formatDateBR(d.acknowledged_at.slice(0, 10))}</span>`
                : `<span class="disciplinary-ack-badge disciplinary-ack-badge--pending"><i class="fas fa-clock"></i> Aguardando ciência</span>`;
            return `<div class="disciplinary-item">
                <div class="disciplinary-info">
                    <span class="disciplinary-title">${escapeHtml(d.reason)}</span>
                    <span class="disciplinary-meta">${bits.join(' · ')}${d.description ? ' · ' + escapeHtml(d.description) : ''}</span>
                </div>
                <div class="disciplinary-badges">
                    <span class="disciplinary-type-badge disciplinary-type-badge--${d.type}">${label}</span>
                    ${ack}
                </div>
            </div>`;
        })
        .join('');
}

window.handleOpenDisciplinary = async function () {
    const id = currentEmployeeId;
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    document.getElementById('drawer-dropdown')?.classList.remove('show');
    backToMainMenu();

    disciplinaryEmployeeId = id;
    const nameEl = document.getElementById('disciplinary-emp-name');
    if (nameEl) nameEl.textContent = emp.name;
    document.getElementById('disciplinary-list').innerHTML = `<p class="performance-empty">Carregando…</p>`;
    document.getElementById('da-reason').value = '';
    document.getElementById('da-description').value = '';
    document.getElementById('da-suspension-days').value = '';
    document.getElementById('da-suspension-days').classList.add('hidden');
    daTypeField?.setValue('');
    setDateFieldValue(document.getElementById('da-occurred-date'), new Date().toISOString().slice(0, 10));
    document.getElementById('disciplinary-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';

    await fetchDisciplinaryActions(id);
    renderDisciplinaryList();
};

window.closeDisciplinaryModal = function () {
    document.getElementById('disciplinary-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

window.addDisciplinaryAction = async function () {
    if (!disciplinaryEmployeeId) return;
    const type = document.getElementById('da-type')?.value;
    if (!type) {
        showToast('Campo obrigatório', 'Selecione o tipo da medida disciplinar.', 'warning');
        return;
    }
    const reason = document.getElementById('da-reason')?.value.trim();
    if (!reason) {
        showToast('Campo obrigatório', 'Informe o motivo.', 'warning');
        return;
    }
    let suspensionDays = null;
    if (type === 'suspensao') {
        const raw = document.getElementById('da-suspension-days')?.value.trim();
        suspensionDays = raw ? Number(raw) : NaN;
        if (!raw || !Number.isInteger(suspensionDays) || suspensionDays <= 0) {
            showToast('Valor inválido', 'Informe a quantidade de dias de suspensão.', 'warning');
            return;
        }
    }
    const description = document.getElementById('da-description')?.value.trim() || null;
    const occurredAt = getDateFieldValue('da-occurred-date') || new Date().toISOString().slice(0, 10);

    const { error } = await sb.from('disciplinary_actions').insert({
        employee_id: disciplinaryEmployeeId,
        type,
        reason,
        description,
        suspension_days: suspensionDays,
        occurred_at: occurredAt,
        created_by_name: 'RH',
    });
    if (error) {
        showToast('Erro!', 'Não foi possível registrar a medida disciplinar.', 'error');
        return;
    }
    document.getElementById('da-reason').value = '';
    document.getElementById('da-description').value = '';
    document.getElementById('da-suspension-days').value = '';
    document.getElementById('da-suspension-days').classList.add('hidden');
    daTypeField?.setValue('');
    await fetchDisciplinaryActions(disciplinaryEmployeeId);
    renderDisciplinaryList();
    showToast(
        'Medida Registrada!',
        `"${DISCIPLINARY_TYPE_LABEL[type]}" foi registrada para ${employees.find((e) => e.id === disciplinaryEmployeeId)?.name || 'o colaborador'}.`,
        'success'
    );
};

const LEAVE_STATUS_LABEL = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' };

let medicalLeavesEmployeeId = null;
let medicalLeaves = [];
let rejectingLeaveId = null;

async function fetchMedicalLeaves(employeeId) {
    const { data } = await sb
        .from('medical_leaves')
        .select('id,start_date,end_date,days,doctor_name,doctor_crm,cid,storage_path,status,rejection_reason')
        .eq('employee_id', employeeId)
        .order('start_date', { ascending: false });
    medicalLeaves = data || [];
}

function renderMedicalLeavesList() {
    const wrap = document.getElementById('medical-leaves-list');
    if (!wrap) return;
    if (!medicalLeaves.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhum atestado enviado ainda.</p>`;
        return;
    }
    wrap.innerHTML = medicalLeaves
        .map((l) => {
            const label = LEAVE_STATUS_LABEL[l.status] || l.status;
            const bits = [
                `${formatDateBR(l.start_date)} → ${formatDateBR(l.end_date)}`,
                `${l.days} dia${l.days > 1 ? 's' : ''}`,
                l.doctor_name ? `Dr(a). ${l.doctor_name}` : null,
                l.cid ? `CID ${l.cid}` : null,
            ].filter(Boolean);
            const attachBtn = l.storage_path
                ? `<button type="button" class="training-action-btn" data-click="viewLeaveAttachment" data-click-args="${dargs(l.id)}"><i class="fas fa-paperclip"></i> Atestado</button>`
                : '';
            let actions = attachBtn;
            if (l.status === 'pendente') {
                actions += `<button type="button" class="training-action-btn training-action-btn--approve" data-click="approveLeave" data-click-args="${dargs(l.id)}">Aprovar</button>
                    <button type="button" class="training-action-btn training-action-btn--reject" data-click="openRejectLeaveRow" data-click-args="${dargs(l.id)}">Recusar</button>`;
            }
            const rejection = l.status === 'recusado' && l.rejection_reason ? `<span class="leave-meta">Motivo: ${escapeHtml(l.rejection_reason)}</span>` : '';
            return `<div class="leave-item">
                <div class="leave-info">
                    <span class="leave-title">${escapeHtml(bits[0])}</span>
                    <span class="leave-meta">${bits.slice(1).map(escapeHtml).join(' · ')}</span>
                    ${rejection}
                </div>
                <div class="leave-badges">
                    <span class="leave-status-badge leave-status-badge--${l.status}">${label}</span>
                </div>
                <div class="leave-actions">${actions}</div>
            </div>`;
        })
        .join('');
}

window.handleOpenMedicalLeaves = async function () {
    const id = currentEmployeeId;
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    document.getElementById('drawer-dropdown')?.classList.remove('show');
    backToMainMenu();

    medicalLeavesEmployeeId = id;
    const nameEl = document.getElementById('ml-emp-name');
    if (nameEl) nameEl.textContent = emp.name;
    document.getElementById('medical-leaves-list').innerHTML = `<p class="performance-empty">Carregando…</p>`;
    document.getElementById('ml-reject-row')?.classList.add('hidden');
    rejectingLeaveId = null;
    document.getElementById('medical-leaves-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';

    await fetchMedicalLeaves(id);
    renderMedicalLeavesList();
};

window.closeMedicalLeavesModal = function () {
    document.getElementById('medical-leaves-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

window.viewLeaveAttachment = async function (id) {
    const leave = medicalLeaves.find((l) => l.id === id);
    if (!leave?.storage_path) return;
    await NexusFiles.open('documents', leave.storage_path, { name: 'Atestado' });
};

window.approveLeave = async function (id) {
    const { error } = await sb
        .from('medical_leaves')
        .update({ status: 'aprovado', reviewed_by_name: 'RH', reviewed_at: new Date().toISOString() })
        .eq('id', id);
    if (error) {
        showToast('Erro!', 'Não foi possível aprovar o atestado.', 'error');
        return;
    }
    await fetchMedicalLeaves(medicalLeavesEmployeeId);
    renderMedicalLeavesList();
    showToast('Atestado Aprovado!', 'O afastamento foi confirmado.', 'success');
};

window.openRejectLeaveRow = function (id) {
    rejectingLeaveId = id;
    document.getElementById('ml-reject-reason').value = '';
    document.getElementById('ml-reject-row')?.classList.remove('hidden');
};

window.cancelRejectLeave = function () {
    rejectingLeaveId = null;
    document.getElementById('ml-reject-row')?.classList.add('hidden');
};

window.confirmRejectLeave = async function () {
    const reason = document.getElementById('ml-reject-reason')?.value.trim();
    if (!reason) {
        showToast('Campo obrigatório', 'Informe o motivo da recusa.', 'warning');
        return;
    }
    const { error } = await sb
        .from('medical_leaves')
        .update({ status: 'recusado', rejection_reason: reason, reviewed_by_name: 'RH', reviewed_at: new Date().toISOString() })
        .eq('id', rejectingLeaveId);
    if (error) {
        showToast('Erro!', 'Não foi possível recusar o atestado.', 'error');
        return;
    }
    window.cancelRejectLeave();
    await fetchMedicalLeaves(medicalLeavesEmployeeId);
    renderMedicalLeavesList();
    showToast('Atestado Recusado!', 'O colaborador poderá reenviar, se necessário.', 'info');
};

const GOAL_STATUS_LABEL = { pendente: 'Pendente', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado' };

let performanceReviews = [];
let performanceGoals = [];

async function fetchPerformanceData(employeeId) {
    const [{ data: reviews }, { data: goals }] = await Promise.all([
        sb
            .from('performance_reviews')
            .select('id,cycle,status,overall_rating,manager_comment,created_at,completed_at')
            .eq('employee_id', employeeId)
            .order('created_at', { ascending: false }),
        sb.from('pdi_goals').select('id,title,description,due_date,status,created_at').eq('employee_id', employeeId).order('created_at', { ascending: false }),
    ]);
    performanceReviews = reviews || [];
    performanceGoals = goals || [];
}

function renderPerformanceReviews() {
    const wrap = document.getElementById('performance-reviews-list');
    if (!wrap) return;
    if (!performanceReviews.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhuma avaliação registrada ainda.</p>`;
        return;
    }
    wrap.innerHTML = performanceReviews
        .map((r) => {
            const stars = r.overall_rating ? '★'.repeat(r.overall_rating) + '☆'.repeat(5 - r.overall_rating) : '—';
            const statusLabel = r.status === 'concluida' ? 'Concluída' : 'Rascunho';
            return `<div class="performance-review-item">
                <div class="performance-review-info">
                    <span class="performance-review-cycle">${escapeHtml(r.cycle)}</span>
                    <span class="performance-review-meta">${stars} · ${formatDateBR(r.created_at.slice(0, 10))}</span>
                </div>
                <span class="review-status-badge review-status-badge--${r.status}">${statusLabel}</span>
            </div>`;
        })
        .join('');
}

function renderPerformanceGoals() {
    const wrap = document.getElementById('performance-goals-list');
    if (!wrap) return;
    if (!performanceGoals.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhuma meta de desenvolvimento cadastrada.</p>`;
        return;
    }
    wrap.innerHTML = performanceGoals
        .map((g) => {
            const label = GOAL_STATUS_LABEL[g.status] || g.status;
            const due = g.due_date ? ` · prazo ${formatDateBR(g.due_date)}` : '';
            return `<div class="pdi-goal-item">
                <div class="pdi-goal-info">
                    <span class="pdi-goal-title">${escapeHtml(g.title)}</span>
                    <span class="pdi-goal-meta">${label}${due}</span>
                </div>
                <span class="goal-status-badge goal-status-badge--${g.status}">${label}</span>
            </div>`;
        })
        .join('');
}

window.handleOpenPerformance = async function () {
    const id = currentEmployeeId;
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    document.getElementById('drawer-dropdown')?.classList.remove('show');
    backToMainMenu();

    const nameEl = document.getElementById('performance-emp-name');
    if (nameEl) nameEl.textContent = emp.name;
    const reviewsList = document.getElementById('performance-reviews-list');
    if (reviewsList) reviewsList.innerHTML = `<p class="performance-empty">Carregando…</p>`;
    const goalsList = document.getElementById('performance-goals-list');
    if (goalsList) goalsList.innerHTML = '';
    document.getElementById('performance-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';

    await fetchPerformanceData(id);
    renderPerformanceReviews();
    renderPerformanceGoals();
};

window.closePerformanceModal = function () {
    document.getElementById('performance-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

window.editEmployee = function (id) {
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    toggleForm();

    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector('.tab-btn[onclick*="tab-obrigatorios"]')?.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    document.getElementById('tab-obrigatorios')?.classList.add('active');

    setFormHeader('fa-edit', 'Editar Colaborador');
    document.getElementById('employee-id').value = emp.id;
    document.getElementById('name').value = emp.name || '';
    populateRoleDropdown('role-popover', emp.role || '');
    roleField?.setValue(emp.role || '');
    document.getElementById('cpf').value = emp.cpf || '';
    document.getElementById('email').value = emp.email || '';
    setDateFieldValue(document.getElementById('admission-date'), emp.admissionDate || '');
    document.getElementById('contract-type').value = emp.contractType || '';
    document.getElementById('salary-type').value = emp.salaryType || '';
    document.getElementById('work-load').value = emp.workLoad || '';
    document.getElementById('dept').value = emp.dept || '';
    populateManagerSelect(emp.id);
    if (document.getElementById('manager-id')) document.getElementById('manager-id').value = emp.managerId || '';
    const salaryRaw = emp.salary || 0;
    document.getElementById('salary').value =
        'R$ ' +
        salaryRaw
            .toFixed(2)
            .replace('.', ',')
            .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (document.getElementById('rg')) document.getElementById('rg').value = emp.rg || '';
    if (document.getElementById('telefone')) document.getElementById('telefone').value = emp.telefone || '';
    if (document.getElementById('raca-cor')) document.getElementById('raca-cor').value = emp.racaCor || '';
    if (emp.gender) {
        const genderRadio = document.querySelector(`input[name="sexo"][value="${emp.gender}"]`);
        if (genderRadio) genderRadio.checked = true;
    }
    restoreConditionalField('em-experiencia', emp.isProbation, 'experiencia-details');
    if (emp.isProbation === 'sim') setDateFieldValue(document.getElementById('probation-end-date'), emp.probationEndDate || '');
    restoreConditionalField('em-aviso-previo', emp.isAvisoPrevio, 'aviso-previo-details');
    if (emp.isAvisoPrevio === 'sim') setDateFieldValue(document.getElementById('aviso-previo-end-date'), emp.avisoPrevioEndDate || '');
    restoreConditionalField('seguro-vida', emp.seguroVida, 'seguro-vida-details');
    if (emp.seguroVida === 'sim' && document.getElementById('seguradora')) document.getElementById('seguradora').value = emp.seguradora || '';
    restoreConditionalField('possui-dependentes', emp.possuiDependentes, 'dependentes-details');
    if (emp.possuiDependentes === 'sim' && document.getElementById('qtd-dependentes'))
        document.getElementById('qtd-dependentes').value = emp.qtdDependentes || '';
    restoreConditionalField('pcd', emp.pcd, 'pcd-details');
    if (emp.pcd === 'sim' && document.getElementById('tipo-deficiencia')) document.getElementById('tipo-deficiencia').value = emp.deficiencia || '';
    restoreConditionalField('pensao-alimenticia', emp.pensaoAlimenticia, 'pensao-details');
    if (emp.pensaoAlimenticia === 'sim' && emp.tipoPensao) {
        const r = document.querySelector(`input[name="tipo-pensao"][value="${emp.tipoPensao}"]`);
        if (r) r.checked = true;
    }
    restoreConditionalField('vale-transporte', emp.valeTransporte, 'vale-transporte-details');
    if (emp.valeTransporte === 'sim') {
        if (document.getElementById('valor-passagem')) document.getElementById('valor-passagem').value = emp.valorPassagem || '';
        if (document.getElementById('conducoes-dia')) document.getElementById('conducoes-dia').value = emp.conducoesdia || '';
    }
    if (document.getElementById('ben-vale-refeicao')) document.getElementById('ben-vale-refeicao').value = emp.valeRefeicao || '';
    if (document.getElementById('ben-vale-alimentacao')) document.getElementById('ben-vale-alimentacao').value = emp.valeAlimentacao || '';
    if (emp.formaPagamento) {
        const r = document.querySelector(`input[name="forma-pagamento"][value="${emp.formaPagamento}"]`);
        if (r) {
            r.checked = true;
            r.dispatchEvent(new Event('change'));
        }
        if (emp.formaPagamento === 'pix') {
            if (document.getElementById('tipo-chave-pix')) document.getElementById('tipo-chave-pix').value = emp.tipoChavePix || '';
            if (document.getElementById('chave-pix')) document.getElementById('chave-pix').value = emp.chavePix || '';
        } else if (emp.formaPagamento === 'conta') {
            const bancoSelect = document.getElementById('banco');
            if (bancoSelect) {
                const opts = Array.from(bancoSelect.options).map((o) => o.value);
                if (opts.includes(emp.banco)) {
                    bancoSelect.value = emp.banco;
                } else {
                    bancoSelect.value = 'outro';
                    bancoSelect.dispatchEvent(new Event('change'));
                    if (document.getElementById('banco-outro')) document.getElementById('banco-outro').value = emp.banco || '';
                }
            }
            if (document.getElementById('tipo-conta')) document.getElementById('tipo-conta').value = emp.tipoConta || '';
            if (document.getElementById('agencia')) document.getElementById('agencia').value = emp.agencia || '';
            if (document.getElementById('conta')) document.getElementById('conta').value = emp.conta || '';
        }
    }
    updateSaveButton();
};

function goToStep(step) {
    const currentPanel = document.getElementById('step-panel-' + currentStep);
    if (currentPanel) {
        currentPanel.classList.add('hidden');
        currentPanel.classList.remove('active');
    }
    const currentStepEl = document.querySelector('[data-step="' + currentStep + '"]');
    if (currentStepEl) {
        currentStepEl.classList.remove('active');
        if (step > currentStep) currentStepEl.classList.add('completed');
        else currentStepEl.classList.remove('completed');
    }
    currentStep = step;
    const newPanel = document.getElementById('step-panel-' + currentStep);
    if (newPanel) {
        newPanel.classList.remove('hidden');
        newPanel.classList.add('active');
    }
    const newStepEl = document.querySelector('[data-step="' + currentStep + '"]');
    if (newStepEl) newStepEl.classList.add('active');
    const btnPrev = document.getElementById('btn-prev-step');
    const btnNext = document.getElementById('btn-next-step');
    const btnSave = document.getElementById('btn-save');
    if (btnPrev) btnPrev.textContent = currentStep > 1 ? 'Voltar' : 'Cancelar';
    if (btnNext) btnNext.style.display = currentStep < totalSteps ? 'inline-flex' : 'none';
    if (btnSave) {
        btnSave.style.display = currentStep === totalSteps ? 'inline-flex' : 'none';
        updateSaveButton();
    }
}

window.handleNextStep = function () {
    if (currentStep < totalSteps) goToStep(currentStep + 1);
};
window.handlePrevStep = function () {
    if (currentStep > 1) goToStep(currentStep - 1);
};
window.handleCancelOrBack = function () {
    currentStep > 1 ? handlePrevStep() : toggleForm();
};

function resetStepper() {
    document.querySelectorAll('.step-panel').forEach((p) => {
        p.classList.add('hidden');
        p.classList.remove('active');
    });
    document.querySelectorAll('.step').forEach((s) => s.classList.remove('active', 'completed'));
    currentStep = 1;
    const firstPanel = document.getElementById('step-panel-1');
    if (firstPanel) {
        firstPanel.classList.remove('hidden');
        firstPanel.classList.add('active');
    }
    document.querySelector('[data-step="1"]')?.classList.add('active');
    const btnPrev = document.getElementById('btn-prev-step');
    if (btnPrev) {
        btnPrev.style.display = 'inline-flex';
        btnPrev.textContent = 'Cancelar';
    }
    document.getElementById('btn-next-step') && (document.getElementById('btn-next-step').style.display = 'inline-flex');
    document.getElementById('btn-save') && (document.getElementById('btn-save').style.display = 'none');
}

function updateSaveButton() {
    const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input[required], #tab-obrigatorios select[required]');
    const allFilled = Array.from(mandatoryFields).every((field) => field.value.trim() !== '');
    const isEditing = !!document.getElementById('employee-id').value;
    const label = isEditing ? 'Salvar Alterações' : 'Cadastrar';
    const btnSimple = document.getElementById('btn-save-simple');
    if (btnSimple) {
        btnSimple.disabled = !allFilled;
        btnSimple.style.opacity = allFilled ? '1' : '0.5';
        btnSimple.style.cursor = allFilled ? 'pointer' : 'not-allowed';
        btnSimple.innerHTML = label;
    }
    const btnStepper = document.getElementById('btn-save');
    if (btnStepper) {
        btnStepper.disabled = false;
        btnStepper.style.opacity = '1';
        btnStepper.style.cursor = 'pointer';
        btnStepper.innerHTML = label;
    }
}

function setupValidationListeners() {
    document.querySelectorAll('#tab-obrigatorios input, #tab-obrigatorios select').forEach((f) => {
        f.addEventListener('input', updateSaveButton);
        f.addEventListener('change', updateSaveButton);
    });
    updateSaveButton();
}

function setupConditionalFields() {
    setupToggleField('em-experiencia', 'sim', 'experiencia-details');
    setupToggleField('em-aviso-previo', 'sim', 'aviso-previo-details');
    setupToggleField('seguro-vida', 'sim', 'seguro-vida-details');
    setupToggleField('possui-dependentes', 'sim', 'dependentes-details');
    setupToggleField('pcd', 'sim', 'pcd-details');
    setupToggleField('pensao-alimenticia', 'sim', 'pensao-details');
    setupToggleField('vale-transporte', 'sim', 'vale-transporte-details');
    setupPaymentMethodToggle();
    setupBancoOutroToggle();
}

function setupToggleField(radioName, triggerValue, detailsId) {
    document.querySelectorAll(`input[name="${radioName}"]`).forEach((radio) => {
        radio.addEventListener('change', () => {
            const details = document.getElementById(detailsId);
            if (!details) return;
            const checked = document.querySelector(`input[name="${radioName}"]:checked`);
            if (checked?.value === triggerValue) {
                details.style.display = 'block';
                details.classList.add('conditional-visible');
            } else {
                details.style.display = 'none';
                details.classList.remove('conditional-visible');
                details.querySelectorAll('input, select, textarea').forEach((f) => (f.value = ''));
            }
        });
    });
}

function setupPaymentMethodToggle() {
    document.querySelectorAll('input[name="forma-pagamento"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            const pixDetails = document.getElementById('pix-details');
            const contaDetails = document.getElementById('conta-details');
            if (!pixDetails || !contaDetails) return;
            const checked = document.querySelector('input[name="forma-pagamento"]:checked');
            if (checked?.value === 'pix') {
                pixDetails.style.display = 'block';
                contaDetails.style.display = 'none';
                contaDetails.querySelectorAll('input, select').forEach((f) => (f.value = ''));
            } else if (checked?.value === 'conta') {
                pixDetails.style.display = 'none';
                contaDetails.style.display = 'block';
                pixDetails.querySelectorAll('input, select').forEach((f) => (f.value = ''));
            } else {
                pixDetails.style.display = 'none';
                contaDetails.style.display = 'none';
            }
        });
    });
}

function setupDeselectableRadios() {
    document.querySelectorAll('.radio-group input[type="radio"]').forEach((radio) => {
        radio.addEventListener('mousedown', function () {
            this.dataset.wasChecked = String(this.checked);
        });
        radio.addEventListener('click', function () {
            if (this.dataset.wasChecked === 'true') {
                this.checked = false;
                this.dataset.wasChecked = 'false';
                this.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    });
}

function setupBancoOutroToggle() {
    const bancoSelect = document.getElementById('banco');
    if (!bancoSelect) return;
    bancoSelect.addEventListener('change', () => {
        const bancoOutroDiv = document.getElementById('banco-outro-details');
        if (!bancoOutroDiv) return;
        bancoOutroDiv.style.display = bancoSelect.value === 'outro' ? 'block' : 'none';
        if (bancoSelect.value !== 'outro') {
            const input = bancoOutroDiv.querySelector('input');
            if (input) input.value = '';
        }
    });
}

function resetConditionalFields() {
    [
        'experiencia-details',
        'aviso-previo-details',
        'seguro-vida-details',
        'dependentes-details',
        'pcd-details',
        'pensao-details',
        'vale-transporte-details',
        'pix-details',
        'conta-details',
        'banco-outro-details',
    ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = 'none';
            el.classList.remove('conditional-visible');
            el.querySelectorAll('input, select, textarea').forEach((f) => (f.value = ''));
        }
    });
}

function restoreConditionalField(radioName, value, detailsId) {
    if (!value) return;
    const radio = document.querySelector(`input[name="${radioName}"][value="${value}"]`);
    if (radio) {
        radio.checked = true;
        const details = document.getElementById(detailsId);
        if (details) details.style.display = value === 'sim' ? 'block' : 'none';
    }
}

function setupSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const topbarMenuBtn = document.getElementById('topbar-menu-btn');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    const isMobile = () => window.innerWidth <= 768;
    toggleBtn &&
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isMobile()) {
                sidebar.classList.toggle('open');
                overlay && overlay.classList.toggle('active', sidebar.classList.contains('open'));
            } else {
                sidebar.classList.toggle('collapsed');
                document.querySelector('.main-wrapper')?.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
            }
        });
    topbarMenuBtn &&
        topbarMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('open');
            overlay && overlay.classList.toggle('active', sidebar.classList.contains('open'));
        });
    overlay &&
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    window.addEventListener('resize', () => {
        if (!isMobile()) {
            sidebar.classList.remove('open');
            overlay && overlay.classList.remove('active');
        }
    });
}

function setupCpfMask() {
    const input = document.getElementById('cpf');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        v = v
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        e.target.value = v;
    });
}

function setupRgMask() {
    const input = document.getElementById('rg');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.toUpperCase().replace(/[^0-9X]/g, '');
        if (v.length > 9) v = v.slice(0, 9);
        if (v.length > 8) v = v.replace(/^(\d{2})(\d{3})(\d{3})([0-9X])/, '$1.$2.$3-$4');
        else if (v.length > 5) v = v.replace(/^(\d{2})(\d{3})(\d+)/, '$1.$2.$3');
        else if (v.length > 2) v = v.replace(/^(\d{2})(\d+)/, '$1.$2');
        e.target.value = v;
    });
}

function setupPhoneMask() {
    const input = document.getElementById('telefone');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        if (v.length === 0) e.target.value = '';
        else if (v.length <= 2) e.target.value = `(${v}`;
        else if (v.length <= 7) e.target.value = `(${v.slice(0, 2)}) ${v.slice(2)}`;
        else e.target.value = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
    });
}

function setupAgenciaMask() {
    const input = document.getElementById('agencia');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 4) v = v.slice(0, 4);
        e.target.value = v;
    });
}

function setupContaMask() {
    const input = document.getElementById('conta');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.toUpperCase().replace(/[^0-9X]/g, '');
        if (v.length > 7) v = v.slice(0, 7);
        e.target.value = v.length <= 5 ? v : `${v.slice(0, 5)}-${v.slice(5)}`;
    });
}

function setupCepMask() {
    const input = document.getElementById('cep');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 8) v = v.slice(0, 8);
        if (v.length > 5) v = `${v.slice(0, 5)}-${v.slice(5)}`;
        e.target.value = v;
    });
}

function setupCepListener() {
    const input = document.getElementById('cep');
    if (!input) return;
    input.addEventListener('blur', (e) => window.pesquisacep(e.target.value));
}

function setupSalaryMask() {
    ['salary', 'rem-salario', 'promote-salary', 'jt-add-salary-min', 'jt-add-salary-max'].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.type = 'text';
        input.inputMode = 'numeric';
        input.addEventListener('input', (e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v.length) {
                e.target.value = '';
                return;
            }
            const num = (parseInt(v, 10) / 100).toFixed(2);
            e.target.value = 'R$ ' + num.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        });
    });
}

function setupPisPasepMask() {
    const input = document.getElementById('pis-pasep');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        if (v.length <= 3) e.target.value = v;
        else if (v.length <= 8) e.target.value = `${v.slice(0, 3)}.${v.slice(3)}`;
        else if (v.length <= 10) e.target.value = `${v.slice(0, 3)}.${v.slice(3, 8)}.${v.slice(8)}`;
        else e.target.value = `${v.slice(0, 3)}.${v.slice(3, 8)}.${v.slice(8, 10)}-${v.slice(10)}`;
    });
}

function setupCurrencyMask(id) {
    const input = document.getElementById(id);
    if (!input) return;
    input.type = 'text';
    input.inputMode = 'numeric';
    input.addEventListener('input', (e) => {
        const v = e.target.value.replace(/\D/g, '');
        if (!v.length) {
            e.target.value = '';
            return;
        }
        const num = (parseInt(v, 10) / 100).toFixed(2);
        e.target.value = 'R$ ' + num.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    });
}

window.pesquisacep = async function (valor) {
    const cep = valor.replace(/\D/g, '');
    if (cep.length !== 8) return;
    try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();
        if (!data.erro) {
            document.getElementById('logradouro').value = data.logradouro || '';
            document.getElementById('bairro').value = data.bairro || '';
            document.getElementById('cidade').value = data.localidade || '';
            document.getElementById('uf').value = data.uf || '';
            document.getElementById('numero')?.focus();
        } else {
            showToast('CEP não encontrado!', 'Verifique o CEP informado.', 'warning');
        }
    } catch {
        showToast('CEP não encontrado!', 'Verifique o CEP informado.', 'warning');
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    orgDeptField = createSelectField('orgchart-dept-filter', () => renderOrgChart());
    roleField = createSelectField('role');
    promoteRoleField = createSelectField('promote-role', updatePromoteBtnState);
    trAssignCatalogField = createSelectField('tr-assign-catalog');
    daTypeField = createSelectField('da-type', () => {
        document.getElementById('da-suspension-days')?.classList.toggle('hidden', document.getElementById('da-type')?.value !== 'suspensao');
    });
    await loadRhSidebar();
    await fetchEmployees();
    await fetchJobTitlesPublic();
    await fetchTrainingsCatalogPublic();
    await fetchExpiringDocuments();
    await fetchAdmissionalDocTypes();
    document.getElementById('contract-type')?.addEventListener('change', () => {
        renderRegDocTypeList();
        renderRegDocList();
    });
    populateDeptFilterOptions();
    renderTable(employees);
    renderAlertsBanner();

    const deepLinkEmpId = new URLSearchParams(location.search).get('emp');
    if (deepLinkEmpId) openDrawer(deepLinkEmpId);
    renderStatsRow();
    setupFormListener();
    setupFilters();
    setupExportDropdown();
    setupCepListener();
    setupCpfMask();
    setupRgMask();
    setupPhoneMask();
    setupAgenciaMask();
    setupContaMask();
    setupCepMask();
    setupSalaryMask();
    setupPisPasepMask();
    setupCurrencyMask('rem-hora-extra');
    setupCurrencyMask('ben-vale-refeicao');
    setupCurrencyMask('ben-vale-alimentacao');
    setupCurrencyMask('valor-passagem');
    setupValidationListeners();
    setupConditionalFields();
    setupDeselectableRadios();
    setupSidebarToggle();
    setupRealtimeSync();
    setupDocumentsAlertSync();
    setupImportDropzone();
    setupDateFields();

    document.getElementById('drawer-dropdown')?.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => closeDropdownMenu());
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDropdownMenu();
            closeDrawer();
            closeAuditHistoryModal();
            closeOrgChart();
        }
    });

    resetStepper();
});
