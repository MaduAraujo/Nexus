/* arquivos.js — Supabase */

document.addEventListener('DOMContentLoaded', async () => {
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
    let activeTab    = 'admissional';
    let selectedFile = null;
    let employees    = [];
    let rhDocs       = [];
    let colabDocs    = [];

    // ─── Sidebar ─────────────────────────────────────────────
    const isMobile  = () => window.innerWidth <= 768;
    const openSide  = () => { sidebar?.classList.add('open');    sidebarOverlay?.classList.add('active');    document.body.style.overflow = 'hidden'; };
    const closeSide = () => { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; };
    sidebarToggle?.addEventListener('click', e => { e.stopPropagation(); isMobile() ? (sidebar?.classList.contains('open') ? closeSide() : openSide()) : (() => { const c = sidebar?.classList.toggle('collapsed'); mainWrapper?.classList.toggle('sidebar-collapsed', c); })(); });
    topbarMenuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeSide() : openSide(); });
    sidebarOverlay?.addEventListener('click', closeSide);
    window.addEventListener('resize', () => { if (!isMobile()) closeSide(); });

    // ─── Data ────────────────────────────────────────────────
    async function loadData() {
        const [{ data: empData }, { data: docData }] = await Promise.all([
            sb.from('employees').select('id,name,dept').neq('status','Inativo').order('name'),
            sb.from('documents').select('*').order('created_at', { ascending: false }),
        ]);
        employees = empData || [];
        const all = docData || [];
        rhDocs    = all.filter(d => d.source === 'rh');
        colabDocs = all.filter(d => d.source === 'colaborador');
    }

    function empName(empId) {
        const e = employees.find(e => e.id === empId);
        return e ? e.name : '—';
    }

    function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'; }

    function getFileIcon(name) {
        const ext = (name || '').split('.').pop().toLowerCase();
        if (ext === 'pdf')  return { cls:'file-icon--pdf',   icon:'fa-file-pdf' };
        if (['doc','docx'].includes(ext)) return { cls:'file-icon--doc', icon:'fa-file-word' };
        if (['jpg','jpeg','png'].includes(ext)) return { cls:'file-icon--img', icon:'fa-file-image' };
        return { cls:'file-icon--other', icon:'fa-file' };
    }

    const statusMap = {
        pendente: { cls:'badge-status--pendente', label:'Pendente',  icon:'fa-clock' },
        aprovado: { cls:'badge-status--aprovado', label:'Aprovado',  icon:'fa-check-circle' },
        recusado: { cls:'badge-status--recusado', label:'Recusado',  icon:'fa-times-circle' },
    };

    // ─── Render ───────────────────────────────────────────────
    function renderTable() {
        const q = searchInput?.value.toLowerCase().trim() || '';
        updateStats();

        if (activeTab === 'colaborador') {
            const filtered = q ? colabDocs.filter(d => (d.name||'').toLowerCase().includes(q) || empName(d.employee_id).toLowerCase().includes(q) || (d.tipo||'').toLowerCase().includes(q)) : colabDocs;
            if (!filtered.length) { filesTbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-users"></i><p>Nenhum documento de colaborador</p><span>${q ? `Nenhum resultado para "${q}"` : 'Colaboradores ainda não enviaram documentos'}</span></div></td></tr>`; return; }
            filesTbody.innerHTML = filtered.map(d => {
                const { cls, icon } = getFileIcon(d.name);
                const st = statusMap[d.status] || statusMap.pendente;
                return `<tr>
                    <td><div class="file-name-cell"><div class="file-icon ${cls}"><i class="fas ${icon}"></i></div><div><div class="file-name" title="${d.name}">${d.name}</div><div class="file-employee">${d.tipo||''}</div></div></div></td>
                    <td>${empName(d.employee_id)}</td>
                    <td><span class="badge-status ${st.cls}"><i class="fas ${st.icon}"></i> ${st.label}</span></td>
                    <td class="file-date">${fmtDate(d.created_at)}</td>
                    <td class="file-size">${d.size_label||'—'}</td>
                    <td><div class="actions-cell">
                        <button class="btn-icon btn-icon--approve" title="Aprovar"  onclick="approveColabDoc('${d.id}')"><i class="fas fa-check"></i></button>
                        <button class="btn-icon btn-icon--reject"  title="Recusar"  onclick="rejectColabDoc('${d.id}')"><i class="fas fa-times"></i></button>
                        <button class="btn-icon btn-icon--delete"  title="Excluir"  onclick="deleteColabDoc('${d.id}','${d.storage_path||''}')"><i class="fas fa-trash"></i></button>
                    </div></td>
                </tr>`;
            }).join('');
            return;
        }

        const filtered = rhDocs.filter(f => {
            if (f.category !== activeTab) return false;
            if (!q) return true;
            return (f.name||'').toLowerCase().includes(q) || empName(f.employee_id).toLowerCase().includes(q) || (f.tipo||'').toLowerCase().includes(q);
        });

        if (!filtered.length) { filesTbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-folder-open"></i><p>Nenhum arquivo encontrado</p><span>${q ? `Nenhum resultado para "${q}"` : 'Clique em "Enviar Arquivo" para adicionar'}</span></div></td></tr>`; return; }

        filesTbody.innerHTML = filtered.map(f => {
            const { cls, icon } = getFileIcon(f.name);
            const badgeCls   = f.category === 'admissional' ? 'badge-tipo--admissional' : 'badge-tipo--demissional';
            const badgeLabel = f.category === 'admissional' ? 'Admissional' : 'Demissional';
            return `<tr>
                <td><div class="file-name-cell"><div class="file-icon ${cls}"><i class="fas ${icon}"></i></div><div><div class="file-name" title="${f.name}">${f.name}</div><div class="file-employee">${f.tipo||''}</div></div></div></td>
                <td>${empName(f.employee_id)}</td>
                <td><span class="badge-tipo ${badgeCls}">${badgeLabel}</span></td>
                <td class="file-date">${fmtDate(f.created_at)}</td>
                <td class="file-size">${f.size_label||'—'}</td>
                <td><div class="actions-cell">
                    <button class="btn-icon btn-icon--view"   title="Visualizar" onclick="viewFile('${f.id}','${f.storage_path||''}')"><i class="fas fa-eye"></i></button>
                    <button class="btn-icon btn-icon--delete" title="Excluir"    onclick="deleteFile('${f.id}','${f.storage_path||''}')"><i class="fas fa-trash"></i></button>
                </div></td>
            </tr>`;
        }).join('');
    }

    function updateStats() {
        document.getElementById('total-count').textContent       = rhDocs.length + colabDocs.length;
        document.getElementById('admissional-count').textContent = rhDocs.filter(f => f.category === 'admissional').length;
        document.getElementById('demissional-count').textContent = rhDocs.filter(f => f.category === 'demissional').length;
    }

    // ─── Tab switching ────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.getAttribute('data-tab');
            if (searchInput) searchInput.value = '';
            searchClear?.classList.add('hidden');
            renderTable();
        });
    });

    searchInput?.addEventListener('input', () => { searchClear?.classList.toggle('hidden', !searchInput.value.trim()); renderTable(); });
    searchClear?.addEventListener('click', () => { searchInput.value = ''; searchClear.classList.add('hidden'); renderTable(); });

    // ─── Ações colaborador ────────────────────────────────────
    window.approveColabDoc = async (id) => {
        await sb.from('documents').update({ status: 'aprovado' }).eq('id', id);
        const doc = colabDocs.find(d => d.id === id);
        if (doc) doc.status = 'aprovado';
        renderTable();
        showToast('Documento aprovado!', 'O status foi atualizado para Aprovado.', 'success');
    };

    window.rejectColabDoc = async (id) => {
        await sb.from('documents').update({ status: 'recusado' }).eq('id', id);
        const doc = colabDocs.find(d => d.id === id);
        if (doc) doc.status = 'recusado';
        renderTable();
        showToast('Documento recusado', 'O status foi atualizado para Recusado.', 'error');
    };

    window.deleteColabDoc = async (id, storagePath) => {
        if (!confirm('Deseja realmente excluir este documento?')) return;
        if (storagePath) await sb.storage.from('documents').remove([storagePath]);
        await sb.from('documents').delete().eq('id', id);
        colabDocs = colabDocs.filter(d => d.id !== id);
        renderTable();
        showToast('Documento excluído!', 'O arquivo foi removido com sucesso.', 'error');
    };

    window.viewFile = async (id, storagePath) => {
        if (!storagePath) { showToast('Arquivo indisponível', 'Caminho do arquivo não encontrado.', 'warning'); return; }
        const { data } = await sb.storage.from('documents').createSignedUrl(storagePath, 3600);
        if (data?.signedUrl) window.open(data.signedUrl, '_blank');
    };

    window.deleteFile = async (id, storagePath) => {
        if (!confirm('Deseja realmente excluir este arquivo?')) return;
        if (storagePath) await sb.storage.from('documents').remove([storagePath]);
        await sb.from('documents').delete().eq('id', id);
        rhDocs = rhDocs.filter(f => f.id !== id);
        renderTable();
        showToast('Arquivo Excluído!', 'O arquivo foi removido com sucesso.', 'error');
    };

    // ─── Upload modal ─────────────────────────────────────────
    function populateEmployeeSelect() {
        const sel = document.getElementById('upload-employee-select') || document.getElementById('upload-employee');
        if (!sel) return;
        const isSelect = sel.tagName === 'SELECT';
        if (isSelect) {
            sel.innerHTML = '<option value="">Selecione o colaborador...</option>';
            employees.forEach(e => {
                const opt = document.createElement('option');
                opt.value = e.id; opt.textContent = e.name;
                sel.appendChild(opt);
            });
        }
    }

    window.openUploadModal = () => { uploadModal?.classList.add('open'); document.body.style.overflow = 'hidden'; populateEmployeeSelect(); };
    window.closeUploadModal = () => {
        uploadModal?.classList.remove('open'); document.body.style.overflow = '';
        const empEl = document.getElementById('upload-employee-select') || document.getElementById('upload-employee');
        if (empEl) empEl.value = '';
        document.getElementById('upload-category').value = '';
        clearFileInput();
    };

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone?.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) setSelectedFile(f); });
    fileInput?.addEventListener('change', () => { if (fileInput.files[0]) setSelectedFile(fileInput.files[0]); });

    function setSelectedFile(file) {
        if (file.size > 50 * 1024 * 1024) { showToast('Arquivo muito grande!', 'O arquivo ultrapassa o limite de 50 MB.', 'warning'); return; }
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
        const empEl      = document.getElementById('upload-employee-select') || document.getElementById('upload-employee');
        const categoryRaw = document.getElementById('upload-category').value;
        if (!categoryRaw)  { showToast('Campo obrigatório', 'Selecione a categoria do arquivo.', 'warning'); return; }
        if (!selectedFile) { showToast('Campo obrigatório', 'Selecione um arquivo para enviar.', 'warning'); return; }

        const [category, tipo] = categoryRaw.split('|');
        const empId    = empEl?.tagName === 'SELECT' ? (empEl.value || null) : null;
        const empInput = empEl?.tagName === 'INPUT'  ? empEl.value.trim() : null;
        const lookupEmp = empInput ? employees.find(e => e.name.toLowerCase() === empInput.toLowerCase()) : null;
        const finalEmpId = empId || lookupEmp?.id || null;

        const sizeKB   = Math.round(selectedFile.size / 1024);
        const sizeLabel = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
        const storagePath = `rh/${Date.now()}_${selectedFile.name.replace(/\s/g,'_')}`;

        const { error: uploadError } = await sb.storage.from('documents').upload(storagePath, selectedFile);
        if (uploadError) { showToast('Erro no upload', 'Não foi possível enviar o arquivo.', 'error'); return; }

        const { data: inserted, error: dbError } = await sb.from('documents').insert({
            name: selectedFile.name, employee_id: finalEmpId, category, tipo,
            size_label: sizeLabel, storage_path: storagePath, source: 'rh', created_by: user.id
        }).select().single();

        if (dbError) { showToast('Erro ao salvar', 'Arquivo enviado mas não foi possível salvar os dados.', 'error'); return; }

        rhDocs.unshift(inserted);
        activeTab = category;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === category));
        closeUploadModal();
        renderTable();
        showToast('Arquivo carregado com sucesso', `${selectedFile.name} foi adicionado.`, 'success');
    };

    uploadModal?.addEventListener('click', e => { if (e.target === uploadModal) closeUploadModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeUploadModal(); if (isMobile()) closeSide(); } });

    // ─── Realtime ─────────────────────────────────────────────
    sb.channel('documents-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, async () => {
            await loadData();
            renderTable();
        })
        .subscribe();

    // ─── Toast ────────────────────────────────────────────────
    function showToast(title, msg, type = 'success') {
        const icons = { success:'fa-check', error:'fa-times', warning:'fa-exclamation-triangle' };
        let container = document.getElementById('toast-container');
        if (!container) { container = document.createElement('div'); container.id = 'toast-container'; container.className = 'toast-container'; document.body.appendChild(container); }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<div class="toast-icon"><i class="fas ${icons[type]||'fa-check'}"></i></div><div class="toast-content"><p class="toast-title">${title}</p><p class="toast-msg">${msg}</p></div><button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),400)"><i class="fas fa-times"></i></button>`;
        container.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 400); }, 4000);
    }

    // ─── Init ─────────────────────────────────────────────────
    await loadData();
    renderTable();
});
