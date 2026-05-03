/* ════════════════════════════════════════════════
   holerite-colaborador.js — Supabase
   ════════════════════════════════════════════════ */

let myEmployee   = null;
let myEmployeeId = null;
let holerites    = [];
let currentId    = null;

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles').select('profile, employee_id').eq('id', user.id).single();
    if (profile?.profile !== 'colaborador' || !profile.employee_id) { window.location.href = '../screens/login.html'; return; }

    myEmployeeId = profile.employee_id;
    const { data: emp } = await sb.from('employees').select('*').eq('id', myEmployeeId).single();
    if (!emp) { window.location.href = '../screens/login.html'; return; }
    myEmployee = emp;

    loadSidebarInfo();
    await loadPayslips();
    setupRealtimeSync();
});

// ─── Sidebar ──────────────────────────────────────────────────

function loadSidebarInfo() {
    const name  = myEmployee.name || '—';
    const color = myEmployee.avatar_color || '#6366f1';
    const ini   = name.split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('');
    const avatarEl = document.getElementById('sidebar-avatar');
    const nameEl   = document.getElementById('sidebar-name');
    const roleEl   = document.getElementById('sidebar-role');
    if (avatarEl) { avatarEl.style.background = color; avatarEl.textContent = ini; }
    if (nameEl)   nameEl.textContent = name;
    if (roleEl)   roleEl.textContent = myEmployee.role || 'Colaborador';
}

window.logout = async function () {
    await sb.auth.signOut();
    window.location.href = '../screens/login.html';
};

// ─── Data ─────────────────────────────────────────────────────

async function loadPayslips() {
    const { data } = await sb.from('payslips')
        .select('*')
        .eq('employee_id', myEmployeeId)
        .order('mes', { ascending: false });
    holerites = data || [];
    renderMonthList();
    buildMobileSelect();
    if (holerites.length > 0) selectPayslipById(holerites[0].id);
}

// ─── Render list ──────────────────────────────────────────────

function renderMonthList() {
    const list  = document.getElementById('month-list');
    const badge = document.getElementById('month-count-badge');
    if (!list) return;
    if (badge) badge.textContent = holerites.length;
    list.innerHTML = '';
    if (!holerites.length) {
        list.innerHTML = `<div style="padding:20px;font-size:.84rem;color:var(--text-muted);text-align:center;">Nenhum holerite disponível.<br>O RH ainda não gerou holerites para sua conta.</div>`;
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
                <span class="month-card-competencia">${h.mes_formatado || h.mes}</span>
                <span class="month-card-liquido">Líquido: ${formatCurrency(h.salario_liquido)}</span>
            </div>
            <i class="fas fa-chevron-right month-card-arrow"></i>`;
        list.appendChild(card);
    });
}

function buildMobileSelect() {
    const sel = document.getElementById('month-select-mobile');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione o mês...</option>';
    holerites.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h.id; opt.textContent = h.mes_formatado || h.mes;
        sel.appendChild(opt);
    });
}

window.selectPayslipById = function (id) {
    const h = holerites.find(x => x.id === id);
    if (!h) return;
    currentId = id;
    document.querySelectorAll('.month-card').forEach(c => c.classList.toggle('active', c.getAttribute('data-id') === id));
    const mSel = document.getElementById('month-select-mobile');
    if (mSel && mSel.value !== id) mSel.value = id;
    document.getElementById('payslip-empty')?.classList.add('hidden');
    document.getElementById('payslip-wrap')?.classList.remove('hidden');
    renderPayslip(h);
};

// ─── Render payslip ───────────────────────────────────────────

function renderPayslip(h) {
    setText('action-competencia', h.mes_formatado || h.mes);
    const badge = document.querySelector('.payslip-status-badge');
    if (badge) {
        const isPago = h.status === 'pago';
        badge.className = `payslip-status-badge ${isPago ? 'paid' : 'published'}`;
        badge.innerHTML = `<i class="fas fa-check-circle"></i> ${isPago ? 'Pago' : 'Publicado'}`;
    }
    setText('doc-competencia', `Competência: ${h.competencia}`);
    setText('doc-name',        myEmployee.name);
    setText('doc-matricula',   String(myEmployee.id).slice(0,8).toUpperCase());
    setText('doc-cargo',       myEmployee.role || '—');
    setText('doc-dept',        myEmployee.dept || '—');
    setText('doc-admissao',    formatDateBR(myEmployee.admission_date));
    setText('doc-contrato',    myEmployee.contract_type || 'CLT');

    const proventos = h.proventos || [];
    const descontos = h.descontos || [];

    const provTbody = document.getElementById('proventos-tbody');
    if (provTbody) provTbody.innerHTML = !proventos.length ? `<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--text-muted);font-size:.82rem;">Nenhum provento</td></tr>` :
        proventos.map(p=>`<tr><td class="col-cod">${p.cod}</td><td>${escapeHTML(p.descricao)}</td><td class="col-ref">${escapeHTML(p.referencia)}</td><td class="col-val">${formatCurrencyRaw(p.valor)}</td></tr>`).join('');

    const descTbody = document.getElementById('descontos-tbody');
    if (descTbody) descTbody.innerHTML = !descontos.length ? `<tr><td colspan="4" style="padding:12px;text-align:center;color:var(--text-muted);font-size:.82rem;">Nenhum desconto</td></tr>` :
        descontos.map(d=>`<tr><td class="col-cod">${d.cod}</td><td>${escapeHTML(d.descricao)}</td><td class="col-ref">${escapeHTML(d.referencia)}</td><td class="col-val">${formatCurrencyRaw(d.valor)}</td></tr>`).join('');

    setText('total-proventos', formatCurrency(h.total_proventos));
    setText('total-descontos', formatCurrency(h.total_descontos));
    setText('doc-liquido',     formatCurrency(h.salario_liquido));
    setText('doc-validade',    h.competencia);
}

window.printPayslip = function () { if (currentId) window.print(); };

// ─── Realtime ─────────────────────────────────────────────────

function setupRealtimeSync() {
    sb.channel('payslips-colab')
        .on('postgres_changes', { event:'*', schema:'public', table:'payslips', filter:`employee_id=eq.${myEmployeeId}` }, async () => {
            await loadPayslips();
            if (currentId) {
                const h = holerites.find(x => x.id === currentId);
                if (h) renderPayslip(h); else if (holerites.length) selectPayslipById(holerites[0].id);
            }
            showToast('Holerite atualizado pelo RH.', 'success');
        })
        .on('postgres_changes', { event:'UPDATE', schema:'public', table:'employees', filter:`id=eq.${myEmployeeId}` }, async (payload) => {
            const emp = payload.new;
            if (emp.status === 'Inativo') {
                showToast('Conta desativada pelo RH', 'error');
                setTimeout(async () => { await sb.auth.signOut(); window.location.href = '../screens/login.html'; }, 2500);
            }
        })
        .subscribe();
}

// ─── Helpers ──────────────────────────────────────────────────

function setText(id,val){const el=document.getElementById(id);if(el)el.textContent=val??'—';}
function formatCurrency(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
function formatCurrencyRaw(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function formatDateBR(str){if(!str)return'—';const[y,m,d]=str.split('-');return`${d}/${m}/${y}`;}
function escapeHTML(str){return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

function showToast(title, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success:'fa-check', error:'fa-times', warning:'fa-exclamation-triangle' };
    const toast  = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<div class="toast-icon"><i class="fas ${icons[type]||'fa-check'}"></i></div><div class="toast-content"><p class="toast-title">${escapeHTML(title)}</p></div><button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),300)"><i class="fas fa-times"></i></button>`;
    container.appendChild(toast);
    requestAnimationFrame(()=>requestAnimationFrame(()=>toast.classList.add('show')));
    setTimeout(()=>{toast.classList.remove('show');toast.classList.add('hide');setTimeout(()=>toast.remove(),300);},4000);
}
