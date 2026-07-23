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
    const { data } = await sb.from('payslips').select('*').eq('employee_id', myEmployeeId).eq('status', 'pago').order('mes', { ascending: false });
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
        list.innerHTML = `<div style="padding:20px;font-size:.84rem;color:var(--text-muted);text-align:center;">Nenhum holerite disponível.</div>`;
        return;
    }
    holerites.forEach((h, i) => {
        const card = document.createElement('div');
        card.className = 'month-card';
        card.setAttribute('data-id', h.id);
        card.style.animationDelay = `${Math.min(i * 0.04, 0.4)}s`;
        card.onclick = () => selectPayslipById(h.id);
        const statusLine = h.assinado_em
            ? `<span class="month-card-liquido">Líquido: ${formatCurrency(h.salario_liquido)}</span>`
            : `<span class="month-card-liquido month-card-pending"><i class="fas fa-signature"></i> Aguardando assinatura</span>`;
        card.innerHTML = `
            <div class="month-card-icon"><i class="fas fa-file-alt"></i></div>
            <div class="month-card-body">
                <span class="month-card-competencia">${h.mes_formatado || h.mes}</span>
                ${statusLine}
            </div>
            <i class="fas fa-chevron-right month-card-arrow"></i>`;
        list.appendChild(card);
    });
}

function buildMobileSelect() {
    const sel = document.getElementById('month-select-mobile');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione o mês...</option>';
    holerites.forEach((h) => {
        const opt = document.createElement('option');
        opt.value = h.id;
        opt.textContent = h.mes_formatado || h.mes;
        sel.appendChild(opt);
    });
}

window.selectPayslipById = function (id) {
    const h = holerites.find((x) => x.id === id);
    if (!h) return;
    currentId = id;
    document.querySelectorAll('.month-card').forEach((c) => c.classList.toggle('active', c.getAttribute('data-id') === id));
    const mSel = document.getElementById('month-select-mobile');
    if (mSel && mSel.value !== id) mSel.value = id;
    document.getElementById('payslip-empty')?.classList.add('hidden');

    if (!h.assinado_em) {
        document.getElementById('payslip-wrap')?.classList.add('hidden');
        setText('gate-competencia', h.mes_formatado || h.mes);
        document.getElementById('payslip-gate')?.classList.remove('hidden');
        return;
    }

    document.getElementById('payslip-gate')?.classList.add('hidden');
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
            ? `<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--text-muted);font-size:.82rem;">Nenhum provento</td></tr>`
            : proventos
                  .map(
                      (p) =>
                          `<tr><td class="col-cod">${p.cod}</td><td>${escapeHTML(p.descricao)}</td><td class="col-ref">${escapeHTML(p.referencia)}</td><td class="col-val">${formatCurrencyRaw(p.valor)}</td></tr>`
                  )
                  .join('');

    const descTbody = document.getElementById('descontos-tbody');
    if (descTbody)
        descTbody.innerHTML = !descontos.length
            ? `<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--text-muted);font-size:.82rem;">Nenhum desconto</td></tr>`
            : descontos
                  .map(
                      (d) =>
                          `<tr><td class="col-cod">${d.cod}</td><td>${escapeHTML(d.descricao)}</td><td class="col-ref">${escapeHTML(d.referencia)}</td><td class="col-val">${formatCurrencyRaw(d.valor)}</td></tr>`
                  )
                  .join('');

    setText('total-proventos', formatCurrency(h.total_proventos));
    setText('total-descontos', formatCurrency(h.total_descontos));
    setText('doc-liquido', formatCurrency(h.salario_liquido));

    const signArea = document.getElementById('doc-footer-assinatura');
    if (signArea) {
        signArea.innerHTML = h.assinado_em
            ? `<p class="assinatura-done"><i class="fas fa-signature"></i> Assinado por ${escapeHTML(h.assinado_por || myEmployee.name)} em ${new Date(h.assinado_em).toLocaleString('pt-BR')}</p>`
            : `<div class="assinatura-line"></div><p class="assinatura-label">Assinatura do Funcionário</p>`;
    }
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

window.printPayslipWithOrientation = function (orientation) {
    if (!currentId) return;
    closePrintOrientationModal();
    let styleEl = document.getElementById('print-orientation-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'print-orientation-style';
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@page { size: ${orientation}; }`;
    window.print();
};

let signingId = null;

window.openSignPayslipModal = function () {
    if (!currentId) return;
    const h = holerites.find((x) => x.id === currentId);
    if (!h) return;
    signingId = currentId;
    setText('sign-payslip-competencia', h.mes_formatado || h.mes);
    const nameInput = document.getElementById('sign-payslip-name');
    if (nameInput) nameInput.value = myEmployee?.name || '';
    const agree = document.getElementById('sign-payslip-agree');
    if (agree) agree.checked = false;
    toggleSignConfirmBtn();
    document.getElementById('sign-payslip-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
};

window.closeSignPayslipModal = function () {
    document.getElementById('sign-payslip-modal')?.classList.remove('open');
    document.body.style.overflow = '';
};

window.toggleSignConfirmBtn = function () {
    const agree = document.getElementById('sign-payslip-agree');
    const btn = document.getElementById('btn-confirm-sign-payslip');
    if (btn) btn.disabled = !agree?.checked;
};

window.confirmSignPayslip = async function () {
    if (!signingId) return;
    const nameInput = document.getElementById('sign-payslip-name');
    const name = nameInput?.value.trim();
    if (!name) {
        showToast('Digite seu nome completo para assinar.', 'warning');
        return;
    }
    const agree = document.getElementById('sign-payslip-agree');
    if (!agree?.checked) {
        showToast('Confirme que leu e concorda com o holerite.', 'warning');
        return;
    }

    const { error } = await sb.rpc('sign_payslip', { p_payslip_id: signingId, p_signer_name: name });
    if (error) {
        showToast('Não foi possível registrar a assinatura.', 'error');
        return;
    }

    const h = holerites.find((x) => x.id === signingId);
    if (h) {
        h.assinado_em = new Date().toISOString();
        h.assinado_por = name;
    }
    const justSignedId = signingId;
    closeSignPayslipModal();
    renderMonthList();
    if (currentId === justSignedId) selectPayslipById(justSignedId);
    showToast('Holerite assinado com sucesso!', 'success');
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
    const sel = document.getElementById('informe-year-select');
    const years = [...new Set(holerites.map((h) => h.mes.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
    if (sel) {
        sel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
    }
    document.getElementById('informe-modal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderInforme(years[0] || String(new Date().getFullYear()));
};

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
            <div class="informe-stat"><span class="informe-stat-label">Total líquido recebido</span><span class="informe-stat-value">${formatCurrency(totalLiquido)}</span></div>
            <div class="informe-stat"><span class="informe-stat-label">INSS retido</span><span class="informe-stat-value danger">${formatCurrency(totalInss)}</span></div>
            <div class="informe-stat"><span class="informe-stat-label">IRRF retido</span><span class="informe-stat-value danger">${formatCurrency(totalIrrf)}</span></div>
        </div>
        <table class="informe-table">
            <thead><tr><th>Competência</th><th class="col-val">Proventos</th><th class="col-val">Descontos</th><th class="col-val">Líquido</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
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
    window.print();
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
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<div class="toast-icon"><i class="fas ${icons[type] || 'fa-check'}"></i></div><div class="toast-content"><p class="toast-title">${escapeHTML(title)}</p></div><button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),300)"><i class="fas fa-times"></i></button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
