/* ════════════════════════════════════════════════════════
   banco-horas-rh.js — Gestão de Banco de Horas — Supabase
   ════════════════════════════════════════════════════════ */

const pad0 = n => String(n).padStart(2, '0');

let currentFilter  = 'todos';
let currentSearch  = '';
let currentMonth   = '';
let adjustingEmpId = null;
let detailEmpId    = null;
let detailMonth    = '';
let allData        = [];
let auditTipoFilter = 'todos';

// Cache de dados
let allEmps        = [];
let timeRecordsMap = {};  // { employee_id: { date: record } }
let bankAdjMap     = {};  // { employee_id: [adjustments] }
let rhUser         = null;

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }
    const { data: profile } = await sb.from('profiles').select('profile').eq('id', user.id).single();
    if (profile?.profile !== 'Administrador') { window.location.href = '../screens/login.html'; return; }
    rhUser = user;

    setText('rh-sidebar-name',   'Administrador');
    setText('rh-sidebar-role',   'Recursos Humanos');
    setText('rh-sidebar-avatar', 'ADM');

    setupSidebar();

    const now = new Date();
    currentMonth = `${now.getFullYear()}-${pad0(now.getMonth() + 1)}`;
    setupCustomMonthPicker();

    await refresh();
    await initAuditTab();
    setupFilterDropdown();
    setupRealtimeSync();
});

// ─── Data ─────────────────────────────────────────────────────

function nextMonthKey(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const next = new Date(y, m, 1);
    return `${next.getFullYear()}-${pad0(next.getMonth() + 1)}-01`;
}

async function loadAllData() {
    const monthStart = `${currentMonth}-01`;
    const monthEnd   = nextMonthKey(currentMonth);

    const [{ data: empData }, { data: timeData }, { data: bankData }] = await Promise.all([
        sb.from('employees').select('*').in('status', ['Ativo', 'ativo']).order('name'),
        sb.from('time_records').select('*').gte('date', monthStart).lt('date', monthEnd),
        sb.from('bank_adjustments').select('*').is('deleted_at', null),
    ]);

    allEmps = (empData || []).map(e => ({
        id: e.id, name: e.name, dept: e.dept, role: e.role,
        contractType: e.contract_type, email: e.email,
        admissionDate: e.admission_date,
    }));

    timeRecordsMap = {};
    (timeData || []).forEach(r => {
        if (!timeRecordsMap[r.employee_id]) timeRecordsMap[r.employee_id] = {};
        timeRecordsMap[r.employee_id][r.date] = r;
    });

    bankAdjMap = {};
    (bankData || []).forEach(a => {
        if (!bankAdjMap[a.employee_id]) bankAdjMap[a.employee_id] = [];
        bankAdjMap[a.employee_id].push(a);
    });
}

function getPontoRecords(empId) { return timeRecordsMap[empId] || {}; }
function getBancoAjustes(empId) { return (bankAdjMap[empId] || []).filter(a => !a.deleted_at); }

async function refresh() {
    await loadAllData();
    allData = buildAllBalances(currentMonth);
    loadKPIs();
    renderTable();
}

// ─── Cálculo de saldo ─────────────────────────────────────────

function getJornadaMin(contractType) {
    const tipo = (contractType || 'clt').toLowerCase();
    if (tipo === 'estagio' || tipo === 'estágio' || tipo === 'aprendiz') return 6 * 60;
    if (tipo === 'pj') return null;
    return 8 * 60;
}

function isFalta(rec) { return !rec || !rec.entrada; }

function diffMin(a, b) { if (!a || !b) return 0; return Math.round((new Date(b) - new Date(a)) / 60000); }

function calcWorkedMin(rec) {
    if (!rec || !rec.entrada) return 0;
    if (rec.saida_almoco) { const m=diffMin(rec.entrada,rec.saida_almoco); const a=(rec.retorno_almoco&&rec.saida)?diffMin(rec.retorno_almoco,rec.saida):0; return m+a; }
    return rec.saida ? diffMin(rec.entrada, rec.saida) : 0;
}

function calcSaldoMin(rec, jornadaMin) {
    if (isFalta(rec) || !rec.saida || jornadaMin === null) return null;
    return calcWorkedMin(rec) - jornadaMin;
}

function minToStr(min) { const abs=Math.abs(min); return `${Math.floor(abs/60)}h ${pad0(abs%60)}min`; }
function formatSaldo(min) { if (min===0) return '0h 00min'; return `${min>0?'+':'-'}${minToStr(min)}`; }

function buildAllBalances(monthKey) {
    return allEmps.map(emp => computeBalance(emp, monthKey));
}

function computeBalance(emp, monthKey) {
    const jornadaMin = getJornadaMin(emp.contractType);
    const records    = getPontoRecords(emp.id);
    const ajustes    = getBancoAjustes(emp.id);
    const isPJ       = jornadaMin === null;
    let extrasMin=0, faltaMin=0, diasCompletos=0, totalWorkedMin=0;
    Object.entries(records).forEach(([key, rec]) => {
        if (!key.startsWith(monthKey)) return;
        if (isFalta(rec) || !rec.saida) return;
        diasCompletos++; const worked=calcWorkedMin(rec); totalWorkedMin+=worked;
        if (!isPJ) { const s=calcSaldoMin(rec,jornadaMin); if(s!==null){if(s>0)extrasMin+=s;else faltaMin+=Math.abs(s);} }
    });
    let ajusteMin=0;
    ajustes.filter(a=>a.date&&a.date.startsWith(monthKey)).forEach(a=>{ajusteMin+=(a.tipo==='credito')?a.minutos:-a.minutos;});
    const saldoLiquido = isPJ ? null : (extrasMin - faltaMin + ajusteMin);
    return { emp, jornadaMin, isPJ, extrasMin, faltaMin, ajusteMin, saldoLiquido, diasCompletos, totalWorkedMin };
}

// ─── KPIs ─────────────────────────────────────────────────────

function loadKPIs() {
    let totalExtras=0, totalFaltas=0, cntPos=0, cntNeg=0, cntCritico=0;
    allData.forEach(d => {
        if (d.isPJ) return;
        totalExtras+=d.extrasMin; totalFaltas+=d.faltaMin;
        if (d.saldoLiquido>0)cntPos++; if (d.saldoLiquido<0)cntNeg++;
        if (d.saldoLiquido!==null&&d.saldoLiquido<=-1200)cntCritico++;
    });
    setText('kpi-total-extras', totalExtras?minToStr(totalExtras):'0h 00min');
    setText('kpi-total-faltas', totalFaltas?minToStr(totalFaltas):'0h 00min');
    setText('kpi-count-pos',     cntPos);
    setText('kpi-count-neg',     cntNeg);
    setText('kpi-count-critico', cntCritico);
}

// ─── Tabela principal ─────────────────────────────────────────

function renderTable() {
    const tbody = $('banco-tbody'); if (!tbody) return;
    const q = currentSearch.toLowerCase();
    const filtered = allData.filter(d => {
        if (q && !d.emp.name.toLowerCase().includes(q) && !(d.emp.dept||'').toLowerCase().includes(q)) return false;
        if (currentFilter==='positivo') return !d.isPJ&&d.saldoLiquido>0;
        if (currentFilter==='negativo') return !d.isPJ&&d.saldoLiquido<0;
        if (currentFilter==='zerado')   return d.isPJ||d.saldoLiquido===0;
        if (currentFilter==='critico')  return !d.isPJ&&d.saldoLiquido!==null&&d.saldoLiquido<=-1200;
        return true;
    });
    if (!filtered.length) { tbody.innerHTML=`<tr><td colspan="8"><div class="table-empty"><i class="fas fa-clock-rotate-left"></i><p>Nenhum colaborador encontrado.</p></div></td></tr>`; setText('table-count',''); return; }
    tbody.innerHTML = filtered.map(d => buildRow(d)).join('');
    const cnt=filtered.length; setText('table-count',`${cnt} colaborador${cnt!==1?'es':''} exibido${cnt!==1?'s':''}`);
}

function buildRow(d) {
    const{emp,jornadaMin,isPJ,extrasMin,faltaMin,saldoLiquido,diasCompletos}=d;
    const ini=initials(emp.name),color=nameToColor(emp.name),jStr=isPJ?'PJ':`${jornadaMin/60}h/dia`,ctStr=emp.contractType?(emp.contractType.toUpperCase()):'CLT';
    const isCritico=!isPJ&&saldoLiquido!==null&&saldoLiquido<=-1200;
    let saldoHTML,saldoBadge;
    if(isPJ){saldoHTML=`<span class="saldo-cell zero">—</span>`;saldoBadge=`<span class="badge badge--pj">PJ</span>`;}
    else{const cls=saldoLiquido>0?'positivo':saldoLiquido<0?'negativo':'zero';saldoHTML=`<span class="saldo-cell ${cls}">${formatSaldo(saldoLiquido)}</span>`;saldoBadge=isCritico?`<span class="badge badge--critico"><i class="fas fa-triangle-exclamation"></i> Crítico</span>`:`<span class="badge badge--${saldoLiquido>0?'positivo':saldoLiquido<0?'negativo':'zerado'}">${saldoLiquido>0?'Positivo':saldoLiquido<0?'Negativo':'Zerado'}</span>`;}
    const extrasCls=extrasMin>0?'extras':'zero',faltasCls=faltaMin>0?'faltas':'zero';
    return `<tr><td><div class="emp-cell"><div class="emp-avatar" style="background:${color}">${ini}</div><div><p class="emp-name">${emp.name}</p><p class="emp-dept">${emp.dept||'—'}</p></div></div></td><td>${ctStr}</td><td>${jStr}</td><td>${diasCompletos}</td><td><span class="td-hours ${extrasCls}">${extrasMin?'+'+minToStr(extrasMin):'0h 00min'}</span></td><td><span class="td-hours ${faltasCls}">${faltaMin?'-'+minToStr(faltaMin):'0h 00min'}</span></td><td>${saldoHTML}</td><td><div class="actions-cell"><button class="btn-action btn-action--view" onclick="openDetailModal('${emp.id}')" title="Ver detalhes"><i class="fas fa-eye"></i></button><button class="btn-action btn-action--adjust" onclick="openAdjustModal('${emp.id}')" title="Lançar ajuste">${isPJ?'<i class="fas fa-pen-to-square" style="opacity:.35"></i>':'<i class="fas fa-pen-to-square"></i>'}</button></div></td></tr>`;
}

// ─── Filtros ──────────────────────────────────────────────────

const FILTER_LABELS_BH = { todos: 'Filtro', positivo: 'Saldo Positivo', negativo: 'Saldo Negativo', zerado: 'Zerado / PJ', critico: 'Crítico' };

function updateFilterBtn() {
    const label = $('filter-label');
    const btn   = $('btn-filter');
    if (label) label.textContent = FILTER_LABELS_BH[currentFilter] ?? 'Filtro';
    btn?.classList.toggle('filtered', currentFilter !== 'todos');
}

function openFilterDropdown() {
    $('btn-filter')?.classList.add('open');
    $('filter-dropdown-menu')?.classList.add('open');
    $('filter-chevron')?.classList.add('open');
}

function closeFilterDropdown() {
    $('btn-filter')?.classList.remove('open');
    $('filter-dropdown-menu')?.classList.remove('open');
    $('filter-chevron')?.classList.remove('open');
}

function setupFilterDropdown() {
    const btn  = $('btn-filter');
    const menu = $('filter-dropdown-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', e => {
        e.stopPropagation();
        menu.classList.contains('open') ? closeFilterDropdown() : openFilterDropdown();
    });
    menu.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', closeFilterDropdown);
}

window.setFilter = function (btn) {
    document.querySelectorAll('.filter-dropdown-chips .chip').forEach(c => c.classList.remove('chip--active'));
    btn.classList.add('chip--active');
    currentFilter = btn.dataset.filter;
    updateFilterBtn();
    closeFilterDropdown();
    renderTable();
};
window.applyFilters = function () { const inp=$('search-input'); currentSearch=inp?inp.value.trim():''; const clr=$('search-clear'); if(clr)clr.classList.toggle('hidden',!currentSearch); renderTable(); };
window.clearSearch  = function () { const inp=$('search-input'); if(inp)inp.value=''; currentSearch=''; const clr=$('search-clear'); if(clr)clr.classList.add('hidden'); renderTable(); };

// ─── Detail modal ─────────────────────────────────────────────

window.openDetailModal = function (empId) {
    const data = allData.find(d => d.emp.id === empId);
    if (!data) return;
    detailEmpId = empId; detailMonth = currentMonth;
    renderDetailModal(data.emp, detailMonth);
    openModal('detail-modal');
};

window.closeDetailModal = function () { closeModal('detail-modal'); };

window.changeDetailMonth = async function (empId, monthKey) {
    detailMonth = monthKey;
    const emp = allEmps.find(e => e.id === empId);
    if (!emp) return;
    // Load time_records for this specific month if not cached
    const mStart = `${monthKey}-01`, mEnd = nextMonthKey(monthKey);
    const { data } = await sb.from('time_records').select('*').eq('employee_id', empId).gte('date', mStart).lt('date', mEnd);
    if (!timeRecordsMap[empId]) timeRecordsMap[empId] = {};
    (data || []).forEach(r => { timeRecordsMap[empId][r.date] = r; });
    renderDetailModal(emp, monthKey);
};

function renderDetailModal(emp, monthKey) {
    const body = $('detail-body'); if (!body) return;
    const jornadaMin=getJornadaMin(emp.contractType), isPJ=jornadaMin===null;
    const records=getPontoRecords(emp.id), ajustes=getBancoAjustes(emp.id);
    const monthRecs=Object.entries(records).filter(([k])=>k.startsWith(monthKey)).sort(([a],[b])=>a.localeCompare(b));
    const monthAjustes=ajustes.filter(a=>a.date&&a.date.startsWith(monthKey));
    let extrasMin=0,faltaMin=0,diasCompletos=0,totalWorked=0;
    monthRecs.forEach(([,rec])=>{if(isFalta(rec)||!rec.saida)return;diasCompletos++;totalWorked+=calcWorkedMin(rec);if(!isPJ){const s=calcSaldoMin(rec,jornadaMin);if(s!==null){if(s>0)extrasMin+=s;else faltaMin+=Math.abs(s);}}});
    let ajusteMin=0;monthAjustes.forEach(a=>{ajusteMin+=a.tipo==='credito'?a.minutos:-a.minutos;});
    const saldoLiquido=isPJ?null:(extrasMin-faltaMin+ajusteMin);
    const saldoCls=saldoLiquido===null?'zero':saldoLiquido>0?'positivo':saldoLiquido<0?'negativo':'zero';
    const color=nameToColor(emp.name),ini=initials(emp.name);
    const monthOptions=buildMonthOptions(monthKey);

    let html=`<div class="detail-emp-header"><div class="detail-emp-avatar" style="background:${color}">${ini}</div><div class="detail-emp-info"><p class="detail-emp-name">${emp.name}</p><p class="detail-emp-meta"><span><i class="fas fa-building" style="margin-right:3px;color:var(--accent)"></i>${emp.dept||'—'}</span><span><i class="fas fa-briefcase" style="margin-right:3px;color:var(--accent)"></i>${emp.role||'—'}</span><span><i class="fas fa-clock" style="margin-right:3px;color:var(--accent)"></i>${isPJ?'PJ — sem jornada fixa':`Jornada ${jornadaMin/60}h/dia`}</span></p></div><select class="detail-month-select" onchange="changeDetailMonth('${emp.id}',this.value)">${monthOptions}</select></div>
    <div class="detail-stats"><div class="stat-card"><div class="stat-label">Dias Registrados</div><div class="stat-value">${diasCompletos}</div></div><div class="stat-card"><div class="stat-label">H. Trabalhadas</div><div class="stat-value">${totalWorked?minToStr(totalWorked):'0h 00min'}</div></div><div class="stat-card ${isPJ?'':(extrasMin?'positivo':'')}"><div class="stat-label">H. Extras</div><div class="stat-value">${isPJ?'—':(extrasMin?'+'+minToStr(extrasMin):'0h 00min')}</div></div><div class="stat-card ${saldoCls}"><div class="stat-label">Saldo Líquido</div><div class="stat-value">${saldoLiquido===null?'—':formatSaldo(saldoLiquido)}</div></div></div>
    <div><p class="detail-section-title"><i class="fas fa-calendar-days"></i> Registros de Ponto — ${fmtMonthLabel(monthKey)}</p>`;

    if (!monthRecs.length) { html+=`<div class="empty-month-msg"><i class="fas fa-calendar-times"></i><p>Nenhum registro de ponto neste período.</p></div>`; }
    else { html+=`<div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Data</th><th>Entrada</th><th>Saída Alm.</th><th>Retorno</th><th>Saída</th><th>Trabalhado</th><th>Saldo</th><th>Status</th></tr></thead><tbody>${monthRecs.map(([key,rec])=>buildDayRow(key,rec,jornadaMin,isPJ)).join('')}</tbody></table></div>`; }

    html+=`</div><div class="ajustes-section"><div class="ajustes-header"><p class="detail-section-title" style="margin-bottom:0"><i class="fas fa-pen-to-square"></i> Ajustes Manuais — ${fmtMonthLabel(monthKey)}</p><button class="btn-add-ajuste" onclick="openAdjustModalFromDetail('${emp.id}')"><i class="fas fa-plus"></i> Novo Ajuste</button></div>`;
    if (!monthAjustes.length) { html+=`<p class="no-ajustes">Nenhum ajuste manual para este período.</p>`; }
    else { html+=monthAjustes.map(a=>`<div class="ajuste-item"><span class="ajuste-tipo-badge ${a.tipo}"><i class="fas ${a.tipo==='credito'?'fa-plus':'fa-minus'}"></i>${a.tipo==='credito'?'Crédito':'Débito'}</span><div class="ajuste-info"><p class="ajuste-valor">${a.tipo==='credito'?'+':'-'}${minToStr(a.minutos)}</p><p class="ajuste-just">${a.justificativa}</p><p class="ajuste-meta">${a.date} &bull; por ${a.created_by_name||'RH'} &bull; ${new Date(a.created_at).toLocaleDateString('pt-BR')}</p></div><button class="btn-delete-ajuste" onclick="deleteAjuste('${emp.id}','${a.id}')" title="Excluir ajuste"><i class="fas fa-trash"></i></button></div>`).join(''); }
    html+=`</div>`;
    body.innerHTML=html;
}

function buildDayRow(key, rec, jornadaMin, isPJ) {
    const [y,m,d]=key.split('-');const dias=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];const diaSem=dias[new Date(`${key}T12:00:00`).getDay()];
    const t=field=>{const v=rec[field];if(!v)return`<span class="dt-time missing">—</span>`;const dt=new Date(v);return`<span class="dt-time${rec[field+'_ajustado']?' ajustado':''}">${pad0(dt.getHours())}:${pad0(dt.getMinutes())}</span>`;};
    if(isFalta(rec))return`<tr><td class="dt-date">${d}/${m}/${y}<span class="dt-diaSem">${diaSem}</span></td><td colspan="4" style="color:var(--text-tertiary);font-style:italic;font-size:.8rem">Sem registros</td><td>—</td><td class="dt-saldo zero">—</td><td><span class="badge-sm badge-sm-falta">Falta</span></td></tr>`;
    const worked=calcWorkedMin(rec),workedStr=rec.saida?minToStr(worked):'—';
    let saldoStr='—',saldoCls='zero',badgeHTML='';
    if(!rec.saida){badgeHTML=`<span class="badge-sm badge-sm-incompleto">Incompleto</span>`;}
    else if(isPJ){saldoStr=minToStr(worked);badgeHTML=`<span class="badge-sm badge-sm-pj">PJ</span>`;}
    else{const saldo=calcSaldoMin(rec,jornadaMin);if(saldo!==null){saldoStr=(saldo>=0?'+':'-')+minToStr(saldo);saldoCls=saldo>0?'positivo':saldo<0?'negativo':'zero';}if(rec.ajustado)badgeHTML=`<span class="badge-sm badge-sm-incompleto">Ajustado</span>`;else if(saldo>0)badgeHTML=`<span class="badge-sm badge-sm-extra">Extra</span>`;else if(saldo<0)badgeHTML=`<span class="badge-sm badge-sm-falta">Falta</span>`;else badgeHTML=`<span class="badge-sm badge-sm-normal">Normal</span>`;}
    return`<tr><td class="dt-date">${d}/${m}/${y}<span class="dt-diaSem">${diaSem}</span></td><td>${t('entrada')}</td><td>${t('saida_almoco')}</td><td>${t('retorno_almoco')}</td><td>${t('saida')}</td><td>${workedStr}</td><td class="dt-saldo ${saldoCls}">${saldoStr}</td><td>${badgeHTML}</td></tr>`;
}

function buildMonthOptions(selected) {
    const now=new Date(),opts=[];
    for(let i=-11;i<=1;i++){const d=new Date(now.getFullYear(),now.getMonth()+i,1);const val=`${d.getFullYear()}-${pad0(d.getMonth()+1)}`;const lbl=d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});opts.push(`<option value="${val}"${val===selected?' selected':''}>${lbl.charAt(0).toUpperCase()+lbl.slice(1)}</option>`);}
    return opts.join('');
}

// ─── Ajuste manual ────────────────────────────────────────────

window.openAdjustModal = function (empId) {
    const data=allData.find(d=>d.emp.id===empId); if(!data)return;
    adjustingEmpId=empId;
    const sub=$('adjust-sub'); if(sub)sub.textContent=data.emp.name;
    ['adjust-horas','adjust-min','adjust-just'].forEach(id=>{const el=$(id);if(el)el.value='';});
    const dt=$('adjust-data'); if(dt)dt.value=isoDate(new Date());
    const al=$('adjust-alert'); if(al){al.className='modal-alert';al.textContent='';}
    openModal('adjust-modal');
};

window.openAdjustModalFromDetail = function (empId) { closeModal('detail-modal'); setTimeout(()=>window.openAdjustModal(empId),120); };
window.closeAdjustModal = function () { closeModal('adjust-modal'); };

window.submitAdjust = async function () {
    const tipo  = $('adjust-tipo')?.value  || 'credito';
    const horas = parseInt($('adjust-horas')?.value || '0', 10);
    const mins  = parseInt($('adjust-min')?.value   || '0', 10);
    const data  = $('adjust-data')?.value || '';
    const just  = $('adjust-just')?.value?.trim() || '';
    const al=$('adjust-alert');
    const showErr=msg=>{if(al){al.className='modal-alert error';al.innerHTML=`<i class="fas fa-exclamation-circle"></i> ${msg}`;}};
    const total=horas*60+mins;
    if (!data)   return showErr('Informe a data de referência.');
    if (total<=0) return showErr('Informe um valor de horas/minutos maior que zero.');
    if (!just)   return showErr('A justificativa é obrigatória.');

    const empData=allData.find(d=>d.emp.id===adjustingEmpId); if(!empData)return;
    const { data: inserted, error } = await sb.from('bank_adjustments').insert({
        employee_id: adjustingEmpId, tipo, minutos: total, date: data,
        justificativa: just, created_by_name: rhUser?.email?.split('@')[0] || 'RH'
    }).select().single();

    if (error) { showErr('Erro ao salvar ajuste.'); return; }

    if (!bankAdjMap[adjustingEmpId]) bankAdjMap[adjustingEmpId] = [];
    bankAdjMap[adjustingEmpId].push(inserted);

    await sb.from('activity_logs').insert({
        employee_id: adjustingEmpId, tipo:'ajuste_banco', acao:tipo, date:data,
        minutos:total, operator_email:rhUser?.email, operator_name:rhUser?.email?.split('@')[0]||'RH',
        operator_profile:'Administrador', justificativa:just
    });

    closeModal('adjust-modal');
    showToast(`Ajuste de ${tipo==='credito'?'+':'-'}${minToStr(total)} lançado para ${empData.emp.name}.`, 'success');
    await refresh();
    if (detailEmpId&&String(detailEmpId)===String(adjustingEmpId)) setTimeout(()=>window.openDetailModal(detailEmpId),180);
};

window.deleteAjuste = async function (empId, adjId) {
    await sb.from('bank_adjustments').update({ deleted_at: new Date().toISOString() }).eq('id', adjId);
    await sb.from('activity_logs').insert({
        employee_id: empId, tipo:'ajuste_banco', acao:'exclusao', date:isoDate(new Date()),
        operator_email:rhUser?.email, operator_name:rhUser?.email?.split('@')[0]||'RH',
        operator_profile:'Administrador', justificativa:`Exclusão do ajuste #${adjId}`
    });
    if (bankAdjMap[empId]) bankAdjMap[empId] = bankAdjMap[empId].filter(a => a.id !== adjId);
    showToast('Ajuste removido.', 'info');
    await refresh();
    if (detailEmpId) { const emp=allEmps.find(e=>e.id===detailEmpId); if(emp)renderDetailModal(emp,detailMonth); }
};

// ─── Auditoria ────────────────────────────────────────────────

async function initAuditTab() {
    const sel=$('audit-emp-select');
    if (sel) {
        allEmps.forEach(emp => {
            const opt=document.createElement('option'); opt.value=emp.id; opt.textContent=emp.name; sel.appendChild(opt);
        });
    }
    const am=$('audit-month'); if(am)am.value=currentMonth;
    await renderAuditTable();
}

window.switchTab = function (btn, name) { document.querySelectorAll('.tabs-bar .tab-btn').forEach(b=>b.classList.remove('active')); document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active')); btn.classList.add('active'); document.getElementById(`tab-${name}`)?.classList.add('active'); if(name==='auditoria')renderAuditTable(); };

window.setAuditTipo = function (btn) { document.querySelectorAll('[data-audit-tipo]').forEach(b=>b.classList.remove('chip--active')); btn.classList.add('chip--active'); auditTipoFilter=btn.dataset.auditTipo; renderAuditTable(); };

window.renderAuditTable = async function () {
    const tbody=$('audit-tbody'); if(!tbody)return;
    const empFilter=$('audit-emp-select')?.value||'all';
    const month=$('audit-month')?.value||'';

    let query = sb.from('activity_logs').select('*, employees(name, dept)').order('created_at', { ascending: false });
    if (empFilter !== 'all') query = query.eq('employee_id', empFilter);
    if (month) query = query.gte('date', `${month}-01`).lt('date', nextMonthKey(month));
    if (auditTipoFilter !== 'todos') query = query.eq('tipo', auditTipoFilter);

    const { data: entries } = await query;
    const all = entries || [];

    if (!all.length) { tbody.innerHTML=`<tr><td colspan="7"><div class="table-empty"><i class="fas fa-scroll"></i><p>Nenhum registro de auditoria encontrado.</p></div></td></tr>`; setText('audit-count',''); return; }

    tbody.innerHTML = all.map(e => buildAuditRow(e)).join('');
    const cnt=all.length; setText('audit-count',`${cnt} registro${cnt!==1?'s':''} encontrado${cnt!==1?'s':''}`);
};

async function renderAuditTable() { await window.renderAuditTable(); }

function buildAuditRow(e) {
    const ACAO_LABEL={entrada:'Entrada',saida_almoco:'Saída p/ Almoço',retorno_almoco:'Retorno Almoço',saida:'Saída',credito:'Crédito',debito:'Débito',exclusao:'Exclusão de Ajuste'};
    const empName=e.employees?.name||e.operator_name||'—',empDept=e.employees?.dept||'—';
    const ini=initials(empName),color=nameToColor(empName);
    const ts=new Date(e.created_at),tsStr=`${pad0(ts.getDate())}/${pad0(ts.getMonth()+1)}/${ts.getFullYear()} ${pad0(ts.getHours())}:${pad0(ts.getMinutes())}`;
    const acaoLabel=ACAO_LABEL[e.acao]||e.acao||'—';
    let valorHTML='—';
    if(e.tipo==='ponto'&&e.valor_registrado){const dt=new Date(e.valor_registrado);valorHTML=`<span style="font-weight:600">${pad0(dt.getHours())}:${pad0(dt.getMinutes())}</span>`;}
    else if(e.tipo==='ajuste_banco'&&e.minutos){const sign=e.acao==='credito'?'+':'-';const cls=e.acao==='credito'?'color:#16a34a':'color:#dc2626';valorHTML=`<span style="font-weight:700;${cls}">${sign}${minToStr(e.minutos)}</span>`;}
    const tipoBadge=e.tipo==='ponto'?`<span class="audit-badge audit-badge--ponto">Ponto</span>`:`<span class="audit-badge audit-badge--banco">Banco</span>`;
    const perfilBadge=e.operator_profile==='Administrador'?`<span class="audit-badge audit-badge--rh">RH</span>`:`<span class="audit-badge audit-badge--colab">Colaborador</span>`;
    return`<tr><td style="white-space:nowrap;font-size:12.5px">${tsStr}</td><td><div class="emp-cell"><div class="emp-avatar" style="background:${color};width:28px;height:28px;font-size:10px;border-radius:50%">${ini}</div><div><p class="emp-name" style="font-size:12.5px">${empName}</p><p class="emp-dept">${empDept}</p></div></div></td><td>${tipoBadge}</td><td style="font-size:13px;font-weight:500">${acaoLabel}</td><td>${valorHTML}</td><td style="font-size:12.5px">${e.operator_name||e.operator_email||'—'} ${perfilBadge}</td><td style="font-size:12px;color:var(--text-secondary);max-width:180px">${e.justificativa||'—'}</td></tr>`;
}

// ─── Realtime ─────────────────────────────────────────────────

function setupRealtimeSync() {
    sb.channel('banco-rh')
        .on('postgres_changes', { event:'*', schema:'public', table:'time_records' }, async () => { await refresh(); if(document.getElementById('tab-auditoria')?.classList.contains('active'))await renderAuditTable(); })
        .on('postgres_changes', { event:'*', schema:'public', table:'bank_adjustments' }, async () => { await refresh(); })
        .on('postgres_changes', { event:'*', schema:'public', table:'employees' }, async () => { await refresh(); })
        .subscribe();
}

// ─── Custom Month Picker ──────────────────────────────────────

function setupCustomMonthPicker() {
    const MESES_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const MESES_LONG  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    const btn      = $('month-picker-btn');
    const dropdown = $('month-picker-dropdown');
    const chevron  = $('month-picker-chevron');
    const yearEl   = $('mpd-year');
    const monthsEl = $('mpd-months');
    const prevBtn  = $('mpd-prev-year');
    const nextBtn  = $('mpd-next-year');
    if (!btn || !dropdown) return;

    let pickerYear = new Date().getFullYear();

    function updateLabel() {
        const [y, m] = currentMonth.split('-');
        const el = $('month-picker-label');
        if (el) el.textContent = `${MESES_LONG[parseInt(m) - 1]} de ${y}`;
    }

    function renderMonths() {
        const now = new Date();
        const [selY, selM] = currentMonth.split('-');
        yearEl.textContent = pickerYear;
        monthsEl.innerHTML = MESES_SHORT.map((name, i) => {
            const m = i + 1;
            const isSelected = parseInt(selY) === pickerYear && parseInt(selM) === m;
            const isCurrent  = now.getFullYear() === pickerYear && now.getMonth() + 1 === m;
            let cls = 'mpd-month';
            if (isSelected) cls += ' selected';
            if (isCurrent)  cls += ' current';
            return `<button class="${cls}" data-m="${pad0(m)}">${name}</button>`;
        }).join('');
        monthsEl.querySelectorAll('.mpd-month').forEach(el => {
            el.addEventListener('click', () => {
                currentMonth = `${pickerYear}-${el.dataset.m}`;
                updateLabel();
                closeDropdown();
                refresh();
            });
        });
    }

    function openDropdown() {
        const [y] = currentMonth.split('-');
        pickerYear = parseInt(y);
        renderMonths();
        dropdown.classList.add('open');
        btn.classList.add('open');
        chevron.classList.add('open');
    }

    function closeDropdown() {
        dropdown.classList.remove('open');
        btn.classList.remove('open');
        chevron.classList.remove('open');
    }

    btn.addEventListener('click', e => { e.stopPropagation(); dropdown.classList.contains('open') ? closeDropdown() : openDropdown(); });
    prevBtn.addEventListener('click', e => { e.stopPropagation(); pickerYear--; renderMonths(); });
    nextBtn.addEventListener('click', e => { e.stopPropagation(); pickerYear++; renderMonths(); });
    dropdown.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', closeDropdown);

    updateLabel();
}

// ─── Sidebar / Modal / Toast ──────────────────────────────────

function setupSidebar() {
    const sidebar=$('sidebar'),toggle=$('sidebar-toggle'),topbar=$('topbar-menu-btn'),overlay=$('sidebar-overlay'),wrapper=document.querySelector('.main-wrapper');
    const isMobile=()=>window.innerWidth<=768;
    const openSide=()=>{sidebar?.classList.add('open');overlay?.classList.add('active');document.body.style.overflow='hidden';};
    const closeSide=()=>{sidebar?.classList.remove('open');overlay?.classList.remove('active');document.body.style.overflow='';};
    toggle?.addEventListener('click',e=>{e.stopPropagation();isMobile()?(sidebar?.classList.contains('open')?closeSide():openSide()):(()=>{const c=sidebar?.classList.toggle('collapsed');wrapper?.classList.toggle('sidebar-collapsed',c);})();});
    topbar?.addEventListener('click',e=>{e.stopPropagation();sidebar?.classList.contains('open')?closeSide():openSide();});
    overlay?.addEventListener('click',closeSide);
    window.addEventListener('resize',()=>{if(!isMobile())closeSide();});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeSide();closeAllModals();}});
}

function openModal(id){const el=$(id);if(el){el.classList.add('open');document.body.style.overflow='hidden';}}
function closeModal(id){const el=$(id);if(el){el.classList.remove('open');document.body.style.overflow='';}}
function closeAllModals(){document.querySelectorAll('.modal-overlay').forEach(el=>el.classList.remove('open'));document.body.style.overflow='';}
window.handleOverlayClick = function(e,id){if(e.target===e.currentTarget)closeModal(id);};

function showToast(title, type='success') {
    const c=$('toast-container');if(!c)return;
    const icons={success:'fa-check',error:'fa-times',warning:'fa-exclamation-triangle',info:'fa-info-circle'};
    const t=document.createElement('div');t.className=`toast ${type}`;
    t.innerHTML=`<div class="toast-icon"><i class="fas ${icons[type]||'fa-check'}"></i></div><div style="flex:1">${title}</div><button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast')?.remove(),300)"><i class="fas fa-times"></i></button>`;
    c.appendChild(t);requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));
    setTimeout(()=>{t.classList.remove('show');t.classList.add('hide');setTimeout(()=>t.remove(),300);},4500);
}

// ─── Utils ────────────────────────────────────────────────────

function $(id){return document.getElementById(id);}
function setText(id,val){const el=$(id);if(el)el.textContent=val;}
function initials(name){return(name||'?').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('');}
function nameToColor(name){const p=['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#f97316','#0ea5e9','#14b8a6'];let h=0;for(const c of(name||''))h=(h*31+c.charCodeAt(0))|0;return p[Math.abs(h)%p.length];}
function fmtDate(key){if(!key)return'—';const[y,m,d]=key.split('-');return`${d}/${m}/${y}`;}
function fmtMonthLabel(key){if(!key)return'';const[y,m]=key.split('-');const d=new Date(+y,+m-1,1);const lbl=d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'});return lbl.charAt(0).toUpperCase()+lbl.slice(1);}
function isoDate(d){return`${d.getFullYear()}-${pad0(d.getMonth()+1)}-${pad0(d.getDate())}`;}
async function logout(){await sb.auth.signOut();window.location.href='../screens/login.html';}
