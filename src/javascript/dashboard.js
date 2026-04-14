'use strict';

// ── Data ──────────────────────────────────────
const DATA = {
    departments: [
        { label: 'TI',             count: 38, color: '#4f46e5' },
        { label: 'RH',             count: 22, color: '#0891b2' },
        { label: 'Financeiro',     count: 28, color: '#16a34a' },
        { label: 'Marketing',      count: 19, color: '#ca8a04' },
        { label: 'Jurídico',       count: 14, color: '#9333ea' },
        { label: 'Administrativo', count: 27, color: '#64748b' },
    ],

    movement: {
        labels:       ['Nov', 'Dez', 'Jan', 'Fev', 'Mar', 'Abr'],
        admissions:   [6, 4, 8, 5, 7, 3],
        dismissals:   [2, 3, 1, 4, 2, 2],
    },

    employees: [
        { initials: 'AS', name: 'Ana Silva',        role: 'Desenvolvedora',  dept: 'TI',         status: 'ativo',   color: '#eef2ff', textColor: '#4f46e5' },
        { initials: 'CM', name: 'Carlos Mendes',    role: 'Analista',        dept: 'Financeiro',  status: 'ferias',  color: '#fef9c3', textColor: '#b45309' },
        { initials: 'JP', name: 'Julia Prado',      role: 'Designer',        dept: 'Marketing',   status: 'ativo',   color: '#fdf4ff', textColor: '#9333ea' },
        { initials: 'RC', name: 'Rafael Costa',     role: 'Advogado',        dept: 'Jurídico',    status: 'ativo',   color: '#ecfdf5', textColor: '#059669' },
        { initials: 'MO', name: 'Mariana Oliveira', role: 'Coordenadora',    dept: 'RH',          status: 'inativo', color: '#fff1f2', textColor: '#e11d48' },
    ],

    contracts: [
        { label: 'CLT',      count: 107, total: 148, color: '#4f46e5' },
        { label: 'PJ',       count: 26,  total: 148, color: '#0891b2' },
        { label: 'Estágio',  count: 10,  total: 148, color: '#ca8a04' },
        { label: 'Aprendiz', count: 5,   total: 148, color: '#9333ea' },
    ],

    activities: [
        { color: '#4f46e5', text: '<strong>Ana Silva</strong> foi cadastrada no sistema',          time: 'Hoje, 09:14' },
        { color: '#ca8a04', text: '<strong>Carlos Mendes</strong> entrou em férias',               time: 'Hoje, 08:30' },
        { color: '#dc2626', text: '<strong>Mariana Oliveira</strong> foi desligada',               time: 'Ontem, 17:45' },
        { color: '#16a34a', text: 'Salários de <strong>Março</strong> foram processados',         time: '11/04, 10:00' },
        { color: '#4f46e5', text: '<strong>Rafael Costa</strong> teve cargo atualizado',           time: '10/04, 14:22' },
    ],
};

// ── Helpers ───────────────────────────────────
function formatDate() {
    return new Intl.DateTimeFormat('pt-BR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }).format(new Date());
}

function animateCount(el) {
    const target = parseInt(el.dataset.count, 10);
    const duration = 900;
    const start = performance.now();
    function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(eased * target);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ── Intersection Observer for animations ──────
function initAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.classList.add('visible');
                    // trigger counters inside metric cards
                    entry.target.querySelectorAll('[data-count]').forEach(animateCount);
                }, i * 80);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('[data-animate]').forEach(el => observer.observe(el));
}

// ── Date ──────────────────────────────────────
function initDate() {
    const el = document.getElementById('current-date');
    if (el) el.textContent = formatDate();
}

// ── Sidebar toggle ────────────────────────────
function initSidebar() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    if (!toggle || !sidebar) return;

    const stored = localStorage.getItem('nexus-sidebar-collapsed');
    if (stored === 'true') sidebar.classList.add('collapsed');

    toggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('nexus-sidebar-collapsed', sidebar.classList.contains('collapsed'));
    });
}

// ── Render: Employee list ──────────────────────
function renderEmployees() {
    const el = document.getElementById('emp-list');
    if (!el) return;

    const badgeLabel = { ativo: 'Ativo', ferias: 'Férias', inativo: 'Inativo' };

    el.innerHTML = DATA.employees.map(emp => `
        <li class="emp-row">
            <div class="emp-avatar" style="background:${emp.color};color:${emp.textColor};">
                ${emp.initials}
            </div>
            <div class="emp-info">
                <p class="emp-name">${emp.name}</p>
                <p class="emp-role">${emp.role} · ${emp.dept}</p>
            </div>
            <span class="emp-badge badge-${emp.status}">${badgeLabel[emp.status]}</span>
        </li>
    `).join('');
}

// ── Render: Contract list ─────────────────────
function renderContracts() {
    const el = document.getElementById('contract-list');
    if (!el) return;

    el.innerHTML = DATA.contracts.map(c => {
        const pct = Math.round((c.count / c.total) * 100);
        return `
            <li class="contract-row">
                <span class="contract-label">${c.label}</span>
                <div class="contract-bar-bg">
                    <div class="contract-bar-fill" style="width:0%;background:${c.color};"
                         data-width="${pct}%"></div>
                </div>
                <span class="contract-count">${c.count}</span>
            </li>
        `;
    }).join('');

    // Animate bars after a tick
    setTimeout(() => {
        el.querySelectorAll('.contract-bar-fill').forEach(bar => {
            bar.style.width = bar.dataset.width;
        });
    }, 300);
}

// ── Render: Activity list ─────────────────────
function renderActivities() {
    const el = document.getElementById('activity-list');
    if (!el) return;

    el.innerHTML = DATA.activities.map(a => `
        <li class="activity-item">
            <div class="activity-dot" style="background:${a.color};"></div>
            <div class="activity-body">
                <p class="activity-text">${a.text}</p>
                <p class="activity-time">${a.time}</p>
            </div>
        </li>
    `).join('');
}

// ── Charts ────────────────────────────────────
function isDarkMode() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function chartDefaults() {
    const dark = isDarkMode();
    return {
        textColor: dark ? 'rgba(255,255,255,.5)'  : 'rgba(0,0,0,.45)',
        gridColor: dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)',
    };
}

function buildLegend(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = items.map(it => `
        <span class="legend-item">
            <span class="legend-dot" style="background:${it.color};"></span>
            ${it.label}
        </span>
    `).join('');
}

function initDeptChart() {
    const ctx = document.getElementById('deptChart');
    if (!ctx || typeof Chart === 'undefined') return;

    const { textColor, gridColor } = chartDefaults();
    const dept = DATA.departments;

    buildLegend('dept-legend', dept.map(d => ({ label: d.label, color: d.color })));

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dept.map(d => d.label),
            datasets: [{
                label: 'Colaboradores',
                data: dept.map(d => d.count),
                backgroundColor: dept.map(d => d.color),
                borderRadius: 6,
                borderSkipped: false,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.parsed.y} colaboradores`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: { color: textColor, font: { size: 11, family: 'DM Sans' } },
                    grid:  { display: false },
                    border: { display: false },
                },
                y: {
                    ticks: { color: textColor, font: { size: 11, family: 'DM Sans' }, stepSize: 10 },
                    grid:  { color: gridColor },
                    border: { display: false },
                },
            },
        },
    });
}

function initMoveChart() {
    const ctx = document.getElementById('moveChart');
    if (!ctx || typeof Chart === 'undefined') return;

    const { textColor, gridColor } = chartDefaults();
    const mv = DATA.movement;

    buildLegend('move-legend', [
        { label: 'Admissões',     color: '#4f46e5' },
        { label: 'Desligamentos', color: '#e11d48' },
    ]);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: mv.labels,
            datasets: [
                {
                    label: 'Admissões',
                    data: mv.admissions,
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79,70,229,.08)',
                    pointBackgroundColor: '#4f46e5',
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.4,
                    fill: true,
                    borderDash: [],
                },
                {
                    label: 'Desligamentos',
                    data: mv.dismissals,
                    borderColor: '#e11d48',
                    backgroundColor: 'rgba(225,29,72,.06)',
                    pointBackgroundColor: '#e11d48',
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0.4,
                    fill: true,
                    borderDash: [5, 3],
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    ticks: { color: textColor, font: { size: 11, family: 'DM Sans' } },
                    grid:  { display: false },
                    border: { display: false },
                },
                y: {
                    ticks: { color: textColor, font: { size: 11, family: 'DM Sans' }, stepSize: 2 },
                    grid:  { color: gridColor },
                    border: { display: false },
                    min: 0,
                },
            },
        },
    });
}

// ── Boot ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initDate();
    initSidebar();
    renderEmployees();
    renderContracts();
    renderActivities();
    initDeptChart();
    initMoveChart();
    initAnimations();
});




