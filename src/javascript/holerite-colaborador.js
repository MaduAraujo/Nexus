let myEmployee = null;
let myEmployeeId = null;
let holerites = [];
let currentId = null;

document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('colaborador', '*');
    if (!auth) return;
    myEmployeeId = auth.profile.employee_id;
    myEmployee = auth.employee;

    loadSidebarInfo();
    setupMobileMonthSelect();
    setupInformeYearSelect();
    await loadPayslips();
    setupRealtimeSync();
});

function loadSidebarInfo() {
    const name = myEmployee.name || '—';
    const color = myEmployee.avatar_color || '#6366f1';
    const ini = name
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || '')
        .join('');
    const avatarEl = document.getElementById('sidebar-avatar');
    const nameEl = document.getElementById('sidebar-name');
    const roleEl = document.getElementById('sidebar-role');
    if (avatarEl) {
        if (myEmployee.avatar_url) {
            avatarEl.style.background = `url(${myEmployee.avatar_url}) center/cover`;
            avatarEl.textContent = '';
        } else {
            avatarEl.style.background = color;
            avatarEl.textContent = ini;
        }
    }
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = myEmployee.role || 'Colaborador';
}

window.logout = async function () {
    await sb.auth.signOut();
    window.location.href = '../screens/login.html';
};

async function loadPayslips() {
    const { data } = await sb.from('payslips_decrypted').select('*').eq('employee_id', myEmployeeId).eq('status', 'pago').order('mes', { ascending: false });
    holerites = data || [];
    renderMonthList();
    buildMobileSelect();
    if (holerites.length > 0) selectPayslipById(holerites[0].id);
}

function renderMonthList() {
    const list = document.getElementById('month-list');
    const badge = document.getElementById('month-count-badge');
    if (!list) return;
    if (badge) badge.textContent = holerites.length;
    list.innerHTML = '';
    if (!holerites.length) {
        list.innerHTML = `<div class="slip-list-empty">Nenhum holerite disponível.</div>`;
        return;
    }
    holerites.forEach((h, i) => {
        const card = document.createElement('div');
        card.className = 'month-card';
        card.setAttribute('data-id', h.id);
        card.style.animationDelay = `${Math.min(i * 0.04, 0.4)}s`;
        card.onclick = () => selectPayslipById(h.id);
        card.innerHTML = `
            <div class="month-card-icon"><i class="fas fa-file-alt"></i></div>
            <div class="month-card-body">
                <span class="month-card-competencia">${h.mes_formatado || h.mes}</span>
                <span class="month-card-liquido">Líquido: ${formatCurrency(h.salario_liquido)}</span>
            </div>
            <i class="fas fa-chevron-right month-card-arrow"></i>`;
        list.appendChild(card);
    });
}

function buildMobileSelect() {
    const popover = document.getElementById('month-select-mobile-popover');
    const textEl = document.getElementById('month-select-mobile-text');
    if (!popover) return;
    popover.innerHTML = holerites
        .map(
            (h) =>
                `<button type="button" class="select-option${h.id === currentId ? ' selected' : ''}" data-value="${h.id}">${h.mes_formatado || h.mes}</button>`
        )
        .join('');
    const current = holerites.find((h) => h.id === currentId);
    if (textEl) {
        textEl.textContent = current ? current.mes_formatado || current.mes : 'Selecione';
        textEl.classList.toggle('date-trigger-placeholder', !current);
    }
}

function setupMobileMonthSelect() {
    const trigger = document.getElementById('month-select-mobile-trigger');
    const popover = document.getElementById('month-select-mobile-popover');
    if (!trigger || !popover) return;

    function open() {
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

    popover.addEventListener('click', (e) => {
        const btn = e.target.closest('.select-option');
        if (!btn) return;
        close();
        selectPayslipById(btn.dataset.value);
    });
}

window.selectPayslipById = function (id) {
    const h = holerites.find((x) => x.id === id);
    if (!h) return;
    currentId = id;
    document.querySelectorAll('.month-card').forEach((c) => c.classList.toggle('active', c.getAttribute('data-id') === id));
    const textEl = document.getElementById('month-select-mobile-text');
    if (textEl) {
        textEl.textContent = h.mes_formatado || h.mes;
        textEl.classList.remove('date-trigger-placeholder');
    }
    document.querySelectorAll('#month-select-mobile-popover .select-option').forEach((o) => o.classList.toggle('selected', o.dataset.value === id));
    document.getElementById('payslip-empty')?.classList.add('hidden');
    document.getElementById('payslip-wrap')?.classList.remove('hidden');
    renderPayslip(h);
};

function renderPayslip(h) {
    setText('action-competencia', h.mes_formatado || h.mes);
    const badge = document.querySelector('.payslip-status-badge');
    if (badge) {
        const isPago = h.status === 'pago';
        badge.className = `payslip-status-badge ${isPago ? 'paid' : 'published'}`;
        badge.innerHTML = `<i class="fas fa-check-circle"></i> ${isPago ? 'Pago' : 'Publicado'}`;
    }
    setText('doc-competencia', `Competência: ${h.competencia}`);
    setText('doc-name', myEmployee.name);
    setText('doc-matricula', String(myEmployee.id).slice(0, 8).toUpperCase());
    setText('doc-cargo', myEmployee.role || '—');
    setText('doc-dept', myEmployee.dept || '—');
    setText('doc-admissao', formatDateBR(myEmployee.admission_date));
    setText('doc-contrato', myEmployee.contract_type || 'CLT');

    const proventos = h.proventos || [];
    const descontos = h.descontos || [];

    const provTbody = document.getElementById('proventos-tbody');
    if (provTbody)
        provTbody.innerHTML = !proventos.length
            ? `<tr><td colspan="4" class="td-empty">Nenhum provento</td></tr>`
            : proventos
                  .map(
                      (p) =>
                          `<tr><td class="col-cod">${p.cod}</td><td>${escapeHTML(p.descricao)}</td><td class="col-ref">${escapeHTML(p.referencia)}</td><td class="col-val">${formatCurrencyRaw(p.valor)}</td></tr>`
                  )
                  .join('');

    const descTbody = document.getElementById('descontos-tbody');
    if (descTbody)
        descTbody.innerHTML = !descontos.length
            ? `<tr><td colspan="4" class="td-empty">Nenhum desconto</td></tr>`
            : descontos
                  .map(
                      (d) =>
                          `<tr><td class="col-cod">${d.cod}</td><td>${escapeHTML(d.descricao)}</td><td class="col-ref">${escapeHTML(d.referencia)}</td><td class="col-val">${formatCurrencyRaw(d.valor)}</td></tr>`
                  )
                  .join('');

    setText('total-proventos', formatCurrency(h.total_proventos));
    setText('total-descontos', formatCurrency(h.total_descontos));
    setText('doc-liquido', formatCurrency(h.salario_liquido));
}

window.printPayslip = function () {
    if (!currentId) return;
    document.getElementById('print-orientation-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
};

window.closePrintOrientationModal = function () {
    document.getElementById('print-orientation-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

let printOrientationSheet = null;

window.printPayslipWithOrientation = function (orientation) {
    if (!currentId || !['portrait', 'landscape'].includes(orientation)) return;
    closePrintOrientationModal();
    if (!printOrientationSheet) {
        printOrientationSheet = new CSSStyleSheet();
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, printOrientationSheet];
    }
    printOrientationSheet.replaceSync(`@page { size: ${orientation}; }`);
    window.print();
};

let comparativoChart = null;

window.openComparativoModal = function () {
    document.getElementById('comparativo-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderComparativoChart();
};

window.closeComparativoModal = function () {
    document.getElementById('comparativo-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

function renderComparativoChart() {
    const canvas = document.getElementById('comparativo-chart');
    const emptyEl = document.getElementById('comparativo-empty');
    if (!canvas || typeof Chart === 'undefined') return;

    const sorted = [...holerites].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-12);
    if (comparativoChart) {
        comparativoChart.destroy();
        comparativoChart = null;
    }
    if (!sorted.length) {
        canvas.classList.add('hidden');
        emptyEl?.classList.remove('hidden');
        return;
    }
    canvas.classList.remove('hidden');
    emptyEl?.classList.add('hidden');

    comparativoChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: sorted.map((h) => h.mes_formatado || h.mes),
            datasets: [
                {
                    label: 'Salário líquido',
                    data: sorted.map((h) => Number(h.salario_liquido) || 0),
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99,102,241,.08)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointBackgroundColor: '#6366f1',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (ctx) => ` ${formatCurrency(ctx.parsed.y)}` } },
            },
            scales: {
                y: { beginAtZero: true, ticks: { callback: (v) => formatCurrency(v) }, grid: { color: 'rgba(0,0,0,.05)' } },
                x: { grid: { display: false } },
            },
        },
    });
}

window.openInformeModal = function () {
    const hidden = document.getElementById('informe-year-select');
    const textEl = document.getElementById('informe-year-text');
    const popover = document.getElementById('informe-year-popover');
    const years = [...new Set(holerites.map((h) => h.mes.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
    const firstYear = years[0] || String(new Date().getFullYear());
    if (popover) {
        popover.innerHTML = years
            .map((y) => `<button type="button" class="select-option${y === firstYear ? ' selected' : ''}" data-value="${y}">${y}</button>`)
            .join('');
    }
    if (hidden) hidden.value = firstYear;
    if (textEl) textEl.textContent = firstYear;
    document.getElementById('informe-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderInforme(firstYear);
};

function setupInformeYearSelect() {
    const trigger = document.getElementById('informe-year-trigger');
    const textEl = document.getElementById('informe-year-text');
    const hidden = document.getElementById('informe-year-select');
    const popover = document.getElementById('informe-year-popover');
    if (!trigger || !popover || !hidden) return;

    function open() {
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

    popover.addEventListener('click', (e) => {
        const btn = e.target.closest('.select-option');
        if (!btn) return;
        hidden.value = btn.dataset.value;
        if (textEl) textEl.textContent = btn.dataset.value;
        popover.querySelectorAll('.select-option').forEach((o) => o.classList.toggle('selected', o === btn));
        close();
        renderInforme(btn.dataset.value);
    });
}

window.closeInformeModal = function () {
    document.getElementById('informe-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

function summarizeInforme(year) {
    const doAno = holerites.filter((h) => h.mes.startsWith(year));
    const totalProventos = doAno.reduce((s, h) => s + (Number(h.total_proventos) || 0), 0);
    const totalLiquido = doAno.reduce((s, h) => s + (Number(h.salario_liquido) || 0), 0);
    const codSum = (cod) => doAno.reduce((s, h) => s + (h.descontos || []).filter((d) => d.cod === cod).reduce((ss, d) => ss + (Number(d.valor) || 0), 0), 0);
    const totalInss = codSum('901');
    const totalIrrf = codSum('902');
    return { doAno: doAno.sort((a, b) => a.mes.localeCompare(b.mes)), totalProventos, totalInss, totalIrrf, totalLiquido };
}

window.renderInforme = function (year) {
    const content = document.getElementById('informe-content');
    const emptyEl = document.getElementById('informe-empty');
    if (!content) return;
    const { doAno, totalProventos, totalInss, totalIrrf, totalLiquido } = summarizeInforme(year);

    if (!doAno.length) {
        content.innerHTML = '';
        emptyEl?.classList.remove('hidden');
        return;
    }
    emptyEl?.classList.add('hidden');

    const rows = doAno
        .map(
            (h) =>
                `<tr><td>${escapeHTML(h.mes_formatado || h.mes)}</td><td class="col-val">${formatCurrency(h.total_proventos)}</td><td class="col-val">${formatCurrency(h.total_descontos)}</td><td class="col-val">${formatCurrency(h.salario_liquido)}</td></tr>`
        )
        .join('');

    content.innerHTML = `
        <div class="informe-summary">
            <div class="informe-stat"><span class="informe-stat-label">Rendimentos brutos</span><span class="informe-stat-value">${formatCurrency(totalProventos)}</span></div>
            <div class="informe-stat"><span class="informe-stat-label"><span class="informe-stat-label--full">Total líquido recebido</span><span class="informe-stat-label--short">TL Recebido</span></span><span class="informe-stat-value">${formatCurrency(totalLiquido)}</span></div>
            <div class="informe-stat"><span class="informe-stat-label">INSS retido</span><span class="informe-stat-value danger">${formatCurrency(totalInss)}</span></div>
            <div class="informe-stat"><span class="informe-stat-label">IRRF retido</span><span class="informe-stat-value danger">${formatCurrency(totalIrrf)}</span></div>
        </div>
        <div class="informe-table-card">
            <table class="informe-table">
                <thead><tr><th>Competência</th><th class="col-val">Proventos</th><th class="col-val">Descontos</th><th class="col-val">Líquido</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
};

window.printInforme = function () {
    const sel = document.getElementById('informe-year-select');
    const year = sel?.value || String(new Date().getFullYear());
    const { doAno, totalProventos, totalInss, totalIrrf, totalLiquido } = summarizeInforme(year);
    if (!doAno.length) return;

    setText('informe-print-title-year', `Ano-calendário ${year}`);
    setText('informe-print-name', myEmployee.name);
    setText('informe-print-matricula', String(myEmployee.id).slice(0, 8).toUpperCase());
    setText('informe-print-cargo', myEmployee.role || '—');
    setText('informe-print-dept', myEmployee.dept || '—');
    setText('informe-print-year', year);
    setText('informe-print-emitido', new Date().toLocaleDateString('pt-BR'));

    const summary = document.getElementById('informe-print-summary');
    if (summary) {
        summary.innerHTML = `
            <div class="informe-stat"><span class="informe-stat-label">Rendimentos Brutos</span><span class="informe-stat-value">${formatCurrency(totalProventos)}</span></div>
            <div class="informe-stat"><span class="informe-stat-label">Total Líquido</span><span class="informe-stat-value">${formatCurrency(totalLiquido)}</span></div>
            <div class="informe-stat"><span class="informe-stat-label">INSS Retido</span><span class="informe-stat-value danger">${formatCurrency(totalInss)}</span></div>
            <div class="informe-stat"><span class="informe-stat-label">IRRF Retido</span><span class="informe-stat-value danger">${formatCurrency(totalIrrf)}</span></div>`;
    }

    const tbody = document.getElementById('informe-print-tbody');
    if (tbody) {
        tbody.innerHTML = doAno
            .map(
                (h) =>
                    `<tr><td>${escapeHTML(h.mes_formatado || h.mes)}</td><td class="col-val">${formatCurrencyRaw(h.total_proventos)}</td><td class="col-val">${formatCurrencyRaw(h.total_descontos)}</td><td class="col-val">${formatCurrencyRaw(h.salario_liquido)}</td></tr>`
            )
            .join('');
    }
    setText('informe-print-total-liquido', formatCurrency(totalLiquido));

    document.getElementById('informe-print-doc')?.classList.remove('hidden');
    document.body.classList.add('printing-informe');
    document.title = ' ';

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            window.print();
        });
    });
};

window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing-informe');
    document.getElementById('informe-print-doc')?.classList.add('hidden');
    document.title = 'Holerites';
});

function setupRealtimeSync() {
    sb.channel('payslips-colab')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payslips', filter: `employee_id=eq.${myEmployeeId}` }, async () => {
            await loadPayslips();
            if (currentId) {
                const h = holerites.find((x) => x.id === currentId);
                if (h) selectPayslipById(h.id);
                else if (holerites.length) selectPayslipById(holerites[0].id);
            }
            showToast('Holerite atualizado pelo RH.', 'success');
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'employees', filter: `id=eq.${myEmployeeId}` }, async (payload) => {
            const emp = payload.new;
            if (emp.status === 'Inativo') {
                showToast('Conta desativada pelo RH', 'error');
                setTimeout(async () => {
                    await sb.auth.signOut();
                    window.location.href = '../screens/login.html';
                }, 2500);
            }
        })
        .subscribe();
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
}
function formatCurrency(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatCurrencyRaw(v) {
    return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDateBR(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
}
function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(title, type = 'success') {
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${escapeHTML(title)}</p>
        </div>
        <button class="toast-close" data-click="dismissToast">
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
