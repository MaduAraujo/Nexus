let employees = JSON.parse(localStorage.getItem('nexus_employees')) || [];
let currentEmployeeId = null;
let currentStep = 1;
const totalSteps = 6;

// --- TOAST ---
function showToast(title = 'Colaborador Cadastrado!', msg = 'O colaborador foi registrado com sucesso.') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas fa-check"></i></div>
        <div class="toast-content">
            <p class="toast-title">${title}</p>
            <p class="toast-msg">${msg}</p>
        </div>
        <button class="toast-close" onclick="this.closest('.toast').classList.add('hide'); setTimeout(() => this.closest('.toast').remove(), 400);">
            <i class="fas fa-times"></i>
        </button>
    `;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => toast.classList.add('show'));
    });

    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
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
        resetConditionalFields();
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
        resetConditionalFields();
    }
};

function setupConditionalFields() {
    setupToggleField('seguro-vida', 'sim', 'seguro-vida-details');
    setupToggleField('possui-dependentes', 'sim', 'dependentes-details');
    setupToggleField('pcd', 'sim', 'pcd-details');
    setupToggleField('pensao-alimenticia', 'sim', 'pensao-details');
    setupToggleField('vale-transporte', 'sim', 'vale-transporte-details');
    setupPaymentMethodToggle();
    setupBancoOutroToggle();
}

function setupToggleField(radioName, triggerValue, detailsId) {
    const radios = document.querySelectorAll(`input[name="${radioName}"]`);
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            const details = document.getElementById(detailsId);
            if (!details) return;
            if (radio.value === triggerValue && radio.checked) {
                details.style.display = 'block';
                details.classList.add('conditional-visible');
            } else if (radio.checked) {
                details.style.display = 'none';
                details.classList.remove('conditional-visible');
                details.querySelectorAll('input, select, textarea').forEach(f => f.value = '');
            }
        });
    });
}

function setupPaymentMethodToggle() {
    const radios = document.querySelectorAll('input[name="forma-pagamento"]');
    radios.forEach(radio => {
        radio.addEventListener('change', () => {
            const pixDetails = document.getElementById('pix-details');
            const contaDetails = document.getElementById('conta-details');
 
            if (!pixDetails || !contaDetails) return;
 
            if (radio.value === 'pix' && radio.checked) {
                pixDetails.style.display = 'block';
                contaDetails.style.display = 'none';
                contaDetails.querySelectorAll('input, select').forEach(f => f.value = '');
            } else if (radio.value === 'conta' && radio.checked) {
                pixDetails.style.display = 'none';
                contaDetails.style.display = 'block';
                pixDetails.querySelectorAll('input, select').forEach(f => f.value = '');
            } else {
                pixDetails.style.display = 'none';
                contaDetails.style.display = 'none';
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
        if (bancoSelect.value === 'outro') {
            bancoOutroDiv.style.display = 'block';
        } else {
            bancoOutroDiv.style.display = 'none';
            const input = bancoOutroDiv.querySelector('input');
            if (input) input.value = '';
        }
    });
}

function resetConditionalFields() {
    const conditionalIds = [
        'seguro-vida-details',
        'dependentes-details',
        'pcd-details',
        'pensao-details',
        'vale-transporte-details',
        'pix-details',
        'conta-details',
        'banco-outro-details'
    ];
    conditionalIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = 'none';
            el.classList.remove('conditional-visible');
            el.querySelectorAll('input, select, textarea').forEach(f => f.value = '');
        }
    });
}

// --- CONTROLE DO STEPPER ---
function goToStep(step) {
    const currentPanel = document.getElementById('step-panel-' + currentStep);
    if (currentPanel) {
        currentPanel.classList.add('hidden');
        currentPanel.classList.remove('active');
    }

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
}

function updateSaveButton() {
    const btnSimple = document.getElementById('btn-save-simple');

    const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input[required], #tab-obrigatorios select[required]');
    const allFilled = Array.from(mandatoryFields).every(field => field.value.trim() !== '');

    if (btnSimple) {
        btnSimple.disabled = !allFilled;
        btnSimple.style.opacity = allFilled ? '1' : '0.5';
        btnSimple.style.cursor = allFilled ? 'pointer' : 'not-allowed';
    }

    const btnStepper = document.getElementById('btn-save');
    if (btnStepper) {
        btnStepper.disabled = false;
        btnStepper.style.opacity = '1';
        btnStepper.style.cursor = 'pointer';
    }
}

// --- FORMULÁRIO ---
function setupFormListener() {
    const form = document.getElementById('employee-form');
    if (!form) return;

    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        });
    }
 
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const idField = document.getElementById('employee-id').value;
 
        const seguroVida = document.querySelector('input[name="seguro-vida"]:checked')?.value || 'nao';
        const seguradora = seguroVida === 'sim' ? (document.getElementById('seguradora')?.value || '') : '';
 
        const possuiDependentes = document.querySelector('input[name="possui-dependentes"]:checked')?.value || 'nao';
        const qtdDependentes = possuiDependentes === 'sim' ? (document.getElementById('qtd-dependentes')?.value || '') : '';

        const pcd = document.querySelector('input[name="pcd"]:checked')?.value || 'nao';
        const deficiencia = pcd === 'sim' ? (document.getElementById('tipo-deficiencia')?.value || '') : '';
 
        const pensaoAlimenticia = document.querySelector('input[name="pensao-alimenticia"]:checked')?.value || 'nao';
        const tipoPensao = pensaoAlimenticia === 'sim' ? (document.querySelector('input[name="tipo-pensao"]:checked')?.value || '') : '';
 
        const valeTransporte = document.querySelector('input[name="vale-transporte"]:checked')?.value || 'nao';
        const valorPassagem = valeTransporte === 'sim' ? (document.getElementById('valor-passagem')?.value || '') : '';
        const conducoesdia = valeTransporte === 'sim' ? (document.getElementById('conducoes-dia')?.value || '') : '';
 
        const formaPagamento = document.querySelector('input[name="forma-pagamento"]:checked')?.value || '';
        const tipoChavePix = formaPagamento === 'pix' ? (document.getElementById('tipo-chave-pix')?.value || '') : '';
        const chavePix = formaPagamento === 'pix' ? (document.getElementById('chave-pix')?.value || '') : '';
        const bancoValue = document.getElementById('banco')?.value || '';
        const bancoNome = bancoValue === 'outro' ? (document.getElementById('banco-outro')?.value || '') : bancoValue;
        const tipoConta = document.getElementById('tipo-conta')?.value || '';
        const agencia = document.getElementById('agencia')?.value || '';
        const conta = document.getElementById('conta')?.value || '';
 
        const employeeData = {
            id: idField ? Number(idField) : generateNextId(),
            name: document.getElementById('name').value,
            role: document.getElementById('role').value,
            cpf: document.getElementById('cpf').value,
            rg: document.getElementById('rg')?.value || '',
            phone: document.getElementById('phone')?.value || '',
            email: document.getElementById('email').value,
            admissionDate: document.getElementById('admission-date').value,
            contractType: document.getElementById('contract-type').value,
            salaryType: document.getElementById('salary-type').value,
            workLoad: document.getElementById('work-load').value,
            dept: document.getElementById('dept').value,
            salary: Number(document.getElementById('salary').value),
            status: 'Ativo',
            seguroVida,
            seguradora,
            possuiDependentes,
            qtdDependentes,
            pcd,
            deficiencia,
            pensaoAlimenticia,
            tipoPensao,
            valeTransporte,
            valorPassagem,
            conducoesdia,
            formaPagamento,
            tipoChavePix,
            chavePix,
            banco: formaPagamento === 'conta' ? bancoNome : '',
            tipoConta: formaPagamento === 'conta' ? tipoConta : '',
            agencia: formaPagamento === 'conta' ? agencia : '',
            conta: formaPagamento === 'conta' ? conta : ''
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
        const isEditing = !!idField;
        showToast(
            isEditing ? 'Colaborador Atualizado!' : 'Colaborador Cadastrado!',
            isEditing ? 'Os dados foram atualizados com sucesso.' : 'O colaborador foi registrado com sucesso.'
        );
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
    if (document.getElementById('rg')) document.getElementById('rg').value = emp.rg || '';
    if (document.getElementById('phone')) document.getElementById('phone').value = emp.phone || '';
    document.getElementById('email').value = emp.email || '';
    document.getElementById('admission-date').value = emp.admissionDate;
    document.getElementById('dept').value = emp.dept;
    document.getElementById('salary').value = emp.salary;
 
    restoreConditionalField('seguro-vida', emp.seguroVida, 'seguro-vida-details');
    if (emp.seguroVida === 'sim' && document.getElementById('seguradora')) {
        document.getElementById('seguradora').value = emp.seguradora || '';
    }
 
    restoreConditionalField('possui-dependentes', emp.possuiDependentes, 'dependentes-details');
    if (emp.possuiDependentes === 'sim' && document.getElementById('qtd-dependentes')) {
        document.getElementById('qtd-dependentes').value = emp.qtdDependentes || '';
    }
 
    restoreConditionalField('pcd', emp.pcd, 'pcd-details');
    if (emp.pcd === 'sim' && document.getElementById('tipo-deficiencia')) {
        document.getElementById('tipo-deficiencia').value = emp.deficiencia || '';
    }
 
    restoreConditionalField('pensao-alimenticia', emp.pensaoAlimenticia, 'pensao-details');
    if (emp.pensaoAlimenticia === 'sim' && emp.tipoPensao) {
        const pensaoRadio = document.querySelector(`input[name="tipo-pensao"][value="${emp.tipoPensao}"]`);
        if (pensaoRadio) pensaoRadio.checked = true;
    }
 
    restoreConditionalField('vale-transporte', emp.valeTransporte, 'vale-transporte-details');
    if (emp.valeTransporte === 'sim') {
        if (document.getElementById('valor-passagem')) document.getElementById('valor-passagem').value = emp.valorPassagem || '';
        if (document.getElementById('conducoes-dia')) document.getElementById('conducoes-dia').value = emp.conducoesdia || '';
    }
 
    // Forma de pagamento
    if (emp.formaPagamento) {
        const pagamentoRadio = document.querySelector(`input[name="forma-pagamento"][value="${emp.formaPagamento}"]`);
        if (pagamentoRadio) {
            pagamentoRadio.checked = true;
            pagamentoRadio.dispatchEvent(new Event('change'));
        }
        if (emp.formaPagamento === 'pix') {
            if (document.getElementById('tipo-chave-pix')) document.getElementById('tipo-chave-pix').value = emp.tipoChavePix || '';
            if (document.getElementById('chave-pix')) document.getElementById('chave-pix').value = emp.chavePix || '';
        } else if (emp.formaPagamento === 'conta') {
            const bancoSelect = document.getElementById('banco');
            if (bancoSelect) {
                const options = Array.from(bancoSelect.options).map(o => o.value);
                if (options.includes(emp.banco)) {
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

function restoreConditionalField(radioName, value, detailsId) {
    if (!value) return;
    const radio = document.querySelector(`input[name="${radioName}"][value="${value}"]`);
    if (radio) {
        radio.checked = true;
        const details = document.getElementById(detailsId);
        if (details) {
            details.style.display = value === 'sim' ? 'block' : 'none';
        }
    }
}

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

// --- MÁSCARAS ---
 
// CPF: 000.000.000-00
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
 
// RG: 00.000.000-0
function setupRgMask() {
    const rgInput = document.getElementById('rg');
    if (!rgInput) return;
    rgInput.addEventListener('input', (e) => {
        let v = e.target.value.toUpperCase().replace(/[^0-9X]/g, '');
        if (v.length > 9) v = v.slice(0, 9);
        if (v.length <= 2) {
            // nada
        } else if (v.length <= 5) {
            v = v.replace(/^(\d{2})(\d+)/, '$1.$2');
        } else if (v.length <= 8) {
            v = v.replace(/^(\d{2})(\d{3})(\d+)/, '$1.$2.$3');
        } else {
            v = v.replace(/^(\d{2})(\d{3})(\d{3})([0-9X])/, '$1.$2.$3-$4');
        }
        e.target.value = v;
    });
}
 
// Telefone: (00) 00000-0000
function setupPhoneMask() {
    const phoneInput = document.getElementById('phone');
    if (!phoneInput) return;
    phoneInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        if (v.length === 0) {
            e.target.value = '';
            return;
        }
        if (v.length <= 2) {
            v = `(${v}`;
        } else if (v.length <= 7) {
            v = `(${v.slice(0,2)}) ${v.slice(2)}`;
        } else {
            v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
        }
        e.target.value = v;
    });
}
 
// Agência: 0000
function setupAgenciaMask() {
    const agenciaInput = document.getElementById('agencia');
    if (!agenciaInput) return;
    agenciaInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 4) v = v.slice(0, 4);
        e.target.value = v;
    });
}
 
// Conta: 00000-0 (dígito pode ser X)
function setupContaMask() {
    const contaInput = document.getElementById('conta');
    if (!contaInput) return;
    contaInput.addEventListener('input', (e) => {
        let v = e.target.value.toUpperCase().replace(/[^0-9X]/g, '');
        if (v.length > 7) v = v.slice(0, 7);
        if (v.length <= 5) {
            e.target.value = v;
        } else {
            e.target.value = `${v.slice(0, 5)}-${v.slice(5)}`;
        }
    });
}
 
// CEP: 00000-000
function setupCepMask() {
    const cepInput = document.getElementById('cep');
    if (!cepInput) return;
    cepInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 8) v = v.slice(0, 8);
        if (v.length > 5) {
            v = `${v.slice(0, 5)}-${v.slice(5)}`;
        }
        e.target.value = v;
    });
}

function setupCepListener() {
    const cepInput = document.getElementById('cep');
    if (!cepInput) return;
    cepInput.addEventListener('blur', (e) => {
        window.pesquisacep(e.target.value);
    });
}

// Salário: R$ 0,00
function setupSalaryMask() {
    const salaryInputs = [
        document.getElementById('salary'),
        document.getElementById('rem-salario')
    ];

    salaryInputs.forEach(input => {
        if (!input) return;

        input.type = 'text';
        input.inputMode = 'numeric';

        input.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.length === 0) { e.target.value = ''; return; }
            let num = (parseInt(v, 10) / 100).toFixed(2);
            e.target.value = 'R$ ' + num.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        });
    });
}

 // PIS/PASEP: 000.00000.00-0
function setupPisPasepMask() {
    const input = document.getElementById('pis-pasep');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        if (v.length <= 3) {
            e.target.value = v;
        } else if (v.length <= 8) {
            e.target.value = `${v.slice(0,3)}.${v.slice(3)}`;
        } else if (v.length <= 10) {
            e.target.value = `${v.slice(0,3)}.${v.slice(3,8)}.${v.slice(8)}`;
        } else {
            e.target.value = `${v.slice(0,3)}.${v.slice(3,8)}.${v.slice(8,10)}-${v.slice(10)}`;
        }
    });
}

// Vale Alimentação/Refeição: R$ 0,00
function setupCurrencyMask(id) {
    const input = document.getElementById(id);
    if (!input) return;
    input.type = 'text';
    input.inputMode = 'numeric';
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length === 0) { e.target.value = ''; return; }
        let num = (parseInt(v, 10) / 100).toFixed(2);
        e.target.value = 'R$ ' + num.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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
        f.addEventListener('change', updateSaveButton);
    });
    updateSaveButton();
}