let employees = JSON.parse(localStorage.getItem('nexus_employees')) || [];

document.addEventListener('DOMContentLoaded', () => {
    renderTable(employees);
    setupFormListener();
    setupZipcodeListener();
});

function toggleForm() {
    const formContainer = document.getElementById('form-container');
    const listSection = document.getElementById('list-section');
    const contentHeader = document.getElementById('content-header');

    if (formContainer.style.display === 'none' || formContainer.style.display === '') {
        formContainer.style.display = 'block';
        listSection.style.display = 'none';
        contentHeader.style.display = 'none';
    } else {
        formContainer.style.display = 'none';
        listSection.style.display = 'block';
        contentHeader.style.display = 'flex';
        document.getElementById('employee-form').reset();
    }
}

function openDrawer(id) {
    const emp = employees.find(e => e.id === id);
    if (!emp) return;

    document.getElementById('view-name').textContent = emp.name;
    document.getElementById('view-dept').textContent = emp.dept;
    document.getElementById('view-role').textContent = emp.role;
    
    const salaryFormatted = Number(emp.salary).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    });
    document.getElementById('view-salary').textContent = salaryFormatted;

    if (emp.admissionDate) {
        const dateParts = emp.admissionDate.split('-');
        document.getElementById('view-date').textContent = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
    } else {
        document.getElementById('view-date').textContent = "--/--/----";
    }

    const statusEl = document.getElementById('view-status');
    statusEl.textContent = emp.status === 'ativos' ? 'Ativo' : 'Inativo';
    statusEl.className = 'status-display ' + (emp.status === 'ativos' ? 'status-active' : 'status-inactive');

    const addr = emp.address;
    document.getElementById('view-address').textContent = 
        `${addr.street}, ${addr.number} ${addr.complement ? '- ' + addr.complement : ''} - ${addr.neighborhood}, ${addr.city}/${addr.state} (CEP: ${addr.zip})`;

    document.getElementById('employee-drawer').classList.add('active');
    document.getElementById('drawer-overlay').classList.add('active');
}

function closeDrawer() {
    document.getElementById('employee-drawer').classList.remove('active');
    document.getElementById('drawer-overlay').classList.remove('active');
}

function setupFormListener() {
    const form = document.getElementById('employee-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const newEmployee = {
            id: Date.now(),
            name: document.getElementById('name').value,
            birthDate: document.getElementById('birth-date').value,
            admissionDate: document.getElementById('admission-date').value, 
            gender: document.getElementById('gender').value,
            civilStatus: document.getElementById('civil-status').value,
            dept: document.getElementById('dept').value,
            role: document.getElementById('role').value,
            salary: document.getElementById('salary').value,
            status: 'ativos', 
            address: {
                zip: document.getElementById('zipcode').value,
                street: document.getElementById('address').value,
                number: document.getElementById('number').value,
                complement: document.getElementById('complement').value,
                neighborhood: document.getElementById('neighborhood').value,
                city: document.getElementById('city').value,
                state: document.getElementById('state').value
            }
        };

        employees.push(newEmployee);
        saveAndRefresh();
        toggleForm();
    });
}

function saveAndRefresh() {
    localStorage.setItem('nexus_employees', JSON.stringify(employees));
    renderTable(employees);
}

function renderTable(data) {
    const tbody = document.getElementById('employee-list-body');
    tbody.innerHTML = '';

    data.forEach(emp => {
        const tr = document.createElement('tr');
        
        const isAtivo = emp.status === 'ativos';
        const statusBtnIcon = isAtivo ? 'fa-user-slash' : 'fa-user-check';
        const statusBtnTitle = isAtivo ? 'Desativar Colaborador' : 'Reativar Colaborador';
        const statusBtnClass = isAtivo ? 'status-deactivate' : 'status-activate';

        tr.innerHTML = `
            <td>${emp.name}</td>
            <td>${emp.dept}</td>
            <td><span class="badge ${emp.status}">${isAtivo ? 'Ativo' : 'Inativo'}</span></td>
            <td>
                <div class="actions">
                    <button class="btn-icon view" onclick="openDrawer(${emp.id})" title="Visualizar">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-icon ${statusBtnClass}" onclick="toggleStatus(${emp.id})" title="${statusBtnTitle}">
                        <i class="fas ${statusBtnIcon}"></i>
                    </button>
                    <button class="btn-icon delete" onclick="deleteEmployee(${emp.id})" title="Excluir">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleStatus(id) {
    const index = employees.findIndex(e => e.id === id);
    if (index !== -1) {
        employees[index].status = employees[index].status === 'ativos' ? 'inativos' : 'ativos';
        saveAndRefresh();
    }
}

function filterEmployees(status, btn) {
    document.querySelectorAll('.btn-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (status === 'todos') {
        renderTable(employees);
    } else {
        const filtered = employees.filter(e => e.status === status);
        renderTable(filtered);
    }
}

function deleteEmployee(id) {
    if (confirm('Tem certeza que deseja excluir este colaborador(a)?')) {
        employees = employees.filter(e => e.id !== id);
        saveAndRefresh();
    }
}

function setupZipcodeListener() {
    const zipInput = document.getElementById('zipcode');
    zipInput.addEventListener('blur', () => {
        const cep = zipInput.value.replace(/\D/g, '');
        if (cep.length === 8) {
            fetch(`https://viacep.com.br/ws/${cep}/json/`)
                .then(res => res.json())
                .then(data => {
                    if (!data.erro) {
                        document.getElementById('address').value = data.logradouro;
                        document.getElementById('neighborhood').value = data.bairro;
                        document.getElementById('city').value = data.localidade;
                        document.getElementById('state').value = data.uf;
                        document.getElementById('number').focus();
                    }
                });
        }
    });
}