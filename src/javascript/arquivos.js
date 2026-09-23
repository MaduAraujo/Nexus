document.addEventListener('DOMContentLoaded', async () => {
    const searchInput = document.getElementById('search-input');
    const searchClear = document.getElementById('search-clear');
    const filesTbody = document.getElementById('files-tbody');
    const uploadModal = document.getElementById('upload-modal');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const cameraInput = document.getElementById('camera-input');
    const btnCamera = document.getElementById('btn-camera');
    const filesSelectedList = document.getElementById('files-selected-list');
    const ocrHint = document.getElementById('ocr-hint');
    const ocrHintText = document.getElementById('ocr-hint-text');
    const uploadValidade = document.getElementById('upload-validade');
    const uploadLgpdConsent = document.getElementById('upload-lgpd-consent');
    const vencendoCard = document.getElementById('vencendo-card');
    const checklistBanner = document.getElementById('checklist-banner');
    const checklistBannerToggle = document.getElementById('checklist-banner-toggle');
    const checklistBannerText = document.getElementById('checklist-banner-text');
    const checklistBannerBody = document.getElementById('checklist-banner-body');
    const filterStatus = document.getElementById('filter-status');
    const filterDept = document.getElementById('filter-dept');
    const filterDateStart = document.getElementById('filter-date-start');
    const filterDateEnd = document.getElementById('filter-date-end');
    const filterClearBtn = document.getElementById('filter-clear-btn');
    const colabFilterTrigger = document.getElementById('colab-filter-trigger');
    const colabFilterMenu = document.getElementById('colab-filter-menu');
    const colabDeptFilterList = document.getElementById('colab-dept-filter-list');
    const colabFilterStatusSection = document.getElementById('colab-filter-status-section');
    const filterDateTrigger = document.getElementById('filter-date-trigger');
    const filterDateTriggerText = document.getElementById('filter-date-trigger-text');
    const filterCalendarPopover = document.getElementById('filter-calendar-popover');
    const filterCalendarTitle = document.getElementById('filter-calendar-title');
    const filterCalendarGrid = document.getElementById('filter-calendar-grid');
    const filterCalendarPrev = document.getElementById('filter-calendar-prev');
    const filterCalendarNext = document.getElementById('filter-calendar-next');
    const filterCalendarClear = document.getElementById('filter-calendar-clear');
    const filterCalendarApply = document.getElementById('filter-calendar-apply');
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const bulkBar = document.getElementById('bulk-bar');
    const bulkBarCount = document.getElementById('bulk-bar-count');
    const bulkBarActions = document.getElementById('bulk-bar-actions');
    const bulkBarClear = document.getElementById('bulk-bar-clear');
    const notifWrapper = document.getElementById('notif-wrapper');
    const btnNotif = document.getElementById('btn-notif');
    const notifPanel = document.getElementById('notif-panel');
    const notifBadge = document.getElementById('notif-badge');
    const notifPanelBody = document.getElementById('notif-panel-body');
    const auditFilterAction = document.getElementById('audit-filter-action');
    const auditLogList = document.getElementById('audit-log-list');

    const auth = await NexusAuth.requireProfile('Administrador');
    if (!auth) return;
    const user = auth.user;

    let activeTab = 'admissional';
    let selectedFiles = [];
    let employees = [];
    let filterEmployeeId = null;
    let terminatedEmployees = [];
    let rhDocs = [];
    let colabDocs = [];
    let requirements = [];
    let checklistOpen = false;
    const selectedIds = new Set();
    let auditLogEntries = [];
    let returnForDocId = null;

    const NOTIF_READ_STORAGE_KEY = `nexus:arquivos-notif-read:${user.id}`;
    let currentNotifKeys = new Set();
    let notifRead = loadNotifRead();

    function loadNotifRead() {
        try {
            const raw = JSON.parse(localStorage.getItem(NOTIF_READ_STORAGE_KEY) || '[]');
            return new Set(Array.isArray(raw) ? raw : []);
        } catch {
            return new Set();
        }
    }

    function saveNotifRead() {
        notifRead = new Set([...notifRead].filter((k) => currentNotifKeys.has(k)));
        try {
            localStorage.setItem(NOTIF_READ_STORAGE_KEY, JSON.stringify([...notifRead]));
        } catch {}
    }

    function hashKey(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36);
    }

    const RETENTION_YEARS = {
        'Contrato de Trabalho': 30,
        'Termo de Rescisão': 30,
        Homologação: 30,
        'Guia FGTS': 30,
        'Carteira de Trabalho': 30,
        'Exame Admissional': 20,
        'Exame Demissional': 20,
        'Ficha de Registro do Empregado': 30,
        'Termo de Entrega de EPI': 20,
        'Termo de Compromisso de Estágio': 30,
        'Plano de Atividades de Estágio': 30,
        'Termo de Realização do Estágio': 30,
        'Aviso Prévio': 5,
        RG: 5,
        CPF: 5,
        'Comprovante de Residência': 5,
    };
    const DEFAULT_RETENTION_YEARS = 5;

    const ONBOARDING_TERMOS = [
        'Termo de Vale-Transporte',
        'Ficha de Salário-Família',
        'Termo de Dependentes para o Imposto de Renda',
        'Regimento ou Política Interna',
        'Termo de Responsabilidade de Equipamentos',
        'Termo de Uso de Tecnologia',
        'Termo de Entrega de EPI',
    ];
    const SIGNATURE_TIPOS = ['Contrato de Trabalho', 'Termo de Rescisão', 'Aviso Prévio', 'Homologação', ...ONBOARDING_TERMOS];
    const RETURN_TIPOS = [
        'Termo de Compromisso de Estágio',
        'Plano de Atividades de Estágio',
        'Relatório de Atividades de Estágio',
        'Termo de Vale-Transporte',
        'Ficha de Salário-Família',
        'Termo de Dependentes para o Imposto de Renda',
    ];

    function computeRetentionDate(tipo) {
        const years = RETENTION_YEARS[tipo] ?? DEFAULT_RETENTION_YEARS;
        const d = new Date();
        d.setFullYear(d.getFullYear() + years);
        return d.toISOString().slice(0, 10);
    }

    function getExpiryInfo(dataValidade) {
        if (!dataValidade) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const exp = new Date(dataValidade + 'T00:00:00');
        const diffDays = Math.round((exp - today) / 86400000);
        if (diffDays < 0) return { cls: 'badge--vencido', label: 'Vencido', alert: true };
        if (diffDays <= 30) return { cls: 'badge--avencer', label: `Vence em ${diffDays}d`, alert: true };
        return { cls: 'badge--valido', label: fmtDate(dataValidade), alert: false };
    }

    async function logAudit(action, doc) {
        await sb.from('document_audit_log').insert({
            document_id: doc.id || null,
            document_name: doc.name,
            employee_id: doc.employee_id || null,
            action,
            actor_id: user.id,
            actor_name: 'Administrador',
            actor_profile: 'rh',
            details: { email: user.email },
        });
    }

    async function runLgpdPurge() {
        const { data: expired } = await sb.from('documents').select('id,name,employee_id,storage_path').lt('retido_ate', new Date().toISOString().slice(0, 10));
        if (!expired?.length) return 0;

        for (const doc of expired) {
            if (doc.storage_path) await sb.storage.from('documents').remove([doc.storage_path]);
            const { error } = await sb.from('documents').delete().eq('id', doc.id);
            if (error) continue;
            await sb.from('document_audit_log').insert({
                document_id: doc.id,
                document_name: doc.name,
                employee_id: doc.employee_id || null,
                action: 'excluido',
                actor_name: 'Sistema (expurgo automático LGPD)',
                actor_profile: 'sistema',
                details: { email: 'sistema@nexus' },
            });
        }
        return expired.length;
    }

    async function loadData() {
        const [{ data: empData }, { data: termData }, { data: docData }, { data: reqData }] = await Promise.all([
            sb.from('employees').select('id,name,dept,contract_type').neq('status', 'Inativo').order('name'),
            sb.from('employees').select('id,name,dept,contract_type').eq('status', 'Inativo').order('name'),
            sb.from('documents').select('*').order('created_at', { ascending: false }),
            sb.from('document_requirements').select('*').eq('obrigatorio', true),
        ]);
        employees = empData || [];
        terminatedEmployees = termData || [];
        requirements = reqData || [];
        splitDocs(docData || []);
        populateDeptFilter();
    }

    function isFiledColabDoc(d) {
        return d.source === 'colaborador' && d.status === 'aprovado' && (d.category === 'admissional' || d.category === 'demissional');
    }

    const backfilling = new Set();

    function backfillCategory(doc) {
        doc.category = approvalUpdate(doc).category;
        if (backfilling.has(doc.id)) return;
        backfilling.add(doc.id);
        sb.from('documents')
            .update({ category: doc.category })
            .eq('id', doc.id)
            .then(() => {});
    }

    function splitDocs(all) {
        all.forEach((d) => {
            if (d.source === 'colaborador' && d.status === 'aprovado' && !d.category) backfillCategory(d);
        });
        const sorted = all.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        rhDocs = sorted.filter((d) => d.source === 'Administrador' || isFiledColabDoc(d));
        colabDocs = sorted.filter((d) => d.source === 'colaborador' && !isFiledColabDoc(d));
    }

    const DEMISSIONAL_TIPOS = ['Termo de Rescisão', 'Aviso Prévio', 'Homologação', 'Exame Demissional'];

    function approvalUpdate(doc) {
        const update = { status: 'aprovado' };
        if (!doc.category) {
            const demissional =
                !RETURN_TIPOS.includes(doc.tipo) && (DEMISSIONAL_TIPOS.includes(doc.tipo) || terminatedEmployees.some((e) => e.id === doc.employee_id));
            update.category = demissional ? 'demissional' : 'admissional';
        }
        return update;
    }

    async function approveDocs(ids) {
        const docs = ids.map((id) => colabDocs.find((d) => d.id === id)).filter(Boolean);
        const results = await Promise.all(docs.map((doc) => sb.from('documents').update(approvalUpdate(doc)).eq('id', doc.id)));
        const approved = docs.filter((_, i) => !results[i].error);
        approved.forEach((doc) => {
            Object.assign(doc, approvalUpdate(doc));
            logAudit('aprovado', doc);
        });
        splitDocs(rhDocs.concat(colabDocs));
        return { approved, failed: docs.length - approved.length };
    }

    function empName(empId) {
        const e = employees.find((e) => e.id === empId) || terminatedEmployees.find((e) => e.id === empId);
        return e ? e.name : '—';
    }

    function empDept(empId) {
        const e = employees.find((e) => e.id === empId) || terminatedEmployees.find((e) => e.id === empId);
        return e?.dept || null;
    }

    function populateDeptFilter() {
        if (!filterDept) return;
        const current = filterDept.value;
        const depts = [
            ...new Set(
                employees
                    .concat(terminatedEmployees)
                    .map((e) => e.dept)
                    .filter(Boolean)
            ),
        ].sort();
        filterDept.innerHTML = '<option value="">Selecione</option>' + depts.map((d) => `<option value="${d}">${d}</option>`).join('');
        if (depts.includes(current)) filterDept.value = current;

        if (colabDeptFilterList) {
            const btnHtml = (value, label) =>
                `<button type="button" class="btn-filter${filterDept.value === value ? ' active' : ''}" data-dept="${esc(value)}">${esc(label)}</button>`;
            colabDeptFilterList.innerHTML = btnHtml('', 'Todos') + depts.map((d) => btnHtml(d, d)).join('');
            colabDeptFilterList.querySelectorAll('.btn-filter').forEach((btn) => {
                btn.addEventListener('click', () => {
                    filterDept.value = btn.getAttribute('data-dept') || '';
                    colabDeptFilterList.querySelectorAll('.btn-filter').forEach((b) => b.classList.remove('active'));
                    btn.classList.add('active');
                    updateFilterClearVisibility();
                    renderTable();
                    closeColabFilterMenu();
                });
            });
        }
    }

    function positionColabFilterMenu() {
        if (!colabFilterTrigger || !colabFilterMenu) return;
        const rect = colabFilterTrigger.getBoundingClientRect();
        const width = colabFilterMenu.offsetWidth || 220;
        let left = rect.left;
        if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
        if (left < 12) left = 12;
        colabFilterMenu.style.top = `${rect.bottom + 8}px`;
        colabFilterMenu.style.left = `${left}px`;
    }

    function openColabFilterMenu() {
        closeFilterCalendar();
        positionColabFilterMenu();
        colabFilterMenu?.classList.add('open');
        colabFilterTrigger?.classList.add('open');
        colabFilterTrigger?.setAttribute('aria-expanded', 'true');
        window.addEventListener('resize', positionColabFilterMenu);
    }

    function closeColabFilterMenu() {
        colabFilterMenu?.classList.remove('open');
        colabFilterTrigger?.classList.remove('open');
        colabFilterTrigger?.setAttribute('aria-expanded', 'false');
        window.removeEventListener('resize', positionColabFilterMenu);
    }

    function fmtDate(iso) {
        return iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
    }

    function esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getFileIcon(name) {
        const ext = (name || '').split('.').pop().toLowerCase();
        if (ext === 'pdf') return { cls: 'file-icon--pdf', icon: 'fa-file-pdf' };
        if (['doc', 'docx'].includes(ext)) return { cls: 'file-icon--doc', icon: 'fa-file-word' };
        if (['jpg', 'jpeg', 'png'].includes(ext)) return { cls: 'file-icon--img', icon: 'fa-file-image' };
        return { cls: 'file-icon--other', icon: 'fa-file' };
    }

    const statusMap = {
        pendente: { cls: 'badge--pendente', label: 'Pendente', icon: 'fa-clock' },
        aprovado: { cls: 'badge--aprovado', label: 'Aprovado', icon: 'fa-check-circle' },
        recusado: { cls: 'badge--recusado', label: 'Recusado', icon: 'fa-times-circle' },
    };

    function validadeCell(dataValidade) {
        const info = getExpiryInfo(dataValidade);
        if (!info) return `<span class="badge--sem-validade">—</span>`;
        return `<span class="badge ${info.cls}">${escapeHtml(info.label)}</span>`;
    }

    function versionBadge(doc) {
        return doc.version > 1 ? `<span class="badge badge--version" title="Substituiu uma versão anterior">v${doc.version}</span>` : '';
    }

    function returnedDoc(doc) {
        if (doc.source !== 'colaborador' || !RETURN_TIPOS.includes(doc.tipo)) return null;
        return (
            rhDocs.find(
                (r) =>
                    r.source === 'Administrador' &&
                    r.employee_id === doc.employee_id &&
                    r.tipo === doc.tipo &&
                    r.is_current !== false &&
                    r.created_at > doc.created_at
            ) || null
        );
    }

    function returnBtn(doc) {
        if (!RETURN_TIPOS.includes(doc.tipo) || doc.status === 'recusado' || returnedDoc(doc)) return '';
        return `<button class="btn-icon btn-icon--return" title="Devolver preenchido e assinado" data-click="openReturnModal" data-click-args="${dargs(doc.id)}"><i class="fas fa-reply"></i></button>`;
    }

    function originBadge(doc) {
        if (doc.source === 'colaborador') {
            return returnedDoc(doc)
                ? `<span class="badge badge--assinado"><i class="fas fa-reply"></i> Devolvido ao colaborador</span>`
                : `<span class="badge badge--valido"><i class="fas fa-user"></i> Do colaborador</span>`;
        }
        return '';
    }

    function historyBtn(doc) {
        if (!(doc.version > 1)) return '';
        return `<button class="btn-icon btn-icon--history" title="Ver histórico de versões" data-click="showVersionHistory" data-click-args="${dargs(doc.id)}"><i class="fas fa-clock-rotate-left"></i></button>`;
    }

    function signBadge(doc) {
        if (!doc.requer_assinatura) return '';
        if (doc.assinado_em)
            return `<span class="badge badge--assinado" title="Assinado por ${escapeHtml(doc.assinado_por) || '—'} em ${fmtDate(doc.assinado_em)}"><i class="fas fa-signature"></i> Assinado</span>`;
        return `<span class="badge badge--aguardando" title="Aguardando assinatura eletrônica do colaborador"><i class="fas fa-pen-nib"></i> Aguardando assinatura</span>`;
    }

    function passesCommonFilters(doc) {
        if (filterEmployeeId && doc.employee_id !== filterEmployeeId) return false;
        const dept = empDept(doc.employee_id);
        if (filterDept?.value && dept !== filterDept.value) return false;
        if (filterDateStart?.value && doc.created_at && doc.created_at.slice(0, 10) < filterDateStart.value) return false;
        if (filterDateEnd?.value && doc.created_at && doc.created_at.slice(0, 10) > filterDateEnd.value) return false;
        return true;
    }

    function rowCheckbox(id) {
        return `<input type="checkbox" class="row-check" data-id="${id}" ${selectedIds.has(id) ? 'checked' : ''}>`;
    }

    function renderTable() {
        const q = searchInput?.value.toLowerCase().trim() || '';
        updateStats();
        renderChecklistBanner();
        renderNotifPanel();

        if (activeTab === 'colaborador') {
            colabFilterStatusSection?.classList.remove('hidden');
            const current = colabDocs.filter((d) => d.is_current !== false);
            const filtered = current.filter((d) => {
                if (filterStatus?.value && d.status !== filterStatus.value) return false;
                if (!passesCommonFilters(d)) return false;
                if (!q) return true;
                return (d.name || '').toLowerCase().includes(q) || empName(d.employee_id).toLowerCase().includes(q) || (d.tipo || '').toLowerCase().includes(q);
            });
            updateBulkBar(filtered.map((d) => d.id));
            if (!filtered.length) {
                filesTbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-users"></i></div><p class="empty-state-title">Nenhum documento de colaborador</p><p class="empty-state-desc">${q ? `Nenhum resultado para "${q}"` : 'Colaboradores ainda não enviaram documentos'}</p></div></td></tr>`;
                return;
            }
            filesTbody.innerHTML = filtered
                .map((d) => {
                    const { cls, icon } = getFileIcon(d.name);
                    const st = statusMap[d.status] || statusMap.pendente;
                    return `<tr>
                    <td><div class="file-name-cell">${rowCheckbox(d.id)}<div class="file-icon ${cls}"><i class="fas ${icon}"></i></div><div><div class="file-name" title="${esc(d.name)}">${esc(d.name)}</div><div class="file-meta">${esc(d.tipo) || ''} ${versionBadge(d)}</div></div></div></td>
                    <td>${empName(d.employee_id)}</td>
                    <td><span class="badge ${st.cls}"><i class="fas ${st.icon}"></i> ${escapeHtml(st.label)}</span></td>
                    <td class="file-date">${fmtDate(d.created_at)}</td>
                    <td class="file-size">${d.size_label || '—'}</td>
                    <td>${validadeCell(d.data_validade)}</td>
                    <td><div class="actions-cell">
                        <button class="btn-icon btn-icon--view"    title="Visualizar" data-click="viewFile" data-click-args="${dargs(d.id, d.storage_path || '')}"><i class="fas fa-eye"></i></button>
                        <button class="btn-icon btn-icon--approve" title="Aprovar" data-click="approveColabDoc" data-click-args="${dargs(d.id)}"><i class="fas fa-check"></i></button>
                        <button class="btn-icon btn-icon--reject"  title="Recusar"  data-click="rejectColabDoc" data-click-args="${dargs(d.id)}"><i class="fas fa-times"></i></button>
                        ${returnBtn(d)}
                        ${historyBtn(d)}
                        <button class="btn-icon btn-icon--delete"  title="Excluir"  data-click="deleteColabDoc" data-click-args="${dargs(d.id, d.storage_path || '')}"><i class="fas fa-trash"></i></button>
                    </div></td>
                </tr>`;
                })
                .join('');
            return;
        }

        colabFilterStatusSection?.classList.add('hidden');
        const filtered = rhDocs.filter((f) => {
            if (f.category !== activeTab) return false;
            if (f.is_current === false) return false;
            if (!passesCommonFilters(f)) return false;
            if (!q) return true;
            return (f.name || '').toLowerCase().includes(q) || empName(f.employee_id).toLowerCase().includes(q) || (f.tipo || '').toLowerCase().includes(q);
        });
        updateBulkBar(filtered.map((f) => f.id));

        if (!filtered.length) {
            filesTbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-folder-open"></i></div><p class="empty-state-title">Nenhum arquivo encontrado</p><p class="empty-state-desc">${q ? `Nenhum resultado para "${q}"` : 'Clique em <span class="empty-state-icon-ref"><i class="fas fa-arrow-up-from-bracket"></i></span> para adicionar'}</p></div></td></tr>`;
            return;
        }

        filesTbody.innerHTML = filtered
            .map((f) => {
                const { cls, icon } = getFileIcon(f.name);
                const badgeCls = f.category === 'admissional' ? 'badge--admissional' : 'badge--demissional';
                const badgeLabel = f.category === 'admissional' ? 'Admissional' : 'Demissional';
                return `<tr>
                <td><div class="file-name-cell">${rowCheckbox(f.id)}<div class="file-icon ${cls}"><i class="fas ${icon}"></i></div><div><div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">${esc(f.tipo) || ''} ${versionBadge(f)} ${signBadge(f)} ${originBadge(f)}</div></div></div></td>
                <td>${empName(f.employee_id)}</td>
                <td><span class="badge ${badgeCls}">${badgeLabel}</span></td>
                <td class="file-date">${fmtDate(f.created_at)}</td>
                <td class="file-size">${f.size_label || '—'}</td>
                <td>${validadeCell(f.data_validade)}</td>
                <td><div class="actions-cell">
                    <button class="btn-icon btn-icon--view"   title="Visualizar" data-click="viewFile" data-click-args="${dargs(f.id, f.storage_path || '')}"><i class="fas fa-eye"></i></button>
                    ${historyBtn(f)}
                    <button class="btn-icon btn-icon--delete" title="Excluir"    data-click="deleteFile" data-click-args="${dargs(f.id, f.storage_path || '')}"><i class="fas fa-trash"></i></button>
                </div></td>
            </tr>`;
            })
            .join('');
    }

    function updateStats() {
        document.getElementById('total-count').textContent = rhDocs.length + colabDocs.length;
        document.getElementById('admissional-count').textContent = rhDocs.filter((f) => f.category === 'admissional').length;
        document.getElementById('demissional-count').textContent = rhDocs.filter((f) => f.category === 'demissional').length;

        const allDocs = rhDocs.concat(colabDocs);
        const vencendoCount = allDocs.filter((d) => getExpiryInfo(d.data_validade)?.alert).length;
        document.getElementById('vencendo-count').textContent = vencendoCount;
        vencendoCard?.classList.toggle('has-alerts', vencendoCount > 0);
    }

    function computeChecklistPending(category) {
        const pool = category === 'admissional' ? employees : terminatedEmployees;
        return pool
            .map((emp) => {
                const reqTipos = RequisitosDocumentos.requiredTipos(requirements, category, emp.contract_type);
                const rhTipos = rhDocs.filter((d) => d.employee_id === emp.id && d.category === category).map((d) => d.tipo);
                const colabTipos = colabDocs.filter((d) => d.employee_id === emp.id && d.status === 'aprovado').map((d) => d.tipo);
                const empTipos = rhTipos.concat(colabTipos);
                const missing = reqTipos.filter((t) => !empTipos.includes(t));
                return { emp, missing };
            })
            .filter((p) => p.missing.length > 0);
    }

    function renderChecklistBanner() {
        if (!checklistBanner) return;
        if (activeTab !== 'admissional' && activeTab !== 'demissional') {
            checklistBanner.classList.add('hidden');
            return;
        }

        const pending = computeChecklistPending(activeTab);
        if (!pending.length) {
            checklistBanner.classList.add('hidden');
            return;
        }

        checklistBanner.classList.remove('hidden');
        const label = activeTab === 'admissional' ? 'admissionais' : 'demissionais';
        checklistBannerText.textContent = `${pending.length} colaborador${pending.length > 1 ? 'es' : ''} com documentos ${label} pendentes`;
        checklistBanner.classList.toggle('open', checklistOpen);
        checklistBannerBody.innerHTML = pending
            .map(
                (p) => `
            <div class="checklist-row">
                <span class="checklist-row-name">${escapeHtml(p.emp.name)}</span>
                <span class="checklist-row-type">${escapeHtml(RequisitosDocumentos.normalizeContractType(p.emp.contract_type))}</span>
                ${p.missing.map((t) => `<button type="button" class="checklist-chip" data-click="openUploadModal" data-click-args="${dargs(p.emp.id, activeTab, t)}"><i class="fas fa-plus"></i> ${t}</button>`).join('')}
            </div>`
            )
            .join('');
    }

    function buildNotifications() {
        const items = [];
        rhDocs.concat(colabDocs).forEach((d) => {
            if (d.is_current === false) return;
            const info = getExpiryInfo(d.data_validade);
            if (info?.alert) {
                const type = info.cls === 'badge--vencido' ? 'vencido' : 'avencer';
                items.push({
                    type,
                    docId: d.id,
                    category: d.category || 'colaborador',
                    label: `${d.name} — ${info.label.toLowerCase()}`,
                    key: `${type}:${d.id}`,
                });
            }
        });
        colabDocs
            .filter((d) => d.status === 'recusado' && d.is_current !== false)
            .forEach((d) => {
                items.push({
                    type: 'recusado',
                    docId: d.id,
                    category: 'colaborador',
                    label: `${d.name} foi recusado — aguardando reenvio`,
                    key: `recusado:${d.id}`,
                });
            });
        rhDocs
            .filter((d) => d.requer_assinatura && !d.assinado_em && d.is_current !== false)
            .forEach((d) => {
                items.push({
                    type: 'assinatura',
                    docId: d.id,
                    category: d.category,
                    label: `${d.name} aguardando assinatura de ${empName(d.employee_id)}`,
                    key: `assinatura:${d.id}`,
                });
            });
        return items;
    }

    function renderNotifPanel() {
        if (!notifBadge || !notifPanelBody) return;
        const items = buildNotifications();
        const checklistEntries = ['admissional', 'demissional'].flatMap((cat) =>
            computeChecklistPending(cat).map((p) => `${cat}:${p.emp.id}:${[...p.missing].sort().join(',')}`)
        );
        const checklistCount = checklistEntries.length;

        const entries = [];
        if (checklistCount) entries.push({ key: `checklist:${hashKey(checklistEntries.join('|'))}`, checklistCount });
        items.slice(0, 25).forEach((it) => entries.push({ key: it.key, item: it }));
        currentNotifKeys = new Set(entries.map((e) => e.key));

        const unread = entries.filter((e) => !notifRead.has(e.key)).length;
        notifBadge.textContent = unread > 99 ? '99+' : String(unread);
        notifBadge.classList.toggle('hidden', unread === 0);
        document.getElementById('notif-mark-all')?.classList.toggle('hidden', unread === 0);

        if (!entries.length) {
            notifPanelBody.innerHTML = `<div class="notif-empty"><i class="fas fa-circle-check"></i><p>Nenhuma pendência no momento</p></div>`;
            return;
        }

        const iconMap = { vencido: 'fa-triangle-exclamation', avencer: 'fa-clock', recusado: 'fa-times-circle', assinatura: 'fa-pen-nib' };
        const readBtn = (
            key,
            isRead
        ) => `<button type="button" class="notif-item-read-btn" data-click="toggleNotifRead" data-click-args="${dargs(key)}" data-click-stop
                title="${isRead ? 'Marcar como não lida' : 'Marcar como lida'}" aria-label="${isRead ? 'Marcar como não lida' : 'Marcar como lida'}"><i class="fas ${isRead ? 'fa-rotate-left' : 'fa-check'}"></i></button>`;

        const rows = [...entries]
            .sort((a, b) => Number(notifRead.has(a.key)) - Number(notifRead.has(b.key)))
            .map((e) => {
                const isRead = notifRead.has(e.key);
                const cls = `notif-item${isRead ? ' notif-item--read' : ''}`;
                if (e.checklistCount) {
                    return `<div class="${cls}" data-click="closeNotifPanel">
                <div class="notif-item-icon notif-item-icon--checklist"><i class="fas fa-clipboard-list"></i></div>
                <div class="notif-item-body">
                    <span class="notif-item-title">${e.checklistCount} colaborador${e.checklistCount > 1 ? 'es' : ''} com documentos obrigatórios pendentes</span>
                </div>
                ${readBtn(e.key, isRead)}
            </div>`;
                }
                const it = e.item;
                return `<div class="${cls}" data-click="goToNotifItem" data-click-args="${dargs(it.docId, it.category)}">
                <div class="notif-item-icon notif-item-icon--${it.type}"><i class="fas ${iconMap[it.type]}"></i></div>
                <div class="notif-item-body"><span class="notif-item-title">${escapeHtml(it.label)}</span></div>
                ${readBtn(e.key, isRead)}
            </div>`;
            });
        notifPanelBody.innerHTML = rows.join('');
    }

    window.toggleNotifRead = (key) => {
        if (notifRead.has(key)) notifRead.delete(key);
        else notifRead.add(key);
        saveNotifRead();
        renderNotifPanel();
    };

    window.markAllNotifsRead = () => {
        currentNotifKeys.forEach((k) => notifRead.add(k));
        saveNotifRead();
        renderNotifPanel();
    };

    window.closeNotifPanel = () => {
        notifPanel?.classList.add('hidden');
    };

    window.goToNotifItem = (docId, category) => {
        const tab = category === 'colaborador' ? 'colaborador' : category;
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
        activeTab = tab;
        selectedIds.clear();
        const doc = rhDocs.find((d) => d.id === docId) || colabDocs.find((d) => d.id === docId);
        if (searchInput && doc) {
            searchInput.value = doc.name;
            searchClear?.classList.remove('hidden');
        }
        renderTable();
        closeNotifPanel();
    };

    btnNotif?.addEventListener('click', (e) => {
        e.stopPropagation();
        notifPanel?.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (notifWrapper && !notifWrapper.contains(e.target)) notifPanel?.classList.add('hidden');
    });

    checklistBannerToggle?.addEventListener('click', () => {
        checklistOpen = !checklistOpen;
        checklistBanner.classList.toggle('open', checklistOpen);
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            activeTab = btn.getAttribute('data-tab');
            if (searchInput) searchInput.value = '';
            searchClear?.classList.add('hidden');
            selectedIds.clear();
            closeColabFilterMenu();
            renderTable();
        });
    });

    colabFilterTrigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        colabFilterMenu?.classList.contains('open') ? closeColabFilterMenu() : openColabFilterMenu();
    });
    colabFilterMenu?.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', (e) => {
        if (!colabFilterMenu?.classList.contains('open')) return;
        if (!colabFilterMenu.contains(e.target) && !colabFilterTrigger?.contains(e.target)) closeColabFilterMenu();
    });

    colabFilterMenu?.querySelectorAll('.btn-filter[data-status]').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (filterStatus) filterStatus.value = btn.getAttribute('data-status') || '';
            colabFilterMenu.querySelectorAll('.btn-filter[data-status]').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            updateFilterClearVisibility();
            renderTable();
            closeColabFilterMenu();
        });
    });

    searchInput?.addEventListener('input', () => {
        filterEmployeeId = null;
        searchClear?.classList.toggle('hidden', !searchInput.value.trim());
        renderTable();
    });
    searchClear?.addEventListener('click', () => {
        filterEmployeeId = null;
        searchInput.value = '';
        searchClear.classList.add('hidden');
        renderTable();
    });

    function updateFilterClearVisibility() {
        const active = !!(filterStatus?.value || filterDept?.value || filterDateStart?.value || filterDateEnd?.value);
        filterClearBtn?.classList.toggle('hidden', !active);
    }

    filterClearBtn?.addEventListener('click', () => {
        if (filterStatus) filterStatus.value = '';
        if (filterDept) filterDept.value = '';
        if (filterDateStart) filterDateStart.value = '';
        if (filterDateEnd) filterDateEnd.value = '';
        colabFilterMenu?.querySelectorAll('.btn-filter').forEach((b) => b.classList.remove('active'));
        colabFilterMenu?.querySelector('.btn-filter[data-status=""]')?.classList.add('active');
        colabDeptFilterList?.querySelector('.btn-filter[data-dept=""]')?.classList.add('active');
        calRangeStart = null;
        calRangeEnd = null;
        updateFilterDateTriggerText();
        updateFilterClearVisibility();
        renderTable();
    });

    const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const pad2 = (n) => String(n).padStart(2, '0');
    const toISODate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const fmtShort = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
    const parseISODate = (s) => {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
    };

    let calRangeStart = null,
        calRangeEnd = null;
    const today = new Date();
    let calViewYear = today.getFullYear();
    let calViewMonth = today.getMonth();

    function updateFilterDateTriggerText() {
        if (!filterDateTriggerText) return;
        if (filterDateStart?.value && filterDateEnd?.value) {
            filterDateTriggerText.textContent = `${fmtShort(parseISODate(filterDateStart.value))} – ${fmtShort(parseISODate(filterDateEnd.value))}`;
        } else if (filterDateStart?.value) {
            filterDateTriggerText.textContent = `A partir de ${fmtShort(parseISODate(filterDateStart.value))}`;
        } else if (filterDateEnd?.value) {
            filterDateTriggerText.textContent = `Até ${fmtShort(parseISODate(filterDateEnd.value))}`;
        } else {
            filterDateTriggerText.textContent = 'Período';
        }
        filterDateTrigger?.classList.toggle('active', !!(filterDateStart?.value || filterDateEnd?.value));
    }

    function renderFilterCalendar() {
        if (!filterCalendarTitle || !filterCalendarGrid) return;
        filterCalendarTitle.textContent = `${MESES_PT[calViewMonth]} ${calViewYear}`;

        const startOffset = new Date(calViewYear, calViewMonth, 1).getDay();
        const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(calViewYear, calViewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(calViewYear, calViewMonth, d);
            const isToday = d === today.getDate() && calViewMonth === today.getMonth() && calViewYear === today.getFullYear();
            const isStart = calRangeStart && date.getTime() === calRangeStart.getTime();
            const isEnd = calRangeEnd && date.getTime() === calRangeEnd.getTime();
            const inRange = calRangeStart && calRangeEnd && date > calRangeStart && date < calRangeEnd;
            cells.push({ day: d, muted: false, isToday, isStart, isEnd, inRange });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        filterCalendarGrid.innerHTML = cells
            .map((c, i) => {
                const cls = ['calendar-day'];
                if (c.muted) cls.push('calendar-day--muted');
                if (c.isToday) cls.push('calendar-day--today');
                if (c.inRange) cls.push('calendar-day--in-range');
                if (c.isStart) cls.push('calendar-day--range-start');
                if (c.isEnd) cls.push('calendar-day--range-end');
                const dataDay = c.muted ? '' : ` data-day="${c.day}"`;
                return `<button type="button" class="${cls.join(' ')}"${dataDay}>${c.day}</button>`;
            })
            .join('');
    }

    function positionFilterCalendar() {
        if (!filterDateTrigger || !filterCalendarPopover) return;
        const rect = filterDateTrigger.getBoundingClientRect();
        const width = 296;
        let left = rect.left;
        if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
        if (left < 12) left = 12;
        filterCalendarPopover.style.top = `${rect.bottom + 8}px`;
        filterCalendarPopover.style.left = `${left}px`;
    }

    function onFilterCalendarOutsideClick(e) {
        if (!filterCalendarPopover.contains(e.target) && !filterDateTrigger.contains(e.target)) closeFilterCalendar();
    }
    function onFilterCalendarEscape(e) {
        if (e.key === 'Escape') closeFilterCalendar();
    }

    function openFilterCalendar() {
        closeColabFilterMenu();
        calRangeStart = filterDateStart?.value ? parseISODate(filterDateStart.value) : null;
        calRangeEnd = filterDateEnd?.value ? parseISODate(filterDateEnd.value) : null;
        const base = calRangeStart || today;
        calViewYear = base.getFullYear();
        calViewMonth = base.getMonth();
        renderFilterCalendar();
        positionFilterCalendar();
        filterCalendarPopover?.classList.add('open');
        filterDateTrigger?.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onFilterCalendarOutsideClick);
        document.addEventListener('keydown', onFilterCalendarEscape);
        window.addEventListener('resize', positionFilterCalendar);
    }

    function closeFilterCalendar() {
        filterCalendarPopover?.classList.remove('open');
        filterDateTrigger?.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onFilterCalendarOutsideClick);
        document.removeEventListener('keydown', onFilterCalendarEscape);
        window.removeEventListener('resize', positionFilterCalendar);
    }

    filterDateTrigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        filterCalendarPopover?.classList.contains('open') ? closeFilterCalendar() : openFilterCalendar();
    });

    filterCalendarGrid?.addEventListener('click', (e) => {
        const btn = e.target.closest('.calendar-day[data-day]');
        if (!btn) return;
        const clicked = new Date(calViewYear, calViewMonth, Number(btn.getAttribute('data-day')));
        if (!calRangeStart || (calRangeStart && calRangeEnd)) {
            calRangeStart = clicked;
            calRangeEnd = null;
        } else if (clicked < calRangeStart) {
            calRangeStart = clicked;
        } else {
            calRangeEnd = clicked;
        }
        renderFilterCalendar();
    });

    filterCalendarPrev?.addEventListener('click', (e) => {
        e.stopPropagation();
        calViewMonth--;
        if (calViewMonth < 0) {
            calViewMonth = 11;
            calViewYear--;
        }
        renderFilterCalendar();
    });
    filterCalendarNext?.addEventListener('click', (e) => {
        e.stopPropagation();
        calViewMonth++;
        if (calViewMonth > 11) {
            calViewMonth = 0;
            calViewYear++;
        }
        renderFilterCalendar();
    });

    filterCalendarClear?.addEventListener('click', () => {
        calRangeStart = null;
        calRangeEnd = null;
        if (filterDateStart) filterDateStart.value = '';
        if (filterDateEnd) filterDateEnd.value = '';
        updateFilterDateTriggerText();
        updateFilterClearVisibility();
        renderTable();
        closeFilterCalendar();
    });

    filterCalendarApply?.addEventListener('click', () => {
        if (filterDateStart) filterDateStart.value = calRangeStart ? toISODate(calRangeStart) : '';
        if (filterDateEnd) filterDateEnd.value = calRangeEnd || calRangeStart ? toISODate(calRangeEnd || calRangeStart) : '';
        updateFilterDateTriggerText();
        updateFilterClearVisibility();
        renderTable();
        closeFilterCalendar();
    });

    function updateBulkBar(visibleIds) {
        if (!bulkBar) return;
        for (const id of Array.from(selectedIds)) {
            const stillExists = rhDocs.some((d) => d.id === id) || colabDocs.some((d) => d.id === id);
            if (!stillExists) selectedIds.delete(id);
        }

        if (selectAllCheckbox) {
            const selectedVisible = visibleIds.filter((id) => selectedIds.has(id)).length;
            selectAllCheckbox.checked = visibleIds.length > 0 && selectedVisible === visibleIds.length;
            selectAllCheckbox.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
        }

        if (!selectedIds.size) {
            bulkBar.classList.add('hidden');
            return;
        }
        bulkBar.classList.remove('hidden');
        bulkBarCount.textContent = `${selectedIds.size} selecionado${selectedIds.size > 1 ? 's' : ''}`;

        if (activeTab === 'colaborador') {
            bulkBarActions.innerHTML = `
                <button type="button" class="bulk-bar-btn bulk-bar-btn--success" data-click="bulkApproveColab"><i class="fas fa-check"></i> Aprovar</button>
                <button type="button" class="bulk-bar-btn" data-click="bulkRejectColab"><i class="fas fa-times"></i> Recusar</button>
                <button type="button" class="bulk-bar-btn bulk-bar-btn--danger" data-click="bulkDeleteColab"><i class="fas fa-trash"></i> Excluir</button>`;
        } else {
            bulkBarActions.innerHTML = `
                <button type="button" class="bulk-bar-btn" data-click="bulkDownloadRh"><i class="fas fa-download"></i> Baixar</button>
                <button type="button" class="bulk-bar-btn bulk-bar-btn--danger" data-click="bulkDeleteRh"><i class="fas fa-trash"></i> Excluir</button>`;
        }
    }

    filesTbody?.addEventListener('change', (e) => {
        const cb = e.target.closest('.row-check');
        if (!cb) return;
        const id = cb.getAttribute('data-id');
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        const visibleIds = Array.from(filesTbody.querySelectorAll('.row-check')).map((el) => el.getAttribute('data-id'));
        updateBulkBar(visibleIds);
    });

    selectAllCheckbox?.addEventListener('change', () => {
        const visibleChecks = Array.from(filesTbody.querySelectorAll('.row-check'));
        const visibleIds = visibleChecks.map((el) => el.getAttribute('data-id'));
        if (selectAllCheckbox.checked) visibleIds.forEach((id) => selectedIds.add(id));
        else visibleIds.forEach((id) => selectedIds.delete(id));
        visibleChecks.forEach((el) => {
            el.checked = selectAllCheckbox.checked;
        });
        updateBulkBar(visibleIds);
    });

    bulkBarClear?.addEventListener('click', () => {
        selectedIds.clear();
        renderTable();
    });

    window.bulkApproveColab = async () => {
        const { approved, failed } = await approveDocs(Array.from(selectedIds));
        if (!approved.length) {
            showToast('Erro', 'Não foi possível aprovar os documentos selecionados.', 'error');
            return;
        }
        selectedIds.clear();
        renderTable();
        const n = approved.length;
        showToast(
            'Documentos aprovados!',
            `${n} documento${n > 1 ? 's' : ''} movido${n > 1 ? 's' : ''} para Admissional/Demissional.${failed ? ` ${failed} falhou.` : ''}`,
            'success'
        );
    };

    window.bulkRejectColab = async () => {
        const ids = Array.from(selectedIds);
        const { error } = await sb.from('documents').update({ status: 'recusado' }).in('id', ids);
        if (error) {
            showToast('Erro', 'Não foi possível recusar os documentos selecionados.', 'error');
            return;
        }
        ids.forEach((id) => {
            const doc = colabDocs.find((d) => d.id === id);
            if (doc) {
                doc.status = 'recusado';
                logAudit('recusado', doc);
            }
        });
        selectedIds.clear();
        renderTable();
        showToast('Documentos recusados', `${ids.length} documento${ids.length > 1 ? 's' : ''} atualizado${ids.length > 1 ? 's' : ''}.`, 'error');
    };

    window.bulkDeleteColab = async () => {
        if (!confirmDelete(selectedIds.size)) return;
        const ids = Array.from(selectedIds);
        const docs = ids.map((id) => colabDocs.find((d) => d.id === id)).filter(Boolean);
        const paths = docs.map((d) => d.storage_path).filter(Boolean);
        if (paths.length) await sb.storage.from('documents').remove(paths);
        const { error } = await sb.from('documents').delete().in('id', ids);
        if (error) {
            showToast('Erro', 'Não foi possível excluir os documentos selecionados.', 'error');
            return;
        }
        docs.forEach((d) => logAudit('excluido', d));
        colabDocs = colabDocs.filter((d) => !ids.includes(d.id));
        selectedIds.clear();
        renderTable();
        showToast('Documentos excluídos!', `${ids.length} documento${ids.length > 1 ? 's' : ''} removido${ids.length > 1 ? 's' : ''}.`, 'error');
    };

    window.bulkDeleteRh = async () => {
        if (!confirmDelete(selectedIds.size)) return;
        const ids = Array.from(selectedIds);
        const docs = ids.map((id) => rhDocs.find((f) => f.id === id)).filter(Boolean);
        const paths = docs.map((d) => d.storage_path).filter(Boolean);
        if (paths.length) await sb.storage.from('documents').remove(paths);
        const { error } = await sb.from('documents').delete().in('id', ids);
        if (error) {
            showToast('Erro', 'Não foi possível excluir os arquivos selecionados.', 'error');
            return;
        }
        docs.forEach((d) => logAudit('excluido', d));
        rhDocs = rhDocs.filter((f) => !ids.includes(f.id));
        selectedIds.clear();
        renderTable();
        showToast('Arquivos excluídos!', `${ids.length} arquivo${ids.length > 1 ? 's' : ''} removido${ids.length > 1 ? 's' : ''}.`, 'error');
    };

    window.bulkDownloadRh = async () => {
        const ids = Array.from(selectedIds);
        const docs = ids.map((id) => rhDocs.find((f) => f.id === id)).filter((d) => d?.storage_path);
        if (!docs.length) {
            showToast('Nada para baixar', 'Nenhum arquivo com download disponível na seleção.', 'warning');
            return;
        }
        for (const doc of docs) {
            const { blob } = await NexusFiles.download('documents', doc.storage_path);
            if (!blob) continue;
            try {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = doc.name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
            } catch {}
        }
        showToast('Download iniciado', `${docs.length} arquivo${docs.length > 1 ? 's' : ''} baixado${docs.length > 1 ? 's' : ''}.`, 'success');
    };

    window.approveColabDoc = async (id) => {
        const { approved } = await approveDocs([id]);
        if (!approved.length) {
            showToast('Erro', 'Não foi possível aprovar o documento.', 'error');
            return;
        }
        renderTable();
        const label = approved[0].category === 'demissional' ? 'Demissional' : 'Admissional';
        showToast('Documento aprovado!', `O colaborador vê o status Aprovado e o arquivo agora consta em ${label}.`, 'success');
    };

    window.rejectColabDoc = async (id) => {
        const { error } = await sb.from('documents').update({ status: 'recusado' }).eq('id', id);
        if (error) {
            showToast('Erro', 'Não foi possível recusar o documento.', 'error');
            return;
        }
        const doc = colabDocs.find((d) => d.id === id);
        if (doc) doc.status = 'recusado';
        renderTable();
        if (doc) logAudit('recusado', doc);
        showToast('Documento recusado', 'O status foi atualizado para Recusado.', 'error');
    };

    window.deleteColabDoc = async (id, storagePath) => {
        if (!confirmDelete()) return;
        const doc = colabDocs.find((d) => d.id === id);
        if (storagePath) await sb.storage.from('documents').remove([storagePath]);
        const { error } = await sb.from('documents').delete().eq('id', id);
        if (error) {
            showToast('Erro', 'Não foi possível excluir o documento.', 'error');
            return;
        }
        colabDocs = colabDocs.filter((d) => d.id !== id);
        renderTable();
        if (doc) logAudit('excluido', doc);
        showToast('Documento excluído!', 'O arquivo foi removido com sucesso.', 'error');
    };

    window.viewFile = async (id, storagePath) => {
        if (!storagePath) {
            showToast('Arquivo indisponível', 'O arquivo não foi salvo no envio. Peça ao colaborador para enviar o documento novamente.', 'warning');
            return;
        }
        const doc = rhDocs.concat(colabDocs).find((d) => d.id === id);
        const { error } = await NexusFiles.open('documents', storagePath, { name: doc?.name });
        if (error) {
            showToast('Não foi possível abrir', error.message, 'error');
            return;
        }
        if (doc?.employee_id) NexusAuth.logAccess(doc.employee_id, 'documento', doc.name);
    };

    window.showVersionHistory = (id) => {
        const pool = rhDocs.concat(colabDocs);
        const chain = [];
        let current = pool.find((d) => d.id === id);
        while (current) {
            chain.push(current);
            current = current.replaces_document_id ? pool.find((d) => d.id === current.replaces_document_id) : null;
        }
        if (!chain.length) return;

        const body = document.getElementById('history-modal-body');
        body.innerHTML = chain
            .map(
                (d, i) => `
            <div class="history-row${i === 0 ? ' history-row--current' : ''}">
                <div class="history-row-badge">v${d.version}${i === 0 ? ' · atual' : ''}</div>
                <div class="history-row-body">
                    <span class="history-row-name">${escapeHtml(d.name)}</span>
                    <span class="history-row-meta">${fmtDate(d.created_at)} · ${d.size_label || '—'}</span>
                </div>
                ${d.storage_path ? `<button class="btn-icon btn-icon--view" title="Visualizar" data-click="viewFile" data-click-args="${dargs(d.id, d.storage_path)}"><i class="fas fa-eye"></i></button>` : ''}
            </div>`
            )
            .join('');
        document.getElementById('history-modal')?.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    window.closeHistoryModal = () => {
        document.getElementById('history-modal')?.classList.remove('open');
        document.body.style.overflow = '';
    };

    const AUDIT_ACTION_LABELS = {
        criado: 'Criado',
        substituido: 'Substituído',
        aprovado: 'Aprovado',
        recusado: 'Recusado',
        assinado: 'Assinado',
        excluido: 'Excluído',
    };

    const AUDIT_ACTION_ICONS = {
        criado: 'fa-plus',
        substituido: 'fa-clock-rotate-left',
        aprovado: 'fa-check',
        recusado: 'fa-times',
        assinado: 'fa-signature',
        excluido: 'fa-trash',
    };

    async function loadAuditLog() {
        const { data } = await sb.from('document_audit_log').select('*').order('created_at', { ascending: false }).limit(300);
        auditLogEntries = data || [];
    }

    function renderAuditLog() {
        if (!auditLogList) return;
        const filterVal = auditFilterAction?.value || '';
        const filtered = filterVal ? auditLogEntries.filter((l) => l.action === filterVal) : auditLogEntries;
        if (!filtered.length) {
            auditLogList.innerHTML = `<div class="audit-empty">Nenhum registro encontrado.</div>`;
            return;
        }
        auditLogList.innerHTML = filtered
            .map((l) => {
                const label = AUDIT_ACTION_LABELS[l.action] || l.action;
                const icon = AUDIT_ACTION_ICONS[l.action] || 'fa-circle';
                const emp = empName(l.employee_id);
                const when = new Date(l.created_at).toLocaleString('pt-BR');
                return `<div class="audit-row">
                <div class="audit-row-icon audit-row-icon--${l.action}"><i class="fas ${icon}"></i></div>
                <div class="audit-row-body">
                    <span class="audit-row-title"><b>${label}</b> — ${escapeHtml(l.document_name)}${emp !== '—' ? ` (${emp})` : ''}</span>
                    <span class="audit-row-meta">${escapeHtml(l.actor_name) || '—'} · ${when}</span>
                </div>
            </div>`;
            })
            .join('');
    }

    window.openAuditModal = async () => {
        document.getElementById('audit-modal')?.classList.add('open');
        document.body.style.overflow = 'hidden';
        await loadAuditLog();
        renderAuditLog();
    };

    window.closeAuditModal = () => {
        document.getElementById('audit-modal')?.classList.remove('open');
        document.body.style.overflow = '';
    };

    createSelectField('audit-filter-action', renderAuditLog);

    function renderRequirementsGroup(category) {
        const container = document.getElementById(`requirements-${category}`);
        if (!container) return;
        const items = RequisitosDocumentos.requirementsFor(requirements, category, currentRequirementsType());
        if (!items.length) {
            container.innerHTML = `<p class="requirements-empty">Nenhum tipo obrigatório cadastrado.</p>`;
            return;
        }
        container.innerHTML = items
            .map(
                (r) => `
            <span class="requirements-chip">${escapeHtml(r.tipo)}<button type="button" data-click="removeRequirement" data-click-args="${dargs(r.id)}" aria-label="Remover"><i class="fas fa-xmark"></i></button></span>
        `
            )
            .join('');
    }

    function currentRequirementsType() {
        return RequisitosDocumentos.normalizeContractType(document.getElementById('requirements-contract-type')?.value);
    }

    function renderRequirementsModal() {
        const basis = document.getElementById('requirements-legal-basis');
        if (basis) basis.textContent = RequisitosDocumentos.contractTypeInfo(currentRequirementsType()).base;
        renderRequirementsGroup('admissional');
        renderRequirementsGroup('demissional');
    }

    const requirementsTypePopover = document.getElementById('requirements-contract-type-popover');
    if (requirementsTypePopover) {
        requirementsTypePopover.innerHTML = RequisitosDocumentos.CONTRACT_TYPES.map(
            (t) => `<button type="button" class="select-option" role="option" data-value="${escapeHtml(t.value)}">${escapeHtml(t.label)}</button>`
        ).join('');
    }
    const requirementsTypeField = createSelectField('requirements-contract-type', renderRequirementsModal);
    requirementsTypeField?.setValue('CLT');

    window.openRequirementsModal = () => {
        document.getElementById('requirements-modal')?.classList.add('open');
        document.body.style.overflow = 'hidden';
        renderRequirementsModal();
    };

    window.closeRequirementsModal = () => {
        document.getElementById('requirements-modal')?.classList.remove('open');
        document.body.style.overflow = '';
    };

    window.addRequirement = async (category) => {
        const input = document.getElementById(`requirements-add-${category}`);
        const tipo = input?.value.trim();
        if (!tipo) return;
        const contractType = currentRequirementsType();
        const { data, error } = await sb
            .from('document_requirements')
            .insert({ category, tipo, obrigatorio: true, contract_type: contractType })
            .select()
            .single();
        if (error) {
            showToast('Erro', 'Não foi possível adicionar — talvez esse tipo já esteja cadastrado.', 'error');
            return;
        }
        requirements.push(data);
        input.value = '';
        renderRequirementsModal();
        renderChecklistBanner();
        renderNotifPanel();
        showToast(
            'Tipo adicionado',
            `"${tipo}" agora é obrigatório em ${category === 'admissional' ? 'Admissional' : 'Demissional'} (${contractType}).`,
            'success'
        );
    };

    window.removeRequirement = async (id) => {
        const { error } = await sb.from('document_requirements').delete().eq('id', id);
        if (error) {
            showToast('Erro', 'Não foi possível remover o tipo.', 'error');
            return;
        }
        requirements = requirements.filter((r) => r.id !== id);
        renderRequirementsModal();
        renderChecklistBanner();
        renderNotifPanel();
        showToast('Tipo removido', 'O checklist foi atualizado.', 'success');
    };

    ['requirements-add-admissional', 'requirements-add-demissional'].forEach((id) => {
        document.getElementById(id)?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addRequirement(id.endsWith('admissional') ? 'admissional' : 'demissional');
            }
        });
    });

    window.deleteFile = async (id, storagePath) => {
        if (!confirmDelete()) return;
        const doc = rhDocs.find((f) => f.id === id);
        if (storagePath) await sb.storage.from('documents').remove([storagePath]);
        const { error } = await sb.from('documents').delete().eq('id', id);
        if (error) {
            showToast('Erro', 'Não foi possível excluir o arquivo.', 'error');
            return;
        }
        rhDocs = rhDocs.filter((f) => f.id !== id);
        renderTable();
        if (doc) logAudit('excluido', doc);
        showToast('Arquivo excluído!', 'O arquivo foi removido com sucesso.', 'error');
    };

    let closeActivePopover = null;
    function claimPopover(close) {
        if (closeActivePopover && closeActivePopover !== close) closeActivePopover();
        closeActivePopover = close;
    }
    function releasePopover(close) {
        if (closeActivePopover === close) closeActivePopover = null;
    }

    function createSelectField(id, onChange) {
        const trigger = document.getElementById(`${id}-trigger`);
        const popover = document.getElementById(`${id}-popover`);
        const label = document.getElementById(`${id}-label`);
        const hidden = document.getElementById(id);
        if (!trigger || !popover || !label || !hidden) return null;

        function open() {
            claimPopover(close);
            popover.classList.add('open');
            trigger.classList.add('active');
            trigger.setAttribute('aria-expanded', 'true');
            document.addEventListener('click', onOutsideClick);
            document.addEventListener('keydown', onEscape);
        }
        function close() {
            releasePopover(close);
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

        function setValue(value) {
            const opts = Array.from(popover.querySelectorAll('.select-option'));
            const opt = opts.find((o) => o.dataset.value === value);
            hidden.value = opt ? opt.dataset.value : '';
            label.textContent = opt ? opt.textContent : 'Selecione';
            label.classList.toggle('select-placeholder', !opt);
            opts.forEach((o) => o.classList.toggle('selected', o === opt));
            close();
            onChange?.();
        }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            popover.classList.contains('open') ? close() : open();
        });
        popover.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.target.closest('.select-option');
            if (btn) setValue(btn.dataset.value);
        });

        return { setValue };
    }

    const employeeField = createSelectField('upload-employee-select', updateUploadBtnState);
    const categoryField = createSelectField('upload-category', updateUploadBtnState);

    function createValidadeCalendar() {
        const trigger = document.getElementById('upload-validade-trigger');
        const popover = document.getElementById('upload-validade-popover');
        const textEl = document.getElementById('upload-validade-text');
        const hidden = document.getElementById('upload-validade');
        const titleEl = document.getElementById('upload-validade-title');
        const gridEl = document.getElementById('upload-validade-grid');
        const prevBtn = document.getElementById('upload-validade-prev');
        const nextBtn = document.getElementById('upload-validade-next');
        const footerEl = document.getElementById('upload-validade-footer');
        const clearBtn = document.getElementById('upload-validade-clear');
        if (!trigger || !popover || !textEl || !hidden || !gridEl) return null;

        const pad2 = (n) => String(n).padStart(2, '0');
        const today = new Date();
        let viewYear = today.getFullYear(),
            viewMonth = today.getMonth();

        function setValue(dateStr) {
            hidden.value = dateStr || '';
            if (dateStr) {
                const [y, m, d] = dateStr.split('-');
                textEl.textContent = `${d}/${m}/${y}`;
            } else {
                textEl.textContent = 'Selecione';
            }
            textEl.classList.toggle('select-placeholder', !dateStr);
            footerEl?.classList.toggle('hidden', !dateStr);
            close();
        }

        function render() {
            titleEl.textContent = `${MESES_PT[viewMonth]} ${viewYear}`;
            const startOffset = new Date(viewYear, viewMonth, 1).getDay();
            const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
            const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

            const cells = [];
            for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
            for (let d = 1; d <= daysInMonth; d++) {
                const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
                cells.push({ day: d, muted: false, isToday });
            }
            let next = 1;
            while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

            gridEl.innerHTML = cells
                .map(
                    (c) =>
                        `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}" data-day="${c.day}">${c.day}</button>`
                )
                .join('');
        }

        function open() {
            claimPopover(close);
            const [selYear, selMonth] = (hidden.value || '').split('-').map(Number);
            viewYear = selYear || today.getFullYear();
            viewMonth = selMonth ? selMonth - 1 : today.getMonth();
            render();
            popover.classList.add('open');
            trigger.classList.add('active');
            trigger.setAttribute('aria-expanded', 'true');
            document.addEventListener('click', onOutsideClick);
            document.addEventListener('keydown', onEscape);
        }
        function close() {
            releasePopover(close);
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
        popover.addEventListener('click', (e) => e.stopPropagation());
        gridEl.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-day]');
            if (!btn || btn.classList.contains('calendar-day--muted')) return;
            setValue(`${viewYear}-${pad2(viewMonth + 1)}-${pad2(Number(btn.dataset.day))}`);
        });
        prevBtn?.addEventListener('click', () => {
            viewMonth--;
            if (viewMonth < 0) {
                viewMonth = 11;
                viewYear--;
            }
            render();
        });
        nextBtn?.addEventListener('click', () => {
            viewMonth++;
            if (viewMonth > 11) {
                viewMonth = 0;
                viewYear++;
            }
            render();
        });
        clearBtn?.addEventListener('click', () => setValue(''));

        return { setValue };
    }

    const validadeField = createValidadeCalendar();

    function updateUploadBtnState() {
        const btn = document.getElementById('btn-submit-upload');
        if (!btn) return;
        const empId = document.getElementById('upload-employee-select')?.value;
        const category = document.getElementById('upload-category')?.value;
        btn.disabled = !(empId && category && selectedFiles.length > 0);
    }

    function populateEmployeeSelect() {
        const popover = document.getElementById('upload-employee-select-popover');
        if (!popover) return;
        popover.innerHTML = employees
            .map((e) => `<button type="button" class="select-option" role="option" data-value="${escapeHtml(String(e.id))}">${escapeHtml(e.name)}</button>`)
            .join('');
    }

    window.openUploadModal = (employeeId, category, tipo) => {
        uploadModal?.classList.add('open');
        document.body.style.overflow = 'hidden';
        populateEmployeeSelect();
        employeeField?.setValue(employeeId ? String(employeeId) : '');
        categoryField?.setValue(category && tipo ? `${category}|${tipo}` : '');
    };
    window.openReturnModal = (docId) => {
        const doc = colabDocs.find((d) => d.id === docId);
        if (!doc) return;
        returnForDocId = docId;
        const category = approvalUpdate(doc).category || doc.category;
        window.openUploadModal(doc.employee_id, category, doc.tipo);
        const hint = document.getElementById('upload-return-hint');
        document.getElementById('upload-return-hint-text').textContent =
            `Anexe a versão preenchida e assinada de "${doc.tipo}". Ao enviar, o documento de ${empName(doc.employee_id)} é aprovado e a devolução chega ao colaborador.`;
        hint?.classList.remove('hidden');
    };

    window.closeUploadModal = () => {
        returnForDocId = null;
        document.getElementById('upload-return-hint')?.classList.add('hidden');
        uploadModal?.classList.remove('open');
        document.body.style.overflow = '';
        employeeField?.setValue('');
        categoryField?.setValue('');
        validadeField?.setValue('');
        if (uploadLgpdConsent) uploadLgpdConsent.checked = false;
        clearFileInput();
    };

    dropZone?.addEventListener('click', () => fileInput?.click());
    dropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        addSelectedFiles(e.dataTransfer.files);
    });
    fileInput?.addEventListener('change', () => {
        addSelectedFiles(fileInput.files);
        fileInput.value = '';
    });
    btnCamera?.addEventListener('click', () => cameraInput?.click());
    cameraInput?.addEventListener('change', () => {
        addSelectedFiles(cameraInput.files);
        cameraInput.value = '';
    });

    function renderSelectedFiles() {
        updateUploadBtnState();
        if (!filesSelectedList) return;
        filesSelectedList.classList.toggle('hidden', selectedFiles.length === 0);
        dropZone?.classList.toggle('hidden', selectedFiles.length > 0);
        filesSelectedList.innerHTML = selectedFiles
            .map(
                (f, i) => `
            <div class="file-selected-item">
                <div class="file-selected-icon"><i class="fas fa-file-circle-check"></i></div>
                <span>${escapeHtml(f.name)}</span>
                <button type="button" data-click="removeSelectedFile" data-click-args="${dargs(i)}" aria-label="Remover arquivo"><i class="fas fa-xmark"></i></button>
            </div>`
            )
            .join('');
    }

    function addSelectedFiles(fileList) {
        const files = Array.from(fileList || []);
        let ocrCandidate = null;
        for (const file of files) {
            if (file.size > 25 * 1024 * 1024) {
                showToast('Arquivo muito grande!', `${file.name} ultrapassa o limite de 25 MB.`, 'warning');
                continue;
            }
            if (selectedFiles.some((f) => f.name === file.name && f.size === file.size)) continue;
            selectedFiles.push(file);
            if (!ocrCandidate && /\.(jpe?g|png)$/i.test(file.name)) ocrCandidate = file;
        }
        renderSelectedFiles();
        if (ocrCandidate && !document.getElementById('upload-category').value) runOcrSuggestion(ocrCandidate);
    }

    window.removeSelectedFile = (index) => {
        selectedFiles.splice(index, 1);
        renderSelectedFiles();
    };

    window.clearFileInput = () => {
        selectedFiles = [];
        if (fileInput) fileInput.value = '';
        if (cameraInput) cameraInput.value = '';
        renderSelectedFiles();
        ocrHint?.classList.add('hidden');
    };

    const OCR_KEYWORDS = [
        { tipo: 'RG', match: ['REGISTRO GERAL', 'CARTEIRA DE IDENTIDADE', 'REPUBLICA FEDERATIVA'] },
        { tipo: 'CPF', match: ['CADASTRO DE PESSOA', 'CPF', 'RECEITA FEDERAL'] },
        { tipo: 'Carteira de Trabalho', match: ['CARTEIRA DE TRABALHO', 'CTPS'] },
        { tipo: 'Comprovante de Residência', match: ['FATURA', 'CONTA DE ENERGIA', 'CONTA DE AGUA', 'COMPROVANTE DE ENDERECO'] },
        { tipo: 'Contrato de Trabalho', match: ['CONTRATO DE TRABALHO'] },
        { tipo: 'Exame Admissional', match: ['ATESTADO DE SAUDE OCUPACIONAL', 'EXAME ADMISSIONAL', 'ASO'] },
        { tipo: 'Exame Demissional', match: ['EXAME DEMISSIONAL'] },
        { tipo: 'Aviso Prévio', match: ['AVISO PREVIO'] },
        { tipo: 'Termo de Rescisão', match: ['TERMO DE RESCISAO', 'RESCISAO DO CONTRATO'] },
        { tipo: 'Homologação', match: ['HOMOLOGACAO'] },
        { tipo: 'Guia FGTS', match: ['FGTS', 'GUIA DE RECOLHIMENTO'] },
    ];

    function stripAccents(s) {
        return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    }

    async function runOcrSuggestion(file) {
        if (typeof Tesseract === 'undefined' || !ocrHint) return;
        ocrHint.classList.remove('hidden');
        ocrHintText.textContent = 'Analisando documento com OCR para sugerir o tipo…';
        try {
            const {
                data: { text },
            } = await Tesseract.recognize(file, 'por');
            const upper = stripAccents(text || '').toUpperCase();
            const found = OCR_KEYWORDS.find((k) => k.match.some((kw) => upper.includes(stripAccents(kw))));
            if (!found) {
                ocrHintText.textContent = 'Não foi possível sugerir o tipo automaticamente. Selecione manualmente.';
                return;
            }

            const categoryInput = document.getElementById('upload-category');
            const options = Array.from(document.querySelectorAll('#upload-category-popover .select-option'));
            const preferred = options.find((o) => o.dataset.value === `${activeTab}|${found.tipo}`);
            const anyMatch = preferred || options.find((o) => o.dataset.value.endsWith(`|${found.tipo}`));
            if (anyMatch && !categoryInput.value) {
                categoryField?.setValue(anyMatch.dataset.value);
                ocrHintText.textContent = `Tipo sugerido por OCR: "${found.tipo}" — confira antes de enviar.`;
            } else {
                ocrHintText.textContent = `Tipo sugerido por OCR: "${found.tipo}" — selecione manualmente na lista acima.`;
            }
        } catch {
            ocrHintText.textContent = 'Não foi possível analisar o documento automaticamente.';
        }
    }

    window.submitUpload = async () => {
        const categoryRaw = document.getElementById('upload-category').value;
        if (!categoryRaw) {
            showToast('Campo obrigatório', 'Selecione a categoria do arquivo.', 'warning');
            return;
        }
        if (!selectedFiles.length) {
            showToast('Campo obrigatório', 'Selecione ao menos um arquivo para enviar.', 'warning');
            return;
        }
        if (!uploadLgpdConsent?.checked) {
            showToast('Consentimento LGPD', 'Confirme o consentimento do colaborador para enviar o documento.', 'warning');
            return;
        }

        const [category, tipo] = categoryRaw.split('|');
        const empId = document.getElementById('upload-employee-select')?.value || null;
        const returning = returnForDocId ? colabDocs.find((d) => d.id === returnForDocId) : null;
        const finalEmpId = returning?.employee_id || empId || null;
        if (!finalEmpId) {
            showToast('Selecione o colaborador', 'Escolha o colaborador ao qual o documento pertence.', 'warning');
            return;
        }

        let docToSupersede = finalEmpId
            ? rhDocs.find(
                  (d) => d.source === 'Administrador' && d.employee_id === finalEmpId && d.category === category && d.tipo === tipo && d.is_current !== false
              )
            : null;

        let successCount = 0;
        const deliveredIds = [];
        for (const file of selectedFiles) {
            const sizeKB = Math.round(file.size / 1024);
            const sizeLabel = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
            const storagePath = `rh/${Date.now()}_${NexusFiles.safeName(file.name)}`;

            const { error: uploadError } = await NexusFiles.upload('documents', storagePath, file, { employeeId: finalEmpId });
            if (uploadError) {
                showToast('Erro no upload', `Não foi possível enviar ${file.name}.`, 'error');
                continue;
            }

            const { data: inserted, error: dbError } = await sb
                .from('documents')
                .insert({
                    name: file.name,
                    employee_id: finalEmpId,
                    category,
                    tipo,
                    size_label: sizeLabel,
                    storage_path: storagePath,
                    source: 'Administrador',
                    status: 'aprovado',
                    created_by: user.id,
                    data_validade: uploadValidade?.value || null,
                    retido_ate: computeRetentionDate(tipo),
                    lgpd_consentimento: true,
                    lgpd_consentimento_em: new Date().toISOString(),
                    version: (docToSupersede?.version || 0) + 1,
                    replaces_document_id: docToSupersede?.id || null,
                    requer_assinatura: SIGNATURE_TIPOS.includes(tipo),
                })
                .select()
                .single();

            if (dbError) {
                showToast('Erro ao salvar', `${file.name} foi enviado mas não foi possível salvar os dados.`, 'error');
                continue;
            }

            if (docToSupersede) {
                await sb.from('documents').update({ is_current: false }).eq('id', docToSupersede.id);
                docToSupersede.is_current = false;
            }

            rhDocs.unshift(inserted);
            if (finalEmpId) deliveredIds.push(inserted.id);
            logAudit(docToSupersede ? 'substituido' : 'criado', inserted);
            docToSupersede = null;
            successCount++;
        }

        if (!successCount) return;

        if (returning) await approveDocs([returning.id]);

        if (deliveredIds.length) {
            sb.functions.invoke('send-document-push', { body: { document_ids: deliveredIds } }).catch((err) => {
                console.error('[Nexus] send-document-push:', err);
            });
        }

        activeTab = category;
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === category));
        closeUploadModal();
        renderTable();
        if (returning) {
            showToast('Devolvido ao colaborador', `${returning.tipo} preenchido e assinado foi enviado para ${empName(returning.employee_id)}.`, 'success');
            return;
        }
        showToast(
            'Arquivos carregados com sucesso',
            `${successCount} arquivo${successCount > 1 ? 's' : ''} adicionado${successCount > 1 ? 's' : ''}.`,
            'success'
        );
    };

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        closeUploadModal();
        closeHistoryModal();
        closeAuditModal();
        closeRequirementsModal();
        closeNotifPanel();
    });

    sb.channel('documents-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, async () => {
            await loadData();
            renderTable();
        })
        .subscribe();

    function confirmDelete(count) {
        const msg =
            count > 1
                ? `Deseja realmente excluir os ${count} arquivos selecionados? Esta ação não pode ser desfeita.`
                : 'Deseja realmente excluir este arquivo? Esta ação não pode ser desfeita.';
        return window.confirm(msg);
    }

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

    await loadData();

    const purgedCount = await runLgpdPurge();
    if (purgedCount > 0) {
        await loadData();
        showToast(
            'Expurgo automático LGPD',
            `${purgedCount} documento${purgedCount > 1 ? 's' : ''} com prazo de guarda vencido ${purgedCount > 1 ? 'foram removidos' : 'foi removido'} automaticamente.`,
            'warning'
        );
    }

    const params = new URLSearchParams(window.location.search);
    const colabParam = params.get('colaborador');
    if (colabParam) {
        const emp = employees.find((e) => e.id === colabParam) || terminatedEmployees.find((e) => e.id === colabParam);
        filterEmployeeId = colabParam;
        if (emp && searchInput) {
            searchInput.value = emp.name;
            searchClear?.classList.remove('hidden');
        }
    }

    renderTable();
});
