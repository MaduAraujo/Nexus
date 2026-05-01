/* ════════════════════════════════════════════
   dashboard.js — Dashboard RH
   ════════════════════════════════════════════ */

const EMPLOYEES_KEY = 'nexus_employees';
const VACATIONS_KEY = 'nexus_vacations';

let chartContracts = null;
let chartTurnover  = null;

document.addEventListener('DOMContentLoaded', () => {
    setCurrentDate();
    setupSidebar();
    loadRhSidebar();
    refreshAll();
    setupRealtimeSync();
});

function loadRhSidebar() {
    try {
        const s = JSON.parse(localStorage.getItem('nexus_session') || 'null');
        const nameEl   = document.getElementById('rh-sidebar-name');
        const roleEl   = document.getElementById('rh-sidebar-role');
        const avatarEl = document.getElementById('rh-sidebar-avatar');
        if (!nameEl) return;
        const name = (s && s.name) ? s.name : 'Administrador';
        const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'RH';
        nameEl.textContent   = name;
        if (roleEl)   roleEl.textContent   = 'Recursos Humanos';
        if (avatarEl) avatarEl.textContent = initials;
    } catch {}
}

/* ════════════════════════════
   Storage helpers
════════════════════════════ */
function getEmployees() {
    try { return JSON.parse(localStorage.getItem(EMPLOYEES_KEY)) || []; } catch { return []; }
}
function getVacations() {
    try { return JSON.parse(localStorage.getItem(VACATIONS_KEY)) || []; } catch { return []; }
}

/* ════════════════════════════
   Refresh all
════════════════════════════ */
function refreshAll() {
    const employees = getEmployees();
    const vacations = getVacations();
    updateMetrics(employees, vacations);
    updateContractChart(employees);
    updateTurnoverChart(employees);
    renderDepartmentHeadcount(employees);
}

/* ════════════════════════════
   Date header
════════════════════════════ */
function setCurrentDate() {
    const el = document.getElementById('current-date');
    if (!el) return;
    el.textContent = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
}

/* ════════════════════════════
   Metrics cards
════════════════════════════ */
function updateMetrics(employees, vacations) {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const ativos   = employees.filter(e => e.status === 'Ativo').length;
    const inativos = employees.filter(e => e.status === 'Inativo').length;

    // "Em Férias": aprovadas com período ativo hoje (nexus_vacations como fonte de verdade)
    const emFerias = vacations.filter(v => {
        if (v.status !== 'aprovado') return false;
        const start = new Date(v.startDate + 'T00:00:00');
        const end   = new Date(v.endDate   + 'T00:00:00');
        return start <= today && today <= end;
    }).length;

    setText('count-ativos',   ativos);
    setText('count-ferias',   emFerias);
    setText('count-inativos', inativos);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

/* ════════════════════════════
   Department headcount
════════════════════════════ */
function renderDepartmentHeadcount(employees) {
    const container = document.getElementById('department-list');
    if (!container) return;

    const depts = employees
        .filter(e => e.status !== 'Inativo')
        .reduce((acc, e) => {
            const d = e.dept || e.department || 'Não Informado';
            acc[d] = (acc[d] || 0) + 1;
            return acc;
        }, {});

    const entries = Object.entries(depts).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.innerHTML = '<p class="empty-msg">Nenhum setor registrado.</p>';
        return;
    }

    container.innerHTML = entries.map(([name, total]) => `
        <div class="dept-headcount-item">
            <span class="dept-name">${name}</span>
            <span class="dept-total-badge">${total}</span>
        </div>
    `).join('');
}

/* ════════════════════════════
   Tipo de Contrato (donut)
════════════════════════════ */
function updateContractChart(employees) {
    const canvas = document.getElementById('chart-contracts');
    if (!canvas || typeof Chart === 'undefined') return;

    const counts = employees
        .filter(e => e.status !== 'Inativo')
        .reduce((acc, e) => {
            const type = e.contractType || 'Não Definido';
            acc[type] = (acc[type] || 0) + 1;
            return acc;
        }, {});

    const labels = Object.keys(counts);
    const data   = Object.values(counts);
    const colors = ['#6366f1', '#22c55e', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316'];

    if (chartContracts) { chartContracts.destroy(); chartContracts = null; }

    if (labels.length === 0) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = '';

    chartContracts = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#fff',
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: { size: 12 }, padding: 16, usePointStyle: true }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${ctx.parsed} colaborador${ctx.parsed !== 1 ? 'es' : ''}`
                    }
                }
            }
        }
    });
}

/* ════════════════════════════
   Admissões vs Desligamentos (barras)
════════════════════════════ */
function updateTurnoverChart(employees) {
    const canvas = document.getElementById('chart-turnover');
    if (!canvas || typeof Chart === 'undefined') return;

    const today = new Date();
    const labels      = [];
    const admissions  = [];
    const terminations = [];

    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth();

        labels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));

        admissions.push(employees.filter(e => {
            if (!e.admissionDate) return false;
            const adm = new Date(e.admissionDate + 'T00:00:00');
            return adm.getFullYear() === y && adm.getMonth() === m;
        }).length);

        terminations.push(employees.filter(e => {
            if (!e.terminationDate) return false;
            const term = new Date(e.terminationDate + 'T00:00:00');
            return term.getFullYear() === y && term.getMonth() === m;
        }).length);
    }

    if (chartTurnover) { chartTurnover.destroy(); chartTurnover = null; }

    chartTurnover = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Admissões',
                    data: admissions,
                    backgroundColor: 'rgba(99, 102, 241, 0.85)',
                    borderRadius: 6,
                    borderSkipped: false
                },
                {
                    label: 'Desligamentos',
                    data: terminations,
                    backgroundColor: 'rgba(239, 68, 68, 0.85)',
                    borderRadius: 6,
                    borderSkipped: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: { size: 12 }, padding: 16, usePointStyle: true }
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

/* ════════════════════════════
   Realtime sync
════════════════════════════ */
function setupRealtimeSync() {
    window.addEventListener('storage', (e) => {
        if (e.key === EMPLOYEES_KEY || e.key === VACATIONS_KEY) {
            refreshAll();
        }
    });
}

/* ════════════════════════════
   Sidebar
════════════════════════════ */
function setupSidebar() {
    const sidebar    = document.getElementById('sidebar');
    const toggleBtn  = document.getElementById('sidebar-toggle');
    const menuBtn    = document.getElementById('topbar-menu-btn');
    const overlay    = document.getElementById('sidebar-overlay');
    const wrapper    = document.getElementById('main-wrapper');
    if (!sidebar) return;

    const isMobile = () => window.innerWidth <= 768;

    const openMobile  = () => { sidebar.classList.add('open');    overlay?.classList.add('active'); };
    const closeMobile = () => { sidebar.classList.remove('open'); overlay?.classList.remove('active'); };

    toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isMobile()) {
            sidebar.classList.contains('open') ? closeMobile() : openMobile();
        } else {
            const col = sidebar.classList.toggle('collapsed');
            wrapper?.classList.toggle('sidebar-collapsed', col);
        }
    });

    menuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.contains('open') ? closeMobile() : openMobile();
    });

    overlay?.addEventListener('click', closeMobile);

    window.addEventListener('resize', () => { if (!isMobile()) closeMobile(); });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isMobile()) closeMobile(); });
}

/* ════════════════════════════
   Stubs de compatibilidade
════════════════════════════ */
function updateDashboardMetrics() { refreshAll(); }
function updateContractTable()    { refreshAll(); }
function saveAndRefresh()         { refreshAll(); }
function setupFormListener()      {}
function renderContractChart()    { refreshAll(); }
