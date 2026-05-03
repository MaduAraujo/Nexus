/* comunicação.js — Supabase */

document.addEventListener('DOMContentLoaded', async () => {
    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');
    const messageInput   = document.getElementById('message-text');
    const mainToggleBtn  = document.getElementById('main-toggle-btn');
    const fabBtn         = document.getElementById('btn-fab');
    const modal          = document.getElementById('destinationModal');
    const sectionWrite   = document.getElementById('write-section');
    const sectionHistory = document.getElementById('sent-messages-section');
    const messagesList   = document.getElementById('messages-list');
    const messagesCards  = document.getElementById('messages-cards');

    // ─── Session ─────────────────────────────────────────────
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }
    const { data: profile } = await sb.from('profiles').select('profile').eq('id', user.id).single();
    if (profile?.profile !== 'rh') { window.location.href = '../screens/login.html'; return; }

    const displayName = user.email?.split('@')[0] || 'Administrador';
    const nameEl   = document.getElementById('rh-sidebar-name');
    const roleEl   = document.getElementById('rh-sidebar-role');
    const avatarEl = document.getElementById('rh-sidebar-avatar');
    if (nameEl)   nameEl.textContent   = displayName;
    if (roleEl)   roleEl.textContent   = 'Recursos Humanos';
    if (avatarEl) avatarEl.textContent = displayName.slice(0, 2).toUpperCase();

    window.logout = async () => { await sb.auth.signOut(); window.location.href = '../screens/login.html'; };

    // ─── State ───────────────────────────────────────────────
    let dbMensagens  = [];
    let readCountMap = {};
    let histFilter   = 'todos';
    let currentSection = 'writing';

    // ─── Data ────────────────────────────────────────────────
    async function loadMessages() {
        const [{ data: msgs }, { data: reads }] = await Promise.all([
            sb.from('messages').select('*').order('created_at', { ascending: false }),
            sb.from('message_reads').select('message_id'),
        ]);
        dbMensagens  = msgs || [];
        readCountMap = {};
        (reads || []).forEach(r => { readCountMap[r.message_id] = (readCountMap[r.message_id] || 0) + 1; });
    }

    const countReads = (id)  => readCountMap[id] || 0;
    const escHTML    = (s)   => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const fmtDate    = (iso) => new Date(iso).toLocaleDateString('pt-BR');

    // ─── Sidebar ─────────────────────────────────────────────
    const isMobile  = () => window.innerWidth <= 768;
    const openSide  = () => { sidebar?.classList.add('open');    sidebarOverlay?.classList.add('active');    document.body.style.overflow = 'hidden'; };
    const closeSide = () => { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; };
    sidebarToggle?.addEventListener('click', e => { e.stopPropagation(); isMobile() ? (sidebar?.classList.contains('open') ? closeSide() : openSide()) : (() => { const c = sidebar?.classList.toggle('collapsed'); mainWrapper?.classList.toggle('sidebar-collapsed', c); })(); });
    topbarMenuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeSide() : openSide(); });
    sidebarOverlay?.addEventListener('click', closeSide);
    window.addEventListener('resize', () => { if (!isMobile()) closeSide(); });

    // ─── Section toggle ───────────────────────────────────────
    function switchToHistory() {
        currentSection = 'history';
        if (sectionWrite)   sectionWrite.style.display   = 'none';
        if (sectionHistory) sectionHistory.style.display = 'block';
        if (mainToggleBtn) { const s = mainToggleBtn.querySelector('span'); const i = mainToggleBtn.querySelector('i'); if (s) s.textContent = 'Novo Comunicado'; if (i) i.className = 'fas fa-plus'; }
        if (fabBtn) { fabBtn.innerHTML = '<i class="fas fa-plus"></i>'; }
        renderizarMensagens();
    }
    function switchToWriting() {
        currentSection = 'writing';
        if (sectionWrite)   sectionWrite.style.display   = 'block';
        if (sectionHistory) sectionHistory.style.display = 'none';
        if (mainToggleBtn) { const s = mainToggleBtn.querySelector('span'); const i = mainToggleBtn.querySelector('i'); if (s) s.textContent = 'Comunicados Enviados'; if (i) i.className = 'fas fa-history'; }
        if (fabBtn) { fabBtn.innerHTML = '<i class="fas fa-history"></i>'; }
    }
    mainToggleBtn?.addEventListener('click', () => currentSection === 'writing' ? switchToHistory() : switchToWriting());
    fabBtn?.addEventListener('click',        () => currentSection === 'writing' ? switchToHistory() : switchToWriting());

    // ─── Modal ────────────────────────────────────────────────
    window.openModal  = () => { if (!messageInput?.value.trim()) { alert('Por favor, digite uma mensagem.'); messageInput?.focus(); return; } if (modal) modal.style.display = 'flex'; };
    window.closeModal = () => { if (modal) modal.style.display = 'none'; };

    window.confirmSend = async (setor) => {
        const texto = messageInput?.value.trim();
        if (!texto) return;
        const { data, error } = await sb.from('messages').insert({ texto, destino: setor, created_by: user.id }).select().single();
        if (error) { console.error('[Nexus] confirmSend:', error); return; }
        dbMensagens.unshift(data);
        readCountMap[data.id] = 0;
        window.closeModal();
        const sendBtn = document.querySelector('.send-button');
        if (sendBtn) {
            const original = sendBtn.innerHTML;
            sendBtn.classList.add('sent-success'); sendBtn.innerHTML = '<i class="fas fa-check"></i> Enviado!'; sendBtn.disabled = true;
            setTimeout(() => { sendBtn.classList.remove('sent-success'); sendBtn.innerHTML = original; sendBtn.disabled = false; if (messageInput) messageInput.value = ''; }, 2000);
        } else { if (messageInput) messageInput.value = ''; }
        if (currentSection === 'history') renderizarMensagens();
    };

    // ─── Filter ───────────────────────────────────────────────
    window.setHistFilter = function (btn) {
        document.querySelectorAll('.hist-chip').forEach(c => c.classList.remove('hist-chip--active'));
        btn.classList.add('hist-chip--active');
        histFilter = btn.dataset.dest;
        renderizarMensagens();
    };
    const filteredMsgs = () => histFilter === 'todos' ? dbMensagens : dbMensagens.filter(m => m.destino === histFilter);

    // ─── Render ───────────────────────────────────────────────
    function renderizarMensagens() { renderizarTabela(); renderizarCards(); }

    function renderizarTabela() {
        if (!messagesList) return;
        const msgs = filteredMsgs();
        if (!msgs.length) { messagesList.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;opacity:.6;">Nenhum comunicado encontrado.</td></tr>`; return; }
        messagesList.innerHTML = msgs.map(m => {
            const t = escHTML(m.texto); const reads = countReads(m.id);
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
        if (!msgs.length) { messagesCards.innerHTML = `<div style="text-align:center;padding:32px;opacity:.6;font-size:14px;">Nenhum comunicado encontrado.</div>`; return; }
        messagesCards.innerHTML = msgs.map(m => {
            const t = escHTML(m.texto); const reads = countReads(m.id);
            return `<div class="msg-card-item">
                <div class="msg-card-body">
                    <div class="msg-card-top">
                        <span class="msg-card-date">${escHTML(fmtDate(m.created_at))}</span>
                        <span class="msg-card-dest">${escHTML(m.destino)}</span>
                        ${reads > 0 ? `<span class="reads-badge"><i class="fas fa-eye"></i> ${reads}</span>` : ''}
                    </div>
                    <div class="msg-card-text" title="${t}">${t}</div>
                </div>
                <div class="msg-card-actions"><button class="delete-btn" data-id="${m.id}" aria-label="Excluir"><i class="fas fa-trash"></i></button></div>
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
        renderizarMensagens();
    }

    messagesList?.addEventListener('click', handleDelete);
    messagesCards?.addEventListener('click', handleDelete);

    // ─── Realtime ─────────────────────────────────────────────
    sb.channel('messages-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => {
            await loadMessages();
            if (currentSection === 'history') renderizarMensagens();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, async () => {
            const { data: reads } = await sb.from('message_reads').select('message_id');
            readCountMap = {};
            (reads || []).forEach(r => { readCountMap[r.message_id] = (readCountMap[r.message_id] || 0) + 1; });
            if (currentSection === 'history') renderizarMensagens();
        })
        .subscribe();

    document.addEventListener('keydown', e => { if (e.key === 'Escape') { window.closeModal(); if (isMobile()) closeSide(); } });
    window.addEventListener('click', e => { if (e.target === modal) window.closeModal(); });

    await loadMessages();
});
