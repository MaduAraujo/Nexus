document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('colaborador', '*');
    if (!auth) return;
    const myEmployeeId = auth.profile.employee_id;
    const myEmployee = auth.employee;

    let currentTab = 'social';
    let currentChannelId = null;
    let currentTicketId = null;
    let isEscalated = false;
    let activeChatSub = null;
    let activeTicketSub = null;
    let typingTimer = null;
    const unreadCounts = {};

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
        if (d < 60) return `${d}min atrás`;
        const h = Math.floor(d / 60);
        if (h < 24) return `${h}h atrás`;
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

    const chatLeft = document.getElementById('chat-left');
    const chatOverlay = document.getElementById('chat-overlay');
    const panelsBtn = document.getElementById('topbar-panels-btn');

    const openChatLeft = () => {
        chatLeft?.classList.add('open');
        chatOverlay?.classList.add('active');
    };
    const closeChatLeft = () => {
        chatLeft?.classList.remove('open');
        chatOverlay?.classList.remove('active');
    };

    panelsBtn?.addEventListener('click', openChatLeft);
    chatOverlay?.addEventListener('click', closeChatLeft);

    const tabBtns = document.querySelectorAll('.chat-tab');
    const panelMap = { social: $('panel-social'), rh: $('panel-rh'), kudos: $('panel-kudos') };

    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab === currentTab) return;
            currentTab = tab;
            tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
            Object.entries(panelMap).forEach(([k, el]) => {
                if (el) el.classList.toggle('hidden', k !== tab);
            });
            if (tab === 'rh' && !currentTicketId) showWelcome();
            if (tab === 'social' && !currentChannelId) showWelcome();
            if (tab === 'kudos') showKudosArea();
        });
    });

    const chatWelcome = $('chat-welcome');
    const chatArea = $('chat-area');
    const hrArea = $('hr-area');
    const kudosArea = $('kudos-area');

    function showWelcome() {
        chatWelcome?.classList.remove('hidden');
        chatArea?.classList.add('hidden');
        hrArea?.classList.add('hidden');
        kudosArea?.classList.add('hidden');
    }

    function showChatArea() {
        chatWelcome?.classList.add('hidden');
        chatArea?.classList.remove('hidden');
        hrArea?.classList.add('hidden');
        kudosArea?.classList.add('hidden');
    }

    function showHrArea() {
        chatWelcome?.classList.add('hidden');
        chatArea?.classList.add('hidden');
        hrArea?.classList.remove('hidden');
        kudosArea?.classList.add('hidden');
    }

    function showKudosArea() {
        chatWelcome?.classList.add('hidden');
        chatArea?.classList.add('hidden');
        hrArea?.classList.add('hidden');
        kudosArea?.classList.remove('hidden');
    }

    function setTopbarChannel(icon, name) {
        const iconEl = $('topbar-channel-icon');
        const nameEl = $('topbar-channel-name');
        if (iconEl) iconEl.innerHTML = icon;
        if (nameEl) nameEl.textContent = name;
    }

    let onlineCount = 0;

    function setupPresence() {
        const presenceCh = sb.channel('chat:presence', {
            config: { presence: { key: myEmployeeId } },
        });

        presenceCh
            .on('presence', { event: 'sync' }, () => {
                const state = presenceCh.presenceState();
                onlineCount = Object.keys(state).length;
                updatePresenceUI();
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await presenceCh.track({
                        employee_id: myEmployeeId,
                        name: myEmployee.name,
                        online_at: new Date().toISOString(),
                    });
                }
            });
    }

    function updatePresenceUI() {
        const pill = $('presence-pill');
        const numEl = $('presence-number');
        if (!pill || !numEl) return;
        numEl.textContent = onlineCount;
        pill.style.display = currentChannelId ? 'flex' : 'none';
    }

    function avatarStyle(e) {
        if (!e) return `style="background:#6366f1"`;
        if (e.avatar_url) return `style="background:url(${e.avatar_url}) center/cover"`;
        return `style="background:${e.avatar_color || '#6366f1'}"`;
    }

    let allChannels = [];

    async function loadChannels() {
        const list = $('channel-list');
        if (!list) return;

        const { data: channels } = await sb.from('chat_channels').select('*').order('name');
        allChannels = channels || [];

        const geral = allChannels.find((c) => c.slug === 'geral');
        if (geral) await joinChannel(geral.id);
        if (myEmployee.dept) {
            const deptSlug = myEmployee.dept
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
            const deptCh = allChannels.find((c) => c.dept === myEmployee.dept || c.slug === deptSlug);
            if (deptCh) await joinChannel(deptCh.id);
        }

        const { data: memberships } = await sb.from('chat_channel_members').select('channel_id').eq('employee_id', myEmployeeId);

        const memberOf = new Set((memberships || []).map((m) => m.channel_id));

        list.innerHTML = '';

        const mine = allChannels.filter((c) => memberOf.has(c.id));
        const other = allChannels.filter((c) => !memberOf.has(c.id));

        if (mine.length) {
            const hd = document.createElement('li');
            hd.className = 'channel-section-hd';
            hd.style.cssText =
                'display:list-item;padding:10px 16px 4px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(156,163,175,.7);';
            hd.textContent = 'Meus canais';
            list.appendChild(hd);
            mine.forEach((c) => list.appendChild(buildChannelItem(c, true)));
        }

        if (other.length) {
            const hd = document.createElement('li');
            hd.className = 'channel-section-hd';
            hd.style.cssText =
                'display:list-item;padding:10px 16px 4px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(156,163,175,.7);margin-top:8px;';
            hd.textContent = 'Outros canais';
            list.appendChild(hd);
            other.forEach((c) => list.appendChild(buildChannelItem(c, false)));
        }

        if (!mine.length && !other.length) {
            list.innerHTML = '<li class="ch-loading"><span>Nenhum canal disponível</span></li>';
        }
    }

    function buildChannelItem(channel, isMember) {
        const li = document.createElement('li');
        li.className = 'channel-item';
        li.dataset.channelId = channel.id;
        li.dataset.member = isMember ? '1' : '0';

        const unread = unreadCounts[channel.id] || 0;
        const iconMap = {
            globe: 'fa-globe',
            code: 'fa-code',
            'user-tie': 'fa-user-tie',
            'dollar-sign': 'fa-dollar-sign',
            bullhorn: 'fa-bullhorn',
            gavel: 'fa-gavel',
            building: 'fa-building',
            lightbulb: 'fa-lightbulb',
        };
        const faIcon = iconMap[channel.icon] || 'fa-hashtag';

        li.innerHTML = `
            <span class="ch-icon"><i class="fas ${faIcon}"></i></span>
            <span class="ch-name">${esc(channel.name)}</span>
            ${unread > 0 ? `<span class="ch-badge" id="badge-${channel.id}">${unread}</span>` : `<span class="ch-badge" id="badge-${channel.id}" style="display:none">${unread}</span>`}
        `;

        li.addEventListener('click', () => selectChannel(channel, isMember));
        return li;
    }

    async function joinChannel(channelId) {
        await sb
            .from('chat_channel_members')
            .upsert({ channel_id: channelId, employee_id: myEmployeeId }, { onConflict: 'channel_id,employee_id', ignoreDuplicates: true });
    }

    async function selectChannel(channel, isMember) {
        if (!isMember) {
            await joinChannel(channel.id);
            isMember = true;
        }

        currentChannelId = channel.id;
        currentTicketId = null;
        isEscalated = false;

        document.querySelectorAll('.channel-item').forEach((li) => {
            li.classList.toggle('active', li.dataset.channelId === channel.id);
        });

        unreadCounts[channel.id] = 0;
        updateChannelBadge(channel.id);
        updateSidebarUnread();

        setTopbarChannel('#', channel.name);
        const areaName = $('chat-area-name');
        const areaDesc = $('chat-area-desc');
        if (areaName) areaName.textContent = `#${channel.name}`;
        if (areaDesc) areaDesc.textContent = channel.description || '';

        const input = $('chat-input');
        if (input) input.placeholder = `Mensagem para #${channel.name}...`;

        showChatArea();

        const pill = $('presence-pill');
        if (pill) pill.style.display = 'flex';

        await loadMessages(channel.id);
        subscribeToChannel(channel.id);
        subscribeToTyping(channel.id);
    }

    async function loadMessages(channelId) {
        const list = $('messages-list');
        if (!list) return;
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:.82rem;"><i class="fas fa-spinner fa-spin"></i></div>`;

        const { data: msgs } = await sb
            .from('chat_messages')
            .select('*, employees(name, avatar_url, avatar_color, role)')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: true })
            .limit(80);

        list.innerHTML = '';
        (msgs || []).forEach((m) => appendMessage(m, false));
        scrollBottom('messages-scroll');
    }

    function appendMessage(msg, doScroll = true) {
        const list = $('messages-list');
        if (!list) return;
        const e = msg.employees || {};
        const mine = msg.employee_id === myEmployeeId;

        const group = document.createElement('div');
        group.className = `msg-group ${mine ? 'is-mine' : 'is-other'}`;

        const avatarStr = mine
            ? ''
            : `
            <div class="msg-avatar" ${avatarStyle(e)} title="${esc(e.name)}">
                ${e.avatar_url ? '' : esc(initials(e.name))}
            </div>`;

        group.innerHTML = `
            <div class="msg-row">
                ${avatarStr}
                <div class="msg-content-wrap">
                    ${!mine ? `<div class="msg-header"><span class="msg-author">${esc(e.name)}</span><span class="msg-time">${fmtTime(msg.created_at)}</span></div>` : ''}
                    <div class="msg-bubble">${esc(msg.content)}</div>
                    ${mine ? `<div class="msg-header" style="justify-content:flex-end"><span class="msg-time">${fmtTime(msg.created_at)}</span></div>` : ''}
                </div>
            </div>`;

        list.appendChild(group);
        if (doScroll) scrollBottom('messages-scroll');
    }

    function subscribeToChannel(channelId) {
        if (activeChatSub) sb.removeChannel(activeChatSub);

        activeChatSub = sb
            .channel(`chat:${channelId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_messages',
                    filter: `channel_id=eq.${channelId}`,
                },
                async (payload) => {
                    const msg = payload.new;
                    if (msg.employee_id === myEmployeeId) return;

                    const { data: e } = await sb.from('employees').select('name, avatar_url, avatar_color, role').eq('id', msg.employee_id).single();
                    appendMessage({ ...msg, employees: e || {} });

                    if (currentChannelId !== channelId) {
                        unreadCounts[channelId] = (unreadCounts[channelId] || 0) + 1;
                        updateChannelBadge(channelId);
                        updateSidebarUnread();
                    }
                }
            )
            .subscribe();
    }

    let typingChannel = null;

    function subscribeToTyping(channelId) {
        if (typingChannel) sb.removeChannel(typingChannel);

        typingChannel = sb
            .channel(`typing:${channelId}`)
            .on('broadcast', { event: 'typing' }, (payload) => {
                if (payload.payload?.employee_id === myEmployeeId) return;
                showTyping(payload.payload?.name || 'alguém');
                clearTimeout(typingTimer);
                typingTimer = setTimeout(hideTyping, 2500);
            })
            .subscribe();
    }

    function showTyping(name) {
        const ind = $('typing-indicator');
        const text = $('typing-text');
        if (ind) ind.classList.remove('hidden');
        if (text) text.textContent = `${name} está digitando...`;
        scrollBottom('messages-scroll');
    }

    function hideTyping() {
        $('typing-indicator')?.classList.add('hidden');
    }

    const chatInput = $('chat-input');
    const chatSendBtn = $('chat-send-btn');

    chatInput?.addEventListener('input', () => {
        autoResize(chatInput);
        chatSendBtn.disabled = !chatInput.value.trim();

        if (currentChannelId && typingChannel) {
            typingChannel.send({
                type: 'broadcast',
                event: 'typing',
                payload: { employee_id: myEmployeeId, name: myEmployee.name },
            });
        }
    });

    chatInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendSocialMessage();
        }
    });

    chatSendBtn?.addEventListener('click', sendSocialMessage);

    async function sendSocialMessage() {
        const text = chatInput?.value.trim();
        if (!text || !currentChannelId) return;

        chatInput.value = '';
        chatSendBtn.disabled = true;
        autoResize(chatInput);

        const { data: msg, error } = await sb
            .from('chat_messages')
            .insert({
                channel_id: currentChannelId,
                employee_id: myEmployeeId,
                content: text,
            })
            .select()
            .single();

        if (error) {
            showToast('Erro ao enviar mensagem', 'error');
            return;
        }

        appendMessage({ ...msg, employees: myEmployee });
    }

    function updateChannelBadge(channelId) {
        const badge = document.getElementById(`badge-${channelId}`);
        if (!badge) return;
        const count = unreadCounts[channelId] || 0;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }

    function updateSidebarUnread() {}

    const HR_BOT_GREETING = `Olá, ${myEmployee.name?.split(' ')[0] || 'colaborador'}! Sou o Agente de Atendimento RH.
Com o que posso te ajudar hoje?`;

    const HR_TOPICS = ['Qual meu saldo de férias?', 'Quando vence meu banco de horas?', 'Meu último holerite', 'Documentos', 'Falar com analista'];

    let allTickets = [];

    async function loadTickets() {
        const list = $('ticket-list');
        if (!list) return;

        const [{ data: tickets }, { data: hidden }] = await Promise.all([
            sb.from('hr_tickets').select('*').eq('employee_id', myEmployeeId).order('updated_at', { ascending: false }),
            sb.from('hr_ticket_hidden').select('ticket_id').eq('employee_id', myEmployeeId),
        ]);

        const hiddenIds = new Set((hidden || []).map((h) => h.ticket_id));
        allTickets = (tickets || []).filter((t) => !hiddenIds.has(t.id));
        renderTicketList();
    }

    function renderTicketList() {
        const list = $('ticket-list');
        if (!list) return;
        list.innerHTML = '';

        if (!allTickets.length) {
            list.innerHTML =
                '<li class="ch-loading" style="flex-direction:column;align-items:flex-start;gap:4px;"><span style="color:rgba(156,163,175,.9)">Nenhuma conversa ainda</span></li>';
            return;
        }

        allTickets.forEach((t) => list.appendChild(buildTicketItem(t)));
    }

    const statusLabel = { bot: 'Bot', aguardando_rh: 'Aguardando RH', em_atendimento: 'Em atendimento', resolvido: 'Resolvido' };
    const statusDot = { bot: 'tsd-bot', aguardando_rh: 'tsd-waiting', em_atendimento: 'tsd-human', resolvido: 'tsd-solved' };

    function closeAllTicketMenus() {
        document.querySelectorAll('.ticket-menu-dropdown.open').forEach((el) => el.classList.remove('open'));
    }
    document.addEventListener('click', closeAllTicketMenus);

    function buildTicketItem(ticket) {
        const li = document.createElement('li');
        li.className = 'ticket-item';
        li.dataset.ticketId = ticket.id;
        li.innerHTML = `
            <div class="ticket-item-head">
                <span class="ticket-subject">${esc(ticket.subject)}</span>
                <div class="ticket-menu-wrap">
                    <button class="ticket-menu-btn" aria-label="Opções da conversa" title="Opções">
                        <i class="fas fa-ellipsis-vertical"></i>
                    </button>
                    <div class="ticket-menu-dropdown">
                        <button type="button" class="ticket-menu-option" data-action="me">
                            <i class="fas fa-eye-slash"></i> Apagar somente para mim
                        </button>
                        <button type="button" class="ticket-menu-option ticket-menu-option--danger" data-action="all">
                            <i class="fas fa-trash"></i> Apagar para todos
                        </button>
                    </div>
                </div>
            </div>
            <div class="ticket-meta">
                <span class="ticket-status-dot ${statusDot[ticket.status] || 'tsd-bot'}"></span>
                <span>${statusLabel[ticket.status] || ticket.status}</span>
                <span>·</span>
                <span>${fmtAgo(ticket.updated_at || ticket.created_at)}</span>
            </div>`;

        li.addEventListener('click', () => selectTicket(ticket));

        const menuBtn = li.querySelector('.ticket-menu-btn');
        const menuDropdown = li.querySelector('.ticket-menu-dropdown');
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = !menuDropdown.classList.contains('open');
            closeAllTicketMenus();
            menuDropdown.classList.toggle('open', willOpen);
        });
        li.querySelector('[data-action="me"]').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTicketForMe(ticket);
        });
        li.querySelector('[data-action="all"]').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteTicketForAll(ticket);
        });

        return li;
    }

    function removeTicketFromList(ticketId) {
        allTickets = allTickets.filter((t) => t.id !== ticketId);
        renderTicketList();
        if (currentTicketId === ticketId) {
            currentTicketId = null;
            isEscalated = false;
            if (activeTicketSub) {
                sb.removeChannel(activeTicketSub);
                activeTicketSub = null;
            }
            showWelcome();
        }
    }

    async function deleteTicketForMe(ticket) {
        if (!confirm('Apagar esta conversa apenas para você? Ela continua disponível para o RH.')) return;

        const { error } = await sb.from('hr_ticket_hidden').upsert({ employee_id: myEmployeeId, ticket_id: ticket.id });
        if (error) {
            showToast('Erro ao apagar conversa', 'error');
            return;
        }

        removeTicketFromList(ticket.id);
        showToast('Conversa apagada para você', 'success');
    }

    async function deleteTicketForAll(ticket) {
        if (!confirm('Apagar esta conversa para todos? Ela será removida definitivamente, inclusive do RH.')) return;

        const { error } = await sb.from('hr_tickets').delete().eq('id', ticket.id);
        if (error) {
            showToast('Erro ao apagar conversa', 'error');
            return;
        }

        removeTicketFromList(ticket.id);
        showToast('Conversa apagada para todos', 'success');
    }

    $('new-ticket-btn')?.addEventListener('click', createTicket);

    async function createTicket() {
        const { data: ticket, error } = await sb
            .from('hr_tickets')
            .insert({
                employee_id: myEmployeeId,
                subject: 'Atendimento RH',
                status: 'bot',
            })
            .select()
            .single();

        if (error || !ticket) {
            showToast('Erro ao iniciar atendimento', 'error');
            return;
        }

        allTickets.unshift(ticket);
        renderTicketList();
        await selectTicket(ticket);
    }

    async function selectTicket(ticket) {
        currentTicketId = ticket.id;
        currentChannelId = null;
        isEscalated = ticket.status === 'aguardando_rh' || ticket.status === 'em_atendimento';

        document.querySelectorAll('.ticket-item').forEach((li) => {
            li.classList.toggle('active', li.dataset.ticketId === ticket.id);
        });

        setTopbarChannel('<i class="fas fa-headset" style="color:var(--accent-hr)"></i>', 'Agente RH');

        const areaName = $('hr-area-name');
        const areaStatus = $('hr-area-status');
        if (areaName) areaName.textContent = ticket.subject || 'Atendimento RH';
        if (areaStatus) areaStatus.textContent = statusLabel[ticket.status] || 'Bot';
        updateHrStatusBadge(ticket.status);

        const hrInput = $('hr-input');
        if (hrInput) hrInput.disabled = ticket.status === 'resolvido';
        const hrSendBtn = $('hr-send-btn');
        if (hrSendBtn) hrSendBtn.disabled = ticket.status === 'resolvido';

        showHrArea();

        await loadTicketMessages(ticket.id);
        subscribeToTicket(ticket.id);

        const list = $('hr-messages-list');
        if (list && list.children.length === 0) {
            await sendBotMessage(ticket.id, HR_BOT_GREETING, HR_TOPICS);
        }

        maybeShowCsatPrompt(ticket);
    }

    function maybeShowCsatPrompt(ticket) {
        if (ticket.status !== 'resolvido' || ticket.csat_rating) return;
        const list = $('hr-messages-list');
        if (!list || list.querySelector('.csat-prompt')) return;

        const wrap = document.createElement('div');
        wrap.className = 'csat-prompt';
        wrap.innerHTML = `
            <span>Como você avalia este atendimento?</span>
            <div class="csat-stars">
                ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="csat-star" data-rating="${n}" aria-label="${n} estrela${n > 1 ? 's' : ''}"><i class="fas fa-star"></i></button>`).join('')}
            </div>`;

        const stars = wrap.querySelectorAll('.csat-star');
        stars.forEach((btn) => {
            btn.addEventListener('mouseenter', () => highlightStars(stars, Number(btn.dataset.rating)));
            btn.addEventListener('click', () => submitCsat(ticket.id, Number(btn.dataset.rating), wrap));
        });
        wrap.addEventListener('mouseleave', () => highlightStars(stars, 0));

        list.appendChild(wrap);
        scrollBottom('hr-messages-scroll');
    }

    function highlightStars(stars, rating) {
        stars.forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.rating) <= rating));
    }

    async function submitCsat(ticketId, rating, wrapEl) {
        const { error } = await sb.from('hr_tickets').update({ csat_rating: rating, csat_rated_at: new Date().toISOString() }).eq('id', ticketId);
        if (error) {
            showToast('Não foi possível enviar sua avaliação', 'error');
            return;
        }

        const idx = allTickets.findIndex((t) => t.id === ticketId);
        if (idx !== -1) allTickets[idx] = { ...allTickets[idx], csat_rating: rating };

        wrapEl.innerHTML = `<span class="csat-thanks"><i class="fas fa-circle-check" style="color:var(--success)"></i> Obrigado pela avaliação!</span>`;
        showToast('Avaliação enviada, obrigado!', 'success');
    }

    function updateHrStatusBadge(status) {
        const dot = $('hr-status-dot');
        const label = $('hr-status-label');
        if (dot) {
            dot.className = 'presence-dot';
            if (status === 'bot') dot.classList.add('online');
            else if (status === 'aguardando_rh') dot.classList.add('away');
            else if (status === 'em_atendimento') dot.classList.add('online');
            else dot.classList.add('offline');
        }
        if (label) label.textContent = statusLabel[status] || status;
    }

    async function loadTicketMessages(ticketId) {
        const list = $('hr-messages-list');
        if (!list) return;
        list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:.82rem;"><i class="fas fa-spinner fa-spin"></i></div>`;

        const { data: msgs } = await sb.from('hr_ticket_messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });

        list.innerHTML = '';
        (msgs || []).forEach((m) => appendTicketMessage(m, false));
        scrollBottom('hr-messages-scroll');
    }

    function appendTicketMessage(msg, doScroll = true) {
        const list = $('hr-messages-list');
        if (!list) return;

        if (msg.role === 'user') {
            const group = document.createElement('div');
            group.className = 'msg-group is-mine';
            group.innerHTML = `
                <div class="msg-row">
                    <div class="msg-content-wrap">
                        <div class="msg-bubble">${esc(msg.content)}</div>
                        <div class="msg-header" style="justify-content:flex-end"><span class="msg-time">${fmtTime(msg.created_at)}</span></div>
                    </div>
                </div>`;
            list.appendChild(group);
        } else if (msg.role === 'bot') {
            appendBotMessage(msg.content, null, msg.created_at);
        } else if (msg.role === 'rh') {
            const group = document.createElement('div');
            group.className = 'msg-group is-rh is-other';
            group.innerHTML = `
                <div class="msg-row">
                    <div class="msg-avatar" style="background:linear-gradient(135deg,#10b981,#059669);color:#fff" title="Analista RH">
                        <i class="fas fa-user-tie" style="font-size:.7rem"></i>
                    </div>
                    <div class="msg-content-wrap">
                        <div class="msg-header"><span class="msg-author">Analista RH</span><span class="msg-time">${fmtTime(msg.created_at)}</span></div>
                        <div class="msg-bubble">${esc(msg.content)}</div>
                    </div>
                </div>`;
            list.appendChild(group);
        }

        if (doScroll) scrollBottom('hr-messages-scroll');
    }

    function formatBotMd(content) {
        return esc(content)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    function appendBotMessage(content, quickReplies, ts) {
        const list = $('hr-messages-list');
        if (!list) return;

        const now = ts || new Date().toISOString();
        const group = document.createElement('div');
        group.className = 'msg-group is-bot';

        const formattedContent = formatBotMd(content);

        let qrHtml = '';
        if (quickReplies && quickReplies.length) {
            qrHtml = `<div class="quick-replies">
                ${quickReplies.map((qr) => `<button class="qr-btn" data-qr="${esc(qr)}">${esc(qr)}</button>`).join('')}
            </div>`;
        }

        group.innerHTML = `
            <div class="msg-row">
                <div class="msg-avatar bot-avatar" title="Agente RH">
                    <i class="fas fa-robot" style="font-size:.72rem"></i>
                </div>
                <div class="msg-content-wrap">
                    <div class="msg-header"><span class="msg-author" style="color:var(--accent-hr)">Agente RH</span><span class="msg-time">${fmtTime(now)}</span></div>
                    <div class="msg-bubble">${formattedContent}</div>
                    ${qrHtml}
                </div>
            </div>`;

        group.querySelectorAll('.qr-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const text = btn.dataset.qr;
                disableAllQuickReplies();
                handleHrUserInput(text);
            });
        });

        list.appendChild(group);
        scrollBottom('hr-messages-scroll');
    }

    function disableAllQuickReplies() {
        document.querySelectorAll('#hr-messages-list .qr-btn, #hr-messages-list .escalate-cta').forEach((btn) => {
            btn.disabled = true;
            btn.style.opacity = '.45';
            btn.style.pointerEvents = 'none';
        });
    }

    async function sendBotMessage(ticketId, content, quickReplies = null) {
        const { data: msg } = await sb
            .from('hr_ticket_messages')
            .insert({
                ticket_id: ticketId,
                employee_id: null,
                role: 'bot',
                content,
            })
            .select()
            .single();

        appendBotMessage(content, quickReplies, msg?.created_at);
    }

    async function handleHrUserInput(text) {
        if (!currentTicketId || isEscalated) return;

        const { data: userMsg } = await sb
            .from('hr_ticket_messages')
            .insert({
                ticket_id: currentTicketId,
                employee_id: myEmployeeId,
                role: 'user',
                content: text,
            })
            .select()
            .single();

        appendTicketMessage({ ...userMsg, role: 'user' });

        if (text.toLowerCase().includes('falar com analista') || text.toLowerCase().includes('analista') || text.toLowerCase().includes('humano')) {
            await delay(800);
            await escalateToHuman();
            return;
        }

        await streamAiEmployeeReply(text);
    }

    async function getTicketAiHistory(ticketId) {
        const { data } = await sb
            .from('hr_ticket_messages')
            .select('role, content')
            .eq('ticket_id', ticketId)
            .in('role', ['user', 'bot'])
            .order('created_at', { ascending: true })
            .limit(30);
        return (data || []).map((m) => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.content }));
    }

    async function streamAiEmployeeReply(text) {
        const history = await getTicketAiHistory(currentTicketId);
        const historyContext = history.slice(0, -1);

        const list = $('hr-messages-list');
        if (!list) return;
        const bubbleId = 'aibot-' + Date.now();
        const group = document.createElement('div');
        group.className = 'msg-group is-bot';
        group.innerHTML = `
            <div class="msg-row">
                <div class="msg-avatar bot-avatar" title="Agente RH">
                    <i class="fas fa-robot" style="font-size:.72rem"></i>
                </div>
                <div class="msg-content-wrap">
                    <div class="msg-header"><span class="msg-author" style="color:var(--accent-hr)">Agente RH</span><span class="msg-time">${fmtTime(new Date().toISOString())}</span></div>
                    <div class="msg-bubble" id="${bubbleId}"><span class="stream-cursor"></span></div>
                </div>
            </div>`;
        list.appendChild(group);
        scrollBottom('hr-messages-scroll');

        const bubble = $(bubbleId);
        let fullText = '';
        try {
            const {
                data: { session },
            } = await sb.auth.getSession();
            const res = await fetch(`${SUPABASE_URL}/functions/v1/ai-employee-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${session.access_token}`,
                    apikey: SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({ message: text, history: historyContext }),
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
                                bubble.innerHTML = formatBotMd(fullText) + '<span class="stream-cursor"></span>';
                                scrollBottom('hr-messages-scroll');
                            }
                        }
                    } catch {}
                }
            }
        } catch (err) {
            fullText = `Não consegui responder agora (${err.message}). Você pode tentar de novo ou falar com um analista.`;
        }

        if (bubble) bubble.innerHTML = formatBotMd(fullText || 'Não consegui responder agora.');

        await sb.from('hr_ticket_messages').insert({ ticket_id: currentTicketId, employee_id: null, role: 'bot', content: fullText });

        const qrHtml = `<div class="quick-replies"><button class="qr-btn" data-qr="Falar com analista">Falar com analista</button></div>`;
        group.querySelector('.msg-content-wrap')?.insertAdjacentHTML('beforeend', qrHtml);
        group.querySelectorAll('.qr-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const t = btn.dataset.qr;
                disableAllQuickReplies();
                handleHrUserInput(t);
            });
        });
        scrollBottom('hr-messages-scroll');
    }

    async function escalateToHuman() {
        if (!currentTicketId) return;
        isEscalated = true;

        await sb.from('hr_tickets').update({ status: 'aguardando_rh', subject: 'Atendimento solicitado' }).eq('id', currentTicketId);

        const sysMsg = '— Conversa transferida para analista de RH. Aguarde o atendimento. —';
        await sb.from('hr_ticket_messages').insert({
            ticket_id: currentTicketId,
            employee_id: null,
            role: 'bot',
            content: sysMsg,
        });

        const list = $('hr-messages-list');
        if (list) {
            const sys = document.createElement('div');
            sys.className = 'msg-group is-system';
            sys.innerHTML = `<div class="msg-system">${esc(sysMsg)}</div>`;
            list.appendChild(sys);
        }

        await sendBotMessage(
            currentTicketId,
            `Certo! Transferi sua conversa para um **analista de RH** 🟢

Assim que estiver disponível, um analista irá continuar aqui neste mesmo chat. Não precisa sair desta tela.

Tempo estimado de resposta: **até 1 dia útil**.`,
            null
        );

        updateHrStatusBadge('aguardando_rh');
        const areaStatus = $('hr-area-status');
        if (areaStatus) areaStatus.textContent = 'Aguardando analista de RH';

        await loadTickets();
        if (currentTicketId) {
            document.querySelectorAll('.ticket-item').forEach((li) => {
                li.classList.toggle('active', li.dataset.ticketId === currentTicketId);
            });
        }

        scrollBottom('hr-messages-scroll');
    }

    function subscribeToTicket(ticketId) {
        if (activeTicketSub) sb.removeChannel(activeTicketSub);

        activeTicketSub = sb
            .channel(`hr:${ticketId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'hr_ticket_messages',
                    filter: `ticket_id=eq.${ticketId}`,
                },
                (payload) => {
                    const msg = payload.new;
                    if (msg.role === 'rh') {
                        appendTicketMessage(msg);
                        updateHrStatusBadge('em_atendimento');
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'hr_tickets',
                    filter: `id=eq.${ticketId}`,
                },
                (payload) => {
                    const t = payload.new;
                    updateHrStatusBadge(t.status);
                    const areaStatus = $('hr-area-status');
                    if (areaStatus) areaStatus.textContent = statusLabel[t.status] || t.status;
                    isEscalated = t.status !== 'bot';
                    loadTickets();
                    maybeShowCsatPrompt(t);
                }
            )
            .subscribe();
    }

    const hrInput = $('hr-input');
    const hrSendBtn = $('hr-send-btn');

    hrInput?.addEventListener('input', () => {
        autoResize(hrInput);
        hrSendBtn.disabled = !hrInput.value.trim() || isEscalated;
    });

    hrInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendHrMessage();
        }
    });

    hrSendBtn?.addEventListener('click', sendHrMessage);

    async function sendHrMessage() {
        const text = hrInput?.value.trim();
        if (!text || !currentTicketId) return;
        hrInput.value = '';
        hrSendBtn.disabled = true;
        autoResize(hrInput);
        await handleHrUserInput(text);
    }

    const KUDOS_CAT_LABEL = { colaboracao: 'Colaboração', inovacao: 'Inovação', lideranca: 'Liderança', superacao: 'Superação', mentoria: 'Mentoria' };
    let colleagues = [];
    let allKudos = [];

    async function loadColleagues() {
        const { data } = await sb.from('colleague_directory').select('id,name,dept').neq('id', myEmployeeId).order('name');
        colleagues = data || [];
    }

    function kudosDirMap() {
        const dirMap = new Map(colleagues.map((c) => [c.id, c]));
        dirMap.set(myEmployeeId, { id: myEmployeeId, name: myEmployee.name, avatar_url: myEmployee.avatar_url, avatar_color: myEmployee.avatar_color });
        return dirMap;
    }

    async function loadKudos() {
        const { data } = await sb.from('kudos').select('*').order('created_at', { ascending: false }).limit(60);
        const dirMap = kudosDirMap();
        allKudos = (data || []).map((k) => ({
            ...k,
            from: dirMap.get(k.from_employee_id) || null,
            to: dirMap.get(k.to_employee_id) || null,
        }));
        renderKudosWall();
    }

    function renderKudosWall() {
        const wall = $('kudos-wall');
        if (!wall) return;
        if (!allKudos.length) {
            wall.innerHTML = `<div class="kudos-empty"><i class="fas fa-award" style="font-size:1.6rem;opacity:.4;display:block;margin-bottom:8px"></i>Nenhum reconhecimento ainda.</div>`;
            return;
        }
        wall.innerHTML = allKudos
            .map(
                (k) => `
            <div class="kudos-card">
                <div class="kudos-card-head">
                    <span class="kudos-card-names">${esc(k.from?.name || '—')} <i class="fas fa-arrow-right"></i> ${esc(k.to?.name || '—')}</span>
                    <span class="kudos-card-cat">${esc(KUDOS_CAT_LABEL[k.categoria] || k.categoria)}</span>
                </div>
                <p class="kudos-card-msg">${esc(k.message)}</p>
                <span class="kudos-card-time">${fmtAgo(k.created_at)}</span>
            </div>`
            )
            .join('');
    }

    function setupKudosRealtime() {
        sb.channel('kudos-colab')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kudos' }, () => loadKudos())
            .subscribe();
    }

    window.openKudosModal = function () {
        const sel = $('kudos-colleague');
        if (sel) sel.innerHTML = colleagues.map((c) => `<option value="${c.id}">${esc(c.name)}${c.dept ? ' — ' + esc(c.dept) : ''}</option>`).join('');
        const msgEl = $('kudos-message');
        if (msgEl) msgEl.value = '';
        $('kudos-error')?.classList.add('hidden');
        $('kudos-modal')?.classList.add('open');
    };

    window.closeKudosModal = function () {
        $('kudos-modal')?.classList.remove('open');
    };

    window.submitKudos = async function () {
        const toId = $('kudos-colleague')?.value;
        const categoria = $('kudos-categoria')?.value || 'colaboracao';
        const message = $('kudos-message')?.value.trim();
        const errEl = $('kudos-error');

        if (!toId || !message) {
            if (errEl) {
                errEl.textContent = 'Selecione um colega e escreva uma mensagem.';
                errEl.classList.remove('hidden');
            }
            return;
        }

        const { data, error } = await sb
            .from('kudos')
            .insert({
                from_employee_id: myEmployeeId,
                to_employee_id: toId,
                categoria,
                message,
            })
            .select('*')
            .single();

        if (error) {
            if (errEl) {
                errEl.textContent = 'Não foi possível publicar. Tente novamente.';
                errEl.classList.remove('hidden');
            }
            return;
        }

        const dirMap = kudosDirMap();
        allKudos.unshift({ ...data, from: dirMap.get(data.from_employee_id) || null, to: dirMap.get(data.to_employee_id) || null });
        renderKudosWall();
        closeKudosModal();
        showToast('Reconhecimento publicado!', 'success', 'Seu colega vai adorar ver isso no mural.');
    };

    $('anon-feedback-btn')?.addEventListener('click', () => {
        const msgEl = $('anon-message');
        if (msgEl) msgEl.value = '';
        $('anon-error')?.classList.add('hidden');
        $('anon-feedback-modal')?.classList.add('open');
    });

    window.closeAnonFeedbackModal = function () {
        $('anon-feedback-modal')?.classList.remove('open');
    };

    window.submitAnonFeedback = async function () {
        const categoria = $('anon-categoria')?.value || 'outro';
        const message = $('anon-message')?.value.trim();
        const errEl = $('anon-error');

        if (!message) {
            if (errEl) {
                errEl.textContent = 'Escreva sua mensagem antes de enviar.';
                errEl.classList.remove('hidden');
            }
            return;
        }

        const { error } = await sb.from('anonymous_feedback').insert({ categoria, message });
        if (error) {
            if (errEl) {
                errEl.textContent = 'Não foi possível enviar. Tente novamente.';
                errEl.classList.remove('hidden');
            }
            return;
        }

        closeAnonFeedbackModal();
        showToast('Feedback enviado anonimamente!', 'success', 'Obrigado — o RH vai receber sua mensagem sem nenhuma identificação.');
    };

    function autoResize(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    window.showToast = function (title, type = 'success', msg = '') {
        const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
        const container = $('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
            <div class="toast-content">
                <p class="toast-title">${title}</p>
                ${msg ? `<p class="toast-msg">${msg}</p>` : ''}
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
        }, 4000);
    };

    window.logout = async function () {
        await sb.auth.signOut();
        window.location.href = '../screens/login.html';
    };

    setupPresence();
    await loadChannels();
    await loadTickets();
    await loadColleagues();
    await loadKudos();
    setupKudosRealtime();
});
