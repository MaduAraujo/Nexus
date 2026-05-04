// ─── State ───────────────────────────────────────────────────
let employees = [];
let currentEmployeeId = null; // UUID string
let currentStep = 1;
const totalSteps = 6;

// ─── Data mappers (DB snake_case ↔ JS camelCase) ─────────────

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
        salary: row.salary,
        status: row.status,
        terminationDate: row.termination_date,
        seguroVida: row.seguro_vida ? 'sim' : 'nao',
        seguradora: row.seguradora,
        possuiDependentes: row.possui_dependentes ? 'sim' : 'nao',
        qtdDependentes: row.qtd_dependentes,
        pcd: row.pcd ? 'sim' : 'nao',
        deficiencia: row.deficiencia,
        pensaoAlimenticia: row.pensao_alimenticia ? 'sim' : 'nao',
        tipoPensao: row.tipo_pensao,
        valeTransporte: row.vale_transporte ? 'sim' : 'nao',
        valorPassagem: row.valor_passagem,
        conducoesdia: row.conducoes_dia,
        formaPagamento: row.forma_pagamento,
        tipoChavePix: row.tipo_chave_pix,
        chavePix: row.chave_pix,
        banco: row.banco,
        tipoConta: row.tipo_conta,
        agencia: row.agencia,
        conta: row.conta,
        avatarColor: row.avatar_color,
        lastAccess: row.last_access,
        authUserId: row.auth_user_id,
    };
}

function employeeToDb(emp) {
    const parseVal = (v) => v ? parseFloat(String(v).replace(/[R$\s.]/g, '').replace(',', '.')) || null : null;
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
        salary: emp.salary || null,
        status: emp.status || 'Ativo',
        termination_date: emp.terminationDate || null,
        seguro_vida: emp.seguroVida === 'sim',
        seguradora: emp.seguroVida === 'sim' ? (emp.seguradora || null) : null,
        possui_dependentes: emp.possuiDependentes === 'sim',
        qtd_dependentes: emp.possuiDependentes === 'sim' ? (parseInt(emp.qtdDependentes) || null) : null,
        pcd: emp.pcd === 'sim',
        deficiencia: emp.pcd === 'sim' ? (emp.deficiencia || null) : null,
        pensao_alimenticia: emp.pensaoAlimenticia === 'sim',
        tipo_pensao: emp.pensaoAlimenticia === 'sim' ? (emp.tipoPensao || null) : null,
        vale_transporte: emp.valeTransporte === 'sim',
        valor_passagem: emp.valeTransporte === 'sim' ? parseVal(emp.valorPassagem) : null,
        conducoes_dia: emp.valeTransporte === 'sim' ? (parseInt(emp.conducoesdia) || null) : null,
        forma_pagamento: emp.formaPagamento || null,
        tipo_chave_pix: emp.formaPagamento === 'pix' ? (emp.tipoChavePix || null) : null,
        chave_pix: emp.formaPagamento === 'pix' ? (emp.chavePix || null) : null,
        banco: emp.formaPagamento === 'conta' ? (emp.banco || null) : null,
        tipo_conta: emp.formaPagamento === 'conta' ? (emp.tipoConta || null) : null,
        agencia: emp.formaPagamento === 'conta' ? (emp.agencia || null) : null,
        conta: emp.formaPagamento === 'conta' ? (emp.conta || null) : null,
        avatar_color: emp.avatarColor || getRandomAvatarColor(),
    };
}

// ─── Supabase helpers ────────────────────────────────────────

async function fetchEmployees() {
    const { data, error } = await sb.from('employees')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) { console.error('[Nexus] fetchEmployees:', error); return; }
    employees = (data || []).map(dbToEmployee);
}

async function inviteEmployee(email) {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-employee`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
            email,
            redirectTo: new URL('login.html', window.location.href).href,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao enviar convite');
    }
    return res.json();
}

async function logEmployeeEdit(empId, empName, changes) {
    if (!changes.length) return;
    const { data: { user } } = await sb.auth.getUser();
    await sb.from('employee_audit').insert({
        employee_id: empId,
        changes,
        operator_name: user?.email?.split('@')[0] || 'RH',
        operator_email: user?.email || '',
    });
}

// ─── Realtime ─────────────────────────────────────────────────

function setupRealtimeSync() {
    sb.channel('employees-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, async () => {
            await fetchEmployees();
            const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
            applyStatusFilter(activeFilter);
            updateCount();
        })
        .subscribe();
}

// ─── Session ─────────────────────────────────────────────────

async function loadRhSidebar() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles')
        .select('profile')
        .eq('id', user.id)
        .single();

    if (profile?.profile !== 'rh') { window.location.href = '../screens/login.html'; return; }

    const nameEl   = document.getElementById('rh-sidebar-name');
    const roleEl   = document.getElementById('rh-sidebar-role');
    const avatarEl = document.getElementById('rh-sidebar-avatar');
    if (!nameEl) return;

    const displayName = user.email?.split('@')[0] || 'Administrador';
    const initials = displayName.slice(0, 2).toUpperCase();
    nameEl.textContent = displayName;
    if (roleEl)   roleEl.textContent   = 'Recursos Humanos';
    if (avatarEl) avatarEl.textContent = initials;
}

async function logout() {
    await sb.auth.signOut();
    window.location.href = '../screens/login.html';
}

// ─── Utilities ────────────────────────────────────────────────

function getRandomAvatarColor() {
    const colors = ['#6366f1','#8b5cf6','#ec4899','#10b981','#f59e0b','#3b82f6','#ef4444','#06b6d4','#84cc16','#f97316'];
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
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${title}</p>
            <p class="toast-msg">${msg}</p>
        </div>
        <button class="toast-close" onclick="this.closest('.toast').classList.add('hide'); setTimeout(() => this.closest('.toast').remove(), 400);">
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

const getBadgeClass = (status) => ({ 'Ativo': 'badge-ativo', 'Inativo': 'badge-inativo', 'Férias': 'badge-ferias' }[status] || '');

// ─── Table / Filters ──────────────────────────────────────────

function updateCount() {
    const countElement = document.getElementById('employee-count');
    if (!countElement) return;
    const visibleRows = document.querySelectorAll('#employee-list-body tr:not(#empty-row)').length;
    if      (visibleRows === 0) countElement.textContent = 'Nenhum colaborador encontrado';
    else if (visibleRows === 1) countElement.textContent = '1 colaborador encontrado';
    else                        countElement.textContent = `${visibleRows} colaboradores encontrados`;
}

let searchToastTimeout = null;

window.filterTable = function () {
    const input        = document.getElementById('search-input');
    const clearBtn     = document.getElementById('search-clear');
    const query        = input.value.toLowerCase().trim();
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    if (clearBtn) clearBtn.classList.toggle('hidden', query.length === 0);
    let filtered = getFilteredByStatus(activeFilter);
    if (query) {
        filtered = filtered.filter(e =>
            e.name?.toLowerCase().includes(query) ||
            e.dept?.toLowerCase().includes(query) ||
            e.cpf?.includes(query)
        );
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
    const input    = document.getElementById('search-input');
    const clearBtn = document.getElementById('search-clear');
    if (input)    input.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
    clearTimeout(searchToastTimeout);
    filterTable();
};

function getFilteredByStatus(filter) {
    if (filter === 'ativos')   return employees.filter(e => e.status === 'Ativo');
    if (filter === 'inativos') return employees.filter(e => e.status === 'Inativo');
    if (filter === 'ferias')   return employees.filter(e => e.status === 'Férias');
    return employees;
}

function setupFilters() {
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            clearSearch();
            applyStatusFilter(btn.getAttribute('data-filter'));
        });
    });
}

function applyStatusFilter(filter) {
    renderTable(getFilteredByStatus(filter), filter);
}

const EMPTY_STATES = {
    todos:    { icon: 'fa-users-slash',    title: 'Nenhum colaborador cadastrado',  sub: 'Clique em "Novo Colaborador" para começar' },
    ativos:   { icon: 'fa-user-check',     title: 'Nenhum colaborador ativo',       sub: '' },
    inativos: { icon: 'fa-user-times',     title: 'Nenhum colaborador inativo',     sub: '' },
    ferias:   { icon: 'fa-umbrella-beach', title: 'Nenhum colaborador de férias',   sub: '' },
};

function renderTable(data, filter) {
    const tbody = document.getElementById('employee-list-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (data.length === 0) {
        const activeFilter = filter || document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
        const es = EMPTY_STATES[activeFilter] || EMPTY_STATES.todos;
        tbody.innerHTML = `
            <tr class="empty-row" id="empty-row">
                <td colspan="6">
                    <div class="empty-state">
                        <i class="fas ${es.icon}"></i>
                        <p>${es.title}</p>
                        ${es.sub ? `<span>${es.sub}</span>` : ''}
                    </div>
                </td>
            </tr>`;
        updateCount();
        return;
    }
    data.forEach((emp, index) => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = () => window.openDrawer(emp.id);
        tr.innerHTML = `
            <td>#${index + 1}</td>
            <td><strong>${emp.name}</strong></td>
            <td><span class="badge ${getBadgeClass(emp.status)}">${emp.status}</span></td>
            <td>${emp.dept || '-'}</td>
            <td>${emp.role || '-'}</td>
            <td>${formatDateBR(emp.admissionDate)}</td>`;
        tbody.appendChild(tr);
    });
    updateCount();
}

// ─── Drawer ───────────────────────────────────────────────────

window.openDrawer = function (id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    currentEmployeeId = emp.id;
    document.getElementById('view-name').textContent     = emp.name;
    document.getElementById('view-role').textContent     = emp.role          || '-';
    document.getElementById('view-dept').textContent     = emp.dept          || '-';
    document.getElementById('view-salary').textContent   = formatCurrency(emp.salary);
    document.getElementById('view-date').textContent     = formatDateBR(emp.admissionDate);
    document.getElementById('view-contract').textContent = emp.contractType  || '-';
    document.getElementById('view-email').textContent    = emp.email         || '-';
    const statusBadge = document.getElementById('view-status');
    if (statusBadge) {
        statusBadge.textContent = emp.status;
        statusBadge.className   = `badge ${getBadgeClass(emp.status)}`;
    }
    document.getElementById('employee-drawer').classList.add('active');
    document.getElementById('drawer-overlay').classList.add('active');
};

window.closeDrawer = function () {
    document.getElementById('employee-drawer').classList.remove('active');
    document.getElementById('drawer-overlay').classList.remove('active');
    document.getElementById('drawer-dropdown').classList.remove('show');
    backToMainMenu();
};

window.toggleDropdown = function (event) {
    event.stopPropagation();
    document.getElementById('drawer-dropdown').classList.toggle('show');
};

window.showStatusSubmenu = function () {
    const emp = employees.find(e => e.id === currentEmployeeId);
    if (!emp) return;
    const mainMenu       = document.getElementById('main-menu-options');
    const submenu        = document.getElementById('status-submenu-options');
    const dynamicOptions = document.getElementById('dynamic-status-options');
    dynamicOptions.innerHTML = '';
    if (emp.status === 'Ativo') {
        dynamicOptions.innerHTML += `<a href="#" onclick="updateStatus('Inativo')"><i class="fas fa-user-slash"></i> Inativo</a>`;
        dynamicOptions.innerHTML += `<a href="#" onclick="updateStatus('Férias')"><i class="fas fa-umbrella-beach"></i> Férias</a>`;
    }
    if (emp.status === 'Férias') {
        dynamicOptions.innerHTML += `<a href="#" onclick="updateStatus('Ativo')"><i class="fas fa-check"></i> Voltar das Férias</a>`;
    }
    if (emp.status === 'Inativo') {
        dynamicOptions.innerHTML = '<div style="padding:10px 16px;font-size:12px;color:#999;">Status Inativo é permanente.</div>';
    }
    mainMenu.classList.add('hidden');
    submenu.classList.remove('hidden');
};

window.backToMainMenu = function () {
    document.getElementById('main-menu-options')?.classList.remove('hidden');
    document.getElementById('status-submenu-options')?.classList.add('hidden');
};

window.updateStatus = async function (newStatus) {
    const index = employees.findIndex(e => e.id === currentEmployeeId);
    if (index === -1) return;

    const updateData = { status: newStatus };
    if (newStatus === 'Inativo' && !employees[index].terminationDate) {
        updateData.termination_date = new Date().toISOString().split('T')[0];
    }

    const { error } = await sb.from('employees').update(updateData).eq('id', currentEmployeeId);
    if (error) { showToast('Erro!', 'Não foi possível atualizar o status.', 'error'); return; }

    if (newStatus === 'Inativo') {
        await sb.from('vacations')
            .update({ status: 'recusado', rejection_reason: 'Colaborador inativado pelo RH.', rejected_at: new Date().toISOString() })
            .eq('employee_id', currentEmployeeId)
            .eq('status', 'pendente');
    }

    employees[index].status = newStatus;
    if (updateData.termination_date) employees[index].terminationDate = updateData.termination_date;

    openDrawer(currentEmployeeId);
    document.getElementById('drawer-dropdown').classList.remove('show');
    setTimeout(backToMainMenu, 300);
    const msgs = { 'Ativo': 'Colaborador marcado como Ativo.', 'Inativo': 'Colaborador marcado como Inativo.', 'Férias': 'Colaborador marcado como em Férias.' };
    showToast('Status Atualizado!', msgs[newStatus] || `Status: ${newStatus}`, 'success');
};

window.handleDeleteEmployee = async function () {
    const emp = employees.find(e => e.id === currentEmployeeId);
    if (!emp) return;
    if (!confirm(`Tem certeza que deseja excluir ${emp.name}?\n\nO acesso ao sistema também será removido.`)) return;
    const { error } = await sb.from('employees').delete().eq('id', currentEmployeeId);
    if (error) { showToast('Erro!', 'Não foi possível excluir o colaborador.', 'error'); return; }
    employees = employees.filter(e => e.id !== currentEmployeeId);
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    applyStatusFilter(activeFilter);
    closeDrawer();
    showToast('Colaborador Excluído!', 'O colaborador foi removido do sistema.', 'error');
};

window.addEventListener('click', (event) => {
    if (!event.target.closest('.dropdown')) {
        document.getElementById('drawer-dropdown')?.classList.remove('show');
        backToMainMenu();
    }
});

// ─── Form ─────────────────────────────────────────────────────

window.switchTab = function (event, tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
    else document.querySelector(`[onclick*="${tabId}"]`)?.classList.add('active');
    document.getElementById(tabId)?.classList.add('active');
};

window.toggleForm = function () {
    const formContainer = document.getElementById('form-container');
    const listSection   = document.getElementById('list-section');
    const contentHeader = document.getElementById('content-header');
    const form          = document.getElementById('employee-form');
    if (formContainer && formContainer.classList.contains('hidden')) {
        formContainer.classList.remove('hidden');
        listSection?.classList.add('hidden');
        contentHeader?.classList.add('hidden');
        resetStepper();
        resetConditionalFields();
    } else {
        formContainer?.classList.add('hidden');
        listSection?.classList.remove('hidden');
        contentHeader?.classList.remove('hidden');
        form?.reset();
        document.getElementById('employee-id').value = '';
        document.getElementById('form-title').innerHTML = '<i class="fas fa-user-plus"></i> Novo Colaborador';
        const btnSimple  = document.getElementById('btn-save-simple');
        const btnStepper = document.getElementById('btn-save');
        if (btnSimple)  btnSimple.innerHTML  = '<i class="fas fa-check"></i> Cadastrar';
        if (btnStepper) btnStepper.innerHTML = '<i class="fas fa-check"></i> Cadastrar';
        resetStepper();
        resetConditionalFields();
    }
};

function setupFormListener() {
    const form = document.getElementById('employee-form');
    if (!form) return;
    document.getElementById('btn-save')?.addEventListener('click', () =>
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    );
    document.getElementById('btn-save-simple')?.addEventListener('click', () =>
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    );

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const idField = document.getElementById('employee-id').value;

        const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input[required], #tab-obrigatorios select[required]');
        if (!Array.from(mandatoryFields).every(f => f.value.trim() !== '')) {
            showToast('Campos Obrigatórios!', 'Preencha todos os campos obrigatórios.', 'warning');
            return;
        }

        const cpfDigitado = document.getElementById('cpf').value.trim();
        if (!isValidCPF(cpfDigitado)) { showToast('CPF Inválido!', 'Verifique o CPF informado.', 'error'); return; }

        const emailDigitado = document.getElementById('email').value.trim().toLowerCase();

        const cpfDuplicado  = employees.some(emp => emp.cpf === cpfDigitado && emp.id !== idField);
        if (cpfDuplicado)  { showToast('CPF Duplicado!',   'Já existe um colaborador com este CPF.',   'error'); return; }
        const emailDuplicado = employees.some(emp => emp.email.toLowerCase() === emailDigitado && emp.id !== idField);
        if (emailDuplicado) { showToast('Email Duplicado!', 'Já existe um colaborador com este email.', 'error'); return; }

        const seguroVida        = document.querySelector('input[name="seguro-vida"]:checked')?.value        || 'nao';
        const possuiDependentes = document.querySelector('input[name="possui-dependentes"]:checked')?.value || 'nao';
        const pcd               = document.querySelector('input[name="pcd"]:checked')?.value               || 'nao';
        const pensaoAlimenticia = document.querySelector('input[name="pensao-alimenticia"]:checked')?.value || 'nao';
        const valeTransporte    = document.querySelector('input[name="vale-transporte"]:checked')?.value    || 'nao';
        const formaPagamento    = document.querySelector('input[name="forma-pagamento"]:checked')?.value    || '';
        const bancoValue        = document.getElementById('banco')?.value || '';
        const bancoNome         = bancoValue === 'outro' ? (document.getElementById('banco-outro')?.value || '') : bancoValue;

        const empData = {
            name: document.getElementById('name').value.trim(),
            role: document.getElementById('role').value.trim(),
            cpf: cpfDigitado,
            rg: document.getElementById('rg')?.value || '',
            telefone: document.getElementById('telefone')?.value || '',
            email: emailDigitado,
            admissionDate: document.getElementById('admission-date').value,
            contractType: document.getElementById('contract-type').value,
            salaryType: document.getElementById('salary-type').value,
            workLoad: document.getElementById('work-load').value,
            dept: document.getElementById('dept').value,
            salary: Number(document.getElementById('salary').value.replace(/\D/g, '')) / 100,
            status: 'Ativo',
            seguroVida,
            seguradora: seguroVida === 'sim' ? (document.getElementById('seguradora')?.value || '') : '',
            possuiDependentes,
            qtdDependentes: possuiDependentes === 'sim' ? (document.getElementById('qtd-dependentes')?.value || '') : '',
            pcd,
            deficiencia: pcd === 'sim' ? (document.getElementById('tipo-deficiencia')?.value || '') : '',
            pensaoAlimenticia,
            tipoPensao: pensaoAlimenticia === 'sim' ? (document.querySelector('input[name="tipo-pensao"]:checked')?.value || '') : '',
            valeTransporte,
            valorPassagem: valeTransporte === 'sim' ? (document.getElementById('valor-passagem')?.value || '') : '',
            conducoesdia: valeTransporte === 'sim' ? (document.getElementById('conducoes-dia')?.value || '') : '',
            formaPagamento,
            tipoChavePix: formaPagamento === 'pix' ? (document.getElementById('tipo-chave-pix')?.value || '') : '',
            chavePix: formaPagamento === 'pix' ? (document.getElementById('chave-pix')?.value || '') : '',
            banco: formaPagamento === 'conta' ? bancoNome : '',
            tipoConta: formaPagamento === 'conta' ? (document.getElementById('tipo-conta')?.value || '') : '',
            agencia: formaPagamento === 'conta' ? (document.getElementById('agencia')?.value || '') : '',
            conta: formaPagamento === 'conta' ? (document.getElementById('conta')?.value || '') : '',
        };

        const isEditing = !!idField;
        const dbData = employeeToDb(empData);

        // Desabilita botões durante o save
        const btns = document.querySelectorAll('#btn-save, #btn-save-simple');
        btns.forEach(b => b.disabled = true);

        try {
            if (isEditing) {
                const old = employees.find(e => e.id === idField);
                const TRACKED = [
                    { key: 'name',         label: 'Nome' },
                    { key: 'role',         label: 'Cargo' },
                    { key: 'dept',         label: 'Departamento' },
                    { key: 'salary',       label: 'Salário', fmt: v => `R$ ${Number(v).toFixed(2)}` },
                    { key: 'contractType', label: 'Tipo de Contrato' },
                    { key: 'email',        label: 'E-mail' },
                    { key: 'admissionDate',label: 'Data de Admissão' },
                ];
                const changes = TRACKED.reduce((acc, { key, label, fmt }) => {
                    if (String(old?.[key] ?? '') !== String(empData[key] ?? '')) {
                        acc.push({ field: key, label, oldValue: fmt ? fmt(old?.[key]) : String(old?.[key] ?? '—'), newValue: fmt ? fmt(empData[key]) : String(empData[key] ?? '—') });
                    }
                    return acc;
                }, []);

                dbData.status = old?.status || 'Ativo';
                const { error } = await sb.from('employees').update(dbData).eq('id', idField);
                if (error) throw error;
                await logEmployeeEdit(idField, empData.name, changes);
                // Atualiza array local
                const idx = employees.findIndex(e => e.id === idField);
                if (idx !== -1) employees[idx] = { ...employees[idx], ...empData, id: idField };
            } else {
                const { data: inserted, error } = await sb.from('employees').insert(dbData).select().single();
                if (error) throw error;
                const newEmp = dbToEmployee(inserted);
                employees.unshift(newEmp);
                // Convida o colaborador, cria perfil e vincula auth_user_id
                try {
                    const invite = await inviteEmployee(empData.email);
                    if (invite?.id) {
                        await sb.from('profiles').insert({
                            id:          invite.id,
                            profile:     'colaborador',
                            employee_id: inserted.id
                        });
                        await sb.from('employees')
                            .update({ auth_user_id: invite.id })
                            .eq('id', inserted.id);
                    }
                } catch (err) {
                    console.error('[Nexus] Convite não enviado:', err.message);
                    showToast('Aviso de Convite', `Colaborador cadastrado, mas o e-mail de acesso não foi enviado: ${err.message}`, 'warning');
                }
            }

            const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
            applyStatusFilter(activeFilter);
            showToast(
                isEditing ? 'Colaborador Atualizado!' : 'Colaborador Cadastrado!',
                isEditing ? 'Os dados foram atualizados com sucesso.' : 'Colaborador registrado. Um e-mail de acesso será enviado.',
                'success'
            );
            toggleForm();
        } catch (err) {
            console.error('[Nexus] save employee:', err);
            showToast('Erro!', 'Não foi possível salvar. Tente novamente.', 'error');
        } finally {
            btns.forEach(b => b.disabled = false);
        }
    });
}

// ─── Edit employee ────────────────────────────────────────────

window.handleEditFromDrawer = function () { closeDrawer(); editEmployee(currentEmployeeId); };

window.editEmployee = function (id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;
    toggleForm();
    document.getElementById('form-title').innerHTML = '<i class="fas fa-edit"></i> Editar Colaborador';
    document.getElementById('employee-id').value   = emp.id;
    document.getElementById('name').value           = emp.name          || '';
    document.getElementById('role').value           = emp.role          || '';
    document.getElementById('cpf').value            = emp.cpf           || '';
    document.getElementById('email').value          = emp.email         || '';
    document.getElementById('admission-date').value = emp.admissionDate || '';
    document.getElementById('contract-type').value  = emp.contractType  || '';
    document.getElementById('salary-type').value    = emp.salaryType    || '';
    document.getElementById('work-load').value      = emp.workLoad      || '';
    document.getElementById('dept').value           = emp.dept          || '';
    const salaryRaw = emp.salary || 0;
    document.getElementById('salary').value = 'R$ ' + salaryRaw.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    if (document.getElementById('rg'))       document.getElementById('rg').value       = emp.rg       || '';
    if (document.getElementById('telefone')) document.getElementById('telefone').value = emp.telefone || '';
    restoreConditionalField('seguro-vida', emp.seguroVida, 'seguro-vida-details');
    if (emp.seguroVida === 'sim' && document.getElementById('seguradora')) document.getElementById('seguradora').value = emp.seguradora || '';
    restoreConditionalField('possui-dependentes', emp.possuiDependentes, 'dependentes-details');
    if (emp.possuiDependentes === 'sim' && document.getElementById('qtd-dependentes')) document.getElementById('qtd-dependentes').value = emp.qtdDependentes || '';
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
        if (document.getElementById('conducoes-dia'))  document.getElementById('conducoes-dia').value  = emp.conducoesdia  || '';
    }
    if (emp.formaPagamento) {
        const r = document.querySelector(`input[name="forma-pagamento"][value="${emp.formaPagamento}"]`);
        if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
        if (emp.formaPagamento === 'pix') {
            if (document.getElementById('tipo-chave-pix')) document.getElementById('tipo-chave-pix').value = emp.tipoChavePix || '';
            if (document.getElementById('chave-pix'))      document.getElementById('chave-pix').value      = emp.chavePix     || '';
        } else if (emp.formaPagamento === 'conta') {
            const bancoSelect = document.getElementById('banco');
            if (bancoSelect) {
                const opts = Array.from(bancoSelect.options).map(o => o.value);
                if (opts.includes(emp.banco)) { bancoSelect.value = emp.banco; }
                else { bancoSelect.value = 'outro'; bancoSelect.dispatchEvent(new Event('change')); if (document.getElementById('banco-outro')) document.getElementById('banco-outro').value = emp.banco || ''; }
            }
            if (document.getElementById('tipo-conta')) document.getElementById('tipo-conta').value = emp.tipoConta || '';
            if (document.getElementById('agencia'))    document.getElementById('agencia').value    = emp.agencia   || '';
            if (document.getElementById('conta'))      document.getElementById('conta').value      = emp.conta     || '';
        }
    }
    updateSaveButton();
};

// ─── Stepper ──────────────────────────────────────────────────

function goToStep(step) {
    const currentPanel = document.getElementById('step-panel-' + currentStep);
    if (currentPanel) { currentPanel.classList.add('hidden'); currentPanel.classList.remove('active'); }
    const currentStepEl = document.querySelector('[data-step="' + currentStep + '"]');
    if (currentStepEl) { currentStepEl.classList.remove('active'); if (step > currentStep) currentStepEl.classList.add('completed'); else currentStepEl.classList.remove('completed'); }
    currentStep = step;
    const newPanel = document.getElementById('step-panel-' + currentStep);
    if (newPanel) { newPanel.classList.remove('hidden'); newPanel.classList.add('active'); }
    const newStepEl = document.querySelector('[data-step="' + currentStep + '"]');
    if (newStepEl) newStepEl.classList.add('active');
    const btnPrev = document.getElementById('btn-prev-step');
    const btnNext = document.getElementById('btn-next-step');
    const btnSave = document.getElementById('btn-save');
    if (btnPrev) btnPrev.style.display = currentStep > 1 ? 'inline-flex' : 'none';
    if (btnNext) btnNext.style.display = currentStep < totalSteps ? 'inline-flex' : 'none';
    if (btnSave) { btnSave.style.display = currentStep === totalSteps ? 'inline-flex' : 'none'; updateSaveButton(); }
}

window.handleNextStep = function () { if (currentStep < totalSteps) goToStep(currentStep + 1); };
window.handlePrevStep = function () { if (currentStep > 1) goToStep(currentStep - 1); };

function resetStepper() {
    document.querySelectorAll('.step-panel').forEach(p => { p.classList.add('hidden'); p.classList.remove('active'); });
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active', 'completed'));
    currentStep = 1;
    const firstPanel = document.getElementById('step-panel-1');
    if (firstPanel) { firstPanel.classList.remove('hidden'); firstPanel.classList.add('active'); }
    document.querySelector('[data-step="1"]')?.classList.add('active');
    document.getElementById('btn-prev-step') && (document.getElementById('btn-prev-step').style.display = 'none');
    document.getElementById('btn-next-step') && (document.getElementById('btn-next-step').style.display = 'inline-flex');
    document.getElementById('btn-save')      && (document.getElementById('btn-save').style.display      = 'none');
}

function updateSaveButton() {
    const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input[required], #tab-obrigatorios select[required]');
    const allFilled       = Array.from(mandatoryFields).every(field => field.value.trim() !== '');
    const isEditing       = !!document.getElementById('employee-id').value;
    const label = isEditing ? '<i class="fas fa-check"></i> Salvar Alterações' : '<i class="fas fa-check"></i> Cadastrar';
    const btnSimple = document.getElementById('btn-save-simple');
    if (btnSimple) { btnSimple.disabled = !allFilled; btnSimple.style.opacity = allFilled ? '1' : '0.5'; btnSimple.style.cursor = allFilled ? 'pointer' : 'not-allowed'; btnSimple.innerHTML = label; }
    const btnStepper = document.getElementById('btn-save');
    if (btnStepper) { btnStepper.disabled = false; btnStepper.style.opacity = '1'; btnStepper.style.cursor = 'pointer'; btnStepper.innerHTML = label; }
}

function setupValidationListeners() {
    document.querySelectorAll('#tab-obrigatorios input, #tab-obrigatorios select').forEach(f => {
        f.addEventListener('input',  updateSaveButton);
        f.addEventListener('change', updateSaveButton);
    });
    updateSaveButton();
}

// ─── Conditional fields ───────────────────────────────────────

function setupConditionalFields() {
    setupToggleField('seguro-vida',        'sim', 'seguro-vida-details');
    setupToggleField('possui-dependentes', 'sim', 'dependentes-details');
    setupToggleField('pcd',                'sim', 'pcd-details');
    setupToggleField('pensao-alimenticia', 'sim', 'pensao-details');
    setupToggleField('vale-transporte',    'sim', 'vale-transporte-details');
    setupPaymentMethodToggle();
    setupBancoOutroToggle();
}

function setupToggleField(radioName, triggerValue, detailsId) {
    document.querySelectorAll(`input[name="${radioName}"]`).forEach(radio => {
        radio.addEventListener('change', () => {
            const details = document.getElementById(detailsId);
            if (!details) return;
            if (radio.value === triggerValue && radio.checked) {
                details.style.display = 'block'; details.classList.add('conditional-visible');
            } else if (radio.checked) {
                details.style.display = 'none'; details.classList.remove('conditional-visible');
                details.querySelectorAll('input, select, textarea').forEach(f => f.value = '');
            }
        });
    });
}

function setupPaymentMethodToggle() {
    document.querySelectorAll('input[name="forma-pagamento"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const pixDetails   = document.getElementById('pix-details');
            const contaDetails = document.getElementById('conta-details');
            if (!pixDetails || !contaDetails) return;
            if (radio.value === 'pix' && radio.checked) { pixDetails.style.display = 'block'; contaDetails.style.display = 'none'; contaDetails.querySelectorAll('input, select').forEach(f => f.value = ''); }
            else if (radio.value === 'conta' && radio.checked) { pixDetails.style.display = 'none'; contaDetails.style.display = 'block'; pixDetails.querySelectorAll('input, select').forEach(f => f.value = ''); }
            else { pixDetails.style.display = 'none'; contaDetails.style.display = 'none'; }
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
        if (bancoSelect.value !== 'outro') { const input = bancoOutroDiv.querySelector('input'); if (input) input.value = ''; }
    });
}

function resetConditionalFields() {
    ['seguro-vida-details','dependentes-details','pcd-details','pensao-details','vale-transporte-details','pix-details','conta-details','banco-outro-details'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.classList.remove('conditional-visible'); el.querySelectorAll('input, select, textarea').forEach(f => f.value = ''); }
    });
}

function restoreConditionalField(radioName, value, detailsId) {
    if (!value) return;
    const radio = document.querySelector(`input[name="${radioName}"][value="${value}"]`);
    if (radio) { radio.checked = true; const details = document.getElementById(detailsId); if (details) details.style.display = value === 'sim' ? 'block' : 'none'; }
}

// ─── Sidebar ──────────────────────────────────────────────────

function setupSidebarToggle() {
    const sidebar       = document.getElementById('sidebar');
    const toggleBtn     = document.getElementById('sidebar-toggle');
    const topbarMenuBtn = document.getElementById('topbar-menu-btn');
    const overlay       = document.getElementById('sidebar-overlay');
    if (!sidebar) return;
    const isMobile = () => window.innerWidth <= 768;
    toggleBtn && toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isMobile()) { sidebar.classList.toggle('open'); overlay && overlay.classList.toggle('active', sidebar.classList.contains('open')); }
        else { sidebar.classList.toggle('collapsed'); document.querySelector('.main-wrapper')?.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed')); }
    });
    topbarMenuBtn && topbarMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); sidebar.classList.toggle('open'); overlay && overlay.classList.toggle('active', sidebar.classList.contains('open')); });
    overlay && overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); });
    window.addEventListener('resize', () => { if (!isMobile()) { sidebar.classList.remove('open'); overlay && overlay.classList.remove('active'); } });
}

// ─── Input masks ──────────────────────────────────────────────

function setupCpfMask() {
    const input = document.getElementById('cpf');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        v = v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        e.target.value = v;
    });
}

function setupRgMask() {
    const input = document.getElementById('rg');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.toUpperCase().replace(/[^0-9X]/g, '');
        if (v.length > 9) v = v.slice(0, 9);
        if (v.length <= 2) {}
        else if (v.length <= 5) v = v.replace(/^(\d{2})(\d+)/, '$1.$2');
        else if (v.length <= 8) v = v.replace(/^(\d{2})(\d{3})(\d+)/, '$1.$2.$3');
        else v = v.replace(/^(\d{2})(\d{3})(\d{3})([0-9X])/, '$1.$2.$3-$4');
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
        else if (v.length <= 2)  e.target.value = `(${v}`;
        else if (v.length <= 7)  e.target.value = `(${v.slice(0,2)}) ${v.slice(2)}`;
        else                     e.target.value = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
    });
}

function setupAgenciaMask() {
    const input = document.getElementById('agencia');
    if (!input) return;
    input.addEventListener('input', (e) => { let v = e.target.value.replace(/\D/g, ''); if (v.length > 4) v = v.slice(0, 4); e.target.value = v; });
}

function setupContaMask() {
    const input = document.getElementById('conta');
    if (!input) return;
    input.addEventListener('input', (e) => { let v = e.target.value.toUpperCase().replace(/[^0-9X]/g, ''); if (v.length > 7) v = v.slice(0, 7); e.target.value = v.length <= 5 ? v : `${v.slice(0,5)}-${v.slice(5)}`; });
}

function setupCepMask() {
    const input = document.getElementById('cep');
    if (!input) return;
    input.addEventListener('input', (e) => { let v = e.target.value.replace(/\D/g, ''); if (v.length > 8) v = v.slice(0, 8); if (v.length > 5) v = `${v.slice(0,5)}-${v.slice(5)}`; e.target.value = v; });
}

function setupCepListener() {
    const input = document.getElementById('cep');
    if (!input) return;
    input.addEventListener('blur', (e) => window.pesquisacep(e.target.value));
}

function setupSalaryMask() {
    ['salary', 'rem-salario'].forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.type = 'text'; input.inputMode = 'numeric';
        input.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (!v.length) { e.target.value = ''; return; }
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
        else if (v.length <= 8)  e.target.value = `${v.slice(0,3)}.${v.slice(3)}`;
        else if (v.length <= 10) e.target.value = `${v.slice(0,3)}.${v.slice(3,8)}.${v.slice(8)}`;
        else                     e.target.value = `${v.slice(0,3)}.${v.slice(3,8)}.${v.slice(8,10)}-${v.slice(10)}`;
    });
}

function setupCurrencyMask(id) {
    const input = document.getElementById(id);
    if (!input) return;
    input.type = 'text'; input.inputMode = 'numeric';
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (!v.length) { e.target.value = ''; return; }
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
            document.getElementById('bairro').value     = data.bairro     || '';
            document.getElementById('cidade').value     = data.localidade || '';
            document.getElementById('uf').value         = data.uf         || '';
            document.getElementById('numero')?.focus();
        } else {
            showToast('CEP não encontrado!', 'Verifique o CEP informado.', 'warning');
        }
    } catch {
        showToast('CEP não encontrado!', 'Verifique o CEP informado.', 'warning');
    }
};

// ─── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    await loadRhSidebar();
    await fetchEmployees();
    renderTable(employees);
    setupFormListener();
    setupFilters();
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
    setupSidebarToggle();
    setupRealtimeSync();
    updateCount();
    resetStepper();
});
