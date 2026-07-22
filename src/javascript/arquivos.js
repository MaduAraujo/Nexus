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

    const RETENTION_YEARS = {
        'Contrato de Trabalho': 30,
        'Termo de Rescisão': 30,
        Homologação: 30,
        'Guia FGTS': 30,
        'Carteira de Trabalho': 30,
        'Exame Admissional': 20,
        'Exame Demissional': 20,
        'Aviso Prévio': 5,
        RG: 5,
        CPF: 5,
        'Comprovante de Residência': 5,
    };
    const DEFAULT_RETENTION_YEARS = 5;

    const SIGNATURE_TIPOS = ['Contrato de Trabalho', 'Termo de Rescisão', 'Aviso Prévio', 'Homologação'];

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
            operator_name: 'Administrador',
            operator_email: user.email,
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
                operator_name: 'Sistema (expurgo automático LGPD)',
                operator_email: 'sistema@nexus',
            });
        }
        return expired.length;
    }

    async function loadData() {
        const [{ data: empData }, { data: termData }, { data: docData }, { data: reqData }] = await Promise.all([
            sb.from('employees').select('id,name,dept').neq('status', 'Inativo').order('name'),
            sb.from('employees').select('id,name,dept').eq('status', 'Inativo').order('name'),
            sb.from('documents').select('*').order('created_at', { ascending: false }),
            sb.from('document_requirements').select('*').eq('obrigatorio', true),
        ]);
        employees = empData || [];
        terminatedEmployees = termData || [];
        requirements = reqData || [];
        const all = docData || [];
        rhDocs = all.filter((d) => d.source === 'Administrador');
        colabDocs = all.filter((d) => d.source === 'colaborador');
        populateDeptFilter();
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
        filterDept.innerHTML = '<option value="">Todos os departamentos</option>' + depts.map((d) => `<option value="${d}">${d}</option>`).join('');
        if (depts.includes(current)) filterDept.value = current;
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
        return `<span class="badge ${info.cls}">${info.label}</span>`;
    }

    function versionBadge(doc) {
        return doc.version > 1 ? `<span class="badge badge--version" title="Substituiu uma versão anterior">v${doc.version}</span>` : '';
    }

    function historyBtn(doc) {
        if (!(doc.version > 1)) return '';
        return `<button class="btn-icon btn-icon--history" title="Ver histórico de versões" onclick="showVersionHistory('${doc.id}')"><i class="fas fa-clock-rotate-left"></i></button>`;
    }

    function signBadge(doc) {
        if (!doc.requer_assinatura) return '';
        if (doc.assinado_em)
            return `<span class="badge badge--assinado" title="Assinado por ${doc.assinado_por || '—'} em ${fmtDate(doc.assinado_em)}"><i class="fas fa-signature"></i> Assinado</span>`;
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

    function checkboxCell(id) {
        return `<td class="col-check"><input type="checkbox" class="row-check" data-id="${id}" ${selectedIds.has(id) ? 'checked' : ''}></td>`;
    }

    function renderTable() {
        const q = searchInput?.value.toLowerCase().trim() || '';
        updateStats();
        renderChecklistBanner();
        renderNotifPanel();

        if (activeTab === 'colaborador') {
            filterStatus?.classList.remove('hidden');
            const current = colabDocs.filter((d) => d.is_current !== false);
            const filtered = current.filter((d) => {
                if (filterStatus?.value && d.status !== filterStatus.value) return false;
                if (!passesCommonFilters(d)) return false;
                if (!q) return true;
                return (d.name || '').toLowerCase().includes(q) || empName(d.employee_id).toLowerCase().includes(q) || (d.tipo || '').toLowerCase().includes(q);
            });
            updateBulkBar(filtered.map((d) => d.id));
            if (!filtered.length) {
                filesTbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-users"></i></div><p class="empty-state-title">Nenhum documento de colaborador</p><p class="empty-state-desc">${q ? `Nenhum resultado para "${q}"` : 'Colaboradores ainda não enviaram documentos'}</p></div></td></tr>`;
                return;
            }
            filesTbody.innerHTML = filtered
                .map((d) => {
                    const { cls, icon } = getFileIcon(d.name);
                    const st = statusMap[d.status] || statusMap.pendente;
                    return `<tr>
                    ${checkboxCell(d.id)}
                    <td><div class="file-name-cell"><div class="file-icon ${cls}"><i class="fas ${icon}"></i></div><div><div class="file-name" title="${esc(d.name)}">${esc(d.name)}</div><div class="file-meta">${esc(d.tipo) || ''} ${versionBadge(d)}</div></div></div></td>
                    <td>${empName(d.employee_id)}</td>
                    <td><span class="badge ${st.cls}"><i class="fas ${st.icon}"></i> ${st.label}</span></td>
                    <td class="file-date">${fmtDate(d.created_at)}</td>
                    <td class="file-size">${d.size_label || '—'}</td>
                    <td>${validadeCell(d.data_validade)}</td>
                    <td><div class="actions-cell">
                        <button class="btn-icon btn-icon--approve" title="Aprovar"  onclick="approveColabDoc('${d.id}')"><i class="fas fa-check"></i></button>
                        <button class="btn-icon btn-icon--reject"  title="Recusar"  onclick="rejectColabDoc('${d.id}')"><i class="fas fa-times"></i></button>
                        ${historyBtn(d)}
                        <button class="btn-icon btn-icon--delete"  title="Excluir"  onclick="deleteColabDoc('${d.id}','${d.storage_path || ''}')"><i class="fas fa-trash"></i></button>
                    </div></td>
                </tr>`;
                })
                .join('');
            return;
        }

        filterStatus?.classList.add('hidden');
        const filtered = rhDocs.filter((f) => {
            if (f.category !== activeTab) return false;
            if (f.is_current === false) return false;
            if (!passesCommonFilters(f)) return false;
            if (!q) return true;
            return (f.name || '').toLowerCase().includes(q) || empName(f.employee_id).toLowerCase().includes(q) || (f.tipo || '').toLowerCase().includes(q);
        });
        updateBulkBar(filtered.map((f) => f.id));

        if (!filtered.length) {
            filesTbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-folder-open"></i></div><p class="empty-state-title">Nenhum arquivo encontrado</p><p class="empty-state-desc">${q ? `Nenhum resultado para "${q}"` : 'Clique em "Enviar Arquivo" para adicionar'}</p></div></td></tr>`;
            return;
        }

        filesTbody.innerHTML = filtered
            .map((f) => {
                const { cls, icon } = getFileIcon(f.name);
                const badgeCls = f.category === 'admissional' ? 'badge--admissional' : 'badge--demissional';
                const badgeLabel = f.category === 'admissional' ? 'Admissional' : 'Demissional';
                return `<tr>
                ${checkboxCell(f.id)}
                <td><div class="file-name-cell"><div class="file-icon ${cls}"><i class="fas ${icon}"></i></div><div><div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="file-meta">${esc(f.tipo) || ''} ${versionBadge(f)} ${signBadge(f)}</div></div></div></td>
                <td>${empName(f.employee_id)}</td>
                <td><span class="badge ${badgeCls}">${badgeLabel}</span></td>
                <td class="file-date">${fmtDate(f.created_at)}</td>
                <td class="file-size">${f.size_label || '—'}</td>
                <td>${validadeCell(f.data_validade)}</td>
                <td><div class="actions-cell">
                    <button class="btn-icon btn-icon--view"   title="Visualizar" onclick="viewFile('${f.id}','${f.storage_path || ''}')"><i class="fas fa-eye"></i></button>
                    ${historyBtn(f)}
                    <button class="btn-icon btn-icon--delete" title="Excluir"    onclick="deleteFile('${f.id}','${f.storage_path || ''}')"><i class="fas fa-trash"></i></button>
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
        const reqTipos = requirements.filter((r) => r.category === category).map((r) => r.tipo);
        if (!reqTipos.length) return [];
        const pool = category === 'admissional' ? employees : terminatedEmployees;
        return pool
            .map((emp) => {
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
                <span class="checklist-row-name">${p.emp.name}</span>
                ${p.missing.map((t) => `<button type="button" class="checklist-chip" onclick="openUploadModal('${p.emp.id}','${activeTab}','${t.replace(/'/g, "\\'")}')"><i class="fas fa-plus"></i> ${t}</button>`).join('')}
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
                items.push({ type, docId: d.id, category: d.category || 'colaborador', label: `${d.name} — ${info.label.toLowerCase()}` });
            }
        });
        colabDocs
            .filter((d) => d.status === 'recusado' && d.is_current !== false)
            .forEach((d) => {
                items.push({ type: 'recusado', docId: d.id, category: 'colaborador', label: `${d.name} foi recusado — aguardando reenvio` });
            });
        rhDocs
            .filter((d) => d.requer_assinatura && !d.assinado_em && d.is_current !== false)
            .forEach((d) => {
                items.push({ type: 'assinatura', docId: d.id, category: d.category, label: `${d.name} aguardando assinatura de ${empName(d.employee_id)}` });
            });
        return items;
    }

    function renderNotifPanel() {
        if (!notifBadge || !notifPanelBody) return;
        const items = buildNotifications();
        const checklistCount = computeChecklistPending('admissional').length + computeChecklistPending('demissional').length;
        const total = items.length + checklistCount;

        notifBadge.textContent = total > 99 ? '99+' : String(total);
        notifBadge.classList.toggle('hidden', total === 0);

        if (!total) {
            notifPanelBody.innerHTML = `<div class="notif-empty"><i class="fas fa-circle-check"></i><p>Nenhuma pendência no momento</p></div>`;
            return;
        }

        const iconMap = { vencido: 'fa-triangle-exclamation', avencer: 'fa-clock', recusado: 'fa-times-circle', assinatura: 'fa-pen-nib' };
        const rows = [];
        if (checklistCount) {
            rows.push(`<div class="notif-item" onclick="closeNotifPanel()">
                <div class="notif-item-icon notif-item-icon--checklist"><i class="fas fa-clipboard-list"></i></div>
                <div class="notif-item-body">
                    <span class="notif-item-title">${checklistCount} colaborador${checklistCount > 1 ? 'es' : ''} com documentos obrigatórios pendentes</span>
                    <span class="notif-item-sub">Veja o checklist nas abas Admissional/Demissional</span>
                </div>
            </div>`);
        }
        items.slice(0, 25).forEach((it) => {
            rows.push(`<div class="notif-item" onclick="goToNotifItem('${it.docId}','${it.category}')">
                <div class="notif-item-icon notif-item-icon--${it.type}"><i class="fas ${iconMap[it.type]}"></i></div>
                <div class="notif-item-body"><span class="notif-item-title">${it.label}</span></div>
            </div>`);
        });
        notifPanelBody.innerHTML = rows.join('');
    }

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
            renderTable();
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

    [filterStatus, filterDept].forEach((el) => {
        el?.addEventListener('change', () => {
            updateFilterClearVisibility();
            renderTable();
        });
    });

    filterClearBtn?.addEventListener('click', () => {
        if (filterStatus) filterStatus.value = '';
        if (filterDept) filterDept.value = '';
        if (filterDateStart) filterDateStart.value = '';
        if (filterDateEnd) filterDateEnd.value = '';
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
                <button type="button" class="bulk-bar-btn bulk-bar-btn--success" onclick="bulkApproveColab()"><i class="fas fa-check"></i> Aprovar</button>
                <button type="button" class="bulk-bar-btn" onclick="bulkRejectColab()"><i class="fas fa-times"></i> Recusar</button>
                <button type="button" class="bulk-bar-btn bulk-bar-btn--danger" onclick="bulkDeleteColab()"><i class="fas fa-trash"></i> Excluir</button>`;
        } else {
            bulkBarActions.innerHTML = `
                <button type="button" class="bulk-bar-btn" onclick="bulkDownloadRh()"><i class="fas fa-download"></i> Baixar</button>
                <button type="button" class="bulk-bar-btn bulk-bar-btn--danger" onclick="bulkDeleteRh()"><i class="fas fa-trash"></i> Excluir</button>`;
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
        const ids = Array.from(selectedIds);
        const { error } = await sb.from('documents').update({ status: 'aprovado' }).in('id', ids);
        if (error) {
            showToast('Erro', 'Não foi possível aprovar os documentos selecionados.', 'error');
            return;
        }
        ids.forEach((id) => {
            const doc = colabDocs.find((d) => d.id === id);
            if (doc) {
                doc.status = 'aprovado';
                logAudit('aprovado', doc);
            }
        });
        selectedIds.clear();
        renderTable();
        showToast('Documentos aprovados!', `${ids.length} documento${ids.length > 1 ? 's' : ''} atualizado${ids.length > 1 ? 's' : ''}.`, 'success');
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
            const { data } = await sb.storage.from('documents').createSignedUrl(doc.storage_path, 3600);
            if (!data?.signedUrl) continue;
            try {
                const res = await fetch(data.signedUrl);
                const blob = await res.blob();
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
        const { error } = await sb.from('documents').update({ status: 'aprovado' }).eq('id', id);
        if (error) {
            showToast('Erro', 'Não foi possível aprovar o documento.', 'error');
            return;
        }
        const doc = colabDocs.find((d) => d.id === id);
        if (doc) doc.status = 'aprovado';
        renderTable();
        if (doc) logAudit('aprovado', doc);
        showToast('Documento aprovado!', 'O status foi atualizado para Aprovado.', 'success');
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
            showToast('Arquivo indisponível', 'Caminho do arquivo não encontrado.', 'warning');
            return;
        }
        const { data } = await sb.storage.from('documents').createSignedUrl(storagePath, 3600);
        if (data?.signedUrl) window.open(data.signedUrl, '_blank');
        const doc = rhDocs.concat(colabDocs).find((d) => d.id === id);
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
                    <span class="history-row-name">${d.name}</span>
                    <span class="history-row-meta">${fmtDate(d.created_at)} · ${d.size_label || '—'}</span>
                </div>
                ${d.storage_path ? `<button class="btn-icon btn-icon--view" title="Visualizar" onclick="viewFile('${d.id}','${d.storage_path}')"><i class="fas fa-eye"></i></button>` : ''}
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
                    <span class="audit-row-title"><b>${label}</b> — ${l.document_name}${emp !== '—' ? ` (${emp})` : ''}</span>
                    <span class="audit-row-meta">${l.operator_name || '—'} · ${when}</span>
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

    auditFilterAction?.addEventListener('change', renderAuditLog);

    function renderRequirementsGroup(category) {
        const container = document.getElementById(`requirements-${category}`);
        if (!container) return;
        const items = requirements.filter((r) => r.category === category);
        if (!items.length) {
            container.innerHTML = `<p class="requirements-empty">Nenhum tipo obrigatório cadastrado.</p>`;
            return;
        }
        container.innerHTML = items
            .map(
                (r) => `
            <span class="requirements-chip">${r.tipo}<button type="button" onclick="removeRequirement('${r.id}')" aria-label="Remover"><i class="fas fa-xmark"></i></button></span>
        `
            )
            .join('');
    }

    function renderRequirementsModal() {
        renderRequirementsGroup('admissional');
        renderRequirementsGroup('demissional');
    }

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
        const { data, error } = await sb.from('document_requirements').insert({ category, tipo, obrigatorio: true }).select().single();
        if (error) {
            showToast('Erro', 'Não foi possível adicionar — talvez esse tipo já esteja cadastrado.', 'error');
            return;
        }
        requirements.push(data);
        input.value = '';
        renderRequirementsModal();
        renderChecklistBanner();
        renderNotifPanel();
        showToast('Tipo adicionado', `"${tipo}" agora é obrigatório em ${category === 'admissional' ? 'Admissional' : 'Demissional'}.`, 'success');
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

    function populateEmployeeSelect() {
        const sel = document.getElementById('upload-employee-select') || document.getElementById('upload-employee');
        if (!sel) return;
        const isSelect = sel.tagName === 'SELECT';
        if (isSelect) {
            sel.innerHTML = '<option value="">Selecione o colaborador...</option>';
            employees.forEach((e) => {
                const opt = document.createElement('option');
                opt.value = e.id;
                opt.textContent = e.name;
                sel.appendChild(opt);
            });
        }
    }

    window.openUploadModal = (employeeId, category, tipo) => {
        uploadModal?.classList.add('open');
        document.body.style.overflow = 'hidden';
        populateEmployeeSelect();
        const empEl = document.getElementById('upload-employee-select') || document.getElementById('upload-employee');
        if (employeeId && empEl) empEl.value = employeeId;
        if (category && tipo) document.getElementById('upload-category').value = `${category}|${tipo}`;
    };
    window.closeUploadModal = () => {
        uploadModal?.classList.remove('open');
        document.body.style.overflow = '';
        const empEl = document.getElementById('upload-employee-select') || document.getElementById('upload-employee');
        if (empEl) empEl.value = '';
        document.getElementById('upload-category').value = '';
        if (uploadValidade) uploadValidade.value = '';
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
        if (!filesSelectedList) return;
        filesSelectedList.classList.toggle('hidden', selectedFiles.length === 0);
        dropZone?.classList.toggle('hidden', selectedFiles.length > 0);
        filesSelectedList.innerHTML = selectedFiles
            .map(
                (f, i) => `
            <div class="file-selected-item">
                <div class="file-selected-icon"><i class="fas fa-file-circle-check"></i></div>
                <span>${f.name}</span>
                <button type="button" onclick="removeSelectedFile(${i})" aria-label="Remover arquivo"><i class="fas fa-xmark"></i></button>
            </div>`
            )
            .join('');
    }

    function addSelectedFiles(fileList) {
        const files = Array.from(fileList || []);
        let ocrCandidate = null;
        for (const file of files) {
            if (file.size > 50 * 1024 * 1024) {
                showToast('Arquivo muito grande!', `${file.name} ultrapassa o limite de 50 MB.`, 'warning');
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

            const select = document.getElementById('upload-category');
            const preferred = Array.from(select.options).find((o) => o.value === `${activeTab}|${found.tipo}`);
            const anyMatch = preferred || Array.from(select.options).find((o) => o.value.endsWith(`|${found.tipo}`));
            if (anyMatch && !select.value) {
                select.value = anyMatch.value;
                ocrHintText.textContent = `Tipo sugerido por OCR: "${found.tipo}" — confira antes de enviar.`;
            } else {
                ocrHintText.textContent = `Tipo sugerido por OCR: "${found.tipo}" — selecione manualmente na lista acima.`;
            }
        } catch {
            ocrHintText.textContent = 'Não foi possível analisar o documento automaticamente.';
        }
    }

    window.submitUpload = async () => {
        const empEl = document.getElementById('upload-employee-select') || document.getElementById('upload-employee');
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
        const empId = empEl?.tagName === 'SELECT' ? empEl.value || null : null;
        const empInput = empEl?.tagName === 'INPUT' ? empEl.value.trim() : null;
        const lookupEmp = empInput ? employees.find((e) => e.name.toLowerCase() === empInput.toLowerCase()) : null;
        const finalEmpId = empId || lookupEmp?.id || null;

        let docToSupersede = finalEmpId
            ? rhDocs.find((d) => d.employee_id === finalEmpId && d.category === category && d.tipo === tipo && d.is_current !== false)
            : null;

        let successCount = 0;
        for (const file of selectedFiles) {
            const sizeKB = Math.round(file.size / 1024);
            const sizeLabel = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
            const storagePath = `rh/${Date.now()}_${file.name.replace(/\s/g, '_')}`;

            const { error: uploadError } = await sb.storage.from('documents').upload(storagePath, file);
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
            logAudit(docToSupersede ? 'substituido' : 'criado', inserted);
            docToSupersede = null;
            successCount++;
        }

        if (!successCount) return;

        activeTab = category;
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-tab') === category));
        closeUploadModal();
        renderTable();
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
        toast.innerHTML = `<div class="toast-icon"><i class="fas ${icons[type] || 'fa-check'}"></i></div><div class="toast-content"><p class="toast-title">${title}</p><p class="toast-msg">${msg}</p></div><button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),400)"><i class="fas fa-times"></i></button>`;
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
