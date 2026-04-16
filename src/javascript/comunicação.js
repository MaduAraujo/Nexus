document.addEventListener('DOMContentLoaded', () => {
    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const messageInput   = document.getElementById('message-text');
    const mainToggleBtn  = document.getElementById('main-toggle-btn');
    const modal          = document.getElementById('destinationModal');
    const sectionWrite   = document.getElementById('write-section');
    const sectionHistory = document.getElementById('sent-messages-section');
    const messagesList   = document.getElementById('messages-list');

    const STORAGE_KEY       = 'nexus_messages';
    const SIDEBAR_STATE_KEY = 'sidebarState';

    const defaultMessages = [
        { id: 1, data: "15/04/2026", texto: "Bem-vindos ao novo portal Nexus!", destino: "Todos" },
        { id: 2, data: "16/04/2026", texto: "Lembrete: Atualização de sistemas hoje às 22h.", destino: "TI" }
    ];

    let dbMensagens = (() => {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultMessages;
        } catch {
            return defaultMessages;
        }
    })();

    function salvarMensagens() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(dbMensagens));
        } catch (e) {
            console.warn('Não foi possível salvar no localStorage:', e);
        }
    }

    function handleToggle(e) {
        e.preventDefault();
        sidebar.classList.toggle('collapsed');
        try {
            localStorage.setItem(
                SIDEBAR_STATE_KEY,
                sidebar.classList.contains('collapsed') ? 'collapsed' : 'expanded'
            );
        } catch {}
    }

    sidebarToggle.addEventListener('click', handleToggle);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (modal.style.display === 'flex') closeModal();
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    if (localStorage.getItem(SIDEBAR_STATE_KEY) === 'collapsed') {
        sidebar.classList.add('collapsed');
    }

    window.openModal = () => {
        if (!messageInput.value.trim()) {
            alert('Por favor, digite uma mensagem.');
            messageInput.focus();
            return;
        }
        modal.style.display = 'flex';
    };

    window.closeModal = () => {
        modal.style.display = 'none';
    };

    window.confirmSend = (setor) => {
        const texto = messageInput.value.trim();
        if (!texto) return;

        const sendBtn = document.querySelector('.send-button');

        const novaMsg = {
            id: Date.now(),
            data: new Date().toLocaleDateString('pt-BR'),
            texto,
            destino: setor
        };

        dbMensagens.unshift(novaMsg);
        salvarMensagens();
        closeModal();

        const originalContent = sendBtn.innerHTML;
        sendBtn.classList.add('sent-success');
        sendBtn.innerHTML = '<i class="fas fa-check"></i> Enviado';
        sendBtn.disabled = true;

        setTimeout(() => {
            sendBtn.classList.remove('sent-success');
            sendBtn.innerHTML = originalContent;
            sendBtn.disabled = false;
            messageInput.value = '';
        }, 2000);

        if (mainToggleBtn.getAttribute('data-current') === 'history') {
            renderizarMensagens();
        }
    };

    mainToggleBtn.addEventListener('click', () => {
        const isWriting = mainToggleBtn.getAttribute('data-current') === 'writing';
        const btnText   = mainToggleBtn.querySelector('span');
        const btnIcon   = mainToggleBtn.querySelector('i');

        if (isWriting) {
            sectionWrite.style.display   = 'none';
            sectionHistory.style.display = 'block';
            mainToggleBtn.setAttribute('data-current', 'history');
            btnText.textContent = 'Novo Comunicado';
            btnIcon.className   = 'fas fa-plus';
            renderizarMensagens();
        } else {
            sectionWrite.style.display   = 'block';
            sectionHistory.style.display = 'none';
            mainToggleBtn.setAttribute('data-current', 'writing');
            btnText.textContent = 'Comunicados Enviados';
            btnIcon.className   = 'fas fa-history';
        }
    });

    function renderizarMensagens() {
        if (!messagesList) return;

        const fragment = document.createDocumentFragment();

        if (dbMensagens.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td colspan="4" style="text-align:center;opacity:.6;">Nenhum comunicado encontrado.</td>';
            fragment.appendChild(tr);
        } else {
            dbMensagens.forEach(msg => {
                const tr = document.createElement('tr');
                const textoSafe = escapeHTML(msg.texto);
                tr.innerHTML = `
                    <td>${escapeHTML(msg.data)}</td>
                    <td><div class="message-preview" title="${textoSafe}">${textoSafe}</div></td>
                    <td><span class="badge-dest">${escapeHTML(msg.destino)}</span></td>
                    <td>
                        <button class="delete-btn" data-id="${msg.id}" aria-label="Excluir comunicado">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                `;
                fragment.appendChild(tr);
            });
        }

        messagesList.innerHTML = '';
        messagesList.appendChild(fragment);
    }

    messagesList?.addEventListener('click', (e) => {
        const btn = e.target.closest('.delete-btn');
        if (!btn) return;
        excluirMensagem(Number(btn.dataset.id));
    });

    window.excluirMensagem = (id) => {
        if (!confirm('Excluir comunicado?')) return;
        dbMensagens = dbMensagens.filter(m => m.id !== id);
        salvarMensagens();
        renderizarMensagens();
    };

    function escapeHTML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
});