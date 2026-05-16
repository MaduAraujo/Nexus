document.addEventListener('DOMContentLoaded', async () => {

    // ── Auth ──────────────────────────────────────────────────────────────────
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles')
        .select('profile, employee_id').eq('id', user.id).single();

    if (profile?.profile !== 'colaborador' || !profile.employee_id) {
        window.location.href = '../screens/login.html'; return;
    }

    const myEmployeeId = profile.employee_id;
    const { data: emp } = await sb.from('employees').select('*').eq('id', myEmployeeId).single();
    if (!emp) { window.location.href = '../screens/login.html'; return; }

    let myEmployee = emp;

    // ── Estado ────────────────────────────────────────────────────────────────
    let currentTab      = 'social';
    let currentChannelId = null;
    let currentChannel   = null;
    let currentTicketId  = null;
    let botResponseCount = 0;
    let isEscalated      = false;
    let activeChatSub    = null;
    let activeTicketSub  = null;
    let typingTimer      = null;
    const unreadCounts   = {};   // { channelId: number }

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
        if (d < 60) return `${d}min atrás`;
        const h = Math.floor(d / 60);
        if (h < 24) return `${h}h atrás`;
        return new Date(ts).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
    };

    const scrollBottom = id => {
        const el = document.getElementById(id);
        if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    };

    const $ = id => document.getElementById(id);

    // ── Painel esquerdo mobile (chat-left drawer) ─────────────────────────────
    const chatLeft      = document.getElementById('chat-left');
    const chatOverlay   = document.getElementById('chat-overlay');
    const panelsBtn     = document.getElementById('topbar-panels-btn');

    const openChatLeft  = () => { chatLeft?.classList.add('open'); chatOverlay?.classList.add('active'); };
    const closeChatLeft = () => { chatLeft?.classList.remove('open'); chatOverlay?.classList.remove('active'); };

    panelsBtn?.addEventListener('click',   openChatLeft);
    chatOverlay?.addEventListener('click', closeChatLeft);

    // ── Abas Social / Com o RH ────────────────────────────────────────────────
    const tabBtns   = document.querySelectorAll('.chat-tab');
    const panelMap  = { social: $('panel-social'), rh: $('panel-rh') };

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (tab === currentTab) return;
            currentTab = tab;
            tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            Object.entries(panelMap).forEach(([k, el]) => {
                if (el) el.classList.toggle('hidden', k !== tab);
            });
            // Ao trocar para RH sem ticket aberto: esconde chat areas, mostra welcome
            if (tab === 'rh' && !currentTicketId) showWelcome();
            if (tab === 'social' && !currentChannelId) showWelcome();
        });
    });

    // ── Funções de visibilidade das áreas ─────────────────────────────────────
    const chatWelcome = $('chat-welcome');
    const chatArea    = $('chat-area');
    const hrArea      = $('hr-area');

    function showWelcome() {
        chatWelcome?.classList.remove('hidden');
        chatArea?.classList.add('hidden');
        hrArea?.classList.add('hidden');
    }

    function showChatArea() {
        chatWelcome?.classList.add('hidden');
        chatArea?.classList.remove('hidden');
        hrArea?.classList.add('hidden');
    }

    function showHrArea() {
        chatWelcome?.classList.add('hidden');
        chatArea?.classList.add('hidden');
        hrArea?.classList.remove('hidden');
    }

    // ── Topbar info ───────────────────────────────────────────────────────────
    function setTopbarChannel(icon, name) {
        const iconEl = $('topbar-channel-icon');
        const nameEl = $('topbar-channel-name');
        if (iconEl) iconEl.innerHTML = icon;
        if (nameEl) nameEl.textContent = name;
    }

    // ── Presença ──────────────────────────────────────────────────────────────
    let onlineCount = 0;

    function setupPresence() {
        const presenceCh = sb.channel('chat:presence', {
            config: { presence: { key: myEmployeeId } }
        });

        presenceCh
            .on('presence', { event: 'sync' }, () => {
                const state = presenceCh.presenceState();
                onlineCount = Object.keys(state).length;
                updatePresenceUI();
            })
            .subscribe(async status => {
                if (status === 'SUBSCRIBED') {
                    await presenceCh.track({
                        employee_id: myEmployeeId,
                        name: myEmployee.name,
                        online_at: new Date().toISOString()
                    });
                }
            });
    }

    function updatePresenceUI() {
        const pill   = $('presence-pill');
        const numEl  = $('presence-number');
        if (!pill || !numEl) return;
        numEl.textContent = onlineCount;
        pill.style.display = currentChannelId ? 'flex' : 'none';
    }

    // ── Render avatar helper ──────────────────────────────────────────────────
    function avatarStyle(e) {
        if (!e) return `style="background:#6366f1"`;
        if (e.avatar_url) return `style="background:url(${e.avatar_url}) center/cover"`;
        return `style="background:${e.avatar_color || '#6366f1'}"`;
    }

    // ── CANAL SOCIAL ──────────────────────────────────────────────────────────

    let allChannels = [];

    async function loadChannels() {
        const list = $('channel-list');
        if (!list) return;

        const { data: channels } = await sb.from('chat_channels').select('*').order('name');
        allChannels = channels || [];

        // Auto-join #geral e canal do departamento
        const geral = allChannels.find(c => c.slug === 'geral');
        if (geral) await joinChannel(geral.id);
        if (myEmployee.dept) {
            const deptSlug = myEmployee.dept.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            const deptCh   = allChannels.find(c => c.dept === myEmployee.dept || c.slug === deptSlug);
            if (deptCh) await joinChannel(deptCh.id);
        }

        // Carrega quais canais o colaborador faz parte
        const { data: memberships } = await sb.from('chat_channel_members')
            .select('channel_id').eq('employee_id', myEmployeeId);

        const memberOf = new Set((memberships || []).map(m => m.channel_id));

        list.innerHTML = '';

        // Canais que o usuário faz parte primeiro, depois os outros
        const mine  = allChannels.filter(c => memberOf.has(c.id));
        const other = allChannels.filter(c => !memberOf.has(c.id));

        if (mine.length) {
            const hd = document.createElement('li');
            hd.className = 'channel-section-hd';
            hd.style.cssText = 'display:list-item;padding:10px 16px 4px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(156,163,175,.7);';
            hd.textContent = 'Meus canais';
            list.appendChild(hd);
            mine.forEach(c => list.appendChild(buildChannelItem(c, true)));
        }

        if (other.length) {
            const hd = document.createElement('li');
            hd.className = 'channel-section-hd';
            hd.style.cssText = 'display:list-item;padding:10px 16px 4px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(156,163,175,.7);margin-top:8px;';
            hd.textContent = 'Outros canais';
            list.appendChild(hd);
            other.forEach(c => list.appendChild(buildChannelItem(c, false)));
        }

        if (!mine.length && !other.length) {
            list.innerHTML = '<li class="ch-loading"><span>Nenhum canal disponível</span></li>';
        }
    }

    function buildChannelItem(channel, isMember) {
        const li = document.createElement('li');
        li.className = 'channel-item';
        li.dataset.channelId = channel.id;
        li.dataset.member    = isMember ? '1' : '0';

        const unread  = unreadCounts[channel.id] || 0;
        const iconMap = {
            'globe': 'fa-globe', 'code': 'fa-code', 'user-tie': 'fa-user-tie',
            'dollar-sign': 'fa-dollar-sign', 'bullhorn': 'fa-bullhorn',
            'gavel': 'fa-gavel', 'building': 'fa-building', 'lightbulb': 'fa-lightbulb'
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
        await sb.from('chat_channel_members')
            .upsert({ channel_id: channelId, employee_id: myEmployeeId }, { onConflict: 'channel_id,employee_id', ignoreDuplicates: true });
    }

    async function selectChannel(channel, isMember) {
        if (!isMember) {
            await joinChannel(channel.id);
            isMember = true;
        }

        currentChannelId  = channel.id;
        currentChannel    = channel;
        currentTicketId   = null;
        botResponseCount  = 0;
        isEscalated       = false;

        // Atualiza UI da lista
        document.querySelectorAll('.channel-item').forEach(li => {
            li.classList.toggle('active', li.dataset.channelId === channel.id);
        });

        // Zera unread
        unreadCounts[channel.id] = 0;
        updateChannelBadge(channel.id);
        updateSidebarUnread();

        // Topbar
        setTopbarChannel('#', channel.name);
        const areaName = $('chat-area-name');
        const areaDesc = $('chat-area-desc');
        if (areaName) areaName.textContent = `#${channel.name}`;
        if (areaDesc) areaDesc.textContent = channel.description || '';

        // Input placeholder
        const input = $('chat-input');
        if (input) input.placeholder = `Mensagem para #${channel.name}...`;

        showChatArea();
        closeChatLeft();

        // Presença
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

        const { data: msgs } = await sb.from('chat_messages')
            .select('*, employees(name, avatar_url, avatar_color, role)')
            .eq('channel_id', channelId)
            .order('created_at', { ascending: true })
            .limit(80);

        list.innerHTML = '';
        (msgs || []).forEach(m => appendMessage(m, false));
        scrollBottom('messages-scroll');
    }

    function appendMessage(msg, doScroll = true) {
        const list = $('messages-list');
        if (!list) return;
        const e    = msg.employees || {};
        const mine = msg.employee_id === myEmployeeId;

        const group = document.createElement('div');
        group.className = `msg-group ${mine ? 'is-mine' : 'is-other'}`;

        const avatarStr = mine ? '' : `
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

        activeChatSub = sb.channel(`chat:${channelId}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'chat_messages',
                filter: `channel_id=eq.${channelId}`
            }, async payload => {
                const msg = payload.new;
                if (msg.employee_id === myEmployeeId) return; // já foi adicionado ao enviar

                // Busca dados do employee para o avatar
                const { data: e } = await sb.from('employees')
                    .select('name, avatar_url, avatar_color, role').eq('id', msg.employee_id).single();
                appendMessage({ ...msg, employees: e || {} });

                // Unread se canal não estiver visível
                if (currentChannelId !== channelId) {
                    unreadCounts[channelId] = (unreadCounts[channelId] || 0) + 1;
                    updateChannelBadge(channelId);
                    updateSidebarUnread();
                }
            })
            .subscribe();
    }

    // Typing indicator via Realtime Broadcast
    let typingChannel = null;

    function subscribeToTyping(channelId) {
        if (typingChannel) sb.removeChannel(typingChannel);

        typingChannel = sb.channel(`typing:${channelId}`)
            .on('broadcast', { event: 'typing' }, payload => {
                if (payload.payload?.employee_id === myEmployeeId) return;
                showTyping(payload.payload?.name || 'alguém');
                clearTimeout(typingTimer);
                typingTimer = setTimeout(hideTyping, 2500);
            })
            .subscribe();
    }

    function showTyping(name) {
        const ind  = $('typing-indicator');
        const text = $('typing-text');
        if (ind)  ind.classList.remove('hidden');
        if (text) text.textContent = `${name} está digitando...`;
        scrollBottom('messages-scroll');
    }

    function hideTyping() {
        $('typing-indicator')?.classList.add('hidden');
    }

    // Input do chat social
    const chatInput   = $('chat-input');
    const chatSendBtn = $('chat-send-btn');

    chatInput?.addEventListener('input', () => {
        autoResize(chatInput);
        chatSendBtn.disabled = !chatInput.value.trim();

        // Broadcast typing
        if (currentChannelId && typingChannel) {
            typingChannel.send({
                type: 'broadcast', event: 'typing',
                payload: { employee_id: myEmployeeId, name: myEmployee.name }
            });
        }
    });

    chatInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendSocialMessage(); }
    });

    chatSendBtn?.addEventListener('click', sendSocialMessage);

    async function sendSocialMessage() {
        const text = chatInput?.value.trim();
        if (!text || !currentChannelId) return;

        chatInput.value = '';
        chatSendBtn.disabled = true;
        autoResize(chatInput);

        const { data: msg, error } = await sb.from('chat_messages').insert({
            channel_id: currentChannelId,
            employee_id: myEmployeeId,
            content: text
        }).select().single();

        if (error) { showToast('Erro ao enviar mensagem', 'error'); return; }

        // Adiciona mensagem imediatamente (otimista)
        appendMessage({ ...msg, employees: myEmployee });
    }

    function updateChannelBadge(channelId) {
        const badge = document.getElementById(`badge-${channelId}`);
        if (!badge) return;
        const count = unreadCounts[channelId] || 0;
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
    }

    function updateSidebarUnread() {
        // sem sidebar — sem badge global de não-lidas
    }

    // ── ATENDIMENTO RH ────────────────────────────────────────────────────────

    const HR_BOT_GREETING = `Olá, ${myEmployee.name?.split(' ')[0] || 'colaborador'}! 👋 Sou o **Agente de Atendimento RH**. Estou aqui para ajudar com suas dúvidas de forma rápida e prática.

Selecione um tema abaixo ou descreva sua dúvida:`;

    const HR_KNOWLEDGE = [
        {
            id: 'ferias', label: 'Férias', icon: 'umbrella-beach',
            patterns: [/fér|ferias|folga|descanso|recesso|período aquisitivo/i],
            response: `**Férias** 🏖️

• **Solicitar:** Acesse "Férias" no menu → clique em *Solicitar Período*
• **Antecedência mínima:** 30 dias
• **Aprovação:** até 5 dias úteis
• **Abono:** você pode converter até 1/3 das férias em dinheiro

Conseguiu o que precisava?`,
            followUps: ['Quero solicitar férias agora', 'Qual meu saldo de férias?', 'Falar com analista']
        },
        {
            id: 'holerite', label: 'Holerite', icon: 'file-invoice-dollar',
            patterns: [/holeri|salário|salario|contracheque|pagamento do salário|recib/i],
            response: `**Holerite e Pagamento** 💰

• **Ver holerites:** Acesse *Holerite* no menu lateral
• **Disponibilidade:** todo dia 5 do mês seguinte
• **Download:** disponível em PDF diretamente na plataforma
• **Dúvidas sobre descontos:** descreva abaixo que verifico para você

Posso ajudar com mais alguma coisa?`,
            followUps: ['Entender um desconto', 'Data de pagamento', 'Falar com analista']
        },
        {
            id: 'ponto', label: 'Ponto / Horas', icon: 'clock',
            patterns: [/ponto|hora.?extra|registro|bater|jornada|banco de hora|ajuste de ponto/i],
            response: `**Ponto e Banco de Horas** ⏰

• **Registrar ponto:** Acesse *Banco de Horas* no menu
• **Marcações:** entrada, saída do almoço, retorno e saída
• **Ajuste de ponto:** crie uma solicitação se houver erro na marcação
• **Saldo:** visualize seu banco de horas atualizado em tempo real

Precisa de mais informação?`,
            followUps: ['Solicitar ajuste de ponto', 'Ver banco de horas', 'Falar com analista']
        },
        {
            id: 'documentos', label: 'Documentos', icon: 'folder-open',
            patterns: [/document|arquivo|certidão|carta de trabalho|declaração|comprovante|atestado/i],
            response: `**Documentos e Arquivos** 📁

• **Ver documentos:** Acesse *Documentos* no menu
• **Enviar:** faça upload de PDF, PNG ou JPG diretamente
• **Carta de vínculo empregatício:** solicite via chat (clique em "Falar com analista")
• **Atestado médico:** envie pela seção *Documentos* com a categoria "Atestado"

O que você precisa?`,
            followUps: ['Solicitar carta de trabalho', 'Enviar atestado médico', 'Falar com analista']
        },
        {
            id: 'beneficios', label: 'Benefícios', icon: 'gift',
            patterns: [/benefício|beneficio|plano de saúde|dental|vale.?(transporte|refeição|refeicao|alimentação|alimentacao)|seguro de vida/i],
            response: `**Benefícios** 🎁

Seus benefícios ativos constam no seu perfil de colaborador. Geralmente incluem:
• **Vale-transporte:** calculado com base nos dias trabalhados
• **Vale-refeição / alimentação:** creditado mensalmente
• **Plano de saúde:** cobertura disponível com o RH
• **Seguro de vida:** verificável no seu cadastro

Para dúvidas específicas, prefere falar com um analista?`,
            followUps: ['Ver meus benefícios', 'Incluir dependente', 'Falar com analista']
        },
        {
            id: 'licenca', label: 'Licença / Afastamento', icon: 'hospital',
            patterns: [/licença|licenca|afastamento|maternidade|paternidade|doença|acidente|inss/i],
            response: `**Licenças e Afastamentos** 🏥

• **Licença médica:** entregue o atestado em até 48h ao RH
• **Maternidade / Paternidade:** avise o RH com antecedência — garantido por lei
• **Afastamento INSS (>15 dias):** o RH abre o processo junto à previdência
• **Acidente de trabalho:** comunique imediatamente ao RH

Este assunto requer atenção especial. Recomendo falar diretamente com um analista.`,
            followUps: ['Falar com analista', 'Enviar atestado', 'Saber mais sobre meus direitos']
        },
        {
            id: 'admissao', label: 'Dados Cadastrais', icon: 'user-edit',
            patterns: [/dados pessoais|cadastro|endereço|telefone|conta bancária|pix|banco|atualizar perfil/i],
            response: `**Dados Cadastrais** 📋

• **Bio e foto:** edite diretamente em *Meu Perfil* no menu
• **Dados bancários / PIX:** somente o RH pode alterar — use este chat
• **Documentos de admissão:** envie pela seção *Documentos*
• **Dados contratuais:** qualquer alteração passa pelo RH

Como posso ajudar?`,
            followUps: ['Atualizar dado bancário', 'Alterar endereço', 'Falar com analista']
        }
    ];

    const FALLBACK_RESPONSE = `Não encontrei uma resposta automática para sua dúvida. 🤔

Posso conectar você a um **analista de RH** que poderá ajudar diretamente. Você prefere:`;

    let allTickets = [];

    async function loadTickets() {
        const list = $('ticket-list');
        if (!list) return;

        const { data: tickets } = await sb.from('hr_tickets')
            .select('*')
            .eq('employee_id', myEmployeeId)
            .order('updated_at', { ascending: false });

        allTickets = tickets || [];
        renderTicketList();
    }

    function renderTicketList() {
        const list = $('ticket-list');
        if (!list) return;
        list.innerHTML = '';

        if (!allTickets.length) {
            list.innerHTML = '<li class="ch-loading" style="flex-direction:column;align-items:flex-start;gap:4px;"><span style="color:rgba(156,163,175,.9)">Nenhuma conversa ainda</span><span style="font-size:.72rem">Clique em "Nova conversa" para começar</span></li>';
            return;
        }

        allTickets.forEach(t => list.appendChild(buildTicketItem(t)));
    }

    const statusLabel = { bot: 'Bot', aguardando_rh: 'Aguardando RH', em_atendimento: 'Em atendimento', resolvido: 'Resolvido' };
    const statusDot   = { bot: 'tsd-bot', aguardando_rh: 'tsd-waiting', em_atendimento: 'tsd-human', resolvido: 'tsd-solved' };

    function buildTicketItem(ticket) {
        const li = document.createElement('li');
        li.className = 'ticket-item';
        li.dataset.ticketId = ticket.id;
        li.innerHTML = `
            <span class="ticket-subject">${esc(ticket.subject)}</span>
            <div class="ticket-meta">
                <span class="ticket-status-dot ${statusDot[ticket.status] || 'tsd-bot'}"></span>
                <span>${statusLabel[ticket.status] || ticket.status}</span>
                <span>·</span>
                <span>${fmtAgo(ticket.updated_at || ticket.created_at)}</span>
            </div>`;
        li.addEventListener('click', () => selectTicket(ticket));
        return li;
    }

    $('new-ticket-btn')?.addEventListener('click', createTicket);

    async function createTicket() {
        const { data: ticket, error } = await sb.from('hr_tickets').insert({
            employee_id: myEmployeeId,
            subject: 'Atendimento RH',
            status: 'bot'
        }).select().single();

        if (error || !ticket) { showToast('Erro ao iniciar atendimento', 'error'); return; }

        allTickets.unshift(ticket);
        renderTicketList();
        await selectTicket(ticket);
    }

    async function selectTicket(ticket) {
        currentTicketId  = ticket.id;
        currentChannelId = null;
        botResponseCount = 0;
        isEscalated      = ticket.status === 'aguardando_rh' || ticket.status === 'em_atendimento';

        document.querySelectorAll('.ticket-item').forEach(li => {
            li.classList.toggle('active', li.dataset.ticketId === ticket.id);
        });

        // Topbar
        setTopbarChannel('<i class="fas fa-headset" style="color:var(--accent-hr)"></i>', 'Agente RH');

        // Header da área RH
        const areaName = $('hr-area-name');
        const areaStatus = $('hr-area-status');
        if (areaName) areaName.textContent = ticket.subject || 'Atendimento RH';
        if (areaStatus) areaStatus.textContent = statusLabel[ticket.status] || 'Bot';
        updateHrStatusBadge(ticket.status);

        // Input
        const hrInput = $('hr-input');
        if (hrInput) hrInput.disabled = ticket.status === 'resolvido';
        const hrSendBtn = $('hr-send-btn');
        if (hrSendBtn) hrSendBtn.disabled = ticket.status === 'resolvido';

        showHrArea();
        closeChatLeft();

        await loadTicketMessages(ticket.id);
        subscribeToTicket(ticket.id);

        // Se é novo (sem mensagens), bot saúda
        const list = $('hr-messages-list');
        if (list && list.children.length === 0) {
            await sendBotMessage(ticket.id, HR_BOT_GREETING, HR_KNOWLEDGE.map(k => k.label));
        }
    }

    function updateHrStatusBadge(status) {
        const dot   = $('hr-status-dot');
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

        const { data: msgs } = await sb.from('hr_ticket_messages')
            .select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });

        list.innerHTML = '';
        (msgs || []).forEach(m => appendTicketMessage(m, false));
        scrollBottom('hr-messages-scroll');
    }

    function appendTicketMessage(msg, doScroll = true) {
        const list = $('hr-messages-list');
        if (!list) return;

        if (msg.role === 'user') {
            const mine = msg.employee_id === myEmployeeId;
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

    function appendBotMessage(content, quickReplies, ts) {
        const list = $('hr-messages-list');
        if (!list) return;

        const now   = ts || new Date().toISOString();
        const group = document.createElement('div');
        group.className = 'msg-group is-bot';

        // Converte **negrito** → <strong>
        const formattedContent = esc(content)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        let qrHtml = '';
        if (quickReplies && quickReplies.length) {
            qrHtml = `<div class="quick-replies">
                ${quickReplies.map(qr => `<button class="qr-btn" data-qr="${esc(qr)}">${esc(qr)}</button>`).join('')}
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

        // Listeners dos quick replies
        group.querySelectorAll('.qr-btn').forEach(btn => {
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
        document.querySelectorAll('#hr-messages-list .qr-btn, #hr-messages-list .escalate-cta').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '.45';
            btn.style.pointerEvents = 'none';
        });
    }

    async function sendBotMessage(ticketId, content, quickReplies = null) {
        // Salva no banco
        const { data: msg } = await sb.from('hr_ticket_messages').insert({
            ticket_id: ticketId,
            employee_id: null,
            role: 'bot',
            content
        }).select().single();

        appendBotMessage(content, quickReplies, msg?.created_at);
    }

    async function handleHrUserInput(text) {
        if (!currentTicketId || isEscalated) return;

        // Salva mensagem do usuário
        const { data: userMsg } = await sb.from('hr_ticket_messages').insert({
            ticket_id: currentTicketId,
            employee_id: myEmployeeId,
            role: 'user',
            content: text
        }).select().single();

        appendTicketMessage({ ...userMsg, role: 'user' });

        // Processa bot com delay visual
        await delay(800);

        if (text.toLowerCase().includes('falar com analista') || text.toLowerCase().includes('analista') || text.toLowerCase().includes('humano')) {
            await escalateToHuman();
            return;
        }

        // Busca resposta na base de conhecimento
        const matched = HR_KNOWLEDGE.find(k => k.patterns.some(p => p.test(text)));

        if (matched) {
            botResponseCount++;
            await sendBotMessage(currentTicketId, matched.response, matched.followUps);
        } else {
            botResponseCount++;
            if (botResponseCount >= 2) {
                await sendBotMessage(currentTicketId, FALLBACK_RESPONSE, ['Falar com analista', 'Tentar novamente']);
            } else {
                await sendBotMessage(currentTicketId,
                    `Hmm, não encontrei informações específicas sobre isso. Pode descrever melhor sua dúvida? Ou escolha um tema abaixo:`,
                    HR_KNOWLEDGE.map(k => k.label)
                );
            }
        }
    }

    async function escalateToHuman() {
        if (!currentTicketId) return;
        isEscalated = true;

        await sb.from('hr_tickets').update({ status: 'aguardando_rh', subject: 'Atendimento solicitado' }).eq('id', currentTicketId);

        const sysMsg = '— Conversa transferida para analista de RH. Aguarde o atendimento. —';
        const { data: msg } = await sb.from('hr_ticket_messages').insert({
            ticket_id: currentTicketId,
            employee_id: null,
            role: 'bot',
            content: sysMsg
        }).select().single();

        const list = $('hr-messages-list');
        if (list) {
            const sys = document.createElement('div');
            sys.className = 'msg-group is-system';
            sys.innerHTML = `<div class="msg-system">${esc(sysMsg)}</div>`;
            list.appendChild(sys);
        }

        await sendBotMessage(currentTicketId,
            `Certo! Transferi sua conversa para um **analista de RH** 🟢

Assim que estiver disponível, um analista irá continuar aqui neste mesmo chat. Não precisa sair desta tela.

Tempo estimado de resposta: **até 1 dia útil**.`, null
        );

        updateHrStatusBadge('aguardando_rh');
        const areaStatus = $('hr-area-status');
        if (areaStatus) areaStatus.textContent = 'Aguardando analista de RH';

        // Atualiza lista de tickets
        await loadTickets();
        if (currentTicketId) {
            document.querySelectorAll('.ticket-item').forEach(li => {
                li.classList.toggle('active', li.dataset.ticketId === currentTicketId);
            });
        }

        scrollBottom('hr-messages-scroll');
    }

    function subscribeToTicket(ticketId) {
        if (activeTicketSub) sb.removeChannel(activeTicketSub);

        activeTicketSub = sb.channel(`hr:${ticketId}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'hr_ticket_messages',
                filter: `ticket_id=eq.${ticketId}`
            }, payload => {
                const msg = payload.new;
                if (msg.role === 'rh') {
                    appendTicketMessage(msg);
                    updateHrStatusBadge('em_atendimento');
                }
            })
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'hr_tickets',
                filter: `id=eq.${ticketId}`
            }, payload => {
                const t = payload.new;
                updateHrStatusBadge(t.status);
                const areaStatus = $('hr-area-status');
                if (areaStatus) areaStatus.textContent = statusLabel[t.status] || t.status;
                isEscalated = t.status !== 'bot';
                loadTickets();
            })
            .subscribe();
    }

    // Input RH
    const hrInput   = $('hr-input');
    const hrSendBtn = $('hr-send-btn');

    hrInput?.addEventListener('input', () => {
        autoResize(hrInput);
        hrSendBtn.disabled = !hrInput.value.trim() || isEscalated;
    });

    hrInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendHrMessage(); }
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

    // ── Helpers ───────────────────────────────────────────────────────────────

    function autoResize(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    const delay = ms => new Promise(r => setTimeout(r, ms));

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
                <p class="toast-title">${title}</p>
                ${msg ? `<p class="toast-msg">${msg}</p>` : ''}
            </div>
            <button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),400)">
                <i class="fas fa-times"></i>
            </button>`;
        container.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 400); }, 4000);
    };

    // ── Logout ────────────────────────────────────────────────────────────────
    window.logout = async function () {
        await sb.auth.signOut();
        window.location.href = '../screens/login.html';
    };

    // ── Init ──────────────────────────────────────────────────────────────────
    setupPresence();
    await loadChannels();
    await loadTickets();
});
