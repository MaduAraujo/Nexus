let chartContracts = null;
let chartTurnover = null;
let chartTenure = null;
let chartPayroll = null;
let chartOvertime = null;
let chartAge = null;
let chartGender = null;
let chartDepartment = null;
let chartDeptTurnover = null;
let chartDeptReadRate = null;
let chartReadTime = null;
let chartRace = null;
let employees = [];
let vacations = [];
let payslips = [];
let bankAdjustments = [];
let messages = [];
let messageReads = [];

const PALETTE = {
    indigo: '#6366f1',
    indigoDeep: '#4338ca',
    violet: '#8b5cf6',
    sky: '#38bdf8',
    amber: '#f59e0b',
    rose: '#f43f5e',
    teal: '#14b8a6',
    slate: '#64748b',
};

const CONTRACT_COLORS = {
    CLT: PALETTE.indigo,
    'CLT - Prazo Indeterminado': PALETTE.indigo,
    'CLT-indeterminado': PALETTE.indigo,
    'CLT - Prazo Determinado': PALETTE.sky,
    'CLT-determinado': PALETTE.sky,
    PJ: PALETTE.violet,
    Estágio: PALETTE.teal,
    Aprendiz: PALETTE.amber,
    Temporário: PALETTE.rose,
};

const DEPT_LABEL_SHORT = { Administrativo: 'Adm' };
function deptLabel(name) {
    return DEPT_LABEL_SHORT[name] || name;
}

function setupChartTheme() {
    if (typeof Chart === 'undefined' || Chart.__nexusThemed) return;
    Chart.__nexusThemed = true;
    Chart.defaults.font.family = "'DM Sans', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#6b7280';
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(17,17,23,.94)';
    Chart.defaults.plugins.tooltip.titleFont = { family: "'Plus Jakarta Sans', sans-serif", weight: '700', size: 12 };
    Chart.defaults.plugins.tooltip.bodyFont = { family: "'DM Sans', sans-serif", size: 12 };
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.displayColors = false;
    Chart.defaults.plugins.tooltip.caretSize = 6;
    Chart.register({
        id: 'centerText',
        afterDraw(chart) {
            const cfg = chart.config.options.plugins?.centerText;
            if (!cfg) return;
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            const cx = chartArea.left + (chartArea.right - chartArea.left) / 2;
            const cy = chartArea.top + (chartArea.bottom - chartArea.top) / 2;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = "700 24px 'Plus Jakarta Sans', sans-serif";
            ctx.fillStyle = '#1f2937';
            ctx.fillText(cfg.value, cx, cy - 9);
            ctx.font = "600 10px 'Plus Jakarta Sans', sans-serif";
            ctx.fillStyle = '#9ca3af';
            ctx.fillText(cfg.label, cx, cy + 11);
            ctx.restore();
        },
    });
    Chart.register({
        id: 'valueLabels',
        afterDatasetsDraw(chart) {
            if (!chart.config.options.plugins?.valueLabels) return;
            const { ctx } = chart;
            ctx.save();
            ctx.font = "700 10px 'Plus Jakarta Sans', sans-serif";
            ctx.textAlign = 'center';
            chart.data.datasets.forEach((ds, dsIndex) => {
                const meta = chart.getDatasetMeta(dsIndex);
                if (meta.hidden) return;
                meta.data.forEach((el, i) => {
                    const value = ds.data[i];
                    if (value === null || value === undefined || value === 0) return;
                    if (ds.type === 'line') {
                        ctx.fillStyle = ds.borderColor;
                        ctx.fillText(value > 0 ? `+${value}` : `${value}`, el.x, el.y + (value >= 0 ? -10 : 16));
                    } else {
                        ctx.fillStyle = '#4b5563';
                        ctx.fillText(`${value}`, el.x, el.y - 6);
                    }
                });
            });
            ctx.restore();
        },
    });
}

function verticalGradient(colorTop, colorBottom) {
    return (ctx) => {
        const { chartArea } = ctx.chart;
        if (!chartArea) return colorTop;
        const g = ctx.chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        g.addColorStop(0, colorTop);
        g.addColorStop(1, colorBottom);
        return g;
    };
}

function horizontalGradient(colorLeft, colorRight) {
    return (ctx) => {
        const { chartArea } = ctx.chart;
        if (!chartArea) return colorLeft;
        const g = ctx.chart.ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
        g.addColorStop(0, colorLeft);
        g.addColorStop(1, colorRight);
        return g;
    };
}

document.addEventListener('DOMContentLoaded', async () => {
    setupChartTheme();
    setupSidebar();
    await loadRhSidebar();
    await loadData();
    refreshAll();
    setupRealtimeSync();
    setupExportButton();
});

async function loadRhSidebar() {
    const auth = await NexusAuth.requireProfile('Administrador');
    if (!auth) return;
    setText('rh-sidebar-name', 'Administrador');
    setText('rh-sidebar-role', 'Recursos Humanos');
    setText('rh-sidebar-avatar', 'ADM');
}

async function loadData() {
    const [{ data: empData }, { data: vacData }, { data: paySlipData }, { data: bankAdjData }, { data: msgData }, { data: readData }] = await Promise.all([
        sb.from('employees').select('id,name,dept,status,contract_type,admission_date,termination_date,email,birth_date,gender,salary,pcd,raca_cor'),
        sb.from('vacations').select('id,employee_id,start_date,end_date,status'),
        sb.from('payslips').select('mes,total_proventos,salario_liquido'),
        sb.from('bank_adjustments').select('employee_id,tipo,minutos,date').is('deleted_at', null),
        sb.from('messages').select('id,texto,destino,categoria,created_at,scheduled_at'),
        sb.from('message_reads').select('message_id,employee_id,read_at'),
    ]);
    employees = (empData || []).map((e) => ({
        id: e.id,
        name: e.name,
        dept: e.dept,
        status: e.status,
        contractType: e.contract_type,
        admissionDate: e.admission_date,
        terminationDate: e.termination_date,
        email: e.email,
        birthDate: e.birth_date,
        gender: e.gender,
        salary: e.salary,
        pcd: e.pcd,
        racaCor: e.raca_cor,
    }));
    vacations = (vacData || []).map((v) => ({
        id: v.id,
        employeeId: v.employee_id,
        startDate: v.start_date,
        endDate: v.end_date,
        status: v.status,
    }));
    payslips = paySlipData || [];
    bankAdjustments = bankAdjData || [];
    messages = msgData || [];
    messageReads = readData || [];
}

function refreshAll() {
    updateMetrics();
    updateContractChart();
    updateTurnoverChart();
    updateDepartmentChart();
    updateTurnoverRate();
    updateAbsenteeism();
    updateTenureChart();
    updateAgeChart();
    updateGenderChart();
    updateGenderEquity();
    updateRaceEquity();
    updatePcdQuota();
    updateRaceChart();
    updatePayrollChart();
    updateOvertimeChart();
    updateDeptTurnoverChart();
    updateDeptReadRateChart();
    updateReadTimeChart();
    updateLowAdoptionList();
}

function updateMetrics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const ativos = employees.filter((e) => e.status === 'Ativo').length;
    const inativos = employees.filter((e) => e.status === 'Inativo').length;
    const afastados = employees.filter((e) => e.status === 'Afastado').length;
    const emFerias = vacations.filter((v) => {
        if (v.status !== 'aprovado') return false;
        const s = new Date(v.startDate + 'T00:00:00');
        const e = new Date(v.endDate + 'T00:00:00');
        return s <= today && today <= e;
    }).length;

    setText('count-ativos', ativos);
    setText('count-ferias', emFerias);
    setText('count-inativos', inativos);
    setText('count-afastados', afastados);

    const admThisMonth = employees.filter((e) => e.admissionDate && new Date(e.admissionDate + 'T00:00:00') >= thisMonthStart).length;
    const termThisMonth = employees.filter((e) => e.terminationDate && new Date(e.terminationDate + 'T00:00:00') >= thisMonthStart).length;
    const feriasThisMonth = vacations.filter((v) => v.status === 'aprovado' && v.startDate && new Date(v.startDate + 'T00:00:00') >= thisMonthStart).length;

    const deltaAtivosEl = document.getElementById('delta-ativos');
    const deltaFeriasEl = document.getElementById('delta-ferias');
    const deltaInativosEl = document.getElementById('delta-inativos');
    if (deltaAtivosEl) {
        deltaAtivosEl.textContent = admThisMonth > 0 ? `+${admThisMonth} admissão(ões) este mês` : '';
        deltaAtivosEl.className = admThisMonth > 0 ? 'card-delta up' : 'card-delta';
    }
    if (deltaFeriasEl) {
        deltaFeriasEl.textContent = feriasThisMonth > 0 ? `${feriasThisMonth} início(s) este mês` : '';
        deltaFeriasEl.className = 'card-delta';
    }
    if (deltaInativosEl) {
        deltaInativosEl.textContent = termThisMonth > 0 ? `+${termThisMonth} desligamento(s) este mês` : '';
        deltaInativosEl.className = termThisMonth > 0 ? 'card-delta down' : 'card-delta';
    }
}

function setKpiLevel(el, rate, [goodMax, warnMax]) {
    el.classList.remove('kpi-good', 'kpi-warn', 'kpi-bad');
    if (rate <= goodMax) el.classList.add('kpi-good');
    else if (rate <= warnMax) el.classList.add('kpi-warn');
    else el.classList.add('kpi-bad');
}

function updateTurnoverRate() {
    const el = document.getElementById('turnover-rate');
    if (!el) return;
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
    const desligamentos = employees.filter((e) => e.terminationDate && new Date(e.terminationDate + 'T00:00:00') >= twelveMonthsAgo).length;
    if (!employees.length) {
        el.textContent = '—';
        return;
    }
    const rate = (desligamentos / employees.length) * 100;
    el.textContent = `${rate.toFixed(1)}%`;
    setKpiLevel(el, rate, [10, 20]);
}

async function updateAbsenteeism() {
    const el = document.getElementById('absenteeism-rate');
    if (!el) return;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ativos = employees.filter((e) => e.status === 'Ativo');
    if (!ativos.length) {
        el.textContent = '—';
        return;
    }

    const { data: records } = await sb
        .from('time_records')
        .select('employee_id, date, entrada')
        .in(
            'employee_id',
            ativos.map((e) => e.id)
        )
        .gte('date', `${monthKey}-01`)
        .lte('date', `${monthKey}-${String(now.getDate()).padStart(2, '0')}`);

    const presentSet = new Set((records || []).filter((r) => r.entrada).map((r) => `${r.employee_id}_${r.date}`));

    let totalWorkDays = 0,
        totalAbsences = 0;
    for (let d = 1; d <= now.getDate(); d++) {
        const dateStr = `${monthKey}-${String(d).padStart(2, '0')}`;
        const dt = new Date(dateStr + 'T12:00:00');
        const dow = dt.getDay();
        if (dow === 0 || dow === 6) continue;
        ativos.forEach((emp) => {
            totalWorkDays++;
            if (!presentSet.has(`${emp.id}_${dateStr}`)) totalAbsences++;
        });
    }

    if (!totalWorkDays) {
        el.textContent = '—';
        return;
    }
    const rate = (totalAbsences / totalWorkDays) * 100;
    el.textContent = `${rate.toFixed(1)}%`;
    setKpiLevel(el, rate, [3, 6]);
}

function updateDepartmentChart() {
    const canvas = document.getElementById('chart-department');
    if (!canvas || typeof Chart === 'undefined') return;
    const activeEmployees = employees.filter((e) => e.status !== 'Inativo');
    const counts = activeEmployees.reduce((acc, e) => {
        const d = e.dept || 'Não Informado';
        acc[d] = (acc[d] || 0) + 1;
        return acc;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => a[1] - b[1]);
    const labels = entries.map((e) => deptLabel(e[0]));
    const data = entries.map((e) => e[1]);
    const total = activeEmployees.length;

    const container = canvas.closest('.chart-container');
    if (container) container.style.height = `${Math.max(220, labels.length * 40 + 40)}px`;

    if (chartDepartment) {
        chartDepartment.destroy();
        chartDepartment = null;
    }
    if (!labels.length) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = '';

    chartDepartment = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: horizontalGradient('#a5b4fc', PALETTE.indigo),
                    borderRadius: 6,
                    borderSkipped: false,
                    barPercentage: 0.62,
                    categoryPercentage: 0.8,
                },
            ],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const pct = total ? ((ctx.parsed.x / total) * 100).toFixed(0) : 0;
                            return ` ${ctx.parsed.x} colaborador${ctx.parsed.x !== 1 ? 'es' : ''} (${pct}%)`;
                        },
                    },
                },
            },
            scales: {
                x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.05)' } },
                y: { grid: { display: false }, ticks: { font: { weight: '500' } } },
            },
        },
    });
}

function updateContractChart() {
    const canvas = document.getElementById('chart-contracts');
    if (!canvas || typeof Chart === 'undefined') return;
    const activeEmployees = employees.filter((e) => e.status !== 'Inativo');
    const counts = activeEmployees.reduce((acc, e) => {
        const t = e.contractType || 'Não Definido';
        acc[t] = (acc[t] || 0) + 1;
        return acc;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = entries.map((e) => e[0]);
    const data = entries.map((e) => e[1]);
    const fallbackColors = [PALETTE.slate, '#c084fc', '#fb7185'];
    let fallbackIdx = 0;
    const colors = labels.map((l) => CONTRACT_COLORS[l] || fallbackColors[fallbackIdx++ % fallbackColors.length]);
    const total = activeEmployees.length;
    if (chartContracts) {
        chartContracts.destroy();
        chartContracts = null;
    }
    if (!labels.length) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = '';
    chartContracts = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#fff', hoverOffset: 10, hoverBorderWidth: 3 }] },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '72%',
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 12, weight: '500' }, padding: 16, usePointStyle: true, pointStyle: 'circle' } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const pct = total ? ((ctx.parsed / total) * 100).toFixed(0) : 0;
                            return ` ${ctx.label}: ${ctx.parsed} colaborador${ctx.parsed !== 1 ? 'es' : ''} (${pct}%)`;
                        },
                    },
                },
                centerText: { value: activeEmployees.length, label: 'COLABORADORES' },
            },
        },
    });
}

function updateTurnoverChart() {
    const canvas = document.getElementById('chart-turnover');
    if (!canvas || typeof Chart === 'undefined') return;
    const today = new Date();
    const labels = [],
        admissions = [],
        terminations = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const y = d.getFullYear(),
            m = d.getMonth();
        labels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
        admissions.push(
            employees.filter((e) => {
                if (!e.admissionDate) return false;
                const dt = new Date(e.admissionDate + 'T00:00:00');
                return dt.getFullYear() === y && dt.getMonth() === m;
            }).length
        );
        terminations.push(
            employees.filter((e) => {
                if (!e.terminationDate) return false;
                const dt = new Date(e.terminationDate + 'T00:00:00');
                return dt.getFullYear() === y && dt.getMonth() === m;
            }).length
        );
    }
    if (chartTurnover) {
        chartTurnover.destroy();
        chartTurnover = null;
    }
    chartTurnover = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Admissões',
                    data: admissions,
                    backgroundColor: verticalGradient('#4ade80', '#16a34a'),
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 26,
                },
                {
                    label: 'Desligamentos',
                    data: terminations,
                    backgroundColor: verticalGradient('#fca5a5', '#dc2626'),
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 26,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 12, weight: '500' }, padding: 16, usePointStyle: true, pointStyle: 'circle' } },
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.05)' } },
                x: { grid: { display: false } },
            },
        },
    });
}

function updateTenureChart() {
    const canvas = document.getElementById('chart-tenure');
    if (!canvas || typeof Chart === 'undefined') return;
    const today = new Date();
    const buckets = { '< 1 ano': 0, '1–3 anos': 0, '3–5 anos': 0, '5+ anos': 0 };
    employees
        .filter((e) => e.status === 'Ativo' && e.admissionDate)
        .forEach((e) => {
            const years = (today - new Date(e.admissionDate + 'T00:00:00')) / (1000 * 60 * 60 * 24 * 365.25);
            if (years < 1) buckets['< 1 ano']++;
            else if (years < 3) buckets['1–3 anos']++;
            else if (years < 5) buckets['3–5 anos']++;
            else buckets['5+ anos']++;
        });
    const labels = Object.keys(buckets),
        data = Object.values(buckets);
    const barColors = ['#c7d2fe', '#a5b4fc', '#818cf8', PALETTE.indigo];
    if (chartTenure) {
        chartTenure.destroy();
        chartTenure = null;
    }
    chartTenure = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ data, backgroundColor: barColors, borderRadius: 6, borderSkipped: false, barPercentage: 0.62, categoryPercentage: 0.85 }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.x} colaborador${ctx.parsed.x !== 1 ? 'es' : ''}` } },
            },
            scales: {
                x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.05)' } },
                y: { grid: { display: false } },
            },
        },
    });
}

function calcAge(birthDateStr, today) {
    const b = new Date(birthDateStr + 'T00:00:00');
    let age = today.getFullYear() - b.getFullYear();
    const m = today.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
    return age;
}

function updateAgeChart() {
    const canvas = document.getElementById('chart-age');
    if (!canvas || typeof Chart === 'undefined') return;
    const today = new Date();
    const buckets = { '18–25': 0, '26–35': 0, '36–45': 0, '46–55': 0, '56+': 0 };
    employees
        .filter((e) => e.status === 'Ativo' && e.birthDate)
        .forEach((e) => {
            const age = calcAge(e.birthDate, today);
            if (age <= 25) buckets['18–25']++;
            else if (age <= 35) buckets['26–35']++;
            else if (age <= 45) buckets['36–45']++;
            else if (age <= 55) buckets['46–55']++;
            else buckets['56+']++;
        });
    const labels = Object.keys(buckets),
        data = Object.values(buckets);
    const barColors = ['#c7d2fe', '#a5b4fc', '#818cf8', PALETTE.indigo, PALETTE.indigoDeep];
    if (chartAge) {
        chartAge.destroy();
        chartAge = null;
    }
    chartAge = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ data, backgroundColor: barColors, borderRadius: 6, borderSkipped: false, barPercentage: 0.62, categoryPercentage: 0.85 }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y} colaborador${ctx.parsed.y !== 1 ? 'es' : ''}` } },
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.05)' } },
            },
        },
    });
}

function updateGenderChart() {
    const canvas = document.getElementById('chart-gender');
    if (!canvas || typeof Chart === 'undefined') return;
    const activeEmployees = employees.filter((e) => e.status === 'Ativo' && e.gender);
    const counts = activeEmployees.reduce((acc, e) => {
        acc[e.gender] = (acc[e.gender] || 0) + 1;
        return acc;
    }, {});
    const labels = Object.keys(counts);
    const data = Object.values(counts);
    const colorMap = { Masculino: PALETTE.sky, Feminino: PALETTE.rose, Outro: PALETTE.violet };
    const colors = labels.map((l) => colorMap[l] || PALETTE.slate);
    if (chartGender) {
        chartGender.destroy();
        chartGender = null;
    }
    if (!labels.length) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = '';
    chartGender = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#fff', hoverOffset: 10, hoverBorderWidth: 3 }] },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '72%',
            plugins: {
                legend: { position: 'bottom', labels: { font: { size: 12, weight: '500' }, padding: 16, usePointStyle: true, pointStyle: 'circle' } },
                tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} colaborador${ctx.parsed !== 1 ? 'es' : ''}` } },
                centerText: { value: activeEmployees.length, label: 'COLABORADORES' },
            },
        },
    });
}

const RACA_COLORS = {
    Branca: PALETTE.sky,
    Preta: PALETTE.indigoDeep,
    Parda: PALETTE.amber,
    Amarela: PALETTE.teal,
    Indígena: PALETTE.rose,
    'Prefiro não declarar': PALETTE.slate,
};

function fmtBRL(v) {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function updateGenderEquity() {
    const body = document.getElementById('equity-gender-body');
    if (!body) return;
    const withData = employees.filter((e) => e.status === 'Ativo' && e.gender && e.salary > 0);
    const byGender = withData.reduce((acc, e) => {
        (acc[e.gender] || (acc[e.gender] = [])).push(e.salary);
        return acc;
    }, {});
    const avg = Object.fromEntries(Object.entries(byGender).map(([g, salaries]) => [g, salaries.reduce((s, v) => s + v, 0) / salaries.length]));
    const genders = Object.keys(avg);

    if (genders.length < 2) {
        body.innerHTML = `<p class="equity-note">Dados insuficientes: é necessário salário e gênero cadastrados para ao menos dois grupos para calcular o gap salarial.</p>`;
        return;
    }

    const highest = genders.reduce((a, b) => (avg[a] >= avg[b] ? a : b));
    const gaps = genders.filter((g) => g !== highest).map((g) => ({ g, gap: ((avg[highest] - avg[g]) / avg[highest]) * 100 }));
    const worstGap = gaps.reduce((a, b) => (a.gap >= b.gap ? a : b));
    const level = worstGap.gap >= 15 ? 'bad' : worstGap.gap >= 5 ? 'warn' : 'good';

    const colorMap = { Masculino: PALETTE.sky, Feminino: PALETTE.rose, Outro: PALETTE.violet };
    const breakdown = genders
        .sort((a, b) => avg[b] - avg[a])
        .map(
            (g) =>
                `<div class="equity-breakdown-row"><span class="equity-dot" style="background:${colorMap[g] || PALETTE.slate}"></span>${escHtml(g)}<strong>${fmtBRL(avg[g])}</strong></div>`
        )
        .join('');

    body.innerHTML = `
        <div class="equity-stat">
            <span class="equity-stat-value equity-stat--${level}">${worstGap.gap.toFixed(1)}%</span>
            <span class="equity-stat-label">gap salarial: ${escHtml(highest)} ganha mais que ${escHtml(worstGap.g)}</span>
        </div>
        <div class="equity-breakdown">${breakdown}</div>`;
}

function updateRaceEquity() {
    const body = document.getElementById('equity-race-body');
    if (!body) return;
    const withData = employees.filter((e) => e.status === 'Ativo' && e.racaCor && e.salary > 0);
    const byRace = withData.reduce((acc, e) => {
        (acc[e.racaCor] || (acc[e.racaCor] = [])).push(e.salary);
        return acc;
    }, {});
    const avg = Object.fromEntries(Object.entries(byRace).map(([r, salaries]) => [r, salaries.reduce((s, v) => s + v, 0) / salaries.length]));
    const races = Object.keys(avg);

    if (races.length < 2) {
        body.innerHTML = `<p class="equity-note">Dados insuficientes: é necessário salário e raça/cor cadastrados para ao menos dois grupos para calcular o gap salarial.</p>`;
        return;
    }

    const highest = races.reduce((a, b) => (avg[a] >= avg[b] ? a : b));
    const gaps = races.filter((r) => r !== highest).map((r) => ({ r, gap: ((avg[highest] - avg[r]) / avg[highest]) * 100 }));
    const worstGap = gaps.reduce((a, b) => (a.gap >= b.gap ? a : b));
    const level = worstGap.gap >= 15 ? 'bad' : worstGap.gap >= 5 ? 'warn' : 'good';

    const breakdown = races
        .sort((a, b) => avg[b] - avg[a])
        .map(
            (r) =>
                `<div class="equity-breakdown-row"><span class="equity-dot" style="background:${RACA_COLORS[r] || PALETTE.slate}"></span>${escHtml(r)}<strong>${fmtBRL(avg[r])}</strong></div>`
        )
        .join('');

    body.innerHTML = `
        <div class="equity-stat">
            <span class="equity-stat-value equity-stat--${level}">${worstGap.gap.toFixed(1)}%</span>
            <span class="equity-stat-label">gap salarial: ${escHtml(highest)} ganha mais que ${escHtml(worstGap.r)}</span>
        </div>
        <div class="equity-breakdown">${breakdown}</div>`;
}

function pcdQuotaPct(headcount) {
    if (headcount < 100) return null;
    if (headcount <= 200) return 2;
    if (headcount <= 500) return 3;
    if (headcount <= 1000) return 4;
    return 5;
}

function updatePcdQuota() {
    const body = document.getElementById('equity-pcd-body');
    if (!body) return;
    const ativos = employees.filter((e) => e.status === 'Ativo');
    const total = ativos.length;
    const pcdCount = ativos.filter((e) => e.pcd).length;
    const pct = total ? (pcdCount / total) * 100 : 0;
    const required = pcdQuotaPct(total);

    if (required === null) {
        body.innerHTML = `
            <div class="equity-stat">
                <span class="equity-stat-value">${pct.toFixed(1)}%</span>
                <span class="equity-stat-label">${pcdCount} de ${total} colaboradores PCD</span>
            </div>
            <p class="equity-note">Sem obrigatoriedade legal (Lei 8.213/91, art. 93) para empresas com menos de 100 colaboradores ativos.</p>`;
        return;
    }

    const atende = pct >= required;
    const level = atende ? 'good' : pct >= required * 0.5 ? 'warn' : 'bad';
    body.innerHTML = `
        <div class="equity-stat">
            <span class="equity-stat-value equity-stat--${level}">${pct.toFixed(1)}%</span>
            <span class="equity-stat-label">${pcdCount} de ${total} colaboradores PCD</span>
        </div>
        <p class="equity-note">Cota legal mínima (Lei 8.213/91, art. 93): <strong>${required}%</strong> — <strong class="equity-status--${atende ? 'good' : 'bad'}">${atende ? 'Atende' : 'Não atende'}</strong></p>`;
}

function updateRaceChart() {
    const canvas = document.getElementById('chart-race');
    if (!canvas || typeof Chart === 'undefined') return;
    const activeEmployees = employees.filter((e) => e.status === 'Ativo');
    const counts = activeEmployees.reduce((acc, e) => {
        const r = e.racaCor || 'Não Informado';
        acc[r] = (acc[r] || 0) + 1;
        return acc;
    }, {});
    const entries = Object.entries(counts).sort((a, b) => a[1] - b[1]);
    const labels = entries.map((e) => e[0]);
    const data = entries.map((e) => e[1]);
    const colors = labels.map((l) => RACA_COLORS[l] || PALETTE.slate);
    const total = activeEmployees.length;

    const container = canvas.closest('.chart-container');
    if (container) container.style.height = `${Math.max(220, labels.length * 40 + 40)}px`;

    if (chartRace) {
        chartRace.destroy();
        chartRace = null;
    }
    if (!labels.length) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = '';

    chartRace = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: colors,
                    borderRadius: 6,
                    borderSkipped: false,
                    barPercentage: 0.62,
                    categoryPercentage: 0.8,
                },
            ],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const pct = total ? ((ctx.parsed.x / total) * 100).toFixed(0) : 0;
                            return ` ${ctx.parsed.x} colaborador${ctx.parsed.x !== 1 ? 'es' : ''} (${pct}%)`;
                        },
                    },
                },
            },
            scales: {
                x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,.05)' } },
                y: { grid: { display: false }, ticks: { font: { weight: '500' } } },
            },
        },
    });
}

function updatePayrollChart() {
    const canvas = document.getElementById('chart-payroll');
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, values } = last6Months((y, m, key) => payslips.filter((p) => p.mes === key).reduce((s, p) => s + (Number(p.salario_liquido) || 0), 0));
    const withData = values.filter((v) => v > 0);
    const avg = withData.length ? withData.reduce((s, v) => s + v, 0) / withData.length : 0;
    const fmt = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    if (chartPayroll) {
        chartPayroll.destroy();
        chartPayroll = null;
    }
    chartPayroll = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Custo de folha',
                    data: values,
                    borderColor: PALETTE.indigo,
                    borderWidth: 2.5,
                    backgroundColor: (ctx) => {
                        const { chartArea } = ctx.chart;
                        if (!chartArea) return 'rgba(99,102,241,.12)';
                        const g = ctx.chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        g.addColorStop(0, 'rgba(99,102,241,.32)');
                        g.addColorStop(1, 'rgba(99,102,241,0)');
                        return g;
                    },
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3.5,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: PALETTE.indigo,
                    pointBorderWidth: 2,
                    order: 2,
                },
                {
                    label: 'Média (6 meses)',
                    data: Array(labels.length).fill(avg),
                    borderColor: 'rgba(100,116,139,.55)',
                    borderWidth: 1.5,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    fill: false,
                    tension: 0,
                    order: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.dataset.label !== 'Custo de folha') return ` Média: R$ ${fmt(ctx.parsed.y)}`;
                            const prev = values[ctx.dataIndex - 1];
                            let delta = '';
                            if (prev > 0) {
                                const pct = ((ctx.parsed.y - prev) / prev) * 100;
                                delta = ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs mês anterior)`;
                            }
                            return ` R$ ${fmt(ctx.parsed.y)}${delta}`;
                        },
                    },
                },
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => `R$ ${(v / 1000).toFixed(0)}k` }, grid: { color: 'rgba(0,0,0,.05)' } },
                x: { grid: { display: false } },
            },
        },
    });
}

function updateOvertimeChart() {
    const canvas = document.getElementById('chart-overtime');
    if (!canvas || typeof Chart === 'undefined') return;
    const { labels, values } = last6Months((y, m) => {
        const minutes = bankAdjustments
            .filter((a) => {
                if (a.tipo !== 'credito' || !a.date) return false;
                const dt = new Date(a.date + 'T00:00:00');
                return dt.getFullYear() === y && dt.getMonth() === m;
            })
            .reduce((s, a) => s + (a.minutos || 0), 0);
        return +(minutes / 60).toFixed(1);
    });
    if (chartOvertime) {
        chartOvertime.destroy();
        chartOvertime = null;
    }
    chartOvertime = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Horas creditadas',
                    data: values,
                    backgroundColor: verticalGradient('#fcd34d', PALETTE.amber),
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 30,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y}h` } } },
            scales: { y: { beginAtZero: true, ticks: { callback: (v) => `${v}h` }, grid: { color: 'rgba(0,0,0,.05)' } }, x: { grid: { display: false } } },
        },
    });
}

function last6Months(valueFn) {
    const today = new Date();
    const labels = [],
        values = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const y = d.getFullYear(),
            m = d.getMonth();
        const key = `${y}-${String(m + 1).padStart(2, '0')}`;
        labels.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
        values.push(valueFn(y, m, key));
    }
    return { labels, values };
}

function updateDeptTurnoverChart() {
    const canvas = document.getElementById('chart-dept-turnover');
    if (!canvas || typeof Chart === 'undefined') return;
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
    const byDept = {};
    employees.forEach((e) => {
        const d = e.dept || 'Não Informado';
        if (!byDept[d]) byDept[d] = { total: 0, saidas: 0 };
        byDept[d].total++;
        if (e.terminationDate && new Date(e.terminationDate + 'T00:00:00') >= twelveMonthsAgo) byDept[d].saidas++;
    });
    const entries = Object.entries(byDept)
        .map(([name, v]) => ({ name, rate: v.total ? (v.saidas / v.total) * 100 : 0, saidas: v.saidas, total: v.total }))
        .sort((a, b) => a.rate - b.rate);

    const labels = entries.map((e) => deptLabel(e.name));
    const data = entries.map((e) => +e.rate.toFixed(1));
    const levelColor = (e) => (e.rate >= 20 ? '#ef4444' : e.rate >= 10 ? '#f59e0b' : '#22c55e');
    const colors = entries.map(levelColor);

    const container = canvas.closest('.chart-container');
    if (container) container.style.height = `${Math.max(220, labels.length * 40 + 40)}px`;

    if (chartDeptTurnover) {
        chartDeptTurnover.destroy();
        chartDeptTurnover = null;
    }
    if (!labels.length) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = '';

    chartDeptTurnover = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: colors,
                    borderRadius: 6,
                    borderSkipped: false,
                    barPercentage: 0.62,
                    categoryPercentage: 0.8,
                },
            ],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const e = entries[ctx.dataIndex];
                            return ` ${e.rate.toFixed(1)}% (${e.saidas} de ${e.total} colaborador${e.total !== 1 ? 'es' : ''})`;
                        },
                    },
                },
            },
            scales: {
                x: { beginAtZero: true, ticks: { callback: (v) => `${v}%` }, grid: { color: 'rgba(0,0,0,.05)' } },
                y: { grid: { display: false }, ticks: { font: { weight: '500' } } },
            },
        },
    });
}

const isMsgLive = (m) => !m.scheduled_at || new Date(m.scheduled_at) <= new Date();
const msgPublishedAt = (m) => (m.scheduled_at && new Date(m.scheduled_at) > new Date(m.created_at) ? m.scheduled_at : m.created_at);

function readersByMessage() {
    const map = {};
    messageReads.forEach((r) => {
        (map[r.message_id] || (map[r.message_id] = new Set())).add(r.employee_id);
    });
    return map;
}

function updateDeptReadRateChart() {
    const canvas = document.getElementById('chart-dept-readrate');
    if (!canvas || typeof Chart === 'undefined') return;
    const liveMsgs = messages.filter(isMsgLive);
    const readSets = readersByMessage();

    const activeByDept = {};
    employees
        .filter((e) => e.status === 'Ativo')
        .forEach((e) => {
            const d = e.dept || 'Não Informado';
            (activeByDept[d] || (activeByDept[d] = [])).push(e.id);
        });

    const entries = Object.entries(activeByDept)
        .map(([dept, empIds]) => {
            const msgsToDept = liveMsgs.filter((m) => m.destino === 'Todos' || m.destino === dept);
            const possible = msgsToDept.length * empIds.length;
            let actual = 0;
            msgsToDept.forEach((m) => {
                const readers = readSets[m.id];
                if (!readers) return;
                empIds.forEach((id) => {
                    if (readers.has(id)) actual++;
                });
            });
            return { dept, rate: possible ? (actual / possible) * 100 : 0, actual, possible, msgCount: msgsToDept.length };
        })
        .filter((e) => e.possible > 0)
        .sort((a, b) => a.rate - b.rate);

    const labels = entries.map((e) => deptLabel(e.dept));
    const data = entries.map((e) => +e.rate.toFixed(1));
    const levelColor = (e) => (e.rate < 50 ? '#ef4444' : e.rate < 80 ? '#f59e0b' : '#22c55e');
    const colors = entries.map(levelColor);

    const container = canvas.closest('.chart-container');
    if (container) container.style.height = `${Math.max(220, labels.length * 40 + 40)}px`;

    if (chartDeptReadRate) {
        chartDeptReadRate.destroy();
        chartDeptReadRate = null;
    }
    if (!labels.length) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = '';

    chartDeptReadRate = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: colors,
                    borderRadius: 6,
                    borderSkipped: false,
                    barPercentage: 0.62,
                    categoryPercentage: 0.8,
                },
            ],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const e = entries[ctx.dataIndex];
                            return ` ${e.rate.toFixed(1)}% de leitura (${e.msgCount} comunicado${e.msgCount !== 1 ? 's' : ''})`;
                        },
                    },
                },
            },
            scales: {
                x: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` }, grid: { color: 'rgba(0,0,0,.05)' } },
                y: { grid: { display: false }, ticks: { font: { weight: '500' } } },
            },
        },
    });
}

function updateReadTimeChart() {
    const canvas = document.getElementById('chart-read-time');
    if (!canvas || typeof Chart === 'undefined') return;
    const msgById = {};
    messages.forEach((m) => {
        msgById[m.id] = m;
    });

    const { labels, values } = last6Months((y, m) => {
        const hours = messageReads
            .filter((r) => {
                const d = new Date(r.read_at);
                return d.getFullYear() === y && d.getMonth() === m;
            })
            .map((r) => {
                const msg = msgById[r.message_id];
                if (!msg) return null;
                const h = (new Date(r.read_at) - new Date(msgPublishedAt(msg))) / 36e5;
                return h >= 0 ? h : null;
            })
            .filter((h) => h !== null);
        return hours.length ? +(hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(1) : null;
    });

    if (chartReadTime) {
        chartReadTime.destroy();
        chartReadTime = null;
    }
    chartReadTime = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Tempo médio até leitura',
                    data: values,
                    borderColor: PALETTE.violet,
                    borderWidth: 2.5,
                    backgroundColor: (ctx) => {
                        const { chartArea } = ctx.chart;
                        if (!chartArea) return 'rgba(139,92,246,.12)';
                        const g = ctx.chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        g.addColorStop(0, 'rgba(139,92,246,.32)');
                        g.addColorStop(1, 'rgba(139,92,246,0)');
                        return g;
                    },
                    fill: true,
                    tension: 0.4,
                    spanGaps: true,
                    pointRadius: 3.5,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#fff',
                    pointBorderColor: PALETTE.violet,
                    pointBorderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => (ctx.parsed.y === null ? ' Sem leituras' : ` ${ctx.parsed.y}h em média`) } },
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => `${v}h` }, grid: { color: 'rgba(0,0,0,.05)' } },
                x: { grid: { display: false } },
            },
        },
    });
}

function updateLowAdoptionList() {
    const container = document.getElementById('engagement-low-list');
    if (!container) return;

    const liveMsgs = messages.filter(isMsgLive);
    const readSets = readersByMessage();
    const activeEmployees = employees.filter((e) => e.status === 'Ativo');
    const totalActive = activeEmployees.length;
    const activeCountByDept = {};
    activeEmployees.forEach((e) => {
        const d = e.dept || 'Não Informado';
        activeCountByDept[d] = (activeCountByDept[d] || 0) + 1;
    });

    const oneDayAgo = Date.now() - 24 * 3600 * 1000;
    const scored = liveMsgs
        .filter((m) => new Date(m.created_at).getTime() <= oneDayAgo)
        .map((m) => {
            const audience = m.destino === 'Todos' ? totalActive : activeCountByDept[m.destino] || 0;
            const reads = readSets[m.id]?.size || 0;
            return { ...m, audience, reads, rate: audience ? (reads / audience) * 100 : null };
        })
        .filter((m) => m.rate !== null);

    const lowest = scored.sort((a, b) => a.rate - b.rate).slice(0, 5);

    if (!lowest.length) {
        container.innerHTML = `<p class="engagement-empty">Nenhum comunicado com dados suficientes ainda.</p>`;
        return;
    }

    container.innerHTML = lowest
        .map((m) => {
            const level = m.rate < 30 ? 'bad' : m.rate < 60 ? 'warn' : 'good';
            const preview = m.texto.length > 54 ? m.texto.slice(0, 54) + '…' : m.texto;
            return `
            <div class="engagement-row">
                <div class="engagement-row-info">
                    <span class="engagement-row-text" title="${escHtml(m.texto)}">${escHtml(preview)}</span>
                    <span class="engagement-row-meta">${escHtml(m.destino)} · ${new Date(m.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
                <div class="engagement-row-rate">
                    <div class="engagement-bar"><div class="engagement-bar-fill engagement-bar--${level}" style="width:${Math.max(m.rate, 3).toFixed(0)}%"></div></div>
                    <span class="engagement-rate-value engagement-rate--${level}">${m.rate.toFixed(0)}%</span>
                </div>
            </div>`;
        })
        .join('');
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setupRealtimeSync() {
    sb.channel('dashboard-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, async () => {
            await loadData();
            refreshAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vacations' }, async () => {
            await loadData();
            refreshAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payslips' }, async () => {
            await loadData();
            refreshAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_adjustments' }, async () => {
            await loadData();
            refreshAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => {
            await loadData();
            refreshAll();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, async () => {
            await loadData();
            refreshAll();
        })
        .subscribe();
}

function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const menuBtn = document.getElementById('topbar-menu-btn');
    const overlay = document.getElementById('sidebar-overlay');
    const wrapper = document.getElementById('main-wrapper');
    if (!sidebar) return;
    const isMobile = () => window.innerWidth <= 768;
    const openMob = () => {
        sidebar.classList.add('open');
        overlay?.classList.add('active');
    };
    const closeMob = () => {
        sidebar.classList.remove('open');
        overlay?.classList.remove('active');
    };
    toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        isMobile()
            ? sidebar.classList.contains('open')
                ? closeMob()
                : openMob()
            : (() => {
                  const c = sidebar.classList.toggle('collapsed');
                  wrapper?.classList.toggle('sidebar-collapsed', c);
              })();
    });
    menuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.contains('open') ? closeMob() : openMob();
    });
    overlay?.addEventListener('click', closeMob);
    window.addEventListener('resize', () => {
        if (!isMobile()) closeMob();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isMobile()) closeMob();
    });
}

function setupExportButton() {
    const btn = document.getElementById('btn-export');
    const menu = document.getElementById('export-menu');
    const chevron = btn?.querySelector('.export-chevron');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menu.classList.toggle('open');
        chevron?.classList.toggle('rotated', open);
    });
    document.addEventListener('click', () => {
        menu.classList.remove('open');
        chevron?.classList.remove('rotated');
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.getElementById('export-pdf')?.addEventListener('click', () => {
        menu.classList.remove('open');
        chevron?.classList.remove('rotated');
        exportToPDF();
    });
}

function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function exportToPDF() {
    if (typeof window.jspdf === 'undefined') {
        alert('Biblioteca PDF não carregada.');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const date = new Date().toLocaleDateString('pt-BR');
    const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const pageW = 210,
        pageH = 297,
        margin = 14,
        colGap = 6;
    const colW = (pageW - margin * 2 - colGap) / 2;
    const headerH = 26;
    const footerY = pageH - 12;
    const contentBottom = footerY - 5;
    const contentTop = headerH + 10;

    function drawHeader() {
        doc.setFillColor(13, 14, 18);
        doc.rect(0, 0, pageW, headerH, 'F');
        doc.setFillColor(99, 102, 241);
        doc.circle(margin + 5, headerH / 2, 5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(255, 255, 255);
        doc.text('N', margin + 5, headerH / 2 + 1.3, { align: 'center' });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(255, 255, 255);
        doc.text('Nexus RH', margin + 13, headerH / 2 - 1.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(156, 163, 175);
        doc.text('Relatório visual de indicadores de Recursos Humanos', margin + 13, headerH / 2 + 4.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(203, 213, 225);
        doc.text(`Gerado em ${date} às ${time}`, pageW - margin, headerH / 2 + 1.3, { align: 'right' });
    }

    function drawFooter(pageNum, totalPages) {
        doc.setDrawColor(229, 231, 235);
        doc.setLineWidth(0.2);
        doc.line(margin, footerY - 4, pageW - margin, footerY - 4);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text('Nexus RH · Documento confidencial — uso interno', margin, footerY);
        doc.text(`Página ${pageNum} de ${totalPages}`, pageW - margin, footerY, { align: 'right' });
    }

    function card(x, y, w, h) {
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.25);
        doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');
    }

    drawHeader();

    const kpis = [
        { label: 'Colaboradores Ativos', id: 'count-ativos', color: '#16a34a' },
        { label: 'Em Férias', id: 'count-ferias', color: '#f59e0b' },
        { label: 'Inativos', id: 'count-inativos', color: '#6b7280' },
        { label: 'Afastados', id: 'count-afastados', color: '#ea580c' },
        { label: 'Turnover (12 meses)', id: 'turnover-rate', color: '#6366f1' },
        { label: 'Absenteísmo (mês)', id: 'absenteeism-rate', color: '#f59e0b' },
    ];
    const kpiW = colW,
        kpiH = 20,
        kpiGap = colGap;
    const ky = contentTop;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(17, 24, 39);
    doc.text('Resumo Executivo', margin, ky - 3);

    kpis.forEach((k, i) => {
        const col = i % 2,
            row = Math.floor(i / 2);
        const x = margin + col * (kpiW + kpiGap);
        const y = ky + 3 + row * (kpiH + kpiGap);
        const [r, g, b] = hexToRgb(k.color);
        card(x, y, kpiW, kpiH);
        doc.setFillColor(r, g, b);
        doc.circle(x + 10, y + kpiH / 2, 4.2, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(107, 114, 128);
        doc.text(k.label, x + 18, y + 7.5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(17, 24, 39);
        doc.text(document.getElementById(k.id)?.textContent || '—', x + 18, y + kpiH - 5);
    });

    let colY = [ky + 3 + 3 * (kpiH + kpiGap) + 6, ky + 3 + 3 * (kpiH + kpiGap) + 6];
    let col = 0;

    function sectionTitle(title) {
        let sy = Math.max(colY[0], colY[1]) + 3;
        if (sy > contentBottom - 10) {
            doc.addPage();
            drawHeader();
            colY = [contentTop, contentTop];
            col = 0;
            sy = contentTop;
        }
        doc.setFillColor(99, 102, 241);
        doc.roundedRect(margin, sy, 2, 6, 1, 1, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(17, 24, 39);
        doc.text(title, margin + 6, sy + 4.7);
        colY = [sy + 12, sy + 12];
        col = 0;
    }

    function placeChart(chart, title) {
        if (!chart || !chart.canvas) return;
        const ratio = chart.canvas.height / chart.canvas.width;
        const pad = 4;
        const imgW = colW - pad * 2;
        const imgH = imgW * ratio;
        const blockH = imgH + pad * 2 + 8;
        if (colY[col] + blockH > contentBottom) {
            col = 1 - col;
            if (colY[col] + blockH > contentBottom) {
                doc.addPage();
                drawHeader();
                colY = [contentTop, contentTop];
                col = 0;
            }
        }
        const x = margin + col * (colW + colGap);
        const y = colY[col];
        card(x, y, colW, blockH);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(31, 41, 55);
        doc.text(title, x + pad, y + pad + 3);
        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.2);
        doc.line(x + pad, y + pad + 6, x + colW - pad, y + pad + 6);
        doc.addImage(chart.canvas.toDataURL('image/png', 1.0), 'PNG', x + pad, y + pad + 9, imgW, imgH);
        colY[col] = y + blockH + 6;
        col = 1 - col;
    }

    sectionTitle('Visão Geral e Demografia');
    placeChart(chartAge, 'Faixa Etária');
    placeChart(chartGender, 'Gênero');
    placeChart(chartTenure, 'Tempo de Casa');
    placeChart(chartDepartment, 'Headcount por Setor');
    placeChart(chartTurnover, 'Admissões vs Desligamentos');
    placeChart(chartContracts, 'Tipo de Contrato');

    sectionTitle('Equidade e Diversidade');
    placeChart(chartRace, 'Representatividade por Raça/Cor');

    sectionTitle('Engajamento de Comunicação Interna');
    placeChart(chartDeptReadRate, 'Taxa de Leitura por Setor');
    placeChart(chartReadTime, 'Tempo Médio até Leitura (6 meses)');

    sectionTitle('Retenção e Custos');
    placeChart(chartPayroll, 'Custo de Folha (semestral)');
    placeChart(chartOvertime, 'Banco de Horas (créditos, 6 meses)');
    placeChart(chartDeptTurnover, 'Turnover por Departamento (12 meses)');

    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        drawFooter(p, totalPages);
    }

    doc.save(`dashboard-rh-${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.pdf`);
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
