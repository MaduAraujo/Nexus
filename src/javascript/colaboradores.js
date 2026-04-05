let employees = JSON.parse(localStorage.getItem('nexus_employees')) || [];

document.addEventListener('DOMContentLoaded', () => {
    renderTable(employees);
    setupFormListener();
    setupFilters();
    
    const zipInput = document.getElementById('zipcode');
    if (zipInput) {
        zipInput.addEventListener('blur', function() {
            pesquisacep(this.value);
        });
    }
});

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

// --- LÓGICA DE ABAS ---
window.switchTab = function(event, tabId) {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => btn.classList.remove('active'));
    tabPanels.forEach(panel => panel.classList.remove('active'));

    if(event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        document.querySelector(`[onclick*="${tabId}"]`).classList.add('active');
    }
    
    document.getElementById(tabId).classList.add('active');
}

// --- CONTROLE DE INTERFACE ---
window.toggleForm = function() {
    const formContainer = document.getElementById('form-container');
    const listSection = document.getElementById('list-section');
    const contentHeader = document.getElementById('content-header');
    const form = document.getElementById('employee-form');

    if (formContainer.style.display === 'none' || formContainer.style.display === '') {
        formContainer.style.display = 'block';
        listSection.style.display = 'none';
        contentHeader.style.display = 'none';
        resetTabs();
    } else {
        formContainer.style.display = 'none';
        listSection.style.display = 'block';
        contentHeader.style.display = 'flex';
        form.reset();
        
        const inputs = form.querySelectorAll('input, select');
        inputs.forEach(input => input.style.borderColor = '');

        document.getElementById('employee-id').value = '';
        document.getElementById('form-title').innerHTML = '<i class="fas fa-user-plus"></i> Novo Colaborador';
        document.getElementById('btn-save').innerText = 'Cadastrar';
    }
}

function resetTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');
    tabs.forEach((b, i) => i === 0 ? b.classList.add('active') : b.classList.remove('active'));
    panels.forEach((p, i) => i === 0 ? p.classList.add('active') : p.classList.remove('active'));
}

// --- INTEGRAÇÃO VIA CEP ---
function limpa_formulário_cep() {
    document.getElementById('address').value = "";
    document.getElementById('neighborhood').value = "";
    document.getElementById('city').value = "";
    document.getElementById('state').value = "";
}

window.meu_callback = function(conteudo) {
    if (!("erro" in conteudo)) {
        document.getElementById('address').value = conteudo.logradouro;
        document.getElementById('neighborhood').value = conteudo.bairro;
        document.getElementById('city').value = conteudo.localidade;
        document.getElementById('state').value = conteudo.uf;
        document.getElementById('number').focus();
    } else {
        limpa_formulário_cep();
        alert("CEP não encontrado.");
    }
}

function pesquisacep(valor) {
    const cep = valor.replace(/\D/g, '');
    if (cep !== "") {
        const validacep = /^[0-9]{8}$/;
        if (validacep.test(cep)) {
            document.getElementById('address').value = "...";
            const script = document.createElement('script');
            script.src = `https://viacep.com.br/ws/${cep}/json/?callback=meu_callback`;
            document.body.appendChild(script);
        } else {
            limpa_formulário_cep();
            alert("Formato de CEP inválido.");
        }
    }
}

// --- AÇÕES ---
window.toggleEmployeeStatus = function(id) {
    const index = employees.findIndex(emp => emp.id === Number(id));
    if (index !== -1) {
        const currentStatus = employees[index].status;
        const newStatus = (currentStatus === 'Ativo') ? 'Inativo' : 'Ativo';
        
        if (confirm(`Deseja alterar o status de ${employees[index].name} para ${newStatus}?`)) {
            employees[index].status = newStatus;
            saveAndRefresh();
        }
    }
}

window.deleteEmployee = function(id) {
    if (confirm('Deseja excluir este registro?')) {
        employees = employees.filter(e => e.id !== Number(id));
        saveAndRefresh();
    }
}

function setupFormListener() {
    const form = document.getElementById('employee-form');
    if (!form) return;
    
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const requiredFields = [
            { id: 'name', label: 'Nome Completo' },
            { id: 'admission-date', label: 'Data de Admissão' },
            { id: 'contract-type', label: 'Tipo de Contrato' },
            { id: 'payment-type', label: 'Tipo de Pagamento' },
            { id: 'dept', label: 'Departamento' },
            { id: 'role', label: 'Cargo' },
            { id: 'salary', label: 'Salário' },
            { id: 'status-select', label: 'Status' }
        ];

        let firstInvalidField = null;
        let isValid = true;

        requiredFields.forEach(fieldObj => {
            const el = document.getElementById(fieldObj.id);
            if (!el.value || el.value.trim() === "") {
                el.style.borderColor = '#be1300ff';
                isValid = false;
                if (!firstInvalidField) firstInvalidField = fieldObj.id;
            } else {
                el.style.borderColor = '';
            }
        });

        if (!isValid) {
            alert('Por favor, preencha todos os campos obrigatórios.');
            switchTab(null, 'tab-obrigatorios');
            document.getElementById(firstInvalidField).focus();
            return;
        }

        const id = document.getElementById('employee-id').value;
        
        const employeeData = {
            id: id ? Number(id) : Date.now(),
            name: document.getElementById('name').value,
            admissionDate: document.getElementById('admission-date').value,
            contractType: document.getElementById('contract-type').value,
            paymentType: document.getElementById('payment-type').value,
            birthDate: document.getElementById('birth-date').value,
            gender: document.getElementById('gender').value,
            civilStatus: document.getElementById('civil-status').value,
            dept: document.getElementById('dept').value,
            role: document.getElementById('role').value,
            salary: Number(document.getElementById('salary').value),
            status: document.getElementById('status-select').value,
            address: {
                zip: document.getElementById('zipcode').value,
                street: document.getElementById('address').value,
                number: document.getElementById('number').value,
                neighborhood: document.getElementById('neighborhood').value,
                city: document.getElementById('city').value,
                state: document.getElementById('state').value
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
        const isAtivo = emp.status === 'Ativo';
        const tr = document.createElement('tr');
        
        tr.onclick = (e) => {
            if (e.target.closest('.btn-action')) return;
            openDrawer(emp.id);
        };

        tr.innerHTML = `
            <td>${emp.name}</td>
            <td>${emp.dept}</td>
            <td><span class="badge ${isAtivo ? 'badge-ativo' : 'badge-inativo'}">${emp.status}</span></td>
            <td>
                <div class="td-actions">
                    <button class="btn-action ${isAtivo ? 'btn-delete' : 'btn-view'}" onclick="event.stopPropagation(); toggleEmployeeStatus(${emp.id})" title="Alterar Status">
                        <i class="fas ${isAtivo ? 'fa-user-slash' : 'fa-user-check'}"></i>
                    </button>
                    <button class="btn-action btn-edit" onclick="event.stopPropagation(); editEmployee(${emp.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="event.stopPropagation(); deleteEmployee(${emp.id})" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.editEmployee = function(id) {
    const emp = employees.find(e => e.id === Number(id));
    if (!emp) return;

    toggleForm();
    document.getElementById('form-title').innerHTML = '<i class="fas fa-edit"></i> Editar Colaborador';
    document.getElementById('btn-save').innerText = 'Salvar Alterações';

    document.getElementById('employee-id').value = emp.id;
    document.getElementById('name').value = emp.name;
    document.getElementById('admission-date').value = emp.admissionDate;
    document.getElementById('contract-type').value = emp.contractType;
    document.getElementById('payment-type').value = emp.paymentType;
    document.getElementById('birth-date').value = emp.birthDate;
    document.getElementById('gender').value = emp.gender;
    document.getElementById('civil-status').value = emp.civilStatus;
    document.getElementById('dept').value = emp.dept;
    document.getElementById('role').value = emp.role;
    document.getElementById('salary').value = emp.salary;
    document.getElementById('status-select').value = emp.status;

    const addr = emp.address || {};
    document.getElementById('zipcode').value = addr.zip || '';
    document.getElementById('address').value = addr.street || '';
    document.getElementById('number').value = addr.number || '';
    document.getElementById('neighborhood').value = addr.neighborhood || '';
    document.getElementById('city').value = addr.city || '';
    document.getElementById('state').value = addr.state || '';
}

window.openDrawer = function(id) {
    const emp = employees.find(e => e.id === Number(id));
    if (!emp) return;

    document.getElementById('view-name').textContent = emp.name;
    document.getElementById('view-dept').textContent = emp.dept;
    document.getElementById('view-role').textContent = emp.role;
    document.getElementById('view-date').textContent = formatDateBR(emp.admissionDate);
    document.getElementById('view-salary').textContent = formatCurrency(emp.salary);
    
    const statusLabel = document.getElementById('view-status');
    statusLabel.textContent = emp.status;
    statusLabel.className = `badge ${emp.status === 'Ativo' ? 'badge-ativo' : 'badge-inativo'}`;

    document.getElementById('employee-drawer').classList.add('active');
    document.getElementById('drawer-overlay').classList.add('active');
}

window.closeDrawer = function() {
    document.getElementById('employee-drawer').classList.remove('active');
    document.getElementById('drawer-overlay').classList.remove('active');
}

function saveAndRefresh() {
    localStorage.setItem('nexus_employees', JSON.stringify(employees));
    renderTable(employees);
}

function setupFilters() {
    const filterBtns = document.querySelectorAll('.btn-filter');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.getAttribute('data-filter');
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (filter === 'todos') {
                renderTable(employees);
            } else {
                const targetStatus = filter === 'ativos' ? 'Ativo' : 'Inativo';
                renderTable(employees.filter(e => e.status === targetStatus));
            }
        });
    });
}