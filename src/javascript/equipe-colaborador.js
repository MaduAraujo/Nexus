/* equipe-colaborador.js — "Minha Equipe": gestor identificado por manager_id
   (não existe um profiles.profile = 'Gestor' — ver nota na migration 029). */

let myEmployeeId = null;
let myEmployee   = null;
let teamMembers  = [];
let pendingVacations = [];
let rejectingId  = null;
let teamBalances = {};   // { employeeId: minutos (null = PJ) }
let escalatingId = null;

const $ = id => document.getElementById(id);
const getInitials = name => (name || '?').split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
const escHtml = str => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtBR = iso => { if (!iso) return '—'; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };

document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('colaborador', '*');
    if (!auth) return;
    myEmployeeId = auth.profile.employee_id;
    myEmployee   = auth.employee;

    await loadTeam();
    setupRealtimeSync();
});

async function loadTeam() {
    // team_roster (não employees direto): view sem salary/cpf/rg/dados bancários —
    // o gestor não tem como pedir o que a view não expõe (migration 031).
    const { data } = await sb.from('team_roster')
        .select('id,name,role,dept,status,avatar_url,avatar_color,contract_type,work_load')
        .eq('manager_id', myEmployeeId)
        .order('name');
    teamMembers = data || [];

    if (!teamMembers.length) {
        $('section-not-manager')?.classList.remove('hidden');
        $('team-content')?.classList.add('hidden');
        return;
    }
    $('section-not-manager')?.classList.add('hidden');
    $('team-content')?.classList.remove('hidden');

    await Promise.all([loadPendingVacations(), loadTeamBalances()]);
    renderTeamGrid();
    renderPendingList();
}

// ─── Saldo de banco de horas do mês corrente por liderado ────────────────
// Antes, o gestor só via solicitações pontuais de ajuste — não tinha ideia do
// saldo corrente de cada pessoa do time. Mesmo cálculo/limiar já usado em
// alertas.js (risco composto) e banco-horas-rh.js, reimplementado aqui porque
// o projeto não tem módulo compartilhado entre telas.

function getJornadaMin(emp) {
    const tipo = (emp?.contract_type || 'clt').toLowerCase();
    if (tipo === 'pj') return null;
    if (tipo === 'estagio' || tipo === 'estágio' || tipo === 'aprendiz') return 6 * 60;
    const workLoad = emp?.work_load || '';
    if (workLoad === '12x36') return 12 * 60;
    const m = workLoad.match(/^(\d+)h/);
    if (m) return Math.round((parseInt(m[1], 10) / 5) * 60);
    return 8 * 60;
}

function diffMinEquipe(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }

function calcWorkedMinEquipe(rec) {
    if (!rec.entrada) return 0;
    if (rec.saida_almoco) {
        const morning   = diffMinEquipe(rec.entrada, rec.saida_almoco);
        const afternoon = (rec.retorno_almoco && rec.saida) ? diffMinEquipe(rec.retorno_almoco, rec.saida) : 0;
        return morning + afternoon;
    }
    return rec.saida ? diffMinEquipe(rec.entrada, rec.saida) : 0;
}

async function loadTeamBalances() {
    const ids = teamMembers.map(m => m.id);
    teamBalances = {};
    if (!ids.length) return;

    const now = new Date();
    const monthKey   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = `${monthKey}-01`;
    const nextMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthEnd   = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const [{ data: timeData }, { data: bankData }] = await Promise.all([
        sb.from('time_records').select('employee_id,entrada,saida_almoco,retorno_almoco,saida').in('employee_id', ids).gte('date', monthStart).lt('date', monthEnd),
        sb.from('bank_adjustments').select('employee_id,tipo,minutos').in('employee_id', ids).is('deleted_at', null).gte('date', monthStart).lt('date', monthEnd),
    ]);

    const timeByEmp = {};
    (timeData || []).forEach(r => { (timeByEmp[r.employee_id] ??= []).push(r); });
    const adjByEmp = {};
    (bankData || []).forEach(a => { (adjByEmp[a.employee_id] ??= []).push(a); });

    teamMembers.forEach(m => {
        const jornadaMin = getJornadaMin(m);
        if (jornadaMin === null) { teamBalances[m.id] = null; return; }
        let saldo = 0;
        (timeByEmp[m.id] || []).forEach(rec => { if (rec.entrada && rec.saida) saldo += calcWorkedMinEquipe(rec) - jornadaMin; });
        (adjByEmp[m.id] || []).forEach(a => { saldo += a.tipo === 'credito' ? a.minutos : -a.minutos; });
        teamBalances[m.id] = saldo;
    });
}

function minToStrEquipe(min) { const abs = Math.abs(min); return `${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, '0')}min`; }

function saldoBadgeHtml(employeeId) {
    const saldo = teamBalances[employeeId];
    if (saldo === undefined) return '';
    if (saldo === null) return `<span class="team-card-saldo">PJ</span>`;
    const cls  = saldo > 0 ? 'positivo' : saldo < 0 ? 'negativo' : '';
    const sign = saldo > 0 ? '+' : saldo < 0 ? '-' : '';
    return `<span class="team-card-saldo ${cls}" title="Saldo de banco de horas no mês corrente">${sign}${minToStrEquipe(saldo)} <small>(mês)</small></span>`;
}

async function loadPendingVacations() {
    const ids = teamMembers.map(m => m.id);
    if (!ids.length) { pendingVacations = []; return; }
    const { data } = await sb.from('vacations')
        .select('*')
        .in('employee_id', ids)
        .eq('status', 'pendente')
        .order('created_at', { ascending: false });
    pendingVacations = data || [];
}

function avatarStyle(m) {
    if (m.avatar_url) return `background:url(${m.avatar_url}) center/cover`;
    return `background:${m.avatar_color || '#6366f1'}`;
}

function renderTeamGrid() {
    const grid = $('team-grid');
    if (!grid) return;
    $('team-count-label').textContent = `${teamMembers.length} colaborador${teamMembers.length > 1 ? 'es' : ''}`;

    const badgeMap = { 'Ativo': 'ativo', 'Férias': 'ferias', 'Inativo': 'inativo' };
    grid.innerHTML = teamMembers.map(m => `
        <div class="team-card">
            <div class="team-card-avatar" style="${avatarStyle(m)}">${m.avatar_url ? '' : escHtml(getInitials(m.name))}</div>
            <div class="team-card-body">
                <p class="team-card-name">${escHtml(m.name)}</p>
                <p class="team-card-meta">${escHtml(m.role || '—')} · ${escHtml(m.dept || '—')}</p>
                ${saldoBadgeHtml(m.id)}
            </div>
            <div class="team-card-side">
                <span class="team-card-badge team-card-badge--${badgeMap[m.status] || 'ativo'}">${escHtml(m.status || 'Ativo')}</span>
                <button class="team-card-escalate" onclick="openEscalateModal('${m.id}')" title="Escalar ao RH sobre ${escHtml(m.name)}">
                    <i class="fas fa-flag"></i>
                </button>
            </div>
        </div>`).join('');
}

function renderPendingList() {
    const list = $('pending-list');
    if (!list) return;
    $('pending-count-label').textContent = pendingVacations.length
        ? `${pendingVacations.length} pendente${pendingVacations.length > 1 ? 's' : ''}`
        : '';

    if (!pendingVacations.length) {
        $('pending-wrap').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-circle-check"></i>
                <p>Nenhuma solicitação pendente</p>
                <span>As férias do seu time aprovadas ou recusadas pelo RH também aparecem aqui até você decidir.</span>
            </div>`;
        return;
    }

    list.innerHTML = pendingVacations.map(v => {
        const emp = teamMembers.find(m => m.id === v.employee_id);
        return `
        <div class="solicitacao-item">
            <div class="sol-icon"><i class="fas fa-umbrella-beach"></i></div>
            <div class="sol-info">
                <p class="sol-tipo">${escHtml(emp?.name || '—')} <span class="sol-dept">(${escHtml(emp?.dept || '—')})</span></p>
                <p class="sol-meta">${fmtBR(v.start_date)} → ${fmtBR(v.end_date)} · ${v.days} dias${v.abono ? ' · Abono pecuniário' : ''}</p>
                ${v.obs ? `<p class="sol-meta">${escHtml(v.obs)}</p>` : ''}
            </div>
            <div class="aprovacao-actions">
                <button class="btn-approve" onclick="approveVacation('${v.id}')" title="Aprovar"><i class="fas fa-check"></i></button>
                <button class="btn-reject" onclick="openRejectModal('${v.id}')" title="Recusar"><i class="fas fa-xmark"></i></button>
            </div>
        </div>`;
    }).join('');
}

window.approveVacation = async function (id) {
    const { error } = await sb.from('vacations').update({
        status: 'aprovado', approved_at: new Date().toISOString(),
        decided_by_name: myEmployee.name, decided_by_email: myEmployee.email,
    }).eq('id', id);
    if (error) { showToast('Não foi possível aprovar. Tente novamente.', 'error'); return; }
    pendingVacations = pendingVacations.filter(v => v.id !== id);
    renderPendingList();
    showToast('Férias aprovadas!', 'success');
};

window.openRejectModal = function (id) {
    rejectingId = id;
    $('reject-reason-text').value = '';
    $('err-reject-reason').textContent = '';
    $('modal-reject-vacation')?.classList.add('open');
};

window.closeRejectModal = function () {
    $('modal-reject-vacation')?.classList.remove('open');
};

window.confirmRejectVacation = async function () {
    const reason = $('reject-reason-text')?.value.trim();
    if (!reason) { $('err-reject-reason').textContent = 'Informe o motivo da recusa.'; return; }

    const { error } = await sb.from('vacations').update({
        status: 'recusado', rejection_reason: reason, rejected_at: new Date().toISOString(),
        decided_by_name: myEmployee.name, decided_by_email: myEmployee.email,
    }).eq('id', rejectingId);
    if (error) { showToast('Não foi possível recusar. Tente novamente.', 'error'); return; }

    pendingVacations = pendingVacations.filter(v => v.id !== rejectingId);
    renderPendingList();
    closeRejectModal();
    showToast('Solicitação recusada.', 'info');
};

// ─── Escalar ao RH sobre um liderado específico ────────────────────────────
// Antes, o gestor só tinha o chat geral (mesmo canal de qualquer colaborador)
// para levar algo ao RH — sem nenhum vínculo formal de "isto é sobre fulano".
// Reaproveita a infraestrutura de hr_tickets (SLA/CSAT já existentes), só
// marcando about_employee_id e pulando o bot: já entra direto como
// 'aguardando_rh', porque é uma escalação deliberada, não uma dúvida.

window.openEscalateModal = function (employeeId) {
    escalatingId = employeeId;
    const emp = teamMembers.find(m => m.id === employeeId);
    $('escalate-employee-name').textContent = emp?.name || '—';
    $('escalate-message-text').value = '';
    $('err-escalate-message').textContent = '';
    $('modal-escalate-rh')?.classList.add('open');
};

window.closeEscalateModal = function () {
    $('modal-escalate-rh')?.classList.remove('open');
};

window.confirmEscalateToRh = async function () {
    const message = $('escalate-message-text')?.value.trim();
    if (!message) { $('err-escalate-message').textContent = 'Descreva o que você quer levar ao RH.'; return; }

    const emp = teamMembers.find(m => m.id === escalatingId);
    const { data: ticket, error } = await sb.from('hr_tickets').insert({
        employee_id: myEmployeeId,
        about_employee_id: escalatingId,
        subject: `Sobre ${emp?.name || 'colaborador do time'}`,
        status: 'aguardando_rh',
    }).select().single();

    if (error || !ticket) { showToast('Não foi possível enviar. Tente novamente.', 'error'); return; }

    await sb.from('hr_ticket_messages').insert({
        ticket_id: ticket.id, employee_id: myEmployeeId, role: 'user', content: message,
    });

    closeEscalateModal();
    showToast('Encaminhado ao RH!', 'success');
};

function setupRealtimeSync() {
    sb.channel('equipe-colab')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vacations' }, async () => {
            await loadPendingVacations();
            renderPendingList();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employees', filter: `manager_id=eq.${myEmployeeId}` }, async () => {
            await loadTeam();
        })
        .subscribe();
}

window.logout = async function () {
    await sb.auth.signOut();
    window.location.href = '../screens/login.html';
};

function showToast(msg, type = 'success') {
    const container = $('toast-container');
    if (!container) return;
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<div class="toast-icon"><i class="fas ${icons[type] || 'fa-check'}"></i></div><div class="toast-content"><p class="toast-title">${escHtml(msg)}</p></div><button class="toast-close" onclick="this.closest('.toast').remove()"><i class="fas fa-times"></i></button>`;
    container.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 300); }, 4000);
}
