document.addEventListener('DOMContentLoaded', async () => {
    // ── Auth ──
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles')
        .select('profile, employee_id')
        .eq('id', user.id)
        .single();

    if (profile?.profile !== 'colaborador' || !profile.employee_id) {
        window.location.href = '../screens/login.html';
        return;
    }

    const myEmployeeId = profile.employee_id;

    const { data: emp } = await sb.from('employees').select('name, role, avatar_color, avatar_url').eq('id', myEmployeeId).single();
    const _ini   = (emp?.name || '?').split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('');
    const _color = emp?.avatar_color || '#6366f1';
    const _av    = document.getElementById('sidebar-avatar');
    if (_av) {
        if (emp?.avatar_url) { _av.style.background = `url(${emp.avatar_url}) center/cover`; _av.textContent = ''; }
        else { _av.style.background = _color; _av.textContent = _ini; }
    }
    const _nm = document.getElementById('sidebar-name'); if (_nm) _nm.textContent = emp?.name || '—';
    const _rl = document.getElementById('sidebar-role'); if (_rl) _rl.textContent = emp?.role || 'Colaborador';

    const docList          = document.getElementById('doc-list');
    const docCountBadge    = document.getElementById('doc-count-badge');
    const docEmpty         = document.getElementById('doc-empty');
    const docWrap          = document.getElementById('doc-wrap');
    const uploadModal      = document.getElementById('upload-modal');
    const dropZone         = document.getElementById('drop-zone');
    const fileInput        = document.getElementById('file-input');
    const fileSelected     = document.getElementById('file-selected');
    const fileSelectedName = document.getElementById('file-selected-name');
    const mobileSelect     = document.getElementById('doc-select-mobile');

    let myDocs       = [];
    let selectedFile = null;
    let selectedId   = null;

    // ── Busca documentos do colaborador ──
    async function refreshDocs() {
        const { data } = await sb.from('documents')
            .select('*')
            .eq('employee_id', myEmployeeId)
            .order('created_at', { ascending: false });
        myDocs = data || [];
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
        if (docCountBadge) docCountBadge.textContent = myDocs.length;

        if (mobileSelect) {
            mobileSelect.innerHTML = '<option value="">Selecione um documento...</option>' +
                myDocs.map(d => `<option value="${d.id}"${d.id === selectedId ? ' selected' : ''}>${d.name}</option>`).join('');
        }

        if (!docList) return;

        if (myDocs.length === 0) {
            docList.innerHTML = `
                <div class="doc-list-empty">
                    <i class="fas fa-folder-open"></i>
                    <p>Nenhum documento</p>
                    <span>Clique em "Enviar Documento" para começar</span>
                </div>`;
            showEmptyPanel();
            return;
        }

        docList.innerHTML = myDocs.map(d => {
            const { cls, fa } = getIconInfo(d.name);
            const st   = statusMap[d.status] || statusMap.pendente;
            const date = new Date(d.created_at).toLocaleDateString('pt-BR');
            return `
                <div class="doc-card-item${d.id === selectedId ? ' active' : ''}" onclick="selectDocById('${d.id}')">
                    <div class="doc-card-icon doc-card-icon--${cls}">
                        <i class="fas ${fa}"></i>
                    </div>
                    <div class="doc-card-body">
                        <span class="doc-card-name" title="${d.name}">${d.name}</span>
                        <span class="doc-card-tipo">${d.tipo} · ${date}</span>
                    </div>
                    <span class="doc-card-status doc-card-status--${st.cls}">
                        <i class="fas ${st.icon}"></i> ${st.label}
                    </span>
                </div>`;
        }).join('');

        const current = selectedId ? myDocs.find(d => d.id === selectedId) : null;
        if (current) showDocDetail(current);
        else showEmptyPanel();
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
        const date = new Date(doc.created_at).toLocaleDateString('pt-BR');

        const nameEl  = document.getElementById('action-doc-name');
        const badgeEl = document.getElementById('action-status-badge');
        if (nameEl)  nameEl.textContent = doc.name;
        if (badgeEl) {
            badgeEl.className = `doc-status-badge ${st.cls}`;
            badgeEl.innerHTML = `<i class="fas ${st.icon}"></i> ${st.label}`;
        }

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
        set('detail-employee',    emp?.name || '—');
        set('detail-tipo',        doc.tipo);
        set('detail-tipo2',       doc.tipo);
        set('detail-date',        date);
        set('detail-size',        doc.size_label);
        set('detail-filename',    doc.name);
        set('detail-footer-date', date);

        const statusEl = document.getElementById('detail-status');
        if (statusEl) {
            statusEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:.8rem;font-weight:700;background:${st.cls === 'aprovado' ? '#dcfce7' : st.cls === 'recusado' ? '#fee2e2' : '#fef3c7'};color:${st.cls === 'aprovado' ? '#065f46' : st.cls === 'recusado' ? '#991b1b' : '#92400e'}"><i class="fas ${st.icon}"></i> ${st.label}</span>`;
        }

        const previewIcon = document.getElementById('detail-file-icon');
        if (previewIcon) {
            previewIcon.className = `doc-preview-icon doc-preview-icon--${iconCls}`;
            previewIcon.innerHTML = `<i class="fas ${iconFa}"></i>`;
        }
        set('detail-preview-name', doc.name);
        set('detail-preview-meta', `${doc.tipo} · ${doc.size_label || '—'} · Enviado em ${date}`);
    }

    // ── Seleção por ID ──
    window.selectDocById = (id) => {
        if (!id) { showEmptyPanel(); return; }
        const doc = myDocs.find(d => d.id === id);
        if (!doc) { showEmptyPanel(); return; }
        selectedId = id;
        renderList();
        showDocDetail(doc);
    };

    // ── Remoção do doc selecionado ──
    window.deleteSelectedDoc = async () => {
        if (!selectedId) return;
        if (!confirm('Deseja realmente remover este documento?')) return;

        const doc = myDocs.find(d => d.id === selectedId);

        if (doc?.storage_path) {
            await sb.storage.from('documents').remove([doc.storage_path]);
        }

        await sb.from('documents').delete().eq('id', selectedId);
        selectedId = null;
        await refreshDocs();
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
        const tipoEl = document.getElementById('upload-tipo');
        if (tipoEl) tipoEl.value = '';
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

    window.submitUpload = async () => {
        const tipo = document.getElementById('upload-tipo')?.value;
        if (!tipo)         { showToast('Campo obrigatório', 'Selecione o tipo de documento.', 'warning'); return; }
        if (!selectedFile) { showToast('Campo obrigatório', 'Selecione um arquivo para enviar.', 'warning'); return; }

        const sizeKB    = Math.round(selectedFile.size / 1024);
        const sizeLabel = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;

        const storagePath = `${myEmployeeId}/${Date.now()}_${selectedFile.name}`;
        let uploadedPath  = null;

        const { error: uploadError } = await sb.storage
            .from('documents')
            .upload(storagePath, selectedFile, { contentType: selectedFile.type });

        if (!uploadError) uploadedPath = storagePath;

        const { data: inserted, error: insertError } = await sb.from('documents').insert({
            name:         selectedFile.name,
            employee_id:  myEmployeeId,
            tipo,
            size_label:   sizeLabel,
            storage_path: uploadedPath,
            source:       'colaborador',
            status:       'pendente',
            created_by:   user.id
        }).select().single();

        if (insertError) {
            if (uploadedPath) await sb.storage.from('documents').remove([uploadedPath]);
            showToast('Erro ao enviar documento.', 'Tente novamente.', 'error');
            return;
        }

        selectedId = inserted.id;
        closeUploadModal();
        await refreshDocs();
        renderList();
        showToast('Documento enviado!', `${inserted.name} foi enviado para análise do RH.`);
    };

    uploadModal?.addEventListener('click', (e) => { if (e.target === uploadModal) closeUploadModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUploadModal(); });

    // ── Realtime: RH atualiza status de documento ──
    sb.channel('docs-colab')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'documents',
            filter: `employee_id=eq.${myEmployeeId}`
        }, async () => {
            await refreshDocs();
            renderList();
        })
        .subscribe();

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
    window.logout = async () => {
        await sb.auth.signOut();
        window.location.href = '../screens/login.html';
    };

    // ── Init ──
    await refreshDocs();
    renderList();
});
