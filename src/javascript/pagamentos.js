const pad0 = (n) => String(n).padStart(2, '0');

let currentMonth = '';
let currentSearch = '';
let currentDept = '';
let currentDeptHol = '';
let allRows = [];
let employees = [];
let payslips = [];
let rhUser = null;
let currentSlipData = null;
const selectedIds = new Set();
let lastRescisaoCalc = null;

document.addEventListener('DOMContentLoaded', async () => {
    setLoading(true);
    try {
        const auth = await NexusAuth.requireProfile('Administrador');
        if (!auth) return;
        rhUser = auth.user;

        setText('rh-sidebar-name', 'Administrador');
        setText('rh-sidebar-role', 'Recursos Humanos');
        setText('rh-sidebar-avatar', 'ADM');

        setupSidebar();
        setupExportDropdown();
        setupDeptFilterDropdown('dept-filter-dropdown', 'btn-dept-filter', 'dept-filter-menu', 'dept-filter-chevron');
        setupDeptFilterDropdown('dept-hol-filter-dropdown', 'btn-dept-hol-filter', 'dept-hol-filter-menu', 'dept-hol-filter-chevron');
        setupRescisaoDatePicker();

        const now = new Date();
        currentMonth = `${now.getFullYear()}-${pad0(now.getMonth() + 1)}`;
        setupCustomMonthPicker();

        await refresh();
        setupRealtimeSync();
    } finally {
        setLoading(false);
    }
});

function setLoading(show) {
    const el = document.getElementById('page-loader');
    if (!el) return;
    if (show) el.classList.add('active');
    else el.classList.remove('active');
}

async function loadData() {
    const [{ data: empData, error: empErr }, { data: slipData, error: slipErr }] = await Promise.all([
        sb
            .from('employees')
            .select(
                'id,name,cpf,role,dept,salary,contract_type,work_load,admission_date,email,vale_transporte,valor_passagem,conducoes_dia,vale_refeicao,vale_alimentacao'
            )
            .in('status', ['Ativo', 'ativo'])
            .order('name'),
        sb.from('payslips').select('*').eq('mes', currentMonth),
    ]);

    if (empErr) console.error('Erro ao carregar colaboradores:', empErr.message);
    if (slipErr) console.error('Erro ao carregar holerites:', slipErr.message);

    employees = (empData || []).map((e) => ({
        id: e.id,
        name: e.name,
        cpf: e.cpf,
        role: e.role,
        dept: e.dept,
        salary: e.salary,
        contractType: e.contract_type,
        workLoad: e.work_load,
        admissionDate: e.admission_date,
        email: e.email,
        valeTransporte: e.vale_transporte ? 'sim' : 'nao',
        valorPassagem: e.valor_passagem,
        conducoesdia: e.conducoes_dia,
        benValeRefeicao: e.vale_refeicao ? String(e.vale_refeicao) : null,
        benValeAlimentacao: e.vale_alimentacao ? String(e.vale_alimentacao) : null,
    }));
    payslips = slipData || [];
}

async function refresh() {
    setLoading(true);
    try {
        await loadData();
        populateDeptFilters();
        buildFolhaRows();
        selectedIds.clear();
        renderFolha();
        renderHolerites();
        loadKPIs();
    } finally {
        setLoading(false);
    }
}

function calcINSS(salBase) {
    if (salBase <= 0) return 0;
    const faixas = TABELA_FISCAL.inss.faixas;
    const teto = faixas[faixas.length - 1].limite;
    const base = Math.min(salBase, teto);
    for (const f of faixas) {
        if (base <= f.limite) return +(base * f.aliquota - f.deducao).toFixed(2);
    }
    return 0;
}

function calcIRRF(base) {
    for (const f of TABELA_FISCAL.irrf.faixas) {
        if (base <= f.limite) return f.aliquota > 0 ? +(base * f.aliquota - f.deducao).toFixed(2) : 0;
    }
    return 0;
}

function parseCurrency(str) {
    if (!str) return 0;
    return (
        parseFloat(
            String(str)
                .replace(/[^\d,]/g, '')
                .replace(',', '.')
        ) || 0
    );
}

function calcRow(emp) {
    const salary = Number(emp.salary) || 0;
    const ct = (emp.contractType || 'clt').toLowerCase();
    const isPJ = ct === 'pj';
    const isAprendiz = ct === 'aprendiz';
    let inss = 0,
        irrf = 0,
        benef = 0,
        descVT = 0;

    if (!isPJ) {
        inss = isAprendiz ? +(salary * TABELA_FISCAL.aprendizInssAliquota).toFixed(2) : calcINSS(salary);
        if (!isAprendiz) irrf = calcIRRF(salary - inss);

        if (emp.benValeRefeicao) benef += parseCurrency(emp.benValeRefeicao) * 22;
        if (emp.benValeAlimentacao) benef += parseCurrency(emp.benValeAlimentacao);

        if (emp.valeTransporte === 'sim') {
            const condDia = parseInt(emp.conducoesdia || '2', 10);
            const valPass = parseCurrency(emp.valorPassagem || '0');
            const vtBruto = +(valPass * condDia * 22).toFixed(2);
            descVT = +Math.min(salary * CLTDomain.VALE_TRANSPORTE_DESCONTO_MAX_PERCENTUAL, vtBruto).toFixed(2);
            benef += vtBruto;
        }
    }
    benef = +benef.toFixed(2);
    const bruto = +(salary + benef).toFixed(2);
    const liquido = +(bruto - inss - irrf - descVT).toFixed(2);
    return { salary, inss, irrf, benef, bruto, descontos: +(inss + irrf + descVT).toFixed(2), liquido, isPJ };
}

async function buildPayslipData(emp, monthKey) {
    const calc = calcRow(emp);
    const [year, monthNum] = monthKey.split('-');
    const month = parseInt(monthNum, 10);

    const proventos = [{ cod: '001', descricao: 'Salário Base', referencia: '30 dias', valor: calc.salary }];
    const descontos = [];

    if (!calc.isPJ) {
        if (emp.benValeRefeicao) {
            const vr = parseCurrency(emp.benValeRefeicao) * 22;
            if (vr > 0) proventos.push({ cod: '010', descricao: 'Vale Refeição', referencia: '22 dias', valor: +vr.toFixed(2) });
        }
        if (emp.benValeAlimentacao) {
            const va = parseCurrency(emp.benValeAlimentacao);
            if (va > 0) proventos.push({ cod: '011', descricao: 'Vale Alimentação', referencia: 'Mensal', valor: va });
        }
        if (emp.valeTransporte === 'sim') {
            const condDia = parseInt(emp.conducoesdia || '2', 10);
            const valPass = parseCurrency(emp.valorPassagem || '0');
            const vtBruto = +(valPass * condDia * 22).toFixed(2);
            const descVT = +Math.min(calc.salary * CLTDomain.VALE_TRANSPORTE_DESCONTO_MAX_PERCENTUAL, vtBruto).toFixed(2);
            if (vtBruto > 0) {
                proventos.push({ cod: '012', descricao: 'Vale Transporte', referencia: `${condDia} cond/dia`, valor: vtBruto });
                if (descVT > 0) descontos.push({ cod: '903', descricao: 'Desc. Vale Transporte', referencia: '6%', valor: descVT });
            }
        }

        const jornadaMin = getJornadaMinRH(emp);
        const { noturnoMin, feriadoMin, intervaloDeficitMin } = await calcAdicionaisMes(emp.id, jornadaMin, monthKey);
        const valorHora = calc.salary / CLTDomain.getDivisorHoraMensal(jornadaMin, emp.workLoad);
        let valorNoturno = 0,
            valorFeriado = 0,
            valorDsr = 0;
        if (noturnoMin > 0) {
            valorNoturno = +((noturnoMin / 52.5) * valorHora * CLTDomain.ADICIONAL_NOTURNO_PERCENTUAL).toFixed(2);
            if (valorNoturno > 0)
                proventos.push({
                    cod: '020',
                    descricao: 'Adicional Noturno (20% — CLT art. 73, hora reduzida)',
                    referencia: `${(noturnoMin / 60).toFixed(1)}h reais`,
                    valor: valorNoturno,
                });
        }
        if (feriadoMin > 0) {
            valorFeriado = +((feriadoMin / 60) * valorHora * CLTDomain.ADICIONAL_DOMINGO_FERIADO_PERCENTUAL).toFixed(2);
            if (valorFeriado > 0)
                proventos.push({
                    cod: '021',
                    descricao: 'Adicional Domingo/Feriado Trabalhado (100% — Súmula 146 TST)',
                    referencia: `${(feriadoMin / 60).toFixed(1)}h`,
                    valor: valorFeriado,
                });
        }

        if (intervaloDeficitMin > 0) {
            const valorIntervalo = +((intervaloDeficitMin / 60) * valorHora * CLTDomain.INTERVALO_INDENIZACAO_MULTIPLICADOR).toFixed(2);
            if (valorIntervalo > 0)
                proventos.push({
                    cod: '022',
                    descricao: 'Indenização de Intervalo Intrajornada (50% — CLT art. 71 §4º)',
                    referencia: `${(intervaloDeficitMin / 60).toFixed(1)}h`,
                    valor: valorIntervalo,
                });
        }

        const { semanasComPerda } = await calcDsrDescontoMes(emp.id, monthKey);
        if (semanasComPerda > 0) {
            valorDsr = +((calc.salary / 30) * semanasComPerda).toFixed(2);
            if (valorDsr > 0)
                descontos.push({
                    cod: '904',
                    descricao: 'Desconto de DSR (falta injustificada — Lei 605/49 art. 6º)',
                    referencia: `${semanasComPerda} semana${semanasComPerda > 1 ? 's' : ''}`,
                    valor: valorDsr,
                });
        }

        const isAprendiz = (emp.contractType || '').toLowerCase() === 'aprendiz';
        const baseContribuicao = Math.max(0, +(calc.salary + valorNoturno + valorFeriado - valorDsr).toFixed(2));
        const inssRecalc = isAprendiz ? +(baseContribuicao * TABELA_FISCAL.aprendizInssAliquota).toFixed(2) : calcINSS(baseContribuicao);
        const irrfRecalc = isAprendiz ? 0 : calcIRRF(baseContribuicao - inssRecalc);

        if (inssRecalc > 0) {
            const ref = isAprendiz ? `${(TABELA_FISCAL.aprendizInssAliquota * 100).toFixed(0)}%` : `${((inssRecalc / baseContribuicao) * 100).toFixed(1)}%`;
            descontos.push({ cod: '901', descricao: 'INSS', referencia: ref, valor: inssRecalc });
        }
        if (irrfRecalc > 0) descontos.push({ cod: '902', descricao: 'IRRF', referencia: 'Tabela', valor: irrfRecalc });
    }

    const totalProventos = +proventos.reduce((s, p) => s + p.valor, 0).toFixed(2);
    const totalDescontos = +descontos.reduce((s, d) => s + d.valor, 0).toFixed(2);
    const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    return {
        employee_id: emp.id,
        mes: monthKey,
        mes_formatado: `${MESES[month - 1]} ${year}`,
        competencia: `${pad0(month)}/${year}`,
        proventos,
        descontos,
        total_proventos: totalProventos,
        total_descontos: totalDescontos,
        salario_liquido: +(totalProventos - totalDescontos).toFixed(2),
        status: 'publicado',
    };
}

function buildFolhaRows() {
    allRows = employees.map((emp) => {
        const calc = calcRow(emp);
        const slip = payslips.find((p) => p.employee_id === emp.id) || null;
        const pago = slip?.status === 'pago';
        const gerado = !!slip;
        return { emp, calc, slip, pago, gerado };
    });
}

function loadKPIs() {
    let totalBruto = 0,
        totalLiquido = 0,
        totalPagos = 0;
    allRows.forEach((r) => {
        totalBruto += r.calc.bruto;
        totalLiquido += r.calc.liquido;
        if (r.pago) totalPagos++;
    });
    setText('kpi-bruto', fmtCurrency(totalBruto));
    setText('kpi-liquido', fmtCurrency(totalLiquido));
    setText('kpi-colab', allRows.length);
    setText('kpi-pagos', `${totalPagos}/${allRows.length}`);

    const total = allRows.length;
    const allPaid = total > 0 && totalPagos === total;
    const pending = total - totalPagos;

    const statusCard = document.getElementById('stat-card-status');
    if (statusCard) {
        statusCard.classList.toggle('stat-card--complete', allPaid);
        if (total === 0) statusCard.title = 'Pagos — holerites quitados';
        else if (allPaid) statusCard.title = 'Pagos — folha encerrada';
        else if (pending === 1) statusCard.title = 'Pagos — 1 colaborador pendente';
        else statusCard.title = `Pagos — ${pending} colaboradores pendentes`;
    }
}

function applySearch() {
    const input = document.getElementById('search-input');
    currentSearch = (input?.value || '').toLowerCase().trim();
    document.getElementById('search-clear')?.classList.toggle('hidden', !input?.value.trim());
    renderFolha();
}
window.applySearch = applySearch;

window.clearSearch = function () {
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    document.getElementById('search-clear')?.classList.add('hidden');
    applySearch();
};

function renderFolha() {
    const tbody = document.getElementById('folha-tbody');
    if (!tbody) return;

    const filtered = allRows.filter((r) => {
        if (r.pago) return false;
        if (currentSearch && !r.emp.name.toLowerCase().includes(currentSearch) && !(r.emp.dept || '').toLowerCase().includes(currentSearch)) return false;
        if (currentDept && (r.emp.dept || '') !== currentDept) return false;
        return true;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="table-empty"><i class="fas fa-circle-check"></i><p>Todos os colaboradores já foram pagos nesta competência.</p></div></td></tr>`;
        setText('folha-count', '');
        updateSummary([]);
        updateSelectionUI(filtered);
        return;
    }

    tbody.innerHTML = filtered.map((r) => buildFolhaRow(r)).join('');
    setText('folha-count', `${filtered.length} colaborador${filtered.length !== 1 ? 'es' : ''} na folha`);
    updateSummary(filtered);
    updateSelectionUI(filtered);
}

function buildFolhaRow(r) {
    const { emp, calc, pago } = r;
    const ini = initials(emp.name);
    const color = nameToColor(emp.name);
    const ct = (emp.contractType || 'CLT').toUpperCase();

    const statusBadge = pago
        ? `<span class="badge badge--pago"><i class="fas fa-check"></i> Pago</span>`
        : `<span class="badge badge--pendente"><i class="fas fa-clock"></i> Pendente</span>`;

    const ctBadge = calc.isPJ
        ? `<span class="badge badge--pj">PJ</span>`
        : `<span style="font-size:.78rem;color:var(--text-secondary);font-weight:600">${ct}</span>`;

    const isSelected = selectedIds.has(emp.id);

    return `<tr class="${isSelected ? 'row-selected' : ''}">
        <td class="td-check"><input type="checkbox" class="cb-row" data-emp-id="${emp.id}" ${isSelected ? 'checked' : ''} onchange="toggleRowSelect('${emp.id}', this)"></td>
        <td data-label="Colaborador"><div class="emp-cell"><div class="emp-avatar" style="background:${color}">${ini}</div><div><p class="emp-name">${escHtml(emp.name)}</p><p class="emp-dept">${escHtml(emp.dept || '—')}</p></div></div></td>
        <td data-label="Contrato">${ctBadge}</td>
        <td data-label="Bruto"><span class="val-blue">${fmtCurrency(calc.bruto)}</span></td>
        <td data-label="INSS"><span class="val-red">${calc.isPJ ? '—' : fmtCurrency(calc.inss)}</span></td>
        <td data-label="IRRF"><span class="val-red">${calc.isPJ ? '—' : fmtCurrency(calc.irrf)}</span></td>
        <td data-label="Benefícios">${calc.benef > 0 ? `<span class="val-blue">${fmtCurrency(calc.benef)}</span>` : '—'}</td>
        <td data-label="Líquido"><span class="val-green">${fmtCurrency(calc.liquido)}</span></td>
        <td data-label="Status">${statusBadge}</td>
    </tr>`;
}

window.toggleRowSelect = function (empId, cb) {
    if (cb.checked) selectedIds.add(empId);
    else selectedIds.delete(empId);

    const tr = cb.closest('tr');
    tr?.classList.toggle('row-selected', cb.checked);

    const visibleIds = getVisibleIds();
    syncHeaderCheckbox(visibleIds);
    showBulkBar();
};

window.toggleSelectAll = function (headerCb) {
    const visibleIds = getVisibleIds();
    if (headerCb.checked) visibleIds.forEach((id) => selectedIds.add(id));
    else visibleIds.forEach((id) => selectedIds.delete(id));
    renderFolha();
};

window.limparSelecao = function () {
    selectedIds.clear();
    renderFolha();
};

function getVisibleIds() {
    return Array.from(document.querySelectorAll('#folha-tbody .cb-row'))
        .map((cb) => cb.dataset.empId)
        .filter(Boolean);
}

function syncHeaderCheckbox(visibleIds) {
    const headerCb = document.getElementById('select-all-cb');
    if (!headerCb) return;
    const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
    if (selectedVisible.length === 0) {
        headerCb.checked = false;
        headerCb.indeterminate = false;
    } else if (selectedVisible.length === visibleIds.length) {
        headerCb.checked = true;
        headerCb.indeterminate = false;
    } else {
        headerCb.checked = false;
        headerCb.indeterminate = true;
    }
}

function updateSelectionUI(filtered) {
    const visibleIds = (filtered || []).map((r) => r.emp.id);
    syncHeaderCheckbox(visibleIds);
    showBulkBar();
}

function showBulkBar() {
    const bar = document.getElementById('bulk-bar');
    const count = document.getElementById('bulk-count');
    if (!bar) return;
    const n = selectedIds.size;
    if (n > 0) {
        bar.classList.add('visible');
        if (count) count.textContent = `${n} colaborador${n !== 1 ? 'es' : ''} selecionado${n !== 1 ? 's' : ''}`;
    } else {
        bar.classList.remove('visible');
    }
}

window.marcarSelecionadosPagos = async function () {
    if (!selectedIds.size) return;
    const rows = allRows.filter((r) => selectedIds.has(r.emp.id) && !r.pago);
    if (!rows.length) {
        showToast('Todos os selecionados já estão pagos.', 'info');
        return;
    }
    setLoading(true);
    try {
        const pagoEm = new Date().toISOString();
        const slipsData = await Promise.all(
            rows.map(async (r) => ({
                ...(await buildPayslipData(r.emp, currentMonth)),
                status: 'pago',
                pago_em: pagoEm,
                created_by: rhUser?.id,
            }))
        );
        const { error } = await sb.from('payslips').upsert(slipsData, { onConflict: 'employee_id,mes' });
        if (error) {
            showToast(`Erro: ${error.message}`, 'error');
            return;
        }
        rows.forEach((r) => {
            r.pago = true;
            r.gerado = true;
        });
        loadKPIs();
        showToast(
            `${rows.length} colaborador${rows.length !== 1 ? 'es' : ''} marcado${rows.length !== 1 ? 's' : ''} como pago${rows.length !== 1 ? 's' : ''}.`,
            'success'
        );
        await refresh();
    } finally {
        setLoading(false);
    }
};

function updateSummary(rows) {
    let bruto = 0,
        inss = 0,
        irrf = 0,
        benef = 0,
        liquido = 0;
    rows.forEach((r) => {
        bruto += r.calc.salary;
        inss += r.calc.inss;
        irrf += r.calc.irrf;
        benef += r.calc.benef;
        liquido += r.calc.liquido;
    });
    setText('sum-bruto', fmtCurrency(bruto));
    setText('sum-inss', fmtCurrency(inss));
    setText('sum-irrf', fmtCurrency(irrf));
    setText('sum-benef', fmtCurrency(benef));
    setText('sum-liquido', fmtCurrency(liquido));
}

function applyHolSearch() {
    const input = document.getElementById('search-hol');
    document.getElementById('search-hol-clear')?.classList.toggle('hidden', !input?.value.trim());
    renderHolerites((input?.value || '').toLowerCase().trim(), currentDeptHol);
}
window.applyHolSearch = applyHolSearch;

window.clearHolSearch = function () {
    const input = document.getElementById('search-hol');
    if (input) input.value = '';
    document.getElementById('search-hol-clear')?.classList.add('hidden');
    applyHolSearch();
};

function renderHolerites(q = '', dept = '') {
    const tbody = document.getElementById('hol-tbody');
    if (!tbody) return;

    const filtered = allRows.filter((r) => {
        if (!r.pago) return false;
        if (q && !r.emp.name.toLowerCase().includes(q) && !(r.emp.dept || '').toLowerCase().includes(q)) return false;
        if (dept && (r.emp.dept || '') !== dept) return false;
        return true;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="table-empty"><i class="fas fa-file-invoice"></i><p>Nenhum holerite pago nesta competência.</p></div></td></tr>`;
        setText('hol-count', '');
        return;
    }

    const [year, monthNum] = currentMonth.split('-');
    const monthLabel = new Date(+year, parseInt(monthNum) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const competLabel = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    tbody.innerHTML = filtered
        .map((r) => {
            const { emp, calc, slip, pago } = r;
            const ini = initials(emp.name);
            const color = nameToColor(emp.name);

            const statusBadge = pago
                ? `<span class="badge badge--pago"><i class="fas fa-check"></i> Pago</span>`
                : `<span class="badge badge--pendente"><i class="fas fa-clock"></i> Pendente</span>`;

            return `<tr>
            <td data-label="Colaborador"><div class="emp-cell"><div class="emp-avatar" style="background:${color}">${ini}</div><div><p class="emp-name">${escHtml(emp.name)}</p><p class="emp-dept">${escHtml(emp.dept || '—')}</p></div></div></td>
            <td data-label="Competência">${competLabel}</td>
            <td data-label="Líquido"><span class="val-green">${fmtCurrency(pago ? slip.salario_liquido : calc.liquido)}</span></td>
            <td data-label="Status">${statusBadge}</td>
            <td data-label="Ações"><div class="actions-cell">
                <button class="btn-action btn-action--view" onclick="verHolerite('${emp.id}')" title="Ver holerite" ${!pago ? 'disabled' : ''}>
                    <i class="fas fa-eye"></i>
                </button>
            </div></td>
        </tr>`;
        })
        .join('');

    setText('hol-count', `${filtered.length} colaborador${filtered.length !== 1 ? 'es' : ''}`);
}

window.verHolerite = function (empId) {
    const row = allRows.find((r) => r.emp.id === empId);
    if (!row || !row.slip) return;
    renderSlipModal(row.emp, row.slip);
    renderSlipBankInfo(row.emp, row.slip);
    currentSlipData = { emp: row.emp, slip: row.slip };
    openModal('slip-modal');
    NexusAuth.logAccess(empId, 'holerite', row.slip.competencia || row.slip.mes);
};

window.executarMarcarTodosPagos = async function () {
    closeModal('confirm-modal');
    const pendentes = allRows.filter((r) => !r.pago);
    if (!pendentes.length) return;

    setLoading(true);
    try {
        const pagoEm = new Date().toISOString();
        const slipsData = await Promise.all(
            pendentes.map(async (r) => ({
                ...(await buildPayslipData(r.emp, currentMonth)),
                status: 'pago',
                pago_em: pagoEm,
                created_by: rhUser?.id,
            }))
        );
        const { error } = await sb.from('payslips').upsert(slipsData, { onConflict: 'employee_id,mes' });
        if (error) {
            showToast(`Erro ao marcar pagamentos: ${error.message}`, 'error');
            return;
        }
        showToast(`${pendentes.length} colaboradores marcados como pagos.`, 'success');
        await refresh();
    } finally {
        setLoading(false);
    }
};

function renderSlipModal(emp, slip) {
    const sub = document.getElementById('slip-modal-sub');
    if (sub) sub.textContent = `${emp.name} — ${slip.competencia}`;

    const body = document.getElementById('slip-modal-body');
    if (!body) return;

    const provRows = (slip.proventos || [])
        .map(
            (p) =>
                `<tr>
            <td>${p.cod}</td>
            <td>${escHtml(p.descricao)}</td>
            <td style="color:var(--text-secondary)">${p.referencia}</td>
            <td class="td-val">${fmtCurrency(p.valor)}</td>
        </tr>`
        )
        .join('');

    const descRows = (slip.descontos || [])
        .map(
            (d) =>
                `<tr>
            <td>${d.cod}</td>
            <td>${escHtml(d.descricao)}</td>
            <td style="color:var(--text-secondary)">${d.referencia}</td>
            <td class="td-val" style="color:var(--danger)">${fmtCurrency(d.valor)}</td>
        </tr>`
        )
        .join('');

    const isPago = slip.status === 'pago';

    body.innerHTML = `
    <div class="slip-header">
        <div class="slip-header-top">
            <div>
                <div class="slip-company">Nexus RH</div>
                <div class="slip-company-sub">Sistema de Gestão de Recursos Humanos</div>
            </div>
            <div class="slip-period">Competência ${slip.competencia}</div>
        </div>
        <div class="slip-employee-row">
            <div class="slip-field"><span class="slip-field-label">Nome</span><span class="slip-field-value">${escHtml(emp.name)}</span></div>
            <div class="slip-field"><span class="slip-field-label">Cargo</span><span class="slip-field-value">${escHtml(emp.role || '—')}</span></div>
            <div class="slip-field"><span class="slip-field-label">Departamento</span><span class="slip-field-value">${escHtml(emp.dept || '—')}</span></div>
            <div class="slip-field"><span class="slip-field-label">Contrato</span><span class="slip-field-value">${escHtml(emp.contractType || 'CLT')}</span></div>
            ${emp.admissionDate ? `<div class="slip-field"><span class="slip-field-label">Admissão</span><span class="slip-field-value">${fmtDate(emp.admissionDate)}</span></div>` : ''}
        </div>
        ${isPago ? `<div class="slip-status-stamp"><i class="fas fa-circle-check"></i> PAGAMENTO EFETUADO</div>` : ''}
    </div>

    <p class="slip-section-title">Proventos</p>
    <table class="slip-table">
        <thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th style="text-align:right">Valor (R$)</th></tr></thead>
        <tbody>${provRows || '<tr><td colspan="4" style="color:var(--text-tertiary);text-align:center;padding:14px">Nenhum provento</td></tr>'}</tbody>
    </table>

    <p class="slip-section-title">Descontos</p>
    <table class="slip-table">
        <thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th style="text-align:right">Valor (R$)</th></tr></thead>
        <tbody>${descRows || '<tr><td colspan="4" style="color:var(--text-tertiary);text-align:center;padding:14px">Nenhum desconto</td></tr>'}</tbody>
    </table>

    <div class="slip-totals">
        <div class="slip-total-box blue">
            <div class="slip-total-label">Total Proventos</div>
            <div class="slip-total-value">${fmtCurrency(slip.total_proventos)}</div>
        </div>
        <div class="slip-total-box red">
            <div class="slip-total-label">Total Descontos</div>
            <div class="slip-total-value">${fmtCurrency(slip.total_descontos)}</div>
        </div>
        <div class="slip-total-box green">
            <div class="slip-total-label">Salário Líquido</div>
            <div class="slip-total-value">${fmtCurrency(slip.salario_liquido)}</div>
        </div>
    </div>
    <div class="slip-bank-info hidden" id="slip-bank-info"></div>`;
}

function getJornadaMinRH(emp) {
    return CLTDomain.resolveJornadaMin({ contractType: emp?.contractType, workLoad: emp?.workLoad });
}

function diffMinRH(a, b) {
    return CLTDomain.diffMin(a, b);
}

let holidaysCacheRH = null;
async function getHolidaysMapRH() {
    if (holidaysCacheRH) return holidaysCacheRH;
    const { data } = await sb.from('holidays').select('date,name');
    holidaysCacheRH = {};
    (data || []).forEach((h) => {
        holidaysCacheRH[h.date] = h;
    });
    return holidaysCacheRH;
}

function isSundayRH(dateKey) {
    return CLTDomain.isSunday(dateKey);
}

function nightOverlapMinRH(start, end) {
    return CLTDomain.nightOverlapMin(start, end);
}

function workSegmentsRH(r) {
    return CLTDomain.workSegments(r);
}

function calcIntervaloDeficitMinRH(rec, jornadaMin) {
    return CLTDomain.calcIntervaloDeficitMin(rec, jornadaMin);
}

async function calcAdicionaisMes(empId, jornadaMin, monthKey) {
    if (jornadaMin === null) return { noturnoMin: 0, feriadoMin: 0, intervaloDeficitMin: 0 };
    const [{ data: recs }, holidaysMap] = await Promise.all([
        sb
            .from('time_records')
            .select('date,entrada,saida_almoco,retorno_almoco,saida')
            .eq('employee_id', empId)
            .gte('date', `${monthKey}-01`)
            .lt('date', nextMonthKey(monthKey)),
        getHolidaysMapRH(),
    ]);
    let noturnoMin = 0,
        feriadoMin = 0,
        intervaloDeficitMin = 0;
    (recs || []).forEach((r) => {
        if (!r.entrada || !r.saida) return;
        const segs = workSegmentsRH(r);
        segs.forEach(([s, e]) => {
            noturnoMin += nightOverlapMinRH(s, e);
        });
        if (isSundayRH(r.date) || holidaysMap[r.date]) {
            segs.forEach(([s, e]) => {
                feriadoMin += diffMinRH(s, e);
            });
        }
        intervaloDeficitMin += calcIntervaloDeficitMinRH(r, jornadaMin);
    });
    return { noturnoMin, feriadoMin, intervaloDeficitMin };
}

function weekStartKeyRH(dateKey) {
    return CLTDomain.weekStartKey(dateKey);
}

async function calcDsrDescontoMes(empId, monthKey) {
    const { data: faltas } = await sb
        .from('adjustment_requests')
        .select('date')
        .eq('employee_id', empId)
        .eq('tipo', 'falta')
        .eq('status', 'rejeitado')
        .gte('date', `${monthKey}-01`)
        .lt('date', nextMonthKey(monthKey));
    const semanas = new Set((faltas || []).map((f) => weekStartKeyRH(f.date)));
    return { semanasComPerda: semanas.size };
}

async function renderSlipBankInfo(emp, slip) {
    const el = document.getElementById('slip-bank-info');
    if (!el) return;
    const jornadaMin = getJornadaMinRH(emp);
    if (jornadaMin === null || !slip.mes) {
        el.classList.add('hidden');
        return;
    }

    const [{ data: recs }, { data: adjs }] = await Promise.all([
        sb
            .from('time_records')
            .select('entrada,saida_almoco,retorno_almoco,saida')
            .eq('employee_id', emp.id)
            .gte('date', `${slip.mes}-01`)
            .lt('date', nextMonthKey(slip.mes)),
        sb
            .from('bank_adjustments')
            .select('tipo,minutos')
            .eq('employee_id', emp.id)
            .gte('date', `${slip.mes}-01`)
            .lt('date', nextMonthKey(slip.mes))
            .is('deleted_at', null),
    ]);
    let net = 0;
    (recs || []).forEach((r) => {
        if (!r.entrada || !r.saida) return;
        net += CLTDomain.calcWorkedMin(r) - jornadaMin;
    });
    (adjs || []).forEach((a) => {
        net += a.tipo === 'credito' ? a.minutos : -a.minutos;
    });

    const abs = Math.abs(net),
        h = Math.floor(abs / 60),
        m = String(abs % 60).padStart(2, '0');
    const sinal = net > 0 ? '+' : net < 0 ? '-' : '';
    el.innerHTML = `<i class="fas fa-clock"></i> Saldo do banco de horas na competência ${slip.competencia || slip.mes} (referência, não incluso nos totais acima): <strong>${sinal}${h}h ${m}min</strong>`;
    el.className = `slip-bank-info ${net > 0 ? 'positivo' : net < 0 ? 'negativo' : ''}`;
}

async function getSaldoBancoHorasReal(empId, jornadaMin, ateDataStr) {
    if (jornadaMin === null) return 0;
    const [{ data: recs }, { data: adjs }] = await Promise.all([
        sb.from('time_records').select('date,entrada,saida_almoco,retorno_almoco,saida').eq('employee_id', empId).lte('date', ateDataStr),
        sb.from('bank_adjustments').select('tipo,minutos').eq('employee_id', empId).lte('date', ateDataStr).is('deleted_at', null),
    ]);
    let net = 0;
    (recs || []).forEach((r) => {
        if (!r.entrada || !r.saida) return;
        net += CLTDomain.calcWorkedMin(r) - jornadaMin;
    });
    (adjs || []).forEach((a) => {
        net += a.tipo === 'credito' ? a.minutos : -a.minutos;
    });
    return net;
}

async function calcMediaAdicionaisHabituais(empId, ateDataStr) {
    const desde = new Date(ateDataStr);
    desde.setMonth(desde.getMonth() - 12);
    const desdeKey = desde.toISOString().slice(0, 7);
    const ateKey = ateDataStr.slice(0, 7);

    const { data: slips } = await sb.from('payslips').select('mes,proventos').eq('employee_id', empId).gte('mes', desdeKey).lt('mes', ateKey);
    if (!slips || !slips.length) return 0;

    let total = 0;
    slips.forEach((s) => {
        (s.proventos || []).forEach((p) => {
            if (p.cod === '020' || p.cod === '021') total += Number(p.valor) || 0;
        });
    });
    return +(total / slips.length).toFixed(2);
}

function nextMonthKey(monthKey) {
    return CLTDomain.nextMonthKey(monthKey);
}

window.openRescisaoModal = function () {
    const sel = document.getElementById('rescisao-emp');
    if (sel) {
        sel.innerHTML = '<option value="">Selecione</option>' + employees.map((e) => `<option value="${e.id}">${escHtml(e.name)}</option>`).join('');
        sel.value = '';
    }
    document.getElementById('rescisao-admissao').value = '';
    document.getElementById('rescisao-salario').value = '';
    window.setRescisaoDate?.('');
    const errEl = document.getElementById('rescisao-error');
    if (errEl) errEl.textContent = '';
    document.getElementById('rescisao-result')?.classList.add('hidden');
    document.getElementById('btn-confirmar-desligamento')?.classList.add('hidden');
    document.getElementById('btn-calcular-rescisao')?.classList.remove('hidden');
    setRescisaoInputsDisabled(false);
    lastRescisaoCalc = null;
    openModal('rescisao-modal');
};

function setRescisaoInputsDisabled(disabled) {
    document.getElementById('rescisao-emp').disabled = disabled;
    document.getElementById('rescisao-tipo').disabled = disabled;
    document.getElementById('rescisao-data-trigger').disabled = disabled;
}

window.onRescisaoEmpChange = function () {
    const empId = document.getElementById('rescisao-emp')?.value;
    const emp = employees.find((e) => e.id === empId);
    document.getElementById('rescisao-admissao').value = emp ? fmtDate(emp.admissionDate) : '';
    document.getElementById('rescisao-salario').value = emp ? fmtCurrency(emp.salary) : '';
};

window.calcularRescisaoModal = async function () {
    const errEl = document.getElementById('rescisao-error');
    const resultEl = document.getElementById('rescisao-result');
    const calcBtn = document.getElementById('btn-calcular-rescisao');
    if (errEl) errEl.textContent = '';
    resultEl?.classList.add('hidden');
    document.getElementById('btn-confirmar-desligamento')?.classList.add('hidden');
    calcBtn?.classList.remove('hidden');
    setRescisaoInputsDisabled(false);
    lastRescisaoCalc = null;

    const empId = document.getElementById('rescisao-emp')?.value;
    const emp = employees.find((e) => e.id === empId);
    const dataStr = document.getElementById('rescisao-data')?.value;
    const tipo = document.getElementById('rescisao-tipo')?.value || 'sem_justa_causa';

    if (!emp) {
        if (errEl) errEl.textContent = 'Selecione um colaborador.';
        return;
    }
    if (!emp.admissionDate) {
        if (errEl) errEl.textContent = 'Colaborador sem data de admissão cadastrada.';
        return;
    }
    if (!dataStr) {
        if (errEl) errEl.textContent = 'Informe a data de desligamento.';
        return;
    }

    const [ay, am, ad] = emp.admissionDate.split('-').map(Number);
    const admissao = new Date(ay, am - 1, ad);
    const [dy, dm, dd] = dataStr.split('-').map(Number);
    const demissao = new Date(dy, dm - 1, dd);

    if (demissao <= admissao) {
        if (errEl) errEl.textContent = 'A data de desligamento deve ser posterior à admissão.';
        return;
    }

    const salario = Number(emp.salary) || 0;
    if (salario <= 0) {
        if (errEl) errEl.textContent = 'Colaborador sem salário cadastrado.';
        return;
    }

    const btnOriginalHTML = calcBtn?.innerHTML;
    if (calcBtn) {
        calcBtn.disabled = true;
        calcBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Apurando banco de horas…';
    }
    const jornadaMin = getJornadaMinRH(emp);
    let saldoBancoHorasMin = 0,
        mediaAdicionaisHabituais = 0;
    try {
        [saldoBancoHorasMin, mediaAdicionaisHabituais] = await Promise.all([
            getSaldoBancoHorasReal(emp.id, jornadaMin, dataStr),
            calcMediaAdicionaisHabituais(emp.id, dataStr),
        ]);
    } catch (err) {
        console.error('Erro ao apurar banco de horas/médias habituais para a rescisão:', err.message);
    } finally {
        if (calcBtn) {
            calcBtn.disabled = false;
            calcBtn.innerHTML = btnOriginalHTML;
        }
    }

    const r = calcularRescisao({ tipo, salario, admissao, demissao, saldoBancoHorasMin, jornadaMin, workLoad: emp.workLoad, mediaAdicionaisHabituais });
    renderRescisaoResult(r);
    resultEl?.classList.remove('hidden');

    lastRescisaoCalc = { emp, dataStr, resultado: r };
    calcBtn?.classList.add('hidden');
    document.getElementById('btn-confirmar-desligamento')?.classList.remove('hidden');
    setRescisaoInputsDisabled(true);
};

function gerarPdfRescisao(emp, r, dataStr) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    doc.setFillColor(13, 14, 18);
    doc.rect(0, 0, 210, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text('Nexus RH — Termo de Cálculo de Rescisão', 14, 14);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Colaborador: ${emp.name}`, 14, 30);
    doc.text(`Tipo de rescisão: ${r.label}`, 14, 36);
    doc.text(`Data de desligamento: ${fmtDate(dataStr)}`, 14, 42);
    doc.text(`Tempo de casa: ${r.anosCompletos} ano(s)`, 14, 48);

    doc.autoTable({
        startY: 56,
        head: [['Verba', 'Referência', 'Valor (R$)']],
        body: r.verbas.map((v) => [v.descricao, String(v.dias), fmtCurrency(v.valor)]),
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        styles: { fontSize: 9 },
        theme: 'striped',
        margin: { left: 14, right: 14 },
    });

    let finalY = doc.lastAutoTable.finalY + 6;
    if (r.encargos.length) {
        doc.autoTable({
            startY: finalY,
            head: [['Encargo da Empresa', 'Referência', 'Valor (R$)']],
            body: r.encargos.map((v) => [v.descricao, String(v.dias), fmtCurrency(v.valor)]),
            headStyles: { fillColor: [239, 68, 68], textColor: 255, fontStyle: 'bold', fontSize: 9 },
            styles: { fontSize: 9 },
            theme: 'striped',
            margin: { left: 14, right: 14 },
        });
        finalY = doc.lastAutoTable.finalY + 6;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Custo total do desligamento: ${fmtCurrency(r.custoTotal)}`, 14, finalY + 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('Estimativa gerada pelo simulador de rescisão do Nexus RH — não substitui o cálculo trabalhista oficial.', 14, finalY + 12);

    return doc.output('blob');
}

window.confirmarDesligamento = async function () {
    if (!lastRescisaoCalc) return;
    const { emp, dataStr, resultado: r } = lastRescisaoCalc;

    if (
        !confirm(
            `Confirmar o desligamento de ${emp.name} em ${fmtDate(dataStr)}?\n\nIsso vai marcar o colaborador como Inativo e gerar um registro de auditoria e um documento de rescisão.`
        )
    )
        return;

    const btn = document.getElementById('btn-confirmar-desligamento');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processando…';
    }

    try {
        if (typeof window.jspdf === 'undefined') {
            showToast('Biblioteca PDF não carregada.', 'error');
            return;
        }

        const { error: statusError } = await sb.from('employees').update({ status: 'Inativo', termination_date: dataStr }).eq('id', emp.id);
        if (statusError) {
            showToast('Não foi possível atualizar o status do colaborador.', 'error');
            return;
        }

        await sb
            .from('vacations')
            .update({ status: 'recusado', rejection_reason: 'Colaborador desligado pelo RH.', rejected_at: new Date().toISOString() })
            .eq('employee_id', emp.id)
            .eq('status', 'pendente');

        const blob = gerarPdfRescisao(emp, r, dataStr);
        const fileName = `rescisao_${emp.name.replace(/\s+/g, '_')}.pdf`;
        const storagePath = `rh/${Date.now()}_${fileName}`;

        const { error: uploadError } = await sb.storage.from('documents').upload(storagePath, blob, { contentType: 'application/pdf' });
        if (uploadError) {
            showToast('Colaborador desligado, mas não foi possível anexar o documento de rescisão.', 'warning');
        } else {
            const retidoAte = new Date();
            retidoAte.setFullYear(retidoAte.getFullYear() + 30);
            await sb.from('documents').insert({
                name: fileName,
                employee_id: emp.id,
                category: 'demissional',
                tipo: 'Termo de Rescisão',
                size_label: `${Math.round(blob.size / 1024)} KB`,
                storage_path: storagePath,
                source: 'Administrador',
                status: 'aprovado',
                created_by: rhUser.id,
                retido_ate: retidoAte.toISOString().slice(0, 10),
                lgpd_consentimento: true,
                lgpd_consentimento_em: new Date().toISOString(),
            });
        }

        await sb.from('employee_audit').insert({
            employee_id: emp.id,
            changes: [
                { field: 'status', label: 'Status', oldValue: 'Ativo', newValue: 'Inativo' },
                {
                    field: 'rescisao',
                    label: 'Rescisão',
                    oldValue: null,
                    newValue: {
                        tipo: r.label,
                        dataDesligamento: dataStr,
                        custoTotal: r.custoTotal,
                        totalVerbas: r.totalVerbas,
                        totalEncargos: r.totalEncargos,
                    },
                },
            ],
            operator_name: rhUser?.email?.split('@')[0] || 'RH',
            operator_email: rhUser?.email || '',
        });

        showToast(`Desligamento confirmado: ${emp.name} foi inativado e o termo de rescisão foi anexado ao perfil.`, 'success');
        closeModal('rescisao-modal');
        await refresh();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-file-signature"></i> Confirmar Desligamento';
        }
    }
};

function renderRescisaoResult(r) {
    const el = document.getElementById('rescisao-result');
    if (!el) return;

    const rows = (itens) =>
        itens
            .map(
                (v) =>
                    `<tr><td>${escHtml(v.descricao)}</td><td style="color:var(--text-secondary)">${v.dias}</td><td class="td-val">${fmtCurrency(v.valor)}</td></tr>`
            )
            .join('');

    const encargosSection = r.encargos.length
        ? `
        <p class="slip-section-title">Encargos da Empresa</p>
        <table class="slip-table">
            <thead><tr><th>Descrição</th><th>Referência</th><th style="text-align:right">Valor (R$)</th></tr></thead>
            <tbody>${rows(r.encargos)}</tbody>
        </table>`
        : '';

    el.innerHTML = `
        <p class="slip-section-title">Verbas Rescisórias</p>
        <table class="slip-table">
            <thead><tr><th>Descrição</th><th>Referência</th><th style="text-align:right">Valor (R$)</th></tr></thead>
            <tbody>${rows(r.verbas)}</tbody>
        </table>
        ${encargosSection}
        <div class="slip-totals">
            <div class="slip-total-box blue">
                <div class="slip-total-label">Total Verbas</div>
                <div class="slip-total-value">${fmtCurrency(r.totalVerbas)}</div>
            </div>
            <div class="slip-total-box red">
                <div class="slip-total-label">Total Encargos</div>
                <div class="slip-total-value">${fmtCurrency(r.totalEncargos)}</div>
            </div>
            <div class="slip-total-box green">
                <div class="slip-total-label">Custo Total do Desligamento</div>
                <div class="slip-total-value">${fmtCurrency(r.custoTotal)}</div>
            </div>
        </div>`;
}

function setupRescisaoDatePicker() {
    const MESES_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const trigger = document.getElementById('rescisao-data-trigger');
    const popover = document.getElementById('rescisao-data-popover');
    const titleEl = document.getElementById('rescisao-data-title');
    const gridEl = document.getElementById('rescisao-data-grid');
    const prevBtn = document.getElementById('rescisao-data-prev');
    const nextBtn = document.getElementById('rescisao-data-next');
    const hidden = document.getElementById('rescisao-data');
    const label = document.getElementById('rescisao-data-label');
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

    window.setRescisaoDate = function (dateStr) {
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

window.printCurrentSlip = function () {
    if (!currentSlipData) return;
    const { emp, slip } = currentSlipData;

    const isPago = slip.status === 'pago';
    const provRows = (slip.proventos || [])
        .map(
            (p) =>
                `<tr><td>${p.cod}</td><td>${escHtml(p.descricao)}</td><td>${p.referencia}</td><td style="text-align:right;font-weight:700">${fmtCurrency(p.valor)}</td></tr>`
        )
        .join('');
    const descRows = (slip.descontos || [])
        .map(
            (d) =>
                `<tr><td>${d.cod}</td><td>${escHtml(d.descricao)}</td><td>${d.referencia}</td><td style="text-align:right;font-weight:700;color:#b91c1c">${fmtCurrency(d.valor)}</td></tr>`
        )
        .join('');

    const cssHref = new URL('../styles/holerite-print.css', window.location.href).href;
    const win = window.open('', '_blank', 'width=820,height=700');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
        <meta charset="UTF-8">
        <title>Holerite — ${escHtml(emp.name)} — ${slip.competencia}</title>
        <link rel="stylesheet" href="${cssHref}">
    </head><body>
        <div class="header">
            <div class="header-top">
                <div>
                    <div class="company">Nexus RH</div>
                    <div class="company-sub">Sistema de Gestão de Recursos Humanos</div>
                </div>
                <div class="period">Competência ${slip.competencia}</div>
            </div>
            <div class="emp-grid">
                <div><div class="field-label">Nome</div><div class="field-value">${escHtml(emp.name)}</div></div>
                <div><div class="field-label">Cargo</div><div class="field-value">${escHtml(emp.role || '—')}</div></div>
                <div><div class="field-label">Departamento</div><div class="field-value">${escHtml(emp.dept || '—')}</div></div>
                <div><div class="field-label">Contrato</div><div class="field-value">${escHtml(emp.contractType || 'CLT')}</div></div>
                ${emp.admissionDate ? `<div><div class="field-label">Admissão</div><div class="field-value">${fmtDate(emp.admissionDate)}</div></div>` : ''}
            </div>
            ${isPago ? `<div class="stamp">✓ PAGAMENTO EFETUADO</div>` : ''}
        </div>
        <div class="section-title">Proventos</div>
        <table><thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th style="text-align:right">Valor (R$)</th></tr></thead>
        <tbody>${provRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:12px">Nenhum provento</td></tr>'}</tbody></table>
        <div class="section-title">Descontos</div>
        <table><thead><tr><th>Cód</th><th>Descrição</th><th>Referência</th><th style="text-align:right">Valor (R$)</th></tr></thead>
        <tbody>${descRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:12px">Nenhum desconto</td></tr>'}</tbody></table>
        <div class="totals">
            <div class="total-box blue"><div class="total-label">Total Proventos</div><div class="total-value">${fmtCurrency(slip.total_proventos)}</div></div>
            <div class="total-box red"><div class="total-label">Total Descontos</div><div class="total-value">${fmtCurrency(slip.total_descontos)}</div></div>
            <div class="total-box green"><div class="total-label">Salário Líquido</div><div class="total-value">${fmtCurrency(slip.salario_liquido)}</div></div>
        </div>
        <div class="footer">
            <span>Gerado pelo Nexus RH em ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
            <span>Este documento tem validade apenas com assinatura digital ou carimbo da empresa.</span>
        </div>
        <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`);
    win.document.close();
};

function populateDeptFilters() {
    const depts = [...new Set(employees.map((e) => e.dept || '').filter(Boolean))].sort();
    buildDeptChips('dept-filter-chips', 'btn-dept-filter', depts, currentDept, 'setDeptFilter');
    buildDeptChips('dept-hol-filter-chips', 'btn-dept-hol-filter', depts, currentDeptHol, 'setDeptHolFilter');
}

function buildDeptChips(chipsId, btnId, depts, selected, fnName) {
    const chipsEl = document.getElementById(chipsId);
    if (!chipsEl) return;

    chipsEl.innerHTML = [
        `<button type="button" class="chip${!selected ? ' chip--active' : ''}" data-dept="" onclick="${fnName}(this)">Todos os departamentos</button>`,
        ...depts.map(
            (d) =>
                `<button type="button" class="chip${d === selected ? ' chip--active' : ''}" data-dept="${escHtml(d)}" onclick="${fnName}(this)">${escHtml(d)}</button>`
        ),
    ].join('');

    document.getElementById(btnId)?.classList.toggle('filtered', !!selected);
}

function setupDeptFilterDropdown(wrapId, btnId, menuId, chevronId) {
    const wrap = document.getElementById(wrapId);
    const btn = document.getElementById(btnId);
    const menu = document.getElementById(menuId);
    const chevron = document.getElementById(chevronId);
    if (!wrap || !btn || !menu) return;

    function open() {
        btn.classList.add('open');
        menu.classList.add('open');
        chevron?.classList.add('open');
    }
    function close() {
        btn.classList.remove('open');
        menu.classList.remove('open');
        chevron?.classList.remove('open');
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.contains('open') ? close() : open();
    });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', close);
}

function setDeptFilterCommon(btn, chipsId, btnId, chevronId, menuId) {
    document.querySelectorAll(`#${chipsId} .chip`).forEach((c) => c.classList.remove('chip--active'));
    btn.classList.add('chip--active');
    const dept = btn.dataset.dept || '';
    document.getElementById(btnId)?.classList.toggle('filtered', !!dept);
    document.getElementById(btnId)?.classList.remove('open');
    document.getElementById(menuId)?.classList.remove('open');
    document.getElementById(chevronId)?.classList.remove('open');
    return dept;
}

window.setDeptFilter = function (btn) {
    currentDept = setDeptFilterCommon(btn, 'dept-filter-chips', 'btn-dept-filter', 'dept-filter-chevron', 'dept-filter-menu');
    renderFolha();
};

window.setDeptHolFilter = function (btn) {
    currentDeptHol = setDeptFilterCommon(btn, 'dept-hol-filter-chips', 'btn-dept-hol-filter', 'dept-hol-filter-chevron', 'dept-hol-filter-menu');
    applyHolSearch();
};

function setupRealtimeSync() {
    sb.channel('payslips-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payslips' }, async () => {
            await refresh();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, async () => {
            await refresh();
        })
        .subscribe();
}

function setupExportDropdown() {
    const btn = document.getElementById('btn-export');
    const menu = document.getElementById('export-menu');
    const chevron = btn?.querySelector('.export-chevron');
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menu.classList.toggle('open');
        btn.classList.toggle('open', open);
        chevron?.classList.toggle('rotated', open);
    });
    document.addEventListener('click', () => {
        menu.classList.remove('open');
        btn.classList.remove('open');
        chevron?.classList.remove('rotated');
    });
    menu.addEventListener('click', (e) => e.stopPropagation());

    document.getElementById('export-excel')?.addEventListener('click', () => {
        menu.classList.remove('open');
        chevron?.classList.remove('rotated');
        exportExcel();
    });
    document.getElementById('export-pdf')?.addEventListener('click', () => {
        menu.classList.remove('open');
        chevron?.classList.remove('rotated');
        exportPDF();
    });
    document.getElementById('export-csv')?.addEventListener('click', () => {
        menu.classList.remove('open');
        chevron?.classList.remove('rotated');
        exportCSV();
    });
}

async function exportCSV() {
    if (!employees.length) {
        showToast('Nada para exportar neste mês.', 'warning');
        return;
    }
    if (typeof XLSX === 'undefined') {
        showToast('Biblioteca de exportação não carregada.', 'error');
        return;
    }

    setLoading(true);
    try {
        const slips = await Promise.all(employees.map((emp) => buildPayslipData(emp, currentMonth)));

        const header = ['Competência', 'Colaborador', 'CPF', 'Departamento', 'Cargo', 'Tipo de Contrato', 'Tipo', 'Código', 'Descrição', 'Referência', 'Valor'];
        const body = [];
        employees.forEach((emp, i) => {
            const slip = slips[i];
            const common = [slip.competencia, emp.name, emp.cpf || '', emp.dept || '—', emp.role || '—', (emp.contractType || 'CLT').toUpperCase()];
            slip.proventos.forEach((p) => body.push([...common, 'Provento', p.cod, p.descricao, p.referencia, p.valor]));
            slip.descontos.forEach((d) => body.push([...common, 'Desconto', d.cod, d.descricao, d.referencia, d.valor]));
        });

        if (!body.length) {
            showToast('Nenhuma verba calculada para este mês.', 'warning');
            return;
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), `Folha ${currentMonth}`);
        XLSX.writeFile(wb, `folha-pagamento-${currentMonth}-contabilidade.csv`);
        showToast('Exportação CSV concluída.', 'success');
    } catch (e) {
        console.error('exportCSV:', e);
        showToast('Erro ao gerar CSV.', 'error');
    } finally {
        setLoading(false);
    }
}

function exportExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('Biblioteca Excel não carregada.', 'error');
        return;
    }
    const wb = XLSX.utils.book_new();
    const header = ['Colaborador', 'Departamento', 'Contrato', 'Salário Bruto', 'INSS', 'IRRF', 'Benefícios', 'Líquido', 'Status'];
    const body = allRows.map((r) => [
        r.emp.name,
        r.emp.dept || '—',
        (r.emp.contractType || 'CLT').toUpperCase(),
        r.calc.bruto,
        r.calc.inss,
        r.calc.irrf,
        r.calc.benef,
        r.calc.liquido,
        r.pago ? 'Pago' : r.gerado ? 'Gerado' : 'Pendente',
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), `Folha ${currentMonth}`);
    XLSX.writeFile(wb, `folha-pagamento-${currentMonth}.xlsx`);
    showToast('Exportação Excel concluída.', 'success');
}

function exportPDF() {
    if (typeof window.jspdf === 'undefined') {
        showToast('Biblioteca PDF não carregada.', 'error');
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFillColor(13, 14, 18);
    doc.rect(0, 0, 297, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(`Nexus RH — Folha de Pagamento — ${fmtMonthLabel(currentMonth)}`, 14, 14);

    doc.autoTable({
        startY: 28,
        head: [['Colaborador', 'Departamento', 'Contrato', 'Bruto', 'INSS', 'IRRF', 'Benefícios', 'Líquido', 'Status']],
        body: allRows.map((r) => [
            r.emp.name,
            r.emp.dept || '—',
            (r.emp.contractType || 'CLT').toUpperCase(),
            fmtCurrency(r.calc.bruto),
            fmtCurrency(r.calc.inss),
            fmtCurrency(r.calc.irrf),
            fmtCurrency(r.calc.benef),
            fmtCurrency(r.calc.liquido),
            r.pago ? 'Pago' : r.gerado ? 'Gerado' : 'Pendente',
        ]),
        headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: 'bold', fontSize: 9 },
        alternateRowStyles: { fillColor: [248, 249, 250] },
        margin: { left: 14, right: 14 },
        theme: 'striped',
        styles: { fontSize: 9 },
    });
    doc.save(`folha-pagamento-${currentMonth}.pdf`);
    showToast('Exportação PDF concluída.', 'success');
}

function setupCustomMonthPicker() {
    const MESES_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const trigger = document.getElementById('month-picker-btn');
    const popover = document.getElementById('month-picker-dropdown');
    const titleEl = document.getElementById('mpd-title');
    const gridEl = document.getElementById('mpd-grid');
    const prevBtn = document.getElementById('mpd-prev-month');
    const nextBtn = document.getElementById('mpd-next-month');
    if (!trigger || !popover) return;

    const today = new Date();
    let viewYear, viewMonth;

    function updateLabel() {
        const [y, m] = currentMonth.split('-');
        const el = document.getElementById('month-picker-label');
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

window.switchTab = function (btn, name) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${name}`)?.classList.add('active');
};

function openModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('open');
        document.body.style.overflow = '';
    }
}
window.closeModal = closeModal;
window.handleOverlayClick = function (e, id) {
    if (e.target === document.getElementById(id)) closeModal(id);
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
        document.body.style.overflow = '';
    }
});

function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    const topbar = document.getElementById('topbar-menu-btn');
    const overlay = document.getElementById('sidebar-overlay');
    const wrapper = document.getElementById('main-wrapper');
    const isMobile = () => window.innerWidth <= 768;
    const open = () => {
        sidebar?.classList.add('open');
        overlay?.classList.add('active');
        document.body.style.overflow = 'hidden';
    };
    const close = () => {
        sidebar?.classList.remove('open');
        overlay?.classList.remove('active');
        document.body.style.overflow = '';
    };

    toggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isMobile()) {
            sidebar?.classList.contains('open') ? close() : open();
        } else {
            const c = sidebar?.classList.toggle('collapsed');
            wrapper?.classList.toggle('sidebar-collapsed', c);
        }
    });
    topbar?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar?.classList.contains('open') ? close() : open();
    });
    overlay?.addEventListener('click', close);
    window.addEventListener('resize', () => {
        if (!isMobile()) close();
    });
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
function fmtCurrency(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
}

function fmtMonthLabel(key) {
    if (!key) return '';
    const [y, m] = key.split('-');
    const lbl = new Date(+y, +m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return lbl.charAt(0).toUpperCase() + lbl.slice(1);
}

function initials(name) {
    return (name || '?')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || '')
        .join('');
}

function nameToColor(name) {
    const p = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#f97316', '#0ea5e9', '#14b8a6'];
    let h = 0;
    for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) | 0;
    return p[Math.abs(h) % p.length];
}

function escHtml(str) {
    if (typeof str !== 'string') return str ?? '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, type = 'success') {
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${escHtml(msg)}</p>
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

if (typeof module !== 'undefined' && module.exports) module.exports = { calcINSS, calcIRRF, calcRow, parseCurrency };
