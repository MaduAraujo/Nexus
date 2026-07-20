document.addEventListener('DOMContentLoaded', async () => {
    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');
    const messageInput   = document.getElementById('message-text');
    const editMessageText = document.getElementById('edit-message-text');
    const mainToggleBtn  = document.getElementById('main-toggle-btn');
    const fabBtn         = document.getElementById('btn-fab');
    const backBtn        = document.getElementById('btn-back');
    const sectionWrite   = document.getElementById('write-section');
    const sectionHistory = document.getElementById('sent-messages-section');
    const messagesList   = document.getElementById('messages-list');
    const messagesCards  = document.getElementById('messages-cards');
    const sendBtn        = document.getElementById('send-btn');
    const charCount      = document.getElementById('char-count');
    const searchInput    = document.getElementById('search-input');
    const attachBtn       = document.getElementById('attach-btn');
    const attachInput     = document.getElementById('attach-input');
    const attachChips     = document.getElementById('attach-chips');
    const scheduleToggle  = document.getElementById('schedule-toggle');
    const schedulePicker  = document.getElementById('schedule-picker');
    const scheduleCalTitle = document.getElementById('schedule-calendar-title');
    const scheduleCalGrid  = document.getElementById('schedule-calendar-grid');
    const scheduleCalPrev  = document.getElementById('schedule-calendar-prev');
    const scheduleCalNext  = document.getElementById('schedule-calendar-next');
    const scheduleTimeInput   = document.getElementById('schedule-time-input');
    const scheduleSummary     = document.getElementById('schedule-summary');
    const scheduleSummaryText = document.getElementById('schedule-summary-text');
    const scheduleSummaryEdit = document.getElementById('schedule-summary-edit');
    const catInlineGrid   = document.getElementById('cat-inline-grid');
    const categoryFilters = document.getElementById('category-filters');
    const templatesToggleBtn  = document.getElementById('templates-toggle-btn');
    const templatesMenu       = document.getElementById('templates-menu');
    const templatesMenuList   = document.getElementById('templates-menu-list');
    const templatesSaveBtn    = document.getElementById('templates-save-btn');
    const templateNameInput   = document.getElementById('template-name-input');
    const draftBanner       = document.getElementById('draft-banner');
    const draftBannerText   = document.getElementById('draft-banner-text');
    const draftBannerDiscard = document.getElementById('draft-banner-discard');
    const draftStatus       = document.getElementById('draft-status');

    const auth = await NexusAuth.requireProfile('Administrador');
    if (!auth) return;

    const nameEl   = document.getElementById('rh-sidebar-name');
    const roleEl   = document.getElementById('rh-sidebar-role');
    const avatarEl = document.getElementById('rh-sidebar-avatar');
    if (nameEl)   nameEl.textContent   = 'Administrador';
    if (roleEl)   roleEl.textContent   = 'Recursos Humanos';
    if (avatarEl) avatarEl.textContent = 'ADM';

    window.logout = async () => { await sb.auth.signOut(); window.location.href = '../screens/login.html'; };

    let dbMensagens    = [];
    let dbEmployees    = [];
    let readCountMap   = {};
    let histFilter     = 'todos';
    let histCatFilter  = 'todas';
    let searchQuery    = '';
    let selectedDest   = null;
    let selectedCategory = 'Institucional';
    let currentSection = 'writing';
    let stagedFiles    = [];
    let templates      = [];
    let draftSaveTimer = null;
    let suppressDraftSave = false;

    const DRAFT_KEY = 'nexus_comunicado_draft';

    const CATEGORIA_INFO = {
        'Urgente':       { icon: 'fa-triangle-exclamation', cls: 'cat--urgente' },
        'Institucional': { icon: 'fa-building-columns',     cls: 'cat--institucional' },
        'Benefícios':    { icon: 'fa-gift',                 cls: 'cat--beneficios' },
        'Evento':        { icon: 'fa-star',                 cls: 'cat--evento' },
        'Política':      { icon: 'fa-scale-balanced',       cls: 'cat--politica' },
    };
    const categoriaBadge = (cat) => {
        const info = CATEGORIA_INFO[cat] || CATEGORIA_INFO['Institucional'];
        return `<span class="badge-cat ${info.cls}"><i class="fas ${info.icon}"></i> ${escHTML(cat)}</span>`;
    };

    const DEPT_LABELS = {
        'TI':             'Tecnologia da Informação',
        'RH':             'Recursos Humanos',
        'Financeiro':     'Financeiro',
        'Marketing':      'Marketing',
        'Jurídico':       'Jurídico',
        'Administrativo': 'Administrativo',
    };
    const deptLabel = (dept) => DEPT_LABELS[dept] || dept || 'Sem departamento';

    const MAX_FILE_SIZE  = 10 * 1024 * 1024;
    const MAX_FILES      = 5;
    const ALLOWED_TYPES  = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    const fmtSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
    const fileIcon = (type) => type === 'application/pdf' ? 'fa-file-pdf' : type.startsWith('image/') ? 'fa-file-image' : 'fa-file';

    function renderAttachChips() {
        if (!attachChips) return;
        attachChips.innerHTML = stagedFiles.map((f, i) => `
            <span class="attach-chip">
                <i class="fas ${fileIcon(f.type)}"></i>
                <span class="attach-chip-name" title="${f.name}">${f.name}</span>
                <span class="attach-chip-size">${fmtSize(f.size)}</span>
                <button type="button" class="attach-chip-remove" data-idx="${i}" aria-label="Remover"><i class="fas fa-times"></i></button>
            </span>`).join('');
    }

    attachBtn?.addEventListener('click', () => attachInput?.click());

    attachInput?.addEventListener('change', () => {
        for (const file of attachInput.files) {
            if (stagedFiles.length >= MAX_FILES) break;
            if (!ALLOWED_TYPES.includes(file.type)) continue;
            if (file.size > MAX_FILE_SIZE) continue;
            stagedFiles.push(file);
        }
        attachInput.value = '';
        renderAttachChips();
    });

    attachChips?.addEventListener('click', (e) => {
        const btn = e.target.closest('.attach-chip-remove');
        if (!btn) return;
        stagedFiles.splice(Number(btn.dataset.idx), 1);
        renderAttachChips();
    });

    // ─── Calendário de agendamento (mesmo padrão visual do painel) ──
    const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const today = new Date();
    let calViewYear    = today.getFullYear();
    let calViewMonth   = today.getMonth();
    let calSelectedDay = null;
    let selectedScheduleDate = null;

    function renderScheduleCalendar() {
        if (!scheduleCalTitle || !scheduleCalGrid) return;
        scheduleCalTitle.textContent = `${MESES_PT[calViewMonth]} ${calViewYear}`;

        const isPastMonth = calViewYear === today.getFullYear() && calViewMonth === today.getMonth();
        if (scheduleCalPrev) scheduleCalPrev.disabled = isPastMonth;

        const startOffset     = new Date(calViewYear, calViewMonth, 1).getDay();
        const daysInMonth     = new Date(calViewYear, calViewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(calViewYear, calViewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday    = d === today.getDate() && calViewMonth === today.getMonth() && calViewYear === today.getFullYear();
            const isPast     = new Date(calViewYear, calViewMonth, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const isSelected = calSelectedDay && calSelectedDay.day === d && calSelectedDay.month === calViewMonth && calSelectedDay.year === calViewYear;
            cells.push({ day: d, muted: false, isToday, isPast, isSelected });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        scheduleCalGrid.innerHTML = cells.map(c => `<button type="button"
            class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}${c.isSelected ? ' calendar-day--selected' : ''}${c.isPast ? ' calendar-day--past' : ''}"
            ${c.muted || c.isPast ? 'disabled' : `data-day="${c.day}"`}>${c.day}</button>`).join('');
    }

    function updateSelectedScheduleDate() {
        if (!calSelectedDay || !scheduleTimeInput?.value) { selectedScheduleDate = null; return; }
        const [h, m] = scheduleTimeInput.value.split(':').map(Number);
        selectedScheduleDate = new Date(calSelectedDay.year, calSelectedDay.month, calSelectedDay.day, h, m);
    }

    function trySealSchedule() {
        updateSelectedScheduleDate();
        if (selectedScheduleDate && selectedScheduleDate > new Date()) {
            schedulePicker?.classList.add('hidden');
            if (scheduleSummaryText) scheduleSummaryText.textContent = selectedScheduleDate.toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            scheduleSummary?.classList.remove('hidden');
        }
        checkSendReady();
    }

    scheduleCalPrev?.addEventListener('click', () => {
        calViewMonth--; if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
        renderScheduleCalendar();
    });
    scheduleCalNext?.addEventListener('click', () => {
        calViewMonth++; if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
        renderScheduleCalendar();
    });

    scheduleCalGrid?.addEventListener('click', (e) => {
        const btn = e.target.closest('.calendar-day');
        if (!btn || btn.disabled) return;
        calSelectedDay = { day: Number(btn.dataset.day), month: calViewMonth, year: calViewYear };
        renderScheduleCalendar();
        trySealSchedule();
    });

    scheduleTimeInput?.addEventListener('input', trySealSchedule);

    scheduleSummaryEdit?.addEventListener('click', () => {
        scheduleSummary?.classList.add('hidden');
        schedulePicker?.classList.remove('hidden');
        renderScheduleCalendar();
    });

    function resetSchedulePicker() {
        calSelectedDay = null;
        selectedScheduleDate = null;
        if (scheduleTimeInput) scheduleTimeInput.value = '';
        schedulePicker?.classList.add('hidden');
        scheduleSummary?.classList.add('hidden');
    }

    scheduleToggle?.addEventListener('change', () => {
        if (scheduleToggle.checked) {
            schedulePicker?.classList.remove('hidden');
            scheduleSummary?.classList.add('hidden');
            renderScheduleCalendar();
        } else {
            resetSchedulePicker();
        }
        if (sendBtn) sendBtn.innerHTML = scheduleToggle.checked
            ? 'Agendar'
            : 'Enviar';
        checkSendReady();
    });

    const destToggleBtn  = document.getElementById('dest-toggle-btn');
    const destInlineGrid = document.getElementById('dest-inline-grid');

    function closeDestDropdown() {
        destInlineGrid?.classList.add('hidden');
        destToggleBtn?.classList.remove('open');
        destToggleBtn?.setAttribute('aria-expanded', 'false');
    }

    function closeCatDropdown() {
        catInlineGrid?.classList.add('hidden');
        catToggleBtn?.classList.remove('open');
        catToggleBtn?.setAttribute('aria-expanded', 'false');
    }

    destToggleBtn?.addEventListener('click', () => {
        const willOpen = destInlineGrid?.classList.contains('hidden');
        closeCatDropdown();
        if (willOpen) {
            destInlineGrid?.classList.remove('hidden');
            destToggleBtn.classList.add('open');
            destToggleBtn.setAttribute('aria-expanded', 'true');
        } else {
            closeDestDropdown();
        }
    });

    document.querySelectorAll('#dest-inline-grid .dest-inline-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#dest-inline-grid .dest-inline-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            selectedDest = chip.dataset.dest;
            checkSendReady();
            scheduleDraftSave();
        });
    });

    const catToggleBtn  = document.getElementById('cat-toggle-btn');

    catToggleBtn?.addEventListener('click', () => {
        const willOpen = catInlineGrid?.classList.contains('hidden');
        closeDestDropdown();
        if (willOpen) {
            catInlineGrid?.classList.remove('hidden');
            catToggleBtn.classList.add('open');
            catToggleBtn.setAttribute('aria-expanded', 'true');
        } else {
            closeCatDropdown();
        }
    });

    document.querySelectorAll('#cat-inline-grid .cat-inline-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.cat === selectedCategory);
        chip.addEventListener('click', () => {
            document.querySelectorAll('#cat-inline-grid .cat-inline-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            selectedCategory = chip.dataset.cat;
            scheduleDraftSave();
        });
    });

    // ─── Barra de formatação (negrito, lista, link) — editor rico ──
    function normalizeEmptyEditor(editor) {
        if (editor && (editor.innerHTML === '<br>' || editor.innerHTML === '<div><br></div>')) editor.innerHTML = '';
    }

    function insertLink(editor) {
        const sel = window.getSelection();
        const hasSelection = !!(sel && sel.rangeCount && !sel.isCollapsed && editor.contains(sel.anchorNode));
        const defaultText = hasSelection ? sel.toString() : '';

        // Captura o range agora: o prompt() nativo costuma limpar a seleção
        // viva da página enquanto está aberto, então não dá para confiar em
        // sel.getRangeAt(0) depois de chamá-lo.
        let savedRange = null;
        if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
            savedRange = sel.getRangeAt(0).cloneRange();
        }

        const url = prompt('Endereço do link (https://...)');
        if (!url) return;
        const trimmedUrl = url.trim();
        if (!/^https?:\/\//i.test(trimmedUrl)) { alert('Use um link começando com http:// ou https://'); return; }

        const text = defaultText || prompt('Texto do link:', trimmedUrl) || trimmedUrl;

        editor.focus();
        const a = document.createElement('a');
        a.href = trimmedUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = text;

        let range = savedRange;
        if (!range) {
            range = document.createRange();
            range.selectNodeContents(editor);
            range.collapse(false);
        } else if (hasSelection) {
            range.deleteContents();
        }
        range.insertNode(a);
        range.setStartAfter(a);
        range.setEndAfter(a);

        const activeSel = window.getSelection();
        activeSel.removeAllRanges();
        activeSel.addRange(range);
    }

    function execFormat(editor, type) {
        if (!editor) return;
        editor.focus();
        if (type === 'bold') {
            document.execCommand('bold');
        } else if (type === 'list') {
            document.execCommand('insertUnorderedList');
        } else if (type === 'link') {
            insertLink(editor);
        } else {
            return;
        }
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function handlePlainTextPaste(e) {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
    }

    function refreshToolbarState(toolbarId) {
        const toolbar = document.getElementById(toolbarId);
        if (!toolbar) return;
        toolbar.querySelectorAll('.format-btn[data-format]').forEach(btn => {
            const type = btn.dataset.format;
            if (type === 'link') { btn.classList.remove('active'); return; }
            const cmd = type === 'bold' ? 'bold' : 'insertUnorderedList';
            let active = false;
            try { active = document.queryCommandState(cmd); } catch { active = false; }
            btn.classList.toggle('active', active);
        });
    }

    document.querySelectorAll('#format-toolbar .format-btn[data-format]').forEach(btn => {
        btn.addEventListener('click', () => { execFormat(messageInput, btn.dataset.format); refreshToolbarState('format-toolbar'); });
    });
    document.querySelectorAll('#edit-format-toolbar .format-btn[data-format]').forEach(btn => {
        btn.addEventListener('click', () => { execFormat(editMessageText, btn.dataset.format); refreshToolbarState('edit-format-toolbar'); });
    });

    messageInput?.addEventListener('paste', handlePlainTextPaste);
    editMessageText?.addEventListener('paste', handlePlainTextPaste);

    ['keyup', 'mouseup', 'focus'].forEach(evt => {
        messageInput?.addEventListener(evt, () => refreshToolbarState('format-toolbar'));
        editMessageText?.addEventListener(evt, () => refreshToolbarState('edit-format-toolbar'));
    });

    messageInput?.addEventListener('input', () => {
        normalizeEmptyEditor(messageInput);
        const len = messageInput.textContent.length;
        if (charCount) charCount.textContent = `${len} caractere${len !== 1 ? 's' : ''}`;
        checkSendReady();
        checkTemplateSaveReady();
        scheduleDraftSave();
    });

    function checkSendReady() {
        const scheduleOk = !scheduleToggle?.checked || !!selectedScheduleDate;
        if (sendBtn) sendBtn.disabled = !(messageInput?.textContent.trim() && scheduleOk);
    }

    // ─── Rascunho automático (localStorage) ──────────────────────
    function saveDraftToStorage() {
        try {
            if (suppressDraftSave) return;
            const plainText = messageInput?.textContent || '';
            if (!plainText.trim() && !selectedDest) { localStorage.removeItem(DRAFT_KEY); updateDraftStatus(null); return; }
            const html = sanitizeComunicadoHTML(messageInput?.innerHTML || '');
            const draft = { html, destino: selectedDest, categoria: selectedCategory, savedAt: new Date().toISOString() };
            localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
            updateDraftStatus(draft.savedAt);
        } catch (err) {
            console.error('[Nexus] draft save:', err);
        }
    }

    function scheduleDraftSave() {
        clearTimeout(draftSaveTimer);
        draftSaveTimer = setTimeout(saveDraftToStorage, 800);
    }

    function clearDraftStorage() {
        localStorage.removeItem(DRAFT_KEY);
        updateDraftStatus(null);
        draftBanner?.classList.add('hidden');
    }

    function updateDraftStatus(savedAtIso) {
        if (!draftStatus) return;
        if (!savedAtIso) { draftStatus.textContent = ''; return; }
        const time = new Date(savedAtIso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        draftStatus.textContent = `Rascunho salvo às ${time}`;
    }

    function loadDraftFromStorage() {
        try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; }
    }

    function tryRestoreDraft() {
        try {
            const draft = loadDraftFromStorage();
            const plainText = draft ? comunicadoPlainText(draft.html || '') : '';
            if (!draft || (!plainText.trim() && !draft.destino)) return;

            suppressDraftSave = true;
            if (messageInput) messageInput.innerHTML = sanitizeComunicadoHTML(draft.html || '');
            const len = plainText.length;
            if (charCount) charCount.textContent = `${len} caractere${len !== 1 ? 's' : ''}`;
            if (draft.destino) {
                selectedDest = draft.destino;
                document.querySelectorAll('#dest-inline-grid .dest-inline-chip').forEach(c => c.classList.toggle('active', c.dataset.dest === draft.destino));
            }
            selectedCategory = draft.categoria || 'Institucional';
            document.querySelectorAll('#cat-inline-grid .cat-inline-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === selectedCategory));
            checkSendReady();
            checkTemplateSaveReady();
            suppressDraftSave = false;

            if (draftBanner && draftBannerText) {
                const time = new Date(draft.savedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
                draftBannerText.textContent = `Rascunho de ${time} restaurado automaticamente.`;
                draftBanner.classList.remove('hidden');
            }
            updateDraftStatus(draft.savedAt);
        } catch (err) {
            console.error('[Nexus] draft restore:', err);
            suppressDraftSave = false;
        }
    }

    draftBannerDiscard?.addEventListener('click', () => {
        clearDraftStorage();
        resetComposeForm();
    });

    // ─── Modelos salvos ───────────────────────────────────────────
    async function loadTemplates() {
        const { data } = await sb.from('message_templates').select('*').order('created_at', { ascending: false });
        templates = data || [];
        renderTemplatesList();
    }

    function renderTemplatesList() {
        if (!templatesMenuList) return;
        if (!templates.length) {
            templatesMenuList.innerHTML = `<p class="templates-empty">Nenhum modelo salvo ainda.</p>`;
            return;
        }
        templatesMenuList.innerHTML = templates.map(t => {
            const preview = escHTML(comunicadoPlainText(t.texto));
            return `
            <div class="template-item" data-id="${t.id}">
                <button type="button" class="template-item-apply" data-id="${t.id}">
                    <span class="template-item-name">${escHTML(t.nome)}</span>
                    <span class="template-item-preview" title="${preview}">${preview}</span>
                </button>
                <button type="button" class="template-item-delete" data-id="${t.id}" aria-label="Excluir modelo"><i class="fas fa-trash"></i></button>
            </div>`;
        }).join('');
    }

    function applyTemplate(t) {
        if (messageInput) messageInput.innerHTML = sanitizeComunicadoHTML(t.texto);
        const len = comunicadoPlainText(t.texto).length;
        if (charCount) charCount.textContent = `${len} caractere${len !== 1 ? 's' : ''}`;
        selectedDest = t.destino;
        document.querySelectorAll('#dest-inline-grid .dest-inline-chip').forEach(c => c.classList.toggle('active', c.dataset.dest === t.destino));
        selectedCategory = t.categoria || 'Institucional';
        document.querySelectorAll('#cat-inline-grid .cat-inline-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === selectedCategory));
        checkSendReady();
        checkTemplateSaveReady();
        draftBanner?.classList.add('hidden');
        scheduleDraftSave();
    }

    function checkTemplateSaveReady() {
        if (!templatesSaveBtn) return;
        templatesSaveBtn.disabled = !(messageInput?.textContent.trim() && templateNameInput?.value.trim());
    }

    templateNameInput?.addEventListener('input', checkTemplateSaveReady);

    templatesToggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = templatesMenu?.classList.toggle('hidden') === false;
        templatesToggleBtn.classList.toggle('open', open);
        templatesToggleBtn.setAttribute('aria-expanded', String(open));
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#templates-dropdown')) {
            templatesMenu?.classList.add('hidden');
            templatesToggleBtn?.classList.remove('open');
            templatesToggleBtn?.setAttribute('aria-expanded', 'false');
        }
    });

    templatesMenuList?.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('.template-item-delete');
        if (delBtn) {
            e.stopPropagation();
            const id = delBtn.dataset.id;
            const t = templates.find(t => t.id === id);
            if (!t || !confirm(`Excluir o modelo "${t.nome}"? Esta ação não pode ser desfeita.`)) return;
            await sb.from('message_templates').delete().eq('id', id);
            templates = templates.filter(t => t.id !== id);
            renderTemplatesList();
            return;
        }
        const applyBtn = e.target.closest('.template-item-apply');
        if (applyBtn) {
            const t = templates.find(t => t.id === applyBtn.dataset.id);
            if (t) applyTemplate(t);
            templatesMenu?.classList.add('hidden');
            templatesToggleBtn?.classList.remove('open');
            templatesToggleBtn?.setAttribute('aria-expanded', 'false');
        }
    });

    templatesSaveBtn?.addEventListener('click', async () => {
        const nome = templateNameInput?.value.trim();
        if (!messageInput?.textContent.trim() || !nome) return;
        const texto = sanitizeComunicadoHTML(messageInput.innerHTML);
        templatesSaveBtn.disabled = true;
        const { data, error } = await sb.from('message_templates')
            .insert({ nome, texto, destino: selectedDest || 'Todos', categoria: selectedCategory, created_by: user.id })
            .select()
            .single();
        if (error) { console.error('[Nexus] template save:', error); checkTemplateSaveReady(); return; }
        templates.unshift(data);
        renderTemplatesList();
        if (templateNameInput) templateNameInput.value = '';
        checkTemplateSaveReady();
    });

    sendBtn?.addEventListener('click', async () => {
        if (!messageInput?.textContent.trim()) return;
        const texto = sanitizeComunicadoHTML(messageInput.innerHTML);
        if (!selectedDest) {
            alert('Escolha um destino antes de enviar o comunicado.');
            destInlineGrid?.classList.remove('hidden');
            destToggleBtn?.classList.add('open');
            destToggleBtn?.setAttribute('aria-expanded', 'true');
            return;
        }

        let scheduledAt = null;
        if (scheduleToggle?.checked) {
            if (!selectedScheduleDate) return;
            if (selectedScheduleDate <= new Date()) {
                alert('Escolha uma data e hora futuras para o agendamento.');
                return;
            }
            scheduledAt = selectedScheduleDate;
        }

        sendBtn.disabled = true;
        const { data, error } = await sb
            .from('messages')
            .insert({ texto, destino: selectedDest, categoria: selectedCategory, created_by: user.id, scheduled_at: scheduledAt ? scheduledAt.toISOString() : null })
            .select()
            .single();
        if (error) { console.error('[Nexus] send:', error); sendBtn.disabled = false; return; }

        let anexos = [];
        if (stagedFiles.length) {
            const uploads = await Promise.all(stagedFiles.map(async (file) => {
                const path = `${data.id}/${Date.now()}_${file.name}`;
                const { error: upErr } = await sb.storage.from('message-attachments').upload(path, file, { contentType: file.type });
                return upErr ? null : { name: file.name, path, size: file.size, type: file.type };
            }));
            anexos = uploads.filter(Boolean);
            if (anexos.length) {
                await sb.from('messages').update({ anexos }).eq('id', data.id);
            }
            if (anexos.length < stagedFiles.length) {
                console.error('[Nexus] alguns anexos falharam ao enviar');
            }
        }
        data.anexos = anexos;

        dbMensagens.unshift(data);
        readCountMap[data.id] = 0;
        updateStats();
        clearDraftStorage();

        sendBtn.classList.add('sent-success');
        sendBtn.innerHTML = scheduledAt ? '<i class="fas fa-check"></i> Agendado!' : '<i class="fas fa-check"></i> Enviado!';
        setTimeout(() => {
            sendBtn.classList.remove('sent-success');
            resetComposeForm();
        }, 2200);
    });

    async function loadEmployees() {
        const { data } = await sb.from('employees').select('id, name, dept, status, avatar_color, avatar_url');
        dbEmployees = data || [];
    }

    async function loadMessages() {
        const [{ data: msgs }, { data: reads }] = await Promise.all([
            sb.from('messages').select('*').order('created_at', { ascending: false }),
            sb.from('message_reads').select('message_id'),
        ]);
        dbMensagens  = msgs || [];
        readCountMap = {};
        (reads || []).forEach(r => { readCountMap[r.message_id] = (readCountMap[r.message_id] || 0) + 1; });
        updateStats();
    }

    const isLive = (m) => !m.scheduled_at || new Date(m.scheduled_at) <= new Date();

    function updateStats() {
        const liveMsgs = dbMensagens.filter(isLive);
        const total  = liveMsgs.length;
        const reads  = liveMsgs.reduce((sum, m) => sum + (readCountMap[m.id] || 0), 0);
        const unread = liveMsgs.filter(m => !readCountMap[m.id]).length;
        const elTotal  = document.getElementById('stat-total');
        const elReads  = document.getElementById('stat-reads');
        const elUnread = document.getElementById('stat-unread');
        if (elTotal)  elTotal.textContent  = total;
        if (elReads)  elReads.textContent  = reads;
        if (elUnread) elUnread.textContent = unread;
    }

    const escHTML = (s)   => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const fmtDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');

    const isMobile  = () => window.innerWidth <= 768;
    const openSide  = () => { sidebar?.classList.add('open');    sidebarOverlay?.classList.add('active');    document.body.style.overflow = 'hidden'; };
    const closeSide = () => { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; };
    sidebarToggle?.addEventListener('click', e => {
        e.stopPropagation();
        if (isMobile()) {
            sidebar?.classList.contains('open') ? closeSide() : openSide();
        } else {
            const c = sidebar?.classList.toggle('collapsed');
            mainWrapper?.classList.toggle('sidebar-collapsed', c);
        }
    });
    topbarMenuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeSide() : openSide(); });
    sidebarOverlay?.addEventListener('click', closeSide);
    window.addEventListener('resize', () => { if (!isMobile()) closeSide(); });

    function switchToHistory() {
        currentSection = 'history';
        if (sectionWrite)   sectionWrite.style.display   = 'none';
        if (sectionHistory) sectionHistory.style.display = 'flex';
        if (mainToggleBtn) mainToggleBtn.style.display = 'none';
        if (fabBtn) fabBtn.style.display = 'none';
        clearTimeout(draftSaveTimer);
        saveDraftToStorage();
        renderizarMensagens();
    }

    function resetComposeForm() {
        if (messageInput) messageInput.innerHTML = '';
        if (charCount) charCount.textContent = '0 caracteres';
        document.querySelectorAll('#dest-inline-grid .dest-inline-chip').forEach(c => c.classList.remove('active'));
        selectedDest = null;
        destInlineGrid?.classList.add('hidden');
        destToggleBtn?.classList.remove('open');
        destToggleBtn?.setAttribute('aria-expanded', 'false');
        selectedCategory = 'Institucional';
        document.querySelectorAll('#cat-inline-grid .cat-inline-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === selectedCategory));
        catInlineGrid?.classList.add('hidden');
        catToggleBtn?.classList.remove('open');
        catToggleBtn?.setAttribute('aria-expanded', 'false');
        stagedFiles = [];
        renderAttachChips();
        if (scheduleToggle) scheduleToggle.checked = false;
        resetSchedulePicker();
        if (sendBtn) sendBtn.innerHTML = 'Enviar';
        if (templateNameInput) templateNameInput.value = '';
        checkSendReady();
        checkTemplateSaveReady();
        draftBanner?.classList.add('hidden');
        tryRestoreDraft();
    }

    function switchToWriting() {
        currentSection = 'writing';
        if (sectionWrite)   sectionWrite.style.display   = 'flex';
        if (sectionHistory) sectionHistory.style.display = 'none';
        if (mainToggleBtn) {
            mainToggleBtn.style.display = '';
            const i = mainToggleBtn.querySelector('i');
            if (i) i.className = 'fas fa-history';
            mainToggleBtn.setAttribute('aria-label', 'Comunicados Enviados');
            mainToggleBtn.setAttribute('title', 'Comunicados Enviados');
        }
        if (fabBtn) { fabBtn.style.display = ''; fabBtn.innerHTML = '<i class="fas fa-history"></i>'; }
        resetComposeForm();
    }

    mainToggleBtn?.addEventListener('click', () => currentSection === 'writing' ? switchToHistory() : switchToWriting());
    fabBtn?.addEventListener('click',        () => currentSection === 'writing' ? switchToHistory() : switchToWriting());

    backBtn?.addEventListener('click', (e) => {
        if (currentSection === 'history') {
            e.preventDefault();
            switchToWriting();
        }
    });

    window.setHistFilter = function (btn) {
        document.querySelectorAll('#history-filters .hist-chip').forEach(c => c.classList.remove('hist-chip--active'));
        btn.classList.add('hist-chip--active');
        histFilter = btn.dataset.dest;
        renderizarMensagens();
    };

    window.setCatFilter = function (btn) {
        document.querySelectorAll('#category-filters .hist-chip').forEach(c => c.classList.remove('hist-chip--active'));
        btn.classList.add('hist-chip--active');
        histCatFilter = btn.dataset.cat;
        renderizarMensagens();
    };

    const histToggleBtn  = document.getElementById('hist-toggle-btn');
    const historyFilters = document.getElementById('history-filters');

    histToggleBtn?.addEventListener('click', () => {
        const open = historyFilters?.classList.toggle('hidden') === false;
        categoryFilters?.classList.toggle('hidden', !open);
        histToggleBtn.classList.toggle('open', open);
        histToggleBtn.setAttribute('aria-expanded', String(open));
    });

    searchInput?.addEventListener('input', e => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderizarMensagens();
    });

    const filteredMsgs = () => {
        let msgs = histFilter === 'todos' ? dbMensagens : dbMensagens.filter(m => m.destino === histFilter);
        if (histCatFilter !== 'todas') msgs = msgs.filter(m => m.categoria === histCatFilter);
        if (searchQuery) msgs = msgs.filter(m =>
            comunicadoPlainText(m.texto).toLowerCase().includes(searchQuery) ||
            m.destino.toLowerCase().includes(searchQuery)
        );
        return msgs;
    };

    function renderizarMensagens() { renderizarTabela(); renderizarCards(); }

    const emptyTableRow  = `<tr><td colspan="7"><div class="empty-state"><i class="fas fa-inbox"></i><span>Nenhum comunicado encontrado.</span></div></td></tr>`;
    const emptyCardsHtml = `<div class="empty-state"><i class="fas fa-inbox"></i><span>Nenhum comunicado encontrado.</span></div>`;

    const fmtDateTime = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

    function scheduledBadge(m) {
        if (isLive(m)) return '';
        return `<span class="badge-scheduled" title="Será enviado em ${escHTML(fmtDateTime(m.scheduled_at))}"><i class="fas fa-clock"></i> Agendado · ${escHTML(fmtDateTime(m.scheduled_at))}</span>`;
    }

    function attachBadge(m) {
        const anexos = m.anexos || [];
        if (!anexos.length) return '<span style="opacity:.4">—</span>';
        return `<button type="button" class="attach-badge" data-id="${m.id}"><i class="fas fa-paperclip"></i> ${anexos.length}</button>`;
    }

    function readsBadge(m) {
        const reads = readCountMap[m.id] || 0;
        return `<button type="button" class="reads-badge" data-id="${m.id}" title="Ver engajamento"><i class="fas fa-eye"></i> ${reads}</button>`;
    }

    function renderizarTabela() {
        if (!messagesList) return;
        const msgs = filteredMsgs();
        if (!msgs.length) { messagesList.innerHTML = emptyTableRow; return; }
        messagesList.innerHTML = msgs.map(m => {
            const t     = escHTML(comunicadoPlainText(m.texto));
            return `<tr>
                <td>${escHTML(fmtDate(m.created_at))}${scheduledBadge(m)}</td>
                <td>${categoriaBadge(m.categoria)}</td>
                <td><div class="message-preview" title="${t}">${t}</div></td>
                <td><span class="badge-dest">${escHTML(m.destino)}</span></td>
                <td>${attachBadge(m)}</td>
                <td>${readsBadge(m)}</td>
                <td><div class="row-actions">
                    <button class="edit-btn" data-id="${m.id}" aria-label="Editar"><i class="fas fa-pen"></i></button>
                    <button class="delete-btn" data-id="${m.id}" aria-label="Excluir"><i class="fas fa-trash"></i></button>
                </div></td>
            </tr>`;
        }).join('');
    }

    function renderizarCards() {
        if (!messagesCards) return;
        const msgs = filteredMsgs();
        if (!msgs.length) { messagesCards.innerHTML = emptyCardsHtml; return; }
        messagesCards.innerHTML = msgs.map(m => {
            const t     = escHTML(comunicadoPlainText(m.texto));
            const anexos = m.anexos || [];
            return `<div class="msg-card-item">
                <div class="msg-card-body">
                    <div class="msg-card-top">
                        <span class="msg-card-date">${escHTML(fmtDate(m.created_at))}</span>
                        ${categoriaBadge(m.categoria)}
                        <span class="msg-card-dest">${escHTML(m.destino)}</span>
                        ${readsBadge(m)}
                        ${anexos.length ? `<button type="button" class="attach-badge" data-id="${m.id}"><i class="fas fa-paperclip"></i> ${anexos.length}</button>` : ''}
                    </div>
                    <div class="msg-card-text" title="${t}">${t}</div>
                    ${scheduledBadge(m)}
                </div>
                <div class="msg-card-actions">
                    <button class="edit-btn" data-id="${m.id}" aria-label="Editar"><i class="fas fa-pen"></i></button>
                    <button class="delete-btn" data-id="${m.id}" aria-label="Excluir"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    }

    let attachPopover = null;
    function closeAttachPopover() { attachPopover?.remove(); attachPopover = null; }

    async function toggleAttachPopover(btn, msgId) {
        if (attachPopover) { closeAttachPopover(); return; }
        const msg = dbMensagens.find(m => m.id === msgId);
        const anexos = msg?.anexos || [];
        if (!anexos.length) return;

        const rect = btn.getBoundingClientRect();
        const pop = document.createElement('div');
        pop.className = 'attach-popover';
        pop.style.top  = `${rect.bottom + window.scrollY + 6}px`;
        pop.style.left = `${rect.left + window.scrollX}px`;
        pop.innerHTML = anexos.map((a, i) => `
            <a href="#" class="attach-popover-item" data-idx="${i}">
                <i class="fas ${fileIcon(a.type)}"></i>
                <span>${escHTML(a.name)}</span>
            </a>`).join('');
        document.body.appendChild(pop);
        attachPopover = pop;

        pop.addEventListener('click', async (e) => {
            e.preventDefault();
            const item = e.target.closest('.attach-popover-item');
            if (!item) return;
            const anexo = anexos[Number(item.dataset.idx)];
            const { data } = await sb.storage.from('message-attachments').createSignedUrl(anexo.path, 3600);
            if (data?.signedUrl) window.open(data.signedUrl, '_blank');
            closeAttachPopover();
        });
    }

    document.addEventListener('click', (e) => {
        if (attachPopover && !e.target.closest('.attach-popover') && !e.target.closest('.attach-badge')) closeAttachPopover();
    });

    messagesList?.addEventListener('click', (e) => {
        const btn = e.target.closest('.attach-badge');
        if (btn) toggleAttachPopover(btn, btn.dataset.id);
    });
    messagesCards?.addEventListener('click', (e) => {
        const btn = e.target.closest('.attach-badge');
        if (btn) toggleAttachPopover(btn, btn.dataset.id);
    });

    // ─── Dashboard de engajamento: leitura por departamento e por pessoa ──
    const engagementModal        = document.getElementById('engagement-modal');
    const engagementModalClose   = document.getElementById('engagement-modal-close');
    const engagementSummary      = document.getElementById('engagement-summary');
    const engagementDeptList     = document.getElementById('engagement-dept-list');
    const engagementReadersList  = document.getElementById('engagement-readers-list');
    let engagementRequestId = 0;

    function closeEngagementModal() {
        engagementModal?.classList.add('hidden');
        document.body.style.overflow = '';
    }

    async function openEngagementModal(msgId) {
        const msg = dbMensagens.find(m => m.id === msgId);
        if (!msg) return;

        engagementModal?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        if (engagementSummary)     engagementSummary.innerHTML = '';
        if (engagementDeptList)    engagementDeptList.innerHTML = `<div class="reads-popover-loading"><i class="fas fa-spinner fa-spin"></i> Carregando...</div>`;
        if (engagementReadersList) engagementReadersList.innerHTML = '';

        const requestId = ++engagementRequestId;
        const { data } = await sb
            .from('message_reads')
            .select('read_at, employees(name, dept, avatar_color, avatar_url)')
            .eq('message_id', msgId)
            .order('read_at', { ascending: false });
        if (requestId !== engagementRequestId) return;

        const rows = data || [];
        const recipients = dbEmployees.filter(e => e.status === 'Ativo' && (msg.destino === 'Todos' || e.dept === msg.destino));

        const deptTotals = {};
        recipients.forEach(e => {
            const dept = e.dept || 'Sem departamento';
            deptTotals[dept] = (deptTotals[dept] || 0) + 1;
        });
        const deptReads = {};
        rows.forEach(r => {
            const dept = r.employees?.dept || 'Sem departamento';
            if (dept in deptTotals) deptReads[dept] = (deptReads[dept] || 0) + 1;
        });

        const totalRecipients = recipients.length;
        const totalReads      = rows.length;
        const overallRate     = totalRecipients ? Math.round((totalReads / totalRecipients) * 100) : 0;

        if (engagementSummary) engagementSummary.innerHTML = `
            <div class="engagement-stat"><span class="engagement-stat-value">${totalRecipients}</span><span class="engagement-stat-label">Destinatários</span></div>
            <div class="engagement-stat"><span class="engagement-stat-value">${totalReads}</span><span class="engagement-stat-label">Leram</span></div>
            <div class="engagement-stat"><span class="engagement-stat-value">${overallRate}%</span><span class="engagement-stat-label">Taxa de leitura</span></div>
        `;

        const depts = Object.keys(deptTotals).sort((a, b) => deptTotals[b] - deptTotals[a]);
        if (engagementDeptList) engagementDeptList.innerHTML = depts.length ? depts.map(dept => {
            const total = deptTotals[dept];
            const read  = deptReads[dept] || 0;
            const pct   = total ? Math.round((read / total) * 100) : 0;
            return `<div class="engagement-dept-row">
                <div class="engagement-dept-info">
                    <span class="engagement-dept-name">${escHTML(deptLabel(dept))}</span>
                    <span class="engagement-dept-count">${read}/${total} · ${pct}%</span>
                </div>
                <div class="engagement-dept-bar"><div class="engagement-dept-bar-fill" style="width:${pct}%"></div></div>
            </div>`;
        }).join('') : `<div class="reads-popover-empty">Nenhum destinatário encontrado.</div>`;

        if (engagementReadersList) engagementReadersList.innerHTML = rows.length ? rows.map(r => {
            const emp = r.employees;
            const name = emp?.name || 'Colaborador removido';
            const initials = name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
            const avatar = emp?.avatar_url
                ? `<span class="reads-popover-avatar" style="background-image:url('${emp.avatar_url}')"></span>`
                : `<span class="reads-popover-avatar" style="background:${emp?.avatar_color || '#6366f1'}">${initials}</span>`;
            return `<div class="reads-popover-item">
                ${avatar}
                <div class="reads-popover-info">
                    <span class="reads-popover-name">${escHTML(name)}${emp?.dept ? ` <span class="engagement-reader-dept">· ${escHTML(deptLabel(emp.dept))}</span>` : ''}</span>
                    <span class="reads-popover-time">${escHTML(fmtDateTime(r.read_at))}</span>
                </div>
            </div>`;
        }).join('') : `<div class="reads-popover-empty">Nenhuma leitura ainda.</div>`;
    }

    engagementModalClose?.addEventListener('click', closeEngagementModal);
    engagementModal?.addEventListener('click', (e) => { if (e.target === engagementModal) closeEngagementModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !engagementModal?.classList.contains('hidden')) closeEngagementModal(); });

    messagesList?.addEventListener('click', (e) => {
        const btn = e.target.closest('.reads-badge');
        if (btn) openEngagementModal(btn.dataset.id);
    });
    messagesCards?.addEventListener('click', (e) => {
        const btn = e.target.closest('.reads-badge');
        if (btn) openEngagementModal(btn.dataset.id);
    });

    // ─── Edição de comunicados já enviados ──────────────────────
    const editModal        = document.getElementById('edit-modal');
    const editModalClose   = document.getElementById('edit-modal-close');
    const editModalCancel  = document.getElementById('edit-modal-cancel');
    const editModalSave    = document.getElementById('edit-modal-save');
    const editAttachBtn    = document.getElementById('edit-attach-btn');
    const editAttachInput  = document.getElementById('edit-attach-input');
    const editAttachChips  = document.getElementById('edit-attach-chips');
    const editDestToggleBtn = document.getElementById('edit-dest-toggle-btn');
    const editDestGrid      = document.getElementById('edit-dest-grid');
    const editCatToggleBtn  = document.getElementById('edit-cat-toggle-btn');
    const editCatGrid       = document.getElementById('edit-cat-grid');

    let editingId           = null;
    let editSelectedDest    = null;
    let editSelectedCategory = 'Institucional';
    let editKeptAttachments = [];
    let editRemovedPaths    = [];
    let editStagedFiles     = [];

    function renderEditAttachChips() {
        if (!editAttachChips) return;
        const existingHtml = editKeptAttachments.map((a, i) => `
            <span class="attach-chip">
                <i class="fas ${fileIcon(a.type)}"></i>
                <span class="attach-chip-name" title="${escHTML(a.name)}">${escHTML(a.name)}</span>
                <span class="attach-chip-size">${fmtSize(a.size)}</span>
                <button type="button" class="attach-chip-remove" data-kind="existing" data-idx="${i}" aria-label="Remover"><i class="fas fa-times"></i></button>
            </span>`).join('');
        const newHtml = editStagedFiles.map((f, i) => `
            <span class="attach-chip">
                <i class="fas ${fileIcon(f.type)}"></i>
                <span class="attach-chip-name" title="${f.name}">${f.name}</span>
                <span class="attach-chip-size">${fmtSize(f.size)}</span>
                <button type="button" class="attach-chip-remove" data-kind="new" data-idx="${i}" aria-label="Remover"><i class="fas fa-times"></i></button>
            </span>`).join('');
        editAttachChips.innerHTML = existingHtml + newHtml;
    }

    editAttachBtn?.addEventListener('click', () => editAttachInput?.click());

    editAttachInput?.addEventListener('change', () => {
        for (const file of editAttachInput.files) {
            if (editKeptAttachments.length + editStagedFiles.length >= MAX_FILES) break;
            if (!ALLOWED_TYPES.includes(file.type)) continue;
            if (file.size > MAX_FILE_SIZE) continue;
            editStagedFiles.push(file);
        }
        editAttachInput.value = '';
        renderEditAttachChips();
    });

    editAttachChips?.addEventListener('click', (e) => {
        const btn = e.target.closest('.attach-chip-remove');
        if (!btn) return;
        const idx = Number(btn.dataset.idx);
        if (btn.dataset.kind === 'existing') {
            const [removed] = editKeptAttachments.splice(idx, 1);
            if (removed) editRemovedPaths.push(removed.path);
        } else {
            editStagedFiles.splice(idx, 1);
        }
        renderEditAttachChips();
    });

    function closeEditDestDropdown() {
        editDestGrid?.classList.add('hidden');
        editDestToggleBtn?.classList.remove('open');
        editDestToggleBtn?.setAttribute('aria-expanded', 'false');
    }

    function closeEditCatDropdown() {
        editCatGrid?.classList.add('hidden');
        editCatToggleBtn?.classList.remove('open');
        editCatToggleBtn?.setAttribute('aria-expanded', 'false');
    }

    editDestToggleBtn?.addEventListener('click', () => {
        const willOpen = editDestGrid?.classList.contains('hidden');
        closeEditCatDropdown();
        if (willOpen) {
            editDestGrid?.classList.remove('hidden');
            editDestToggleBtn.classList.add('open');
            editDestToggleBtn.setAttribute('aria-expanded', 'true');
        } else {
            closeEditDestDropdown();
        }
    });

    document.querySelectorAll('#edit-dest-grid .dest-inline-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#edit-dest-grid .dest-inline-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            editSelectedDest = chip.dataset.dest;
            checkEditSaveReady();
        });
    });

    editCatToggleBtn?.addEventListener('click', () => {
        const willOpen = editCatGrid?.classList.contains('hidden');
        closeEditDestDropdown();
        if (willOpen) {
            editCatGrid?.classList.remove('hidden');
            editCatToggleBtn.classList.add('open');
            editCatToggleBtn.setAttribute('aria-expanded', 'true');
        } else {
            closeEditCatDropdown();
        }
    });

    document.querySelectorAll('#edit-cat-grid .cat-inline-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#edit-cat-grid .cat-inline-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            editSelectedCategory = chip.dataset.cat;
        });
    });

    editMessageText?.addEventListener('input', () => { normalizeEmptyEditor(editMessageText); checkEditSaveReady(); });

    function checkEditSaveReady() {
        if (editModalSave) editModalSave.disabled = !(editSelectedDest && editMessageText?.textContent.trim());
    }

    function openEditModal(msg) {
        editingId           = msg.id;
        editSelectedDest    = msg.destino;
        editSelectedCategory = msg.categoria || 'Institucional';
        editKeptAttachments = (msg.anexos || []).map(a => ({ ...a }));
        editRemovedPaths    = [];
        editStagedFiles     = [];

        if (editMessageText) editMessageText.innerHTML = sanitizeComunicadoHTML(msg.texto);
        document.querySelectorAll('#edit-dest-grid .dest-inline-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.dest === msg.destino);
        });
        document.querySelectorAll('#edit-cat-grid .cat-inline-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.cat === editSelectedCategory);
        });
        editDestGrid?.classList.add('hidden');
        editDestToggleBtn?.classList.remove('open');
        editDestToggleBtn?.setAttribute('aria-expanded', 'false');
        editCatGrid?.classList.add('hidden');
        editCatToggleBtn?.classList.remove('open');
        editCatToggleBtn?.setAttribute('aria-expanded', 'false');
        renderEditAttachChips();
        checkEditSaveReady();
        editModal?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeEditModal() {
        editModal?.classList.add('hidden');
        document.body.style.overflow = '';
        editingId = null;
        editDestGrid?.classList.add('hidden');
        editDestToggleBtn?.classList.remove('open');
        editDestToggleBtn?.setAttribute('aria-expanded', 'false');
        editCatGrid?.classList.add('hidden');
        editCatToggleBtn?.classList.remove('open');
        editCatToggleBtn?.setAttribute('aria-expanded', 'false');
    }

    editModalClose?.addEventListener('click', closeEditModal);
    editModalCancel?.addEventListener('click', closeEditModal);
    editModal?.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !editModal?.classList.contains('hidden')) closeEditModal(); });

    editModalSave?.addEventListener('click', async () => {
        if (!editMessageText?.textContent.trim() || !editSelectedDest || !editingId) return;
        const texto = sanitizeComunicadoHTML(editMessageText.innerHTML);

        editModalSave.disabled = true;

        if (editRemovedPaths.length) {
            await sb.storage.from('message-attachments').remove(editRemovedPaths);
        }

        let uploadedNew = [];
        if (editStagedFiles.length) {
            const uploads = await Promise.all(editStagedFiles.map(async (file) => {
                const path = `${editingId}/${Date.now()}_${file.name}`;
                const { error: upErr } = await sb.storage.from('message-attachments').upload(path, file, { contentType: file.type });
                return upErr ? null : { name: file.name, path, size: file.size, type: file.type };
            }));
            uploadedNew = uploads.filter(Boolean);
        }

        const anexos = [...editKeptAttachments, ...uploadedNew];

        const { data, error } = await sb.from('messages')
            .update({ texto, destino: editSelectedDest, categoria: editSelectedCategory, anexos })
            .eq('id', editingId)
            .select()
            .single();

        editModalSave.disabled = false;
        if (error) { console.error('[Nexus] edit:', error); return; }

        const idx = dbMensagens.findIndex(m => m.id === editingId);
        if (idx !== -1) dbMensagens[idx] = data;
        renderizarMensagens();
        closeEditModal();
    });

    function handleEdit(e) {
        const btn = e.target.closest('.edit-btn');
        if (!btn) return;
        const msg = dbMensagens.find(m => m.id === btn.dataset.id);
        if (msg) openEditModal(msg);
    }

    messagesList?.addEventListener('click', handleEdit);
    messagesCards?.addEventListener('click', handleEdit);

    // ─── Modal de confirmação de exclusão ───────────────────────
    const confirmDeleteModal   = document.getElementById('confirm-delete-modal');
    const confirmDeleteCancel  = document.getElementById('confirm-delete-cancel');
    const confirmDeleteConfirm = document.getElementById('confirm-delete-confirm');
    let pendingDeleteId = null;

    function openConfirmDeleteModal(id) {
        pendingDeleteId = id;
        confirmDeleteModal?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeConfirmDeleteModal() {
        confirmDeleteModal?.classList.add('hidden');
        document.body.style.overflow = '';
        pendingDeleteId = null;
    }

    confirmDeleteCancel?.addEventListener('click', closeConfirmDeleteModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !confirmDeleteModal?.classList.contains('hidden')) closeConfirmDeleteModal(); });

    confirmDeleteConfirm?.addEventListener('click', async () => {
        const id = pendingDeleteId;
        if (!id) return;
        confirmDeleteConfirm.disabled = true;

        const msg = dbMensagens.find(m => m.id === id);
        const paths = (msg?.anexos || []).map(a => a.path);
        if (paths.length) await sb.storage.from('message-attachments').remove(paths);
        await sb.from('messages').delete().eq('id', id);
        dbMensagens = dbMensagens.filter(m => m.id !== id);
        delete readCountMap[id];
        updateStats();
        renderizarMensagens();

        confirmDeleteConfirm.disabled = false;
        closeConfirmDeleteModal();
    });

    function handleDelete(e) {
        const btn = e.target.closest('.delete-btn');
        if (!btn) return;
        openConfirmDeleteModal(btn.dataset.id);
    }

    messagesList?.addEventListener('click', handleDelete);
    messagesCards?.addEventListener('click', handleDelete);

    sb.channel('messages-rh')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => {
            await loadMessages();
            if (currentSection === 'history') renderizarMensagens();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, async () => {
            const { data: reads } = await sb.from('message_reads').select('message_id');
            readCountMap = {};
            (reads || []).forEach(r => { readCountMap[r.message_id] = (readCountMap[r.message_id] || 0) + 1; });
            updateStats();
            if (currentSection === 'history') renderizarMensagens();
        })
        .subscribe();

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isMobile()) closeSide(); });

    window.addEventListener('beforeunload', () => { clearTimeout(draftSaveTimer); saveDraftToStorage(); });

    await loadEmployees();
    await loadMessages();
    await loadTemplates();
    tryRestoreDraft();
});