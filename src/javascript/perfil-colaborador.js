document.addEventListener('DOMContentLoaded', () => {
    let session = (() => {
        try { return JSON.parse(localStorage.getItem('nexus_session') || 'null'); }
        catch { return null; }
    })();

    if (!session || session.profile === 'rh') {
        window.location.href = '../screens/login.html';
        return;
    }

    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');
    const SIDEBAR_KEY    = 'sidebarState_colab';

    const isMobile = () => window.innerWidth <= 768;

    function openMobileSidebar()  { sidebar?.classList.add('open'); sidebarOverlay?.classList.add('active'); document.body.style.overflow = 'hidden'; }
    function closeMobileSidebar() { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; }

    sidebarToggle?.addEventListener('click', e => {
        e.stopPropagation();
        if (isMobile()) { sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar(); }
        else { const c = sidebar?.classList.toggle('collapsed'); mainWrapper?.classList.toggle('sidebar-collapsed', c); localStorage.setItem(SIDEBAR_KEY, c ? 'collapsed' : 'expanded'); }
    });

    topbarMenuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar(); });
    sidebarOverlay?.addEventListener('click', closeMobileSidebar);

    if (!isMobile() && localStorage.getItem(SIDEBAR_KEY) === 'collapsed') { sidebar?.classList.add('collapsed'); mainWrapper?.classList.add('sidebar-collapsed'); }
    window.addEventListener('resize', () => { if (!isMobile()) closeMobileSidebar(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMobileSidebar(); closeAvatarMenu(); closeColorPicker(); } });

    const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#10b981','#f59e0b','#3b82f6','#ef4444','#14b8a6','#f97316','#84cc16'];

    const initials   = n => (n || '?').split(' ').slice(0,2).map(w => w[0]?.toUpperCase() || '').join('');
    const formatDate = s => { if (!s) return '—'; const [y,m,d] = s.split('-'); return `${d}/${m}/${y}`; };
    const setEl      = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };
    const setInput   = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };

    function calcFeriasInfo(contractType, admissionDate) {
    const type = (contractType || '').toLowerCase();

    if (type === 'pj') {
        return { icon: 'prof-icon--orange', value: 'Negociado', note: 'Contrato PJ: dias negociados entre as partes' };
    }

    if (type === 'temporário' || type === 'temporario') {
        return { icon: 'prof-icon--gray', value: 'Não aplicável', note: 'Contrato temporário não garante férias' };
    }

    if (!admissionDate) {
        return { icon: 'prof-icon--green', value: '—', note: 'Data de admissão não informada' };
    }

    const adm  = new Date(admissionDate + 'T00:00:00');
    const hoje = new Date();

    let mesesCompletos = (hoje.getFullYear() - adm.getFullYear()) * 12 + (hoje.getMonth() - adm.getMonth());
    
    if (hoje.getDate() < adm.getDate()) mesesCompletos = Math.max(0, mesesCompletos - 1);

    const periodosCompletos  = Math.floor(mesesCompletos / 12); 
    const mesesNoPeriodoAtual = mesesCompletos % 12;             

    const diasAcumulados = Math.min(Math.floor(mesesNoPeriodoAtual * 2.5), 30);

    const diasDisponiveisAnteriores = periodosCompletos * 30;

    const proximoAniversario = new Date(adm);
    proximoAniversario.setFullYear(adm.getFullYear() + periodosCompletos + 1);
    const mesesParaProximo = Math.round((proximoAniversario - hoje) / (1000 * 60 * 60 * 24 * 30.44));

    if (mesesCompletos < 12) {
        const faltam = 12 - mesesCompletos;
        return {
            icon:  'prof-icon--green',
            value: `${diasAcumulados} dias acumulados`,
            note:  `Faltam ${faltam} mês(es)`
        };
    }

    if (diasDisponiveisAnteriores > 0) {
        return {
            icon:  'prof-icon--green',
            value: `${diasDisponiveisAnteriores} dias disponíveis`,
            note:  mesesNoPeriodoAtual > 0
                ? `+ ${diasAcumulados} dias acumulados no período atual`
                : `Próximo vencimento em ${mesesParaProximo} mês(es)`
        };
    }
    
    return {
        icon:  'prof-icon--green',
        value: `${diasAcumulados} dias acumulados`,
        note:  `Próximo vencimento em ${mesesParaProximo} mês(es)`
    };
}

    function applySession() {
        const color = session.avatarColor || '#6366f1';
        const ini   = initials(session.name);

        const sidebarAvatar = document.getElementById('sidebar-avatar');
        if (sidebarAvatar) { sidebarAvatar.textContent = ini; sidebarAvatar.style.background = color; }
        setEl('sidebar-name', session.name);
        setEl('sidebar-role', session.role || 'Colaborador');

        const avatarImg = document.getElementById('profile-avatar-img');
        const avatarDiv = document.getElementById('profile-avatar');
        const removeBtn = document.getElementById('avatar-menu-remove');

        if (session.avatarPhoto) {
            avatarImg?.classList.remove('hidden'); if (avatarImg) avatarImg.src = session.avatarPhoto;
            avatarDiv?.classList.add('hidden');
            if (removeBtn) removeBtn.style.display = 'flex';
        } else {
            avatarImg?.classList.add('hidden');
            avatarDiv?.classList.remove('hidden');
            if (avatarDiv) { avatarDiv.textContent = ini; avatarDiv.style.background = color; }
            if (removeBtn) removeBtn.style.display = 'none';
        }

        setEl('profile-hero-name', session.name);
        setEl('profile-hero-sub',  `${session.role || '—'} · ${session.dept || '—'}`);

        const badge = document.getElementById('profile-status-badge');
        if (badge) {
            const sc = session.status === 'Ativo' ? '#4ade80' : session.status === 'Férias' ? '#facc15' : '#f87171';
            badge.innerHTML = `<i class="fas fa-circle" style="color:${sc}"></i> ${session.status || 'Ativo'}`;
        }

        setEl('view-name',  session.name);
        setEl('view-email', session.email);
        setEl('view-phone', session.phone || 'Não informado');
        setEl('view-bio',   session.bio   || 'Nenhuma descrição adicionada.');

        setEl('prof-role',      session.role    || '—');
        setEl('prof-dept',      session.dept    || '—');
        setEl('prof-admission', formatDate(session.admissionDate));
        setEl('prof-status',    session.status  || 'Ativo');
        setEl('prof-profile',   session.profile === 'rh' ? 'RH' : 'Colaborador');

        if (session.admissionDate) {
            const adm   = new Date(session.admissionDate);
            const hoje  = new Date();
            const days  = Math.floor((hoje - adm) / 86400000);
            const months = Math.floor(days / 30);
            const years  = Math.floor(months / 12);
            let tenure = years > 0 ? `${years} ano${years > 1 ? 's' : ''} e ${months % 12} mês(es)` : months > 0 ? `${months} mês(es)` : `${days} dia(s)`;
            setEl('prof-tenure', tenure);
            setEl('prof-days',   days.toLocaleString('pt-BR'));
        }

        const feriasInfo = calcFeriasInfo(session.contractType, session.admissionDate);

        const feriasCard = document.getElementById('prof-highlight-ferias');
        if (feriasCard) {
            const iconEl  = feriasCard.querySelector('.prof-highlight-icon');
            const valueEl = feriasCard.querySelector('.prof-highlight-value');
            const noteEl  = feriasCard.querySelector('.prof-highlight-note');

            if (iconEl)  { iconEl.className = `prof-highlight-icon ${feriasInfo.icon}`; }
            if (valueEl) valueEl.textContent = feriasInfo.value;
            if (noteEl)  noteEl.textContent  = feriasInfo.note;
        }
    }

    function calcBancoHoras() {
        const pad0   = n => String(n).padStart(2, '0');
        const diffMin = (a, b) => { if (!a || !b) return 0; return Math.round((new Date(b) - new Date(a)) / 60000); };
        const minToStr = min => { const abs = Math.abs(min); return `${Math.floor(abs / 60)}h ${pad0(abs % 60)}min`; };

        const contractType = (session.contractType || 'clt').toLowerCase();
        const jornadaMin   = (contractType === 'estagio' || contractType === 'aprendiz') ? 360
                           : contractType === 'pj' ? null : 480;

        let records = {};
        try { records = JSON.parse(localStorage.getItem(`nexus_ponto_${session.email}`) || '{}'); } catch {}

        const valueEl = document.getElementById('prof-banco-value');
        const noteEl  = document.getElementById('prof-banco-note');
        const iconEl  = document.getElementById('banco-icon');

        if (jornadaMin === null) {
            let totalWorked = 0;
            let diasCompletos = 0;
            Object.values(records).forEach(rec => {
                if (!rec || !rec.entrada || !rec.saida) return;
                const worked = rec.saida_almoco
                    ? diffMin(rec.entrada, rec.saida_almoco) + (rec.retorno_almoco ? diffMin(rec.retorno_almoco, rec.saida) : 0)
                    : diffMin(rec.entrada, rec.saida);
                totalWorked += worked;
                diasCompletos++;
            });
            if (valueEl) valueEl.textContent = minToStr(totalWorked);
            if (noteEl)  noteEl.textContent  = `${diasCompletos} dia(s) registrado(s) — PJ`;
            if (iconEl)  iconEl.className    = 'prof-highlight-icon prof-icon--blue';
            return;
        }

        let totalMin = 0, diasCompletos = 0;
        Object.values(records).forEach(rec => {
            if (!rec || !rec.entrada || !rec.saida) return;
            const worked = rec.saida_almoco
                ? diffMin(rec.entrada, rec.saida_almoco) + (rec.retorno_almoco ? diffMin(rec.retorno_almoco, rec.saida) : 0)
                : diffMin(rec.entrada, rec.saida);
            totalMin += worked - jornadaMin;
            diasCompletos++;
        });

        if (diasCompletos === 0) {
            if (valueEl) valueEl.textContent = '0h 00min';
            if (noteEl)  noteEl.textContent  = 'Nenhum dia finalizado';
            if (iconEl)  iconEl.className    = 'prof-highlight-icon prof-icon--purple';
            return;
        }

        const sign = totalMin > 0 ? '+' : totalMin < 0 ? '-' : '';
        const cls  = totalMin > 0 ? 'prof-icon--green' : totalMin < 0 ? 'prof-icon--red' : 'prof-icon--purple';
        if (valueEl) valueEl.textContent = `${sign}${minToStr(totalMin)}`;
        if (noteEl)  noteEl.textContent  = `Saldo de ${diasCompletos} dia(s) registrado(s)`;
        if (iconEl)  iconEl.className    = `prof-highlight-icon ${cls}`;
    }

    applySession();
    calcBancoHoras();
    buildColorSwatches();
    loadNotifPrefs();

    // ── Real-time sync: atualiza perfil quando RH altera dados do colaborador ──
    window.addEventListener('storage', (event) => {
        if (event.key !== 'nexus_users') return;
        try {
            const users = JSON.parse(event.newValue || '[]');
            const updatedUser = users.find(u => u.email === session.email);
            if (!updatedUser) return;

            const SYNC_FIELDS = ['name','role','dept','status','admissionDate','contractType','salary','phone','salaryType','workLoad'];
            const changed = SYNC_FIELDS.some(k => updatedUser[k] !== session[k]);
            if (!changed) return;

            if (updatedUser.status === 'Inativo' || updatedUser.status === 'Bloqueado') {
                showToast('Conta desativada pelo RH', 'error', 'Você será desconectado em instantes.');
                setTimeout(() => { localStorage.removeItem('nexus_session'); window.location.href = '../screens/login.html'; }, 2500);
                return;
            }

            const { password: _pw, ...cleanUser } = updatedUser;
            session = { ...session, ...cleanUser };
            localStorage.setItem('nexus_session', JSON.stringify(session));
            applySession();
            buildColorSwatches();
            showToast('Perfil atualizado pelo RH', 'success', 'Suas informações foram atualizadas.');
        } catch {}
    });

    window.switchPTab = function (btn, tabId) {
        document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.ptab-panel').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
        btn.classList.add('active');
        const panel = document.getElementById('ptab-' + tabId);
        if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
    };

    let editing = false;

    window.toggleEditInfo = function () {
        editing = !editing;
        const view = document.getElementById('info-view');
        const form = document.getElementById('info-edit');
        const btn  = document.getElementById('btn-edit-info');
        if (editing) {
            view?.classList.add('hidden'); form?.classList.remove('hidden');
            if (btn) btn.innerHTML = '<i class="fas fa-times"></i> Cancelar';
            setInput('edit-name', session.name); setInput('edit-phone', session.phone); setInput('edit-bio', session.bio);
        } else { cancelEditInfo(); }
    };

    window.cancelEditInfo = function () {
        editing = false;
        document.getElementById('info-view')?.classList.remove('hidden');
        document.getElementById('info-edit')?.classList.add('hidden');
        const btn = document.getElementById('btn-edit-info');
        if (btn) btn.innerHTML = '<i class="fas fa-pen"></i> Editar';
    };

    window.saveInfo = function () {
        const name  = document.getElementById('edit-name')?.value.trim()  || '';
        const phone = document.getElementById('edit-phone')?.value.trim() || '';
        const bio   = document.getElementById('edit-bio')?.value.trim()   || '';
        if (!name) { showToast('Informe o nome.', 'warning'); return; }
        session = { ...session, name, phone, bio };
        localStorage.setItem('nexus_session', JSON.stringify(session));
        syncUsersRecord({ name, phone, bio });
        applySession(); cancelEditInfo();
        showToast('Perfil atualizado!', 'success');
    };

    function syncUsersRecord(fields) {
        try {
            const users = JSON.parse(localStorage.getItem('nexus_users') || '[]');
            const idx   = users.findIndex(u => u.email === session.email);
            if (idx !== -1) {
                users[idx] = { ...users[idx], ...fields };
                localStorage.setItem('nexus_users', JSON.stringify(users));
                window.dispatchEvent(new StorageEvent('storage', {
                    key: 'nexus_users',
                    newValue: JSON.stringify(users),
                    storageArea: localStorage
                }));
            }
        } catch {}
        // Sync name/phone back to nexus_employees so RH sees updates in real-time
        if (fields.name !== undefined || fields.phone !== undefined) {
            try {
                const employees = JSON.parse(localStorage.getItem('nexus_employees') || '[]');
                const empIdx = employees.findIndex(e =>
                    e.email?.toLowerCase() === session.email.toLowerCase() ||
                    e.id === session.employeeId
                );
                if (empIdx !== -1) {
                    if (fields.name  !== undefined) employees[empIdx].name    = fields.name;
                    if (fields.phone !== undefined) employees[empIdx].telefone = fields.phone;
                    localStorage.setItem('nexus_employees', JSON.stringify(employees));
                    window.dispatchEvent(new StorageEvent('storage', {
                        key: 'nexus_employees',
                        newValue: JSON.stringify(employees),
                        storageArea: localStorage
                    }));
                }
            } catch {}
        }
    }

    function positionFloating(el, anchor) {
        const rect = anchor.getBoundingClientRect();
        const margin = 8;
        let top  = rect.bottom + margin;
        let left = rect.left;
        const w = el.offsetWidth || 196;
        if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
        const h = el.offsetHeight || 160;
        if (top + h > window.innerHeight - 12) top = rect.top - h - margin;
        el.style.top  = top  + 'px';
        el.style.left = left + 'px';
    }

    window.toggleAvatarMenu = function () {
        const menu   = document.getElementById('avatar-menu');
        const picker = document.getElementById('color-picker');
        const btn    = document.getElementById('avatar-edit-btn');
        if (!menu || !btn) return;
        picker?.classList.remove('open');
        if (menu.classList.contains('open')) { menu.classList.remove('open'); }
        else { menu.classList.add('open'); positionFloating(menu, btn); }
    };

    function closeAvatarMenu() { document.getElementById('avatar-menu')?.classList.remove('open'); }

    document.addEventListener('click', e => {
        const menu   = document.getElementById('avatar-menu');
        const picker = document.getElementById('color-picker');
        if (menu?.classList.contains('open')   && !e.target.closest('#avatar-menu')   && !e.target.closest('#avatar-edit-btn')) closeAvatarMenu();
        if (picker?.classList.contains('open') && !e.target.closest('#color-picker')  && !e.target.closest('#avatar-edit-btn') && !e.target.closest('#avatar-menu')) closeColorPicker();
    });

    window.addEventListener('scroll',  () => { const btn = document.getElementById('avatar-edit-btn'); if (!btn) return; const m = document.getElementById('avatar-menu'); const p = document.getElementById('color-picker'); if (m?.classList.contains('open')) positionFloating(m, btn); if (p?.classList.contains('open')) positionFloating(p, btn); }, { passive: true });
    window.addEventListener('resize',  () => { const btn = document.getElementById('avatar-edit-btn'); if (!btn) return; const m = document.getElementById('avatar-menu'); const p = document.getElementById('color-picker'); if (m?.classList.contains('open')) positionFloating(m, btn); if (p?.classList.contains('open')) positionFloating(p, btn); });

    window.triggerPhotoUpload = function () { closeAvatarMenu(); document.getElementById('photo-input')?.click(); };

    window.handlePhotoUpload = function (event) {
        const file = event.target.files?.[0]; if (!file) return;
        if (!file.type.startsWith('image/')) { showToast('Selecione uma imagem válida.', 'error'); return; }
        if (file.size > 2 * 1024 * 1024) { showToast('Imagem deve ter no máximo 2 MB.', 'warning'); return; }
        const reader = new FileReader();
        reader.onload = e => {
            session = { ...session, avatarPhoto: e.target.result };
            localStorage.setItem('nexus_session', JSON.stringify(session));
            syncUsersRecord({ avatarPhoto: e.target.result });
            applySession(); showToast('Foto atualizada!', 'success');
        };
        reader.readAsDataURL(file); event.target.value = '';
    };

    window.removePhoto = function () {
        closeAvatarMenu();
        session = { ...session, avatarPhoto: null };
        localStorage.setItem('nexus_session', JSON.stringify(session));
        syncUsersRecord({ avatarPhoto: null }); applySession(); showToast('Foto removida.', 'success');
    };

    window.openColorPicker = function () {
        const picker = document.getElementById('color-picker');
        const btn    = document.getElementById('avatar-edit-btn');
        if (!picker || !btn) return;
        document.getElementById('avatar-menu')?.classList.remove('open');
        if (picker.classList.contains('open')) { picker.classList.remove('open'); }
        else { picker.classList.add('open'); positionFloating(picker, btn); }
    };

    function closeColorPicker() { document.getElementById('color-picker')?.classList.remove('open'); }

    function buildColorSwatches() {
        const container = document.getElementById('color-swatches'); if (!container) return;
        container.innerHTML = '';
        const current = session.avatarColor || '#6366f1';
        AVATAR_COLORS.forEach(color => {
            const sw = document.createElement('div');
            sw.className = 'color-swatch' + (color === current ? ' active' : '');
            sw.style.background = color; sw.title = color;
            sw.addEventListener('click', () => selectAvatarColor(color));
            container.appendChild(sw);
        });
    }

    function selectAvatarColor(color) {
        session = { ...session, avatarColor: color, avatarPhoto: null };
        localStorage.setItem('nexus_session', JSON.stringify(session));
        syncUsersRecord({ avatarColor: color, avatarPhoto: null });
        applySession(); buildColorSwatches(); closeColorPicker(); showToast('Cor atualizada!', 'success');
    }

    const NOTIF_KEY = 'nexus_notif_' + session.email;

    const NOTIF_DEFAULTS = {
        comunicados: true,
        holerite:    true,
        ferias:      true,
        horas:       false,
        seguranca:   true,
    };

    function loadNotifPrefs() {
        try {
            const saved = JSON.parse(localStorage.getItem(NOTIF_KEY));
            const prefs = (saved && typeof saved === 'object') ? saved : {};

            const merged = { ...NOTIF_DEFAULTS, ...prefs };

            Object.entries(merged).forEach(([k, v]) => {
                const el = document.getElementById('notif-' + k);
                if (el) el.checked = v;
            });

            // Garante que os defaults ficam salvos na primeira visita
            if (!saved) localStorage.setItem(NOTIF_KEY, JSON.stringify(merged));
        } catch {}
    }

    window.saveNotifPref = function (key, value) {
        try {
            const saved = JSON.parse(localStorage.getItem(NOTIF_KEY));
            const prefs = (saved && typeof saved === 'object') ? saved : { ...NOTIF_DEFAULTS };
            prefs[key] = value;
            localStorage.setItem(NOTIF_KEY, JSON.stringify(prefs));
            showToast(value ? 'Notificação ativada.' : 'Notificação desativada.', value ? 'success' : 'error');
        } catch {}
    };

    window.checkNewPass = function () {
        const curr = document.getElementById('curr-pass')?.value || '';
        const np   = document.getElementById('new-pass-profile')?.value || '';
        const cp   = document.getElementById('confirm-pass-profile')?.value || '';
        const msg  = document.getElementById('pw-match-msg');
        const btn  = document.getElementById('btn-change-pw');
        if (btn) btn.disabled = !(curr && np.length >= 8 && np === cp);
        if (!msg) return;
        if (!cp)             { msg.textContent = ''; msg.className = 'pw-match-msg'; }
        else if (np !== cp)  { msg.textContent = 'As senhas não coincidem.'; msg.className = 'pw-match-msg err'; }
        else if (np.length < 8){ msg.textContent = 'Mínimo 8 caracteres.'; msg.className = 'pw-match-msg err'; }
        else                 { msg.textContent = 'Senhas coincidem ✓'; msg.className = 'pw-match-msg ok'; }
    };

    window.changePassword = function () {
        const curr = document.getElementById('curr-pass')?.value || '';
        const np   = document.getElementById('new-pass-profile')?.value || '';
        const users = JSON.parse(localStorage.getItem('nexus_users') || '[]');
        const idx   = users.findIndex(u => u.email === session.email);
        if (idx === -1 || users[idx].password !== curr) { showToast('Senha atual incorreta.', 'error'); return; }
        users[idx].password = np; localStorage.setItem('nexus_users', JSON.stringify(users));
        ['curr-pass','new-pass-profile','confirm-pass-profile'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        const btn = document.getElementById('btn-change-pw'); if (btn) btn.disabled = true;
        const msg = document.getElementById('pw-match-msg'); if (msg) { msg.textContent = ''; msg.className = 'pw-match-msg'; }
        showToast('Senha alterada com sucesso!', 'success');
    };

    window.togglePwSmall = function (inputId, btn) {
        const input = document.getElementById(inputId); if (!input) return;
        const show = input.type === 'password'; input.type = show ? 'text' : 'password';
        const icon = btn.querySelector('i'); if (icon) icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
    };

    window.logout    = function () { localStorage.removeItem('nexus_session'); window.location.href = '../screens/login.html'; };
    window.logoutAll = function () { localStorage.removeItem('nexus_session'); showToast('Sessões encerradas.', 'success'); setTimeout(() => window.location.href = '../screens/login.html', 1200); };

    window.showToast = function (title, type = 'success', msg = '') {
        const container = document.getElementById('toast-container'); if (!container) return;
        const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<div class="toast-icon"><i class="fas ${icons[type] || 'fa-check'}"></i></div><div class="toast-content"><p class="toast-title">${title}</p>${msg ? `<p class="toast-msg">${msg}</p>` : ''}</div><button class="toast-close" onclick="this.closest('.toast').classList.add('hide'); setTimeout(()=>this.closest('.toast').remove(),300)"><i class="fas fa-times"></i></button>`;
        container.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 300); }, 3500);
    };
});