document.addEventListener('DOMContentLoaded', () => {
    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');

    const searchInput    = document.getElementById('search-input');
    const searchClear    = document.getElementById('search-clear');
    const filesTbody     = document.getElementById('files-tbody');
    const uploadModal    = document.getElementById('upload-modal');
    const dropZone       = document.getElementById('drop-zone');
    const fileInput      = document.getElementById('file-input');
    const fileSelected   = document.getElementById('file-selected');
    const fileSelectedName = document.getElementById('file-selected-name');

    const STORAGE_KEY       = 'nexus_arquivos';
    const SIDEBAR_STATE_KEY = 'sidebarState_arquivos';

    let activeTab    = 'admissional';
    let selectedFile = null;

    const defaultFiles = [
        { id: 1, name: 'Contrato_Ana_Silva.pdf',        employee: 'Ana Silva',      tab: 'admissional', tipo: 'Contrato de Trabalho',  date: '10/01/2026', size: '245 KB' },
        { id: 2, name: 'Ficha_Registro_Carlos.pdf',     employee: 'Carlos Souza',   tab: 'admissional', tipo: 'Ficha de Registro',      date: '15/01/2026', size: '180 KB' },
        { id: 3, name: 'Exame_Admissional_Maria.pdf',   employee: 'Maria Costa',    tab: 'admissional', tipo: 'Exame Admissional',      date: '20/01/2026', size: '512 KB' },
        { id: 4, name: 'Aviso_Previo_Joao.pdf',         employee: 'João Ferreira',  tab: 'demissional', tipo: 'Aviso Prévio',           date: '05/03/2026', size: '98 KB'  },
        { id: 5, name: 'Rescisao_Pedro.pdf',            employee: 'Pedro Almeida',  tab: 'demissional', tipo: 'Termo de Rescisão',      date: '12/03/2026', size: '320 KB' },
        { id: 6, name: 'Homologacao_Lucia.pdf',         employee: 'Lúcia Ramos',    tab: 'demissional', tipo: 'Homologação',            date: '18/03/2026', size: '210 KB' },
    ];

    let arquivos = (() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : defaultFiles;
        } catch { return defaultFiles; }
    })();

    function salvar() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arquivos)); }
        catch (e) { console.error(e); }
    }

    const isMobile = () => window.innerWidth <= 768;

    function openMobileSidebar()  { sidebar?.classList.add('open'); sidebarOverlay?.classList.add('active'); document.body.style.overflow = 'hidden'; }
    function closeMobileSidebar() { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; }

    sidebarToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isMobile()) { sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar(); }
        else { const c = sidebar?.classList.toggle('collapsed'); mainWrapper?.classList.toggle('sidebar-collapsed', c); localStorage.setItem(SIDEBAR_STATE_KEY, c ? 'collapsed' : 'expanded'); }
    });

    topbarMenuBtn?.addEventListener('click', (e) => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar(); });
    sidebarOverlay?.addEventListener('click', closeMobileSidebar);

    if (!isMobile() && localStorage.getItem(SIDEBAR_STATE_KEY) === 'collapsed') {
        sidebar?.classList.add('collapsed');
        mainWrapper?.classList.add('sidebar-collapsed');
    }

    window.addEventListener('resize', () => { if (!isMobile()) closeMobileSidebar(); });

    // Carrega info do RH na sidebar
    (() => {
        try {
            const s = JSON.parse(localStorage.getItem('nexus_session') || 'null');
            const nameEl   = document.getElementById('rh-sidebar-name');
            const roleEl   = document.getElementById('rh-sidebar-role');
            const avatarEl = document.getElementById('rh-sidebar-avatar');
            if (!nameEl) return;
            const name = (s && s.name) ? s.name : 'Administrador';
            const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'RH';
            nameEl.textContent   = name;
            if (roleEl)   roleEl.textContent   = 'Recursos Humanos';
            if (avatarEl) avatarEl.textContent = initials;
        } catch {}
    })();

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.getAttribute('data-tab');
            searchInput.value = '';
            searchClear?.classList.add('hidden');
            renderTable();
        });
    });

    searchInput?.addEventListener('input', () => {
        const q = searchInput.value.trim();
        searchClear?.classList.toggle('hidden', q.length === 0);
        renderTable();
    });

    searchClear?.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.classList.add('hidden');
        renderTable();
    });

    function getFileIcon(name) {
        const ext = name.split('.').pop().toLowerCase();
        if (ext === 'pdf')  return { cls: 'file-icon--pdf',   icon: 'fa-file-pdf' };
        if (['doc','docx'].includes(ext)) return { cls: 'file-icon--doc', icon: 'fa-file-word' };
        if (['jpg','jpeg','png'].includes(ext)) return { cls: 'file-icon--img', icon: 'fa-file-image' };
        return { cls: 'file-icon--other', icon: 'fa-file' };
    }

    function renderTable() {
        const q = searchInput?.value.toLowerCase().trim() || '';

        const filtered = arquivos.filter(f => {
            if (f.tab !== activeTab) return false;
            if (!q) return true;
            return f.name.toLowerCase().includes(q) ||
                   f.employee.toLowerCase().includes(q) ||
                   f.tipo.toLowerCase().includes(q);
        });

        updateStats();

        if (filtered.length === 0) {
            filesTbody.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="empty-state">
                            <i class="fas fa-folder-open"></i>
                            <p>Nenhum arquivo encontrado</p>
                            <span>${q ? `Nenhum resultado para "${q}"` : 'Clique em "Enviar Arquivo" para adicionar'}</span>
                        </div>
                    </td>
                </tr>`;
            return;
        }

        filesTbody.innerHTML = filtered.map(f => {
            const { cls, icon } = getFileIcon(f.name);
            const badgeCls = f.tab === 'admissional' ? 'badge-tipo--admissional' : 'badge-tipo--demissional';
            const badgeLabel = f.tab === 'admissional' ? 'Admissional' : 'Demissional';
            return `
                <tr>
                    <td>
                        <div class="file-name-cell">
                            <div class="file-icon ${cls}"><i class="fas ${icon}"></i></div>
                            <div>
                                <div class="file-name" title="${f.name}">${f.name}</div>
                                <div class="file-employee">${f.tipo}</div>
                            </div>
                        </div>
                    </td>
                    <td>${f.employee}</td>
                    <td><span class="badge-tipo ${badgeCls}">${badgeLabel}</span></td>
                    <td class="file-date">${f.date}</td>
                    <td class="file-size">${f.size}</td>
                    <td>
                        <div class="actions-cell">
                            <button class="btn-icon btn-icon--view" title="Visualizar" onclick="viewFile(${f.id})">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-icon btn-icon--delete" title="Excluir" onclick="deleteFile(${f.id})">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
        }).join('');
    }

    function updateStats() {
        const admCount  = arquivos.filter(f => f.tab === 'admissional').length;
        const demCount  = arquivos.filter(f => f.tab === 'demissional').length;
        document.getElementById('total-count').textContent       = arquivos.length;
        document.getElementById('admissional-count').textContent = admCount;
        document.getElementById('demissional-count').textContent = demCount;
    }

    window.viewFile = (id) => {
        const f = arquivos.find(a => a.id === id);
        if (f) showToast('Visualizar', `Abrindo: ${f.name}`, 'success');
    };

    window.deleteFile = (id) => {
        if (!confirm('Deseja realmente excluir este arquivo?')) return;
        arquivos = arquivos.filter(a => a.id !== id);
        salvar();
        renderTable();
        showToast('Arquivo Excluído!', 'O arquivo foi removido com sucesso.', 'error');
    };

    window.openUploadModal = () => {
        uploadModal?.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    window.closeUploadModal = () => {
        uploadModal?.classList.remove('open');
        document.body.style.overflow = '';
        document.getElementById('upload-employee').value = '';
        document.getElementById('upload-category').value = '';
        clearFileInput();
    };

    dropZone?.addEventListener('click', () => fileInput?.click());

    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) setSelectedFile(file);
    });

    fileInput?.addEventListener('change', () => {
        if (fileInput.files[0]) setSelectedFile(fileInput.files[0]);
    });

    function setSelectedFile(file) {
        const MAX_SIZE = 50 * 1024 * 1024; 
        if (file.size > MAX_SIZE) {
            showToast('Arquivo muito grande!', 'O arquivo ultrapassa o limite de 50 MB.', 'warning');
            return;
        }

        selectedFile = file;
        dropZone?.classList.add('hidden');
        fileSelected?.classList.remove('hidden');
        if (fileSelectedName) fileSelectedName.textContent = file.name;
    }

    window.clearFileInput = () => {
        selectedFile = null;
        if (fileInput) fileInput.value = '';
        fileSelected?.classList.add('hidden');
        dropZone?.classList.remove('hidden');
    };

    window.submitUpload = () => {
        const employee = document.getElementById('upload-employee').value.trim();
        const categoryRaw = document.getElementById('upload-category').value;

        if (!employee)     { showToast('Campo obrigatório', 'Informe o nome do colaborador.', 'warning'); return; }
        if (!categoryRaw)  { showToast('Campo obrigatório', 'Selecione a categoria do arquivo.', 'warning'); return; }
        if (!selectedFile) { showToast('Campo obrigatório', 'Selecione um arquivo para enviar.', 'warning'); return; }

        const [tab, tipo] = categoryRaw.split('|');
        const sizeKB = Math.round(selectedFile.size / 1024);
        const sizeLabel = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;

        const novoArquivo = {
            id:       Date.now(),
            name:     selectedFile.name,
            employee,
            tab,
            tipo,
            date:     new Date().toLocaleDateString('pt-BR'),
            size:     sizeLabel
        };

        arquivos.unshift(novoArquivo);
        salvar();

        activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-tab') === tab);
        });

        closeUploadModal();
        renderTable();
        showToast('Arquivo carregado com sucesso', `${novoArquivo.name} foi adicionado à aba ${tab === 'admissional' ? 'Admissional' : 'Demissional'}.`, 'success');
    };

    uploadModal?.addEventListener('click', (e) => { if (e.target === uploadModal) closeUploadModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeUploadModal(); if (isMobile()) closeMobileSidebar(); } });

    function showToast(title, msg, type = 'success') {
        const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle' };
        let container = document.getElementById('toast-container');
        if (!container) { container = document.createElement('div'); container.id = 'toast-container'; container.className = 'toast-container'; document.body.appendChild(container); }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
            <div class="toast-content"><p class="toast-title">${title}</p><p class="toast-msg">${msg}</p></div>
            <button class="toast-close" onclick="this.closest('.toast').classList.add('hide'); setTimeout(()=>this.closest('.toast').remove(),400)">
                <i class="fas fa-times"></i>
            </button>`;
        container.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 400); }, 4000);
    }

    renderTable();
});