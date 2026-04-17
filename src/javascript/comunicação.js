document.addEventListener('DOMContentLoaded', () => {
    const sidebar          = document.getElementById('sidebar');
    const sidebarToggle    = document.getElementById('sidebar-toggle');
    const sidebarOverlay   = document.querySelector('.sidebar-overlay');
    const messageInput     = document.getElementById('message-text');
    const mainToggleBtn    = document.getElementById('main-toggle-btn');
    const modal            = document.getElementById('destinationModal');
    const sectionWrite     = document.getElementById('write-section');
    const sectionHistory   = document.getElementById('sent-messages-section');
    const messagesList     = document.getElementById('messages-list');

    const STORAGE_KEY       = 'nexus_messages';
    const SIDEBAR_STATE_KEY = 'sidebarState';

    const defaultMessages = [
        { id: 1, data: "15/04/2026", texto: "Bem-vindos ao novo portal Nexus!", destino: "Todos" },
        { id: 2, data: "16/04/2026", texto: "Lembrete: Atualização de sistemas hoje às 22h.", destino: "TI" }
    ];

    let dbMensagens = (() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : defaultMessages;
        } catch {
            return defaultMessages;
        }
    })();

    function salvarMensagens() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dbMensagens));
        } catch (e) {
            console.error('Erro ao salvar no localStorage:', e);
        }
    }

    const isMobile = () => window.innerWidth <= 768;

    const escapeHTML = (str) => String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    function openSidebar() {
        if (!sidebar) return;
        sidebar.classList.add('active');
        sidebarOverlay?.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        if (!sidebar) return;
        sidebar.classList.remove('active');
        sidebarOverlay?.classList.remove('active');
        document.body.style.overflow = '';
    }

    sidebarToggle?.addEventListener('click', (e) => {
        e.preventDefault();
        if (isMobile()) {
            sidebar.classList.contains('active') ? closeSidebar() : openSidebar();
        } else {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem(SIDEBAR_STATE_KEY, sidebar.classList.contains('collapsed') ? 'collapsed' : 'expanded');
        }
    });

    sidebarOverlay?.addEventListener('click', closeSidebar);

    mainToggleBtn?.addEventListener('click', () => {
        const isWriting = mainToggleBtn.getAttribute('data-current') === 'writing';
        const btnText   = mainToggleBtn.querySelector('span');
        const btnIcon   = mainToggleBtn.querySelector('i');

        if (isWriting) {
            if(sectionWrite) sectionWrite.style.display = 'none';
            if(sectionHistory) sectionHistory.style.display = 'block';
            mainToggleBtn.setAttribute('data-current', 'history');
            if(btnText) btnText.textContent = 'Novo Comunicado';
            if(btnIcon) btnIcon.className = 'fas fa-plus';
            renderizarMensagens();
        } else {
            if(sectionWrite) sectionWrite.style.display = 'block';
            if(sectionHistory) sectionHistory.style.display = 'none';
            mainToggleBtn.setAttribute('data-current', 'writing');
            if(btnText) btnText.textContent = 'Comunicados Enviados';
            if(btnIcon) btnIcon.className = 'fas fa-history';
        }
    });

    window.openModal = () => {
        if (!messageInput || !messageInput.value.trim()) {
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
        const texto = messageInput.value.trim();
        if (!texto) return;

        const novaMsg = {
            id: Date.now(),
            data: new Date().toLocaleDateString('pt-BR'),
            texto,
            destino: setor
        };

        dbMensagens.unshift(novaMsg);
        salvarMensagens();
        window.closeModal();

        const triggerBtn = document.querySelector('.main-send-btn'); 
        if (triggerBtn) {
            const originalContent = triggerBtn.innerHTML;
            triggerBtn.classList.add('sent-success');
            triggerBtn.innerHTML = '<i class="fas fa-check"></i> Enviado';
            triggerBtn.disabled = true;

            setTimeout(() => {
                triggerBtn.classList.remove('sent-success');
                triggerBtn.innerHTML = originalContent;
                triggerBtn.disabled = false;
                messageInput.value = '';
            }, 2000);
        } else {
            messageInput.value = '';
            alert('Mensagem enviada com sucesso!');
        }

        if (mainToggleBtn?.getAttribute('data-current') === 'history') {
            renderizarMensagens();
        }
    };

    function renderizarMensagens() {
        if (!messagesList) return;

        if (dbMensagens.length === 0) {
            messagesList.innerHTML = '<tr><td colspan="4" style="text-align:center;opacity:.6;">Nenhum comunicado encontrado.</td></tr>';
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
                </tr>
            `;
        }).join('');
    }

    messagesList?.addEventListener('click', (e) => {
        const btn = e.target.closest('.delete-btn');
        if (btn) {
            const id = Number(btn.dataset.id);
            if (confirm('Deseja realmente excluir este comunicado?')) {
                dbMensagens = dbMensagens.filter(m => m.id !== id);
                salvarMensagens();
                renderizarMensagens();
            }
        }
    });

    if (!isMobile() && localStorage.getItem(SIDEBAR_STATE_KEY) === 'collapsed') {
        sidebar?.classList.add('collapsed');
    }

    window.addEventListener('resize', () => {
        if (!isMobile()) closeSidebar();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.closeModal();
            if (isMobile()) closeSidebar();
        }
    });

    window.addEventListener('click', (e) => {
        if (e.target === modal) window.closeModal();
    });
});