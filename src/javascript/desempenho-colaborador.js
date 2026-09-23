let myEmployeeId = null;
let myEmployeeRole = null;
let reviews = [];
let reviewCompetencies = {};
let goals = [];

const GOAL_STATUS_LABEL = { pendente: 'Pendente', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado' };
const GOAL_NEXT_STATUS = { pendente: 'em_andamento', em_andamento: 'concluido' };
const GOAL_NEXT_LABEL = { pendente: 'Iniciar', em_andamento: 'Concluir' };

document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('colaborador', '*');
    if (!auth) return;
    myEmployeeId = auth.profile.employee_id;
    myEmployeeRole = auth.employee?.role || null;

    await loadCareerTrack();
    renderCareerTrack();
    await loadData();
    renderReviews();
    renderGoals();
    await loadTrainings();
    renderTrainings();
    await loadDisciplinaryActions();
    renderDisciplinaryActions();
    setupDateFields();
    await loadMedicalLeaves();
    renderMedicalLeaves();
});

let jobTitlesPublic = [];

const CAREER_LEVEL_ORDER = ['Aprendizagem', 'Estágio', 'Operacional', 'Júnior', 'Pleno', 'Sênior', 'Especialista', 'Coordenação', 'Gerência', 'Diretoria'];

async function loadCareerTrack() {
    const { data } = await sb.rpc('job_titles_public');
    jobTitlesPublic = data || [];
}

function careerLevelRank(level) {
    const i = CAREER_LEVEL_ORDER.indexOf(level);
    return i === -1 ? CAREER_LEVEL_ORDER.length : i;
}

function buildCareerTrackGroups(titles, currentRole) {
    const groups = new Map();
    for (const t of titles) {
        const key = t.track || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
    }
    return [...groups.entries()].map(([track, group]) => ({
        track,
        rows: [...group]
            .sort((a, b) => careerLevelRank(a.level) - careerLevelRank(b.level) || a.title.localeCompare(b.title))
            .map((t) => ({ ...t, isCurrent: !!currentRole && t.title === currentRole })),
    }));
}

function renderCareerTrack() {
    const wrap = document.getElementById('career-track-list');
    if (!wrap) return;
    if (!jobTitlesPublic.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-route"></i><p>O RH ainda não cadastrou o catálogo de cargos.</p></div>`;
        return;
    }

    wrap.innerHTML = buildCareerTrackGroups(jobTitlesPublic, myEmployeeRole)
        .map(({ track, rows }) => {
            const rowsHtml = rows
                .map(
                    (t) => `<div class="career-level-row${t.isCurrent ? ' career-level-row--current' : ''}">
                        <div class="career-level-info">
                            <span class="career-level-title">${escapeHtml(t.title)}</span>
                            ${t.level ? `<span class="career-level-tag">${escapeHtml(t.level)}</span>` : ''}
                        </div>
                        ${t.isCurrent ? `<span class="career-current-badge"><i class="fas fa-map-marker-alt"></i> Você está aqui</span>` : ''}
                    </div>`
                )
                .join('');
            return `<div class="career-track-group">
                ${track ? `<p class="career-track-name">${escapeHtml(track)}</p>` : ''}
                ${rowsHtml}
            </div>`;
        })
        .join('');

    if (myEmployeeRole && !jobTitlesPublic.some((t) => t.title === myEmployeeRole)) {
        wrap.insertAdjacentHTML(
            'beforeend',
            `<p class="pdi-goal-meta">Seu cargo atual (${escapeHtml(myEmployeeRole)}) não está neste catálogo — fale com o RH se achar que deveria estar.</p>`
        );
    }
}

async function loadData() {
    const [{ data: reviewData }, { data: goalData }] = await Promise.all([
        sb
            .from('performance_reviews')
            .select('id,cycle,status,overall_rating,manager_comment,created_at,completed_at')
            .eq('employee_id', myEmployeeId)
            .order('created_at', { ascending: false }),
        sb
            .from('pdi_goals')
            .select('id,title,description,due_date,status,created_at')
            .eq('employee_id', myEmployeeId)
            .order('created_at', { ascending: false }),
    ]);
    reviews = reviewData || [];
    goals = goalData || [];

    if (reviews.length) {
        const { data: compData } = await sb
            .from('performance_review_competencies')
            .select('review_id,competency,rating')
            .in(
                'review_id',
                reviews.map((r) => r.id)
            );
        reviewCompetencies = {};
        (compData || []).forEach((c) => {
            (reviewCompetencies[c.review_id] ??= []).push(c);
        });
    }
}

function starString(rating) {
    if (!rating) return '—';
    return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function fmtDateBR(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
}

function renderReviews() {
    const wrap = document.getElementById('reviews-list');
    if (!wrap) return;
    if (!reviews.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-star"></i><p>Nenhuma avaliação.</p></div>`;
        return;
    }
    wrap.innerHTML = reviews
        .map((r) => {
            const comps = reviewCompetencies[r.id] || [];
            const compsHtml = comps
                .map(
                    (c) =>
                        `<div class="review-competency-row"><span class="review-competency-label">${escapeHtml(c.competency)}</span><span class="review-competency-stars">${starString(c.rating)}</span></div>`
                )
                .join('');
            const commentHtml = r.manager_comment ? `<p class="review-comment">${escapeHtml(r.manager_comment)}</p>` : '';
            return `<div class="review-card" id="review-card-${r.id}">
                <div class="review-card-header" data-click="toggleReviewCard" data-click-args="${dargs(r.id)}">
                    <div class="review-card-info">
                        <span class="review-card-cycle">${escapeHtml(r.cycle)}</span>
                        <span class="review-card-meta">Concluída em ${fmtDateBR(r.completed_at || r.created_at)}</span>
                    </div>
                    <span class="review-card-stars">${starString(r.overall_rating)}</span>
                    <i class="fas fa-chevron-down review-card-chevron"></i>
                </div>
                <div class="review-card-detail">
                    ${compsHtml || `<p class="pdi-goal-meta">Sem competências detalhadas nesta avaliação.</p>`}
                    ${commentHtml}
                </div>
            </div>`;
        })
        .join('');
}

window.toggleReviewCard = function (reviewId) {
    document.getElementById(`review-card-${reviewId}`)?.classList.toggle('open');
};

function renderGoals() {
    const wrap = document.getElementById('goals-list');
    if (!wrap) return;
    if (!goals.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-bullseye"></i><p>Nenhuma meta cadastrada.</p></div>`;
        return;
    }
    wrap.innerHTML = goals
        .map((g) => {
            const label = GOAL_STATUS_LABEL[g.status] || g.status;
            const due = g.due_date ? ` · prazo ${fmtDateBR(g.due_date)}` : '';
            const desc = g.description ? `<span class="pdi-goal-desc">${escapeHtml(g.description)}</span>` : '';
            const nextLabel = GOAL_NEXT_LABEL[g.status];
            const advanceBtn = nextLabel
                ? `<button type="button" class="goal-advance-btn" data-click="advanceGoal" data-click-args="${dargs(g.id, g.status)}">${nextLabel}</button>`
                : '';
            return `<div class="pdi-goal-item">
                <div class="pdi-goal-info">
                    <span class="pdi-goal-title">${escapeHtml(g.title)}</span>
                    ${desc}
                    <span class="pdi-goal-meta">${label}${due}</span>
                </div>
                <span class="goal-status-badge goal-status-badge--${g.status}">${label}</span>
                ${advanceBtn}
            </div>`;
        })
        .join('');
}

window.advanceGoal = async function (goalId, currentStatus) {
    const next = GOAL_NEXT_STATUS[currentStatus];
    if (!next) return;
    const { error } = await sb.from('pdi_goals').update({ status: next }).eq('id', goalId);
    if (error) {
        showToast('Não foi possível atualizar a meta.', 'error');
        return;
    }
    const goal = goals.find((g) => g.id === goalId);
    if (goal) goal.status = next;
    renderGoals();
    showToast(next === 'concluido' ? 'Meta concluída!' : 'Meta iniciada!', 'success');
};

const TRAINING_STATUS_LABEL = {
    pendente: 'Pendente',
    em_andamento: 'Em andamento',
    concluido: 'Concluído',
    aguardando_aprovacao: 'Aguardando aprovação',
    recusado: 'Recusado',
    cancelado: 'Cancelado',
};

let trainings = [];

async function loadTrainings() {
    const { data } = await sb
        .from('employee_trainings')
        .select('id,title,category,provider,hours,source,status,completion_date,certificate_url,certificate_path,created_at')
        .eq('employee_id', myEmployeeId)
        .order('created_at', { ascending: false });
    trainings = data || [];
}

function renderTrainings() {
    const wrap = document.getElementById('trainings-list');
    if (!wrap) return;
    if (!trainings.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-graduation-cap"></i><p>Nenhum treinamento registrado ainda.</p></div>`;
        return;
    }
    wrap.innerHTML = trainings
        .map((t) => {
            const label = TRAINING_STATUS_LABEL[t.status] || t.status;
            const bits = [t.category, t.provider, t.hours ? `${t.hours}h` : null, t.source === 'autodeclarado' ? 'Autodeclarado' : null].filter(Boolean);
            if (t.certificate_url) bits.push(`<a href="${escapeHtml(t.certificate_url)}" target="_blank" rel="noopener">Certificado</a>`);
            if (t.certificate_path)
                bits.push(
                    `<button type="button" class="training-cert-link" data-click="viewTrainingCertificate" data-click-args="${dargs(t.id)}"><i class="fas fa-paperclip"></i> Certificado anexado</button>`
                );
            const withdrawBtn =
                t.source === 'autodeclarado' && t.status === 'aguardando_aprovacao'
                    ? `<button type="button" class="training-withdraw-btn" data-click="withdrawTraining" data-click-args="${dargs(t.id)}">Retirar</button>`
                    : '';
            return `<div class="pdi-goal-item">
                <div class="pdi-goal-info">
                    <span class="pdi-goal-title">${escapeHtml(t.title)}</span>
                    <span class="pdi-goal-meta">${bits.join(' · ') || '—'}</span>
                </div>
                <span class="goal-status-badge goal-status-badge--${t.status}">${label}</span>
                ${withdrawBtn}
            </div>`;
        })
        .join('');
}

window.selfReportTraining = async function () {
    const button = document.getElementById('tr-self-submit');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
        await selfReportTrainingSubmit();
    } finally {
        refreshSubmitButtons();
    }
};

async function selfReportTrainingSubmit() {
    const title = document.getElementById('tr-self-title')?.value.trim();
    if (!title) {
        showToast('Informe o nome do curso.', 'error');
        return;
    }
    const hoursRaw = document.getElementById('tr-self-hours')?.value.trim();
    const hours = hoursRaw ? Number(hoursRaw.replace(',', '.')) : null;
    if (hoursRaw && (Number.isNaN(hours) || hours < 0)) {
        showToast('Carga horária inválida.', 'error');
        return;
    }
    const certificateUrl = document.getElementById('tr-self-cert')?.value.trim() || null;
    const file = document.getElementById('tr-self-file')?.files?.[0] || null;
    if (!file) {
        showToast('Anexe o certificado (imagem ou PDF).', 'error');
        return;
    }
    if (!isValidAttachment(file, 'certificado')) return;

    const certificatePath = `${myEmployeeId}/certificados/${Date.now()}_${NexusFiles.safeName(file.name)}`;
    const { error: uploadError } = await NexusFiles.upload('documents', certificatePath, file, { contentType: file.type, employeeId: myEmployeeId });
    if (uploadError) {
        showToast('Não foi possível enviar o certificado.', 'error');
        return;
    }

    const { error } = await sb.from('employee_trainings').insert({
        employee_id: myEmployeeId,
        title,
        hours,
        certificate_url: certificateUrl,
        certificate_path: certificatePath,
        source: 'autodeclarado',
        status: 'aguardando_aprovacao',
    });
    if (error) {
        await sb.storage.from('documents').remove([certificatePath]);
        showToast('Não foi possível registrar o curso.', 'error');
        return;
    }
    document.getElementById('tr-self-title').value = '';
    document.getElementById('tr-self-hours').value = '';
    document.getElementById('tr-self-cert').value = '';
    clearFilePicker('tr-self-file');
    await loadTrainings();
    renderTrainings();
    showToast('Curso enviado para aprovação do RH!', 'success');
}

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const FILE_PICKERS = {
    'tr-self-file': { label: 'Anexar certificado *', hint: 'Imagem ou PDF, até 10 MB', kind: 'certificado' },
    'ml-file': { label: 'Anexar atestado *', hint: 'Imagem ou PDF, até 10 MB', kind: 'atestado' },
};

function isValidAttachment(file, kind) {
    if (!ATTACHMENT_TYPES.includes(file.type)) {
        showToast(`Envie o ${kind} em imagem (JPG, PNG, WEBP) ou PDF.`, 'error');
        return false;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
        showToast(`O ${kind} deve ter no máximo 10 MB.`, 'error');
        return false;
    }
    return true;
}

function pickFile(id) {
    const file = document.getElementById(id)?.files?.[0];
    if (!file || !isValidAttachment(file, FILE_PICKERS[id].kind)) return clearFilePicker(id);
    const sizeKb = file.size / 1024;
    const size = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(sizeKb))} KB`;
    document.getElementById(`${id}-name`).textContent = file.name;
    document.getElementById(`${id}-hint`).textContent = `${file.type === 'application/pdf' ? 'PDF' : 'Imagem'} · ${size}`;
    document.getElementById(`${id}-box`)?.classList.add('has-file');
    document.getElementById(`${id}-clear`)?.classList.remove('hidden');
    refreshSubmitButtons();
}

function clearFilePicker(id) {
    const input = document.getElementById(id);
    if (input) input.value = '';
    document.getElementById(`${id}-name`).textContent = FILE_PICKERS[id].label;
    document.getElementById(`${id}-hint`).textContent = FILE_PICKERS[id].hint;
    document.getElementById(`${id}-box`)?.classList.remove('has-file');
    document.getElementById(`${id}-clear`)?.classList.add('hidden');
    refreshSubmitButtons();
}

function hasFile(id) {
    return Boolean(document.getElementById(id)?.files?.length);
}

function refreshSubmitButtons() {
    const trainingBtn = document.getElementById('tr-self-submit');
    if (trainingBtn) trainingBtn.disabled = !(document.getElementById('tr-self-title')?.value.trim() && hasFile('tr-self-file'));
    const leaveBtn = document.getElementById('ml-submit');
    if (leaveBtn) leaveBtn.disabled = !(getDateFieldValue('ml-start-date') && getDateFieldValue('ml-end-date') && hasFile('ml-file'));
}
window.refreshSubmitButtons = refreshSubmitButtons;

window.pickTrainingFile = () => pickFile('tr-self-file');
window.clearTrainingFile = () => clearFilePicker('tr-self-file');
window.pickLeaveFile = () => pickFile('ml-file');
window.clearLeaveFile = () => clearFilePicker('ml-file');

window.viewTrainingCertificate = async function (id) {
    const training = trainings.find((t) => t.id === id);
    if (!training?.certificate_path) return;
    const { error } = await NexusFiles.open('documents', training.certificate_path, { name: 'Certificado' });
    if (error) showToast('Não foi possível abrir o certificado.', 'error');
};

window.withdrawTraining = async function (id) {
    const training = trainings.find((t) => t.id === id);
    const { error } = await sb.from('employee_trainings').delete().eq('id', id);
    if (error) {
        showToast('Não foi possível retirar o registro.', 'error');
        return;
    }
    if (training?.certificate_path) await sb.storage.from('documents').remove([training.certificate_path]);
    await loadTrainings();
    renderTrainings();
    showToast('Registro retirado.', 'success');
};

const DISCIPLINARY_TYPE_LABEL = { advertencia_verbal: 'Advertência Verbal', advertencia_escrita: 'Advertência Escrita', suspensao: 'Suspensão' };

let disciplinaryActions = [];

async function loadDisciplinaryActions() {
    const { data } = await sb
        .from('disciplinary_actions')
        .select('id,type,reason,description,suspension_days,occurred_at,acknowledged_at')
        .eq('employee_id', myEmployeeId)
        .order('occurred_at', { ascending: false });
    disciplinaryActions = data || [];
}

function renderDisciplinaryActions() {
    const wrap = document.getElementById('disciplinary-list');
    if (!wrap) return;
    if (!disciplinaryActions.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-gavel"></i><p>Nenhuma medida disciplinar registrada.</p></div>`;
        return;
    }
    wrap.innerHTML = disciplinaryActions
        .map((d) => {
            const label = DISCIPLINARY_TYPE_LABEL[d.type] || d.type;
            const bits = [fmtDateBR(d.occurred_at), d.suspension_days ? `${d.suspension_days} dia${d.suspension_days > 1 ? 's' : ''}` : null].filter(Boolean);
            const ackBtn = d.acknowledged_at
                ? `<span class="disciplinary-ack-done"><i class="fas fa-check"></i> Ciente em ${fmtDateBR(d.acknowledged_at.slice(0, 10))}</span>`
                : `<button type="button" class="disciplinary-ack-btn" data-click="acknowledgeDisciplinary" data-click-args="${dargs(d.id)}">Dar ciência</button>`;
            return `<div class="pdi-goal-item">
                <div class="pdi-goal-info">
                    <span class="pdi-goal-title">${escapeHtml(d.reason)}</span>
                    ${d.description ? `<span class="pdi-goal-desc">${escapeHtml(d.description)}</span>` : ''}
                    <span class="pdi-goal-meta">${bits.join(' · ')}</span>
                </div>
                <span class="disciplinary-type-badge disciplinary-type-badge--${d.type}">${label}</span>
                ${ackBtn}
            </div>`;
        })
        .join('');
}

window.acknowledgeDisciplinary = async function (id) {
    const { error } = await sb.from('disciplinary_actions').update({ acknowledged_at: new Date().toISOString() }).eq('id', id);
    if (error) {
        showToast('Não foi possível registrar sua ciência.', 'error');
        return;
    }
    await loadDisciplinaryActions();
    renderDisciplinaryActions();
    showToast('Ciência registrada!', 'success');
};

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function setDateFieldValue(input, iso) {
    if (!input) return;
    input.dataset.value = iso || '';
    if (iso) {
        const [y, m, d] = iso.split('-');
        input.value = `${d}/${m}/${y}`;
    } else {
        input.value = '';
    }
    refreshSubmitButtons();
}

function getDateFieldValue(id) {
    return document.getElementById(id)?.dataset.value || '';
}

function initDateField(field) {
    const input = field.querySelector('.date-input');
    const popover = field.querySelector('.calendar-popover');
    const titleEl = field.querySelector('[data-cal-title]');
    const gridEl = field.querySelector('[data-cal-grid]');
    const prevBtn = field.querySelector('[data-cal-prev]');
    const nextBtn = field.querySelector('[data-cal-next]');
    if (!input || !popover) return;

    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();

    function syncViewToValue() {
        const iso = input.dataset.value;
        if (iso) {
            const [y, m] = iso.split('-').map(Number);
            viewYear = y;
            viewMonth = m - 1;
        } else {
            viewYear = today.getFullYear();
            viewMonth = today.getMonth();
        }
    }

    function render() {
        titleEl.textContent = `${MESES_PT[viewMonth]} ${viewYear}`;
        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
        const selectedIso = input.dataset.value || '';

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            cells.push({ day: d, muted: false, isToday, iso, selected: iso === selectedIso });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map((c) => {
                if (c.muted) return `<button type="button" class="calendar-day calendar-day--muted" disabled>${c.day}</button>`;
                const cls = ['calendar-day'];
                if (c.isToday) cls.push('calendar-day--today');
                if (c.selected) cls.push('calendar-day--selected');
                return `<button type="button" class="${cls.join(' ')}" data-iso="${c.iso}">${c.day}</button>`;
            })
            .join('');
    }

    function open() {
        syncViewToValue();
        render();
        popover.classList.add('open');
        field.classList.add('active');
    }
    function close() {
        popover.classList.remove('open');
        field.classList.remove('active');
    }

    input.addEventListener('click', () => (popover.classList.contains('open') ? close() : open()));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            popover.classList.contains('open') ? close() : open();
        }
    });
    field.querySelector('.date-field-icon')?.addEventListener('click', () => (popover.classList.contains('open') ? close() : open()));

    prevBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
    });
    nextBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
    });

    gridEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.calendar-day');
        if (!btn || btn.disabled) return;
        setDateFieldValue(input, btn.getAttribute('data-iso'));
        close();
    });

    document.addEventListener('click', (e) => {
        if (!field.contains(e.target)) close();
    });
}

function setupDateFields() {
    document.querySelectorAll('.date-field').forEach(initDateField);
}

const LEAVE_STATUS_LABEL = { pendente: 'Pendente', aprovado: 'Aprovado', recusado: 'Recusado' };

let medicalLeaves = [];

async function loadMedicalLeaves() {
    const { data } = await sb
        .from('medical_leaves')
        .select('id,start_date,end_date,days,doctor_name,cid,status,rejection_reason,storage_path')
        .eq('employee_id', myEmployeeId)
        .order('start_date', { ascending: false });
    medicalLeaves = data || [];
}

function renderMedicalLeaves() {
    const wrap = document.getElementById('medical-leaves-list');
    if (!wrap) return;
    if (!medicalLeaves.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-file-medical"></i><p>Nenhum atestado enviado.</p></div>`;
        return;
    }
    wrap.innerHTML = medicalLeaves
        .map((l) => {
            const label = LEAVE_STATUS_LABEL[l.status] || l.status;
            const bits = [`${l.days} dia${l.days > 1 ? 's' : ''}`, l.doctor_name ? `Dr(a). ${l.doctor_name}` : null, l.cid ? `CID ${l.cid}` : null].filter(
                Boolean
            );
            const withdrawBtn =
                l.status === 'pendente'
                    ? `<button type="button" class="training-withdraw-btn" data-click="withdrawLeave" data-click-args="${dargs(l.id)}">Retirar</button>`
                    : '';
            const rejection =
                l.status === 'recusado' && l.rejection_reason ? `<span class="pdi-goal-desc">Motivo: ${escapeHtml(l.rejection_reason)}</span>` : '';
            return `<div class="pdi-goal-item">
                <div class="pdi-goal-info">
                    <span class="pdi-goal-title">${fmtDateBR(l.start_date)} → ${fmtDateBR(l.end_date)}</span>
                    <span class="pdi-goal-meta">${bits.join(' · ')}</span>
                    ${rejection}
                </div>
                <span class="goal-status-badge goal-status-badge--${l.status === 'aprovado' ? 'concluido' : l.status}">${label}</span>
                ${withdrawBtn}
            </div>`;
        })
        .join('');
}

window.selfReportLeave = async function () {
    const button = document.getElementById('ml-submit');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
        await selfReportLeaveSubmit();
    } finally {
        refreshSubmitButtons();
    }
};

async function selfReportLeaveSubmit() {
    const startDate = getDateFieldValue('ml-start-date');
    const endDate = getDateFieldValue('ml-end-date');
    if (!startDate || !endDate) {
        showToast('Informe o período do atestado.', 'error');
        return;
    }
    if (endDate < startDate) {
        showToast('A data final não pode ser antes do início.', 'error');
        return;
    }
    const doctorName = document.getElementById('ml-doctor-name')?.value.trim() || null;
    const cid = document.getElementById('ml-cid')?.value.trim() || null;
    const fileInput = document.getElementById('ml-file');
    const file = fileInput?.files?.[0] || null;
    if (!file) {
        showToast('Anexe o atestado (imagem ou PDF).', 'error');
        return;
    }
    if (!isValidAttachment(file, 'atestado')) return;

    const storagePath = `${myEmployeeId}/atestados/${Date.now()}_${NexusFiles.safeName(file.name)}`;
    const { error: uploadError } = await NexusFiles.upload('documents', storagePath, file, { contentType: file.type, employeeId: myEmployeeId });
    if (uploadError) {
        showToast('Não foi possível enviar o anexo.', 'error');
        return;
    }

    const { error } = await sb.from('medical_leaves').insert({
        employee_id: myEmployeeId,
        start_date: startDate,
        end_date: endDate,
        doctor_name: doctorName,
        cid,
        storage_path: storagePath,
    });
    if (error) {
        await sb.storage.from('documents').remove([storagePath]);
        showToast('Não foi possível enviar o atestado.', 'error');
        return;
    }

    setDateFieldValue(document.getElementById('ml-start-date'), '');
    setDateFieldValue(document.getElementById('ml-end-date'), '');
    document.getElementById('ml-doctor-name').value = '';
    document.getElementById('ml-cid').value = '';
    clearFilePicker('ml-file');
    await loadMedicalLeaves();
    renderMedicalLeaves();
    showToast('Atestado enviado para aprovação do RH!', 'success');
}

window.withdrawLeave = async function (id) {
    const leave = medicalLeaves.find((l) => l.id === id);
    const { error } = await sb.from('medical_leaves').delete().eq('id', id);
    if (error) {
        showToast('Não foi possível retirar o atestado.', 'error');
        return;
    }
    if (leave?.storage_path) await sb.storage.from('documents').remove([leave.storage_path]);
    await loadMedicalLeaves();
    renderMedicalLeaves();
    showToast('Atestado retirado.', 'success');
};

function showToast(msg, type = 'success') {
    const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
        <div class="toast-content">
            <p class="toast-title">${escapeHtml(msg)}</p>
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
        loadCareerTrack,
        buildCareerTrackGroups,
        fmtDateBR,
        starString,
        __setStateForTest(next) {
            if ('myEmployeeId' in next) myEmployeeId = next.myEmployeeId;
            if ('myEmployeeRole' in next) myEmployeeRole = next.myEmployeeRole;
        },
        __getStateForTest() {
            return { jobTitlesPublic };
        },
    };
}
