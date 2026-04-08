let employees = JSON.parse(localStorage.getItem('nexus_employees')) || [];
let currentEmployeeId = null;
let currentStep = 1;
const totalSteps = 6;

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    renderTable(employees);
    setupFormListener();
    setupFilters();
    setupCepListener();
    setupCpfMask();
    setupValidationListeners();
    updateCount();
    resetStepper();
});

// --- UTILITÁRIOS ---
const generateNextId = () => {
    if (employees.length === 0) return 1;
    return Math.max(...employees.map(emp => emp.id)) + 1;
};

const formatDateBR = (dateStr) => {
    if (!dateStr) return '-';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
};

const formatCurrency = (value) => {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
};

const getBadgeClass = (status) => {
    const classes = {
        'Ativo': 'badge-ativo',
        'Inativo': 'badge-inativo',
        'Férias': 'badge-ferias'
    };
    return classes[status] || '';
};

function updateCount() {
    const countElement = document.getElementById('employee-count');
    if (!countElement) return;
    const visibleRows = document.querySelectorAll('#employee-list-body tr').length;

    if (visibleRows === 0) countElement.textContent = "Nenhum colaborador encontrado";
    else if (visibleRows === 1) countElement.textContent = "1 colaborador encontrado";
    else countElement.textContent = `${visibleRows} colaboradores encontrados`;
}

// --- LÓGICA DE ABAS ---
window.switchTab = function(event, tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        const targetBtn = document.querySelector(`[onclick*="${tabId}"]`);
        if (targetBtn) targetBtn.classList.add('active');
    }

    document.getElementById(tabId)?.classList.add('active');
};

window.toggleForm = function() {
    const formContainer = document.getElementById('form-container');
    const listSection = document.getElementById('list-section');
    const contentHeader = document.getElementById('content-header');
    const form = document.getElementById('employee-form');

    if (formContainer && formContainer.classList.contains('hidden')) {
        formContainer.classList.remove('hidden');
        listSection.classList.add('hidden');
        contentHeader.classList.add('hidden');
        resetStepper();
    } else {
        formContainer?.classList.add('hidden');
        listSection?.classList.remove('hidden');
        contentHeader?.classList.remove('hidden');
        form?.reset();
        document.getElementById('employee-id').value = '';
        document.getElementById('form-title').innerHTML = '<i class="fas fa-user-plus"></i> Novo Colaborador';
        const btnSimple = document.getElementById('btn-save-simple');
        if (btnSimple) btnSimple.innerHTML = '<i class="fas fa-check"></i> Cadastrar';
        resetStepper();
    }
};

// --- CONTROLE DO STEPPER ---
function goToStep(step) {
    // Oculta painel atual
    const currentPanel = document.getElementById('step-panel-' + currentStep);
    if (currentPanel) {
        currentPanel.classList.add('hidden');
        currentPanel.classList.remove('active');
    }

    // Atualiza ícone do step atual
    const currentStepEl = document.querySelector('[data-step="' + currentStep + '"]');
    if (currentStepEl) {
        currentStepEl.classList.remove('active');
        if (step > currentStep) {
            currentStepEl.classList.add('completed');
        } else {
            currentStepEl.classList.remove('completed');
        }
    }

    currentStep = step;

    // Exibe novo painel
    const newPanel = document.getElementById('step-panel-' + currentStep);
    if (newPanel) {
        newPanel.classList.remove('hidden');
        newPanel.classList.add('active');
    }

    const newStepEl = document.querySelector('[data-step="' + currentStep + '"]');
    if (newStepEl) newStepEl.classList.add('active');

    // Controla visibilidade dos botões
    const btnPrev = document.getElementById('btn-prev-step');
    const btnNext = document.getElementById('btn-next-step');
    const btnSave = document.getElementById('btn-save');

    if (btnPrev) btnPrev.style.display = currentStep > 1 ? 'inline-flex' : 'none';
    if (btnNext) btnNext.style.display = currentStep < totalSteps ? 'inline-flex' : 'none';
    if (btnSave) {
        btnSave.style.display = currentStep === totalSteps ? 'inline-flex' : 'none';
        updateSaveButton();
    }
}

window.handleNextStep = function() {
    if (currentStep < totalSteps) {
        goToStep(currentStep + 1);
    }
};

window.handlePrevStep = function() {
    if (currentStep > 1) {
        goToStep(currentStep - 1);
    }
};

function resetStepper() {
    document.querySelectorAll('.step-panel').forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
    });
    document.querySelectorAll('.step').forEach(s => {
        s.classList.remove('active', 'completed');
    });

    currentStep = 1;

    const firstPanel = document.getElementById('step-panel-1');
    if (firstPanel) {
        firstPanel.classList.remove('hidden');
        firstPanel.classList.add('active');
    }

    const firstStep = document.querySelector('[data-step="1"]');
    if (firstStep) firstStep.classList.add('active');

    const btnPrev = document.getElementById('btn-prev-step');
    const btnNext = document.getElementById('btn-next-step');
    const btnSave = document.getElementById('btn-save');

    if (btnPrev) btnPrev.style.display = 'none';
    if (btnNext) btnNext.style.display = 'inline-flex';
    if (btnSave) btnSave.style.display = 'none';
}

function updateSaveButton() {
    const btnSimple = document.getElementById('btn-save-simple');
    const btnStepper = document.getElementById('btn-save');

    const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input[required]');
    const allFilled = Array.from(mandatoryFields).every(input => input.value.trim() !== '');

    if (btnSimple) {
        btnSimple.disabled = !allFilled;
        btnSimple.style.opacity = allFilled ? '1' : '0.5';
    }
    if (btnStepper) {
        btnStepper.disabled = !allFilled;
        btnStepper.style.opacity = allFilled ? '1' : '0.5';
    }
}

// --- FORMULÁRIO ---
function setupFormListener() {
    const form = document.getElementById('employee-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const idField = document.getElementById('employee-id').value;

        const employeeData = {
            id: idField ? Number(idField) : generateNextId(),
            name: document.getElementById('name').value,
            role: document.getElementById('role').value,
            cpf: document.getElementById('cpf').value,
            email: document.getElementById('email').value,
            admissionDate: document.getElementById('admission-date').value,
            contractType: document.getElementById('contract-type').value,
            salaryType: document.getElementById('salary-type').value,
            workLoad: document.getElementById('work-load').value,
            dept: document.getElementById('dept').value,
            salary: Number(document.getElementById('salary').value),
            status: 'Ativo'
        };

        if (idField) {
            const index = employees.findIndex(emp => emp.id === Number(idField));
            if (index !== -1) {
                employeeData.status = employees[index].status;
                employees[index] = employeeData;
            }
        } else {
            employees.push(employeeData);
        }

        saveAndRefresh();
        toggleForm();
    });
}

// --- SUBMENU DE STATUS E DROPDOWN ---
window.toggleDropdown = function(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('drawer-dropdown');
    dropdown.classList.toggle('show');
};

window.showStatusSubmenu = function() {
    const emp = employees.find(e => e.id === currentEmployeeId);
    if (!emp) return;

    const mainMenu = document.getElementById('main-menu-options');
    const submenu = document.getElementById('status-submenu-options');
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
        dynamicOptions.innerHTML = '<div style="padding: 10px 16px; font-size: 12px; color: #999;">Status Inativo é permanente.</div>';
    }

    mainMenu.classList.add('hidden');
    submenu.classList.remove('hidden');
};

window.backToMainMenu = function() {
    document.getElementById('main-menu-options').classList.remove('hidden');
    document.getElementById('status-submenu-options').classList.add('hidden');
};

window.updateStatus = function(newStatus) {
    const index = employees.findIndex(emp => emp.id === currentEmployeeId);
    if (index !== -1) {
        employees[index].status = newStatus;
        saveAndRefresh();
        openDrawer(currentEmployeeId);
        document.getElementById('drawer-dropdown').classList.remove('show');
        setTimeout(backToMainMenu, 300);
    }
};

// --- DRAWER ---
window.openDrawer = function(id) {
    const emp = employees.find(e => e.id === Number(id));
    if (!emp) return;

    currentEmployeeId = emp.id;

    document.getElementById('view-name').textContent = emp.name;
    document.getElementById('view-role').textContent = emp.role || '-';
    document.getElementById('view-dept').textContent = emp.dept || '-';
    document.getElementById('view-salary').textContent = formatCurrency(emp.salary);
    document.getElementById('view-date').textContent = formatDateBR(emp.admissionDate);

    const statusBadge = document.getElementById('view-status');
    if (statusBadge) {
        statusBadge.textContent = emp.status;
        statusBadge.className = `badge ${getBadgeClass(emp.status)}`;
    }

    document.getElementById('employee-drawer').classList.add('active');
    document.getElementById('drawer-overlay').classList.add('active');
};

window.closeDrawer = function() {
    document.getElementById('employee-drawer').classList.remove('active');
    document.getElementById('drawer-overlay').classList.remove('active');
    document.getElementById('drawer-dropdown').classList.remove('show');
    backToMainMenu();
};

window.addEventListener('click', (event) => {
    if (!event.target.closest('.dropdown')) {
        document.getElementById('drawer-dropdown')?.classList.remove('show');
        backToMainMenu();
    }
});

// --- RENDERIZAÇÃO E FILTROS ---
function renderTable(data) {
    const tbody = document.getElementById('employee-list-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    data.forEach(emp => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = () => window.openDrawer(emp.id);
        tr.innerHTML = `
            <td>#${emp.id}</td>
            <td class="emp-name"><strong>${emp.name}</strong></td>
            <td><span class="badge ${getBadgeClass(emp.status)}">${emp.status}</span></td>
            <td>${emp.dept}</td>
        `;
        tbody.appendChild(tr);
    });
    updateCount();
}

window.handleEditFromDrawer = function() {
    closeDrawer();
    editEmployee(currentEmployeeId);
};

window.editEmployee = function(id) {
    const emp = employees.find(e => e.id === Number(id));
    if (!emp) return;

    toggleForm();
    document.getElementById('form-title').innerHTML = '<i class="fas fa-edit"></i> Editar Colaborador';

    const btnSimple = document.getElementById('btn-save-simple');
    const btnStepper = document.getElementById('btn-save');
    if (btnSimple) btnSimple.innerHTML = '<i class="fas fa-check"></i> Salvar Alterações';
    if (btnStepper) btnStepper.innerHTML = '<i class="fas fa-check"></i> Salvar Alterações';

    document.getElementById('employee-id').value = emp.id;
    document.getElementById('name').value = emp.name;
     document.getElementById('role').value = emp.role || '';
    document.getElementById('cpf').value = emp.cpf || '';
    document.getElementById('email').value = emp.email || '';
    document.getElementById('admission-date').value = emp.admissionDate;
    document.getElementById('dept').value = emp.dept;
    document.getElementById('salary').value = emp.salary;

    updateSaveButton();
};

window.handleDeleteEmployee = function() {
    if (confirm('Tem certeza que deseja excluir este colaborador?')) {
        employees = employees.filter(emp => emp.id !== currentEmployeeId);
        saveAndRefresh();
        closeDrawer();
    }
};

function saveAndRefresh() {
    localStorage.setItem('nexus_employees', JSON.stringify(employees));
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    applyStatusFilter(activeFilter);
}

function applyStatusFilter(filter) {
    let filtered = employees;
    if (filter === 'ativos') filtered = employees.filter(e => e.status === 'Ativo');
    else if (filter === 'inativos') filtered = employees.filter(e => e.status === 'Inativo');
    renderTable(filtered);
}

function setupFilters() {
    document.querySelectorAll('.btn-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyStatusFilter(btn.getAttribute('data-filter'));
        });
    });
}

// --- MÁSCARAS E VALIDAÇÕES ---
function setupCpfMask() {
    const cpfInput = document.getElementById('cpf');
    if (!cpfInput) return;
    cpfInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        v = v.replace(/(\d{3})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d)/, '$1.$2');
        v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        e.target.value = v;
    });
}

window.pesquisacep = async function(valor) {
    const cep = valor.replace(/\D/g, '');
    if (cep.length !== 8) return;

    try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();
        if (!data.erro) {
            document.getElementById('logradouro').value = data.logradouro || '';
            document.getElementById('bairro').value     = data.bairro     || '';
            document.getElementById('cidade').value     = data.localidade  || '';
            document.getElementById('uf').value         = data.uf          || '';
            document.getElementById('numero')?.focus();
        }
    } catch (e) {
        console.error('Erro ViaCEP', e);
    }
};

function setupValidationListeners() {
    document.querySelectorAll('#tab-obrigatorios input, #tab-obrigatorios select').forEach(f => {
        f.addEventListener('input', updateSaveButton);
    });
}