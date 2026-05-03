/* ════════════════════════════════════════════════
   pagamentos.js — Gestão de Pagamentos (RH) — Supabase
   ════════════════════════════════════════════════ */

const pad0 = n => String(n).padStart(2, '0');

let currentMonth  = '';
let currentSearch = '';
let currentDept   = '';
let allRows       = [];
let employees     = [];
let payslips      = [];
let rhUser        = null;

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }
    const { data: profile } = await sb.from('profiles').select('profile').eq('id', user.id).single();
    if (profile?.profile !== 'rh') { window.location.href = '../screens/login.html'; return; }
    rhUser = user;

    const displayName = user.email?.split('@')[0] || 'Administrador';
    setText('rh-sidebar-name',   displayName);
    setText('rh-sidebar-role',   'Recursos Humanos');
    setText('rh-sidebar-avatar', displayName.slice(0, 2).toUpperCase());

    setupSidebar();
    setupExportDropdown();

    const now = new Date();
    currentMonth = `${now.getFullYear()}-${pad0(now.getMonth() + 1)}`;
    const mp = document.getElementById('month-picker');
    if (mp) { mp.value = currentMonth; mp.addEventListener('change', () => { currentMonth = mp.value; refresh(); }); }

    await refresh();
    setupRealtimeSync();
});

// ─── Data ─────────────────────────────────────────────────────

async function loadData() {
    const [{ data: empData }, { data: slipData }] = await Promise.all([
        sb.from('employees').select('*').in('status', ['Ativo','ativo']).order('name'),
        sb.from('payslips').select('*').eq('mes', currentMonth),
    ]);
    employees = (empData || []).map(e => ({
        id: e.id, name: e.name, role: e.role, dept: e.dept,
        salary: e.salary, contractType: e.contract_type,
        admissionDate: e.admission_date, email: e.email,
        valeTransporte: e.vale_transporte ? 'sim' : 'nao',
        valorPassagem: e.valor_passagem, conducoesdia: e.conducoes_dia,
        benValeRefeicao: null, benValeAlimentacao: null,
    }));
    payslips = slipData || [];
}

async function refresh() {
    await loadData();
    populateDeptFilters();
    buildFolhaRows();
    renderFolha();
    renderHolerites();
    loadKPIs();
}

// ─── Cálculos ─────────────────────────────────────────────────

function calcINSS(salBase) {
    if (salBase <= 0) return 0;
    const faixas = [{ limite:1412.00,aliq:0.075},{limite:2666.68,aliq:0.090},{limite:4000.03,aliq:0.120},{limite:7786.02,aliq:0.140}];
    let inss = 0, anterior = 0;
    for (const f of faixas) { if (salBase <= anterior) break; inss += (Math.min(salBase, f.limite) - anterior) * f.aliq; anterior = f.limite; }
    if (salBase > 7786.02) inss += (salBase - 7786.02) * 0.14;
    return +Math.min(inss, 908.86).toFixed(2);
}

function calcIRRF(base) {
    if (base <= 2259.20) return 0;
    if (base <= 2826.65) return +(base*0.075- 169.44).toFixed(2);
    if (base <= 3751.05) return +(base*0.150- 381.44).toFixed(2);
    if (base <= 4664.68) return +(base*0.225- 662.77).toFixed(2);
    return +(base*0.275-896.00).toFixed(2);
}

function parseCurrency(str) { if (!str) return 0; return parseFloat(String(str).replace(/[^\d,]/g,'').replace(',','.')) || 0; }

function calcRow(emp) {
    const salary = Number(emp.salary) || 0;
    const ct     = (emp.contractType || 'clt').toLowerCase();
    const isPJ   = ct === 'pj'; const isAprendiz = ct === 'aprendiz';
    let inss = 0, irrf = 0, benef = 0, descVT = 0;
    if (!isPJ) {
        inss = isAprendiz ? +(salary*0.08).toFixed(2) : calcINSS(salary);
        if (!isAprendiz) irrf = calcIRRF(salary - inss);
        if (emp.benValeRefeicao)   benef += parseCurrency(emp.benValeRefeicao) * 22;
        if (emp.benValeAlimentacao) benef += parseCurrency(emp.benValeAlimentacao);
        if (emp.valeTransporte === 'sim') {
            const condDia = parseInt(emp.conducoesdia || '2', 10);
            const valPass = parseCurrency(emp.valorPassagem || '0');
            const vtBruto = +(valPass * condDia * 22).toFixed(2);
            descVT = +Math.min(salary * 0.06, vtBruto).toFixed(2);
            benef += vtBruto;
        }
    }
    benef = +benef.toFixed(2);
    const bruto = +(salary + benef).toFixed(2);
    const liquido = +(bruto - inss - irrf - descVT).toFixed(2);
    return { salary, inss, irrf, benef, bruto, descontos: +(inss+irrf+descVT).toFixed(2), liquido, isPJ };
}

function buildPayslipData(emp, monthKey) {
    const calc = calcRow(emp);
    const [year, monthNum] = monthKey.split('-');
    const month = parseInt(monthNum, 10);
    const proventos = [{ cod:'001', descricao:'Salário Base', referencia:'30 dias', valor: calc.salary }];
    const descontos = [];
    if (!calc.isPJ) {
        if (emp.benValeRefeicao)   { const vr = parseCurrency(emp.benValeRefeicao)*22;  if (vr>0) proventos.push({cod:'010',descricao:'Vale Refeição',referencia:'22 dias',valor:+vr.toFixed(2)}); }
        if (emp.benValeAlimentacao){ const va = parseCurrency(emp.benValeAlimentacao);   if (va>0) proventos.push({cod:'011',descricao:'Vale Alimentação',referencia:'Mensal',valor:va}); }
        if (emp.valeTransporte === 'sim') {
            const condDia = parseInt(emp.conducoesdia||'2',10); const valPass = parseCurrency(emp.valorPassagem||'0');
            const vtBruto = +(valPass*condDia*22).toFixed(2); const descVT = +Math.min(calc.salary*0.06,vtBruto).toFixed(2);
            if (vtBruto>0) { proventos.push({cod:'012',descricao:'Vale Transporte',referencia:`${condDia} cond/dia`,valor:vtBruto}); if (descVT>0) descontos.push({cod:'903',descricao:'Desc. Vale Transporte',referencia:'6%',valor:descVT}); }
        }
        if (calc.inss>0) { const ref=(emp.contractType||'').toLowerCase()==='aprendiz'?'8%':`${((calc.inss/calc.salary)*100).toFixed(1)}%`; descontos.push({cod:'901',descricao:'INSS',referencia:ref,valor:calc.inss}); }
        if (calc.irrf>0) descontos.push({cod:'902',descricao:'IRRF',referencia:'Tabela',valor:calc.irrf});
    }
    const totalProventos = +proventos.reduce((s,p)=>s+p.valor,0).toFixed(2);
    const totalDescontos = +descontos.reduce((s,d)=>s+d.valor,0).toFixed(2);
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return {
        employee_id:    emp.id,
        mes:            monthKey,
        mes_formatado:  `${MESES[month-1]} ${year}`,
        competencia:    `${pad0(month)}/${year}`,
        proventos,
        descontos,
        total_proventos: totalProventos,
        total_descontos: totalDescontos,
        salario_liquido: +(totalProventos - totalDescontos).toFixed(2),
        status:         'publicado',
    };
}

// ─── Build rows ───────────────────────────────────────────────

function buildFolhaRows() {
    allRows = employees.map(emp => {
        const calc  = calcRow(emp);
        const slip  = payslips.find(p => p.employee_id === emp.id) || null;
        const pago  = slip?.status === 'pago';
        const gerado = !!slip;
        return { emp, calc, slip, pago, gerado };
    });
}

// ─── KPIs ─────────────────────────────────────────────────────

function loadKPIs() {
    let totalBruto=0, totalLiquido=0, totalPagos=0;
    allRows.forEach(r => { totalBruto+=r.calc.bruto; totalLiquido+=r.calc.liquido; if (r.pago) totalPagos++; });
    setText('kpi-bruto',   fmtCurrency(totalBruto));
    setText('kpi-liquido', fmtCurrency(totalLiquido));
    setText('kpi-colab',   allRows.length);
    setText('kpi-pagos',   `${totalPagos}/${allRows.length}`);
}

// ─── Render Folha ─────────────────────────────────────────────

function applySearch() { currentSearch=(document.getElementById('search-input')?.value||'').toLowerCase().trim(); currentDept=document.getElementById('dept-filter')?.value||''; renderFolha(); }
window.applySearch = applySearch;

function renderFolha() {
    const tbody = document.getElementById('folha-tbody');
    if (!tbody) return;
    const filtered = allRows.filter(r => {
        if (currentSearch && !r.emp.name.toLowerCase().includes(currentSearch) && !(r.emp.dept||'').toLowerCase().includes(currentSearch)) return false;
        if (currentDept && (r.emp.dept||'') !== currentDept) return false;
        return true;
    });
    if (!filtered.length) { tbody.innerHTML=`<tr><td colspan="9"><div class="table-empty"><i class="fas fa-file-invoice-dollar"></i><p>Nenhum colaborador encontrado.</p></div></td></tr>`; setText('folha-count',''); updateSummary([]); return; }
    tbody.innerHTML = filtered.map(r => buildFolhaRow(r)).join('');
    setText('folha-count', `${filtered.length} colaborador${filtered.length!==1?'es':''} na folha`);
    updateSummary(filtered);
}

function buildFolhaRow(r) {
    const { emp, calc, pago, gerado } = r;
    const ini=initials(emp.name); const color=nameToColor(emp.name); const ct=(emp.contractType||'CLT').toUpperCase();
    const statusBadge = pago?`<span class="badge badge--pago"><i class="fas fa-check"></i> Pago</span>`:gerado?`<span class="badge badge--gerado"><i class="fas fa-file-circle-check"></i> Gerado</span>`:`<span class="badge badge--pendente"><i class="fas fa-clock"></i> Pendente</span>`;
    const ctBadge = calc.isPJ?`<span class="badge badge--pj">PJ</span>`:`<span style="font-size:.8rem;color:var(--text-secondary)">${ct}</span>`;
    return `<tr>
        <td><div class="emp-cell"><div class="emp-avatar" style="background:${color}">${ini}</div><div><p class="emp-name">${escHtml(emp.name)}</p><p class="emp-dept">${escHtml(emp.dept||'—')}</p></div></div></td>
        <td>${ctBadge}</td>
        <td><span class="val-blue">${fmtCurrency(calc.bruto)}</span></td>
        <td><span class="val-red">${calc.isPJ?'—':fmtCurrency(calc.inss)}</span></td>
        <td><span class="val-red">${calc.isPJ?'—':fmtCurrency(calc.irrf)}</span></td>
        <td>${calc.benef>0?`<span class="val-blue">${fmtCurrency(calc.benef)}</span>`:'—'}</td>
        <td><span class="val-green">${fmtCurrency(calc.liquido)}</span></td>
        <td>${statusBadge}</td>
        <td><div class="actions-cell">
            <button class="btn-action" onclick="gerarHolerite('${emp.id}')" title="${gerado?'Regenerar':'Gerar holerite'}"><i class="fas fa-${gerado?'rotate':'wand-magic-sparkles'}"></i></button>
            <button class="btn-action" onclick="verHolerite('${emp.id}')" title="Ver holerite" ${!gerado?'disabled style="opacity:.4;cursor:not-allowed"':''}><i class="fas fa-eye"></i></button>
            <button class="btn-action btn-action--${pago?'danger':'success'}" onclick="togglePago('${emp.id}')" title="${pago?'Desmarcar pago':'Marcar como pago'}" ${!gerado?'disabled style="opacity:.4;cursor:not-allowed"':''}><i class="fas fa-${pago?'xmark':'check'}"></i></button>
        </div></td>
    </tr>`;
}

function updateSummary(rows) {
    let bruto=0,inss=0,irrf=0,benef=0,liquido=0;
    rows.forEach(r=>{ bruto+=r.calc.salary; inss+=r.calc.inss; irrf+=r.calc.irrf; benef+=r.calc.benef; liquido+=r.calc.liquido; });
    setText('sum-bruto',fmtCurrency(bruto)); setText('sum-inss',fmtCurrency(inss)); setText('sum-irrf',fmtCurrency(irrf)); setText('sum-benef',fmtCurrency(benef)); setText('sum-liquido',fmtCurrency(liquido));
}

// ─── Render Holerites ─────────────────────────────────────────

function applyHolSearch() { renderHolerites((document.getElementById('search-hol')?.value||'').toLowerCase().trim(), document.getElementById('dept-hol-filter')?.value||''); }
window.applyHolSearch = applyHolSearch;

function renderHolerites(q='',dept='') {
    const tbody = document.getElementById('hol-tbody');
    if (!tbody) return;
    const filtered = allRows.filter(r => { if (q && !r.emp.name.toLowerCase().includes(q) && !(r.emp.dept||'').toLowerCase().includes(q)) return false; if (dept && (r.emp.dept||'')!==dept) return false; return true; });
    if (!filtered.length) { tbody.innerHTML=`<tr><td colspan="5"><div class="table-empty"><i class="fas fa-file-invoice"></i><p>Nenhum colaborador encontrado.</p></div></td></tr>`; setText('hol-count',''); return; }
    const [year,monthNum]=currentMonth.split('-');
    const monthLabel=new Date(+year,parseInt(monthNum)-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    const competLabel=monthLabel.charAt(0).toUpperCase()+monthLabel.slice(1);
    tbody.innerHTML=filtered.map(r=>{
        const{emp,calc,slip,pago,gerado}=r;const ini=initials(emp.name);const color=nameToColor(emp.name);
        const statusBadge=pago?`<span class="badge badge--pago"><i class="fas fa-check"></i> Pago</span>`:gerado?`<span class="badge badge--gerado"><i class="fas fa-file-circle-check"></i> Publicado</span>`:`<span class="badge badge--pendente"><i class="fas fa-clock"></i> Não gerado</span>`;
        return `<tr><td><div class="emp-cell"><div class="emp-avatar" style="background:${color}">${ini}</div><div><p class="emp-name">${escHtml(emp.name)}</p><p class="emp-dept">${escHtml(emp.dept||'—')}</p></div></div></td><td>${competLabel}</td><td>${gerado?`<span class="val-green">${fmtCurrency(slip.salario_liquido)}</span>`:'—'}</td><td>${statusBadge}</td><td><div class="actions-cell"><button class="btn-action" onclick="gerarHolerite('${emp.id}')" title="${gerado?'Regenerar':'Gerar holerite'}"><i class="fas fa-${gerado?'rotate':'wand-magic-sparkles'}"></i></button><button class="btn-action" onclick="verHolerite('${emp.id}')" title="Ver" ${!gerado?'disabled style="opacity:.4;cursor:not-allowed"':''}><i class="fas fa-eye"></i></button><button class="btn-action btn-action--${pago?'danger':'success'}" onclick="togglePago('${emp.id}')" title="${pago?'Desmarcar':'Marcar pago'}" ${!gerado?'disabled style="opacity:.4;cursor:not-allowed"':''}><i class="fas fa-${pago?'xmark':'check'}"></i></button></div></td></tr>`;
    }).join('');
    setText('hol-count',`${filtered.length} colaborador${filtered.length!==1?'es':''}`);
}

// ─── Ações ────────────────────────────────────────────────────

window.gerarHolerite = async function (empId) {
    const row = allRows.find(r => r.emp.id === empId);
    if (!row) return;
    const slipData = buildPayslipData(row.emp, currentMonth);
    const { error } = await sb.from('payslips').upsert(slipData, { onConflict: 'employee_id,mes' });
    if (error) { showToast('Erro ao gerar holerite.', 'error'); return; }
    showToast(`Holerite de ${row.emp.name} gerado com sucesso.`, 'success');
    await refresh();
};

window.verHolerite = function (empId) {
    const row = allRows.find(r => r.emp.id === empId);
    if (!row || !row.slip) return;
    renderSlipModal(row.emp, row.slip);
    openModal('slip-modal');
};

window.togglePago = async function (empId) {
    const row = allRows.find(r => r.emp.id === empId);
    if (!row || !row.slip) return;
    const newStatus = row.slip.status === 'pago' ? 'publicado' : 'pago';
    const updateData = { status: newStatus };
    if (newStatus === 'pago') updateData.pago_em = new Date().toISOString();
    await sb.from('payslips').update(updateData).eq('id', row.slip.id);
    showToast(newStatus==='pago'?`${row.emp.name} marcado como pago.`:`Pagamento de ${row.emp.name} desfeito.`, newStatus==='pago'?'success':'info');
    await refresh();
};

window.gerarTodosHolerites = async function () {
    const slipsData = employees.map(emp => buildPayslipData(emp, currentMonth));
    const { error } = await sb.from('payslips').upsert(slipsData, { onConflict: 'employee_id,mes' });
    if (error) { showToast('Erro ao gerar holerites.', 'error'); return; }
    showToast(`${employees.length} holerites gerados para ${fmtMonthLabel(currentMonth)}.`, 'success');
    await refresh();
};

window.marcarTodosPagos = async function () {
    const gerados = allRows.filter(r => r.gerado && !r.pago);
    if (!gerados.length) { showToast('Todos os holerites gerados já estão pagos.', 'info'); return; }
    const ids = gerados.map(r => r.slip.id);
    await sb.from('payslips').update({ status:'pago', pago_em: new Date().toISOString() }).in('id', ids);
    showToast(`${gerados.length} holerites marcados como pagos.`, 'success');
    await refresh();
};

// ─── Slip modal ───────────────────────────────────────────────

function renderSlipModal(emp, slip) {
    const sub = document.getElementById('slip-modal-sub');
    if (sub) sub.textContent = `${emp.name} — ${slip.competencia}`;
    const body = document.getElementById('slip-modal-body');
    if (!body) return;
    const provRows = (slip.proventos||[]).map(p=>`<tr><td>${p.cod}</td><td>${escHtml(p.descricao)}</td><td>${p.referencia}</td><td class="td-val">${fmtCurrency(p.valor)}</td></tr>`).join('');
    const descRows = (slip.descontos||[]).map(d=>`<tr><td>${d.cod}</td><td>${escHtml(d.descricao)}</td><td>${d.referencia}</td><td class="td-val" style="color:#dc2626">${fmtCurrency(d.valor)}</td></tr>`).join('');
    const statusBadge=slip.status==='pago'?`<span class="badge badge--pago" style="margin-left:8px"><i class="fas fa-check"></i> Pago</span>`:`<span class="badge badge--gerado" style="margin-left:8px"><i class="fas fa-file-circle-check"></i> Publicado</span>`;
    body.innerHTML=`
    <div class="slip-header">
        <div class="slip-company">Nexus RH ${statusBadge}</div>
        <div class="slip-period">Holerite de Pagamento — Competência ${slip.competencia}</div>
        <div class="slip-employee-row">
            <div class="slip-field"><span class="slip-field-label">Nome</span><span class="slip-field-value">${escHtml(emp.name)}</span></div>
            <div class="slip-field"><span class="slip-field-label">Cargo</span><span class="slip-field-value">${escHtml(emp.role||'—')}</span></div>
            <div class="slip-field"><span class="slip-field-label">Departamento</span><span class="slip-field-value">${escHtml(emp.dept||'—')}</span></div>
            <div class="slip-field"><span class="slip-field-label">Tipo Contrato</span><span class="slip-field-value">${escHtml(emp.contractType||'CLT')}</span></div>
            ${emp.admissionDate?`<div class="slip-field"><span class="slip-field-label">Admissão</span><span class="slip-field-value">${fmtDate(emp.admissionDate)}</span></div>`:''}
        </div>
    </div>
    <p class="slip-section-title">Proventos</p>
    <table class="slip-table"><thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th style="text-align:right">Valor (R$)</th></tr></thead><tbody>${provRows||'<tr><td colspan="4" style="color:#94a3b8;text-align:center;padding:12px">Nenhum provento</td></tr>'}</tbody></table>
    <p class="slip-section-title">Descontos</p>
    <table class="slip-table"><thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th style="text-align:right">Valor (R$)</th></tr></thead><tbody>${descRows||'<tr><td colspan="4" style="color:#94a3b8;text-align:center;padding:12px">Nenhum desconto</td></tr>'}</tbody></table>
    <div class="slip-totals">
        <div class="slip-total-box blue"><div class="slip-total-label">Total Proventos</div><div class="slip-total-value">${fmtCurrency(slip.total_proventos)}</div></div>
        <div class="slip-total-box red"><div class="slip-total-label">Total Descontos</div><div class="slip-total-value">${fmtCurrency(slip.total_descontos)}</div></div>
        <div class="slip-total-box green"><div class="slip-total-label">Salário Líquido</div><div class="slip-total-value">${fmtCurrency(slip.salario_liquido)}</div></div>
    </div>`;
}

// ─── Dept filters ─────────────────────────────────────────────

function populateDeptFilters() {
    const depts = [...new Set(employees.map(e=>e.dept||'').filter(Boolean))].sort();
    ['dept-filter','dept-hol-filter'].forEach(id => {
        const sel = document.getElementById(id); if (!sel) return;
        const val = sel.value; sel.innerHTML='<option value="">Todos os departamentos</option>';
        depts.forEach(d => { const opt=document.createElement('option'); opt.value=d; opt.textContent=d; if (d===val) opt.selected=true; sel.appendChild(opt); });
    });
}

// ─── Realtime ─────────────────────────────────────────────────

function setupRealtimeSync() {
    sb.channel('payslips-rh')
        .on('postgres_changes', { event:'*', schema:'public', table:'payslips' }, async () => { await refresh(); })
        .on('postgres_changes', { event:'*', schema:'public', table:'employees' }, async () => { await refresh(); })
        .subscribe();
}

// ─── Export ───────────────────────────────────────────────────

function setupExportDropdown() {
    const btn=document.getElementById('btn-export'); const menu=document.getElementById('export-menu'); const chevron=btn?.querySelector('.export-chevron');
    if (!btn||!menu) return;
    btn.addEventListener('click', e => { e.stopPropagation(); const open=menu.classList.toggle('open'); chevron?.classList.toggle('rotated',open); });
    document.addEventListener('click', () => { menu.classList.remove('open'); chevron?.classList.remove('rotated'); });
    menu.addEventListener('click', e => e.stopPropagation());
    document.getElementById('export-excel')?.addEventListener('click', () => { menu.classList.remove('open'); chevron?.classList.remove('rotated'); exportExcel(); });
    document.getElementById('export-pdf')?.addEventListener('click',   () => { menu.classList.remove('open'); chevron?.classList.remove('rotated'); exportPDF(); });
}

function exportExcel() {
    if (typeof XLSX==='undefined') { alert('Biblioteca Excel não carregada.'); return; }
    const wb=XLSX.utils.book_new();
    const header=['Colaborador','Departamento','Contrato','Salário Bruto','INSS','IRRF','Benefícios','Líquido','Status'];
    const body=allRows.map(r=>[r.emp.name,r.emp.dept||'—',(r.emp.contractType||'CLT').toUpperCase(),r.calc.bruto,r.calc.inss,r.calc.irrf,r.calc.benef,r.calc.liquido,r.pago?'Pago':r.gerado?'Gerado':'Pendente']);
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([header,...body]),`Folha ${currentMonth}`);
    XLSX.writeFile(wb,`folha-pagamento-${currentMonth}.xlsx`);
}

function exportPDF() {
    if (typeof window.jspdf==='undefined') { alert('Biblioteca PDF não carregada.'); return; }
    const{jsPDF}=window.jspdf; const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    doc.setFillColor(13,14,18); doc.rect(0,0,297,22,'F'); doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(255,255,255);
    doc.text(`Nexus RH — Folha de Pagamento — ${fmtMonthLabel(currentMonth)}`,14,15);
    doc.autoTable({ startY:28, head:[['Colaborador','Departamento','Contrato','Bruto','INSS','IRRF','Benefícios','Líquido','Status']], body:allRows.map(r=>[r.emp.name,r.emp.dept||'—',(r.emp.contractType||'CLT').toUpperCase(),fmtCurrency(r.calc.bruto),fmtCurrency(r.calc.inss),fmtCurrency(r.calc.irrf),fmtCurrency(r.calc.benef),fmtCurrency(r.calc.liquido),r.pago?'Pago':r.gerado?'Gerado':'Pendente']), headStyles:{fillColor:[99,102,241],textColor:255,fontStyle:'bold'}, alternateRowStyles:{fillColor:[248,249,250]}, margin:{left:14,right:14}, theme:'striped' });
    doc.save(`folha-pagamento-${currentMonth}.pdf`);
}

// ─── Modal / Tab / Sidebar ────────────────────────────────────

window.switchTab = function (btn, name) { document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active')); document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active')); btn.classList.add('active'); document.getElementById(`tab-${name}`)?.classList.add('active'); };
function openModal(id)  { const el=document.getElementById(id); if(el){el.classList.add('open');document.body.style.overflow='hidden';} }
function closeModal(id) { const el=document.getElementById(id); if(el){el.classList.remove('open');document.body.style.overflow='';} }
window.closeModal = closeModal;
window.handleOverlayClick = function(e,id){if(e.target===document.getElementById(id))closeModal(id);};
document.addEventListener('keydown', e => { if(e.key==='Escape'){document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open'));document.body.style.overflow='';} });

function setupSidebar() {
    const sidebar=document.getElementById('sidebar'); const toggle=document.getElementById('sidebar-toggle'); const topbar=document.getElementById('topbar-menu-btn'); const overlay=document.getElementById('sidebar-overlay'); const wrapper=document.getElementById('main-wrapper');
    const isMobile=()=>window.innerWidth<=768; const open=()=>{sidebar?.classList.add('open');overlay?.classList.add('active');document.body.style.overflow='hidden';}; const close=()=>{sidebar?.classList.remove('open');overlay?.classList.remove('active');document.body.style.overflow='';};
    toggle?.addEventListener('click', e=>{e.stopPropagation();isMobile()?(sidebar?.classList.contains('open')?close():open()):(()=>{const c=sidebar?.classList.toggle('collapsed');wrapper?.classList.toggle('sidebar-collapsed',c);})();});
    topbar?.addEventListener('click', e=>{e.stopPropagation();sidebar?.classList.contains('open')?close():open();});
    overlay?.addEventListener('click',close); window.addEventListener('resize',()=>{if(!isMobile())close();});
}

// ─── Utils ────────────────────────────────────────────────────

function setText(id,val){const el=document.getElementById(id);if(el)el.textContent=val;}
function fmtCurrency(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function fmtDate(str){if(!str)return'—';const[y,m,d]=str.split('-');return`${d}/${m}/${y}`;}
function fmtMonthLabel(key){if(!key)return'';const[y,m]=key.split('-');const lbl=new Date(+y,+m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});return lbl.charAt(0).toUpperCase()+lbl.slice(1);}
function initials(name){return(name||'?').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('');}
function nameToColor(name){const p=['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#f97316','#0ea5e9','#14b8a6'];let h=0;for(const c of(name||''))h=(h*31+c.charCodeAt(0))|0;return p[Math.abs(h)%p.length];}
function escHtml(str){if(typeof str!=='string')return str??'';return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function showToast(msg,type='success'){const icons={success:'fa-check-circle',error:'fa-times-circle',info:'fa-info-circle',warning:'fa-exclamation-triangle'};const c=document.getElementById('toast-container');if(!c)return;const t=document.createElement('div');t.className=`toast ${type}`;t.innerHTML=`<div class="toast-icon"><i class="fas ${icons[type]||icons.success}"></i></div><div style="flex:1">${escHtml(msg)}</div><button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast')?.remove(),300)"><i class="fas fa-times"></i></button>`;c.appendChild(t);requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));setTimeout(()=>{t.classList.remove('show');t.classList.add('hide');setTimeout(()=>t.remove(),300);},4500);}
async function logout(){await sb.auth.signOut();window.location.href='../screens/login.html';}
