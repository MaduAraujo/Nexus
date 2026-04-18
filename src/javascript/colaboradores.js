let employees = JSON.parse(localStorage.getItem('nexus_employees')) || [];
let currentEmployeeId = null;
let currentStep = 1;
const totalSteps = 6;

function showToast(title, msg, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const icons = {
        success: 'fa-check',
        error: 'fa-times',
        warning: 'fa-exclamation-triangle'
    };

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
    setupSidebarToggle();
    updateCount();
    resetStepper();
});

function setupSidebarToggle() {
    const sidebar       = document.getElementById('sidebar');
    const toggleBtn     = document.getElementById('sidebar-toggle');    
    const topbarMenuBtn = document.getElementById('topbar-menu-btn');   
    const overlay       = document.getElementById('sidebar-overlay');

    if (!sidebar) return;

    const isMobile = () => window.innerWidth <= 768;

    toggleBtn && toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isMobile()) {
            sidebar.classList.toggle('open');
            overlay && overlay.classList.toggle('active', sidebar.classList.contains('open'));
        } else {
            sidebar.classList.toggle('collapsed');
            const mw = document.querySelector('.main-wrapper');
            mw && mw.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
        }
    });

    topbarMenuBtn && topbarMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('open');
        overlay && overlay.classList.toggle('active', sidebar.classList.contains('open'));
    });

    overlay && overlay.addEventListener('click', () => {
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
        'Ativo':   'badge-ativo',
        'Inativo': 'badge-inativo',
        'Férias':  'badge-ferias'
    };
    return classes[status] || '';
};

function updateCount() {
    const countElement = document.getElementById('employee-count');
    if (!countElement) return;
    const visibleRows = document.querySelectorAll('#employee-list-body tr:not(#empty-row)').length;

    if (visibleRows === 0)      countElement.textContent = 'Nenhum colaborador encontrado';
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

    let filtered = employees;
    if (activeFilter === 'ativos')   filtered = employees.filter(e => e.status === 'Ativo');
    else if (activeFilter === 'inativos') filtered = employees.filter(e => e.status === 'Inativo');
    else if (activeFilter === 'ferias')   filtered = employees.filter(e => e.status === 'Férias');

    if (query) {
        filtered = filtered.filter(e =>
            e.name?.toLowerCase().includes(query) ||
            e.dept?.toLowerCase().includes(query) ||
            String(e.id).includes(query)
        );

        clearTimeout(searchToastTimeout);
        if (filtered.length === 0) {
            searchToastTimeout = setTimeout(() => {
                showToast('Colaborador Não Encontrado!', `Nenhum resultado para "${query}".`, 'warning');
            }, 600);
        } else {
            clearTimeout(searchToastTimeout);
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

window.switchTab = function (event, tabId) {
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

window.toggleForm = function () {
    const formContainer   = document.getElementById('form-container');
    const listSection     = document.getElementById('list-section');
    const contentHeader   = document.getElementById('content-header');
    const form            = document.getElementById('employee-form');

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
        const btnSimple   = document.getElementById('btn-save-simple');
        const btnStepper  = document.getElementById('btn-save');
        if (btnSimple)  btnSimple.innerHTML  = '<i class="fas fa-check"></i> Cadastrar';
        if (btnStepper) btnStepper.innerHTML = '<i class="fas fa-check"></i> Cadastrar';
        resetStepper();
        resetConditionalFields();
    }
};

function setupConditionalFields() {
    setupToggleField('seguro-vida',       'sim', 'seguro-vida-details');
    setupToggleField('possui-dependentes','sim', 'dependentes-details');
    setupToggleField('pcd',               'sim', 'pcd-details');
    setupToggleField('pensao-alimenticia','sim', 'pensao-details');
    setupToggleField('vale-transporte',   'sim', 'vale-transporte-details');
    setupPaymentMethodToggle();
    setupBancoOutroToggle();
}

function setupToggleField(radioName, triggerValue, detailsId) {
    document.querySelectorAll(`input[name="${radioName}"]`).forEach(radio => {
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
    document.querySelectorAll('input[name="forma-pagamento"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const pixDetails   = document.getElementById('pix-details');
            const contaDetails = document.getElementById('conta-details');
            if (!pixDetails || !contaDetails) return;

            if (radio.value === 'pix' && radio.checked) {
                pixDetails.style.display   = 'block';
                contaDetails.style.display = 'none';
                contaDetails.querySelectorAll('input, select').forEach(f => f.value = '');
            } else if (radio.value === 'conta' && radio.checked) {
                pixDetails.style.display   = 'none';
                contaDetails.style.display = 'block';
                pixDetails.querySelectorAll('input, select').forEach(f => f.value = '');
            } else {
                pixDetails.style.display   = 'none';
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
    [
        'seguro-vida-details',
        'dependentes-details',
        'pcd-details',
        'pensao-details',
        'vale-transporte-details',
        'pix-details',
        'conta-details',
        'banco-outro-details'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = 'none';
            el.classList.remove('conditional-visible');
            el.querySelectorAll('input, select, textarea').forEach(f => f.value = '');
        }
    });
}

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
        else                    currentStepEl.classList.remove('completed');
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

window.handleNextStep = function () {
    if (currentStep < totalSteps) goToStep(currentStep + 1);
};

window.handlePrevStep = function () {
    if (currentStep > 1) goToStep(currentStep - 1);
};

function resetStepper() {
    document.querySelectorAll('.step-panel').forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
    });
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active', 'completed'));

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
    const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input[required], #tab-obrigatorios select[required]');
    const allFilled       = Array.from(mandatoryFields).every(field => field.value.trim() !== '');
    const isEditing       = !!document.getElementById('employee-id').value;

    const label = isEditing
        ? '<i class="fas fa-check"></i> Salvar Alterações'
        : '<i class="fas fa-check"></i> Cadastrar';

    const btnSimple = document.getElementById('btn-save-simple');
    if (btnSimple) {
        btnSimple.disabled      = !allFilled;
        btnSimple.style.opacity = allFilled ? '1' : '0.5';
        btnSimple.style.cursor  = allFilled ? 'pointer' : 'not-allowed';
        btnSimple.innerHTML     = label;
    }

    const btnStepper = document.getElementById('btn-save');
    if (btnStepper) {
        btnStepper.disabled      = false;
        btnStepper.style.opacity = '1';
        btnStepper.style.cursor  = 'pointer';
        btnStepper.innerHTML     = label;
    }
}

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

        const mandatoryFields = document.querySelectorAll('#tab-obrigatorios input[required], #tab-obrigatorios select[required]');
        const allFilled       = Array.from(mandatoryFields).every(field => field.value.trim() !== '');
        if (!allFilled) {
            showToast('Campos Obrigatórios!', 'Preencha todos os campos.', 'warning');
            return;
        }

        const cpfDigitado  = document.getElementById('cpf').value.trim();
        const cpfDuplicado = employees.some(emp => emp.cpf === cpfDigitado && emp.id !== Number(idField));
        if (cpfDuplicado) {
            showToast('CPF Duplicado!', 'Já existe um colaborador com este CPF.', 'error');
            return;
        }

        const seguroVida      = document.querySelector('input[name="seguro-vida"]:checked')?.value        || 'nao';
        const seguradora      = seguroVida === 'sim' ? (document.getElementById('seguradora')?.value || '') : '';

        const possuiDependentes = document.querySelector('input[name="possui-dependentes"]:checked')?.value || 'nao';
        const qtdDependentes    = possuiDependentes === 'sim' ? (document.getElementById('qtd-dependentes')?.value || '') : '';

        const pcd         = document.querySelector('input[name="pcd"]:checked')?.value             || 'nao';
        const deficiencia = pcd === 'sim' ? (document.getElementById('tipo-deficiencia')?.value || '') : '';

        const pensaoAlimenticia = document.querySelector('input[name="pensao-alimenticia"]:checked')?.value || 'nao';
        const tipoPensao        = pensaoAlimenticia === 'sim'
            ? (document.querySelector('input[name="tipo-pensao"]:checked')?.value || '') : '';

        const valeTransporte = document.querySelector('input[name="vale-transporte"]:checked')?.value || 'nao';
        const valorPassagem  = valeTransporte === 'sim' ? (document.getElementById('valor-passagem')?.value  || '') : '';
        const conducoesdia   = valeTransporte === 'sim' ? (document.getElementById('conducoes-dia')?.value   || '') : '';

        const formaPagamento = document.querySelector('input[name="forma-pagamento"]:checked')?.value || '';
        const tipoChavePix   = formaPagamento === 'pix'   ? (document.getElementById('tipo-chave-pix')?.value || '') : '';
        const chavePix       = formaPagamento === 'pix'   ? (document.getElementById('chave-pix')?.value      || '') : '';
        const bancoValue     = document.getElementById('banco')?.value || '';
        const bancoNome      = bancoValue === 'outro'
            ? (document.getElementById('banco-outro')?.value || '') : bancoValue;
        const tipoConta  = document.getElementById('tipo-conta')?.value || '';
        const agencia    = document.getElementById('agencia')?.value    || '';
        const conta      = document.getElementById('conta')?.value      || '';

        const employeeData = {
            id:            idField ? Number(idField) : generateNextId(),
            name:          document.getElementById('name').value,
            role:          document.getElementById('role').value,
            cpf:           document.getElementById('cpf').value,
            rg:            document.getElementById('rg')?.value        || '',
            telefone:      document.getElementById('telefone')?.value  || '',
            email:         document.getElementById('email').value,
            admissionDate: document.getElementById('admission-date').value,
            contractType:  document.getElementById('contract-type').value,
            salaryType:    document.getElementById('salary-type').value,
            workLoad:      document.getElementById('work-load').value,
            dept:          document.getElementById('dept').value,
            salary:        Number(document.getElementById('salary').value.replace(/\D/g, '')) / 100,
            status:        'Ativo',
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
            banco:    formaPagamento === 'conta' ? bancoNome  : '',
            tipoConta:formaPagamento === 'conta' ? tipoConta  : '',
            agencia:  formaPagamento === 'conta' ? agencia    : '',
            conta:    formaPagamento === 'conta' ? conta       : ''
        };

        if (idField) {
            const index = employees.findIndex(emp => emp.id === Number(idField));
            if (index !== -1) {
                employeeData.status = employees[index].status;
                employees[index]    = employeeData;
            }
        } else {
            employees.push(employeeData);
        }

        saveAndRefresh();
        showToast(
            idField ? 'Colaborador Atualizado!' : 'Colaborador Cadastrado!',
            idField ? 'Os dados foram atualizados com sucesso.' : 'O colaborador foi registrado com sucesso.'
        );
        toggleForm();
    });
}

window.toggleDropdown = function (event) {
    event.stopPropagation();
    document.getElementById('drawer-dropdown').classList.toggle('show');
};

window.showStatusSubmenu = function () {
    const emp = employees.find(e => e.id === currentEmployeeId);
    if (!emp) return;

    const mainMenu        = document.getElementById('main-menu-options');
    const submenu         = document.getElementById('status-submenu-options');
    const dynamicOptions  = document.getElementById('dynamic-status-options');

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

window.updateStatus = function (newStatus) {
    const index = employees.findIndex(emp => emp.id === currentEmployeeId);
    if (index !== -1) {
        employees[index].status = newStatus;
        saveAndRefresh();
        openDrawer(currentEmployeeId);
        document.getElementById('drawer-dropdown').classList.remove('show');
        setTimeout(backToMainMenu, 300);

        const msgs = {
            'Ativo':   'Colaborador marcado como Ativo.',
            'Inativo': 'Colaborador marcado como Inativo.',
            'Férias':  'Colaborador marcado como em Férias.'
        };
        showToast('Status Atualizado!', msgs[newStatus] || `Status alterado para ${newStatus}.`, 'success');
    }
};

window.openDrawer = function (id) {
    const emp = employees.find(e => e.id === Number(id));
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

window.addEventListener('click', (event) => {
    if (!event.target.closest('.dropdown')) {
        document.getElementById('drawer-dropdown')?.classList.remove('show');
        backToMainMenu();
    }
});

const EMPTY_STATES = {
    todos:    { icon: 'fa-users-slash',     title: 'Nenhum colaborador cadastrado',  sub: 'Clique em "Novo Colaborador" para começar' },
    ativos:   { icon: 'fa-user-check',      title: 'Nenhum colaborador ativo',       sub: '' },
    inativos: { icon: 'fa-user-times',      title: 'Nenhum colaborador inativo',     sub: '' },
    ferias:   { icon: 'fa-umbrella-beach',  title: 'Nenhum colaborador de férias',   sub: '' },
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

    data.forEach(emp => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = () => window.openDrawer(emp.id);
        tr.innerHTML = `
            <td>#${emp.id}</td>
            <td><strong>${emp.name}</strong></td>
            <td><span class="badge ${getBadgeClass(emp.status)}">${emp.status}</span></td>
            <td>${emp.dept || '-'}</td>
            <td>${emp.role || '-'}</td>
            <td>${formatDateBR(emp.admissionDate)}</td>
        `;
        tbody.appendChild(tr);
    });

    updateCount();
}

window.handleEditFromDrawer = function () {
    closeDrawer();
    editEmployee(currentEmployeeId);
};

window.editEmployee = function (id) {
    const emp = employees.find(e => e.id === Number(id));
    if (!emp) return;

    toggleForm();
    document.getElementById('form-title').innerHTML = '<i class="fas fa-edit"></i> Editar Colaborador';

    document.getElementById('employee-id').value = emp.id;

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
    document.getElementById('salary').value = 'R$ ' +
        salaryRaw.toFixed(2)
            .replace('.', ',')
            .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    if (document.getElementById('rg'))       document.getElementById('rg').value       = emp.rg       || '';
    if (document.getElementById('telefone')) document.getElementById('telefone').value = emp.telefone || '';

    restoreConditionalField('seguro-vida', emp.seguroVida, 'seguro-vida-details');
    if (emp.seguroVida === 'sim' && document.getElementById('seguradora'))
        document.getElementById('seguradora').value = emp.seguradora || '';

    restoreConditionalField('possui-dependentes', emp.possuiDependentes, 'dependentes-details');
    if (emp.possuiDependentes === 'sim' && document.getElementById('qtd-dependentes'))
        document.getElementById('qtd-dependentes').value = emp.qtdDependentes || '';

    restoreConditionalField('pcd', emp.pcd, 'pcd-details');
    if (emp.pcd === 'sim' && document.getElementById('tipo-deficiencia'))
        document.getElementById('tipo-deficiencia').value = emp.deficiencia || '';

    restoreConditionalField('pensao-alimenticia', emp.pensaoAlimenticia, 'pensao-details');
    if (emp.pensaoAlimenticia === 'sim' && emp.tipoPensao) {
        const pensaoRadio = document.querySelector(`input[name="tipo-pensao"][value="${emp.tipoPensao}"]`);
        if (pensaoRadio) pensaoRadio.checked = true;
    }

    restoreConditionalField('vale-transporte', emp.valeTransporte, 'vale-transporte-details');
    if (emp.valeTransporte === 'sim') {
        if (document.getElementById('valor-passagem')) document.getElementById('valor-passagem').value = emp.valorPassagem || '';
        if (document.getElementById('conducoes-dia'))  document.getElementById('conducoes-dia').value  = emp.conducoesdia  || '';
    }

    if (emp.formaPagamento) {
        const pagamentoRadio = document.querySelector(`input[name="forma-pagamento"][value="${emp.formaPagamento}"]`);
        if (pagamentoRadio) {
            pagamentoRadio.checked = true;
            pagamentoRadio.dispatchEvent(new Event('change'));
        }
        if (emp.formaPagamento === 'pix') {
            if (document.getElementById('tipo-chave-pix')) document.getElementById('tipo-chave-pix').value = emp.tipoChavePix || '';
            if (document.getElementById('chave-pix'))      document.getElementById('chave-pix').value      = emp.chavePix     || '';
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
            if (document.getElementById('agencia'))    document.getElementById('agencia').value    = emp.agencia   || '';
            if (document.getElementById('conta'))      document.getElementById('conta').value      = emp.conta     || '';
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
        if (details) details.style.display = value === 'sim' ? 'block' : 'none';
    }
}

window.handleDeleteEmployee = function () {
    if (confirm('Tem certeza que deseja excluir este colaborador?')) {
        employees = employees.filter(emp => emp.id !== currentEmployeeId);
        saveAndRefresh();
        closeDrawer();
        showToast('Colaborador Excluído!', 'O colaborador foi removido com sucesso.', 'error');
    }
};

function saveAndRefresh() {
    localStorage.setItem('nexus_employees', JSON.stringify(employees));
    const activeFilter = document.querySelector('.btn-filter.active')?.getAttribute('data-filter') || 'todos';
    applyStatusFilter(activeFilter);
}

function applyStatusFilter(filter) {
    let filtered = employees;
    if (filter === 'ativos')   filtered = employees.filter(e => e.status === 'Ativo');
    else if (filter === 'inativos') filtered = employees.filter(e => e.status === 'Inativo');
    else if (filter === 'ferias')   filtered = employees.filter(e => e.status === 'Férias');
    renderTable(filtered, activeFilter);
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

function setupCpfMask() {
    const cpfInput = document.getElementById('cpf');
    if (!cpfInput) return;
    cpfInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        v = v.replace(/(\d{3})(\d)/,    '$1.$2');
        v = v.replace(/(\d{3})(\d)/,    '$1.$2');
        v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
        e.target.value = v;
    });
}

function setupRgMask() {
    const rgInput = document.getElementById('rg');
    if (!rgInput) return;
    rgInput.addEventListener('input', (e) => {
        let v = e.target.value.toUpperCase().replace(/[^0-9X]/g, '');
        if (v.length > 9) v = v.slice(0, 9);
        if      (v.length <= 2) {}
        else if (v.length <= 5) v = v.replace(/^(\d{2})(\d+)/, '$1.$2');
        else if (v.length <= 8) v = v.replace(/^(\d{2})(\d{3})(\d+)/, '$1.$2.$3');
        else                    v = v.replace(/^(\d{2})(\d{3})(\d{3})([0-9X])/, '$1.$2.$3-$4');
        e.target.value = v;
    });
}

function setupPhoneMask() {
    const phoneInput = document.getElementById('telefone');
    if (!phoneInput) return;
    phoneInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        if      (v.length === 0) { e.target.value = ''; return; }
        else if (v.length <= 2)  v = `(${v}`;
        else if (v.length <= 7)  v = `(${v.slice(0,2)}) ${v.slice(2)}`;
        else                     v = `(${v.slice(0,2)}) ${v.slice(2,7)}-${v.slice(7)}`;
        e.target.value = v;
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
        e.target.value = v.length <= 5 ? v : `${v.slice(0,5)}-${v.slice(5)}`;
    });
}

function setupCepMask() {
    const input = document.getElementById('cep');
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 8) v = v.slice(0, 8);
        if (v.length > 5) v = `${v.slice(0,5)}-${v.slice(5)}`;
        e.target.value = v;
    });
}

function setupCepListener() {
    const cepInput = document.getElementById('cep');
    if (!cepInput) return;
    cepInput.addEventListener('blur', (e) => window.pesquisacep(e.target.value));
}

function setupSalaryMask() {
    ['salary', 'rem-salario'].forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        input.type       = 'text';
        input.inputMode  = 'numeric';
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
        if      (v.length <= 3)  e.target.value = v;
        else if (v.length <= 8)  e.target.value = `${v.slice(0,3)}.${v.slice(3)}`;
        else if (v.length <= 10) e.target.value = `${v.slice(0,3)}.${v.slice(3,8)}.${v.slice(8)}`;
        else                     e.target.value = `${v.slice(0,3)}.${v.slice(3,8)}.${v.slice(8,10)}-${v.slice(10)}`;
    });
}

function setupCurrencyMask(id) {
    const input = document.getElementById(id);
    if (!input) return;
    input.type      = 'text';
    input.inputMode = 'numeric';
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
        const data     = await response.json();
        if (!data.erro) {
            document.getElementById('logradouro').value = data.logradouro || '';
            document.getElementById('bairro').value     = data.bairro     || '';
            document.getElementById('cidade').value     = data.localidade || '';
            document.getElementById('uf').value         = data.uf         || '';
            document.getElementById('numero')?.focus();
        } else {
            showToast('CEP não encontrado!', 'Verifique o CEP informado e tente novamente.', 'warning');
        }
    } catch (err) {
        showToast('CEP não encontrado!', 'Verifique o CEP informado e tente novamente.', 'warning');
        console.error('Erro ViaCEP', err);
    }
};

function setupValidationListeners() {
    document.querySelectorAll('#tab-obrigatorios input, #tab-obrigatorios select').forEach(f => {
        f.addEventListener('input',  updateSaveButton);
        f.addEventListener('change', updateSaveButton);
    });
    updateSaveButton();
}