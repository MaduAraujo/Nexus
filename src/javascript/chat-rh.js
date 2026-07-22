document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('Administrador');
    if (!auth) return;

    const analystEmpId = auth.profile.employee_id;

    let allTickets = [];
    let currentFilter = 'all';
    let currentTicketId = null;
    let currentTicket = null;
    let activeTicketSub = null;
    const seenTickets = new Set();

    const esc = (s) =>
        String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const initials = (name) =>
        (name || '?')
            .split(' ')
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() || '')
            .join('');

    const fmtTime = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const fmtAgo = (ts) => {
        const d = Math.floor((Date.now() - new Date(ts)) / 60000);
        if (d < 1) return 'agora';
        if (d < 60) return `${d}min`;
        const h = Math.floor(d / 60);
        if (h < 24) return `${h}h`;
        return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    };

    const scrollBottom = (id) => {
        const el = document.getElementById(id);
        if (el)
            requestAnimationFrame(() => {
                el.scrollTop = el.scrollHeight;
            });
    };

    const $ = (id) => document.getElementById(id);

    const statusLabel = {
        bot: 'Bot',
        aguardando_rh: 'Aguardando RH',
        em_atendimento: 'Em atendimento',
        resolvido: 'Resolvido',
    };

    const statusDotClass = {
        bot: 'tsd-bot',
        aguardando_rh: 'tsd-waiting',
        em_atendimento: 'tsd-human',
        resolvido: 'tsd-solved',
    };

    const SLA_WARN_MIN = 4 * 60;
    const SLA_BREACH_MIN = 24 * 60;

    function slaInfo(ticket) {
        if (ticket.status !== 'aguardando_rh') return null;
        const waitMin = Math.max(0, Math.floor((Date.now() - new Date(ticket.updated_at || ticket.created_at)) / 60000));
        const level = waitMin >= SLA_BREACH_MIN ? 'breach' : waitMin >= SLA_WARN_MIN ? 'warn' : 'ok';
        return { waitMin, level };
    }

    function slaLabel(waitMin) {
        if (waitMin < 60) return `${waitMin}min`;
        const h = Math.floor(waitMin / 60);
        if (h < 24) return `${h}h`;
        return `${Math.floor(h / 24)}d`;
    }

    function slaBadgeHtml(ticket) {
        const sla = slaInfo(ticket);
        if (!sla) return '';
        return `<span class="sla-badge sla-badge--${sla.level}" title="Aguardando analista há ${slaLabel(sla.waitMin)}"><i class="fas fa-stopwatch"></i> ${slaLabel(sla.waitMin)}</span>`;
    }

    function starsHtml(rating) {
        return Array.from({ length: 5 }, (_, i) => `<i class="fa${i < rating ? 's' : 'r'} fa-star"></i>`).join('');
    }

    function csatBadgeHtml(ticket) {
        if (ticket.status !== 'resolvido' || !ticket.csat_rating) return '';
        return `<span class="csat-badge" title="Avaliação do colaborador">${starsHtml(ticket.csat_rating)}</span>`;
    }

    const chatLeft = document.getElementById('chat-left');
    const chatOverlay = document.getElementById('chat-overlay');
    const panelBtn = document.getElementById('topbar-panels-btn');

    const openChatLeft = () => {
        chatLeft?.classList.add('open');
        chatOverlay?.classList.add('active');
    };
    const closeChatLeft = () => {
        chatLeft?.classList.remove('open');
        chatOverlay?.classList.remove('active');
    };

    panelBtn?.addEventListener('click', openChatLeft);
    chatOverlay?.addEventListener('click', closeChatLeft);

    document.querySelectorAll('.tf-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            document.querySelectorAll('.tf-chip').forEach((b) => b.classList.toggle('active', b === btn));
            renderTicketList();
        });
    });

    async function loadTickets() {
        const { data: tickets } = await sb
            .from('hr_tickets')
            .select(
                '*, employees!hr_tickets_employee_id_fkey(name, avatar_url, avatar_color, role, dept), about:employees!hr_tickets_about_employee_id_fkey(name)'
            )
            .order('updated_at', { ascending: false });

        allTickets = tickets || [];
        allTickets.forEach((t) => seenTickets.add(t.id));
        updateStats();
        renderTicketList();
        updatePendingBadge();
    }

    function updateStats() {
        const waiting = allTickets.filter((t) => t.status === 'aguardando_rh').length;
        const active = allTickets.filter((t) => t.status === 'em_atendimento').length;
        const solved = allTickets.filter((t) => t.status === 'resolvido').length;

        const set = (id, val) => {
            const el = $(id);
            if (el) el.textContent = val;
        };
        set('stat-total', allTickets.length);
        set('stat-waiting', waiting);
        set('stat-active', active);
        set('stat-solved', solved);

        const rated = allTickets.filter((t) => t.csat_rating);
        const avgCsat = rated.length ? rated.reduce((s, t) => s + t.csat_rating, 0) / rated.length : null;
        set('stat-csat', avgCsat ? `${avgCsat.toFixed(1)}★` : '—');
        $('tstat-csat-wrap')?.classList.toggle('tstat-csat-set', !!avgCsat);

        const breached = allTickets.some((t) => slaInfo(t)?.level === 'breach');
        document.getElementById('stat-waiting')?.closest('.tstat')?.classList.toggle('tstat-danger', breached);
    }

    function updatePendingBadge() {
        const waiting = allTickets.filter((t) => t.status === 'aguardando_rh').length;
        const badge = $('sidebar-pending-badge');
        const pill = $('pending-pill');
        const cnt = $('pending-count');

        if (badge) {
            badge.textContent = waiting;
            badge.style.display = waiting > 0 ? 'inline-flex' : 'none';
        }
        if (pill) {
            pill.style.display = waiting > 0 ? 'flex' : 'none';
        }
        if (cnt) {
            cnt.textContent = waiting;
        }
    }

    function renderTicketList() {
        const list = $('ticket-list');
        if (!list) return;

        let filtered = allTickets;
        if (currentFilter === 'escalacao') {
            filtered = allTickets.filter((t) => !!t.about);
        } else if (currentFilter !== 'all') {
            filtered = allTickets.filter((t) => t.status === currentFilter);
        }

        const order = { aguardando_rh: 0, em_atendimento: 1, bot: 2, resolvido: 3 };
        filtered = [...filtered].sort((a, b) => {
            const oa = order[a.status] ?? 99;
            const ob = order[b.status] ?? 99;
            if (oa !== ob) return oa - ob;
            return new Date(b.updated_at) - new Date(a.updated_at);
        });

        list.innerHTML = '';

        if (!filtered.length) {
            list.innerHTML = `<li class="ch-loading"><span style="color:rgba(156,163,175,.8)">Nenhum ticket encontrado</span></li>`;
            return;
        }

        filtered.forEach((ticket) => list.appendChild(buildTicketItem(ticket)));
    }

    function buildTicketItem(ticket) {
        const e = ticket.employees || {};
        const li = document.createElement('li');
        li.className = `ticket-item status-${ticket.status}`;
        li.dataset.ticketId = ticket.id;

        const avatarHtml = e.avatar_url
            ? `<div class="ti-avatar" style="background:url(${e.avatar_url}) center/cover"></div>`
            : `<div class="ti-avatar" style="background:${e.avatar_color || '#6366f1'}">${esc(initials(e.name))}</div>`;

        const isNew = ticket.status === 'aguardando_rh' && currentTicketId !== ticket.id;

        li.innerHTML = `
            ${avatarHtml}
            <div class="ti-body">
                <div class="ti-name">${esc(e.name || 'Colaborador')}</div>
                <div class="ti-meta">
                    <span class="ti-status-dot ${statusDotClass[ticket.status] || 'tsd-bot'}"></span>
                    <span>${statusLabel[ticket.status] || ticket.status}</span>
                    ${e.dept ? `<span>·</span><span>${esc(e.dept)}</span>` : ''}
                    ${slaBadgeHtml(ticket)}
                    ${csatBadgeHtml(ticket)}
                    ${ticket.about ? `<span class="escalation-badge" title="Escalação do gestor sobre este colaborador"><i class="fas fa-flag"></i> Sobre ${esc(ticket.about.name)}</span>` : ''}
                </div>
            </div>
            <div class="ti-time">${fmtAgo(ticket.updated_at || ticket.created_at)}</div>
            ${isNew ? `<div class="ti-new-dot" title="Aguardando resposta"></div>` : ''}
        `;

        li.addEventListener('click', () => selectTicket(ticket));
        return li;
    }

    async function selectTicket(ticket) {
        currentTicketId = ticket.id;
        currentTicket = ticket;
        const emp = ticket.employees || {};

        document.querySelectorAll('.ticket-item').forEach((li) => {
            li.classList.toggle('active', li.dataset.ticketId === ticket.id);
        });

        const avatar = $('colab-avatar');
        if (avatar) {
            if (emp.avatar_url) {
                avatar.style.background = `url(${emp.avatar_url}) center/cover`;
                avatar.textContent = '';
            } else {
                avatar.style.background = emp.avatar_color || '#6366f1';
                avatar.textContent = initials(emp.name);
            }
        }
        const nameEl = $('colab-name');
        const metaEl = $('colab-meta');
        if (nameEl) nameEl.textContent = emp.name || 'Colaborador';
        const metaParts = [emp.role, emp.dept].filter(Boolean);
        if (ticket.about) metaParts.push(`🚩 Escalação sobre ${ticket.about.name}`);
        if (metaEl) metaEl.textContent = metaParts.join(' · ');

        updateStatusChip(ticket.status);
        updateActionButtons(ticket.status);
        updateHeaderBadges(ticket);

        showChatArea();
        closeChatLeft();

        await loadTicketMessages(ticket.id);
        subscribeToTicket(ticket.id);

        if (ticket.status === 'aguardando_rh') {
            await markStatus('em_atendimento');
        }
    }

    function updateStatusChip(status) {
        const dot = $('status-chip-dot');
        const label = $('status-chip-label');
        if (!dot || !label) return;

        dot.className = 'presence-dot';
        const dotMap = { bot: 'offline', aguardando_rh: 'away', em_atendimento: 'online', resolvido: 'offline' };
        dot.classList.add(dotMap[status] || 'offline');
        label.textContent = statusLabel[status] || status;
    }

    function updateHeaderBadges(ticket) {
        const slaEl = $('header-sla-badge');
        const csatEl = $('header-csat-badge');
        if (slaEl) {
            const html = slaBadgeHtml(ticket);
            slaEl.innerHTML = html;
            slaEl.classList.toggle('hidden', !html);
        }
        if (csatEl) {
            const html = csatBadgeHtml(ticket);
            csatEl.innerHTML = html;
            csatEl.classList.toggle('hidden', !html);
        }
    }

    function updateActionButtons(status) {
        const btnAtend = $('btn-em-atend');
        const btnResolve = $('btn-resolver');
        const input = $('hr-reply-input');
        const sendBtn = $('hr-reply-send');

        if (btnAtend) btnAtend.style.display = status === 'aguardando_rh' ? 'flex' : 'none';
        if (btnResolve) btnResolve.style.display = status === 'em_atendimento' ? 'flex' : 'none';

        const disabled = status === 'resolvido' || status === 'bot';
        if (input) input.disabled = disabled;
        if (sendBtn) sendBtn.disabled = disabled;
    }

    $('btn-em-atend')?.addEventListener('click', () => markStatus('em_atendimento'));
    $('btn-resolver')?.addEventListener('click', () => markStatus('resolvido'));

    async function markStatus(newStatus) {
        if (!currentTicketId) return;

        await sb.from('hr_tickets').update({ status: newStatus }).eq('id', currentTicketId);

        currentTicket = { ...currentTicket, status: newStatus };
        const idx = allTickets.findIndex((t) => t.id === currentTicketId);
        if (idx !== -1) allTickets[idx] = { ...allTickets[idx], status: newStatus, updated_at: new Date().toISOString() };

        updateStats();
        updatePendingBadge();
        renderTicketList();
        updateStatusChip(newStatus);
        updateActionButtons(newStatus);
        updateHeaderBadges(currentTicket);

        document.querySelectorAll('.ticket-item').forEach((li) => {
            li.classList.toggle('active', li.dataset.ticketId === currentTicketId);
        });

        if (newStatus === 'resolvido') {
            appendSystemMessage('— Atendimento encerrado pelo analista de RH —');
            showToast('Ticket encerrado', 'success', 'O colaborador foi notificado.');
        }
    }

    async function loadTicketMessages(ticketId) {
        const list = $('messages-list');
        if (!list) return;
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:.82rem;"><i class="fas fa-spinner fa-spin"></i></div>`;

        const { data: msgs } = await sb
            .from('hr_ticket_messages')
            .select('*, employees(name, avatar_url, avatar_color)')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true });

        list.innerHTML = '';
        (msgs || []).forEach((m) => appendMessage(m, false));
        scrollBottom('messages-scroll');
    }

    function appendMessage(msg, doScroll = true) {
        const list = $('messages-list');
        if (!list) return;

        if (msg.role === 'bot') {
            appendBotMessage(msg);
        } else if (msg.role === 'user') {
            appendColabMessage(msg);
        } else if (msg.role === 'rh') {
            appendRhMessage(msg);
        }

        if (doScroll) scrollBottom('messages-scroll');
    }

    function appendBotMessage(msg) {
        const list = $('messages-list');
        if (!list) return;

        if (msg.content.startsWith('—')) {
            appendSystemMessage(msg.content);
            return;
        }

        const formattedContent = esc(msg.content)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        const group = document.createElement('div');
        group.className = 'msg-group is-bot';
        group.innerHTML = `
            <div class="msg-row">
                <div class="msg-avatar bot-avatar" title="Agente RH (Bot)">
                    <i class="fas fa-robot" style="font-size:.72rem"></i>
                </div>
                <div class="msg-content-wrap">
                    <div class="msg-header">
                        <span class="msg-author" style="color:var(--accent-hr)">Agente RH (Bot)</span>
                        <span class="msg-time">${fmtTime(msg.created_at)}</span>
                    </div>
                    <div class="msg-bubble">${formattedContent}</div>
                </div>
            </div>`;
        list.appendChild(group);
    }

    function appendColabMessage(msg) {
        const list = $('messages-list');
        if (!list) return;
        const e = msg.employees || {};

        const avatarHtml = e.avatar_url
            ? `<div class="msg-avatar" style="background:url(${e.avatar_url}) center/cover" title="${esc(e.name)}"></div>`
            : `<div class="msg-avatar" style="background:${e.avatar_color || '#6366f1'}" title="${esc(e.name)}">${esc(initials(e.name))}</div>`;

        const group = document.createElement('div');
        group.className = 'msg-group is-colab is-other';
        group.innerHTML = `
            <div class="msg-row">
                ${avatarHtml}
                <div class="msg-content-wrap">
                    <div class="msg-header">
                        <span class="msg-author">${esc(e.name || 'Colaborador')}</span>
                        <span class="msg-time">${fmtTime(msg.created_at)}</span>
                    </div>
                    <div class="msg-bubble">${esc(msg.content)}</div>
                </div>
            </div>`;
        list.appendChild(group);
    }

    function appendRhMessage(msg) {
        const list = $('messages-list');
        if (!list) return;

        const isMine = msg.employee_id === analystEmpId;

        const group = document.createElement('div');
        group.className = `msg-group ${isMine ? 'is-mine' : 'is-other'}`;

        const avatarHtml = isMine
            ? ''
            : `
            <div class="msg-avatar rh-avatar" title="Analista RH">
                <i class="fas fa-user-tie" style="font-size:.72rem"></i>
            </div>`;

        group.innerHTML = `
            <div class="msg-row">
                ${avatarHtml}
                <div class="msg-content-wrap">
                    ${!isMine ? `<div class="msg-header"><span class="msg-author" style="color:var(--success)">Analista RH</span><span class="msg-time">${fmtTime(msg.created_at)}</span></div>` : ''}
                    <div class="msg-bubble">${esc(msg.content)}</div>
                    ${isMine ? `<div class="msg-header" style="justify-content:flex-end"><span class="msg-time">${fmtTime(msg.created_at)}</span></div>` : ''}
                </div>
            </div>`;
        list.appendChild(group);
    }

    function appendSystemMessage(content) {
        const list = $('messages-list');
        if (!list) return;
        const group = document.createElement('div');
        group.className = 'msg-group is-system';
        group.innerHTML = `<div class="msg-system"><i class="fas fa-info-circle" style="margin-right:5px;color:var(--success)"></i>${esc(content)}</div>`;
        list.appendChild(group);
    }

    const replyInput = $('hr-reply-input');
    const replySendBtn = $('hr-reply-send');

    replyInput?.addEventListener('input', () => {
        autoResize(replyInput);
        replySendBtn.disabled = !replyInput.value.trim() || currentTicket?.status === 'resolvido';
    });

    replyInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendReply();
        }
    });

    replySendBtn?.addEventListener('click', sendReply);

    async function sendReply() {
        const text = replyInput?.value.trim();
        if (!text || !currentTicketId) return;

        replyInput.value = '';
        replySendBtn.disabled = true;
        autoResize(replyInput);

        const { data: msg, error } = await sb
            .from('hr_ticket_messages')
            .insert({
                ticket_id: currentTicketId,
                employee_id: analystEmpId || null,
                role: 'rh',
                content: text,
            })
            .select()
            .single();

        if (error) {
            showToast('Erro ao enviar resposta', 'error');
            return;
        }

        appendRhMessage(msg);
        scrollBottom('messages-scroll');

        await sb.from('hr_tickets').update({ updated_at: new Date().toISOString() }).eq('id', currentTicketId);
    }

    function subscribeToTicket(ticketId) {
        if (activeTicketSub) sb.removeChannel(activeTicketSub);

        activeTicketSub = sb
            .channel(`rh-ticket:${ticketId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'hr_ticket_messages',
                    filter: `ticket_id=eq.${ticketId}`,
                },
                async (payload) => {
                    const msg = payload.new;
                    if (msg.role === 'rh' && msg.employee_id === analystEmpId) return;

                    if (msg.role === 'user' && msg.employee_id) {
                        const { data: e } = await sb.from('employees').select('name, avatar_url, avatar_color').eq('id', msg.employee_id).single();
                        appendMessage({ ...msg, employees: e || {} });
                    } else {
                        appendMessage(msg);
                    }
                }
            )
            .subscribe();
    }

    function subscribeToNewTickets() {
        sb.channel('rh-all-tickets')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'hr_tickets',
                },
                async (payload) => {
                    const t = payload.new;
                    if (seenTickets.has(t.id)) return;
                    seenTickets.add(t.id);

                    const [{ data: emp }, aboutRes] = await Promise.all([
                        sb.from('employees').select('name, avatar_url, avatar_color, role, dept').eq('id', t.employee_id).single(),
                        t.about_employee_id ? sb.from('employees').select('name').eq('id', t.about_employee_id).single() : Promise.resolve({ data: null }),
                    ]);

                    const enriched = { ...t, employees: emp || {}, about: aboutRes?.data || null };
                    allTickets.unshift(enriched);
                    updateStats();
                    updatePendingBadge();
                    renderTicketList();

                    const toastMsg = t.about_employee_id
                        ? `${emp?.name || 'Gestor'} escalou algo sobre ${aboutRes?.data?.name || 'um colaborador'}`
                        : emp?.name
                          ? `Colaborador: ${emp.name}`
                          : '';
                    showToast('Novo ticket de atendimento', 'info', toastMsg);
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'hr_tickets',
                },
                (payload) => {
                    const updated = payload.new;
                    const idx = allTickets.findIndex((t) => t.id === updated.id);
                    if (idx !== -1) {
                        allTickets[idx] = { ...allTickets[idx], ...updated };
                    }

                    if (currentTicketId === updated.id) {
                        currentTicket = { ...currentTicket, ...updated };
                        updateStatusChip(updated.status);
                        updateActionButtons(updated.status);
                        updateHeaderBadges(currentTicket);
                    }

                    updateStats();
                    updatePendingBadge();
                    renderTicketList();

                    if (currentTicketId) {
                        document.querySelectorAll('.ticket-item').forEach((li) => {
                            li.classList.toggle('active', li.dataset.ticketId === currentTicketId);
                        });
                    }
                }
            )
            .subscribe();
    }

    function showChatArea() {
        $('chat-welcome')?.classList.add('hidden');
        $('chat-area')?.classList.remove('hidden');
    }

    const AF_CAT_LABEL = {
        clima: 'Clima organizacional',
        gestao: 'Gestão / liderança',
        processos: 'Processos internos',
        infraestrutura: 'Infraestrutura',
        outro: 'Outro',
    };
    let allAnonFeedback = [];
    let anonFilter = 'all';

    async function loadAnonFeedback() {
        const { data } = await sb.from('anonymous_feedback').select('*').order('created_at', { ascending: false });
        allAnonFeedback = data || [];
        updateAnonBadge();
        renderAnonFeedback();
    }

    function updateAnonBadge() {
        const badge = $('anon-feedback-badge');
        if (!badge) return;
        const novos = allAnonFeedback.filter((f) => f.status === 'novo').length;
        badge.textContent = novos;
        badge.classList.toggle('hidden', novos === 0);
    }

    function renderAnonFeedback() {
        const list = $('anon-feedback-list');
        if (!list) return;
        const filtered = anonFilter === 'all' ? allAnonFeedback : allAnonFeedback.filter((f) => f.status === anonFilter);
        if (!filtered.length) {
            list.innerHTML = `<p class="af-empty">Nenhum feedback ${anonFilter === 'all' ? '' : `com status "${anonFilter}"`} encontrado.</p>`;
            return;
        }
        list.innerHTML = filtered
            .map(
                (f) => `
            <div class="af-item status-${f.status}">
                <div class="af-item-head">
                    <span class="af-item-cat">${esc(AF_CAT_LABEL[f.categoria] || f.categoria)}</span>
                    <span class="af-item-time">${fmtAgo(f.created_at)}</span>
                </div>
                <p class="af-item-msg">${esc(f.message)}</p>
                <div class="af-item-actions">
                    ${f.status !== 'lido' ? `<button class="af-item-btn" onclick="markAnonFeedback('${f.id}','lido')"><i class="fas fa-check"></i> Marcar como lido</button>` : ''}
                    ${f.status !== 'arquivado' ? `<button class="af-item-btn" onclick="markAnonFeedback('${f.id}','arquivado')"><i class="fas fa-box-archive"></i> Arquivar</button>` : ''}
                </div>
            </div>`
            )
            .join('');
    }

    document.querySelectorAll('.af-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
            anonFilter = btn.dataset.filter;
            document.querySelectorAll('.af-chip').forEach((b) => b.classList.toggle('active', b === btn));
            renderAnonFeedback();
        });
    });

    window.markAnonFeedback = async function (id, status) {
        const { error } = await sb.from('anonymous_feedback').update({ status }).eq('id', id);
        if (error) return;
        const item = allAnonFeedback.find((f) => f.id === id);
        if (item) item.status = status;
        updateAnonBadge();
        renderAnonFeedback();
    };

    $('btn-open-anon-feedback')?.addEventListener('click', () => {
        $('anon-feedback-modal')?.classList.add('open');
    });

    window.closeAnonFeedbackModal = function () {
        $('anon-feedback-modal')?.classList.remove('open');
    };

    function subscribeToAnonFeedback() {
        sb.channel('rh-anon-feedback')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'anonymous_feedback' }, () => {
                loadAnonFeedback();
                showToast('Novo feedback anônimo recebido', 'info');
            })
            .subscribe();
    }

    window.showToast = function (title, type = 'success', msg = '') {
        const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
        const container = $('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
            <div class="toast-content">
                <p class="toast-title">${esc(title)}</p>
                ${msg ? `<p class="toast-msg">${esc(msg)}</p>` : ''}
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
        }, 5000);
    };

    window.logout = async function () {
        await sb.auth.signOut();
        window.location.href = '../screens/login.html';
    };

    function autoResize(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    await loadTickets();
    subscribeToNewTickets();
    await loadAnonFeedback();
    subscribeToAnonFeedback();

    setInterval(() => {
        renderTicketList();
        updateStats();
        if (currentTicket) updateHeaderBadges(currentTicket);
    }, 60000);
});