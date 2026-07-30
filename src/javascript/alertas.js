let chatHistory = [];
let rhUser = null;
let isLoading = false;
let historyLoaded = false;
let riscoLoaded = false;
let juridicoLoaded = false;
let complianceLoaded = false;
let comunidadeLoaded = false;
let gestoresLoaded = false;

const CATEGORY_ICON = {
    aprovacao: 'fa-check-circle',
    burnout: 'fa-fire',
    ausencia: 'fa-user-clock',
    documentos: 'fa-file-exclamation',
    admissao: 'fa-user-plus',
    geral: 'fa-circle-info',
};

const CATEGORY_PAGE = {
    aprovacao: { href: '../screens/ferias.html', label: 'Ver Férias', icon: 'fa-umbrella-beach' },
    burnout: { href: '../screens/colaboradores.html', label: 'Ver Colaboradores', icon: 'fa-users' },
    ausencia: { href: '../screens/banco-horas-rh.html', label: 'Ver Horas' },
    documentos: { href: '../screens/arquivos.html', label: 'Ver Arquivos', icon: 'fa-folder-open' },
    admissao: { href: '../screens/colaboradores.html', label: 'Ver Colaboradores', icon: 'fa-users' },
    geral: { href: '../screens/dashboard.html', label: 'Ver Dashboard', icon: 'fa-chart-pie' },
};

const CATEGORY_LABEL = {
    aprovacao: 'Aprovação',
    burnout: 'Burnout',
    ausencia: 'Ausência',
    documentos: 'Documentos',
    admissao: 'Admissão',
    geral: 'Geral',
};

const SEV_LABEL = { critical: 'Crítico', warning: 'Atenção', info: 'Info' };

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    setupListeners();
    setupTabs();
    await Promise.all([loadAnalysisCache(), loadChatHistory()]);
});

async function checkAuth() {
    const auth = await NexusAuth.requireProfile('Administrador');
    if (!auth) return;
    rhUser = auth.user;
}

function setupListeners() {
    document.getElementById('btn-analyze')?.addEventListener('click', runAnalysis);

    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-send');

    sendBtn?.addEventListener('click', sendChat);
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChat();
        }
    });
    input?.addEventListener('input', () => {
        if (sendBtn) sendBtn.disabled = !input.value.trim();
    });

    document.getElementById('btn-dismiss-all')?.addEventListener('click', clearAlerts);
    document.getElementById('btn-clear-chat')?.addEventListener('click', clearChatHistory);
    document.getElementById('btn-report')?.addEventListener('click', generateReport);
    document.getElementById('btn-copy-report')?.addEventListener('click', copyReport);
    document.getElementById('report-modal')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeReportModal();
    });

    document.getElementById('chat-suggestions-initial')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.suggestion-chip');
        if (chip) sendSuggestion(chip.textContent.trim());
    });
}

async function callEdgeFunction(payload) {
    const {
        data: { session },
    } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-alerts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
}

async function runAnalysis() {
    if (isLoading) return;
    isLoading = true;
    setAnalyzeBtn(true);
    showAlertsLoading();
    hideInitialChips();

    try {
        const data = await callEdgeFunction({ action: 'analyze' });
        chatHistory = data.history || [];

        let parsed;
        try {
            parsed = JSON.parse(data.content);
        } catch {
            const match = data.content.match(/\{[\s\S]*\}/);
            parsed = match ? JSON.parse(match[0]) : { summary: data.content, alerts: [] };
        }

        parsed.health_score = calcHealthScore(parsed.alerts || []);
        renderAlerts(parsed);
        updateLastAnalysis();
        saveAnalysisCache(parsed.summary, parsed.alerts || [], parsed.health_score).catch(() => {});
        saveToHistory(parsed.summary, parsed.alerts || [], parsed.health_score).catch(() => {});

        appendChatMessage(
            'ai',
            `Análise concluída! Encontrei **${(parsed.alerts || []).length}** alerta(s). Pode me perguntar mais detalhes sobre qualquer item.`
        );
        renderSuggestionChips(parsed.alerts || []);
    } catch (err) {
        showAlertsError(err.message);
        appendChatMessage('ai', `Não foi possível concluir a análise: ${err.message}`);
    } finally {
        isLoading = false;
        setAnalyzeBtn(false);
    }
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    const message = input?.value.trim();
    if (!message || isLoading) return;

    input.value = '';
    document.getElementById('btn-send').disabled = true;
    hideInitialChips();
    appendChatMessage('user', message);
    chatHistory.push({ role: 'user', content: message });
    isLoading = true;

    const container = document.getElementById('chat-messages');
    const bubbleId = 'sb-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message ai';
    msgDiv.innerHTML = `
        <div class="ai-avatar-sm"><i class="fas fa-robot"></i></div>
        <div class="bubble" id="${bubbleId}"><span class="stream-cursor"></span></div>`;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;

    const bubble = document.getElementById(bubbleId);
    let fullText = '';

    try {
        const {
            data: { session },
        } = await sb.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-alerts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.access_token}`,
                apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ action: 'chat', message, history: chatHistory.slice(0, -1) }),
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Erro ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const raw = trimmed.slice(5).trim();
                if (raw === '[DONE]') continue;
                try {
                    const delta = JSON.parse(raw).choices?.[0]?.delta?.content;
                    if (delta) {
                        fullText += delta;
                        if (bubble) {
                            bubble.innerHTML = mdToHtml(fullText) + '<span class="stream-cursor"></span>';
                            container.scrollTop = container.scrollHeight;
                        }
                    }
                } catch {}
            }
        }

        chatHistory.push({ role: 'assistant', content: fullText });
        saveChatMessages(message, fullText).catch(() => {});
    } catch (err) {
        fullText = `Erro ao processar sua pergunta: ${err.message}`;
        chatHistory.push({ role: 'assistant', content: fullText });
    } finally {
        if (bubble) {
            const trimmed = fullText.trim();
            if (trimmed.startsWith('ACTION:')) {
                bubble.closest('.chat-message')?.remove();
                try {
                    showActionConfirmation(JSON.parse(trimmed.slice(7)), message);
                } catch {
                    appendChatMessage('ai', 'Não foi possível processar a ação solicitada.');
                }
            } else {
                bubble.removeAttribute('id');
                bubble.innerHTML = mdToHtml(fullText);
            }
        }
        isLoading = false;
        container.scrollTop = container.scrollHeight;
    }
}

function showActionConfirmation(actionData, originalMessage) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-message ai';
    div.innerHTML = `
        <div class="ai-avatar-sm"><i class="fas fa-robot"></i></div>
        <div class="action-confirm-card">
            <div class="action-confirm-header"><i class="fas fa-bolt"></i> Ação detectada</div>
            <p class="action-confirm-message">${esc(actionData.message)}</p>
            <div class="action-impact-preview hidden"></div>
            <div class="action-confirm-btns">
                <button class="btn-do-action"><i class="fas fa-check"></i> Confirmar</button>
                <button class="btn-cancel-action"><i class="fas fa-times"></i> Cancelar</button>
            </div>
        </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    if (actionData.type === 'reject_adjustment' && actionData.ids?.length) {
        estimateRejectionImpact(actionData.ids)
            .then((impact) => {
                if (!impact) return;
                const impactEl = div.querySelector('.action-impact-preview');
                const detalhe =
                    impact.porEmpregado.length > 1
                        ? impact.porEmpregado.map((p) => `${esc(p.nome)}: ${fmtCurrency(p.valor)}`).join(' · ')
                        : `${impact.porEmpregado[0].semanas} semana${impact.porEmpregado[0].semanas > 1 ? 's' : ''} de DSR perdido`;
                impactEl.classList.remove('hidden');
                impactEl.innerHTML = `<i class="fas fa-triangle-exclamation"></i> <span>Impacto estimado ao rejeitar: <strong>-${fmtCurrency(impact.total)}</strong> (${detalhe} — Lei 605/49 art. 6º).</span>`;
                container.scrollTop = container.scrollHeight;
            })
            .catch(() => {});
    }

    div.querySelector('.btn-do-action').addEventListener('click', async () => {
        const btns = div.querySelector('.action-confirm-btns');
        btns.innerHTML = '<span class="action-status"><i class="fas fa-spinner fa-spin"></i> Executando...</span>';
        const ok = await executeAction(actionData);
        btns.innerHTML = ok
            ? '<span class="action-status ok"><i class="fas fa-check-circle"></i> Concluído!</span>'
            : '<span class="action-status fail"><i class="fas fa-times-circle"></i> Erro ao executar.</span>';
        if (ok) saveChatMessages(originalMessage, `✓ ${actionData.message}`).catch(() => {});
    });
    div.querySelector('.btn-cancel-action').addEventListener('click', () => div.remove());
}

const AI_DECISION_TARGET_TABLE = {
    approve_vacation: 'vacations',
    reject_vacation: 'vacations',
    approve_adjustment: 'adjustment_requests',
    reject_adjustment: 'adjustment_requests',
    mark_burnout_read: 'burnout_alerts',
};

function buildAiDecisionLogRows({ type, evidenceRows, message, decidedByName, decidedByEmail }) {
    const targetTable = AI_DECISION_TARGET_TABLE[type];
    if (!targetTable || !evidenceRows?.length) return [];
    return evidenceRows.map((row) => ({
        employee_id: row.employee_id ?? null,
        target_table: targetTable,
        target_id: row.id,
        action_type: type,
        ai_message: message,
        evidence: row,
        decided_by_name: decidedByName,
        decided_by_email: decidedByEmail,
    }));
}

async function executeAction(actionData) {
    try {
        const { type, ids = [] } = actionData;
        const now = new Date().toISOString();

        const targetTable = AI_DECISION_TARGET_TABLE[type];
        let evidenceRows = [];
        if (targetTable && ids.length) {
            const { data } = await sb.from(targetTable).select('*').in('id', ids);
            evidenceRows = data || [];
        }

        switch (type) {
            case 'approve_vacation':
                await sb.from('vacations').update({ status: 'aprovado', approved_at: now }).in('id', ids);
                break;
            case 'reject_vacation':
                await sb.from('vacations').update({ status: 'recusado', rejected_at: now }).in('id', ids);
                break;
            case 'approve_adjustment':
            case 'reject_adjustment': {
                const decision = type === 'approve_adjustment' ? 'aprovado' : 'rejeitado';
                const results = await Promise.all(
                    ids.map((id) =>
                        sb.rpc('approve_adjustment_request', {
                            p_request_id: id,
                            p_decision: decision,
                            p_decided_by_name: rhUser?.email?.split('@')[0] || 'RH',
                            p_decided_by_email: rhUser?.email || null,
                        })
                    )
                );
                const firstError = results.find((r) => r.error)?.error;
                if (firstError) throw firstError;
                break;
            }
            case 'mark_burnout_read':
                await sb.from('burnout_alerts').update({ lido: true }).in('id', ids);
                break;
            default:
                throw new Error(`Ação desconhecida: ${type}`);
        }
        await sb.from('ai_decision_memory').insert({ action_type: type, description: actionData.message });

        const decisionLogRows = buildAiDecisionLogRows({
            type,
            evidenceRows,
            message: actionData.message,
            decidedByName: rhUser?.email?.split('@')[0] || 'RH',
            decidedByEmail: rhUser?.email || null,
        });
        if (decisionLogRows.length) await sb.from('ai_decision_log').insert(decisionLogRows);

        return true;
    } catch (e) {
        console.error('executeAction:', e);
        return false;
    }
}

function weekStartKeyAlert(dateKey) {
    const d = new Date(`${dateKey}T12:00:00`);
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function estimateRejectionImpact(ids) {
    const { data: reqs } = await sb.from('adjustment_requests').select('id,employee_id,date,tipo').in('id', ids).eq('tipo', 'falta');
    if (!reqs?.length) return null;

    const empIds = [...new Set(reqs.map((r) => r.employee_id))];
    const { data: emps } = await sb.from('employees').select('id,name,salary').in('id', empIds);
    const empMap = {};
    (emps || []).forEach((e) => {
        empMap[e.id] = e;
    });

    let total = 0;
    const porEmpregado = [];
    empIds.forEach((empId) => {
        const semanas = new Set(reqs.filter((r) => r.employee_id === empId).map((r) => weekStartKeyAlert(r.date)));
        if (!semanas.size) return;
        const salario = Number(empMap[empId]?.salary) || 0;
        const valor = +((salario / 30) * semanas.size).toFixed(2);
        total += valor;
        porEmpregado.push({ nome: empMap[empId]?.name || '—', semanas: semanas.size, valor });
    });
    if (!total) return null;
    return { total, porEmpregado };
}

function fmtCurrency(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function generateReport() {
    const btn = document.getElementById('btn-report');
    if (!btn || isLoading) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Gerando...</span>';
    try {
        const data = await callEdgeFunction({ action: 'report' });
        openReportModal(data.content);
    } catch (err) {
        appendChatMessage('ai', `Não foi possível gerar o relatório: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
    }
}

function openReportModal(markdown) {
    const modal = document.getElementById('report-modal');
    const content = document.getElementById('report-content');
    if (!modal || !content) return;
    content.innerHTML = typeof marked !== 'undefined' ? marked.parse(markdown) : markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeReportModal() {
    document.getElementById('report-modal')?.classList.remove('open');
    document.body.style.overflow = '';
}

function copyReport() {
    const content = document.getElementById('report-content');
    if (!content) return;
    navigator.clipboard.writeText(content.innerText).then(() => {
        const btn = document.getElementById('btn-copy-report');
        if (!btn) return;
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copiado!';
        setTimeout(() => {
            btn.innerHTML = orig;
        }, 2000);
    });
}

function renderAlerts({ summary = '', alerts = [], health_score }) {
    const body = document.getElementById('alerts-body');
    const countEl = document.getElementById('severity-counts');
    const dismissEl = document.getElementById('btn-dismiss-all');

    renderHealthScore(health_score);

    if (!alerts.length) {
        body.innerHTML = `
            <div class="empty-state empty-state--success">
                <div class="empty-icon"><i class="fas fa-check-circle"></i></div>
                <p class="empty-title">Tudo em ordem!</p>
                <p class="empty-desc">${esc(summary) || 'Nenhum alerta crítico identificado no momento.'}</p>
            </div>`;
        if (countEl) countEl.innerHTML = '';
        if (dismissEl) dismissEl.style.display = 'none';
        return;
    }

    const critical = alerts.filter((a) => a.severity === 'critical');
    const warning = alerts.filter((a) => a.severity === 'warning');
    const info = alerts.filter((a) => a.severity === 'info');
    const sorted = [...critical, ...warning, ...info];

    let html = `<div class="summary-banner"><i class="fas fa-robot"></i><span>${esc(summary)}</span></div>`;
    for (const a of sorted) html += alertCard(a, alerts.indexOf(a));
    body.innerHTML = html;

    const badges = [];
    if (critical.length) badges.push(`<span class="sev-badge sev-critical">${critical.length} crítico${critical.length > 1 ? 's' : ''}</span>`);
    if (warning.length) badges.push(`<span class="sev-badge sev-warning">${warning.length} atenção</span>`);
    if (info.length) badges.push(`<span class="sev-badge sev-info">${info.length} info</span>`);
    if (countEl) countEl.innerHTML = badges.join('');
    if (dismissEl) dismissEl.style.display = 'inline-flex';

    body.querySelectorAll('.alert-card-dismiss').forEach((btn) => {
        btn.addEventListener('click', () => {
            btn.closest('.alert-card')?.remove();
            if (!body.querySelectorAll('.alert-card').length) clearAlerts();
        });
    });

    body.querySelectorAll('.btn-resolve').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const card = btn.closest('.alert-card');
            const idx = parseInt(card.dataset.idx);
            card.classList.add('resolved');
            const badge = document.createElement('span');
            badge.className = 'resolved-badge';
            badge.innerHTML = '<i class="fas fa-check-circle"></i> Resolvido';
            btn.replaceWith(badge);
            await markAlertResolved(idx);
        });
    });
}

function alertCard(a, idx = 0) {
    const icon = CATEGORY_ICON[a.category] || 'fa-circle-info';
    const label = CATEGORY_LABEL[a.category] || a.category;
    const sev = a.severity || 'info';
    const chips = (a.employees || []).map((n) => `<span class="emp-chip">${esc(n)}</span>`).join('');
    const page = CATEGORY_PAGE[a.category];
    const gotoLink = page
        ? `<a class="alert-goto-link" href="${page.href}">${page.icon ? `<i class="fas ${page.icon}"></i>` : ''}${page.label}<i class="fas fa-arrow-right"></i></a>`
        : '';
    const resolveBtn = a.resolved
        ? `<span class="resolved-badge"><i class="fas fa-check-circle"></i> Resolvido</span>`
        : `<button class="btn-resolve" title="Marcar como resolvido" aria-label="Marcar como resolvido"><i class="fas fa-check"></i></button>`;
    return `
    <div class="alert-card sev-${sev}${a.resolved ? ' resolved' : ''}" data-idx="${idx}">
        <div class="alert-card-header">
            <div class="alert-card-meta">
                <span class="alert-cat-icon"><i class="fas ${icon}"></i></span>
                <span class="alert-cat-label">${esc(label)}</span>
                <span class="alert-sev-badge sev-${sev}">${SEV_LABEL[sev] || sev}</span>
            </div>
            <div class="alert-card-actions">
                ${resolveBtn}
                <button class="alert-card-dismiss" title="Dispensar"><i class="fas fa-times"></i></button>
            </div>
        </div>
        <h4 class="alert-card-title">${esc(a.title)}</h4>
        <p  class="alert-card-desc">${esc(a.description)}</p>
        ${chips ? `<div class="emp-chips">${chips}</div>` : ''}
        <div class="alert-card-footer">
            ${a.action ? `<div class="alert-action"><i class="fas fa-lightbulb"></i>${esc(a.action)}</div>` : ''}
            ${gotoLink}
        </div>
    </div>`;
}

function sendSuggestion(text) {
    const input = document.getElementById('chat-input');
    if (!input || isLoading) return;
    input.value = text;
    document.getElementById('btn-send').disabled = false;
    sendChat();
}

function hideInitialChips() {
    const el = document.getElementById('chat-suggestions-initial');
    if (el) el.style.display = 'none';
}

function renderSuggestionChips(alerts) {
    document.querySelectorAll('.chat-suggestions-dynamic').forEach((el) => el.remove());

    const chips = getDynamicChips(alerts);
    if (!chips.length) return;

    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-suggestions chat-suggestions-dynamic';
    div.innerHTML = chips.map((c) => `<button class="suggestion-chip">${esc(c)}</button>`).join('');
    div.addEventListener('click', (e) => {
        const chip = e.target.closest('.suggestion-chip');
        if (chip) {
            div.remove();
            sendSuggestion(chip.textContent.trim());
        }
    });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function getDynamicChips(alerts) {
    const chips = [];
    const cats = new Set(alerts.map((a) => a.category));
    if (cats.has('aprovacao')) chips.push('Quais aprovações estão mais urgentes?');
    if (cats.has('burnout')) chips.push('Detalhe os riscos de burnout identificados');
    if (cats.has('ausencia')) chips.push('Quem está ausente sem justificativa?');
    if (cats.has('documentos')) chips.push('Quais documentos precisam de revisão?');
    if (cats.has('admissao')) chips.push('Como está o onboarding dos novos colaboradores?');
    chips.push('Qual o alerta mais crítico agora?');
    return chips.slice(0, 4);
}

function appendChatMessage(role, text) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    if (role === 'ai') {
        div.innerHTML = `
            <div class="ai-avatar-sm"><i class="fas fa-robot"></i></div>
            <div class="bubble">${mdToHtml(text)}</div>`;
    } else {
        div.innerHTML = `<div class="bubble">${esc(text)}</div>`;
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function showAlertsLoading() {
    const body = document.getElementById('alerts-body');
    if (body)
        body.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Nexus AI analisando os dados...</p>
        </div>`;
    const countEl = document.getElementById('severity-counts');
    const dismissEl = document.getElementById('btn-dismiss-all');
    if (countEl) countEl.innerHTML = '';
    if (dismissEl) dismissEl.style.display = 'none';
}

function showAlertsError(msg) {
    const body = document.getElementById('alerts-body');
    if (body)
        body.innerHTML = `
        <div class="empty-state empty-state--error">
            <div class="empty-icon"><i class="fas fa-triangle-exclamation"></i></div>
            <p class="empty-title">Erro na análise</p>
            <p class="empty-desc">${esc(msg)}</p>
        </div>`;
}

function clearAlerts() {
    const body = document.getElementById('alerts-body');
    const countEl = document.getElementById('severity-counts');
    const dismissEl = document.getElementById('btn-dismiss-all');
    if (body)
        body.innerHTML = `
        <div class="empty-state" id="empty-state">
            <div class="empty-icon"><i class="fas fa-robot"></i></div>
            <p class="empty-title">Nexus AI pronto</p>
            <p class="empty-desc">Clique em "Analisar Agora" para gerar alertas inteligentes com base nos dados do sistema.</p>
        </div>`;
    if (countEl) countEl.innerHTML = '';
    if (dismissEl) dismissEl.style.display = 'none';
}

function setAnalyzeBtn(loading) {
    const btn = document.getElementById('btn-analyze');
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
        ? '<i class="fas fa-spinner fa-spin"></i><span>Analisando...</span>'
        : '<i class="fas fa-wand-magic-sparkles"></i><span>Analisar Agora</span>';
}

function updateLastAnalysis(date = new Date()) {
    const el = document.getElementById('last-analysis-label');
    if (!el) return;
    const isToday = date.toDateString() === new Date().toDateString();
    el.textContent = `Última análise: ${isToday ? '' : date.toLocaleDateString('pt-BR') + ' '}${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function setupTabs() {
    document.querySelectorAll('.panel-tab').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.panel-tab').forEach((t) => {
        const active = t.dataset.tab === tabName;
        t.classList.toggle('active', active);
        if (active) t.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
    document.getElementById('alerts-body').style.display = tabName === 'alerts' ? '' : 'none';
    document.getElementById('history-body').style.display = tabName === 'history' ? '' : 'none';
    document.getElementById('risco-body').style.display = tabName === 'risco' ? '' : 'none';
    document.getElementById('juridico-body').style.display = tabName === 'juridico' ? '' : 'none';
    document.getElementById('compliance-body').style.display = tabName === 'compliance' ? '' : 'none';
    document.getElementById('comunidade-body').style.display = tabName === 'comunidade' ? '' : 'none';
    document.getElementById('gestores-body').style.display = tabName === 'gestores' ? '' : 'none';
    document.getElementById('alerts-header-right').style.display = tabName === 'alerts' ? '' : 'none';
    if (tabName === 'history' && !historyLoaded) {
        historyLoaded = true;
        loadHistory();
    }
    if (tabName === 'risco' && !riscoLoaded) {
        riscoLoaded = true;
        loadRiscoComposto();
    }
    if (tabName === 'juridico' && !juridicoLoaded) {
        juridicoLoaded = true;
        loadRiscoJuridico();
    }
    if (tabName === 'compliance' && !complianceLoaded) {
        complianceLoaded = true;
        loadCompliance();
    }
    if (tabName === 'comunidade' && !comunidadeLoaded) {
        comunidadeLoaded = true;
        loadComunidade();
    }
    if (tabName === 'gestores' && !gestoresLoaded) {
        gestoresLoaded = true;
        loadGestores();
    }
}

async function saveToHistory(summary, alerts, healthScore) {
    await sb.from('ai_analysis_history').insert({
        summary: summary || '',
        health_score: healthScore ?? null,
        alerts: alerts || [],
        analyzed_at: new Date().toISOString(),
    });
    historyLoaded = false;
}

async function loadHistory() {
    const list = document.getElementById('history-list');
    if (list) list.innerHTML = `<div class="loading-state" style="padding:20px"><div class="loading-spinner"></div><p>Carregando...</p></div>`;
    try {
        const { data } = await sb
            .from('ai_analysis_history')
            .select('id,summary,health_score,alerts,analyzed_at')
            .order('analyzed_at', { ascending: false })
            .limit(20);
        renderHistoryTab(data || []);
    } catch {
        if (list) list.innerHTML = `<p class="history-empty">Erro ao carregar histórico.</p>`;
    }
}

function renderHistoryTab(items) {
    const list = document.getElementById('history-list');
    if (!list) return;
    if (!items.length) {
        list.innerHTML = `<p class="history-empty"><i class="fas fa-chart-line"></i><br>Nenhuma análise registrada ainda.<br>Clique em "Analisar Agora" para começar.</p>`;
        document.querySelector('.trend-chart-wrap').style.display = 'none';
        return;
    }
    document.querySelector('.trend-chart-wrap').style.display = '';
    renderTrendChart(items);
    list.innerHTML = items.map(historyItemHtml).join('');
}

function historyItemHtml(item) {
    const date = new Date(item.analyzed_at);
    const alerts = item.alerts || [];
    const critical = alerts.filter((a) => a.severity === 'critical').length;
    const warning = alerts.filter((a) => a.severity === 'warning').length;
    const info = alerts.filter((a) => a.severity === 'info').length;
    const score = item.health_score;
    const sc = score == null ? '' : score >= 80 ? 'score-green' : score >= 60 ? 'score-yellow' : score >= 40 ? 'score-amber' : 'score-red';
    const badges = [
        critical ? `<span class="sev-badge sev-critical">${critical} crítico${critical > 1 ? 's' : ''}</span>` : '',
        warning ? `<span class="sev-badge sev-warning">${warning} atenção</span>` : '',
        info ? `<span class="sev-badge sev-info">${info} info</span>` : '',
        !alerts.length ? `<span class="sev-badge" style="background:#f0fdf4;color:#15803d">Sem alertas</span>` : '',
    ].join('');
    const rows =
        alerts
            .map(
                (a) => `
        <div class="history-alert-row sev-${a.severity}">
            <i class="fas ${CATEGORY_ICON[a.category] || 'fa-circle-info'}"></i>
            <span>${esc(a.title)}</span>
            ${a.resolved ? '<span class="history-resolved-tag"><i class="fas fa-check"></i> Resolvido</span>' : ''}
        </div>`
            )
            .join('') || `<span style="font-size:.75rem;color:#94a3b8">Sem alertas nesta análise</span>`;
    return `
    <div class="history-item">
        <div class="history-item-header" onclick="this.parentElement.classList.toggle('open')">
            <div class="history-item-meta">
                <span class="history-score ${sc}">${score ?? '—'}</span>
                <div class="history-item-info">
                    <span class="history-date">${formatDate(date)}</span>
                    <div class="history-badges">${badges}</div>
                </div>
            </div>
            <i class="fas fa-chevron-down history-chevron"></i>
        </div>
        <div class="history-item-body">
            <p class="history-summary">${esc(item.summary)}</p>
            <div class="history-alerts-list">${rows}</div>
        </div>
    </div>`;
}

function renderTrendChart(items) {
    const canvas = document.getElementById('trend-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    const sorted = [...items].reverse().slice(-12);
    const labels = sorted.map((h) => {
        const d = new Date(h.analyzed_at);
        return `${d.getDate()}/${d.getMonth() + 1}`;
    });
    const scores = sorted.map((h) => h.health_score ?? null);
    if (window._trendChart) {
        window._trendChart.destroy();
        window._trendChart = null;
    }
    window._trendChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    data: scores,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99,102,241,.07)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: 5,
                    pointBackgroundColor: scores.map((s) =>
                        s == null ? '#e2e8f0' : s >= 80 ? '#22c55e' : s >= 60 ? '#84cc16' : s >= 40 ? '#f59e0b' : '#ef4444'
                    ),
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => ` Score: ${ctx.parsed.y}` } } },
            scales: {
                y: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            },
        },
    });
}

const PESO_SINAL = {
    burnout_critico: 40,
    burnout_atencao: 20,
    burnout_tendencia_critico: 35,
    burnout_tendencia_atencao: 20,
    banco_horas_critico: 35,
    ticket_aguardando: 25,
    ticket_em_atendimento: 15,
};

const BURNOUT_TREND_JANELA_SEMANAS = 6;

function getJornadaMinRisco(emp) {
    const tipo = (emp?.contractType || 'clt').toLowerCase();
    if (tipo === 'pj') return null;
    if (tipo === 'estagio' || tipo === 'estágio' || tipo === 'aprendiz') return 6 * 60;
    const workLoad = emp?.workLoad || '';
    if (workLoad === '12x36') return 12 * 60;
    const m = workLoad.match(/^(\d+)h/);
    if (m) return Math.round((parseInt(m[1], 10) / 5) * 60);
    return 8 * 60;
}

function calcWorkedMinRisco(rec) {
    if (!rec || !rec.entrada) return 0;
    const diffMin = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);
    if (rec.saida_almoco) {
        const m = diffMin(rec.entrada, rec.saida_almoco);
        const a = rec.retorno_almoco && rec.saida ? diffMin(rec.retorno_almoco, rec.saida) : 0;
        return m + a;
    }
    return rec.saida ? diffMin(rec.entrada, rec.saida) : 0;
}

function calcSaldoBancoHorasMes(emp, timeRecords, adjustments, monthKey) {
    const jornadaMin = getJornadaMinRisco(emp);
    if (jornadaMin === null) return null;
    let extrasMin = 0,
        faltaMin = 0;
    Object.entries(timeRecords).forEach(([dateKey, rec]) => {
        if (!dateKey.startsWith(monthKey)) return;
        if (!rec.entrada || !rec.saida) return;
        const saldo = calcWorkedMinRisco(rec) - jornadaMin;
        if (saldo > 0) extrasMin += saldo;
        else faltaMin += Math.abs(saldo);
    });
    let ajusteMin = 0;
    adjustments
        .filter((a) => a.date && a.date.startsWith(monthKey))
        .forEach((a) => {
            ajusteMin += a.tipo === 'credito' ? a.minutos : -a.minutos;
        });
    return extrasMin - faltaMin + ajusteMin;
}

async function loadRiscoComposto() {
    const list = document.getElementById('risco-list');
    if (list) list.innerHTML = `<div class="loading-state" style="padding:20px"><div class="loading-spinner"></div><p>Cruzando sinais...</p></div>`;

    try {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const monthStart = `${monthKey}-01`;
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;
        const trintaDiasAtras = new Date(now.getTime() - 30 * 86400000).toISOString();
        const trendWindowStart = new Date(now.getTime() - BURNOUT_TREND_JANELA_SEMANAS * 7 * 86400000);
        const trendWindowStartKey = `${trendWindowStart.getFullYear()}-${String(trendWindowStart.getMonth() + 1).padStart(2, '0')}-${String(trendWindowStart.getDate()).padStart(2, '0')}`;

        const [{ data: empData }, { data: timeData }, { data: bankData }, { data: burnoutData }, { data: ticketData }, { data: burnoutTrendData }] =
            await Promise.all([
                sb.from('employees').select('id,name,dept,contract_type,work_load').in('status', ['Ativo', 'ativo']),
                sb.from('time_records').select('employee_id,date,entrada,saida_almoco,retorno_almoco,saida').gte('date', monthStart).lt('date', monthEnd),
                sb.from('bank_adjustments').select('employee_id,tipo,minutos,date').is('deleted_at', null).gte('date', monthStart).lt('date', monthEnd),
                sb.from('burnout_alerts').select('employee_id,alertas,lido,created_at').eq('lido', false).gte('created_at', trintaDiasAtras),
                sb.from('hr_tickets').select('employee_id,subject,status').in('status', ['aguardando_rh', 'em_atendimento']),
                // Sem filtro de `lido`: a tendência precisa do histórico completo das últimas N semanas, não só dos alertas ainda não lidos
                sb.from('burnout_alerts').select('employee_id,date,alertas').gte('date', trendWindowStartKey),
            ]);

        const employees = (empData || []).map((e) => ({
            id: e.id,
            name: e.name,
            dept: e.dept,
            contractType: e.contract_type,
            workLoad: e.work_load,
        }));

        const timeByEmp = {};
        (timeData || []).forEach((r) => {
            (timeByEmp[r.employee_id] ??= {})[r.date] = r;
        });

        const adjByEmp = {};
        (bankData || []).forEach((a) => {
            (adjByEmp[a.employee_id] ??= []).push(a);
        });

        const burnoutByEmp = {};
        (burnoutData || []).forEach((b) => {
            const pior = (b.alertas || []).some((x) => x.nivel === 'critico') ? 'critico' : (b.alertas || []).length ? 'atencao' : null;
            if (!pior) return;
            const atual = burnoutByEmp[b.employee_id];
            if (!atual || (pior === 'critico' && atual.nivel !== 'critico')) {
                burnoutByEmp[b.employee_id] = { nivel: pior, titulo: ((b.alertas || [])[0] || {}).titulo || 'Padrão de burnout identificado' };
            }
        });

        const burnoutTrendByEmp = {};
        (burnoutTrendData || []).forEach((row) => {
            (burnoutTrendByEmp[row.employee_id] ??= []).push(row);
        });

        const ticketByEmp = {};
        (ticketData || []).forEach((t) => {
            const atual = ticketByEmp[t.employee_id];
            if (!atual || (t.status === 'aguardando_rh' && atual.status !== 'aguardando_rh')) {
                ticketByEmp[t.employee_id] = t;
            }
        });

        const linhas = employees
            .map((emp) => {
                const sinais = [];
                let score = 0;

                const burnout = burnoutByEmp[emp.id];
                if (burnout) {
                    sinais.push({ tipo: 'burnout', nivel: burnout.nivel, label: `Burnout ${burnout.nivel === 'critico' ? 'crítico' : 'em atenção'}` });
                    score += burnout.nivel === 'critico' ? PESO_SINAL.burnout_critico : PESO_SINAL.burnout_atencao;
                }

                const tendencia = BurnoutDomain.detectTrend(burnoutTrendByEmp[emp.id]);
                if (tendencia.piorando) {
                    const critico = tendencia.semanas >= 5;
                    sinais.push({
                        tipo: 'burnout_tendencia',
                        nivel: critico ? 'critico' : 'atencao',
                        label: `Tendência de piora há ${tendencia.semanas} semanas seguidas`,
                    });
                    score += critico ? PESO_SINAL.burnout_tendencia_critico : PESO_SINAL.burnout_tendencia_atencao;
                }

                const saldo = calcSaldoBancoHorasMes(emp, timeByEmp[emp.id] || {}, adjByEmp[emp.id] || [], monthKey);
                if (saldo !== null && saldo <= -1200) {
                    const h = Math.floor(Math.abs(saldo) / 60),
                        m = String(Math.abs(saldo) % 60).padStart(2, '0');
                    sinais.push({ tipo: 'banco_horas', nivel: 'critico', label: `Banco de horas: -${h}h ${m}min` });
                    score += PESO_SINAL.banco_horas_critico;
                }

                const ticket = ticketByEmp[emp.id];
                if (ticket) {
                    const critico = ticket.status === 'aguardando_rh';
                    sinais.push({
                        tipo: 'ticket_rh',
                        nivel: critico ? 'critico' : 'atencao',
                        label: `Ticket RH: ${esc(ticket.subject || (critico ? 'aguardando atendimento' : 'em atendimento'))}`,
                    });
                    score += critico ? PESO_SINAL.ticket_aguardando : PESO_SINAL.ticket_em_atendimento;
                }

                return { emp, sinais, score: Math.min(100, score) };
            })
            .filter((l) => l.sinais.length >= 2)
            .sort((a, b) => b.sinais.length - a.sinais.length || b.score - a.score);

        renderRiscoComposto(linhas);
    } catch (err) {
        console.error('Erro ao carregar risco composto:', err);
        if (list) list.innerHTML = `<p class="history-empty">Erro ao cruzar os dados. Tente novamente.</p>`;
    }
}

function renderRiscoComposto(linhas) {
    const list = document.getElementById('risco-list');
    if (!list) return;

    if (!linhas.length) {
        list.innerHTML = `
            <div class="empty-state empty-state--success">
                <div class="empty-icon"><i class="fas fa-shield-heart"></i></div>
                <p class="empty-title">Nenhum risco composto</p>
                <p class="empty-desc">Nenhum colaborador acumula 2 ou mais sinais ao mesmo tempo.</p>
            </div>`;
        return;
    }

    list.innerHTML = linhas
        .map(({ emp, sinais, score }) => {
            const sev = score >= 60 ? 'critical' : score >= 35 ? 'warning' : 'info';
            const chips = sinais.map((s) => `<span class="emp-chip">${esc(s.label)}</span>`).join('');
            return `
        <div class="alert-card sev-${sev}">
            <div class="alert-card-header">
                <div class="alert-card-meta">
                    <span class="alert-cat-icon"><i class="fas fa-diagram-project"></i></span>
                    <span class="alert-cat-label">${esc(emp.name)} — ${esc(emp.dept || '—')}</span>
                    <span class="alert-sev-badge sev-${sev}">${SEV_LABEL[sev] || sev}</span>
                </div>
            </div>
            <h4 class="alert-card-title">Score de risco composto: ${score}/100</h4>
            <p class="alert-card-desc">${sinais.length} sinais simultâneos identificados para este colaborador.</p>
            <div class="emp-chips">${chips}</div>
        </div>`;
        })
        .join('');
}

const RISCO_JURIDICO_JANELA_INTERVALO_DIAS = 30;
const RISCO_JURIDICO_JANELA_EXCESSO_DIAS = 90;
const RISCO_JURIDICO_JANELA_REJEICAO_DIAS = 180;

async function loadRiscoJuridico() {
    const list = document.getElementById('juridico-list');
    const summaryEl = document.getElementById('juridico-summary');
    if (list)
        list.innerHTML = `<div class="loading-state" style="padding:20px"><div class="loading-spinner"></div><p>Calculando exposição jurídica...</p></div>`;

    try {
        const now = new Date();
        const janelaIntervaloInicio = new Date(now.getTime() - RISCO_JURIDICO_JANELA_INTERVALO_DIAS * 86400000).toISOString().split('T')[0];
        const janelaExcessoInicio = new Date(now.getTime() - RISCO_JURIDICO_JANELA_EXCESSO_DIAS * 86400000).toISOString();
        const janelaRejeicaoInicio = new Date(now.getTime() - RISCO_JURIDICO_JANELA_REJEICAO_DIAS * 86400000).toISOString();

        const [{ data: empData }, { data: complianceData }, { data: burnoutData }, { data: adjData }, { data: timeData }] = await Promise.all([
            sb.from('employees').select('id,name,dept,contract_type,work_load').in('status', ['Ativo', 'ativo']),
            sb.from('compliance_alerts').select('employee_id,alertas').eq('lido', false),
            sb.from('burnout_alerts').select('employee_id,alertas').gte('created_at', janelaExcessoInicio),
            sb.from('adjustment_requests').select('employee_id').eq('status', 'rejeitado').gte('created_at', janelaRejeicaoInicio),
            sb.from('time_records').select('employee_id,date,entrada,saida_almoco,retorno_almoco,saida').gte('date', janelaIntervaloInicio),
        ]);

        const employees = (empData || []).map((e) => ({
            id: e.id,
            name: e.name,
            dept: e.dept,
            contractType: e.contract_type,
            workLoad: e.work_load,
        }));
        const empById = {};
        employees.forEach((e) => (empById[e.id] = e));

        const prazosPorEmp = {};
        (complianceData || []).forEach((row) => {
            (prazosPorEmp[row.employee_id] ??= []).push(...(row.alertas || []).map((a) => ({ nivel: a.nivel, titulo: a.titulo })));
        });

        const excessoPorEmp = {};
        (burnoutData || []).forEach((row) => {
            const ocorrencias = (row.alertas || []).filter((a) => a.tipo === 'excesso_legal_diario').length;
            if (ocorrencias) excessoPorEmp[row.employee_id] = (excessoPorEmp[row.employee_id] || 0) + ocorrencias;
        });

        const rejeicaoPorEmp = {};
        (adjData || []).forEach((row) => {
            rejeicaoPorEmp[row.employee_id] = (rejeicaoPorEmp[row.employee_id] || 0) + 1;
        });

        const intervaloPorEmp = {};
        (timeData || []).forEach((rec) => {
            const emp = empById[rec.employee_id];
            if (!emp) return;
            const jornadaMin = CLTDomain.resolveJornadaMin({ contractType: emp.contractType, workLoad: emp.workLoad });
            if (CLTDomain.calcIntervaloDeficitMin(rec, jornadaMin) > 0) {
                intervaloPorEmp[rec.employee_id] = (intervaloPorEmp[rec.employee_id] || 0) + 1;
            }
        });

        const linhas = employees
            .map((emp) => {
                const resultado = RiscoJuridicoDomain.scoreColaborador({
                    prazosLegais: prazosPorEmp[emp.id] || [],
                    excessoHorasOcorrencias: excessoPorEmp[emp.id] || 0,
                    diasIntervaloNaoCumprido: intervaloPorEmp[emp.id] || 0,
                    ajustesRejeitados: rejeicaoPorEmp[emp.id] || 0,
                });
                return { emp, ...resultado };
            })
            .filter((l) => l.fatores.length > 0)
            .sort((a, b) => b.score - a.score);

        const empresa = RiscoJuridicoDomain.scoreEmpresa(linhas.map((l) => ({ score: l.score, nivel: l.nivel })));
        renderRiscoJuridico(linhas, empresa);
    } catch (err) {
        console.error('Erro ao calcular risco jurídico:', err);
        if (summaryEl) summaryEl.innerHTML = '';
        if (list) list.innerHTML = `<p class="history-empty">Erro ao calcular o score. Tente novamente.</p>`;
    }
}

const RISCO_JURIDICO_NIVEL_LABEL = { critico: 'Crítico', atencao: 'Atenção', ok: 'Baixo' };

function renderRiscoJuridico(linhas, empresa) {
    const list = document.getElementById('juridico-list');
    const summaryEl = document.getElementById('juridico-summary');
    if (!list) return;

    if (summaryEl) {
        summaryEl.innerHTML = `
            <span class="emp-chip">Score médio da empresa: <strong>${empresa.mediaScore}/100</strong> (${RISCO_JURIDICO_NIVEL_LABEL[empresa.nivel] || empresa.nivel})</span>
            <span class="emp-chip">${empresa.criticos} colaborador(es) em risco crítico</span>
            <span class="emp-chip">${empresa.atencao} colaborador(es) em atenção</span>`;
    }

    if (!linhas.length) {
        list.innerHTML = `
            <div class="empty-state empty-state--success">
                <div class="empty-icon"><i class="fas fa-scale-balanced"></i></div>
                <p class="empty-title">Nenhuma exposição jurídica identificada</p>
                <p class="empty-desc">Nenhum colaborador acumula prazo legal vencido, excesso de jornada, intervalo intrajornada não cumprido ou rejeição de ajuste no período analisado.</p>
            </div>`;
        return;
    }

    list.innerHTML = linhas
        .map(({ emp, score, nivel, fatores }) => {
            const sev = nivel === 'critico' ? 'critical' : nivel === 'atencao' ? 'warning' : 'info';
            const chips = fatores.map((f) => `<span class="emp-chip">${esc(f.label)}</span>`).join('');
            return `
        <div class="alert-card sev-${sev}">
            <div class="alert-card-header">
                <div class="alert-card-meta">
                    <span class="alert-cat-icon"><i class="fas fa-scale-balanced"></i></span>
                    <span class="alert-cat-label">${esc(emp.name)} — ${esc(emp.dept || '—')}</span>
                    <span class="alert-sev-badge sev-${sev}">${SEV_LABEL[sev] || sev}</span>
                </div>
            </div>
            <h4 class="alert-card-title">Score de risco jurídico: ${score}/100</h4>
            <p class="alert-card-desc">${fatores.length} fator${fatores.length > 1 ? 'es' : ''} de exposição identificado${fatores.length > 1 ? 's' : ''}.</p>
            <div class="emp-chips">${chips}</div>
        </div>`;
        })
        .join('');
}

function getDocAlertInfoCompliance(dataValidade, today) {
    if (!dataValidade) return null;
    const end = new Date(dataValidade + 'T00:00:00');
    const diffDays = Math.round((end - today) / 86400000);
    if (diffDays > 30) return null;
    return { diffDays, expired: diffDays < 0 };
}

async function loadCompliance() {
    const list = document.getElementById('compliance-list');
    if (list) list.innerHTML = `<div class="loading-state" style="padding:20px"><div class="loading-spinner"></div><p>Verificando prazos...</p></div>`;

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [{ data: empData }, { data: docData }, { data: complianceData }] = await Promise.all([
            sb.from('employees').select('id,name,dept').in('status', ['Ativo', 'ativo']),
            sb.from('documents').select('id,employee_id,name,tipo,data_validade').not('data_validade', 'is', null),
            sb.from('compliance_alerts').select('employee_id,alertas').eq('lido', false),
        ]);

        const employees = empData || [];

        const docsByEmp = {};
        (docData || []).forEach((d) => {
            if (d.employee_id) (docsByEmp[d.employee_id] ??= []).push(d);
        });

        const complianceByEmp = {};
        (complianceData || []).forEach((row) => {
            (complianceByEmp[row.employee_id] ??= []).push(...(row.alertas || []));
        });

        const linhas = employees
            .map((emp) => {
                const sinais = [];

                (complianceByEmp[emp.id] || []).forEach((a) => sinais.push({ nivel: a.nivel, label: a.titulo }));

                (docsByEmp[emp.id] || []).forEach((d) => {
                    const info = getDocAlertInfoCompliance(d.data_validade, today);
                    if (info)
                        sinais.push({
                            nivel: info.expired ? 'critico' : 'atencao',
                            label: `${d.name} (${d.tipo || 'documento'}) ${info.expired ? `vencido há ${Math.abs(info.diffDays)}d` : `vence em ${info.diffDays}d`}`,
                        });
                });

                return { emp, sinais };
            })
            .filter((l) => l.sinais.length > 0)
            .sort(
                (a, b) =>
                    b.sinais.filter((s) => s.nivel === 'critico').length - a.sinais.filter((s) => s.nivel === 'critico').length ||
                    b.sinais.length - a.sinais.length
            );

        renderCompliance(linhas);
    } catch (err) {
        console.error('Erro ao carregar compliance:', err);
        if (list) list.innerHTML = `<p class="history-empty">Erro ao verificar prazos. Tente novamente.</p>`;
    }
}

function renderCompliance(linhas) {
    const list = document.getElementById('compliance-list');
    const summaryEl = document.getElementById('compliance-summary-count');
    if (!list) return;

    if (!linhas.length) {
        if (summaryEl) summaryEl.classList.add('hidden');
        list.innerHTML = `
            <div class="empty-state empty-state--success">
                <div class="empty-icon"><i class="fas fa-shield-heart"></i></div>
                <p class="empty-title">Nenhuma pendência de compliance</p>
                <p class="empty-desc">Nenhum colaborador com documentos vencendo, férias vencidas ou fim de experiência próximo.</p>
            </div>`;
        return;
    }

    if (summaryEl) {
        summaryEl.textContent = String(linhas.length);
        summaryEl.classList.remove('hidden');
    }

    list.innerHTML = linhas
        .map(({ emp, sinais }) => {
            const sev = sinais.some((s) => s.nivel === 'critico') ? 'critical' : 'warning';
            const chips = sinais.map((s) => `<span class="emp-chip">${esc(s.label)}</span>`).join('');
            return `
        <div class="alert-card sev-${sev}">
            <div class="alert-card-header">
                <div class="alert-card-meta">
                    <span class="alert-cat-icon"><i class="fas fa-clipboard-check"></i></span>
                    <span class="alert-cat-label">${esc(emp.name)} — ${esc(emp.dept || '—')}</span>
                    <span class="alert-sev-badge sev-${sev}">${SEV_LABEL[sev] || sev}</span>
                </div>
            </div>
            <h4 class="alert-card-title">${sinais.length} pendência${sinais.length > 1 ? 's' : ''} de compliance</h4>
            <div class="emp-chips">${chips}</div>
        </div>`;
        })
        .join('');
}

const AF_CAT_LABEL = {
    clima: 'Clima organizacional',
    gestao: 'Gestão / liderança',
    processos: 'Processos internos',
    infraestrutura: 'Infraestrutura',
    outro: 'Outro',
};
const KUDOS_CAT_LABEL = { colaboracao: 'Colaboração', inovacao: 'Inovação', lideranca: 'Liderança', superacao: 'Superação', mentoria: 'Mentoria' };

let allKudosMod = [];
let allAnonFeedbackMod = [];
let anonFilterMod = 'all';

async function loadComunidade() {
    document.querySelectorAll('.comunidade-subtab').forEach((btn) => {
        btn.addEventListener('click', () => {
            const sub = btn.dataset.subtab;
            document.querySelectorAll('.comunidade-subtab').forEach((b) => b.classList.toggle('active', b === btn));
            document.getElementById('comunidade-kudos-list').classList.toggle('hidden', sub !== 'kudos');
            document.getElementById('comunidade-feedback-wrap').classList.toggle('hidden', sub !== 'feedback');
        });
    });
    document.querySelectorAll('.anon-feedback-filters .af-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
            anonFilterMod = btn.dataset.filter;
            document.querySelectorAll('.anon-feedback-filters .af-chip').forEach((b) => b.classList.toggle('active', b === btn));
            renderComunidadeFeedback();
        });
    });

    await Promise.all([loadKudosMod(), loadAnonFeedbackMod()]);
}

async function loadKudosMod() {
    const { data } = await sb
        .from('kudos')
        .select('*, from:employees!kudos_from_employee_id_fkey(name), to:employees!kudos_to_employee_id_fkey(name)')
        .order('created_at', { ascending: false })
        .limit(80);
    allKudosMod = data || [];
    renderComunidadeKudos();
}

function renderComunidadeKudos() {
    const list = document.getElementById('comunidade-kudos-list');
    if (!list) return;
    if (!allKudosMod.length) {
        list.innerHTML = `<p class="kudos-mod-empty">Nenhum reconhecimento publicado ainda.</p>`;
        return;
    }
    list.innerHTML = allKudosMod
        .map(
            (k) => `
        <div class="kudos-mod-card">
            <div class="kudos-mod-body">
                <span class="kudos-mod-names">${esc(k.from?.name || '—')} <i class="fas fa-arrow-right"></i> ${esc(k.to?.name || '—')}<span class="kudos-mod-cat">${esc(KUDOS_CAT_LABEL[k.categoria] || k.categoria)}</span></span>
                <p class="kudos-mod-msg">${esc(k.message)}</p>
                <span class="kudos-mod-time">${formatDate(new Date(k.created_at))}</span>
            </div>
            <button class="kudos-mod-remove" onclick="removeKudosMod('${k.id}')" title="Remover do mural"><i class="fas fa-trash"></i></button>
        </div>`
        )
        .join('');
}

window.removeKudosMod = async function (id) {
    if (!confirm('Remover este reconhecimento do mural? Esta ação não pode ser desfeita.')) return;
    const { error } = await sb.from('kudos').delete().eq('id', id);
    if (error) return;
    allKudosMod = allKudosMod.filter((k) => k.id !== id);
    renderComunidadeKudos();
};

async function loadAnonFeedbackMod() {
    const { data } = await sb.from('anonymous_feedback').select('*').order('created_at', { ascending: false });
    allAnonFeedbackMod = data || [];
    updateComunidadeBadge();
    renderComunidadeFeedback();
}

function updateComunidadeBadge() {
    const badge = document.getElementById('comunidade-summary-count');
    if (!badge) return;
    const novos = allAnonFeedbackMod.filter((f) => f.status === 'novo').length;
    badge.textContent = novos;
    badge.classList.toggle('hidden', novos === 0);
}

function renderComunidadeFeedback() {
    const list = document.getElementById('comunidade-feedback-list');
    if (!list) return;
    const filtered = anonFilterMod === 'all' ? allAnonFeedbackMod : allAnonFeedbackMod.filter((f) => f.status === anonFilterMod);
    if (!filtered.length) {
        list.innerHTML = `<p class="af-empty">Nenhum feedback encontrado.</p>`;
        return;
    }
    list.innerHTML = filtered
        .map(
            (f) => `
        <div class="af-item status-${f.status}">
            <div class="af-item-head">
                <span class="af-item-cat">${esc(AF_CAT_LABEL[f.categoria] || f.categoria)}</span>
                <span class="af-item-time">${formatDate(new Date(f.created_at))}</span>
            </div>
            <p class="af-item-msg">${esc(f.message)}</p>
            <div class="af-item-actions">
                ${f.status !== 'lido' ? `<button class="af-item-btn" onclick="markAnonFeedbackMod('${f.id}','lido')"><i class="fas fa-check"></i> Marcar como lido</button>` : ''}
                ${f.status !== 'arquivado' ? `<button class="af-item-btn" onclick="markAnonFeedbackMod('${f.id}','arquivado')"><i class="fas fa-box-archive"></i> Arquivar</button>` : ''}
            </div>
        </div>`
        )
        .join('');
}

window.markAnonFeedbackMod = async function (id, status) {
    const { error } = await sb.from('anonymous_feedback').update({ status }).eq('id', id);
    if (error) return;
    const item = allAnonFeedbackMod.find((f) => f.id === id);
    if (item) item.status = status;
    updateComunidadeBadge();
    renderComunidadeFeedback();
};

async function loadGestores() {
    const list = document.getElementById('gestores-list');
    if (list) list.innerHTML = `<div class="loading-state" style="padding:20px"><div class="loading-spinner"></div><p>Levantando gestores...</p></div>`;

    try {
        const { data: empData } = await sb.from('employees').select('id,name,dept,email,manager_id').in('status', ['Ativo', 'ativo']);
        const employees = empData || [];

        const managerIds = new Set(employees.map((e) => e.manager_id).filter(Boolean));
        const gestores = employees.filter((e) => managerIds.has(e.id));

        if (!gestores.length) {
            if (list)
                list.innerHTML = `<div class="empty-state empty-state--success"><div class="empty-icon"><i class="fas fa-user-tie"></i></div><p class="empty-title">Nenhum gestor definido</p><p class="empty-desc">Nenhum colaborador ativo tem líder apontado no cadastro.</p></div>`;
            return;
        }

        const gestorEmails = gestores.map((g) => g.email).filter(Boolean);

        const [{ data: vacData }, { data: bankData }, { data: ticketData }] = await Promise.all([
            sb.from('vacations').select('decided_by_email,status').in('decided_by_email', gestorEmails),
            sb
                .from('bank_requests')
                .select('decided_by_email,requires_approval_from')
                .eq('requires_approval_from', 'gestor')
                .in('decided_by_email', gestorEmails),
            sb
                .from('hr_tickets')
                .select('employee_id')
                .not('about_employee_id', 'is', null)
                .in(
                    'employee_id',
                    gestores.map((g) => g.id)
                ),
        ]);

        const linhas = gestores
            .map((g) => {
                const teamSize = employees.filter((e) => e.manager_id === g.id).length;
                const feriasDecididas = (vacData || []).filter((v) => v.decided_by_email === g.email).length;
                const bancoDecidido = (bankData || []).filter((b) => b.decided_by_email === g.email).length;
                const escalacoes = (ticketData || []).filter((t) => t.employee_id === g.id).length;
                return { g, teamSize, feriasDecididas, bancoDecidido, escalacoes };
            })
            .sort((a, b) => b.teamSize - a.teamSize);

        if (list) {
            list.innerHTML = linhas
                .map(
                    ({ g, teamSize, feriasDecididas, bancoDecidido, escalacoes }) => `
                <div class="gestor-card">
                    <div class="gestor-card-info">
                        <div class="gestor-card-name">${esc(g.name)}</div>
                        <div class="gestor-card-meta">${esc(g.dept || '—')}</div>
                    </div>
                    <div class="gestor-stats">
                        <div class="gestor-stat"><span class="gestor-stat-val">${teamSize}</span><span class="gestor-stat-lbl">Liderados</span></div>
                        <div class="gestor-stat"><span class="gestor-stat-val">${feriasDecididas}</span><span class="gestor-stat-lbl">Férias decididas</span></div>
                        <div class="gestor-stat"><span class="gestor-stat-val">${bancoDecidido}</span><span class="gestor-stat-lbl">Banco de horas</span></div>
                        <div class="gestor-stat"><span class="gestor-stat-val">${escalacoes}</span><span class="gestor-stat-lbl">Escalações ao RH</span></div>
                    </div>
                </div>`
                )
                .join('');
        }
    } catch (err) {
        console.error('Erro ao carregar gestores:', err);
        if (list) list.innerHTML = `<p class="history-empty">Erro ao levantar os gestores. Tente novamente.</p>`;
    }
}

async function loadChatHistory() {
    try {
        const { data } = await sb.from('ai_chat_history').select('role,content').order('created_at', { ascending: true }).limit(60);
        if (!data || !data.length) return;
        hideInitialChips();
        data.forEach((m) => appendChatMessage(m.role, m.content));
        chatHistory = data.slice(-20).map((m) => ({ role: m.role, content: m.content }));
    } catch {}
}

async function saveChatMessages(userMsg, aiMsg) {
    await sb.from('ai_chat_history').insert([
        { role: 'user', content: userMsg },
        { role: 'assistant', content: aiMsg },
    ]);
}

async function clearChatHistory() {
    chatHistory = [];
    const container = document.getElementById('chat-messages');
    container.innerHTML = `
        <div class="chat-message ai">
            <div class="ai-avatar-sm"><i class="fas fa-robot"></i></div>
            <div class="bubble">Olá! Sou o <strong>Nexus AI</strong>. Analiso os dados do RH em tempo real e respondo perguntas sobre colaboradores, ausências, aprovações e muito mais.<br><br>Realize uma análise ou pergunte diretamente!</div>
        </div>
        <div class="chat-suggestions" id="chat-suggestions-initial">
            <button class="suggestion-chip">Quem tem férias pendentes?</button>
            <button class="suggestion-chip">Há risco de burnout?</button>
            <button class="suggestion-chip">Quem está ausente?</button>
            <button class="suggestion-chip">Resumo geral do RH</button>
            <button class="suggestion-chip">Aprovações atrasadas?</button>
        </div>`;
    document.getElementById('chat-suggestions-initial')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.suggestion-chip');
        if (chip) sendSuggestion(chip.textContent.trim());
    });
    await sb.from('ai_chat_history').delete().gte('created_at', '1970-01-01');
}

async function saveAnalysisCache(summary, alerts, healthScore) {
    await sb
        .from('ai_analysis_cache')
        .upsert(
            { cache_key: 'latest', summary: summary || '', alerts: alerts || [], health_score: healthScore ?? null, analyzed_at: new Date().toISOString() },
            { onConflict: 'cache_key' }
        );
}

async function markAlertResolved(idx) {
    try {
        const { data } = await sb.from('ai_analysis_cache').select('alerts').eq('cache_key', 'latest').single();
        if (!data?.alerts) return;
        const alerts = data.alerts.map((a, i) => (i === idx ? { ...a, resolved: true } : a));
        await sb.from('ai_analysis_cache').update({ alerts }).eq('cache_key', 'latest');
    } catch (e) {
        console.warn('Erro ao salvar resolução:', e);
    }
}

function renderHealthScore(score) {
    const wrap = document.getElementById('health-score-wrap');
    const value = document.getElementById('health-score-value');
    if (!wrap || !value || score == null) return;
    wrap.style.display = 'flex';
    value.textContent = score;
    value.className = 'health-score-value ' + (score >= 80 ? 'score-green' : score >= 60 ? 'score-yellow' : score >= 40 ? 'score-amber' : 'score-red');
}

async function loadAnalysisCache() {
    try {
        const { data, error } = await sb.from('ai_analysis_cache').select('summary, alerts, analyzed_at').eq('cache_key', 'latest').single();

        if (error || !data || !Array.isArray(data.alerts) || !data.alerts.length) return;

        renderAlerts({ summary: data.summary, alerts: data.alerts, health_score: data.health_score });

        const date = new Date(data.analyzed_at);
        updateLastAnalysis(date);
        renderSuggestionChips(data.alerts);
        hideInitialChips();
    } catch {}
}

function formatDate(date) {
    const isToday = date.toDateString() === new Date().toDateString();
    const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return isToday ? `hoje às ${time}` : `${date.toLocaleDateString('pt-BR')} às ${time}`;
}

function calcHealthScore(alerts) {
    if (!alerts.length) return 100;
    let score = 100;
    for (const a of alerts) {
        if (a.severity === 'critical') score -= 20;
        else if (a.severity === 'warning') score -= 8;
        else score -= 3;
    }
    return Math.max(0, score);
}

function esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function mdToHtml(text) {
    return esc(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildAiDecisionLogRows, AI_DECISION_TARGET_TABLE };
