const pad0 = (n) => String(n).padStart(2, '0');

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

let currentFilter = 'todos';
let currentSearch = '';
let currentMonth = '';
let adjustingEmpId = null;
let detailEmpId = null;
let detailMonth = '';
let allData = [];
let auditTipoFilter = 'todos';

let allEmps = [];
let timeRecordsMap = {};
let bankAdjMap = {};
let rhUser = null;

let holidaysMap = {};
let vacationsByEmp = {};
let hrSettings = { banco_horas_vencimento_meses: 6, limite_extra_diario_min: CLTDomain.LIMITE_EXTRA_DIARIO_MIN_PADRAO };
let ledgerMap = {};

let bankRequestsAll = [];
let reqFilter = 'pendente';
let rejectingRequestId = null;

document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('Administrador');
    if (!auth) return;
    rhUser = auth.user;

    setText('rh-sidebar-name', 'Administrador');
    setText('rh-sidebar-role', 'Recursos Humanos');
    setText('rh-sidebar-avatar', 'ADM');

    setupSidebar();

    const now = new Date();
    currentMonth = `${now.getFullYear()}-${pad0(now.getMonth() + 1)}`;
    setupCustomMonthPicker();
    setupAdjustDatePicker();

    await loadStaticComplianceData();
    await refresh();
    await initAuditTab();
    await loadBankRequests();
    renderRequestsTab();
    updatePendingBadge();
    setupFilterDropdown();
    setupNotifPanel();
    setupExportButton();
    setupRealtimeSync();

    const deepLinkReqId = new URLSearchParams(location.search).get('req');
    if (deepLinkReqId) {
        document.querySelector('.tab-btn[data-tab="solicitacoes"]')?.click();
        document.querySelector('#tab-solicitacoes .chip[data-req-filter="todos"]')?.click();
        const row = document.querySelector(`#requests-tbody tr[data-id="${deepLinkReqId}"]`);
        if (row) {
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });
            row.classList.add('row-deep-link-highlight');
            setTimeout(() => row.classList.remove('row-deep-link-highlight'), 2600);
        }
    }
});

async function loadStaticComplianceData() {
    const [{ data: hol }, { data: vac }, { data: settings }] = await Promise.all([
        sb.from('holidays').select('*'),
        sb.from('vacations').select('employee_id,start_date,end_date,status').in('status', ['aprovado', 'concluido']),
        sb.from('hr_settings').select('*').eq('id', 1).single(),
    ]);

    holidaysMap = {};
    (hol || []).forEach((h) => {
        holidaysMap[h.date] = h;
    });

    vacationsByEmp = {};
    (vac || []).forEach((v) => {
        if (!vacationsByEmp[v.employee_id]) vacationsByEmp[v.employee_id] = [];
        vacationsByEmp[v.employee_id].push(v);
    });

    if (settings) {
        hrSettings = {
            banco_horas_vencimento_meses: settings.banco_horas_vencimento_meses,
            limite_extra_diario_min: settings.limite_extra_diario_min,
        };
    }
}

function isOnVacation(empId, dateKey) {
    const list = vacationsByEmp[empId];
    if (!list) return false;
    return list.some((v) => dateKey >= v.start_date && dateKey <= v.end_date);
}

function isSunday(dateKey) {
    return CLTDomain.isSunday(dateKey);
}

function isNoturno(rec) {
    return CLTDomain.isNoturno(rec);
}

async function loadBankLedger() {
    const [{ data: allTime }, { data: allAdj }] = await Promise.all([
        sb.from('time_records').select('employee_id,date,entrada,saida_almoco,retorno_almoco,saida'),
        sb.from('bank_adjustments').select('employee_id,tipo,minutos,date').is('deleted_at', null),
    ]);

    const byEmpMonth = {};
    const empMap = {};
    allEmps.forEach((e) => {
        empMap[e.id] = e;
    });

    (allTime || []).forEach((r) => {
        const emp = empMap[r.employee_id];
        if (!emp) return;
        const jornadaMin = getJornadaMin(emp);
        if (jornadaMin === null) return;
        if (isFalta(r) || !r.saida) return;
        const s = calcSaldoMin(r, jornadaMin);
        if (s === null) return;
        const mk = r.date.slice(0, 7);
        byEmpMonth[r.employee_id] = byEmpMonth[r.employee_id] || {};
        byEmpMonth[r.employee_id][mk] = (byEmpMonth[r.employee_id][mk] || 0) + s;
    });

    (allAdj || []).forEach((a) => {
        const emp = empMap[a.employee_id];
        if (!emp) return;
        const mk = a.date.slice(0, 7);
        byEmpMonth[a.employee_id] = byEmpMonth[a.employee_id] || {};
        const delta = a.tipo === 'credito' ? a.minutos : -a.minutos;
        byEmpMonth[a.employee_id][mk] = (byEmpMonth[a.employee_id][mk] || 0) + delta;
    });

    const vencMeses = hrSettings.banco_horas_vencimento_meses || 6;
    const hoje = new Date();
    ledgerMap = {};

    Object.entries(byEmpMonth).forEach(([empId, months]) => {
        ledgerMap[empId] = CLTDomain.computeBankLedgerStatus(months, vencMeses, hoje);
    });
}

function nextMonthKey(monthKey) {
    return CLTDomain.nextMonthKey(monthKey);
}

async function loadAllData() {
    const monthStart = `${currentMonth}-01`;
    const monthEnd = nextMonthKey(currentMonth);

    const [{ data: empData }, { data: timeData }, { data: bankData }] = await Promise.all([
        sb.from('employees').select('*').in('status', ['Ativo', 'ativo']).order('name'),
        sb.from('time_records').select('*').gte('date', monthStart).lt('date', monthEnd),
        sb.from('bank_adjustments').select('*').is('deleted_at', null),
    ]);

    allEmps = (empData || []).map((e) => ({
        id: e.id,
        name: e.name,
        dept: e.dept,
        role: e.role,
        contractType: e.contract_type,
        email: e.email,
        admissionDate: e.admission_date,
        workLoad: e.work_load,
        managerId: e.manager_id,
    }));

    timeRecordsMap = {};
    (timeData || []).forEach((r) => {
        if (!timeRecordsMap[r.employee_id]) timeRecordsMap[r.employee_id] = {};
        timeRecordsMap[r.employee_id][r.date] = r;
    });

    bankAdjMap = {};
    (bankData || []).forEach((a) => {
        if (!bankAdjMap[a.employee_id]) bankAdjMap[a.employee_id] = [];
        bankAdjMap[a.employee_id].push(a);
    });
}

function getPontoRecords(empId) {
    return timeRecordsMap[empId] || {};
}
function getBancoAjustes(empId) {
    return (bankAdjMap[empId] || []).filter((a) => !a.deleted_at);
}

async function refresh() {
    await loadAllData();
    await loadBankLedger();
    allData = buildAllBalances(currentMonth);
    loadKPIs();
    renderTable();
    renderNotifPanel();
}

function getJornadaMin(emp) {
    return CLTDomain.resolveJornadaMin({ contractType: emp?.contractType, workLoad: emp?.workLoad });
}

function jornadaLabel(emp, jornadaMin) {
    if (jornadaMin === null) return 'PJ';
    if (emp?.workLoad === '12x36') return 'Escala 12x36';
    const h = Math.floor(jornadaMin / 60),
        m = jornadaMin % 60;
    return (m ? `${h}h${pad0(m)}min` : `${h}h`) + '/dia';
}

function isFalta(rec) {
    return CLTDomain.isFalta(rec);
}

function calcWorkedMin(rec) {
    return CLTDomain.calcWorkedMin(rec);
}

function calcSaldoMin(rec, jornadaMin) {
    return CLTDomain.calcSaldoMin(rec, jornadaMin);
}

function calcIntervaloDeficitMin(rec, jornadaMin) {
    return CLTDomain.calcIntervaloDeficitMin(rec, jornadaMin);
}

function minToStr(min) {
    const abs = Math.abs(min);
    return `${Math.floor(abs / 60)}h ${pad0(abs % 60)}min`;
}
function formatSaldo(min) {
    if (min === 0) return '0h 00min';
    return `${min > 0 ? '+' : '-'}${minToStr(min)}`;
}

function buildAllBalances(monthKey) {
    return allEmps.map((emp) => computeBalance(emp, monthKey));
}

function computeBalance(emp, monthKey) {
    const jornadaMin = getJornadaMin(emp);
    const records = getPontoRecords(emp.id);
    const ajustes = getBancoAjustes(emp.id);
    const isPJ = jornadaMin === null;
    const limiteExtra = hrSettings.limite_extra_diario_min || CLTDomain.LIMITE_EXTRA_DIARIO_MIN_PADRAO;
    let extrasMin = 0,
        faltaMin = 0,
        diasCompletos = 0,
        totalWorkedMin = 0,
        diasExcesso = 0,
        intervaloDeficitMin = 0,
        diasIntervaloIrregular = 0;
    Object.entries(records).forEach(([key, rec]) => {
        if (!key.startsWith(monthKey)) return;
        if (isFalta(rec) || !rec.saida) return;
        diasCompletos++;
        const worked = calcWorkedMin(rec);
        totalWorkedMin += worked;
        if (!isPJ) {
            const s = calcSaldoMin(rec, jornadaMin);
            if (s !== null) {
                if (s > 0) {
                    extrasMin += s;
                    if (s > limiteExtra) diasExcesso++;
                } else faltaMin += Math.abs(s);
            }
            const intervaloDeficit = calcIntervaloDeficitMin(rec, jornadaMin);
            if (intervaloDeficit > 0) {
                intervaloDeficitMin += intervaloDeficit;
                diasIntervaloIrregular++;
            }
        }
    });
    let ajusteMin = 0;
    ajustes
        .filter((a) => a.date && a.date.startsWith(monthKey))
        .forEach((a) => {
            ajusteMin += a.tipo === 'credito' ? a.minutos : -a.minutos;
        });
    const saldoLiquido = isPJ ? null : extrasMin - faltaMin + ajusteMin;
    const ledger = isPJ ? null : ledgerMap[emp.id] || { status: 'ok', minutosVencendo: 0, minutosVencidos: 0, proxExpira: null };
    return {
        emp,
        jornadaMin,
        isPJ,
        extrasMin,
        faltaMin,
        ajusteMin,
        saldoLiquido,
        diasCompletos,
        totalWorkedMin,
        diasExcesso,
        intervaloDeficitMin,
        diasIntervaloIrregular,
        ledger,
    };
}

function loadKPIs() {
    let totalExtras = 0,
        totalFaltas = 0,
        cntPos = 0,
        cntNeg = 0,
        cntCritico = 0,
        cntVencendo = 0,
        cntVencido = 0,
        cntExcesso = 0,
        cntIntervalo = 0;
    allData.forEach((d) => {
        if (d.isPJ) return;
        totalExtras += d.extrasMin;
        totalFaltas += d.faltaMin;
        if (d.saldoLiquido > 0) cntPos++;
        if (d.saldoLiquido < 0) cntNeg++;
        if (d.saldoLiquido !== null && d.saldoLiquido <= -1200) cntCritico++;
        if (d.ledger?.status === 'vencido') cntVencido++;
        else if (d.ledger?.status === 'atencao') cntVencendo++;
        if (d.diasExcesso > 0) cntExcesso++;
        if (d.diasIntervaloIrregular > 0) cntIntervalo++;
    });
    setText('kpi-total-extras', totalExtras ? minToStr(totalExtras) : '0h 00min');
    setText('kpi-total-faltas', totalFaltas ? minToStr(totalFaltas) : '0h 00min');
    setText('kpi-count-pos', cntPos);
    setText('kpi-count-neg', cntNeg);
    setText('kpi-count-critico', cntCritico);
    setText('kpi-count-vencendo', cntVencendo);
    setText('kpi-count-vencido', cntVencido);
    setText('kpi-count-excesso', cntExcesso);
    setText('kpi-count-intervalo', cntIntervalo);
}

function getFilteredData() {
    const q = currentSearch.toLowerCase();
    return allData.filter((d) => {
        if (q && !d.emp.name.toLowerCase().includes(q) && !(d.emp.dept || '').toLowerCase().includes(q)) return false;
        if (currentFilter === 'positivo') return !d.isPJ && d.saldoLiquido > 0;
        if (currentFilter === 'negativo') return !d.isPJ && d.saldoLiquido < 0;
        if (currentFilter === 'zerado') return d.isPJ || d.saldoLiquido === 0;
        if (currentFilter === 'critico') return !d.isPJ && d.saldoLiquido !== null && d.saldoLiquido <= -1200;
        if (currentFilter === 'vencendo') return !d.isPJ && d.ledger?.status === 'atencao';
        if (currentFilter === 'vencido') return !d.isPJ && d.ledger?.status === 'vencido';
        return true;
    });
}

function renderTable() {
    const tbody = $('banco-tbody');
    if (!tbody) return;
    const filtered = getFilteredData();
    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="table-empty"><i class="fas fa-clock-rotate-left"></i><p>Nenhum colaborador encontrado.</p></div></td></tr>`;
        setText('table-count', '');
        return;
    }
    tbody.innerHTML = filtered.map((d) => buildRow(d)).join('');
    const cnt = filtered.length;
    setText('table-count', `${cnt} colaborador${cnt !== 1 ? 'es' : ''} exibido${cnt !== 1 ? 's' : ''}`);
}

function setupExportButton() {
    const btn = $('btn-export'),
        menu = $('export-menu'),
        chevron = $('export-chevron');
    if (!btn || !menu) return;
    const close = () => {
        menu.classList.remove('open');
        chevron?.classList.remove('open');
    };
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const opening = !menu.classList.contains('open');
        menu.classList.toggle('open', opening);
        chevron?.classList.toggle('open', opening);
    });
    document.addEventListener('click', close);
    menu.addEventListener('click', (e) => e.stopPropagation());
    $('export-pdf-btn')?.addEventListener('click', () => {
        close();
        exportToPDF();
    });
    $('export-csv-btn')?.addEventListener('click', () => {
        close();
        exportToCSV();
    });
}

function complianceLabel(d) {
    if (d.isPJ) return '—';
    const parts = [];
    if (d.ledger?.status === 'vencido') parts.push('Vencido');
    else if (d.ledger?.status === 'atencao') parts.push('Vencendo');
    if (d.diasExcesso > 0) parts.push(`${d.diasExcesso}x 2h+`);
    if (d.diasIntervaloIrregular > 0) parts.push(`${d.diasIntervaloIrregular}x intervalo`);
    return parts.length ? parts.join(', ') : 'Em dia';
}

function exportToCSV() {
    const filtered = getFilteredData();
    const header = ['Colaborador', 'Departamento', 'Tipo', 'Jornada', 'Dias Registrados', 'Horas Extras', 'Horas em Falta', 'Saldo do Mês', 'Compliance'];
    const rows = filtered.map((d) => [
        d.emp.name,
        d.emp.dept || '',
        d.isPJ ? 'PJ' : (d.emp.contractType || 'CLT').toUpperCase(),
        jornadaLabel(d.emp, d.jornadaMin),
        d.diasCompletos,
        d.extrasMin ? minToStr(d.extrasMin) : '0h 00min',
        d.faltaMin ? minToStr(d.faltaMin) : '0h 00min',
        d.isPJ ? '—' : formatSaldo(d.saldoLiquido),
        complianceLabel(d),
    ]);
    const csvContent = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `banco-horas-${currentMonth}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Planilha CSV exportada.', 'success');
}

function exportToPDF() {
    if (typeof window.jspdf === 'undefined') {
        showToast('Biblioteca de PDF não carregada.', 'error');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = 297,
        pageH = 210,
        margin = 12;
    const date = new Date().toLocaleDateString('pt-BR');
    const cols = [
        { label: 'Colaborador', w: 60 },
        { label: 'Tipo', w: 20 },
        { label: 'Jornada', w: 28 },
        { label: 'Dias Reg.', w: 20 },
        { label: 'H. Extras', w: 26 },
        { label: 'H. em Falta', w: 26 },
        { label: 'Saldo do Mês', w: 28 },
        { label: 'Compliance', w: 60 },
    ];

    function drawHeader() {
        doc.setFillColor(13, 14, 18);
        doc.rect(0, 0, pageW, 20, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(255, 255, 255);
        doc.text('Nexus RH — Banco de Horas', margin, 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(203, 213, 225);
        doc.text(`${fmtMonthLabel(currentMonth)} · Gerado em ${date}`, pageW - margin, 12, { align: 'right' });
    }

    function drawTableHeader(y) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        let x = margin;
        cols.forEach((c) => {
            doc.text(c.label.toUpperCase(), x, y);
            x += c.w;
        });
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.2);
        doc.line(margin, y + 2, pageW - margin, y + 2);
        return y + 7;
    }

    drawHeader();
    let y = drawTableHeader(28);
    const filtered = getFilteredData();

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    filtered.forEach((d) => {
        if (y > pageH - 14) {
            doc.addPage();
            drawHeader();
            y = drawTableHeader(28);
        }
        let x = margin;
        const cells = [
            d.emp.name,
            d.isPJ ? 'PJ' : (d.emp.contractType || 'CLT').toUpperCase(),
            jornadaLabel(d.emp, d.jornadaMin),
            String(d.diasCompletos),
            d.extrasMin ? minToStr(d.extrasMin) : '0h 00min',
            d.faltaMin ? minToStr(d.faltaMin) : '0h 00min',
            d.isPJ ? '—' : formatSaldo(d.saldoLiquido),
            complianceLabel(d),
        ];
        cells.forEach((val, i) => {
            doc.text(String(val), x, y);
            x += cols[i].w;
        });
        y += 6;
    });

    if (!filtered.length) {
        doc.setFont('helvetica', 'italic');
        doc.setTextColor(148, 163, 184);
        doc.text('Nenhum colaborador encontrado para os filtros atuais.', margin, y);
    }

    doc.save(`banco-horas-${currentMonth}.pdf`);
    showToast('Relatório PDF exportado.', 'success');
}

function buildComplianceBadges(d) {
    if (d.isPJ) return `<span class="compliance-ok" title="Não se aplica (PJ)">—</span>`;
    const badges = [];
    if (d.ledger?.status === 'vencido')
        badges.push(
            `<span class="badge badge--vencido" title="Banco de horas vencido — vira passivo trabalhista"><i class="fas fa-hourglass-end"></i> Vencido</span>`
        );
    else if (d.ledger?.status === 'atencao')
        badges.push(`<span class="badge badge--vencendo" title="Banco de horas vencendo em até 30 dias"><i class="fas fa-hourglass-half"></i> Vencendo</span>`);
    if (d.diasExcesso > 0)
        badges.push(
            `<span class="badge badge--excesso" title="Dias com mais de 2h extras (limite do art. 59 da CLT)"><i class="fas fa-stopwatch"></i> ${d.diasExcesso}x 2h+</span>`
        );
    if (d.diasIntervaloIrregular > 0)
        badges.push(
            `<span class="badge badge--intervalo" title="Intervalo intrajornada não cumprido (art. 71 CLT) — ${minToStr(d.intervaloDeficitMin)} suprimidos, indenizáveis com adicional de 50%"><i class="fas fa-mug-saucer"></i> ${d.diasIntervaloIrregular}x intervalo</span>`
        );
    return badges.length ? badges.join('') : `<span class="compliance-ok" title="Sem pendências de compliance"><i class="fas fa-check"></i></span>`;
}

function buildRow(d) {
    const { emp, jornadaMin, isPJ, extrasMin, faltaMin, saldoLiquido, diasCompletos } = d;
    const jStr = jornadaLabel(emp, jornadaMin),
        ctStr = emp.contractType || 'CLT';
    let saldoHTML;
    if (isPJ) {
        saldoHTML = `<span class="saldo-cell zero">—</span>`;
    } else {
        const cls = saldoLiquido > 0 ? 'positivo' : saldoLiquido < 0 ? 'negativo' : 'zero';
        saldoHTML = `<span class="saldo-cell ${cls}">${formatSaldo(saldoLiquido)}</span>`;
    }
    const extrasCls = extrasMin > 0 ? 'extras' : 'zero',
        faltasCls = faltaMin > 0 ? 'faltas' : 'zero';
    return `<tr><td><div class="emp-cell"><div><p class="emp-name">${emp.name}</p><p class="emp-dept">${emp.dept || '—'}</p></div></div></td><td>${ctStr}</td><td>${jStr}</td><td>${diasCompletos}</td><td><span class="td-hours ${extrasCls}">${extrasMin ? '+' + minToStr(extrasMin) : '0h 00min'}</span></td><td><span class="td-hours ${faltasCls}">${faltaMin ? '-' + minToStr(faltaMin) : '0h 00min'}</span></td><td>${saldoHTML}</td><td><div class="compliance-cell">${buildComplianceBadges(d)}</div></td><td><div class="actions-cell"><button class="btn-icon btn-icon--view" onclick="openDetailModal('${emp.id}')" title="Ver detalhes"><i class="fas fa-eye"></i></button><button class="btn-icon btn-icon--adjust" onclick="openAdjustModal('${emp.id}')" title="Lançar ajuste">${isPJ ? '<i class="fas fa-pen-to-square" style="opacity:.35"></i>' : '<i class="fas fa-pen-to-square"></i>'}</button></div></td></tr>`;
}

const FILTER_LABELS_BH = {
    todos: 'Filtro',
    positivo: 'Saldo Positivo',
    negativo: 'Saldo Negativo',
    zerado: 'Zerado / PJ',
    critico: 'Crítico',
    vencendo: 'Banco Vencendo',
    vencido: 'Banco Vencido',
};

function updateFilterBtn() {
    const label = $('filter-label');
    const btn = $('btn-filter');
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
    const btn = $('btn-filter');
    const menu = $('filter-dropdown-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.contains('open') ? closeFilterDropdown() : openFilterDropdown();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', closeFilterDropdown);
}

window.setFilter = function (btn) {
    document.querySelectorAll('.filter-dropdown-chips .chip').forEach((c) => c.classList.remove('chip--active'));
    btn.classList.add('chip--active');
    currentFilter = btn.dataset.filter;
    updateFilterBtn();
    closeFilterDropdown();
    renderTable();
};
window.applyFilters = function () {
    const inp = $('search-input');
    currentSearch = inp ? inp.value.trim() : '';
    const clr = $('search-clear');
    if (clr) clr.classList.toggle('hidden', !currentSearch);
    renderTable();
};
window.clearSearch = function () {
    const inp = $('search-input');
    if (inp) inp.value = '';
    currentSearch = '';
    const clr = $('search-clear');
    if (clr) clr.classList.add('hidden');
    renderTable();
};

window.openDetailModal = function (empId) {
    const data = allData.find((d) => d.emp.id === empId);
    if (!data) return;
    detailEmpId = empId;
    detailMonth = currentMonth;
    renderDetailModal(data.emp, detailMonth);
    openModal('detail-modal');
};

window.closeDetailModal = function () {
    closeModal('detail-modal');
};

window.changeDetailMonth = async function (empId, monthKey) {
    detailMonth = monthKey;
    const emp = allEmps.find((e) => e.id === empId);
    if (!emp) return;
    const mStart = `${monthKey}-01`,
        mEnd = nextMonthKey(monthKey);
    const { data } = await sb.from('time_records').select('*').eq('employee_id', empId).gte('date', mStart).lt('date', mEnd);
    if (!timeRecordsMap[empId]) timeRecordsMap[empId] = {};
    (data || []).forEach((r) => {
        timeRecordsMap[empId][r.date] = r;
    });
    renderDetailModal(emp, monthKey);
};

function renderDetailModal(emp, monthKey) {
    const body = $('detail-body');
    if (!body) return;
    const jornadaMin = getJornadaMin(emp),
        isPJ = jornadaMin === null;
    const records = getPontoRecords(emp.id),
        ajustes = getBancoAjustes(emp.id);
    const monthRecs = Object.entries(records)
        .filter(([k]) => k.startsWith(monthKey))
        .sort(([a], [b]) => a.localeCompare(b));
    const monthAjustes = ajustes.filter((a) => a.date && a.date.startsWith(monthKey));
    let extrasMin = 0,
        faltaMin = 0,
        diasCompletos = 0,
        totalWorked = 0,
        intervaloDeficitMin = 0,
        diasIntervaloIrregular = 0;
    monthRecs.forEach(([, rec]) => {
        if (isFalta(rec) || !rec.saida) return;
        diasCompletos++;
        totalWorked += calcWorkedMin(rec);
        if (!isPJ) {
            const s = calcSaldoMin(rec, jornadaMin);
            if (s !== null) {
                if (s > 0) extrasMin += s;
                else faltaMin += Math.abs(s);
            }
            const dInt = calcIntervaloDeficitMin(rec, jornadaMin);
            if (dInt > 0) {
                intervaloDeficitMin += dInt;
                diasIntervaloIrregular++;
            }
        }
    });
    let ajusteMin = 0;
    monthAjustes.forEach((a) => {
        ajusteMin += a.tipo === 'credito' ? a.minutos : -a.minutos;
    });
    const saldoLiquido = isPJ ? null : extrasMin - faltaMin + ajusteMin;
    const saldoCls = saldoLiquido === null ? 'zero' : saldoLiquido > 0 ? 'positivo' : saldoLiquido < 0 ? 'negativo' : 'zero';
    const monthOptions = buildMonthOptions(monthKey);
    const ledger = ledgerMap[emp.id] || { status: 'ok', minutosVencendo: 0, minutosVencidos: 0, proxExpira: null };
    const vencMeses = hrSettings.banco_horas_vencimento_meses || 6;
    let ledgerHTML = '';
    if (!isPJ) {
        if (ledger.status === 'vencido') {
            ledgerHTML = `<div class="compliance-banner compliance-banner--vencido"><i class="fas fa-circle-exclamation"></i><div><strong>Banco de horas vencido.</strong> ${minToStr(ledger.minutosVencidos)} ultrapassaram o prazo de compensacao de ${vencMeses} meses (CLT art. 59 par.2) e devem ser quitadas em folha como passivo trabalhista.</div></div>`;
        } else if (ledger.status === 'atencao') {
            const dias = Math.max(0, Math.round((ledger.proxExpira - new Date()) / 86400000));
            ledgerHTML = `<div class="compliance-banner compliance-banner--atencao"><i class="fas fa-hourglass-half"></i><div><strong>${minToStr(ledger.minutosVencendo)} do banco vencem em ate ${dias} dia${dias !== 1 ? 's' : ''}.</strong> Programe a compensacao antes do prazo de ${vencMeses} meses.</div></div>`;
        }
        if (diasIntervaloIrregular > 0) {
            const indenizacaoMin = Math.round(intervaloDeficitMin * CLTDomain.INTERVALO_INDENIZACAO_MULTIPLICADOR);
            ledgerHTML += `<div class="compliance-banner compliance-banner--atencao"><i class="fas fa-mug-saucer"></i><div><strong>Intervalo intrajornada (art. 71 CLT) não cumprido em ${diasIntervaloIrregular} dia${diasIntervaloIrregular !== 1 ? 's' : ''} de ${fmtMonthLabel(monthKey)}.</strong> ${minToStr(intervaloDeficitMin)} suprimidos — cerca de ${minToStr(indenizacaoMin)} indenizáveis com o adicional de 50%, pagos à parte (não entram no banco de horas).</div></div>`;
        }
    }

    let html = `<div class="detail-emp-header"><div class="detail-emp-info"><p class="detail-emp-name">${emp.name}</p><p class="detail-emp-meta"><span><i class="fas fa-building" style="margin-right:3px;color:var(--accent)"></i>${emp.dept || '—'}</span><span><i class="fas fa-briefcase" style="margin-right:3px;color:var(--accent)"></i>${emp.role || '—'}</span><span><i class="fas fa-clock" style="margin-right:3px;color:var(--accent)"></i>${isPJ ? 'PJ — sem jornada fixa' : `Jornada ${jornadaLabel(emp, jornadaMin)}`}</span></p></div><select class="detail-month-select" onchange="changeDetailMonth('${emp.id}',this.value)">${monthOptions}</select></div>
    ${ledgerHTML}
    ${isPJ ? '' : '<div class="trend-section"><p class="detail-section-title"><i class="fas fa-chart-line"></i> Tendência do Saldo (6 meses)</p><div class="trend-chart-wrap"><canvas id="detail-trend-canvas"></canvas></div></div>'}
    <div class="detail-stats"><div class="stat-card-sm"><div class="stat-label-sm">Dias Registrados</div><div class="stat-value-sm">${diasCompletos}</div></div><div class="stat-card-sm"><div class="stat-label-sm">H. Trabalhadas</div><div class="stat-value-sm">${totalWorked ? minToStr(totalWorked) : '0h 00min'}</div></div><div class="stat-card-sm ${isPJ ? '' : extrasMin ? 'positivo' : ''}"><div class="stat-label-sm">H. Extras</div><div class="stat-value-sm">${isPJ ? '—' : extrasMin ? '+' + minToStr(extrasMin) : '0h 00min'}</div></div><div class="stat-card-sm ${saldoCls}"><div class="stat-label-sm">Saldo Líquido</div><div class="stat-value-sm">${saldoLiquido === null ? '—' : formatSaldo(saldoLiquido)}</div></div></div>
    <div><p class="detail-section-title"><i class="fas fa-calendar-days"></i> Registros de Ponto — ${fmtMonthLabel(monthKey)}</p>`;

    if (!monthRecs.length) {
        html += `<div class="empty-month-msg"><i class="fas fa-calendar-times"></i><p>Nenhum registro de ponto neste período.</p></div>`;
    } else {
        html += `<div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>Data</th><th>Entrada</th><th>Saída Alm.</th><th>Retorno</th><th>Saída</th><th>Trabalhado</th><th>Saldo</th><th>Status</th></tr></thead><tbody>${monthRecs.map(([key, rec]) => buildDayRow(key, rec, jornadaMin, isPJ, emp.id)).join('')}</tbody></table></div>`;
    }

    html += `</div><div class="ajustes-section"><div class="ajustes-header"><p class="detail-section-title" style="margin-bottom:0"><i class="fas fa-pen-to-square"></i> Ajustes Manuais — ${fmtMonthLabel(monthKey)}</p><button class="btn-add-ajuste" onclick="openAdjustModalFromDetail('${emp.id}')"><i class="fas fa-plus"></i> Novo Ajuste</button></div>`;
    if (!monthAjustes.length) {
        html += `<p class="no-ajustes">Nenhum ajuste manual para este período.</p>`;
    } else {
        html += monthAjustes
            .map(
                (a) =>
                    `<div class="ajuste-item"><span class="ajuste-tipo-badge ${a.tipo}"><i class="fas ${a.tipo === 'credito' ? 'fa-plus' : 'fa-minus'}"></i>${a.tipo === 'credito' ? 'Crédito' : 'Débito'}</span><div class="ajuste-info"><p class="ajuste-valor">${a.tipo === 'credito' ? '+' : '-'}${minToStr(a.minutos)}</p><p class="ajuste-just">${esc(a.justificativa)}</p><p class="ajuste-meta">${a.date} &bull; por ${esc(a.created_by_name) || 'RH'} &bull; ${new Date(a.created_at).toLocaleDateString('pt-BR')}</p></div><button class="btn-delete-ajuste" onclick="deleteAjuste('${emp.id}','${a.id}')" title="Excluir ajuste"><i class="fas fa-trash"></i></button></div>`
            )
            .join('');
    }
    html += `</div>`;
    body.innerHTML = html;
    if (!isPJ) renderSaldoTrendChart(emp);
}

let detailTrendChart = null;

async function renderSaldoTrendChart(emp) {
    const canvas = $('detail-trend-canvas');
    if (!canvas || typeof Chart === 'undefined') return;
    const jornadaMin = getJornadaMin(emp);
    const monthsBack = 6;
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
    const startStr = `${startMonth.getFullYear()}-${pad0(startMonth.getMonth() + 1)}-01`;

    const monthly = {};
    for (let i = 0; i < monthsBack; i++) {
        const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
        monthly[`${d.getFullYear()}-${pad0(d.getMonth() + 1)}`] = 0;
    }

    if (jornadaMin !== null) {
        const [{ data: recs }, { data: adjs }] = await Promise.all([
            sb.from('time_records').select('date,entrada,saida_almoco,retorno_almoco,saida').eq('employee_id', emp.id).gte('date', startStr),
            sb.from('bank_adjustments').select('tipo,minutos,date').eq('employee_id', emp.id).gte('date', startStr).is('deleted_at', null),
        ]);
        (recs || []).forEach((r) => {
            if (isFalta(r) || !r.saida) return;
            const s = calcSaldoMin(r, jornadaMin);
            if (s === null) return;
            const mk = r.date.slice(0, 7);
            if (mk in monthly) monthly[mk] += s;
        });
        (adjs || []).forEach((a) => {
            const mk = a.date.slice(0, 7);
            if (!(mk in monthly)) return;
            monthly[mk] += a.tipo === 'credito' ? a.minutos : -a.minutos;
        });
    }

    const keys = Object.keys(monthly).sort();
    const labels = keys.map((k) => {
        const [y, m] = k.split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    });
    const values = keys.map((k) => +(monthly[k] / 60).toFixed(1));

    if (detailTrendChart) {
        detailTrendChart.destroy();
        detailTrendChart = null;
    }
    detailTrendChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Saldo do mês (h)',
                    data: values,
                    borderColor: '#6366f1',
                    borderWidth: 2.5,
                    backgroundColor: (ctx) => {
                        const { chartArea } = ctx.chart;
                        if (!chartArea) return 'rgba(99,102,241,.12)';
                        const g = ctx.chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        g.addColorStop(0, 'rgba(99,102,241,.28)');
                        g.addColorStop(1, 'rgba(99,102,241,0)');
                        return g;
                    },
                    fill: true,
                    tension: 0.35,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    pointBackgroundColor: values.map((v) => (v > 0 ? '#16a34a' : v < 0 ? '#dc2626' : '#94a3b8')),
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y > 0 ? '+' : ''}${ctx.parsed.y}h` } } },
            scales: {
                y: { ticks: { callback: (v) => `${v}h` }, grid: { color: 'rgba(0,0,0,.05)' } },
                x: { grid: { display: false } },
            },
        },
    });
}

function buildDayRow(key, rec, jornadaMin, isPJ, empId) {
    const [y, m, d] = key.split('-');
    const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const diaSem = dias[new Date(`${key}T12:00:00`).getDay()];
    const t = (field) => {
        const v = rec[field];
        if (!v) return `<span class="dt-time missing">—</span>`;
        const dt = new Date(v);
        const selfiePath = rec[field + '_selfie_path'];
        const selfieBtn = selfiePath
            ? `<button type="button" class="btn-selfie-view" onclick="viewPontoSelfie('${selfiePath}')" title="Ver selfie do registro"><i class="fas fa-camera"></i></button>`
            : '';
        return `<span class="dt-time${rec[field + '_ajustado'] ? ' ajustado' : ''}">${pad0(dt.getHours())}:${pad0(dt.getMinutes())}${selfieBtn}</span>`;
    };
    const holiday = holidaysMap[key];
    const ferias = isOnVacation(empId, key);
    if (isFalta(rec)) {
        let badge;
        if (ferias) badge = `<span class="badge-sm badge-sm-ferias">Férias</span>`;
        else if (holiday) badge = `<span class="badge-sm badge-sm-feriado" title="${holiday.name}">Feriado</span>`;
        else badge = `<span class="badge-sm badge-sm-falta">Falta</span>`;
        return `<tr><td class="dt-date">${d}/${m}/${y}<span class="dt-diaSem">${diaSem}</span></td><td colspan="4" style="color:var(--text-tertiary);font-style:italic;font-size:.8rem">Sem registros</td><td>—</td><td class="dt-saldo zero">—</td><td>${badge}</td></tr>`;
    }
    const worked = calcWorkedMin(rec),
        workedStr = rec.saida ? minToStr(worked) : '—';
    let saldoStr = '—',
        saldoCls = 'zero',
        badgeHTML = '';
    const extraTags = [];
    if (holiday)
        extraTags.push(
            `<span class="badge-sm badge-sm-feriado" title="${holiday.name} — adicional de 100% calculado no holerite do mês (Súmula 146 TST)">Feriado</span>`
        );
    else if (isSunday(key))
        extraTags.push(
            `<span class="badge-sm badge-sm-domingo" title="Trabalho em domingo — adicional de 100% calculado no holerite do mês (Súmula 146 TST)">Domingo</span>`
        );
    if (isNoturno(rec))
        extraTags.push(
            `<span class="badge-sm badge-sm-noturno" title="Horário noturno (22h-5h) — adicional de 20% calculado no holerite do mês (CLT art. 73)">Noturno</span>`
        );
    if (!isPJ) {
        const intervaloDeficit = calcIntervaloDeficitMin(rec, jornadaMin);
        if (intervaloDeficit > 0)
            extraTags.push(
                `<span class="badge-sm badge-sm-intervalo" title="Intervalo do art. 71 da CLT não cumprido — ${minToStr(intervaloDeficit)} devidos com adicional de 50%, pagos à parte">Intervalo -${minToStr(intervaloDeficit)}</span>`
            );
    }
    if (!rec.saida) {
        badgeHTML = `<span class="badge-sm badge-sm-incompleto">Incompleto</span>`;
    } else if (isPJ) {
        saldoStr = minToStr(worked);
        badgeHTML = `<span class="badge-sm badge-sm-pj">PJ</span>`;
    } else {
        const saldo = calcSaldoMin(rec, jornadaMin);
        if (saldo !== null) {
            saldoStr = (saldo >= 0 ? '+' : '-') + minToStr(saldo);
            saldoCls = saldo > 0 ? 'positivo' : saldo < 0 ? 'negativo' : 'zero';
        }
        const limiteExtra = hrSettings.limite_extra_diario_min || CLTDomain.LIMITE_EXTRA_DIARIO_MIN_PADRAO;
        if (rec.ajustado) badgeHTML = `<span class="badge-sm badge-sm-incompleto">Ajustado</span>`;
        else if (saldo > limiteExtra)
            badgeHTML = `<span class="badge-sm badge-sm-excesso" title="Excede o limite legal de 2h de horas extras diárias (art. 59 CLT)">Excesso 2h+</span>`;
        else if (saldo > 0) badgeHTML = `<span class="badge-sm badge-sm-extra">Extra</span>`;
        else if (saldo < 0) badgeHTML = `<span class="badge-sm badge-sm-falta">Falta</span>`;
        else badgeHTML = `<span class="badge-sm badge-sm-normal">Normal</span>`;
    }
    return `<tr><td class="dt-date">${d}/${m}/${y}<span class="dt-diaSem">${diaSem}</span></td><td>${t('entrada')}</td><td>${t('saida_almoco')}</td><td>${t('retorno_almoco')}</td><td>${t('saida')}</td><td>${workedStr}</td><td class="dt-saldo ${saldoCls}">${saldoStr}</td><td>${badgeHTML}${extraTags.join('')}</td></tr>`;
}

function buildMonthOptions(selected) {
    const now = new Date(),
        opts = [];
    for (let i = -11; i <= 1; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const val = `${d.getFullYear()}-${pad0(d.getMonth() + 1)}`;
        const lbl = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        opts.push(`<option value="${val}"${val === selected ? ' selected' : ''}>${lbl.charAt(0).toUpperCase() + lbl.slice(1)}</option>`);
    }
    return opts.join('');
}

window.openAdjustModal = function (empId) {
    const data = allData.find((d) => d.emp.id === empId);
    if (!data) return;
    adjustingEmpId = empId;
    const sub = $('adjust-sub');
    if (sub) sub.textContent = data.emp.name;
    ['adjust-horas', 'adjust-min', 'adjust-just'].forEach((id) => {
        const el = $(id);
        if (el) el.value = '';
    });
    window.setAdjustDate?.(isoDate(new Date()));
    const al = $('adjust-alert');
    if (al) {
        al.className = 'modal-alert';
        al.textContent = '';
    }
    openModal('adjust-modal');
};

window.openAdjustModalFromDetail = function (empId) {
    closeModal('detail-modal');
    setTimeout(() => window.openAdjustModal(empId), 120);
};
window.closeAdjustModal = function () {
    closeModal('adjust-modal');
};

window.submitAdjust = async function () {
    const tipo = $('adjust-tipo')?.value || 'credito';
    const horas = parseInt($('adjust-horas')?.value || '0', 10);
    const mins = parseInt($('adjust-min')?.value || '0', 10);
    const data = $('adjust-data')?.value || '';
    const just = $('adjust-just')?.value?.trim() || '';
    const al = $('adjust-alert');
    const showErr = (msg) => {
        if (al) {
            al.className = 'modal-alert error';
            al.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${msg}`;
        }
    };
    const total = horas * 60 + mins;
    if (!data) return showErr('Informe a data de referência.');
    if (total <= 0) return showErr('Informe um valor de horas/minutos maior que zero.');
    if (!just) return showErr('A justificativa é obrigatória.');

    if (tipo === 'credito') {
        const limiteExtra = hrSettings.limite_extra_diario_min || CLTDomain.LIMITE_EXTRA_DIARIO_MIN_PADRAO;
        const { data: dayCredits } = await sb
            .from('bank_adjustments')
            .select('minutos')
            .eq('employee_id', adjustingEmpId)
            .eq('date', data)
            .eq('tipo', 'credito')
            .is('deleted_at', null);
        const existingMin = (dayCredits || []).reduce((s, a) => s + (a.minutos || 0), 0);
        if (existingMin + total > limiteExtra) {
            return showErr(
                `Limite legal de horas extras diárias excedido. Já lançado nesse dia: ${minToStr(existingMin)} + ${minToStr(total)} solicitado(s) > limite de ${minToStr(limiteExtra)}/dia.`
            );
        }
    }

    const empData = allData.find((d) => d.emp.id === adjustingEmpId);
    if (!empData) return;
    const requiresApprovalFrom = empData.emp.managerId ? 'gestor' : 'rh';

    const { error } = await sb.from('bank_requests').insert({
        employee_id: adjustingEmpId,
        origem: 'rh',
        tipo,
        minutos: total,
        date: data,
        justificativa: just,
        requires_approval_from: requiresApprovalFrom,
        manager_id_snapshot: empData.emp.managerId || null,
        created_by_name: rhUser?.email?.split('@')[0] || 'RH',
        created_by_email: rhUser?.email,
    });

    if (error) {
        showErr('Erro ao enviar ajuste para aprovação.');
        return;
    }

    closeModal('adjust-modal');
    const aprovadorMsg =
        requiresApprovalFrom === 'gestor' ? 'aguardando aprovação do gestor responsável' : 'aguardando confirmação de um segundo Administrador';
    showToast(`Ajuste de ${tipo === 'credito' ? '+' : '-'}${minToStr(total)} enviado para ${empData.emp.name} — ${aprovadorMsg}.`, 'success');
    await loadBankRequests();
    renderRequestsTab();
    updatePendingBadge();
};

async function loadBankRequests() {
    const { data } = await sb.from('bank_requests').select('*, employees!bank_requests_employee_id_fkey(name,dept)').order('created_at', { ascending: false });
    bankRequestsAll = data || [];
}

function updatePendingBadge() {
    const cnt = bankRequestsAll.filter((r) => r.status === 'pendente').length;
    const badge = $('tab-badge-solicitacoes');
    if (badge) {
        badge.textContent = cnt;
        badge.classList.toggle('hidden', cnt === 0);
    }
    renderNotifPanel();
}

function setupNotifPanel() {
    const btn = $('btn-notif'),
        panel = $('notif-panel'),
        wrapper = $('notif-wrapper');
    btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        panel?.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (wrapper && !wrapper.contains(e.target)) panel?.classList.add('hidden');
    });
}

function renderNotifPanel() {
    const badge = $('notif-badge'),
        body = $('notif-panel-body');
    if (!badge || !body) return;
    const criticos = allData.filter((d) => !d.isPJ && d.saldoLiquido !== null && d.saldoLiquido <= -1200);
    const vencidos = allData.filter((d) => !d.isPJ && d.ledger?.status === 'vencido');
    const pendentes = bankRequestsAll.filter((r) => r.status === 'pendente');

    const rows = [];
    if (criticos.length)
        rows.push(
            `<div class="notif-item" onclick="goToCriticos()"><div class="notif-item-icon notif-item-icon--vencido"><i class="fas fa-triangle-exclamation"></i></div><div class="notif-item-body"><span class="notif-item-title">${criticos.length} colaborador${criticos.length > 1 ? 'es' : ''} em saldo crítico</span><span class="notif-item-sub">Mais de 20h negativas no banco de horas</span></div></div>`
        );
    if (vencidos.length)
        rows.push(
            `<div class="notif-item" onclick="goToVencidos()"><div class="notif-item-icon notif-item-icon--vencido"><i class="fas fa-hourglass-end"></i></div><div class="notif-item-body"><span class="notif-item-title">${vencidos.length} colaborador${vencidos.length > 1 ? 'es' : ''} com banco de horas vencido</span><span class="notif-item-sub">Prazo de compensação expirado</span></div></div>`
        );
    if (pendentes.length)
        rows.push(
            `<div class="notif-item" onclick="goToSolicitacoes()"><div class="notif-item-icon notif-item-icon--checklist"><i class="fas fa-inbox"></i></div><div class="notif-item-body"><span class="notif-item-title">${pendentes.length} solicitação${pendentes.length > 1 ? 'ões' : ''} de banco de horas pendente${pendentes.length > 1 ? 's' : ''}</span><span class="notif-item-sub">Aguardando decisão</span></div></div>`
        );

    const total = criticos.length + vencidos.length + pendentes.length;
    badge.textContent = total;
    badge.classList.toggle('hidden', total === 0);
    body.innerHTML = rows.length ? rows.join('') : `<div class="notif-empty"><i class="fas fa-circle-check"></i><p>Tudo em dia por aqui.</p></div>`;
}

window.goToCriticos = function () {
    $('notif-panel')?.classList.add('hidden');
    document.querySelector('.tab-btn[data-tab="banco"]')?.click();
    const chip = document.querySelector('.filter-dropdown-chips .chip[data-filter="critico"]');
    if (chip) window.setFilter(chip);
};
window.goToVencidos = function () {
    $('notif-panel')?.classList.add('hidden');
    document.querySelector('.tab-btn[data-tab="banco"]')?.click();
    const chip = document.querySelector('.filter-dropdown-chips .chip[data-filter="vencido"]');
    if (chip) window.setFilter(chip);
};
window.goToSolicitacoes = function () {
    $('notif-panel')?.classList.add('hidden');
    document.querySelector('.tab-btn[data-tab="solicitacoes"]')?.click();
    const chip = document.querySelector('#tab-solicitacoes .chip[data-req-filter="pendente"]');
    if (chip) window.setReqFilter(chip);
};

window.setReqFilter = function (btn) {
    document.querySelectorAll('#tab-solicitacoes .chip').forEach((c) => c.classList.remove('chip--active'));
    btn.classList.add('chip--active');
    reqFilter = btn.dataset.reqFilter;
    renderRequestsTab();
};

const REQ_STATUS_META = {
    pendente: { cls: 'badge--vencendo', label: 'Pendente', icon: 'fa-hourglass-half' },
    aprovado: { cls: 'badge--positivo', label: 'Aprovado', icon: 'fa-check' },
    rejeitado: { cls: 'badge--negativo', label: 'Rejeitado', icon: 'fa-xmark' },
};

function renderRequestsTab() {
    const tbody = $('requests-tbody');
    if (!tbody) return;
    const filtered = reqFilter === 'todos' ? bankRequestsAll : bankRequestsAll.filter((r) => r.status === reqFilter);
    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="table-empty"><i class="fas fa-inbox"></i><p>Nenhuma solicitação encontrada.</p></div></td></tr>`;
        setText('requests-count', '');
        return;
    }
    tbody.innerHTML = filtered.map(buildRequestRow).join('');
    const cnt = filtered.length;
    setText('requests-count', `${cnt} solicitação${cnt !== 1 ? 'ões' : ''} exibida${cnt !== 1 ? 's' : ''}`);
}

function buildRequestRow(r) {
    const empName = r.employees?.name || '—',
        empDept = r.employees?.dept || '—';
    const origemBadge =
        r.origem === 'rh' ? `<span class="audit-badge audit-badge--rh">RH</span>` : `<span class="audit-badge audit-badge--colab">Colaborador</span>`;
    const tipoLabel = r.tipo === 'credito' ? 'Crédito' : 'Débito';
    const valor = `<span class="td-hours ${r.tipo === 'credito' ? 'extras' : 'faltas'}">${r.tipo === 'credito' ? '+' : '-'}${minToStr(r.minutos)}</span>`;
    const aprovador = r.requires_approval_from === 'gestor' ? '<i class="fas fa-user-tie"></i> Gestor' : '<i class="fas fa-user-shield"></i> RH (2ª aprovação)';
    const statusMeta = REQ_STATUS_META[r.status] || REQ_STATUS_META.pendente;
    const statusBadge = `<span class="badge ${statusMeta.cls}" title="${r.decision_obs ? r.decision_obs.replace(/"/g, '&quot;') : ''}"><i class="fas ${statusMeta.icon}"></i> ${statusMeta.label}</span>`;
    const anexoBtn = r.anexo_path
        ? `<button class="btn-icon btn-icon--view" onclick="viewRequestAnexo('${r.id}')" title="Ver anexo"><i class="fas fa-paperclip"></i></button>`
        : '';
    let actions = anexoBtn;
    if (r.status === 'pendente') {
        actions += `<button class="btn-icon btn-icon--adjust" onclick="approveRequest('${r.id}')" title="Aprovar"><i class="fas fa-check"></i></button><button class="btn-icon btn-icon--delete" onclick="openRejectRequestModal('${r.id}')" title="Rejeitar"><i class="fas fa-xmark"></i></button>`;
    }
    return `<tr data-id="${r.id}"><td><div class="emp-cell"><div><p class="emp-name">${empName}</p><p class="emp-dept">${empDept}</p></div></div></td><td>${origemBadge}</td><td>${tipoLabel}</td><td>${valor}</td><td>${fmtDate(r.date)}</td><td>${aprovador}</td><td>${statusBadge}</td><td><div class="actions-cell">${actions}</div></td></tr>`;
}

window.viewPontoSelfie = async function (path) {
    const { data, error } = await sb.storage.from('ponto-selfies').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) {
        showToast('Não foi possível abrir a selfie.', 'error');
        return;
    }
    window.open(data.signedUrl, '_blank');
    const empId = path.split('/')[0];
    if (empId) NexusAuth.logAccess(empId, 'selfie_ponto', path);
};

window.viewRequestAnexo = async function (id) {
    const r = bankRequestsAll.find((x) => x.id === id);
    if (!r?.anexo_path) return;
    const { data, error } = await sb.storage.from('documents').createSignedUrl(r.anexo_path, 3600);
    if (error || !data?.signedUrl) {
        showToast('Não foi possível abrir o anexo.', 'error');
        return;
    }
    window.open(data.signedUrl, '_blank');
};

window.approveRequest = async function (id) {
    const { error } = await sb.rpc('approve_bank_request', {
        p_request_id: id,
        p_decision: 'aprovado',
        p_decided_by_name: rhUser?.email?.split('@')[0] || 'RH',
        p_decided_by_email: rhUser?.email,
    });
    if (error) {
        showToast(error.message || 'Erro ao aprovar solicitação.', 'error');
        return;
    }
    showToast('Solicitação aprovada.', 'success');
    await refresh();
    await loadBankRequests();
    renderRequestsTab();
    updatePendingBadge();
};

window.openRejectRequestModal = function (id) {
    rejectingRequestId = id;
    const r = bankRequestsAll.find((x) => x.id === id);
    const sub = $('reject-request-sub');
    if (sub) sub.textContent = r?.employees?.name || '';
    const obs = $('reject-request-obs');
    if (obs) obs.value = '';
    const al = $('reject-request-alert');
    if (al) {
        al.className = 'modal-alert';
        al.textContent = '';
    }
    openModal('reject-request-modal');
};

window.confirmRejectRequest = async function () {
    const obs = $('reject-request-obs')?.value.trim() || '';
    const al = $('reject-request-alert');
    if (!obs) {
        if (al) {
            al.className = 'modal-alert error';
            al.innerHTML = `<i class="fas fa-exclamation-circle"></i> Informe o motivo da rejeição.`;
        }
        return;
    }
    const { error } = await sb.rpc('approve_bank_request', {
        p_request_id: rejectingRequestId,
        p_decision: 'rejeitado',
        p_obs: obs,
        p_decided_by_name: rhUser?.email?.split('@')[0] || 'RH',
        p_decided_by_email: rhUser?.email,
    });
    if (error) {
        if (al) {
            al.className = 'modal-alert error';
            al.textContent = error.message || 'Erro ao rejeitar solicitação.';
        }
        return;
    }
    closeModal('reject-request-modal');
    showToast('Solicitação rejeitada.', 'info');
    await loadBankRequests();
    renderRequestsTab();
    updatePendingBadge();
};

window.deleteAjuste = async function (empId, adjId) {
    await sb.from('bank_adjustments').update({ deleted_at: new Date().toISOString() }).eq('id', adjId);
    await sb.from('activity_logs').insert({
        employee_id: empId,
        tipo: 'ajuste_banco',
        acao: 'exclusao',
        date: isoDate(new Date()),
        operator_email: rhUser?.email,
        operator_name: rhUser?.email?.split('@')[0] || 'RH',
        operator_profile: 'Administrador',
        justificativa: `Exclusão do ajuste #${adjId}`,
    });
    if (bankAdjMap[empId]) bankAdjMap[empId] = bankAdjMap[empId].filter((a) => a.id !== adjId);
    showToast('Ajuste removido.', 'info');
    await refresh();
    if (detailEmpId) {
        const emp = allEmps.find((e) => e.id === detailEmpId);
        if (emp) renderDetailModal(emp, detailMonth);
    }
};

const HOLIDAY_ABR_LABEL = { nacional: 'Nacional', estadual: 'Estadual', municipal: 'Municipal', facultativo: 'Facultativo' };

window.openHolidaysModal = function () {
    const dt = $('holiday-date');
    if (dt) dt.value = '';
    const nm = $('holiday-name');
    if (nm) nm.value = '';
    renderHolidaysList();
    openModal('holidays-modal');
};

function renderHolidaysList() {
    const wrap = $('holidays-list');
    if (!wrap) return;
    const list = Object.entries(holidaysMap).sort(([a], [b]) => a.localeCompare(b));
    if (!list.length) {
        wrap.innerHTML = `<p class="no-ajustes">Nenhum feriado cadastrado.</p>`;
        return;
    }
    wrap.innerHTML = list
        .map(
            ([date, h]) =>
                `<div class="ajuste-item"><span class="ajuste-tipo-badge credito">${HOLIDAY_ABR_LABEL[h.abrangencia] || h.abrangencia}</span><div class="ajuste-info"><p class="ajuste-valor" style="font-size:13px">${fmtDate(date)}</p><p class="ajuste-just">${h.name}</p></div><button class="btn-delete-ajuste" onclick="deleteHoliday('${h.id}')" title="Excluir"><i class="fas fa-trash"></i></button></div>`
        )
        .join('');
}

window.submitHoliday = async function () {
    const date = $('holiday-date')?.value || '';
    const abrangencia = $('holiday-abrangencia')?.value || 'nacional';
    const name = $('holiday-name')?.value?.trim() || '';
    if (!date || !name) {
        showToast('Informe a data e o nome do feriado.', 'error');
        return;
    }

    const { data, error } = await sb.from('holidays').insert({ date, name, abrangencia }).select().single();
    if (error) {
        showToast(error.code === '23505' ? 'Já existe um feriado cadastrado nesta data.' : 'Erro ao salvar feriado.', 'error');
        return;
    }

    holidaysMap[date] = data;
    renderHolidaysList();
    $('holiday-date').value = '';
    $('holiday-name').value = '';
    showToast('Feriado adicionado.', 'success');
    allData = buildAllBalances(currentMonth);
    renderTable();
    if (detailEmpId) {
        const emp = allEmps.find((e) => e.id === detailEmpId);
        if (emp) renderDetailModal(emp, detailMonth);
    }
};

window.deleteHoliday = async function (id) {
    const entry = Object.values(holidaysMap).find((h) => h.id === id);
    await sb.from('holidays').delete().eq('id', id);
    if (entry) delete holidaysMap[entry.date];
    renderHolidaysList();
    showToast('Feriado removido.', 'info');
    allData = buildAllBalances(currentMonth);
    renderTable();
    if (detailEmpId) {
        const emp = allEmps.find((e) => e.id === detailEmpId);
        if (emp) renderDetailModal(emp, detailMonth);
    }
};

window.openSettingsModal = function () {
    const v = $('settings-vencimento');
    if (v) v.value = hrSettings.banco_horas_vencimento_meses || 6;
    const l = $('settings-limite-extra');
    if (l) l.value = hrSettings.limite_extra_diario_min || CLTDomain.LIMITE_EXTRA_DIARIO_MIN_PADRAO;
    const al = $('settings-alert');
    if (al) {
        al.className = 'modal-alert';
        al.textContent = '';
    }
    openModal('settings-modal');
};

window.submitSettings = async function () {
    const vencimento = parseInt($('settings-vencimento')?.value || '0', 10);
    const limite = parseInt($('settings-limite-extra')?.value || '-1', 10);
    const al = $('settings-alert');
    const showErr = (msg) => {
        if (al) {
            al.className = 'modal-alert error';
            al.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${msg}`;
        }
    };
    if (!vencimento || vencimento < 1) return showErr('Informe um prazo de vencimento válido (em meses).');
    if (limite < 0) return showErr('Informe um limite diário de horas extras válido (em minutos).');

    const { error } = await sb
        .from('hr_settings')
        .update({
            banco_horas_vencimento_meses: vencimento,
            limite_extra_diario_min: limite,
            updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
    if (error) return showErr('Erro ao salvar configurações.');

    hrSettings = { banco_horas_vencimento_meses: vencimento, limite_extra_diario_min: limite };
    closeModal('settings-modal');
    showToast('Configurações de compliance atualizadas.', 'success');
    await loadBankLedger();
    allData = buildAllBalances(currentMonth);
    loadKPIs();
    renderTable();
    if (detailEmpId) {
        const emp = allEmps.find((e) => e.id === detailEmpId);
        if (emp) renderDetailModal(emp, detailMonth);
    }
};

async function initAuditTab() {
    const sel = $('audit-emp-select');
    if (sel) {
        allEmps.forEach((emp) => {
            const opt = document.createElement('option');
            opt.value = emp.id;
            opt.textContent = emp.name;
            sel.appendChild(opt);
        });
    }
    const am = $('audit-month');
    if (am) am.value = currentMonth;
    await renderAuditTable();
}

window.toggleStatsRow = function () {
    const row = $('stats-row'),
        chevron = $('stats-row-chevron'),
        btn = $('stats-row-toggle');
    const nowHidden = row.classList.toggle('hidden');
    chevron?.classList.toggle('rotated', !nowHidden);
    const label = nowHidden ? 'Ver indicadores' : 'Ocultar indicadores';
    btn?.setAttribute('aria-label', label);
    btn?.setAttribute('title', label);
};

window.switchTab = function (btn, name) {
    document.querySelectorAll('.tabs-bar .tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${name}`)?.classList.add('active');
    if (name === 'auditoria') renderAuditTable();
    if (name === 'solicitacoes') renderRequestsTab();
};

window.setAuditTipo = function (btn) {
    document.querySelectorAll('[data-audit-tipo]').forEach((b) => b.classList.remove('chip--active'));
    btn.classList.add('chip--active');
    auditTipoFilter = btn.dataset.auditTipo;
    renderAuditTable();
};

window.renderAuditTable = async function () {
    const tbody = $('audit-tbody');
    if (!tbody) return;
    const empFilter = $('audit-emp-select')?.value || 'all';
    const month = $('audit-month')?.value || '';

    let query = sb.from('activity_logs').select('*, employees(name, dept)').order('created_at', { ascending: false });
    if (empFilter !== 'all') query = query.eq('employee_id', empFilter);
    if (month) query = query.gte('date', `${month}-01`).lt('date', nextMonthKey(month));
    if (auditTipoFilter !== 'todos') query = query.eq('tipo', auditTipoFilter);

    const { data: entries } = await query;
    const all = entries || [];

    if (!all.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="table-empty"><i class="fas fa-scroll"></i><p>Nenhum registro de auditoria encontrado.</p></div></td></tr>`;
        setText('audit-count', '');
        return;
    }

    tbody.innerHTML = all.map((e) => buildAuditRow(e)).join('');
    const cnt = all.length;
    setText('audit-count', `${cnt} registro${cnt !== 1 ? 's' : ''} encontrado${cnt !== 1 ? 's' : ''}`);
};

async function renderAuditTable() {
    await window.renderAuditTable();
}

function buildAuditRow(e) {
    const ACAO_LABEL = {
        entrada: 'Entrada',
        saida_almoco: 'Saída p/ Almoço',
        retorno_almoco: 'Retorno Almoço',
        saida: 'Saída',
        credito: 'Crédito',
        debito: 'Débito',
        exclusao: 'Exclusão de Ajuste',
    };
    const empName = e.employees?.name || e.operator_name || '—',
        empDept = e.employees?.dept || '—';
    const ts = new Date(e.created_at),
        tsStr = `${pad0(ts.getDate())}/${pad0(ts.getMonth() + 1)}/${ts.getFullYear()} ${pad0(ts.getHours())}:${pad0(ts.getMinutes())}`;
    const acaoLabel = ACAO_LABEL[e.acao] || e.acao || '—';
    let valorHTML = '—';
    if (e.tipo === 'ponto' && e.valor_registrado) {
        const dt = new Date(e.valor_registrado);
        valorHTML = `<span style="font-weight:600">${pad0(dt.getHours())}:${pad0(dt.getMinutes())}</span>`;
    } else if (e.tipo === 'ajuste_banco' && e.minutos) {
        const sign = e.acao === 'credito' ? '+' : '-';
        const cls = e.acao === 'credito' ? 'color:#16a34a' : 'color:#dc2626';
        valorHTML = `<span style="font-weight:700;${cls}">${sign}${minToStr(e.minutos)}</span>`;
    }
    const tipoBadge =
        e.tipo === 'ponto' ? `<span class="audit-badge audit-badge--ponto">Ponto</span>` : `<span class="audit-badge audit-badge--banco">Banco</span>`;
    const perfilBadge =
        e.operator_profile === 'Administrador'
            ? `<span class="audit-badge audit-badge--rh">RH</span>`
            : `<span class="audit-badge audit-badge--colab">Colaborador</span>`;
    return `<tr><td style="white-space:nowrap;font-size:12.5px">${tsStr}</td><td><div class="emp-cell"><div><p class="emp-name" style="font-size:12.5px">${esc(empName)}</p><p class="emp-dept">${esc(empDept)}</p></div></div></td><td>${tipoBadge}</td><td style="font-size:13px;font-weight:500">${acaoLabel}</td><td>${valorHTML}</td><td style="font-size:12.5px">${esc(e.operator_name || e.operator_email) || '—'} ${perfilBadge}</td><td style="font-size:12px;color:var(--text-secondary);max-width:180px">${esc(e.justificativa) || '—'}</td></tr>`;
}

function setupRealtimeSync() {
    sb.channel('banco-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'time_records' }, async () => {
            await refresh();
            if (document.getElementById('tab-auditoria')?.classList.contains('active')) await renderAuditTable();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_adjustments' }, async () => {
            await refresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, async () => {
            await refresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'holidays' }, async () => {
            await loadStaticComplianceData();
            await refresh();
            if ($('holidays-modal')?.classList.contains('open')) renderHolidaysList();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vacations' }, async () => {
            await loadStaticComplianceData();
            await refresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hr_settings' }, async () => {
            await loadStaticComplianceData();
            await refresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bank_requests' }, async () => {
            await loadBankRequests();
            renderRequestsTab();
            updatePendingBadge();
        })
        .subscribe();
}

function setupCustomMonthPicker() {
    const MESES_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const trigger = $('month-picker-btn');
    const popover = $('month-picker-dropdown');
    const titleEl = $('mpd-title');
    const gridEl = $('mpd-grid');
    const prevBtn = $('mpd-prev-month');
    const nextBtn = $('mpd-next-month');
    if (!trigger || !popover) return;

    const today = new Date();
    let viewYear, viewMonth;

    function updateLabel() {
        const [y, m] = currentMonth.split('-');
        const el = $('month-picker-label');
        if (el) el.textContent = `${MESES_LONG[parseInt(m) - 1]} de ${y}`;
    }

    function render() {
        titleEl.textContent = `${MESES_LONG[viewMonth]} ${viewYear}`;

        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            cells.push({ day: d, muted: false, isToday });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map(
                (c) =>
                    `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}">${c.day}</button>`
            )
            .join('');

        gridEl.querySelectorAll('.calendar-day:not(.calendar-day--muted)').forEach((el) => {
            el.addEventListener('click', () => {
                currentMonth = `${viewYear}-${pad0(viewMonth + 1)}`;
                updateLabel();
                close();
                refresh();
            });
        });
    }

    function open() {
        const [y, m] = currentMonth.split('-').map(Number);
        viewYear = y;
        viewMonth = m - 1;
        render();
        popover.classList.add('open');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
    }

    function close() {
        popover.classList.remove('open');
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
    }

    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }
    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
    });
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
    });
    popover.addEventListener('click', (e) => e.stopPropagation());

    updateLabel();
}

function setupAdjustDatePicker() {
    const MESES_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const trigger = $('adjust-data-trigger');
    const popover = $('adjust-data-popover');
    const titleEl = $('adjust-data-title');
    const gridEl = $('adjust-data-grid');
    const prevBtn = $('adjust-data-prev');
    const nextBtn = $('adjust-data-next');
    const hidden = $('adjust-data');
    const label = $('adjust-data-label');
    if (!trigger || !popover) return;

    const today = new Date();
    let viewYear = today.getFullYear(),
        viewMonth = today.getMonth();

    function setValue(y, m, d) {
        hidden.value = `${y}-${pad0(m + 1)}-${pad0(d)}`;
        label.textContent = `${pad0(d)}/${pad0(m + 1)}/${y}`;
    }

    function render() {
        titleEl.textContent = `${MESES_LONG[viewMonth]} ${viewYear}`;

        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            cells.push({ day: d, muted: false, isToday });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map(
                (c) =>
                    `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}">${c.day}</button>`
            )
            .join('');

        gridEl.querySelectorAll('.calendar-day:not(.calendar-day--muted)').forEach((el) => {
            el.addEventListener('click', () => {
                setValue(viewYear, viewMonth, parseInt(el.textContent, 10));
                close();
            });
        });
    }

    function open() {
        if (hidden.value) {
            const [y, m] = hidden.value.split('-').map(Number);
            viewYear = y;
            viewMonth = m - 1;
        }
        render();
        popover.classList.add('open');
        trigger.classList.add('active');
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
    }

    function close() {
        popover.classList.remove('open');
        trigger.classList.remove('active');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
    }

    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }
    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });
    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
    });
    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
    });
    popover.addEventListener('click', (e) => e.stopPropagation());

    window.setAdjustDate = function (dateStr) {
        if (!dateStr) {
            hidden.value = '';
            label.textContent = 'Selecione a data';
            return;
        }
        const [y, m, d] = dateStr.split('-').map(Number);
        setValue(y, m - 1, d);
        viewYear = y;
        viewMonth = m - 1;
    };
}

function setupSidebar() {
    const sidebar = $('sidebar'),
        toggle = $('sidebar-toggle'),
        topbar = $('topbar-menu-btn'),
        overlay = $('sidebar-overlay'),
        wrapper = document.querySelector('.main-wrapper');
    const isMobile = () => window.innerWidth <= 768;
    const openSide = () => {
        sidebar?.classList.add('open');
        overlay?.classList.add('active');
        document.body.style.overflow = 'hidden';
    };
    const closeSide = () => {
        sidebar?.classList.remove('open');
        overlay?.classList.remove('active');
        document.body.style.overflow = '';
    };
    toggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        isMobile()
            ? sidebar?.classList.contains('open')
                ? closeSide()
                : openSide()
            : (() => {
                  const c = sidebar?.classList.toggle('collapsed');
                  wrapper?.classList.toggle('sidebar-collapsed', c);
              })();
    });
    topbar?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar?.classList.contains('open') ? closeSide() : openSide();
    });
    overlay?.addEventListener('click', closeSide);
    window.addEventListener('resize', () => {
        if (!isMobile()) closeSide();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSide();
            closeAllModals();
        }
    });
}

function openModal(id) {
    const el = $(id);
    if (el) {
        el.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}
function closeModal(id) {
    const el = $(id);
    if (el) {
        el.classList.remove('open');
        document.body.style.overflow = '';
    }
}
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach((el) => el.classList.remove('open'));
    document.body.style.overflow = '';
}
window.handleOverlayClick = function (e, id) {
    if (e.target === e.currentTarget) closeModal(id);
};

function showToast(title, type = 'success') {
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${title}</p>
        </div>
        <button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),400)">
            <i class="fas fa-times"></i>
        </button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

function $(id) {
    return document.getElementById(id);
}
function setText(id, val) {
    const el = $(id);
    if (el) el.textContent = val;
}
function fmtDate(key) {
    if (!key) return '—';
    const [y, m, d] = key.split('-');
    return `${d}/${m}/${y}`;
}
function fmtMonthLabel(key) {
    if (!key) return '';
    const [y, m] = key.split('-');
    const d = new Date(+y, +m - 1, 1);
    const lbl = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return lbl.charAt(0).toUpperCase() + lbl.slice(1);
}
function isoDate(d) {
    return `${d.getFullYear()}-${pad0(d.getMonth() + 1)}-${pad0(d.getDate())}`;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadStaticComplianceData,
        loadAllData,
        loadBankLedger,
        buildAllBalances,
        __setCurrentMonthForTest(mk) {
            currentMonth = mk;
        },
        __getStateForTest() {
            return { allEmps, timeRecordsMap, bankAdjMap, ledgerMap, holidaysMap, vacationsByEmp, hrSettings };
        },
    };
}
