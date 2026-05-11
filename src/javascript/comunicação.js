document.addEventListener('DOMContentLoaded', async () => {
    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');
    const messageInput   = document.getElementById('message-text');
    const mainToggleBtn  = document.getElementById('main-toggle-btn');
    const fabBtn         = document.getElementById('btn-fab');
    const sectionWrite   = document.getElementById('write-section');
    const sectionHistory = document.getElementById('sent-messages-section');
    const messagesList   = document.getElementById('messages-list');
    const messagesCards  = document.getElementById('messages-cards');
    const sendBtn        = document.getElementById('send-btn');
    const charCount      = document.getElementById('char-count');
    const searchInput    = document.getElementById('search-input');

    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }
    const { data: profile } = await sb.from('profiles').select('profile').eq('id', user.id).single();
    if (profile?.profile !== 'Administrador') { window.location.href = '../screens/login.html'; return; }

    const nameEl   = document.getElementById('rh-sidebar-name');
    const roleEl   = document.getElementById('rh-sidebar-role');
    const avatarEl = document.getElementById('rh-sidebar-avatar');
    if (nameEl)   nameEl.textContent   = 'Administrador';
    if (roleEl)   roleEl.textContent   = 'Recursos Humanos';
    if (avatarEl) avatarEl.textContent = 'ADM';

    window.logout = async () => { await sb.auth.signOut(); window.location.href = '../screens/login.html'; };

    let dbMensagens    = [];
    let readCountMap   = {};
    let histFilter     = 'todos';
    let searchQuery    = '';
    let selectedDest   = null;
    let currentSection = 'writing';

    document.querySelectorAll('.dest-inline-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.dest-inline-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            selectedDest = chip.dataset.dest;
            checkSendReady();
        });
    });

    messageInput?.addEventListener('input', () => {
        const len = messageInput.value.length;
        if (charCount) charCount.textContent = `${len} caractere${len !== 1 ? 's' : ''}`;
        checkSendReady();
    });

    function checkSendReady() {
        if (sendBtn) sendBtn.disabled = !(selectedDest && messageInput?.value.trim());
    }

    sendBtn?.addEventListener('click', async () => {
        const texto = messageInput?.value.trim();
        if (!texto || !selectedDest) return;

        sendBtn.disabled = true;
        const { data, error } = await sb
            .from('messages')
            .insert({ texto, destino: selectedDest, created_by: user.id })
            .select()
            .single();
        if (error) { console.error('[Nexus] send:', error); sendBtn.disabled = false; return; }

        dbMensagens.unshift(data);
        readCountMap[data.id] = 0;
        updateStats();

        const original = sendBtn.innerHTML;
        sendBtn.classList.add('sent-success');
        sendBtn.innerHTML = '<i class="fas fa-check"></i> Enviado!';
        setTimeout(() => {
            sendBtn.classList.remove('sent-success');
            sendBtn.innerHTML = original;
            if (messageInput) messageInput.value = '';
            if (charCount) charCount.textContent = '0 caracteres';
            document.querySelectorAll('.dest-inline-chip').forEach(c => c.classList.remove('active'));
            selectedDest = null;
            checkSendReady();
        }, 2200);
    });

    async function loadMessages() {
        const [{ data: msgs }, { data: reads }] = await Promise.all([
            sb.from('messages').select('*').order('created_at', { ascending: false }),
            sb.from('message_reads').select('message_id'),
        ]);
        dbMensagens  = msgs || [];
        readCountMap = {};
        (reads || []).forEach(r => { readCountMap[r.message_id] = (readCountMap[r.message_id] || 0) + 1; });
        updateStats();
    }

    function updateStats() {
        const total  = dbMensagens.length;
        const reads  = Object.values(readCountMap).reduce((a, b) => a + b, 0);
        const unread = dbMensagens.filter(m => !readCountMap[m.id]).length;
        const elTotal  = document.getElementById('stat-total');
        const elReads  = document.getElementById('stat-reads');
        const elUnread = document.getElementById('stat-unread');
        if (elTotal)  elTotal.textContent  = total;
        if (elReads)  elReads.textContent  = reads;
        if (elUnread) elUnread.textContent = unread;
    }

    const escHTML = (s)   => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const fmtDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');

    const isMobile  = () => window.innerWidth <= 768;
    const openSide  = () => { sidebar?.classList.add('open');    sidebarOverlay?.classList.add('active');    document.body.style.overflow = 'hidden'; };
    const closeSide = () => { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; };
    sidebarToggle?.addEventListener('click', e => {
        e.stopPropagation();
        if (isMobile()) {
            sidebar?.classList.contains('open') ? closeSide() : openSide();
        } else {
            const c = sidebar?.classList.toggle('collapsed');
            mainWrapper?.classList.toggle('sidebar-collapsed', c);
        }
    });
    topbarMenuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeSide() : openSide(); });
    sidebarOverlay?.addEventListener('click', closeSide);
    window.addEventListener('resize', () => { if (!isMobile()) closeSide(); });

    function switchToHistory() {
        currentSection = 'history';
        if (sectionWrite)   sectionWrite.style.display   = 'none';
        if (sectionHistory) sectionHistory.style.display = 'block';
        if (mainToggleBtn) {
            const s = mainToggleBtn.querySelector('span');
            const i = mainToggleBtn.querySelector('i');
            if (s) s.textContent = 'Novo Comunicado';
            if (i) i.className  = 'fas fa-plus';
        }
        if (fabBtn) fabBtn.innerHTML = '<i class="fas fa-plus"></i>';
        renderizarMensagens();
    }

    function switchToWriting() {
        currentSection = 'writing';
        if (sectionWrite)   sectionWrite.style.display   = 'block';
        if (sectionHistory) sectionHistory.style.display = 'none';
        if (mainToggleBtn) {
            const s = mainToggleBtn.querySelector('span');
            const i = mainToggleBtn.querySelector('i');
            if (s) s.textContent = 'Comunicados Enviados';
            if (i) i.className  = 'fas fa-history';
        }
        if (fabBtn) fabBtn.innerHTML = '<i class="fas fa-history"></i>';
    }

    mainToggleBtn?.addEventListener('click', () => currentSection === 'writing' ? switchToHistory() : switchToWriting());
    fabBtn?.addEventListener('click',        () => currentSection === 'writing' ? switchToHistory() : switchToWriting());

    window.setHistFilter = function (btn) {
        document.querySelectorAll('.hist-chip').forEach(c => c.classList.remove('hist-chip--active'));
        btn.classList.add('hist-chip--active');
        histFilter = btn.dataset.dest;
        renderizarMensagens();
    };

    searchInput?.addEventListener('input', e => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderizarMensagens();
    });

    const filteredMsgs = () => {
        let msgs = histFilter === 'todos' ? dbMensagens : dbMensagens.filter(m => m.destino === histFilter);
        if (searchQuery) msgs = msgs.filter(m =>
            m.texto.toLowerCase().includes(searchQuery) ||
            m.destino.toLowerCase().includes(searchQuery)
        );
        return msgs;
    };

    function renderizarMensagens() { renderizarTabela(); renderizarCards(); }

    const emptyTableRow  = `<tr><td colspan="5"><div class="empty-state"><i class="fas fa-inbox"></i><span>Nenhum comunicado encontrado.</span></div></td></tr>`;
    const emptyCardsHtml = `<div class="empty-state"><i class="fas fa-inbox"></i><span>Nenhum comunicado encontrado.</span></div>`;

    function renderizarTabela() {
        if (!messagesList) return;
        const msgs = filteredMsgs();
        if (!msgs.length) { messagesList.innerHTML = emptyTableRow; return; }
        messagesList.innerHTML = msgs.map(m => {
            const t     = escHTML(m.texto);
            const reads = readCountMap[m.id] || 0;
            return `<tr>
                <td>${escHTML(fmtDate(m.created_at))}</td>
                <td><div class="message-preview" title="${t}">${t}</div></td>
                <td><span class="badge-dest">${escHTML(m.destino)}</span></td>
                <td><span class="reads-badge">${reads > 0 ? `<i class="fas fa-eye"></i> ${reads}` : '<span style="opacity:.4">—</span>'}</span></td>
                <td><button class="delete-btn" data-id="${m.id}" aria-label="Excluir"><i class="fas fa-trash"></i></button></td>
            </tr>`;
        }).join('');
    }

    function renderizarCards() {
        if (!messagesCards) return;
        const msgs = filteredMsgs();
        if (!msgs.length) { messagesCards.innerHTML = emptyCardsHtml; return; }
        messagesCards.innerHTML = msgs.map(m => {
            const t     = escHTML(m.texto);
            const reads = readCountMap[m.id] || 0;
            return `<div class="msg-card-item">
                <div class="msg-card-body">
                    <div class="msg-card-top">
                        <span class="msg-card-date">${escHTML(fmtDate(m.created_at))}</span>
                        <span class="msg-card-dest">${escHTML(m.destino)}</span>
                        ${reads > 0 ? `<span class="reads-badge"><i class="fas fa-eye"></i> ${reads}</span>` : ''}
                    </div>
                    <div class="msg-card-text" title="${t}">${t}</div>
                </div>
                <div class="msg-card-actions">
                    <button class="delete-btn" data-id="${m.id}" aria-label="Excluir"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    }

    async function handleDelete(e) {
        const btn = e.target.closest('.delete-btn');
        if (!btn) return;
        const id = btn.dataset.id;
        if (!confirm('Deseja realmente excluir este comunicado?')) return;
        await sb.from('messages').delete().eq('id', id);
        dbMensagens = dbMensagens.filter(m => m.id !== id);
        delete readCountMap[id];
        updateStats();
        renderizarMensagens();
    }

    messagesList?.addEventListener('click', handleDelete);
    messagesCards?.addEventListener('click', handleDelete);

    sb.channel('messages-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => {
            await loadMessages();
            if (currentSection === 'history') renderizarMensagens();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, async () => {
            const { data: reads } = await sb.from('message_reads').select('message_id');
            readCountMap = {};
            (reads || []).forEach(r => { readCountMap[r.message_id] = (readCountMap[r.message_id] || 0) + 1; });
            updateStats();
            if (currentSection === 'history') renderizarMensagens();
        })
        .subscribe();

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isMobile()) closeSide(); });

    await loadMessages();
});