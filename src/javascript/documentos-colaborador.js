document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('colaborador', 'name,contract_type');
    if (!auth) return;
    const myEmployeeId = auth.profile.employee_id;
    const emp = auth.employee;
    const user = auth.user;

    const RETENTION_YEARS = {
        'Contrato de Trabalho': 30,
        'Termo de Rescisão': 30,
        Homologação: 30,
        'Guia FGTS': 30,
        'Carteira de Trabalho': 30,
        'Exame Admissional': 20,
        'Exame Demissional': 20,
        'Termo de Compromisso de Estágio': 30,
        'Plano de Atividades de Estágio': 30,
        'Aviso Prévio': 5,
        RG: 5,
        CPF: 5,
        'Comprovante de Residência': 5,
    };
    const DEFAULT_RETENTION_YEARS = 5;
    function computeRetentionDate(tipo) {
        const years = RETENTION_YEARS[tipo] ?? DEFAULT_RETENTION_YEARS;
        const d = new Date();
        d.setFullYear(d.getFullYear() + years);
        return d.toISOString().slice(0, 10);
    }

    const docList = document.getElementById('doc-list');
    const docCountBadge = document.getElementById('doc-count-badge');
    const docEmpty = document.getElementById('doc-empty');
    const docWrap = document.getElementById('doc-wrap');
    const uploadModal = document.getElementById('upload-modal');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileSelected = document.getElementById('file-selected');
    const fileSelectedName = document.getElementById('file-selected-name');
    const mobileSelectTrigger = document.getElementById('doc-select-mobile-trigger');
    const mobileSelectText = document.getElementById('doc-select-mobile-text');
    const mobileSelectPopover = document.getElementById('doc-select-mobile-popover');

    let myDocs = [];
    let allMyDocs = [];
    let requiredTipos = [];
    let selectedFile = null;
    let selectedId = null;

    // Documentos que o RH preenche/assina e devolve ao colaborador (mesmos nomes da lista RETURN_TIPOS em arquivos.js).
    const RETURN_TIPOS = [
        'Termo de Compromisso de Estágio',
        'Plano de Atividades de Estágio',
        'Relatório de Atividades de Estágio',
        'Termo de Vale-Transporte',
        'Ficha de Salário-Família',
        'Termo de Dependentes para o Imposto de Renda',
    ];
    const SELF_UPLOAD_TIPOS = [
        'RG',
        'CPF',
        'Comprovante de Residência',
        'Carteira de Trabalho',
        'Diploma',
        'Certificado',
        'Exame Médico',
        'Outros',
        'Comprovante de Matrícula e Frequência',
        ...RETURN_TIPOS,
    ];

    async function refreshDocs() {
        const { data } = await sb.from('documents').select('*').eq('employee_id', myEmployeeId).order('created_at', { ascending: false });
        allMyDocs = data || [];
        myDocs = allMyDocs.filter((d) => d.is_current !== false);
        try {
            localStorage.setItem(`nexus:docs-seen:${myEmployeeId}`, new Date().toISOString());
        } catch {}
    }

    async function loadRequirements() {
        const { data } = await sb.from('document_requirements').select('tipo,category,contract_type').eq('category', 'admissional').eq('obrigatorio', true);
        requiredTipos = RequisitosDocumentos.requiredTipos(data, 'admissional', emp?.contract_type);
    }

    function renderPendingDocsBanner() {
        const banner = document.getElementById('pending-docs-banner');
        if (!banner) return;
        const haveTipos = myDocs.filter((d) => d.source === 'Administrador' || d.status === 'aprovado').map((d) => d.tipo);
        const missing = requiredTipos.filter((t) => !haveTipos.includes(t));
        if (!missing.length) {
            banner.classList.add('hidden');
            return;
        }

        banner.classList.remove('hidden');
        document.getElementById('pending-docs-text').textContent =
            `${missing.length} documento${missing.length > 1 ? 's' : ''} obrigatório${missing.length > 1 ? 's' : ''} pendente${missing.length > 1 ? 's' : ''}`;
        document.getElementById('pending-docs-chips').innerHTML = missing
            .map((t) => {
                if (SELF_UPLOAD_TIPOS.includes(t)) {
                    return `<button type="button" class="pending-doc-chip" data-click="quickUploadTipo" data-click-args="${dargs(t)}"><i class="fas fa-plus"></i> ${t}</button>`;
                }
                return `<span class="pending-doc-chip pending-doc-chip--waiting"><i class="fas fa-clock"></i> ${t} — aguardando o RH</span>`;
            })
            .join('');
    }

    window.quickUploadTipo = (tipo) => {
        openUploadModal();
        window.setUploadTipo?.(tipo);
    };

    async function logAudit(action, doc) {
        await sb.from('document_audit_log').insert({
            document_id: doc.id || null,
            document_name: doc.name,
            employee_id: myEmployeeId,
            action,
            actor_id: user.id,
            actor_name: emp?.name || 'Colaborador',
            actor_profile: 'colaborador',
            details: { email: user.email },
        });
    }

    function getIconInfo(name) {
        const ext = (name || '').split('.').pop().toLowerCase();
        if (ext === 'pdf') return { cls: 'pdf', fa: 'fa-file-pdf' };
        if (['doc', 'docx'].includes(ext)) return { cls: 'doc', fa: 'fa-file-word' };
        if (['jpg', 'jpeg', 'png'].includes(ext)) return { cls: 'img', fa: 'fa-file-image' };
        return { cls: 'other', fa: 'fa-file' };
    }

    const statusMap = {
        pendente: { cls: 'pendente', label: 'Pendente', icon: 'fa-clock' },
        aprovado: { cls: 'aprovado', label: 'Aprovado', icon: 'fa-check-circle' },
        recusado: { cls: 'recusado', label: 'Recusado', icon: 'fa-times-circle' },
    };

    // Documento do colaborador que o RH já preencheu, assinou e devolveu: existe uma versão do RH, do mesmo tipo, criada depois.
    function statusOf(doc) {
        const returned =
            doc.source === 'colaborador' &&
            RETURN_TIPOS.includes(doc.tipo) &&
            myDocs.some((r) => r.source === 'Administrador' && r.tipo === doc.tipo && r.created_at > doc.created_at);
        if (returned) return { cls: 'aprovado', label: 'Devolvido pelo RH', icon: 'fa-reply' };
        return statusMap[doc.status] || statusMap.pendente;
    }

    function renderList() {
        renderPendingDocsBanner();
        if (docCountBadge) docCountBadge.textContent = myDocs.length;

        if (mobileSelectPopover) {
            mobileSelectPopover.innerHTML = myDocs
                .map(
                    (d) =>
                        `<button type="button" class="select-option${d.id === selectedId ? ' selected' : ''}" data-value="${d.id}">${escapeHtml(d.name)}</button>`
                )
                .join('');
            const current = myDocs.find((d) => d.id === selectedId);
            if (mobileSelectText) {
                mobileSelectText.textContent = current ? current.name : 'Selecione um documento...';
                mobileSelectText.classList.toggle('date-trigger-placeholder', !current);
            }
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

        docList.innerHTML = myDocs
            .map((d, i) => {
                const { cls, fa } = getIconInfo(d.name);
                const st = statusOf(d);
                const date = new Date(d.created_at).toLocaleDateString('pt-BR');
                return `
                <div class="doc-card-item${d.id === selectedId ? ' active' : ''}" style="animation-delay:${Math.min(i * 0.04, 0.4)}s" data-click="selectDocById" data-click-args="${dargs(d.id)}">
                    <div class="doc-card-icon doc-card-icon--${cls}">
                        <i class="fas ${fa}"></i>
                    </div>
                    <div class="doc-card-body">
                        <span class="doc-card-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
                        <span class="doc-card-tipo">${escapeHtml(d.tipo)} · ${date}${d.source === 'Administrador' ? ' · Enviado pelo RH' : ''}${d.requer_assinatura && !d.assinado_em ? ' · Aguardando sua assinatura' : ''}</span>
                    </div>
                    <span class="doc-card-status doc-card-status--${st.cls}">
                        <i class="fas ${st.icon}"></i> ${escapeHtml(st.label)}
                    </span>
                </div>`;
            })
            .join('');

        const current = selectedId ? myDocs.find((d) => d.id === selectedId) : null;
        if (current) showDocDetail(current);
        else showEmptyPanel();
    }

    function showEmptyPanel() {
        selectedId = null;
        docEmpty?.classList.remove('hidden');
        docWrap?.classList.add('hidden');
    }

    function showDocDetail(doc) {
        docEmpty?.classList.add('hidden');
        docWrap?.classList.remove('hidden');

        const st = statusOf(doc);
        const { cls: iconCls, fa: iconFa } = getIconInfo(doc.name);
        const date = new Date(doc.created_at).toLocaleDateString('pt-BR');

        const nameEl = document.getElementById('action-doc-name');
        const badgeEl = document.getElementById('action-status-badge');
        if (nameEl) nameEl.textContent = doc.name;
        if (badgeEl) {
            badgeEl.className = `doc-status-badge ${st.cls}`;
            badgeEl.innerHTML = `<i class="fas ${st.icon}"></i> ${escapeHtml(st.label)}`;
        }

        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val || '—';
        };
        set('detail-employee', emp?.name || '—');
        set('detail-tipo2', doc.tipo);
        set('detail-date', date);
        set('detail-size', doc.size_label);
        set('detail-filename', doc.name);
        set('detail-footer-date', date);

        const statusEl = document.getElementById('detail-status');
        if (statusEl) {
            statusEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:.8rem;font-weight:700;background:${st.cls === 'aprovado' ? '#dcfce7' : st.cls === 'recusado' ? '#fee2e2' : '#fef3c7'};color:${st.cls === 'aprovado' ? '#065f46' : st.cls === 'recusado' ? '#991b1b' : '#92400e'}"><i class="fas ${st.icon}"></i> ${escapeHtml(st.label)}</span>`;
        }

        const signArea = document.getElementById('assinatura-area');
        const signBtn = document.getElementById('btn-sign-doc');
        if (signArea) {
            if (doc.assinado_em) {
                signArea.innerHTML = `<p class="assinatura-done"><i class="fas fa-signature"></i> Assinado por ${escapeHtml(doc.assinado_por) || escapeHtml(emp?.name) || ''} em ${new Date(doc.assinado_em).toLocaleString('pt-BR')}</p>`;
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
    }

    window.viewSelectedDoc = async () => {
        const doc = myDocs.find((d) => d.id === selectedId);
        if (!doc?.storage_path) {
            showToast('Arquivo indisponível', 'Este documento não tem um arquivo para visualizar.', 'warning');
            return;
        }
        const { error } = await NexusFiles.open('documents', doc.storage_path, { name: doc.name });
        if (error) showToast('Erro ao abrir', error.message, 'error');
    };

    document.getElementById('doc-card')?.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.doc-preview-area--clickable')) {
            e.preventDefault();
            viewSelectedDoc();
        }
    });

    window.selectDocById = (id) => {
        if (!id) {
            showEmptyPanel();
            return;
        }
        const doc = myDocs.find((d) => d.id === id);
        if (!doc) {
            showEmptyPanel();
            return;
        }
        selectedId = id;
        renderList();
        showDocDetail(doc);
    };

    window.deleteSelectedDoc = async () => {
        if (!selectedId) return;
        const doc = myDocs.find((d) => d.id === selectedId);
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

    window.openUploadModal = () => {
        uploadModal?.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    window.closeUploadModal = () => {
        uploadModal?.classList.remove('open');
        document.body.style.overflow = '';
        window.setUploadTipo?.('');
        clearFileInput();
    };

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
        if (!name) {
            showToast('Campo obrigatório', 'Digite seu nome completo para assinar.', 'warning');
            return;
        }
        if (!signAgreeCheck?.checked) {
            showToast('Confirmação necessária', 'Confirme que leu e concorda com o documento.', 'warning');
            return;
        }

        const doc = myDocs.find((d) => d.id === selectedId);
        const { error } = await sb.rpc('sign_document', { p_document_id: selectedId, p_signer_name: name });
        if (error) {
            showToast('Erro ao assinar', 'Não foi possível registrar a assinatura.', 'error');
            return;
        }

        if (doc) logAudit('assinado', doc);
        closeSignModal();
        await refreshDocs();
        renderList();
        showToast('Documento assinado!', 'Sua assinatura eletrônica foi registrada.');
    };

    function setupUploadTipoSelect() {
        const trigger = document.getElementById('upload-tipo-trigger');
        const textEl = document.getElementById('upload-tipo-text');
        const hidden = document.getElementById('upload-tipo');
        const popover = document.getElementById('upload-tipo-popover');
        if (!trigger || !popover || !hidden) return;

        function open() {
            popover.classList.add('open');
            trigger.classList.add('active');
            trigger.setAttribute('aria-expanded', 'true');
            document.addEventListener('click', onOutsideClick);
            document.addEventListener('keydown', onEscape);
        }
        function close() {
            popover.classList.remove('open');
            trigger.classList.remove('active');
            trigger.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', onOutsideClick);
            document.removeEventListener('keydown', onEscape);
        }
        function onOutsideClick(e) {
            if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
        }
        function onEscape(e) {
            if (e.key === 'Escape') close();
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.classList.contains('open') ? close() : open();
        });

        popover.addEventListener('click', (e) => {
            const btn = e.target.closest('.select-option');
            if (!btn) return;
            window.setUploadTipo(btn.dataset.value);
            close();
        });

        window.setUploadTipo = function (value) {
            hidden.value = value || '';
            if (textEl) {
                textEl.textContent = value || 'Selecione';
                textEl.classList.toggle('date-trigger-placeholder', !value);
            }
            popover.querySelectorAll('.select-option').forEach((o) => o.classList.toggle('selected', o.dataset.value === value));
        };
    }
    setupUploadTipoSelect();

    function setupMobileDocSelect() {
        const trigger = mobileSelectTrigger;
        const popover = mobileSelectPopover;
        if (!trigger || !popover) return;

        function open() {
            popover.classList.add('open');
            trigger.classList.add('active');
            trigger.setAttribute('aria-expanded', 'true');
            document.addEventListener('click', onOutsideClick);
            document.addEventListener('keydown', onEscape);
        }
        function close() {
            popover.classList.remove('open');
            trigger.classList.remove('active');
            trigger.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', onOutsideClick);
            document.removeEventListener('keydown', onEscape);
        }
        function onOutsideClick(e) {
            if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
        }
        function onEscape(e) {
            if (e.key === 'Escape') close();
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.classList.contains('open') ? close() : open();
        });

        popover.addEventListener('click', (e) => {
            const btn = e.target.closest('.select-option');
            if (!btn) return;
            selectDocById(btn.dataset.value);
            close();
        });
    }
    setupMobileDocSelect();

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
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
        if (file.size > 25 * 1024 * 1024) {
            showToast('Arquivo muito grande!', 'O arquivo ultrapassa o limite de 25 MB.', 'warning');
            return;
        }
        selectedFile = file;
        dropZone?.classList.add('hidden');
        fileSelected?.classList.remove('hidden');
        if (fileSelectedName) fileSelectedName.textContent = file.name;
        updateUploadBtnState();
    }

    function updateUploadBtnState() {
        const btn = document.getElementById('btn-submit-upload');
        if (btn) btn.disabled = !selectedFile;
    }

    window.clearFileInput = () => {
        selectedFile = null;
        if (fileInput) fileInput.value = '';
        fileSelected?.classList.add('hidden');
        dropZone?.classList.remove('hidden');
        updateUploadBtnState();
    };

    window.submitUpload = async () => {
        const tipo = document.getElementById('upload-tipo')?.value;
        if (!tipo) {
            showToast('Campo obrigatório', 'Selecione o tipo de documento.', 'warning');
            return;
        }
        if (!selectedFile) {
            showToast('Campo obrigatório', 'Selecione um arquivo para enviar.', 'warning');
            return;
        }

        const sizeKB = Math.round(selectedFile.size / 1024);
        const sizeLabel = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;

        const storagePath = `${myEmployeeId}/${Date.now()}_${NexusFiles.safeName(selectedFile.name)}`;
        let uploadedPath = null;

        const existingCurrent = myDocs.find((d) => d.source === 'colaborador' && d.tipo === tipo);

        const { error: uploadError } = await NexusFiles.upload('documents', storagePath, selectedFile, { contentType: selectedFile.type });
        if (uploadError) {
            showToast('Erro ao enviar o arquivo.', uploadError.message, 'error');
            return;
        }
        uploadedPath = storagePath;

        const { data: inserted, error: insertError } = await sb
            .from('documents')
            .insert({
                name: selectedFile.name,
                employee_id: myEmployeeId,
                tipo,
                size_label: sizeLabel,
                storage_path: uploadedPath,
                source: 'colaborador',
                status: 'pendente',
                created_by: user.id,
                lgpd_consentimento: true,
                lgpd_consentimento_em: new Date().toISOString(),
                retido_ate: computeRetentionDate(tipo),
                version: (existingCurrent?.version || 0) + 1,
                replaces_document_id: existingCurrent?.id || null,
            })
            .select()
            .single();

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

    signModal?.addEventListener('click', (e) => {
        if (e.target === signModal) closeSignModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeUploadModal();
            closeSignModal();
        }
    });

    sb.channel('docs-colab')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'documents',
                filter: `employee_id=eq.${myEmployeeId}`,
            },
            async () => {
                await refreshDocs();
                renderList();
            }
        )
        .subscribe();

    function showToast(title, msg, type = 'success') {
        const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
            <div class="toast-content">
                <p class="toast-title">${escapeHtml(title)}</p>
                ${msg ? `<p class="toast-msg">${escapeHtml(msg)}</p>` : ''}
            </div>
            <button class="toast-close" data-click="dismissToast">
                <i class="fas fa-times"></i>
            </button>`;
        container.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    await Promise.all([refreshDocs(), loadRequirements()]);
    renderList();
});
