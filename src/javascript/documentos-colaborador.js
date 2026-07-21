document.addEventListener('DOMContentLoaded', async () => {
    // ── Auth ──
    const auth = await NexusAuth.requireProfile('colaborador', 'name');
    if (!auth) return;
    const myEmployeeId = auth.profile.employee_id;
    const emp = auth.employee;

    // Prazos de guarda padrão em anos (mesma referência usada no upload do RH) — ajustável pelo jurídico.
    const RETENTION_YEARS = {
        'Contrato de Trabalho': 30, 'Termo de Rescisão': 30, 'Homologação': 30, 'Guia FGTS': 30,
        'Carteira de Trabalho': 30, 'Exame Admissional': 20, 'Exame Demissional': 20,
        'Aviso Prévio': 5, 'RG': 5, 'CPF': 5, 'Comprovante de Residência': 5,
    };
    const DEFAULT_RETENTION_YEARS = 5;
    function computeRetentionDate(tipo) {
        const years = RETENTION_YEARS[tipo] ?? DEFAULT_RETENTION_YEARS;
        const d = new Date();
        d.setFullYear(d.getFullYear() + years);
        return d.toISOString().slice(0, 10);
    }

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
    let allMyDocs    = [];
    let requiredTipos = [];
    let selectedFile = null;
    let selectedId   = null;

    // Tipos que o próprio colaborador consegue enviar pelo portal (precisa bater com as options do select).
    const SELF_UPLOAD_TIPOS = ['RG', 'CPF', 'Comprovante de Residência', 'Carteira de Trabalho', 'Diploma', 'Certificado', 'Exame Médico', 'Outros'];

    // ── Busca documentos do colaborador ──
    async function refreshDocs() {
        const { data } = await sb.from('documents')
            .select('*')
            .eq('employee_id', myEmployeeId)
            .order('created_at', { ascending: false });
        allMyDocs = data || [];
        myDocs = allMyDocs.filter(d => d.is_current !== false);
    }

    // ── Checklist de documentos obrigatórios (visão do colaborador) ──
    async function loadRequirements() {
        const { data } = await sb.from('document_requirements').select('tipo').eq('category', 'admissional').eq('obrigatorio', true);
        requiredTipos = (data || []).map(r => r.tipo);
    }

    function renderPendingDocsBanner() {
        const banner = document.getElementById('pending-docs-banner');
        if (!banner) return;
        const haveTipos = myDocs.filter(d => d.source === 'Administrador' || d.status === 'aprovado').map(d => d.tipo);
        const missing = requiredTipos.filter(t => !haveTipos.includes(t));
        if (!missing.length) { banner.classList.add('hidden'); return; }

        banner.classList.remove('hidden');
        document.getElementById('pending-docs-text').textContent = `${missing.length} documento${missing.length > 1 ? 's' : ''} obrigatório${missing.length > 1 ? 's' : ''} pendente${missing.length > 1 ? 's' : ''}`;
        document.getElementById('pending-docs-chips').innerHTML = missing.map(t => {
            if (SELF_UPLOAD_TIPOS.includes(t)) {
                return `<button type="button" class="pending-doc-chip" onclick="quickUploadTipo('${t.replace(/'/g,"\\'")}')"><i class="fas fa-plus"></i> ${t}</button>`;
            }
            return `<span class="pending-doc-chip pending-doc-chip--waiting"><i class="fas fa-clock"></i> ${t} — aguardando o RH</span>`;
        }).join('');
    }

    window.quickUploadTipo = (tipo) => {
        openUploadModal();
        const sel = document.getElementById('upload-tipo');
        if (sel) sel.value = tipo;
    };

    // ── Log de auditoria (trilha de criação/substituição/exclusão/assinatura) ──
    async function logAudit(action, doc) {
        await sb.from('document_audit_log').insert({
            document_id: doc.id || null, document_name: doc.name, employee_id: myEmployeeId,
            action, operator_name: emp?.name || 'Colaborador', operator_email: user.email,
        });
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
        renderPendingDocsBanner();
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
                    <span>Clique em <i class="fas fa-arrow-up-from-bracket"></i></span>
                </div>`;
            showEmptyPanel();
            return;
        }

        docList.innerHTML = myDocs.map((d, i) => {
            const { cls, fa } = getIconInfo(d.name);
            const st   = statusMap[d.status] || statusMap.pendente;
            const date = new Date(d.created_at).toLocaleDateString('pt-BR');
            return `
                <div class="doc-card-item${d.id === selectedId ? ' active' : ''}" style="animation-delay:${Math.min(i * 0.04, 0.4)}s" onclick="selectDocById('${d.id}')">
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

        const signArea = document.getElementById('assinatura-area');
        const signBtn   = document.getElementById('btn-sign-doc');
        if (signArea) {
            if (doc.assinado_em) {
                signArea.innerHTML = `<p class="assinatura-done"><i class="fas fa-signature"></i> Assinado por ${doc.assinado_por || emp?.name || ''} em ${new Date(doc.assinado_em).toLocaleString('pt-BR')}</p>`;
            } else if (doc.requer_assinatura) {
                signArea.innerHTML = `<div class="assinatura-line"></div><p class="assinatura-label">Assinatura do Colaborador — pendente</p>`;
            } else {
                signArea.innerHTML = `<div class="assinatura-line"></div><p class="assinatura-label">Assinatura do Colaborador</p>`;
            }
        }
        if (signBtn) signBtn.classList.toggle('hidden', !(doc.requer_assinatura && !doc.assinado_em));

        const deleteBtn = document.getElementById('btn-delete-doc');
        if (deleteBtn) deleteBtn.classList.toggle('hidden', doc.source !== 'colaborador');

        const previewIcon = document.getElementById('detail-file-icon');
        if (previewIcon) {
            previewIcon.className = `doc-preview-icon doc-preview-icon--${iconCls}`;
            previewIcon.innerHTML = `<i class="fas ${iconFa}"></i>`;
        }
        set('detail-preview-name', doc.name);
        set('detail-preview-meta', `${doc.tipo} · ${doc.size_label || '—'} · Enviado em ${date}`);
    }

    // ── Visualizar/baixar o arquivo do documento selecionado ──
    window.viewSelectedDoc = async () => {
        const doc = myDocs.find(d => d.id === selectedId);
        if (!doc?.storage_path) { showToast('Arquivo indisponível', 'Este documento não tem um arquivo para visualizar.', 'warning'); return; }
        const { data, error } = await sb.storage.from('documents').createSignedUrl(doc.storage_path, 3600);
        if (error || !data?.signedUrl) { showToast('Erro ao abrir', 'Não foi possível gerar o link do arquivo.', 'error'); return; }
        window.open(data.signedUrl, '_blank');
    };

    document.getElementById('doc-card')?.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.doc-preview-area--clickable')) {
            e.preventDefault();
            viewSelectedDoc();
        }
    });

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
        const doc = myDocs.find(d => d.id === selectedId);
        if (doc?.source !== 'colaborador') {
            showToast('Não é possível remover', 'Este documento foi enviado pelo RH e só pode ser removido por ele.', 'warning');
            return;
        }
        if (!confirm('Deseja realmente remover este documento?')) return;

        if (doc?.storage_path) {
            await sb.storage.from('documents').remove([doc.storage_path]);
        }

        await sb.from('documents').delete().eq('id', selectedId);
        if (doc) logAudit('excluido', doc);
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

    // ── Modal de assinatura eletrônica ──
    const signModal = document.getElementById('sign-modal');
    const signNameInput = document.getElementById('sign-name-input');
    const signAgreeCheck = document.getElementById('sign-agree-check');

    window.openSignModal = () => {
        if (!selectedId) return;
        if (signNameInput) signNameInput.value = emp?.name || '';
        if (signAgreeCheck) signAgreeCheck.checked = false;
        signModal?.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    window.closeSignModal = () => {
        signModal?.classList.remove('open');
        document.body.style.overflow = '';
    };

    window.confirmSignature = async () => {
        if (!selectedId) return;
        const name = signNameInput?.value.trim();
        if (!name) { showToast('Campo obrigatório', 'Digite seu nome completo para assinar.', 'warning'); return; }
        if (!signAgreeCheck?.checked) { showToast('Confirmação necessária', 'Confirme que leu e concorda com o documento.', 'warning'); return; }

        const doc = myDocs.find(d => d.id === selectedId);
        const { error } = await sb.rpc('sign_document', { p_document_id: selectedId, p_signer_name: name });
        if (error) { showToast('Erro ao assinar', 'Não foi possível registrar a assinatura.', 'error'); return; }

        if (doc) logAudit('assinado', doc);
        closeSignModal();
        await refreshDocs();
        renderList();
        showToast('Documento assinado!', 'Sua assinatura eletrônica foi registrada.');
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

        // Reenvio do mesmo tipo substitui a versão anterior, sem apagar o histórico.
        const existingCurrent = myDocs.find(d => d.source === 'colaborador' && d.tipo === tipo);

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
            created_by:   user.id,
            // Autoupload pelo próprio colaborador conta como consentimento LGPD.
            lgpd_consentimento: true, lgpd_consentimento_em: new Date().toISOString(),
            retido_ate: computeRetentionDate(tipo),
            version: (existingCurrent?.version || 0) + 1,
            replaces_document_id: existingCurrent?.id || null,
        }).select().single();

        if (insertError) {
            if (uploadedPath) await sb.storage.from('documents').remove([uploadedPath]);
            showToast('Erro ao enviar documento.', 'Tente novamente.', 'error');
            return;
        }

        if (existingCurrent) {
            await sb.from('documents').update({ is_current: false }).eq('id', existingCurrent.id);
        }
        logAudit(existingCurrent ? 'substituido' : 'criado', inserted);

        selectedId = inserted.id;
        closeUploadModal();
        await refreshDocs();
        renderList();
        showToast('Documento enviado!', `${inserted.name} foi enviado para análise do RH.`);
    };

    signModal?.addEventListener('click', (e) => { if (e.target === signModal) closeSignModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeUploadModal(); closeSignModal(); } });

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

    // ── Init ──
    await Promise.all([refreshDocs(), loadRequirements()]);
    renderList();
});
