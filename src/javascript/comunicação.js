document.addEventListener('DOMContentLoaded', () => {
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

    const STORAGE_KEY       = 'nexus_messages';
    const SIDEBAR_STATE_KEY = 'sidebarState_comunicacao';

    const defaultMessages = [
        { id: 1, data: '15/04/2026', texto: 'Bem-vindos ao novo portal Nexus!', destino: 'Todos' },
        { id: 2, data: '16/04/2026', texto: 'Lembrete: Atualização de sistemas hoje às 22h.', destino: 'TI' }
    ];

    let dbMensagens = (() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : defaultMessages;
        } catch { return defaultMessages; }
    })();

    function salvarMensagens() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(dbMensagens)); }
        catch (e) { console.error('Erro ao salvar:', e); }
    }

    const escapeHTML = (str) => String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const isMobile = () => window.innerWidth <= 768;

    function openMobileSidebar() {
        sidebar?.classList.add('open');
        sidebarOverlay?.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeMobileSidebar() {
        sidebar?.classList.remove('open');
        sidebarOverlay?.classList.remove('active');
        document.body.style.overflow = '';
    }

    sidebarToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isMobile()) {
            sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar();
        } else {
            const collapsed = sidebar?.classList.toggle('collapsed');
            mainWrapper?.classList.toggle('sidebar-collapsed', collapsed);
            localStorage.setItem(SIDEBAR_STATE_KEY, collapsed ? 'collapsed' : 'expanded');
        }
    });

    topbarMenuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar();
    });

    sidebarOverlay?.addEventListener('click', closeMobileSidebar);

    if (!isMobile() && localStorage.getItem(SIDEBAR_STATE_KEY) === 'collapsed') {
        sidebar?.classList.add('collapsed');
        mainWrapper?.classList.add('sidebar-collapsed');
    }

    window.addEventListener('resize', () => {
        if (!isMobile()) closeMobileSidebar();
    });

    let currentSection = 'writing';

    function switchToHistory() {
        currentSection = 'history';
        if (sectionWrite)   sectionWrite.style.display   = 'none';
        if (sectionHistory) sectionHistory.style.display = 'block';

        if (mainToggleBtn) {
            mainToggleBtn.setAttribute('data-current', 'history');
            const span = mainToggleBtn.querySelector('span');
            const icon = mainToggleBtn.querySelector('i');
            if (span) span.textContent = 'Novo Comunicado';
            if (icon) icon.className   = 'fas fa-plus';
        }

        if (fabBtn) {
            fabBtn.setAttribute('aria-label', 'Novo Comunicado');
            fabBtn.innerHTML = '<i class="fas fa-plus"></i>';
        }

        renderizarMensagens();
    }

    function switchToWriting() {
        currentSection = 'writing';
        if (sectionWrite)   sectionWrite.style.display   = 'block';
        if (sectionHistory) sectionHistory.style.display = 'none';

        if (mainToggleBtn) {
            mainToggleBtn.setAttribute('data-current', 'writing');
            const span = mainToggleBtn.querySelector('span');
            const icon = mainToggleBtn.querySelector('i');
            if (span) span.textContent = 'Comunicados Enviados';
            if (icon) icon.className   = 'fas fa-history';
        }

        if (fabBtn) {
            fabBtn.setAttribute('aria-label', 'Comunicados Enviados');
            fabBtn.innerHTML = '<i class="fas fa-history"></i>';
        }
    }

    function toggleSection() {
        currentSection === 'writing' ? switchToHistory() : switchToWriting();
    }

    mainToggleBtn?.addEventListener('click', toggleSection);
    fabBtn?.addEventListener('click', toggleSection);

    window.openModal = () => {
        if (!messageInput?.value.trim()) {
            alert('Por favor, digite uma mensagem.');
            messageInput?.focus();
            return;
        }
        if (modal) modal.style.display = 'flex';
    };

    window.closeModal = () => {
        if (modal) modal.style.display = 'none';
    };

    window.confirmSend = (setor) => {
        const texto = messageInput?.value.trim();
        if (!texto) return;

        const novaMsg = {
            id:      Date.now(),
            data:    new Date().toLocaleDateString('pt-BR'),
            texto,
            destino: setor
        };

        dbMensagens.unshift(novaMsg);
        salvarMensagens();
        window.closeModal();

        const sendBtn = document.querySelector('.send-button');
        if (sendBtn) {
            const original = sendBtn.innerHTML;
            sendBtn.classList.add('sent-success');
            sendBtn.innerHTML = '<i class="fas fa-check"></i> Enviado!';
            sendBtn.disabled  = true;

            setTimeout(() => {
                sendBtn.classList.remove('sent-success');
                sendBtn.innerHTML = original;
                sendBtn.disabled  = false;
                if (messageInput) messageInput.value = '';
            }, 2000);
        } else {
            if (messageInput) messageInput.value = '';
        }

        if (currentSection === 'history') renderizarMensagens();
    };

    function renderizarMensagens() {
        renderizarTabela();
        renderizarCards();
    }

    function renderizarTabela() {
        if (!messagesList) return;

        if (dbMensagens.length === 0) {
            messagesList.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align:center;padding:32px;opacity:.6;">
                        Nenhum comunicado encontrado.
                    </td>
                </tr>`;
            return;
        }

        messagesList.innerHTML = dbMensagens.map(msg => {
            const textoSafe = escapeHTML(msg.texto);
            return `
                <tr>
                    <td>${escapeHTML(msg.data)}</td>
                    <td><div class="message-preview" title="${textoSafe}">${textoSafe}</div></td>
                    <td><span class="badge-dest">${escapeHTML(msg.destino)}</span></td>
                    <td>
                        <button class="delete-btn" data-id="${msg.id}" aria-label="Excluir">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>`;
        }).join('');
    }

    function renderizarCards() {
        if (!messagesCards) return;

        if (dbMensagens.length === 0) {
            messagesCards.innerHTML = `
                <div style="text-align:center;padding:32px;opacity:.6;font-size:14px;color:var(--text-secondary);">
                    Nenhum comunicado encontrado.
                </div>`;
            return;
        }

        messagesCards.innerHTML = dbMensagens.map(msg => {
            const textoSafe = escapeHTML(msg.texto);
            return `
                <div class="msg-card-item">
                    <div class="msg-card-body">
                        <div class="msg-card-top">
                            <span class="msg-card-date">${escapeHTML(msg.data)}</span>
                            <span class="msg-card-dest">${escapeHTML(msg.destino)}</span>
                        </div>
                        <div class="msg-card-text" title="${textoSafe}">${textoSafe}</div>
                    </div>
                    <div class="msg-card-actions">
                        <button class="delete-btn" data-id="${msg.id}" aria-label="Excluir">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>`;
        }).join('');
    }

    function handleDelete(e) {
        const btn = e.target.closest('.delete-btn');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        if (confirm('Deseja realmente excluir este comunicado?')) {
            dbMensagens = dbMensagens.filter(m => m.id !== id);
            salvarMensagens();
            renderizarMensagens();
        }
    }

    messagesList?.addEventListener('click', handleDelete);
    messagesCards?.addEventListener('click', handleDelete);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.closeModal();
            if (isMobile()) closeMobileSidebar();
        }
    });

    window.addEventListener('click', (e) => {
        if (e.target === modal) window.closeModal();
    });

});