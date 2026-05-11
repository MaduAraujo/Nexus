/* ════════════════════════════════════════════
   dashboard.js — Dashboard RH — Supabase
   ════════════════════════════════════════════ */

let chartContracts = null;
let chartTurnover  = null;
let employees      = [];
let vacations      = [];

document.addEventListener('DOMContentLoaded', async () => {
    setCurrentDate();
    setupSidebar();
    await loadRhSidebar();
    await loadData();
    refreshAll();
    setupRealtimeSync();
    setupExportDropdown();
});

async function loadRhSidebar() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }
    const { data: profile } = await sb.from('profiles').select('profile').eq('id', user.id).single();
    if (profile?.profile !== 'Administrador') { window.location.href = '../screens/login.html'; return; }
    setText('rh-sidebar-name',   'Administrador');
    setText('rh-sidebar-role',   'Recursos Humanos');
    setText('rh-sidebar-avatar', 'ADM');
}

async function loadData() {
    const [{ data: empData }, { data: vacData }] = await Promise.all([
        sb.from('employees').select('id,name,dept,status,contract_type,admission_date,termination_date,email'),
        sb.from('vacations').select('id,employee_id,start_date,end_date,status'),
    ]);
    employees = (empData || []).map(e => ({
        id: e.id, name: e.name, dept: e.dept, status: e.status,
        contractType: e.contract_type, admissionDate: e.admission_date,
        terminationDate: e.termination_date, email: e.email,
    }));
    vacations = (vacData || []).map(v => ({
        id: v.id, employeeId: v.employee_id,
        startDate: v.start_date, endDate: v.end_date, status: v.status,
    }));
}

function refreshAll() {
    updateMetrics();
    updateContractChart();
    updateTurnoverChart();
    renderDepartmentHeadcount();
    updateTurnoverRate();
    updateAbsenteeism();
}

function setCurrentDate() {
    const el = document.getElementById('current-date');
    if (el) el.textContent = new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function updateMetrics() {
    const today = new Date(); today.setHours(0,0,0,0);
    const now   = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const ativos   = employees.filter(e => e.status === 'Ativo').length;
    const inativos = employees.filter(e => e.status === 'Inativo').length;
    const emFerias = vacations.filter(v => {
        if (v.status !== 'aprovado') return false;
        const s = new Date(v.startDate + 'T00:00:00');
        const e = new Date(v.endDate   + 'T00:00:00');
        return s <= today && today <= e;
    }).length;

    setText('count-ativos',   ativos);
    setText('count-ferias',   emFerias);
    setText('count-inativos', inativos);

    const admThisMonth  = employees.filter(e => e.admissionDate  && new Date(e.admissionDate  + 'T00:00:00') >= thisMonthStart).length;
    const termThisMonth = employees.filter(e => e.terminationDate && new Date(e.terminationDate + 'T00:00:00') >= thisMonthStart).length;
    const feriasThisMonth = vacations.filter(v => v.status === 'aprovado' && v.startDate && new Date(v.startDate + 'T00:00:00') >= thisMonthStart).length;

    const deltaAtivosEl   = document.getElementById('delta-ativos');
    const deltaFeriasEl   = document.getElementById('delta-ferias');
    const deltaInativosEl = document.getElementById('delta-inativos');
    if (deltaAtivosEl)   { deltaAtivosEl.textContent   = admThisMonth > 0 ? `+${admThisMonth} admissão(ões) este mês` : 'Sem novas admissões este mês';     deltaAtivosEl.className   = admThisMonth > 0 ? 'card-delta up' : 'card-delta'; }
    if (deltaFeriasEl)   { deltaFeriasEl.textContent   = feriasThisMonth > 0 ? `${feriasThisMonth} início(s) este mês` : 'Sem saídas programadas este mês'; deltaFeriasEl.className   = 'card-delta'; }
    if (deltaInativosEl) { deltaInativosEl.textContent = termThisMonth > 0 ? `+${termThisMonth} desligamento(s) este mês` : 'Sem desligamentos este mês';   deltaInativosEl.className = termThisMonth > 0 ? 'card-delta down' : 'card-delta'; }
}

function updateTurnoverRate() {
    const el = document.getElementById('turnover-rate');
    if (!el) return;
    const twelveMonthsAgo = new Date(); twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
    const desligamentos   = employees.filter(e => e.terminationDate && new Date(e.terminationDate + 'T00:00:00') >= twelveMonthsAgo).length;
    if (!employees.length) { el.textContent = '—'; return; }
    el.textContent = `${((desligamentos / employees.length) * 100).toFixed(1)}%`;
}

async function updateAbsenteeism() {
    const el = document.getElementById('absenteeism-rate');
    if (!el) return;
    const now      = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}`;
    const ativos   = employees.filter(e => e.status === 'Ativo');
    if (!ativos.length) { el.textContent = '—'; return; }

    const { data: records } = await sb.from('time_records')
        .select('employee_id, date, entrada')
        .in('employee_id', ativos.map(e => e.id))
        .gte('date', `${monthKey}-01`)
        .lte('date', `${monthKey}-${String(now.getDate()).padStart(2,'0')}`);

    const presentSet = new Set((records || []).filter(r => r.entrada).map(r => `${r.employee_id}_${r.date}`));

    let totalWorkDays = 0, totalAbsences = 0;
    for (let d = 1; d <= now.getDate(); d++) {
        const dateStr = `${monthKey}-${String(d).padStart(2,'0')}`;
        const dt = new Date(dateStr + 'T12:00:00');
        const dow = dt.getDay();
        if (dow === 0 || dow === 6) continue;
        ativos.forEach(emp => {
            totalWorkDays++;
            if (!presentSet.has(`${emp.id}_${dateStr}`)) totalAbsences++;
        });
    }

    el.textContent = !totalWorkDays ? '—' : `${((totalAbsences / totalWorkDays) * 100).toFixed(1)}%`;
}

function renderDepartmentHeadcount() {
    const container = document.getElementById('department-list');
    if (!container) return;
    const depts = employees.filter(e => e.status !== 'Inativo').reduce((acc, e) => {
        const d = e.dept || 'Não Informado'; acc[d] = (acc[d] || 0) + 1; return acc;
    }, {});
    const entries = Object.entries(depts).sort((a, b) => b[1] - a[1]);
    container.innerHTML = !entries.length ? '<p class="empty-msg">Nenhum setor registrado.</p>' :
        entries.map(([name, total]) => `<div class="dept-headcount-item"><span class="dept-name">${name}</span><span class="dept-total-badge">${total}</span></div>`).join('');
}

function updateContractChart() {
    const canvas = document.getElementById('chart-contracts');
    if (!canvas || typeof Chart === 'undefined') return;
    const counts = employees.filter(e => e.status !== 'Inativo').reduce((acc, e) => {
        const t = e.contractType || 'Não Definido'; acc[t] = (acc[t] || 0) + 1; return acc;
    }, {});
    const labels = Object.keys(counts); const data = Object.values(counts);
    const colors = ['#6366f1','#22c55e','#f59e0b','#3b82f6','#ef4444','#8b5cf6','#06b6d4','#f97316'];
    if (chartContracts) { chartContracts.destroy(); chartContracts = null; }
    if (!labels.length) { canvas.style.display = 'none'; return; }
    canvas.style.display = '';
    chartContracts = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 2, borderColor:'#fff', hoverOffset: 8 }] },
        options: { responsive:true, maintainAspectRatio:true, plugins: { legend:{ position:'bottom', labels:{ font:{size:12}, padding:16, usePointStyle:true } }, tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${ctx.parsed} colaborador${ctx.parsed !== 1 ? 'es' : ''}` } } } }
    });
}

function updateTurnoverChart() {
    const canvas = document.getElementById('chart-turnover');
    if (!canvas || typeof Chart === 'undefined') return;
    const today = new Date();
    const labels = [], admissions = [], terminations = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const y = d.getFullYear(), m = d.getMonth();
        labels.push(d.toLocaleDateString('pt-BR', { month:'short', year:'2-digit' }));
        admissions.push(employees.filter(e => { if (!e.admissionDate) return false; const dt = new Date(e.admissionDate+'T00:00:00'); return dt.getFullYear()===y && dt.getMonth()===m; }).length);
        terminations.push(employees.filter(e => { if (!e.terminationDate) return false; const dt = new Date(e.terminationDate+'T00:00:00'); return dt.getFullYear()===y && dt.getMonth()===m; }).length);
    }
    if (chartTurnover) { chartTurnover.destroy(); chartTurnover = null; }
    chartTurnover = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [{ label:'Admissões', data:admissions, backgroundColor:'rgba(99,102,241,0.85)', borderRadius:6, borderSkipped:false }, { label:'Desligamentos', data:terminations, backgroundColor:'rgba(239,68,68,0.85)', borderRadius:6, borderSkipped:false }] },
        options: { responsive:true, maintainAspectRatio:true, plugins:{ legend:{ position:'bottom', labels:{ font:{size:12}, padding:16, usePointStyle:true } } }, scales:{ y:{ beginAtZero:true, ticks:{stepSize:1}, grid:{color:'rgba(0,0,0,.05)'} }, x:{ grid:{display:false} } } }
    });
}

function setupRealtimeSync() {
    sb.channel('dashboard-rt')
        .on('postgres_changes', { event:'*', schema:'public', table:'employees' }, async () => { await loadData(); refreshAll(); })
        .on('postgres_changes', { event:'*', schema:'public', table:'vacations' }, async () => { await loadData(); refreshAll(); })
        .subscribe();
}

function setupSidebar() {
    const sidebar   = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const menuBtn   = document.getElementById('topbar-menu-btn');
    const overlay   = document.getElementById('sidebar-overlay');
    const wrapper   = document.getElementById('main-wrapper');
    if (!sidebar) return;
    const isMobile  = () => window.innerWidth <= 768;
    const openMob   = () => { sidebar.classList.add('open');    overlay?.classList.add('active'); };
    const closeMob  = () => { sidebar.classList.remove('open'); overlay?.classList.remove('active'); };
    toggleBtn?.addEventListener('click', e => { e.stopPropagation(); isMobile() ? (sidebar.classList.contains('open') ? closeMob() : openMob()) : (() => { const c = sidebar.classList.toggle('collapsed'); wrapper?.classList.toggle('sidebar-collapsed', c); })(); });
    menuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar.classList.contains('open') ? closeMob() : openMob(); });
    overlay?.addEventListener('click', closeMob);
    window.addEventListener('resize', () => { if (!isMobile()) closeMob(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isMobile()) closeMob(); });
}

function setupExportDropdown() {
    const btn = document.getElementById('btn-export'); const menu = document.getElementById('export-menu'); const chevron = btn?.querySelector('.export-chevron');
    if (!btn || !menu) return;
    btn.addEventListener('click', e => { e.stopPropagation(); const open = menu.classList.toggle('open'); chevron?.classList.toggle('rotated', open); });
    document.addEventListener('click', () => { menu.classList.remove('open'); chevron?.classList.remove('rotated'); });
    menu.addEventListener('click', e => e.stopPropagation());
    document.getElementById('export-excel')?.addEventListener('click', () => { menu.classList.remove('open'); chevron?.classList.remove('rotated'); exportToExcel(); });
    document.getElementById('export-pdf')?.addEventListener('click',   () => { menu.classList.remove('open'); chevron?.classList.remove('rotated'); exportToPDF(); });
}

function getExportData() {
    const today = new Date(); today.setHours(0,0,0,0);
    const ativos   = employees.filter(e => e.status === 'Ativo').length;
    const inativos = employees.filter(e => e.status === 'Inativo').length;
    const emFerias = vacations.filter(v => { if (v.status !== 'aprovado') return false; const s = new Date(v.startDate+'T00:00:00'); const e = new Date(v.endDate+'T00:00:00'); return s <= today && today <= e; }).length;
    const depts    = employees.filter(e => e.status !== 'Inativo').reduce((acc, e) => { const d = e.dept || 'Não Informado'; acc[d] = (acc[d]||0)+1; return acc; }, {});
    const contracts = employees.filter(e => e.status !== 'Inativo').reduce((acc, e) => { const t = e.contractType||'Não Definido'; acc[t] = (acc[t]||0)+1; return acc; }, {});
    const now = new Date();
    const turnover = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth()-i, 1); const y = d.getFullYear(), m = d.getMonth();
        const label = d.toLocaleDateString('pt-BR', { month:'short', year:'2-digit' });
        const adm  = employees.filter(e => { if (!e.admissionDate)  return false; const dt = new Date(e.admissionDate+'T00:00:00');  return dt.getFullYear()===y && dt.getMonth()===m; }).length;
        const term = employees.filter(e => { if (!e.terminationDate) return false; const dt = new Date(e.terminationDate+'T00:00:00'); return dt.getFullYear()===y && dt.getMonth()===m; }).length;
        turnover.push({ label, adm, term });
    }
    return { ativos, inativos, emFerias, depts, contracts, turnover };
}

function exportToExcel() {
    if (typeof XLSX === 'undefined') { alert('Biblioteca Excel não carregada.'); return; }
    const { ativos, inativos, emFerias, depts, contracts, turnover } = getExportData();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Indicador','Quantidade'],['Colaboradores Ativos',ativos],['Em Férias',emFerias],['Inativos',inativos]]), 'Resumo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Departamento','Colaboradores'],...Object.entries(depts).sort((a,b)=>b[1]-a[1])]), 'Departamentos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Tipo de Contrato','Colaboradores'],...Object.entries(contracts)]), 'Contratos');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Mês','Admissões','Desligamentos'],...turnover.map(t=>[t.label,t.adm,t.term])]), 'Turnover');
    XLSX.writeFile(wb, `dashboard-rh-${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.xlsx`);
}

function exportToPDF() {
    if (typeof window.jspdf === 'undefined') { alert('Biblioteca PDF não carregada.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const { ativos, inativos, emFerias, depts, contracts, turnover } = getExportData();
    const date = new Date().toLocaleDateString('pt-BR');
    doc.setFillColor(13,14,18); doc.rect(0,0,210,28,'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(18); doc.setTextColor(255,255,255);
    doc.text('Nexus RH — Dashboard', 14, 18);
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(156,163,175);
    doc.text(`Gerado em ${date}`, 196, 18, { align:'right' });
    const headStyles = { fillColor:[99,102,241], textColor:255, fontStyle:'bold' };
    const altRows    = { fillColor:[248,249,250] };
    const margin     = { left:14, right:14 };
    doc.autoTable({ startY:36, head:[['Indicador','Quantidade']], body:[['Colaboradores Ativos',ativos],['Em Férias',emFerias],['Inativos',inativos]], headStyles, alternateRowStyles:altRows, margin, theme:'striped' });
    doc.autoTable({ startY: doc.lastAutoTable.finalY+10, head:[['Departamento','Colaboradores']], body:Object.entries(depts).sort((a,b)=>b[1]-a[1]), headStyles, alternateRowStyles:altRows, margin, theme:'striped' });
    doc.autoTable({ startY: doc.lastAutoTable.finalY+10, head:[['Tipo de Contrato','Colaboradores']], body:Object.entries(contracts), headStyles, alternateRowStyles:altRows, margin, theme:'striped' });
    doc.autoTable({ startY: doc.lastAutoTable.finalY+10, head:[['Mês','Admissões','Desligamentos']], body:turnover.map(t=>[t.label,t.adm,t.term]), headStyles, alternateRowStyles:altRows, margin, theme:'striped' });
    doc.save(`dashboard-rh-${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.pdf`);
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
async function logout() { await sb.auth.signOut(); window.location.href = '../screens/login.html'; }
function updateDashboardMetrics() { refreshAll(); }
function saveAndRefresh()         { refreshAll(); }
