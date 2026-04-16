let employees = JSON.parse(localStorage.getItem('nexus_employees')) || [];

document.addEventListener('DOMContentLoaded', () => {
    employees = JSON.parse(localStorage.getItem('nexus_employees')) || [];

    updateDashboardMetrics(); 
    
    updateContractTable(); 
    if (typeof renderContractChart === 'function') renderContractChart(); 
    if (typeof renderTable === 'function') renderTable(employees);
    if (typeof updateCount === 'function') updateCount();
    
    setupFormListener();
    if (typeof setupFilters === 'function') setupFilters();
});

function adicionarFuncionario(event) {
    event.preventDefault();

    const selectDept = document.getElementById('dept');
    const setorSelecionado = selectDept.options[selectDept.selectedIndex].text;
    
    const tipoContrato = document.getElementById('contract-type')?.value || 'Não Definido';

    const novoColaborador = {
        id: Date.now(),
        nome: document.getElementById('nome').value,
        department: setorSelecionado,
        status: document.getElementById('status')?.value || 'Ativo',
        contractType: tipoContrato, 
        dataCadastro: new Date().toLocaleDateString('pt-BR')
    };

    employees.push(novoColaborador);
    saveAndRefresh(); 

    event.target.reset();
}

function updateContractTable() {
    const container = document.getElementById('contract-table-container');
    if (!container) return;

    const contractCounts = employees.reduce((acc, emp) => {
        const type = emp.contractType || 'Não Definido';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
    }, {});

    const totalEmployees = employees.length;

    let tableHTML = `
        <table class="nexus-table">
            <thead>
                <tr>
                    <th>Categoria</th>
                    <th>Qtd. Colaboradores</th>
                    <th>Distribuição (%)</th>
                </tr>
            </thead>
            <tbody>
    `;

    Object.entries(contractCounts).forEach(([type, count]) => {
        const percentage = totalEmployees > 0 ? ((count / totalEmployees) * 100).toFixed(1) : 0;
        
        tableHTML += `
            <tr>
                <td><strong>${type}</strong></td>
                <td>${count}</td>
                <td>
                    <div class="progress-wrapper">
                        <div class="progress-bar" style="width: ${percentage}%"></div>
                        <span class="percentage-text">${percentage}%</span>
                    </div>
                </td>
            </tr>
        `;
    });

    tableHTML += `</tbody></table>`;
    container.innerHTML = tableHTML;
}

function updateDashboardMetrics() {
    const counts = employees.reduce((acc, emp) => {
        if (emp.status === 'Ativo') acc.ativos++;
        else if (emp.status === 'Férias') acc.ferias++;
        else if (emp.status === 'Inativo') acc.inativos++;
        
        const dept = emp.department || 'Não Informado';
        acc.depts[dept] = (acc.depts[dept] || 0) + 1;
        
        return acc;
    }, { ativos: 0, ferias: 0, inativos: 0, depts: {} });

    const elements = {
        'count-ativos': counts.ativos,
        'count-ferias': counts.ferias,
        'count-inativos': counts.inativos
    };

    for (const [id, value] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    renderDepartmentHeadcount(counts.depts);
}

function renderDepartmentHeadcount(depts) {
    const container = document.getElementById('department-list');
    if (!container) return;

    const deptsArray = Object.entries(depts);
    if (deptsArray.length === 0) {
        container.innerHTML = '<p class="empty-msg">Nenhum setor registrado.</p>';
        return;
    }

    deptsArray.sort((a, b) => a[0].localeCompare(b[0]));

    container.innerHTML = deptsArray.map(([name, total]) => `
        <div class="dept-headcount-item">
            <span class="dept-name">${name}</span>
            <span class="dept-total-badge">${total}</span>
        </div>
    `).join('');
}

function saveAndRefresh() {
    localStorage.setItem('nexus_employees', JSON.stringify(employees));
    
    updateDashboardMetrics();
    updateContractTable();
    
    if (typeof renderContractChart === 'function') renderContractChart();
    if (typeof renderTable === 'function') renderTable(employees);
    if (typeof updateCount === 'function') updateCount();
}

function setupFormListener() {
    const form = document.getElementById('employee-form');
    if (form) {
        form.addEventListener('submit', adicionarFuncionario);
    }
}