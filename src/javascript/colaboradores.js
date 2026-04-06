let employees = JSON.parse(localStorage.getItem('nexus_employees')) || [];
let currentEmployeeId = null;

document.addEventListener('DOMContentLoaded', () => {
    renderTable(employees);
    setupFormListener();
    setupFilters();
    setupCepListener();
    setupCpfMask();
    setupValidationListeners(); // Monitora as mudanças nos campos
    updateCount();
    validateRequiredFields();   // Verifica estado inicial ao carregar
});

// --- UTILITÁRIOS ---
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
    const visibleRows = document.querySelectorAll('#employee-list-body tr:not([style*="display: none"])').length;
    
    if (visibleRows === 0) countElement.textContent = "Nenhum colaborador encontrado";
    else if (visibleRows === 1) countElement.textContent = "1 colaborador encontrado";
    else countElement.textContent = `${visibleRows} colaboradores encontrados`;
}

// --- LÓGICA DE ABAS ---
window.switchTab = function(event, tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

    if(event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        const targetBtn = document.querySelector(`[onclick*="${tabId}"]`);
        if (targetBtn) targetBtn.classList.add('active');
    }
    document.getElementById(tabId).classList.add('active');
    
    // Opcional: Validar ao trocar de aba para garantir estado dos botões
    validateRequiredFields();
}

// --- CONTROLE DE INTERFACE (FORMULÁRIO) ---
window.toggleForm = function() {
    const formContainer = document.getElementById('form-container');
    const listSection = document.getElementById('list-section');
    const contentHeader = document.getElementById('content-header');
    const form = document.getElementById('employee-form');

    if (formContainer.classList.contains('hidden')) {
        formContainer.classList.remove('hidden');
        listSection.classList.add('hidden');
        contentHeader.classList.add('hidden');
        
        document.querySelectorAll('.tab-btn').forEach((b, i) => i === 0 ? b.classList.add('active') : b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p, i) => i === 0 ? p.classList.add('active') : p.classList.remove('active'));
    } else {
        formContainer.classList.add('hidden');
        listSection.classList.remove('hidden');
        contentHeader.classList.remove('hidden');
        
        form.reset();
        document.getElementById('employee-id').value = '';
        
        const cpfInput = document.getElementById('cpf');
        if(cpfInput) cpfInput.style.borderColor = '';

        document.getElementById('form-title').innerHTML = '<i class="fas fa-user-plus"></i> Novo Colaborador';
        document.getElementById('btn-save').innerText = 'Cadastrar';
        resetStepper();
    }
    validateRequiredFields(); // Garante que o botão comece desativado no form vazio
}

// --- MÁSCARA DE CPF ---
function setupCpfMask() {
    const cpfInput = document.getElementById('cpf');
    if (!cpfInput) return;

    cpfInput.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length <= 11) {
            value = value.replace(/^(\d{3})(\d)/, "$1.$2");
            value = value.replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3");
            value = value.replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
        }
        e.target.value = value;
    });
}

// --- INTEGRAÇÃO VIA CEP ---
function setupCepListener() {
    const zipInput = document.getElementById('zipcode');
    if (!zipInput) return;

    zipInput.addEventListener('blur', async function() {
        const cep = this.value.replace(/\D/g, '');
        if (cep.length === 8) {
            try {
                const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                const data = await response.json();
                if (!data.erro) {
                    document.getElementById('address').value = data.logradouro;
                    if (document.getElementById('neighborhood')) document.getElementById('neighborhood').value = data.bairro;
                    if (document.getElementById('city')) document.getElementById('city').value = data.localidade;
                    if (document.getElementById('state')) document.getElementById('state').value = data.uf;
                    document.getElementById('number').focus();
                    validateRequiredFields(); // Revalida após preenchimento automático
                }
            } catch (e) { console.error("Erro CEP", e); }
        }
    });
}

// --- VALIDAÇÃO DE CAMPOS OBRIGATÓRIOS ---
function validateRequiredFields() {
    const saveBtn = document.getElementById('btn-save');
    const nextBtn = document.getElementById('btn-next-step');
    
    // Seleciona campos com atributo 'required' dentro da aba de dados obrigatórios
    const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input[required], #tab-obrigatorios select[required]');
    
    const allFilled = Array.from(mandatoryFields).every(input => {
        // Para inputs, verifica se não está vazio. Para selects, verifica se o valor não é vazio.
        return input.value.trim() !== "";
    });

    if (saveBtn) {
        saveBtn.disabled = !allFilled;
        saveBtn.style.opacity = allFilled ? "1" : "0.5";
        saveBtn.style.cursor = allFilled ? "pointer" : "not-allowed";
    }

    if (nextBtn) {
        nextBtn.disabled = !allFilled;
        nextBtn.style.opacity = allFilled ? "1" : "0.5";
        nextBtn.style.cursor = allFilled ? "pointer" : "not-allowed";
    }
}

function setupValidationListeners() {
    const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input, #tab-obrigatorios select');
    mandatoryFields.forEach(field => {
        field.addEventListener('input', validateRequiredFields);
        field.addEventListener('change', validateRequiredFields);
    });
}

// --- AÇÕES DO DRAWER ---
window.toggleDrawerMenu = function() {
    const menu = document.getElementById("drawer-menu");
    menu.classList.toggle("show");
    window.backToMainMenu(); 
}

window.showStatusSubmenu = function() {
    const emp = employees.find(e => e.id === currentEmployeeId);
    if (!emp) return;

    if (emp.status === 'Inativo') {
        alert("Colaborador inativo. O status não pode ser alterado.");
        return;
    }

    const submenu = document.getElementById('status-submenu-options');
    const options = submenu.querySelectorAll('a[onclick*="updateStatus"]');
    
    options.forEach(opt => opt.classList.add('hidden'));

    if (emp.status === 'Ativo') {
        submenu.querySelector('a[onclick*="Inativo"]').classList.remove('hidden');
        submenu.querySelector('a[onclick*="Férias"]').classList.remove('hidden');
    } else if (emp.status === 'Férias') {
        submenu.querySelector('a[onclick*="Ativo"]').classList.remove('hidden');
    }

    document.getElementById('main-menu-options').classList.add('hidden');
    submenu.classList.remove('hidden');
}

window.backToMainMenu = function() {
    document.getElementById('main-menu-options').classList.remove('hidden');
    document.getElementById('status-submenu-options').classList.add('hidden');
}

window.updateStatus = function(newStatus) {
    if (!currentEmployeeId) return;
    const index = employees.findIndex(emp => emp.id === currentEmployeeId);
    
    if (index !== -1) {
        employees[index].status = newStatus;
        saveAndRefresh();
        openDrawer(currentEmployeeId); 
        document.getElementById("drawer-menu").classList.remove("show");
    }
}

window.handleEditFromDrawer = function() {
    if (!currentEmployeeId) return;
    const emp = employees.find(e => e.id === currentEmployeeId);
    if (emp.status === 'Inativo') {
        alert("Não é possível editar dados de um colaborador inativo.");
        return;
    }
    closeDrawer();
    editEmployee(currentEmployeeId);
}

window.handleDeleteFromDrawer = function() {
    if (!currentEmployeeId) return;
    const emp = employees.find(e => e.id === currentEmployeeId);
    if (confirm(`Excluir permanentemente ${emp.name}?`)) {
        employees = employees.filter(e => e.id !== currentEmployeeId);
        saveAndRefresh();
        closeDrawer();
    }
}

// --- FORMULÁRIO (SALVAR) ---
function setupFormListener() {
    const form = document.getElementById('employee-form');
    if (!form) return;
    
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const cpfInput = document.getElementById('cpf');
        if (cpfInput && cpfInput.value.replace(/\D/g, "").length < 11) {
            cpfInput.style.borderColor = 'var(--danger)';
            alert('O CPF deve conter 11 dígitos válidos.');
            return; 
        }

        if (cpfInput) cpfInput.style.borderColor = ''; 

        const id = document.getElementById('employee-id').value;
        const employeeData = {
            id: id ? Number(id) : Date.now(),
            name: document.getElementById('name').value,
            cpf: document.getElementById('cpf')?.value || '',
            email: document.getElementById('email')?.value || '',
            admissionDate: document.getElementById('admission-date').value,
            contractType: document.getElementById('contract-type').value,
            salaryType: document.getElementById('salary-type')?.value || '',
            workLoad: document.getElementById('work-load')?.value || '',
            dept: document.getElementById('dept').value,
            role: document.getElementById('role')?.value || '',
            salary: Number(document.getElementById('salary').value),
            status: document.getElementById('status-select').value,
            address: { 
                zip: document.getElementById('zipcode')?.value || '', 
                street: document.getElementById('address')?.value || '',
                number: document.getElementById('number')?.value || ''
            }
        };

        if (id) {
            const index = employees.findIndex(emp => emp.id === Number(id));
            employees[index] = employeeData;
        } else {
            employees.push(employeeData);
        }

        saveAndRefresh();
        toggleForm();
    });
}

// --- RENDERIZAÇÃO ---
function renderTable(data) {
    const tbody = document.getElementById('employee-list-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    data.forEach(emp => {
        const tr = document.createElement('tr');
        tr.onclick = () => openDrawer(emp.id);
        tr.innerHTML = `
            <td>#${emp.id.toString().slice(-4)}</td>
            <td>${emp.name}</td>
            <td><span class="badge ${getBadgeClass(emp.status)}">${emp.status}</span></td>
            <td>${emp.dept}</td>
        `;
        tbody.appendChild(tr);
    });
    updateCount();
}

window.editEmployee = function(id) {
    const emp = employees.find(e => e.id === Number(id));
    if (!emp) return;

    toggleForm();
    document.getElementById('form-title').innerHTML = '<i class="fas fa-edit"></i> Editar Colaborador';
    document.getElementById('btn-save').innerText = 'Salvar Alterações';
    
    document.getElementById('employee-id').value = emp.id;
    document.getElementById('name').value = emp.name;
    if(document.getElementById('cpf')) document.getElementById('cpf').value = emp.cpf || '';
    if(document.getElementById('email')) document.getElementById('email').value = emp.email || '';
    document.getElementById('admission-date').value = emp.admissionDate;
    document.getElementById('contract-type').value = emp.contractType || '';
    if(document.getElementById('salary-type')) document.getElementById('salary-type').value = emp.salaryType || '';
    if(document.getElementById('work-load')) document.getElementById('work-load').value = emp.workLoad || '';
    document.getElementById('dept').value = emp.dept;
    if(document.getElementById('role')) document.getElementById('role').value = emp.role || '';
    document.getElementById('salary').value = emp.salary;
    document.getElementById('status-select').value = emp.status;

    if (emp.address) {
        if(document.getElementById('zipcode')) document.getElementById('zipcode').value = emp.address.zip || '';
        if(document.getElementById('address')) document.getElementById('address').value = emp.address.street || '';
        if(document.getElementById('number')) document.getElementById('number').value = emp.address.number || '';
    }
    
    validateRequiredFields(); // Habilita o botão pois campos obrigatórios estarão preenchidos
}

window.openDrawer = function(id) {
    const emp = employees.find(e => e.id === Number(id));
    if (!emp) return;
    currentEmployeeId = emp.id;

    document.getElementById('view-name').textContent = emp.name;
    document.getElementById('view-dept').textContent = emp.dept;
    if(document.getElementById('view-role')) document.getElementById('view-role').textContent = emp.role || '-';
    document.getElementById('view-date').textContent = formatDateBR(emp.admissionDate);
    document.getElementById('view-salary').textContent = formatCurrency(emp.salary);
    
    const statusLabel = document.getElementById('view-status');
    statusLabel.textContent = emp.status;
    statusLabel.className = `badge ${getBadgeClass(emp.status)}`;

    document.getElementById('employee-drawer').classList.add('active');
    document.getElementById('drawer-overlay').classList.add('active');
}

window.closeDrawer = function() {
    document.getElementById('employee-drawer').classList.remove('active');
    document.getElementById('drawer-overlay').classList.remove('active');
    currentEmployeeId = null;
}

function saveAndRefresh() {
    localStorage.setItem('nexus_employees', JSON.stringify(employees));
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    applyStatusFilter(activeFilter);
}

function applyStatusFilter(filter) {
    let filtered = employees;
    if (filter === 'ativos') filtered = employees.filter(e => e.status === 'Ativo');
    else if (filter === 'inativos') filtered = employees.filter(e => e.status === 'Inativo');
    else if (filter === 'ferias') filtered = employees.filter(e => e.status === 'Férias');
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

// --- LÓGICA DO STEPPER ---
let currentStep = 1;
const totalSteps = 6;

function handleNextStep() {
    const activeTab = document.querySelector('.tab-btn.active').innerText;
    
    if (activeTab === "Dados Completos") {
        if (currentStep < totalSteps) {
            currentStep++;
            updateStepper();
        }
    }
}

function updateStepper() {
    const steps = document.querySelectorAll('.stepper-container .step');
    const nextBtn = document.getElementById('btn-next-step');
    const saveBtn = document.getElementById('btn-save');

    steps.forEach((step, index) => {
        if (index < currentStep) step.classList.add('active');
        else step.classList.remove('active');
    });

    if (currentStep === totalSteps) {
        if (nextBtn) nextBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'block';
    } else {
        if (nextBtn) nextBtn.style.display = 'block';
        if (saveBtn) saveBtn.style.display = 'none';
    }
}

function resetStepper() {
    currentStep = 1;
    updateStepper();
}