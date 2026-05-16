/* ════════════════════════════════════════════
   alertas.js — Central de Alertas IA — Nexus
   ════════════════════════════════════════════ */

let chatHistory    = [];
let isLoading      = false;
let historyLoaded  = false;

const CATEGORY_ICON = {
    aprovacao: 'fa-check-circle',
    burnout:   'fa-fire',
    ausencia:  'fa-user-clock',
    documentos:'fa-file-exclamation',
    admissao:  'fa-user-plus',
    geral:     'fa-circle-info',
};

const CATEGORY_PAGE = {
    aprovacao:  { href: '../screens/ferias.html',         label: 'Ver Férias',          icon: 'fa-umbrella-beach' },
    burnout:    { href: '../screens/colaboradores.html',  label: 'Ver Colaboradores',   icon: 'fa-users' },
    ausencia:   { href: '../screens/banco-horas-rh.html', label: 'Ver Horas',           icon: 'fa-clock-rotate-left' },
    documentos: { href: '../screens/arquivos.html',       label: 'Ver Arquivos',        icon: 'fa-folder-open' },
    admissao:   { href: '../screens/colaboradores.html',  label: 'Ver Colaboradores',   icon: 'fa-users' },
    geral:      { href: '../screens/dashboard.html',      label: 'Ver Dashboard',       icon: 'fa-chart-pie' },
};

const CATEGORY_LABEL = {
    aprovacao: 'Aprovação',
    burnout:   'Burnout',
    ausencia:  'Ausência',
    documentos:'Documentos',
    admissao:  'Admissão',
    geral:     'Geral',
};

const SEV_LABEL = { critical: 'Crítico', warning: 'Atenção', info: 'Info' };

// ─── Init ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    setupListeners();
    setupTabs();
    await Promise.all([loadAnalysisCache(), loadChatHistory()]);
});

async function checkAuth() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }
    const { data: profile } = await sb.from('profiles').select('profile').eq('id', user.id).single();
    if (profile?.profile !== 'Administrador') { window.location.href = '../screens/login.html'; return; }

}

// ─── Listeners ────────────────────────────────────────────────

function setupListeners() {
    document.getElementById('btn-analyze')?.addEventListener('click', runAnalysis);

    const input   = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-send');

    sendBtn?.addEventListener('click', sendChat);
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
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

// ─── Edge Function ────────────────────────────────────────────

async function callEdgeFunction(payload) {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-alerts`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
}

// ─── Analysis ────────────────────────────────────────────────

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

        appendChatMessage('ai', `Análise concluída! Encontrei **${(parsed.alerts || []).length}** alerta(s). Pode me perguntar mais detalhes sobre qualquer item.`);
        renderSuggestionChips(parsed.alerts || []);
    } catch (err) {
        showAlertsError(err.message);
        appendChatMessage('ai', `Não foi possível concluir a análise: ${err.message}`);
    } finally {
        isLoading = false;
        setAnalyzeBtn(false);
    }
}

// ─── Chat (streaming) ─────────────────────────────────────────

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
    const bubbleId  = 'sb-' + Date.now();
    const msgDiv    = document.createElement('div');
    msgDiv.className = 'chat-message ai';
    msgDiv.innerHTML = `
        <div class="ai-avatar-sm"><i class="fas fa-robot"></i></div>
        <div class="bubble" id="${bubbleId}"><span class="stream-cursor"></span></div>`;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;

    const bubble = document.getElementById(bubbleId);
    let fullText = '';

    try {
        const { data: { session } } = await sb.auth.getSession();
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-alerts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
                'apikey': SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ action: 'chat', message, history: chatHistory.slice(0, -1) }),
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Erro ${res.status}`);
        }

        const reader  = res.body.getReader();
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
                } catch { /* linha incompleta */ }
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

// ─── Ações Diretas ────────────────────────────────────────────

function showActionConfirmation(actionData, originalMessage) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-message ai';
    div.innerHTML = `
        <div class="ai-avatar-sm"><i class="fas fa-robot"></i></div>
        <div class="action-confirm-card">
            <div class="action-confirm-header"><i class="fas fa-bolt"></i> Ação detectada</div>
            <p class="action-confirm-message">${esc(actionData.message)}</p>
            <div class="action-confirm-btns">
                <button class="btn-do-action"><i class="fas fa-check"></i> Confirmar</button>
                <button class="btn-cancel-action"><i class="fas fa-times"></i> Cancelar</button>
            </div>
        </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

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

async function executeAction(actionData) {
    try {
        const { type, ids = [] } = actionData;
        const now = new Date().toISOString();
        switch (type) {
            case 'approve_vacation':
                await sb.from('vacations').update({ status: 'aprovado', approved_at: now }).in('id', ids); break;
            case 'reject_vacation':
                await sb.from('vacations').update({ status: 'recusado', rejected_at: now }).in('id', ids); break;
            case 'approve_adjustment':
                await sb.from('adjustment_requests').update({ status: 'aprovado' }).in('id', ids); break;
            case 'reject_adjustment':
                await sb.from('adjustment_requests').update({ status: 'rejeitado' }).in('id', ids); break;
            case 'mark_burnout_read':
                await sb.from('burnout_alerts').update({ lido: true }).in('id', ids); break;
            default: throw new Error(`Ação desconhecida: ${type}`);
        }
        await sb.from('ai_decision_memory').insert({ action_type: type, description: actionData.message });
        return true;
    } catch (e) {
        console.error('executeAction:', e);
        return false;
    }
}

// ─── Relatório Executivo ──────────────────────────────────────

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
    const modal   = document.getElementById('report-modal');
    const content = document.getElementById('report-content');
    if (!modal || !content) return;
    content.innerHTML = typeof marked !== 'undefined'
        ? marked.parse(markdown)
        : markdown.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>');
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
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
    });
}

// ─── Render Alerts ────────────────────────────────────────────

function renderAlerts({ summary = '', alerts = [], health_score }) {
    const body      = document.getElementById('alerts-body');
    const countEl   = document.getElementById('severity-counts');
    const dismissEl = document.getElementById('btn-dismiss-all');

    renderHealthScore(health_score);

    if (!alerts.length) {
        body.innerHTML = `
            <div class="empty-state empty-state--success">
                <div class="empty-icon"><i class="fas fa-check-circle"></i></div>
                <p class="empty-title">Tudo em ordem!</p>
                <p class="empty-desc">${esc(summary) || 'Nenhum alerta crítico identificado no momento.'}</p>
            </div>`;
        if (countEl)   countEl.innerHTML = '';
        if (dismissEl) dismissEl.style.display = 'none';
        return;
    }

    const critical = alerts.filter(a => a.severity === 'critical');
    const warning  = alerts.filter(a => a.severity === 'warning');
    const info     = alerts.filter(a => a.severity === 'info');
    const sorted   = [...critical, ...warning, ...info];

    let html = `<div class="summary-banner"><i class="fas fa-robot"></i><span>${esc(summary)}</span></div>`;
    for (const a of sorted) html += alertCard(a, alerts.indexOf(a));
    body.innerHTML = html;

    const badges = [];
    if (critical.length) badges.push(`<span class="sev-badge sev-critical">${critical.length} crítico${critical.length > 1 ? 's' : ''}</span>`);
    if (warning.length)  badges.push(`<span class="sev-badge sev-warning">${warning.length} atenção</span>`);
    if (info.length)     badges.push(`<span class="sev-badge sev-info">${info.length} info</span>`);
    if (countEl)   countEl.innerHTML = badges.join('');
    if (dismissEl) dismissEl.style.display = 'inline-flex';

    body.querySelectorAll('.alert-card-dismiss').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.alert-card')?.remove();
            if (!body.querySelectorAll('.alert-card').length) clearAlerts();
        });
    });

    body.querySelectorAll('.btn-resolve').forEach(btn => {
        btn.addEventListener('click', async () => {
            const card = btn.closest('.alert-card');
            const idx  = parseInt(card.dataset.idx);
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
    const icon  = CATEGORY_ICON[a.category]  || 'fa-circle-info';
    const label = CATEGORY_LABEL[a.category] || a.category;
    const sev   = a.severity || 'info';
    const chips = (a.employees || []).map(n => `<span class="emp-chip">${esc(n)}</span>`).join('');
    const page  = CATEGORY_PAGE[a.category];
    const gotoLink = page
        ? `<a class="alert-goto-link" href="${page.href}"><i class="fas ${page.icon}"></i>${page.label}<i class="fas fa-arrow-right"></i></a>`
        : '';
    const resolveBtn = a.resolved
        ? `<span class="resolved-badge"><i class="fas fa-check-circle"></i> Resolvido</span>`
        : `<button class="btn-resolve" title="Marcar como resolvido"><i class="fas fa-check"></i> Resolvido</button>`;
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

// ─── Suggestions ─────────────────────────────────────────────

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
    document.querySelectorAll('.chat-suggestions-dynamic').forEach(el => el.remove());

    const chips = getDynamicChips(alerts);
    if (!chips.length) return;

    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-suggestions chat-suggestions-dynamic';
    div.innerHTML = chips.map(c => `<button class="suggestion-chip">${esc(c)}</button>`).join('');
    div.addEventListener('click', (e) => {
        const chip = e.target.closest('.suggestion-chip');
        if (chip) { div.remove(); sendSuggestion(chip.textContent.trim()); }
    });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function getDynamicChips(alerts) {
    const chips = [];
    const cats  = new Set(alerts.map(a => a.category));
    if (cats.has('aprovacao'))  chips.push('Quais aprovações estão mais urgentes?');
    if (cats.has('burnout'))    chips.push('Detalhe os riscos de burnout identificados');
    if (cats.has('ausencia'))   chips.push('Quem está ausente sem justificativa?');
    if (cats.has('documentos')) chips.push('Quais documentos precisam de revisão?');
    if (cats.has('admissao'))   chips.push('Como está o onboarding dos novos colaboradores?');
    chips.push('Qual o alerta mais crítico agora?');
    return chips.slice(0, 4);
}

// ─── Chat Helpers ─────────────────────────────────────────────

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

function showTypingIndicator() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.id = 'typing-indicator';
    div.className = 'chat-message ai';
    div.innerHTML = `
        <div class="ai-avatar-sm"><i class="fas fa-robot"></i></div>
        <div class="typing-bubble">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
    document.getElementById('typing-indicator')?.remove();
}

// ─── Alerts Panel State ───────────────────────────────────────

function showAlertsLoading() {
    const body = document.getElementById('alerts-body');
    if (body) body.innerHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <p>Nexus AI analisando os dados...</p>
        </div>`;
    const countEl  = document.getElementById('severity-counts');
    const dismissEl = document.getElementById('btn-dismiss-all');
    if (countEl)   countEl.innerHTML = '';
    if (dismissEl) dismissEl.style.display = 'none';
}

function showAlertsError(msg) {
    const body = document.getElementById('alerts-body');
    if (body) body.innerHTML = `
        <div class="empty-state empty-state--error">
            <div class="empty-icon"><i class="fas fa-triangle-exclamation"></i></div>
            <p class="empty-title">Erro na análise</p>
            <p class="empty-desc">${esc(msg)}</p>
        </div>`;
}

function clearAlerts() {
    const body     = document.getElementById('alerts-body');
    const countEl  = document.getElementById('severity-counts');
    const dismissEl = document.getElementById('btn-dismiss-all');
    if (body) body.innerHTML = `
        <div class="empty-state" id="empty-state">
            <div class="empty-icon"><i class="fas fa-robot"></i></div>
            <p class="empty-title">Nexus AI pronto</p>
            <p class="empty-desc">Clique em "Analisar Agora" para gerar alertas inteligentes com base nos dados do sistema.</p>
        </div>`;
    if (countEl)   countEl.innerHTML = '';
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

// ─── Tabs ─────────────────────────────────────────────────────

function setupTabs() {
    document.querySelectorAll('.panel-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    const isAlerts = tabName === 'alerts';
    document.getElementById('alerts-body').style.display       = isAlerts ? '' : 'none';
    document.getElementById('history-body').style.display      = isAlerts ? 'none' : '';
    document.getElementById('alerts-header-right').style.display = isAlerts ? '' : 'none';
    if (!isAlerts && !historyLoaded) { historyLoaded = true; loadHistory(); }
}

// ─── Histórico de Análises ────────────────────────────────────

async function saveToHistory(summary, alerts, healthScore) {
    await sb.from('ai_analysis_history').insert({
        summary: summary || '', health_score: healthScore ?? null,
        alerts: alerts || [], analyzed_at: new Date().toISOString(),
    });
    historyLoaded = false;
}

async function loadHistory() {
    const list = document.getElementById('history-list');
    if (list) list.innerHTML = `<div class="loading-state" style="padding:20px"><div class="loading-spinner"></div><p>Carregando...</p></div>`;
    try {
        const { data } = await sb.from('ai_analysis_history')
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
    const date     = new Date(item.analyzed_at);
    const alerts   = item.alerts || [];
    const critical = alerts.filter(a => a.severity === 'critical').length;
    const warning  = alerts.filter(a => a.severity === 'warning').length;
    const info     = alerts.filter(a => a.severity === 'info').length;
    const score    = item.health_score;
    const sc = score == null ? '' : score >= 80 ? 'score-green' : score >= 60 ? 'score-yellow' : score >= 40 ? 'score-amber' : 'score-red';
    const badges = [
        critical ? `<span class="sev-badge sev-critical">${critical} crítico${critical > 1 ? 's' : ''}</span>` : '',
        warning  ? `<span class="sev-badge sev-warning">${warning} atenção</span>` : '',
        info     ? `<span class="sev-badge sev-info">${info} info</span>` : '',
        !alerts.length ? `<span class="sev-badge" style="background:#f0fdf4;color:#15803d">Sem alertas</span>` : '',
    ].join('');
    const rows = alerts.map(a => `
        <div class="history-alert-row sev-${a.severity}">
            <i class="fas ${CATEGORY_ICON[a.category] || 'fa-circle-info'}"></i>
            <span>${esc(a.title)}</span>
            ${a.resolved ? '<span class="history-resolved-tag"><i class="fas fa-check"></i> Resolvido</span>' : ''}
        </div>`).join('') || `<span style="font-size:.75rem;color:#94a3b8">Sem alertas nesta análise</span>`;
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
    const labels = sorted.map(h => {
        const d = new Date(h.analyzed_at);
        return `${d.getDate()}/${d.getMonth() + 1}`;
    });
    const scores = sorted.map(h => h.health_score ?? null);
    if (window._trendChart) { window._trendChart.destroy(); window._trendChart = null; }
    window._trendChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                data: scores,
                borderColor: '#6366f1',
                backgroundColor: 'rgba(99,102,241,.07)',
                fill: true, tension: 0.35,
                pointRadius: 5,
                pointBackgroundColor: scores.map(s =>
                    s == null ? '#e2e8f0' : s >= 80 ? '#22c55e' : s >= 60 ? '#84cc16' : s >= 40 ? '#f59e0b' : '#ef4444'),
                pointBorderColor: '#fff', pointBorderWidth: 2,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` Score: ${ctx.parsed.y}` } } },
            scales: {
                y: { min: 0, max: 100, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            },
        },
    });
}

// ─── Chat Persistente ─────────────────────────────────────────

async function loadChatHistory() {
    try {
        const { data } = await sb.from('ai_chat_history')
            .select('role,content')
            .order('created_at', { ascending: true })
            .limit(60);
        if (!data || !data.length) return;
        hideInitialChips();
        data.forEach(m => appendChatMessage(m.role, m.content));
        chatHistory = data.slice(-20).map(m => ({ role: m.role, content: m.content }));
    } catch { /* sem histórico ainda */ }
}

async function saveChatMessages(userMsg, aiMsg) {
    await sb.from('ai_chat_history').insert([
        { role: 'user',      content: userMsg },
        { role: 'assistant', content: aiMsg   },
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

// ─── Cache (Supabase) ─────────────────────────────────────────

async function saveAnalysisCache(summary, alerts, healthScore) {
    await sb.from('ai_analysis_cache').upsert(
        { cache_key: 'latest', summary: summary || '', alerts: alerts || [], health_score: healthScore ?? null, analyzed_at: new Date().toISOString() },
        { onConflict: 'cache_key' }
    );
}

async function markAlertResolved(idx) {
    try {
        const { data } = await sb.from('ai_analysis_cache').select('alerts').eq('cache_key', 'latest').single();
        if (!data?.alerts) return;
        const alerts = data.alerts.map((a, i) => i === idx ? { ...a, resolved: true } : a);
        await sb.from('ai_analysis_cache').update({ alerts }).eq('cache_key', 'latest');
    } catch (e) {
        console.warn('Erro ao salvar resolução:', e);
    }
}

function renderHealthScore(score) {
    const wrap  = document.getElementById('health-score-wrap');
    const value = document.getElementById('health-score-value');
    if (!wrap || !value || score == null) return;
    wrap.style.display = 'flex';
    value.textContent  = score;
    value.className    = 'health-score-value ' + (
        score >= 80 ? 'score-green'  :
        score >= 60 ? 'score-yellow' :
        score >= 40 ? 'score-amber'  : 'score-red'
    );
}

async function loadAnalysisCache() {
    try {
        const { data, error } = await sb.from('ai_analysis_cache')
            .select('summary, alerts, analyzed_at')
            .eq('cache_key', 'latest')
            .single();

        if (error || !data || !Array.isArray(data.alerts) || !data.alerts.length) return;

        renderAlerts({ summary: data.summary, alerts: data.alerts, health_score: data.health_score });

        const date = new Date(data.analyzed_at);
        updateLastAnalysis(date);
        renderSuggestionChips(data.alerts);
        hideInitialChips();
    } catch {
        // sem cache ou tabela ainda não existe — ignora silenciosamente
    }
}


function formatDate(date) {
    const isToday = date.toDateString() === new Date().toDateString();
    const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return isToday ? `hoje às ${time}` : `${date.toLocaleDateString('pt-BR')} às ${time}`;
}

// ─── Utils ────────────────────────────────────────────────────

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
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function mdToHtml(text) {
    return esc(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

async function logout() {
    await sb.auth.signOut();
    window.location.href = '../screens/login.html';
}
