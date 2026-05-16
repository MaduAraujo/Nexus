document.addEventListener('DOMContentLoaded', async () => {

    // ── Auth (Administrador) ──────────────────────────────────────────────────
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles')
        .select('profile, employee_id').eq('id', user.id).single();

    if (profile?.profile !== 'Administrador') {
        window.location.href = '../screens/login.html'; return;
    }

    // Info do analista logado
    let analystName  = 'Analista RH';
    let analystEmpId = profile.employee_id;
    if (analystEmpId) {
        const { data: e } = await sb.from('employees').select('name').eq('id', analystEmpId).single();
        if (e?.name) analystName = e.name;
    }

    // ── Estado ────────────────────────────────────────────────────────────────
    let allTickets       = [];
    let currentFilter    = 'all';
    let currentTicketId  = null;
    let currentTicket    = null;
    let activeTicketSub  = null;
    let newTicketsSub    = null;
    const seenTickets    = new Set(); // IDs já vistos (para notificar novos)

    // ── Utilidades ────────────────────────────────────────────────────────────
    const esc = s => String(s || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    const initials = name =>
        (name || '?').split(' ').slice(0,2).map(w => w[0]?.toUpperCase() || '').join('');

    const fmtTime = ts => new Date(ts).toLocaleTimeString('pt-BR',{ hour:'2-digit', minute:'2-digit' });

    const fmtAgo = ts => {
        const d = Math.floor((Date.now() - new Date(ts)) / 60000);
        if (d < 1) return 'agora';
        if (d < 60) return `${d}min`;
        const h = Math.floor(d / 60);
        if (h < 24) return `${h}h`;
        return new Date(ts).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
    };

    const scrollBottom = id => {
        const el = document.getElementById(id);
        if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    };

    const $ = id => document.getElementById(id);

    const statusLabel = {
        bot: 'Bot',
        aguardando_rh: 'Aguardando RH',
        em_atendimento: 'Em atendimento',
        resolvido: 'Resolvido'
    };

    const statusDotClass = {
        bot: 'tsd-bot',
        aguardando_rh: 'tsd-waiting',
        em_atendimento: 'tsd-human',
        resolvido: 'tsd-solved'
    };

    // ── Painel esquerdo mobile (chat-left drawer) ─────────────────────────────
    const chatLeft    = document.getElementById('chat-left');
    const chatOverlay = document.getElementById('chat-overlay');
    const panelBtn    = document.getElementById('topbar-panels-btn');

    const openChatLeft  = () => { chatLeft?.classList.add('open'); chatOverlay?.classList.add('active'); };
    const closeChatLeft = () => { chatLeft?.classList.remove('open'); chatOverlay?.classList.remove('active'); };

    panelBtn?.addEventListener('click',   openChatLeft);
    chatOverlay?.addEventListener('click', closeChatLeft);

    // ── Filtros ───────────────────────────────────────────────────────────────
    document.querySelectorAll('.tf-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            document.querySelectorAll('.tf-chip').forEach(b => b.classList.toggle('active', b === btn));
            renderTicketList();
        });
    });

    // ── Carregar tickets ──────────────────────────────────────────────────────
    async function loadTickets() {
        const { data: tickets } = await sb.from('hr_tickets')
            .select('*, employees(name, avatar_url, avatar_color, role, dept)')
            .order('updated_at', { ascending: false });

        allTickets = tickets || [];
        allTickets.forEach(t => seenTickets.add(t.id));
        updateStats();
        renderTicketList();
        updatePendingBadge();
    }

    function updateStats() {
        const waiting = allTickets.filter(t => t.status === 'aguardando_rh').length;
        const active  = allTickets.filter(t => t.status === 'em_atendimento').length;
        const solved  = allTickets.filter(t => t.status === 'resolvido').length;

        const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
        set('stat-total',   allTickets.length);
        set('stat-waiting', waiting);
        set('stat-active',  active);
        set('stat-solved',  solved);
    }

    function updatePendingBadge() {
        const waiting = allTickets.filter(t => t.status === 'aguardando_rh').length;
        const badge = $('sidebar-pending-badge');
        const pill  = $('pending-pill');
        const cnt   = $('pending-count');

        if (badge) { badge.textContent = waiting; badge.style.display = waiting > 0 ? 'inline-flex' : 'none'; }
        if (pill)  { pill.style.display = waiting > 0 ? 'flex' : 'none'; }
        if (cnt)   { cnt.textContent = waiting; }
    }

    function renderTicketList() {
        const list = $('ticket-list');
        if (!list) return;

        let filtered = allTickets;
        if (currentFilter !== 'all') {
            filtered = allTickets.filter(t => t.status === currentFilter);
        }

        // Ordena: aguardando_rh → em_atendimento → bot → resolvido
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

        filtered.forEach(ticket => list.appendChild(buildTicketItem(ticket)));
    }

    function buildTicketItem(ticket) {
        const e   = ticket.employees || {};
        const li  = document.createElement('li');
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
                </div>
            </div>
            <div class="ti-time">${fmtAgo(ticket.updated_at || ticket.created_at)}</div>
            ${isNew ? `<div class="ti-new-dot" title="Aguardando resposta"></div>` : ''}
        `;

        li.addEventListener('click', () => selectTicket(ticket));
        return li;
    }

    // ── Selecionar ticket ──────────────────────────────────────────────────────
    async function selectTicket(ticket) {
        currentTicketId = ticket.id;
        currentTicket   = ticket;
        const emp       = ticket.employees || {};

        // Atualiza lista
        document.querySelectorAll('.ticket-item').forEach(li => {
            li.classList.toggle('active', li.dataset.ticketId === ticket.id);
        });

        // Header: info do colaborador
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
        if (metaEl) metaEl.textContent = [emp.role, emp.dept].filter(Boolean).join(' · ');

        updateStatusChip(ticket.status);
        updateActionButtons(ticket.status);

        // Mostra área e fecha painel mobile
        showChatArea();
        closeChatLeft();

        // Carrega mensagens e assina realtime
        await loadTicketMessages(ticket.id);
        subscribeToTicket(ticket.id);

        // Se estava aguardando, atualiza para "em atendimento" automaticamente
        if (ticket.status === 'aguardando_rh') {
            await markStatus('em_atendimento');
        }
    }

    function updateStatusChip(status) {
        const dot   = $('status-chip-dot');
        const label = $('status-chip-label');
        if (!dot || !label) return;

        dot.className = 'presence-dot';
        const dotMap = { bot: 'offline', aguardando_rh: 'away', em_atendimento: 'online', resolvido: 'offline' };
        dot.classList.add(dotMap[status] || 'offline');
        label.textContent = statusLabel[status] || status;
    }

    function updateActionButtons(status) {
        const btnAtend   = $('btn-em-atend');
        const btnResolve = $('btn-resolver');
        const input      = $('hr-reply-input');
        const sendBtn    = $('hr-reply-send');

        if (btnAtend)   btnAtend.style.display   = status === 'aguardando_rh' ? 'flex' : 'none';
        if (btnResolve) btnResolve.style.display  = status === 'em_atendimento' ? 'flex' : 'none';

        const disabled = status === 'resolvido' || status === 'bot';
        if (input)   input.disabled   = disabled;
        if (sendBtn) sendBtn.disabled = disabled;
    }

    // ── Ações de status ────────────────────────────────────────────────────────
    $('btn-em-atend')?.addEventListener('click',  () => markStatus('em_atendimento'));
    $('btn-resolver')?.addEventListener('click',  () => markStatus('resolvido'));

    async function markStatus(newStatus) {
        if (!currentTicketId) return;

        await sb.from('hr_tickets').update({ status: newStatus }).eq('id', currentTicketId);

        // Atualiza localmente
        currentTicket = { ...currentTicket, status: newStatus };
        const idx = allTickets.findIndex(t => t.id === currentTicketId);
        if (idx !== -1) allTickets[idx] = { ...allTickets[idx], status: newStatus, updated_at: new Date().toISOString() };

        updateStats();
        updatePendingBadge();
        renderTicketList();
        updateStatusChip(newStatus);
        updateActionButtons(newStatus);

        // Restaura item ativo na lista
        document.querySelectorAll('.ticket-item').forEach(li => {
            li.classList.toggle('active', li.dataset.ticketId === currentTicketId);
        });

        if (newStatus === 'resolvido') {
            appendSystemMessage('— Atendimento encerrado pelo analista de RH —');
            showToast('Ticket encerrado', 'success', 'O colaborador foi notificado.');
        }
    }

    // ── Carregar mensagens do ticket ──────────────────────────────────────────
    async function loadTicketMessages(ticketId) {
        const list = $('messages-list');
        if (!list) return;
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:.82rem;"><i class="fas fa-spinner fa-spin"></i></div>`;

        const { data: msgs } = await sb.from('hr_ticket_messages')
            .select('*, employees(name, avatar_url, avatar_color)')
            .eq('ticket_id', ticketId)
            .order('created_at', { ascending: true });

        list.innerHTML = '';
        (msgs || []).forEach(m => appendMessage(m, false));
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

        // Mensagens de sistema do bot (transferência, etc.)
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

        const avatarHtml = isMine ? '' : `
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

    // ── Enviar resposta ────────────────────────────────────────────────────────
    const replyInput   = $('hr-reply-input');
    const replySendBtn = $('hr-reply-send');

    replyInput?.addEventListener('input', () => {
        autoResize(replyInput);
        replySendBtn.disabled = !replyInput.value.trim() || currentTicket?.status === 'resolvido';
    });

    replyInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
    });

    replySendBtn?.addEventListener('click', sendReply);

    async function sendReply() {
        const text = replyInput?.value.trim();
        if (!text || !currentTicketId) return;

        replyInput.value = '';
        replySendBtn.disabled = true;
        autoResize(replyInput);

        const { data: msg, error } = await sb.from('hr_ticket_messages').insert({
            ticket_id:   currentTicketId,
            employee_id: analystEmpId || null,
            role:        'rh',
            content:     text
        }).select().single();

        if (error) { showToast('Erro ao enviar resposta', 'error'); return; }

        // Renderiza imediatamente (otimista)
        appendRhMessage(msg);
        scrollBottom('messages-scroll');

        // Atualiza updated_at do ticket
        await sb.from('hr_tickets').update({ updated_at: new Date().toISOString() }).eq('id', currentTicketId);
    }

    // ── Realtime: ticket ativo ─────────────────────────────────────────────────
    function subscribeToTicket(ticketId) {
        if (activeTicketSub) sb.removeChannel(activeTicketSub);

        activeTicketSub = sb.channel(`rh-ticket:${ticketId}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'hr_ticket_messages',
                filter: `ticket_id=eq.${ticketId}`
            }, async payload => {
                const msg = payload.new;
                // Evita duplicar mensagens do analista (já renderizado otimisticamente)
                if (msg.role === 'rh' && msg.employee_id === analystEmpId) return;

                // Busca dados do employee se for mensagem do colaborador
                if (msg.role === 'user' && msg.employee_id) {
                    const { data: e } = await sb.from('employees')
                        .select('name, avatar_url, avatar_color').eq('id', msg.employee_id).single();
                    appendMessage({ ...msg, employees: e || {} });
                } else {
                    appendMessage(msg);
                }
            })
            .subscribe();
    }

    // ── Realtime: novos tickets (qualquer colaborador) ─────────────────────────
    function subscribeToNewTickets() {
        newTicketsSub = sb.channel('rh-all-tickets')
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'hr_tickets'
            }, async payload => {
                const t = payload.new;
                if (seenTickets.has(t.id)) return;
                seenTickets.add(t.id);

                // Busca dados do colaborador
                const { data: emp } = await sb.from('employees')
                    .select('name, avatar_url, avatar_color, role, dept')
                    .eq('id', t.employee_id).single();

                const enriched = { ...t, employees: emp || {} };
                allTickets.unshift(enriched);
                updateStats();
                updatePendingBadge();
                renderTicketList();

                showToast('Novo ticket de atendimento', 'info', emp?.name ? `Colaborador: ${emp.name}` : '');
            })
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'hr_tickets'
            }, payload => {
                const updated = payload.new;
                const idx = allTickets.findIndex(t => t.id === updated.id);
                if (idx !== -1) {
                    allTickets[idx] = { ...allTickets[idx], ...updated };
                }

                // Atualiza chip e botões se for o ticket aberto
                if (currentTicketId === updated.id) {
                    currentTicket = { ...currentTicket, ...updated };
                    updateStatusChip(updated.status);
                    updateActionButtons(updated.status);
                }

                updateStats();
                updatePendingBadge();
                renderTicketList();

                // Restaura item ativo
                if (currentTicketId) {
                    document.querySelectorAll('.ticket-item').forEach(li => {
                        li.classList.toggle('active', li.dataset.ticketId === currentTicketId);
                    });
                }
            })
            .subscribe();
    }

    // ── Visibilidade das áreas ────────────────────────────────────────────────
    function showChatArea() {
        $('chat-welcome')?.classList.add('hidden');
        $('chat-area')?.classList.remove('hidden');
    }

    // ── Toast ─────────────────────────────────────────────────────────────────
    window.showToast = function (title, type = 'success', msg = '') {
        const icons = { success:'fa-check', error:'fa-times', warning:'fa-exclamation-triangle', info:'fa-info' };
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
        setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 400); }, 5000);
    };

    // ── Logout ────────────────────────────────────────────────────────────────
    window.logout = async function () {
        await sb.auth.signOut();
        window.location.href = '../screens/login.html';
    };

    // ── Helper ────────────────────────────────────────────────────────────────
    function autoResize(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    await loadTickets();
    subscribeToNewTickets();
});
