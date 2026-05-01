document.addEventListener('DOMContentLoaded', () => {
    const session = (() => {
        try {
            const s = localStorage.getItem('nexus_session');
            return s ? JSON.parse(s) : null;
        } catch { return null; }
    })();

    if (!session || session.profile === 'rh') {
        window.location.href = '../screens/login.html';
        return;
    }

    const STORAGE_KEY = 'nexus_docs_colaborador';

    const docList        = document.getElementById('doc-list');
    const docCountBadge  = document.getElementById('doc-count-badge');
    const docEmpty       = document.getElementById('doc-empty');
    const docWrap        = document.getElementById('doc-wrap');
    const uploadModal    = document.getElementById('upload-modal');
    const dropZone       = document.getElementById('drop-zone');
    const fileInput      = document.getElementById('file-input');
    const fileSelected   = document.getElementById('file-selected');
    const fileSelectedName = document.getElementById('file-selected-name');
    const mobileSelect   = document.getElementById('doc-select-mobile');

    let selectedFile = null;
    let selectedId   = null;

    // ── Helpers de storage ──
    function loadDocs() {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            return all.filter(d => d.employeeEmail === session.email);
        } catch { return []; }
    }

    function saveDoc(doc) {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            all.unshift(doc);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        } catch (e) { console.error(e); }
    }

    function removeDoc(id) {
        try {
            const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(
                all.filter(d => !(d.id === id && d.employeeEmail === session.email))
            ));
        } catch (e) { console.error(e); }
    }

    // ── Ícone por extensão ──
    function getIconInfo(name) {
        const ext = (name || '').split('.').pop().toLowerCase();
        if (ext === 'pdf')                       return { cls: 'pdf',   fa: 'fa-file-pdf' };
        if (['doc','docx'].includes(ext))        return { cls: 'doc',   fa: 'fa-file-word' };
        if (['jpg','jpeg','png'].includes(ext))  return { cls: 'img',   fa: 'fa-file-image' };
        return { cls: 'other', fa: 'fa-file' };
    }

    // ── Mapa de status ──
    const statusMap = {
        pendente: { cls: 'pendente', label: 'Pendente',  icon: 'fa-clock' },
        aprovado: { cls: 'aprovado', label: 'Aprovado',  icon: 'fa-check-circle' },
        recusado: { cls: 'recusado', label: 'Recusado',  icon: 'fa-times-circle' },
    };

    // ── Renderiza lista ──
    function renderList() {
        const docs = loadDocs();
        docCountBadge.textContent = docs.length;

        // Atualiza select mobile
        mobileSelect.innerHTML = '<option value="">Selecione um documento...</option>' +
            docs.map(d => `<option value="${d.id}"${d.id === selectedId ? ' selected' : ''}>${d.name}</option>`).join('');

        if (docs.length === 0) {
            docList.innerHTML = `
                <div class="doc-list-empty">
                    <i class="fas fa-folder-open"></i>
                    <p>Nenhum documento</p>
                    <span>Clique em "Enviar Documento" para começar</span>
                </div>`;
            showEmptyPanel();
            return;
        }

        docList.innerHTML = docs.map(d => {
            const { cls, fa } = getIconInfo(d.name);
            const st = statusMap[d.status] || statusMap.pendente;
            return `
                <div class="doc-card-item${d.id === selectedId ? ' active' : ''}" onclick="selectDocById(${d.id})">
                    <div class="doc-card-icon doc-card-icon--${cls}">
                        <i class="fas ${fa}"></i>
                    </div>
                    <div class="doc-card-body">
                        <span class="doc-card-name" title="${d.name}">${d.name}</span>
                        <span class="doc-card-tipo">${d.tipo} · ${d.date}</span>
                    </div>
                    <span class="doc-card-status doc-card-status--${st.cls}">
                        <i class="fas ${st.icon}"></i> ${st.label}
                    </span>
                </div>`;
        }).join('');

        // Mantém seleção atual se ainda existir
        if (selectedId && docs.find(d => d.id === selectedId)) {
            showDocDetail(docs.find(d => d.id === selectedId));
        } else {
            showEmptyPanel();
        }
    }

    // ── Painel vazio ──
    function showEmptyPanel() {
        selectedId = null;
        docEmpty?.classList.remove('hidden');
        docWrap?.classList.add('hidden');
    }

    // ── Exibe detalhe ──
    function showDocDetail(doc) {
        docEmpty?.classList.add('hidden');
        docWrap?.classList.remove('hidden');

        const st = statusMap[doc.status] || statusMap.pendente;
        const { cls: iconCls, fa: iconFa } = getIconInfo(doc.name);

        // Barra de ações
        const nameEl   = document.getElementById('action-doc-name');
        const badgeEl  = document.getElementById('action-status-badge');
        if (nameEl)  nameEl.textContent = doc.name;
        if (badgeEl) {
            badgeEl.className = `doc-status-badge ${st.cls}`;
            badgeEl.innerHTML = `<i class="fas ${st.icon}"></i> ${st.label}`;
        }

        // Info grid
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
        set('detail-employee', doc.employee);
        set('detail-tipo',     doc.tipo);
        set('detail-tipo2',    doc.tipo);
        set('detail-date',     doc.date);
        set('detail-size',     doc.size);
        set('detail-filename', doc.name);
        set('detail-footer-date', doc.date);

        // Status no grid
        const statusEl = document.getElementById('detail-status');
        if (statusEl) {
            statusEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:.8rem;font-weight:700;background:${st.cls === 'aprovado' ? '#dcfce7' : st.cls === 'recusado' ? '#fee2e2' : '#fef3c7'};color:${st.cls === 'aprovado' ? '#065f46' : st.cls === 'recusado' ? '#991b1b' : '#92400e'}"><i class="fas ${st.icon}"></i> ${st.label}</span>`;
        }

        // Preview
        const previewIcon = document.getElementById('detail-file-icon');
        if (previewIcon) {
            previewIcon.className = `doc-preview-icon doc-preview-icon--${iconCls}`;
            previewIcon.innerHTML = `<i class="fas ${iconFa}"></i>`;
        }
        set('detail-preview-name', doc.name);
        set('detail-preview-meta', `${doc.tipo} · ${doc.size} · Enviado em ${doc.date}`);
    }

    // ── Seleção por ID ──
    window.selectDocById = (id) => {
        const numId = Number(id);
        if (!numId) { showEmptyPanel(); return; }
        const docs = loadDocs();
        const doc  = docs.find(d => d.id === numId);
        if (!doc) { showEmptyPanel(); return; }
        selectedId = numId;
        renderList();
        showDocDetail(doc);
    };

    // ── Remoção do doc selecionado ──
    window.deleteSelectedDoc = () => {
        if (!selectedId) return;
        if (!confirm('Deseja realmente remover este documento?')) return;
        removeDoc(selectedId);
        selectedId = null;
        renderList();
        showToast('Documento removido', 'O arquivo foi removido com sucesso.');
    };

    // ── Modal de upload ──
    window.openUploadModal = () => {
        uploadModal?.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    window.closeUploadModal = () => {
        uploadModal?.classList.remove('open');
        document.body.style.overflow = '';
        document.getElementById('upload-tipo').value = '';
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
        if (file.size > 50 * 1024 * 1024) {
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
        const tipo = document.getElementById('upload-tipo').value;
        if (!tipo)         { showToast('Campo obrigatório', 'Selecione o tipo de documento.', 'warning'); return; }
        if (!selectedFile) { showToast('Campo obrigatório', 'Selecione um arquivo para enviar.', 'warning'); return; }

        const sizeKB    = Math.round(selectedFile.size / 1024);
        const sizeLabel = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;

        const doc = {
            id:            Date.now(),
            name:          selectedFile.name,
            employee:      session.name,
            employeeEmail: session.email,
            tipo,
            date:          new Date().toLocaleDateString('pt-BR'),
            size:          sizeLabel,
            status:        'pendente'
        };

        saveDoc(doc);
        selectedId = doc.id;
        closeUploadModal();
        renderList();
        showToast('Documento enviado!', `${doc.name} foi enviado para análise do RH.`);
    };

    uploadModal?.addEventListener('click', (e) => { if (e.target === uploadModal) closeUploadModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUploadModal(); });

    // ── Toast ──
    function showToast(title, msg, type = 'success') {
        const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle' };
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
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
    }

    // ── Logout ──
    window.logout = () => {
        localStorage.removeItem('nexus_session');
        window.location.href = '../screens/login.html';
    };

    // Recarrega quando RH atualiza status
    window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) renderList();
    });

    renderList();
});
