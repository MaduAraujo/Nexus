/* ════════════════════════════════════════════════
   holerite-colaborador.js
   ════════════════════════════════════════════════ */

const HOLERITES_PREFIX = 'nexus_holerites_';

let session    = null;
let holerites  = [];
let currentId  = null;

document.addEventListener('DOMContentLoaded', () => {
    session = (() => {
        try { return JSON.parse(localStorage.getItem('nexus_session') || 'null'); }
        catch { return null; }
    })();

    if (!session || session.profile !== 'colaborador') {
        window.location.href = '../screens/login.html';
        return;
    }

    loadOrGenerate();
    setupRealtimeSync();
});

/* ──────────────────────────────────────────────
   Cálculos de Folha (INSS + IRRF — tabela 2024)
────────────────────────────────────────────── */

function calcINSS(salBase) {
    if (salBase <= 0) return 0;
    const faixas = [
        { limite: 1412.00, aliq: 0.075 },
        { limite: 2666.68, aliq: 0.090 },
        { limite: 4000.03, aliq: 0.120 },
        { limite: 7786.02, aliq: 0.140 },
    ];
    let inss = 0, anterior = 0;
    for (const f of faixas) {
        if (salBase <= anterior) break;
        inss += (Math.min(salBase, f.limite) - anterior) * f.aliq;
        anterior = f.limite;
    }
    if (salBase > 7786.02) inss += (salBase - 7786.02) * 0.14;
    return +Math.min(inss, 908.86).toFixed(2);
}

function calcIRRF(baseCalculo) {
    if (baseCalculo <= 2259.20) return 0;
    if (baseCalculo <= 2826.65) return +(baseCalculo * 0.075 -  169.44).toFixed(2);
    if (baseCalculo <= 3751.05) return +(baseCalculo * 0.150 -  381.44).toFixed(2);
    if (baseCalculo <= 4664.68) return +(baseCalculo * 0.225 -  662.77).toFixed(2);
    return +(baseCalculo * 0.275 - 896.00).toFixed(2);
}

function parseCurrencyStr(str) {
    if (!str) return 0;
    const cleaned = String(str).replace(/[^\d,]/g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
}

/* ──────────────────────────────────────────────
   Geração de Holerites
────────────────────────────────────────────── */

function loadOrGenerate() {
    const key = HOLERITES_PREFIX + session.email;
    try {
        const saved = localStorage.getItem(key);
        if (saved) {
            holerites = JSON.parse(saved);
        } else {
            holerites = generatePayslips();
            localStorage.setItem(key, JSON.stringify(holerites));
        }
    } catch {
        holerites = generatePayslips();
    }

    holerites.sort((a, b) => b.mes.localeCompare(a.mes));
    renderMonthList();
    buildMobileSelect();

    if (holerites.length > 0) selectPayslipById(holerites[0].id);
}

function generatePayslips() {
    const salary       = session.salary || 3000;
    const contractType = (session.contractType || 'CLT').toLowerCase();
    const admissionDate = session.admissionDate || null;

    const emp = getEmployee();
    const list = [];
    const hoje = new Date();

    // Gera holerites dos últimos 6 meses (ou desde a admissão, o que for menor)
    for (let i = 0; i < 6; i++) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);

        // Não gera holerite antes da admissão
        if (admissionDate) {
            const admDate = new Date(admissionDate + 'T00:00:00');
            if (d < new Date(admDate.getFullYear(), admDate.getMonth(), 1)) break;
        }

        list.push(buildPayslip(salary, contractType, emp, d));
    }

    return list;
}

function buildPayslip(salary, contractType, emp, date) {
    const month = date.getMonth() + 1;
    const year  = date.getFullYear();
    const id    = `${session.email}_${year}_${String(month).padStart(2, '0')}`;

    const proventos = [];
    const descontos = [];

    /* ── Salário base ── */
    proventos.push({ cod:'001', descricao:'Salário Base', referencia:'30 dias', valor: salary });

    /* ── Benefícios ── */
    const isPJ     = contractType === 'pj';
    const isCLT    = contractType === 'clt';
    const isEstagio = contractType.includes('stág') || contractType.includes('stagio') || contractType === 'estágio';
    const isAprendiz = contractType === 'aprendiz';

    if (!isPJ) {
        // Vale Refeição
        if (emp?.benValeRefeicao) {
            const vr = parseCurrencyStr(emp.benValeRefeicao) * 22;
            if (vr > 0) proventos.push({ cod:'010', descricao:'Vale Refeição', referencia:'22 dias', valor: +vr.toFixed(2) });
        }

        // Vale Alimentação
        if (emp?.benValeAlimentacao) {
            const va = parseCurrencyStr(emp.benValeAlimentacao);
            if (va > 0) proventos.push({ cod:'011', descricao:'Vale Alimentação', referencia:'Mensal', valor: va });
        }

        // Vale Transporte (o benefício bruto entra nos proventos, o desconto de 6% nos descontos)
        if (emp?.valeTransporte === 'sim') {
            const condDia   = parseInt(emp.conducoesdia || '2', 10);
            const valPass   = parseCurrencyStr(emp.valorPassagem || '0');
            const vtBruto   = +(valPass * condDia * 22).toFixed(2);
            const maxDesc   = +(salary * 0.06).toFixed(2);
            const descVT    = +Math.min(maxDesc, vtBruto).toFixed(2);
            if (vtBruto > 0) {
                proventos.push({ cod:'012', descricao:'Vale Transporte', referencia:`${condDia} cond/dia`, valor: vtBruto });
                if (descVT > 0) descontos.push({ cod:'903', descricao:'Desc. Vale Transporte', referencia:'6%', valor: descVT });
            }
        }
    }

    /* ── INSS e IRRF ── */
    if (isCLT || isEstagio || isAprendiz) {
        const inssRate = isAprendiz ? 0.08 : null; // Aprendiz: 8% fixo (simplificado)
        const inss = isAprendiz ? +(salary * 0.08).toFixed(2) : calcINSS(salary);
        if (inss > 0) {
            const refInss = isAprendiz ? '8%' : `${((inss / salary) * 100).toFixed(1)}%`;
            descontos.push({ cod:'901', descricao:'INSS', referencia: refInss, valor: inss });
        }

        if (!isAprendiz) {
            const baseIRRF = salary - inss;
            const irrf = calcIRRF(baseIRRF);
            if (irrf > 0) descontos.push({ cod:'902', descricao:'IRRF', referencia:'Tabela', valor: irrf });
        }
    }

    const totalProventos = +proventos.reduce((s, p) => s + p.valor, 0).toFixed(2);
    const totalDescontos = +descontos.reduce((s, d) => s + d.valor, 0).toFixed(2);

    return {
        id,
        mes: `${year}-${String(month).padStart(2, '0')}`,
        mesFormatado: formatMonthYear(month, year),
        competencia:  `${String(month).padStart(2, '0')}/${year}`,
        employeeEmail:   session.email,
        employeeName:    session.name,
        cargo:           session.role        || '—',
        departamento:    session.dept        || '—',
        matricula:       session.employeeId  || '—',
        admissaoData:    session.admissionDate || null,
        tipoContrato:    session.contractType || 'CLT',
        proventos,
        descontos,
        totalProventos,
        totalDescontos,
        salarioLiquido: +(totalProventos - totalDescontos).toFixed(2),
        status: 'publicado'
    };
}

function getEmployee() {
    try {
        const employees = JSON.parse(localStorage.getItem('nexus_employees') || '[]');
        return employees.find(e =>
            e.email?.toLowerCase() === session.email.toLowerCase() ||
            e.id === session.employeeId
        ) || null;
    } catch { return null; }
}

/* ──────────────────────────────────────────────
   Renderização
────────────────────────────────────────────── */

function renderMonthList() {
    const list  = document.getElementById('month-list');
    const badge = document.getElementById('month-count-badge');
    if (!list) return;
    if (badge) badge.textContent = holerites.length;

    list.innerHTML = '';

    if (holerites.length === 0) {
        list.innerHTML = `<div style="padding:20px;font-size:.84rem;color:var(--text-muted);text-align:center;">Nenhum holerite disponível.</div>`;
        return;
    }

    holerites.forEach(h => {
        const card = document.createElement('div');
        card.className = 'month-card';
        card.setAttribute('data-id', h.id);
        card.onclick = () => selectPayslipById(h.id);
        card.innerHTML = `
            <div class="month-card-icon"><i class="fas fa-file-alt"></i></div>
            <div class="month-card-body">
                <span class="month-card-competencia">${h.mesFormatado}</span>
                <span class="month-card-liquido">Líquido: ${formatCurrency(h.salarioLiquido)}</span>
            </div>
            <i class="fas fa-chevron-right month-card-arrow"></i>
        `;
        list.appendChild(card);
    });
}

function buildMobileSelect() {
    const sel = document.getElementById('month-select-mobile');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione o mês...</option>';
    holerites.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h.id;
        opt.textContent = h.mesFormatado;
        sel.appendChild(opt);
    });
}

window.selectPayslipById = function (id) {
    const h = holerites.find(x => x.id === id);
    if (!h) return;
    currentId = id;

    // Destaca o card ativo na lista
    document.querySelectorAll('.month-card').forEach(c => c.classList.toggle('active', c.getAttribute('data-id') === id));

    // Sincroniza o seletor mobile
    const mSel = document.getElementById('month-select-mobile');
    if (mSel && mSel.value !== id) mSel.value = id;

    // Mostra o painel do holerite
    document.getElementById('payslip-empty')?.classList.add('hidden');
    const wrap = document.getElementById('payslip-wrap');
    wrap?.classList.remove('hidden');

    renderPayslip(h);
};

function renderPayslip(h) {
    setText('action-competencia',  h.mesFormatado);
    setText('doc-competencia',     `Competência: ${h.competencia}`);
    setText('doc-name',            h.employeeName);
    setText('doc-matricula',       String(h.matricula).padStart(4, '0'));
    setText('doc-cargo',           h.cargo);
    setText('doc-dept',            h.departamento);
    setText('doc-admissao',        formatDateBR(h.admissaoData));
    setText('doc-contrato',        h.tipoContrato);

    // Proventos
    const provTbody = document.getElementById('proventos-tbody');
    if (provTbody) {
        provTbody.innerHTML = h.proventos.length === 0
            ? `<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--text-muted);font-size:.82rem;">Nenhum provento</td></tr>`
            : h.proventos.map(p => `
                <tr>
                    <td class="col-cod">${p.cod}</td>
                    <td>${escapeHTML(p.descricao)}</td>
                    <td class="col-ref">${escapeHTML(p.referencia)}</td>
                    <td class="col-val">${formatCurrencyRaw(p.valor)}</td>
                </tr>`).join('');
    }

    // Descontos
    const descTbody = document.getElementById('descontos-tbody');
    if (descTbody) {
        descTbody.innerHTML = h.descontos.length === 0
            ? `<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--text-muted);font-size:.82rem;">Nenhum desconto</td></tr>`
            : h.descontos.map(d => `
                <tr>
                    <td class="col-cod">${d.cod}</td>
                    <td>${escapeHTML(d.descricao)}</td>
                    <td class="col-ref">${escapeHTML(d.referencia)}</td>
                    <td class="col-val">${formatCurrencyRaw(d.valor)}</td>
                </tr>`).join('');
    }

    setText('total-proventos', formatCurrency(h.totalProventos));
    setText('total-descontos', formatCurrency(h.totalDescontos));
    setText('doc-liquido',     formatCurrency(h.salarioLiquido));
    setText('doc-validade',    `${h.competencia}`);
}

/* ──────────────────────────────────────────────
   Impressão
────────────────────────────────────────────── */

window.printPayslip = function () {
    if (!currentId) return;
    window.print();
};

/* ──────────────────────────────────────────────
   Logout
────────────────────────────────────────────── */

window.logout = function () {
    localStorage.removeItem('nexus_session');
    window.location.href = '../screens/login.html';
};

/* ──────────────────────────────────────────────
   Sync em tempo real (RH altera dados)
────────────────────────────────────────────── */

function setupRealtimeSync() {
    window.addEventListener('storage', (event) => {
        if (event.key !== 'nexus_users') return;
        try {
            const users = JSON.parse(event.newValue || '[]');
            const updated = users.find(u => u.email === session.email);
            if (!updated) return;

            const changed = ['name','role','dept','salary','contractType'].some(k => updated[k] !== session[k]);
            if (!changed) return;

            if (updated.status === 'Inativo' || updated.status === 'Bloqueado') {
                showToast('Conta desativada pelo RH', 'error', 'Você será desconectado.');
                setTimeout(() => { localStorage.removeItem('nexus_session'); window.location.href = '../screens/login.html'; }, 2500);
                return;
            }

            const { password: _pw, ...clean } = updated;
            session = { ...session, ...clean };
            localStorage.setItem('nexus_session', JSON.stringify(session));
            initUserUI();
            showToast('Seus dados foram atualizados pelo RH.', 'success');
        } catch {}
    });
}

/* ──────────────────────────────────────────────
   Helpers
────────────────────────────────────────────── */

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
}

function formatCurrency(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function formatCurrencyRaw(value) {
    return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function formatDateBR(dateStr) {
    if (!dateStr) return '—';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

function formatMonthYear(month, year) {
    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return `${meses[month - 1]} ${year}`;
}

function escapeHTML(str) {
    return String(str ?? '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showToast(title, type = 'success', msg = '') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success:'fa-check', error:'fa-times', warning:'fa-exclamation-triangle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${escapeHTML(title)}</p>
            ${msg ? `<p class="toast-msg">${escapeHTML(msg)}</p>` : ''}
        </div>
        <button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),300)">
            <i class="fas fa-times"></i>
        </button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 300); }, 4000);
}
