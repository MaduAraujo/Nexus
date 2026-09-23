let myEmployeeId = null;
let myEmployee = null;
let teamMembers = [];
let pendingVacations = [];
let rejectingId = null;
let teamBalances = {};
let escalatingId = null;

const $ = (id) => document.getElementById(id);

const getInitials = (name) =>
    (name || '?')
        .split(' ')
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || '')
        .join('');
const escHtml = (str) =>
    String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
const fmtBR = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};

document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('colaborador', '*');
    if (!auth) return;
    myEmployeeId = auth.profile.employee_id;
    myEmployee = auth.employee;

    trAssignCatalogField = createSelectField('tr-assign-catalog');

    await loadTeam();
    await fetchTrainingsCatalogPublic();
    setupPdiGoalDatePicker();
    setupRealtimeSync();
});

async function loadTeam() {
    const { data } = await sb
        .from('team_roster')
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

function diffMinEquipe(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 60000);
}

function calcWorkedMinEquipe(rec) {
    if (!rec.entrada) return 0;
    if (rec.saida_almoco) {
        const morning = diffMinEquipe(rec.entrada, rec.saida_almoco);
        const afternoon = rec.retorno_almoco && rec.saida ? diffMinEquipe(rec.retorno_almoco, rec.saida) : 0;
        return morning + afternoon;
    }
    return rec.saida ? diffMinEquipe(rec.entrada, rec.saida) : 0;
}

async function loadTeamBalances() {
    const ids = teamMembers.map((m) => m.id);
    teamBalances = {};
    if (!ids.length) return;

    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthStart = `${monthKey}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const [{ data: timeData }, { data: bankData }] = await Promise.all([
        sb
            .from('time_records')
            .select('employee_id,entrada,saida_almoco,retorno_almoco,saida')
            .in('employee_id', ids)
            .gte('date', monthStart)
            .lt('date', monthEnd),
        sb
            .from('bank_adjustments')
            .select('employee_id,tipo,minutos')
            .in('employee_id', ids)
            .is('deleted_at', null)
            .gte('date', monthStart)
            .lt('date', monthEnd),
    ]);

    const timeByEmp = {};
    (timeData || []).forEach((r) => {
        (timeByEmp[r.employee_id] ??= []).push(r);
    });
    const adjByEmp = {};
    (bankData || []).forEach((a) => {
        (adjByEmp[a.employee_id] ??= []).push(a);
    });

    teamMembers.forEach((m) => {
        const jornadaMin = getJornadaMin(m);
        if (jornadaMin === null) {
            teamBalances[m.id] = null;
            return;
        }
        let saldo = 0;
        (timeByEmp[m.id] || []).forEach((rec) => {
            if (rec.entrada && rec.saida) saldo += calcWorkedMinEquipe(rec) - jornadaMin;
        });
        (adjByEmp[m.id] || []).forEach((a) => {
            saldo += a.tipo === 'credito' ? a.minutos : -a.minutos;
        });
        teamBalances[m.id] = saldo;
    });
}

function minToStrEquipe(min) {
    const abs = Math.abs(min);
    return `${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, '0')}min`;
}

function saldoBadgeHtml(employeeId) {
    const saldo = teamBalances[employeeId];
    if (saldo === undefined) return '';
    if (saldo === null) return `<span class="team-card-saldo">PJ</span>`;
    const cls = saldo > 0 ? 'positivo' : saldo < 0 ? 'negativo' : '';
    const sign = saldo > 0 ? '+' : saldo < 0 ? '-' : '';
    return `<span class="team-card-saldo ${cls}" title="Saldo de banco de horas no mês corrente">${sign}${minToStrEquipe(saldo)} <small>(mês)</small></span>`;
}

async function loadPendingVacations() {
    const ids = teamMembers.map((m) => m.id);
    if (!ids.length) {
        pendingVacations = [];
        return;
    }
    const { data } = await sb.from('vacations').select('*').in('employee_id', ids).eq('status', 'pendente').order('created_at', { ascending: false });
    pendingVacations = data || [];
}

function avatarAttrs(m) {
    if (m.avatar_url) return `data-bg-img="${escHtml(m.avatar_url)}"`;
    return `data-bg="${escHtml(m.avatar_color || '#6366f1')}"`;
}

function renderTeamGrid() {
    const grid = $('team-grid');
    if (!grid) return;

    const badgeMap = { Ativo: 'ativo', Férias: 'ferias', Inativo: 'inativo' };
    grid.innerHTML = teamMembers
        .map(
            (m) => `
        <div class="team-card">
            <div class="team-card-avatar" ${avatarAttrs(m)}>${m.avatar_url ? '' : escHtml(getInitials(m.name))}</div>
            <div class="team-card-body">
                <p class="team-card-name">${escHtml(m.name)}</p>
                <p class="team-card-meta">${escHtml(m.role || '—')} · ${escHtml(m.dept || '—')}</p>
                ${saldoBadgeHtml(m.id)}
            </div>
            <span class="team-card-badge team-card-badge--${badgeMap[m.status] || 'ativo'}">${escHtml(m.status || 'Ativo')}</span>
            <div class="team-card-actions">
                <button class="team-card-evaluate" data-click="openPerformanceModal" data-click-args="${dargs(m.id)}" title="Avaliação de desempenho de ${escHtml(m.name)}">
                    <i class="fas fa-chart-line"></i>
                </button>
                <button class="team-card-trainings" data-click="openTrainingsModal" data-click-args="${dargs(m.id)}" title="Treinamentos de ${escHtml(m.name)}">
                    <i class="fas fa-graduation-cap"></i>
                </button>
                <button class="team-card-disciplinary" data-click="openDisciplinaryModal" data-click-args="${dargs(m.id)}" title="Processos disciplinares de ${escHtml(m.name)}">
                    <i class="fas fa-gavel"></i>
                </button>
                <button class="team-card-medical" data-click="openMedicalLeavesModal" data-click-args="${dargs(m.id)}" title="Atestados de ${escHtml(m.name)}">
                    <i class="fas fa-file-medical"></i>
                </button>
                <button class="team-card-escalate" data-click="openEscalateModal" data-click-args="${dargs(m.id)}" title="Escalar ao RH sobre ${escHtml(m.name)}">
                    <i class="fas fa-flag"></i>
                </button>
            </div>
        </div>`
        )
        .join('');
}

function renderPendingList() {
    const list = $('pending-list');
    if (!list) return;
    $('pending-count-label').textContent = pendingVacations.length ? `${pendingVacations.length} pendente${pendingVacations.length > 1 ? 's' : ''}` : '';

    if (!pendingVacations.length) {
        $('pending-wrap').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-circle-check"></i>
                <p>Nenhuma solicitação pendente</p>
            </div>`;
        return;
    }

    list.innerHTML = pendingVacations
        .map((v) => {
            const emp = teamMembers.find((m) => m.id === v.employee_id);
            return `
        <div class="solicitacao-item">
            <div class="sol-icon"><i class="fas fa-umbrella-beach"></i></div>
            <div class="sol-info">
                <p class="sol-tipo">${escHtml(emp?.name || '—')} <span class="sol-dept">(${escHtml(emp?.dept || '—')})</span></p>
                <p class="sol-meta">${fmtBR(v.start_date)} → ${fmtBR(v.end_date)} · ${v.days} dias${v.abono ? ' · Abono pecuniário' : ''}</p>
                ${v.obs ? `<p class="sol-meta">${escHtml(v.obs)}</p>` : ''}
            </div>
            <div class="aprovacao-actions">
                <button class="btn-approve" data-click="approveVacation" data-click-args="${dargs(v.id)}" title="Aprovar"><i class="fas fa-check"></i></button>
                <button class="btn-reject" data-click="openRejectModal" data-click-args="${dargs(v.id)}" title="Recusar"><i class="fas fa-xmark"></i></button>
            </div>
        </div>`;
        })
        .join('');
}

window.approveVacation = async function (id) {
    const { error } = await sb
        .from('vacations')
        .update({
            status: 'aprovado',
            approved_at: new Date().toISOString(),
            decided_by_name: myEmployee.name,
            decided_by_email: myEmployee.email,
        })
        .eq('id', id);
    if (error) {
        showToast('Não foi possível aprovar. Tente novamente.', 'error');
        return;
    }
    pendingVacations = pendingVacations.filter((v) => v.id !== id);
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
    if (!reason) {
        $('err-reject-reason').textContent = 'Informe o motivo da recusa.';
        return;
    }

    const { error } = await sb
        .from('vacations')
        .update({
            status: 'recusado',
            rejection_reason: reason,
            rejected_at: new Date().toISOString(),
            decided_by_name: myEmployee.name,
            decided_by_email: myEmployee.email,
        })
        .eq('id', rejectingId);
    if (error) {
        showToast('Não foi possível recusar. Tente novamente.', 'error');
        return;
    }

    pendingVacations = pendingVacations.filter((v) => v.id !== rejectingId);
    renderPendingList();
    closeRejectModal();
    showToast('Solicitação recusada.', 'info');
};

window.openEscalateModal = function (employeeId) {
    escalatingId = employeeId;
    const emp = teamMembers.find((m) => m.id === employeeId);
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
    if (!message) {
        $('err-escalate-message').textContent = 'Descreva o que você quer levar ao RH.';
        return;
    }

    const emp = teamMembers.find((m) => m.id === escalatingId);
    const { data: ticket, error } = await sb
        .from('hr_tickets')
        .insert({
            employee_id: myEmployeeId,
            about_employee_id: escalatingId,
            subject: `Sobre ${emp?.name || 'colaborador do time'}`,
            status: 'aguardando_rh',
        })
        .select()
        .single();

    if (error || !ticket) {
        showToast('Não foi possível enviar. Tente novamente.', 'error');
        return;
    }

    await sb.from('hr_ticket_messages').insert({
        ticket_id: ticket.id,
        employee_id: myEmployeeId,
        role: 'user',
        content: message,
    });

    closeEscalateModal();
    showToast('Encaminhado ao RH!', 'success');
};

const PERFORMANCE_COMPETENCIES = ['Qualidade do trabalho', 'Produtividade', 'Comunicação', 'Trabalho em equipe', 'Proatividade'];
const GOAL_STATUS_LABEL = { pendente: 'Pendente', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado' };

let performanceEmployeeId = null;
let performanceReviews = [];
let performanceGoals = [];
let overallRatingWidget = null;
let competencyWidgets = [];

async function fetchPerformanceData(employeeId) {
    const [{ data: reviews }, { data: goals }] = await Promise.all([
        sb
            .from('performance_reviews')
            .select('id,cycle,status,overall_rating,manager_comment,created_at,completed_at')
            .eq('employee_id', employeeId)
            .order('created_at', { ascending: false }),
        sb.from('pdi_goals').select('id,title,description,due_date,status,created_at').eq('employee_id', employeeId).order('created_at', { ascending: false }),
    ]);
    performanceReviews = reviews || [];
    performanceGoals = goals || [];
}

function renderPerformanceReviews() {
    const wrap = $('performance-reviews-list');
    if (!wrap) return;
    if (!performanceReviews.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhuma avaliação registrada ainda.</p>`;
        return;
    }
    wrap.innerHTML = performanceReviews
        .map((r) => {
            const stars = r.overall_rating ? '★'.repeat(r.overall_rating) + '☆'.repeat(5 - r.overall_rating) : '—';
            const statusLabel = r.status === 'concluida' ? 'Concluída' : 'Rascunho';
            const completeBtn =
                r.status === 'rascunho'
                    ? `<button type="button" class="review-complete-btn" data-click="completeReview" data-click-args="${dargs(r.id)}">Concluir</button>`
                    : '';
            return `<div class="performance-review-item">
                <div class="performance-review-info">
                    <span class="performance-review-cycle">${escHtml(r.cycle)}</span>
                    <span class="performance-review-meta">${stars} · ${fmtBR(r.created_at.slice(0, 10))}</span>
                </div>
                <span class="review-status-badge review-status-badge--${r.status}">${statusLabel}</span>
                ${completeBtn}
            </div>`;
        })
        .join('');
}

function renderPerformanceGoals() {
    const wrap = $('performance-goals-list');
    if (!wrap) return;
    if (!performanceGoals.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhuma meta de desenvolvimento cadastrada.</p>`;
        return;
    }
    wrap.innerHTML = performanceGoals
        .map((g) => {
            const label = GOAL_STATUS_LABEL[g.status] || g.status;
            const due = g.due_date ? ` · prazo ${fmtBR(g.due_date)}` : '';
            return `<div class="pdi-goal-item">
                <div class="pdi-goal-info">
                    <span class="pdi-goal-title">${escHtml(g.title)}</span>
                    <span class="pdi-goal-meta">${label}${due}</span>
                </div>
                <span class="goal-status-badge goal-status-badge--${g.status}">${label}</span>
            </div>`;
        })
        .join('');
}

window.openPerformanceModal = async function (employeeId) {
    const emp = teamMembers.find((m) => m.id === employeeId);
    if (!emp) return;
    performanceEmployeeId = employeeId;
    const nameEl = $('performance-emp-name');
    if (nameEl) nameEl.textContent = emp.name;
    const reviewsList = $('performance-reviews-list');
    if (reviewsList) reviewsList.innerHTML = `<p class="performance-empty">Carregando…</p>`;
    const goalsList = $('performance-goals-list');
    if (goalsList) goalsList.innerHTML = '';
    $('modal-performance')?.classList.add('open');

    await fetchPerformanceData(employeeId);
    renderPerformanceReviews();
    renderPerformanceGoals();
};

window.closePerformanceModal = function () {
    $('modal-performance')?.classList.remove('open');
};

window.completeReview = async function (reviewId) {
    const { error } = await sb.from('performance_reviews').update({ status: 'concluida', completed_at: new Date().toISOString() }).eq('id', reviewId);
    if (error) {
        showToast('Não foi possível concluir a avaliação.', 'error');
        return;
    }
    await fetchPerformanceData(performanceEmployeeId);
    renderPerformanceReviews();
    showToast('Avaliação concluída!', 'success');
};

function createRatingWidget(containerId) {
    const el = $(containerId);
    if (!el) return null;
    el.innerHTML = Array.from(
        { length: 5 },
        (_, i) => `<button type="button" class="rating-star" data-value="${i + 1}"><i class="fas fa-star"></i></button>`
    ).join('');
    function setValue(v) {
        el.dataset.rating = v;
        el.querySelectorAll('.rating-star').forEach((btn) => btn.classList.toggle('filled', Number(btn.dataset.value) <= v));
    }
    el.addEventListener('click', (e) => {
        const btn = e.target.closest('.rating-star');
        if (!btn) return;
        setValue(Number(btn.dataset.value));
    });
    setValue(0);
    return { setValue, getValue: () => Number(el.dataset.rating || 0) };
}

window.openReviewFormModal = function () {
    if (!performanceEmployeeId) return;
    const cycleInput = $('review-cycle');
    const commentInput = $('review-comment');
    const err = $('err-review-cycle');
    if (cycleInput) cycleInput.value = '';
    if (commentInput) commentInput.value = '';
    if (err) err.textContent = '';
    overallRatingWidget = createRatingWidget('rating-overall');

    const compWrap = $('rating-competencies');
    if (compWrap) {
        compWrap.innerHTML = PERFORMANCE_COMPETENCIES.map(
            (c, i) =>
                `<div class="competency-row"><span class="competency-label">${escHtml(c)}</span><div class="rating-widget" id="rating-comp-${i}"></div></div>`
        ).join('');
    }
    competencyWidgets = PERFORMANCE_COMPETENCIES.map((_, i) => createRatingWidget(`rating-comp-${i}`));

    $('modal-performance-review-form')?.classList.add('open');
};

window.closeReviewFormModal = function () {
    $('modal-performance-review-form')?.classList.remove('open');
};

window.submitReview = async function (status) {
    const cycle = $('review-cycle')?.value.trim();
    if (!cycle) {
        const err = $('err-review-cycle');
        if (err) err.textContent = 'Informe o ciclo (ex.: 1º Semestre 2026).';
        return;
    }
    const overall = overallRatingWidget?.getValue() || null;
    const comment = $('review-comment')?.value.trim() || null;

    const { data: review, error } = await sb
        .from('performance_reviews')
        .insert({
            employee_id: performanceEmployeeId,
            cycle,
            status,
            overall_rating: overall,
            manager_comment: comment,
            evaluator_name: myEmployee?.name || null,
            evaluator_email: myEmployee?.email || null,
            completed_at: status === 'concluida' ? new Date().toISOString() : null,
        })
        .select('id')
        .single();
    if (error || !review) {
        showToast('Não foi possível salvar a avaliação.', 'error');
        return;
    }

    const compRows = PERFORMANCE_COMPETENCIES.map((c, i) => ({
        review_id: review.id,
        competency: c,
        rating: competencyWidgets[i]?.getValue() || null,
    })).filter((r) => r.rating);
    if (compRows.length) await sb.from('performance_review_competencies').insert(compRows);

    window.closeReviewFormModal();
    await fetchPerformanceData(performanceEmployeeId);
    renderPerformanceReviews();
    showToast(status === 'concluida' ? 'Avaliação concluída!' : 'Rascunho salvo.', 'success');
};

window.addPdiGoal = async function () {
    const titleInput = $('pdi-goal-title');
    const title = titleInput?.value.trim();
    if (!title || !performanceEmployeeId) return;
    const dueDate = $('pdi-goal-due')?.value || null;

    const { error } = await sb.from('pdi_goals').insert({
        employee_id: performanceEmployeeId,
        title,
        due_date: dueDate,
        created_by_name: myEmployee?.name || null,
    });
    if (error) {
        showToast('Não foi possível criar a meta.', 'error');
        return;
    }
    titleInput.value = '';
    window.setPdiGoalDue?.('');
    await fetchPerformanceData(performanceEmployeeId);
    renderPerformanceGoals();
    showToast('Meta adicionada!', 'success');
};

const TRAINING_STATUS_LABEL = {
    pendente: 'Pendente',
    em_andamento: 'Em andamento',
    concluido: 'Concluído',
    aguardando_aprovacao: 'Aguardando aprovação',
    recusado: 'Recusado',
    cancelado: 'Cancelado',
};

let trainingsCatalogPublic = [];
let trainingsEmployeeId = null;
let employeeTrainings = [];
let trAssignCatalogField = null;

async function fetchTrainingsCatalogPublic() {
    const { data } = await sb.from('trainings').select('id,title,category,duration_hours').eq('active', true).order('title');
    trainingsCatalogPublic = data || [];
}

async function fetchEmployeeTrainings(employeeId) {
    const { data } = await sb
        .from('employee_trainings')
        .select('id,title,category,provider,hours,source,status,completion_date,certificate_url,notes,assigned_by_name,created_at')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });
    employeeTrainings = data || [];
}

function renderTrainingsList() {
    const wrap = $('trainings-list');
    if (!wrap) return;
    if (!employeeTrainings.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhum treinamento registrado ainda.</p>`;
        return;
    }
    wrap.innerHTML = employeeTrainings
        .map((t) => {
            const label = TRAINING_STATUS_LABEL[t.status] || t.status;
            const bits = [t.category, t.provider, t.hours ? `${t.hours}h` : null, t.source === 'autodeclarado' ? 'Autodeclarado' : null].filter(Boolean);
            if (t.certificate_url) bits.push(`<a href="${escHtml(t.certificate_url)}" target="_blank" rel="noopener">Certificado</a>`);
            let actions = '';
            if (t.status === 'aguardando_aprovacao') {
                actions = `<button type="button" class="training-action-btn training-action-btn--approve" data-click="approveTraining" data-click-args="${dargs(t.id)}">Aprovar</button>
                    <button type="button" class="training-action-btn training-action-btn--reject" data-click="rejectTraining" data-click-args="${dargs(t.id)}">Recusar</button>`;
            } else if (t.status === 'pendente' || t.status === 'em_andamento') {
                actions = `<button type="button" class="training-action-btn training-action-btn--complete" data-click="completeTraining" data-click-args="${dargs(t.id)}">Concluir</button>`;
            }
            return `<div class="training-item">
                <div class="training-info">
                    <span class="training-title">${escHtml(t.title)}</span>
                    <span class="training-meta">${bits.join(' · ') || '—'}</span>
                </div>
                <span class="goal-status-badge goal-status-badge--${t.status}">${label}</span>
                ${actions}
            </div>`;
        })
        .join('');
}

window.openTrainingsModal = async function (employeeId) {
    const emp = teamMembers.find((m) => m.id === employeeId);
    if (!emp) return;
    trainingsEmployeeId = employeeId;
    const nameEl = $('trainings-emp-name');
    if (nameEl) nameEl.textContent = emp.name;
    $('trainings-list').innerHTML = `<p class="performance-empty">Carregando…</p>`;
    $('tr-assign-title').value = '';
    $('tr-assign-hours').value = '';
    trAssignCatalogField?.setValue('');
    $('modal-trainings')?.classList.add('open');

    const popover = $('tr-assign-catalog-popover');
    if (popover) {
        popover.innerHTML = trainingsCatalogPublic
            .map((t) => `<button type="button" class="select-option" role="option" data-value="${t.id}">${escHtml(t.title)}</button>`)
            .join('');
    }

    await fetchEmployeeTrainings(employeeId);
    renderTrainingsList();
};

window.closeTrainingsModal = function () {
    $('modal-trainings')?.classList.remove('open');
};

window.assignTraining = async function () {
    if (!trainingsEmployeeId) return;
    const catalogId = $('tr-assign-catalog')?.value || null;
    const catalogEntry = catalogId ? trainingsCatalogPublic.find((t) => t.id === catalogId) : null;
    const typedTitle = $('tr-assign-title')?.value.trim();
    const title = catalogEntry?.title || typedTitle;
    if (!title) {
        showToast('Escolha um treinamento do catálogo ou digite o nome.', 'error');
        return;
    }
    const hoursRaw = $('tr-assign-hours')?.value.trim();
    const hours = hoursRaw ? Number(hoursRaw.replace(',', '.')) : catalogEntry?.duration_hours || null;

    const { error } = await sb.from('employee_trainings').insert({
        employee_id: trainingsEmployeeId,
        training_id: catalogEntry?.id || null,
        title,
        category: catalogEntry?.category || null,
        hours,
        assigned_by_name: myEmployee?.name || null,
    });
    if (error) {
        showToast('Não foi possível atribuir o treinamento.', 'error');
        return;
    }
    $('tr-assign-title').value = '';
    $('tr-assign-hours').value = '';
    trAssignCatalogField?.setValue('');
    await fetchEmployeeTrainings(trainingsEmployeeId);
    renderTrainingsList();
    showToast('Treinamento atribuído!', 'success');
};

window.approveTraining = async function (id) {
    const { error } = await sb
        .from('employee_trainings')
        .update({ status: 'concluido', completion_date: new Date().toISOString().slice(0, 10) })
        .eq('id', id);
    if (error) {
        showToast('Não foi possível aprovar o treinamento.', 'error');
        return;
    }
    await fetchEmployeeTrainings(trainingsEmployeeId);
    renderTrainingsList();
    showToast('Treinamento aprovado!', 'success');
};

window.rejectTraining = async function (id) {
    const { error } = await sb.from('employee_trainings').update({ status: 'recusado' }).eq('id', id);
    if (error) {
        showToast('Não foi possível recusar o treinamento.', 'error');
        return;
    }
    await fetchEmployeeTrainings(trainingsEmployeeId);
    renderTrainingsList();
    showToast('Treinamento recusado.', 'success');
};

window.completeTraining = async function (id) {
    const { error } = await sb
        .from('employee_trainings')
        .update({ status: 'concluido', completion_date: new Date().toISOString().slice(0, 10) })
        .eq('id', id);
    if (error) {
        showToast('Não foi possível concluir o treinamento.', 'error');
        return;
    }
    await fetchEmployeeTrainings(trainingsEmployeeId);
    renderTrainingsList();
    showToast('Treinamento concluído!', 'success');
};

const DISCIPLINARY_TYPE_LABEL = { advertencia_verbal: 'Advertência Verbal', advertencia_escrita: 'Advertência Escrita', suspensao: 'Suspensão' };

let disciplinaryActions = [];

async function fetchDisciplinaryActions(employeeId) {
    const { data } = await sb
        .from('disciplinary_actions')
        .select('id,type,reason,description,suspension_days,occurred_at,acknowledged_at')
        .eq('employee_id', employeeId)
        .order('occurred_at', { ascending: false });
    disciplinaryActions = data || [];
}

function renderDisciplinaryList() {
    const wrap = $('disciplinary-list');
    if (!wrap) return;
    if (!disciplinaryActions.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhuma medida disciplinar registrada.</p>`;
        return;
    }
    wrap.innerHTML = disciplinaryActions
        .map((d) => {
            const label = DISCIPLINARY_TYPE_LABEL[d.type] || d.type;
            const bits = [fmtBR(d.occurred_at), d.suspension_days ? `${d.suspension_days} dia${d.suspension_days > 1 ? 's' : ''}` : null].filter(Boolean);
            const ack = d.acknowledged_at
                ? `<span class="disciplinary-ack-badge disciplinary-ack-badge--done"><i class="fas fa-check"></i> Ciente em ${fmtBR(d.acknowledged_at.slice(0, 10))}</span>`
                : `<span class="disciplinary-ack-badge disciplinary-ack-badge--pending"><i class="fas fa-clock"></i> Aguardando ciência</span>`;
            return `<div class="disciplinary-item">
                <div class="disciplinary-info">
                    <span class="disciplinary-title">${escHtml(d.reason)}</span>
                    <span class="disciplinary-meta">${bits.join(' · ')}${d.description ? ' · ' + escHtml(d.description) : ''}</span>
                </div>
                <div class="disciplinary-badges">
                    <span class="disciplinary-type-badge disciplinary-type-badge--${d.type}">${label}</span>
                    ${ack}
                </div>
            </div>`;
        })
        .join('');
}

window.openDisciplinaryModal = async function (employeeId) {
    const emp = teamMembers.find((m) => m.id === employeeId);
    if (!emp) return;
    const nameEl = $('disciplinary-emp-name');
    if (nameEl) nameEl.textContent = emp.name;
    $('disciplinary-list').innerHTML = `<p class="performance-empty">Carregando…</p>`;
    $('modal-disciplinary')?.classList.add('open');

    await fetchDisciplinaryActions(employeeId);
    renderDisciplinaryList();
};

window.closeDisciplinaryModal = function () {
    $('modal-disciplinary')?.classList.remove('open');
};

const LEAVE_STATUS_LABEL = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' };

function renderMedicalLeavesList(leaves) {
    const wrap = $('medical-leaves-list');
    if (!wrap) return;
    if (!leaves.length) {
        wrap.innerHTML = `<p class="performance-empty">Nenhum atestado registrado ainda.</p>`;
        return;
    }
    wrap.innerHTML = leaves
        .map((l) => {
            const label = LEAVE_STATUS_LABEL[l.status] || l.status;
            return `<div class="leave-item">
                <div class="leave-info">
                    <span class="leave-title">${fmtBR(l.start_date)} → ${fmtBR(l.end_date)}</span>
                    <span class="leave-meta">${l.days} dia${l.days > 1 ? 's' : ''}</span>
                </div>
                <span class="leave-status-badge leave-status-badge--${l.status}">${label}</span>
            </div>`;
        })
        .join('');
}

window.openMedicalLeavesModal = async function (employeeId) {
    const emp = teamMembers.find((m) => m.id === employeeId);
    if (!emp) return;
    const nameEl = $('ml-emp-name');
    if (nameEl) nameEl.textContent = emp.name;
    $('medical-leaves-list').innerHTML = `<p class="performance-empty">Carregando…</p>`;
    $('modal-medical-leaves')?.classList.add('open');

    const { data } = await sb.rpc('medical_leaves_team');
    renderMedicalLeavesList((data || []).filter((l) => l.employee_id === employeeId));
};

window.closeMedicalLeavesModal = function () {
    $('modal-medical-leaves')?.classList.remove('open');
};

function createSelectField(id, onChange) {
    const trigger = $(`${id}-trigger`);
    const popover = $(`${id}-popover`);
    const label = $(`${id}-label`);
    const hidden = $(id);
    if (!trigger || !popover || !label || !hidden) return null;

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

    function setValue(value) {
        const opts = Array.from(popover.querySelectorAll('.select-option'));
        const opt = opts.find((o) => o.dataset.value === String(value));
        hidden.value = opt ? opt.dataset.value : '';
        label.textContent = opt ? opt.textContent : 'Catálogo';
        label.classList.toggle('select-placeholder', !opt);
        opts.forEach((o) => o.classList.toggle('selected', o === opt));
        close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });
    popover.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('.select-option');
        if (!btn) return;
        setValue(btn.dataset.value);
        onChange?.();
    });

    return { setValue };
}

function setupPdiGoalDatePicker() {
    const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const trigger = $('pdi-goal-due-trigger');
    const popover = $('pdi-goal-due-popover');
    const textEl = $('pdi-goal-due-text');
    const titleEl = $('pdi-goal-due-title');
    const gridEl = $('pdi-goal-due-grid');
    const prevBtn = $('pdi-goal-due-prev');
    const nextBtn = $('pdi-goal-due-next');
    const hidden = $('pdi-goal-due');
    if (!trigger || !popover || !textEl || !gridEl || !hidden) return;

    const pad = (n) => String(n).padStart(2, '0');
    const today = new Date();
    let viewYear = today.getFullYear(),
        viewMonth = today.getMonth();

    function setValue(dateStr) {
        hidden.value = dateStr || '';
        textEl.textContent = dateStr ? fmtBR(dateStr) : 'Prazo';
        textEl.classList.toggle('date-trigger-placeholder', !dateStr);
        close();
    }
    function render() {
        titleEl.textContent = `${MESES[viewMonth]} ${viewYear}`;
        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`;
            cells.push({
                day: d,
                muted: false,
                iso,
                isToday: d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear(),
            });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });
        gridEl.innerHTML = cells
            .map(
                (c) =>
                    `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}" ${c.muted ? 'disabled' : `data-iso="${c.iso}"`}>${c.day}</button>`
            )
            .join('');
    }
    function open() {
        const [y, m] = (hidden.value || '').split('-').map(Number);
        viewYear = y || today.getFullYear();
        viewMonth = m ? m - 1 : today.getMonth();
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
    popover.addEventListener('click', (e) => e.stopPropagation());
    gridEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.calendar-day[data-iso]');
        if (!btn) return;
        setValue(btn.dataset.iso);
    });
    prevBtn?.addEventListener('click', () => {
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
    });
    nextBtn?.addEventListener('click', () => {
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
    });

    window.setPdiGoalDue = setValue;
}

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
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
    const container = $('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${escHtml(msg)}</p>
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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadTeam,
        loadPendingVacations,
        loadTeamBalances,
        getJornadaMin,
        calcWorkedMinEquipe,
        minToStrEquipe,
        saldoBadgeHtml,
        getInitials,
        escHtml,
        fmtBR,
        approveVacation: window.approveVacation,
        confirmRejectVacation: window.confirmRejectVacation,
        confirmEscalateToRh: window.confirmEscalateToRh,
        __setStateForTest(next) {
            if ('myEmployeeId' in next) myEmployeeId = next.myEmployeeId;
            if ('myEmployee' in next) myEmployee = next.myEmployee;
            if ('rejectingId' in next) rejectingId = next.rejectingId;
            if ('escalatingId' in next) escalatingId = next.escalatingId;
        },
        __getStateForTest() {
            return { teamMembers, pendingVacations, teamBalances };
        },
    };
}
