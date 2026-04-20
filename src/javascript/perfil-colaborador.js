document.addEventListener('DOMContentLoaded', () => {

    // ── Sessão ────────────────────────────────────────────────
    let session = (() => {
        try { return JSON.parse(localStorage.getItem('nexus_session') || 'null'); }
        catch { return null; }
    })();

    if (!session || session.profile === 'rh') {
        window.location.href = '../screens/login.html';
        return;
    }

    // ── Sidebar (reutiliza lógica padrão Nexus) ───────────────
    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');
    const SIDEBAR_KEY    = 'sidebarState_colab';

    const isMobile = () => window.innerWidth <= 768;

    function openMobileSidebar()  { sidebar?.classList.add('open'); sidebarOverlay?.classList.add('active'); document.body.style.overflow = 'hidden'; }
    function closeMobileSidebar() { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; }

    sidebarToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isMobile()) { sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar(); }
        else {
            const c = sidebar?.classList.toggle('collapsed');
            mainWrapper?.classList.toggle('sidebar-collapsed', c);
            localStorage.setItem(SIDEBAR_KEY, c ? 'collapsed' : 'expanded');
        }
    });

    topbarMenuBtn?.addEventListener('click', (e) => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar(); });
    sidebarOverlay?.addEventListener('click', closeMobileSidebar);
    if (!isMobile() && localStorage.getItem(SIDEBAR_KEY) === 'collapsed') { sidebar?.classList.add('collapsed'); mainWrapper?.classList.add('sidebar-collapsed'); }
    window.addEventListener('resize', () => { if (!isMobile()) closeMobileSidebar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMobileSidebar(); closeColorPicker(); } });

    // ── Inicialização ─────────────────────────────────────────
    const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#10b981','#f59e0b','#3b82f6','#ef4444','#14b8a6','#f97316','#84cc16'];

    const initials = (name) => (name || '?').split(' ').slice(0,2).map(w => w[0]?.toUpperCase() || '').join('');
    const formatDate = (str) => { if (!str) return '—'; const [y,m,d] = str.split('-'); return `${d}/${m}/${y}`; };

    function applySession() {
        const color = session.avatarColor || '#6366f1';
        const ini   = initials(session.name);

        // Sidebar
        const sidebarAvatar = document.getElementById('sidebar-avatar');
        if (sidebarAvatar) { sidebarAvatar.textContent = ini; sidebarAvatar.style.background = color; }
        setEl('sidebar-name', session.name);
        setEl('sidebar-role', session.role || 'Colaborador');

        // Hero
        const pa = document.getElementById('profile-avatar');
        if (pa) { pa.textContent = ini; pa.style.background = color; }
        setEl('profile-hero-name', session.name);
        setEl('profile-hero-sub', `${session.role || '—'} · ${session.dept || '—'}`);

        const badge = document.getElementById('profile-status-badge');
        if (badge) {
            badge.innerHTML = `<i class="fas fa-circle"></i> ${session.status || 'Ativo'}`;
            const dot = badge.querySelector('i');
            if (dot) dot.style.color = session.status === 'Ativo' ? '#4ade80' : session.status === 'Férias' ? '#facc15' : '#f87171';
        }

        // Info view
        setEl('view-name',      session.name);
        setEl('view-email',     session.email);
        setEl('view-phone',     session.phone   || 'Não informado');
        setEl('view-role',      session.role    || '—');
        setEl('view-dept',      session.dept    || '—');
        setEl('view-admission', formatDate(session.admissionDate));
        setEl('view-bio',       session.bio     || 'Nenhuma descrição adicionada.');
    }

    function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val || '—'; }

    applySession();
    buildColorSwatches();

    // ── Abas ──────────────────────────────────────────────────
    window.switchPTab = function (btn, tabId) {
        document.querySelectorAll('.ptab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.ptab-panel').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
        btn.classList.add('active');
        const panel = document.getElementById('ptab-' + tabId);
        if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
    };

    // ── Edição de informações ─────────────────────────────────
    let editing = false;

    window.toggleEditInfo = function () {
        editing = !editing;
        const view  = document.getElementById('info-view');
        const form  = document.getElementById('info-edit');
        const btn   = document.getElementById('btn-edit-info');

        if (editing) {
            view.classList.add('hidden');
            form.classList.remove('hidden');
            btn.innerHTML = '<i class="fas fa-times"></i> Cancelar';

            // Preenche form
            setInput('edit-name',  session.name  || '');
            setInput('edit-phone', session.phone || '');
            setInput('edit-role',  session.role  || '');
            setInput('edit-dept',  session.dept  || '');
            document.getElementById('edit-bio').value = session.bio || '';
        } else {
            view.classList.remove('hidden');
            form.classList.add('hidden');
            btn.innerHTML = '<i class="fas fa-pen"></i> Editar';
        }
    };

    function setInput(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

    window.cancelEditInfo = function () {
        editing = false;
        document.getElementById('info-view').classList.remove('hidden');
        document.getElementById('info-edit').classList.add('hidden');
        document.getElementById('btn-edit-info').innerHTML = '<i class="fas fa-pen"></i> Editar';
    };

    window.saveInfo = function () {
        const name  = document.getElementById('edit-name').value.trim();
        const phone = document.getElementById('edit-phone').value.trim();
        const role  = document.getElementById('edit-role').value.trim();
        const dept  = document.getElementById('edit-dept').value.trim();
        const bio   = document.getElementById('edit-bio').value.trim();

        if (!name) { showToast('Informe o nome.', 'warning'); return; }

        // Atualiza sessão
        session = { ...session, name, phone, role, dept, bio };
        localStorage.setItem('nexus_session', JSON.stringify(session));

        // Atualiza nexus_users
        const users = JSON.parse(localStorage.getItem('nexus_users') || '[]');
        const idx   = users.findIndex(u => u.email === session.email);
        if (idx !== -1) { users[idx] = { ...users[idx], name, phone, role, dept, bio }; localStorage.setItem('nexus_users', JSON.stringify(users)); }

        applySession();
        cancelEditInfo();
        showToast('Perfil atualizado!', 'success');
    };

    // ── Color picker ──────────────────────────────────────────
    function buildColorSwatches() {
        const container = document.getElementById('color-swatches');
        if (!container) return;
        container.innerHTML = '';
        AVATAR_COLORS.forEach(color => {
            const sw = document.createElement('div');
            sw.className = 'color-swatch' + (color === (session.avatarColor || '#6366f1') ? ' active' : '');
            sw.style.background = color;
            sw.title = color;
            sw.addEventListener('click', () => selectAvatarColor(color));
            container.appendChild(sw);
        });
    }

    window.openColorPicker = function () {
        const picker = document.getElementById('color-picker');
        if (picker) picker.classList.toggle('open');
    };

    function closeColorPicker() {
        document.getElementById('color-picker')?.classList.remove('open');
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.avatar-area')) closeColorPicker();
    });

    function selectAvatarColor(color) {
        session = { ...session, avatarColor: color };
        localStorage.setItem('nexus_session', JSON.stringify(session));

        const users = JSON.parse(localStorage.getItem('nexus_users') || '[]');
        const idx   = users.findIndex(u => u.email === session.email);
        if (idx !== -1) { users[idx].avatarColor = color; localStorage.setItem('nexus_users', JSON.stringify(users)); }

        applySession();
        buildColorSwatches();
        closeColorPicker();
        showToast('Cor do avatar atualizada!', 'success');
    }

    // ── Segurança — alterar senha ─────────────────────────────
    window.checkNewPass = function () {
        const np  = document.getElementById('new-pass-profile')?.value    || '';
        const cp  = document.getElementById('confirm-pass-profile')?.value || '';
        const msg = document.getElementById('pw-match-msg');
        const btn = document.getElementById('btn-change-pw');

        const curr  = document.getElementById('curr-pass')?.value || '';
        const valid = curr && np.length >= 8 && np === cp;
        if (btn) btn.disabled = !valid;

        if (msg) {
            if (!cp) { msg.textContent = ''; msg.className = 'pw-match-msg'; }
            else if (np !== cp) { msg.textContent = 'As senhas não coincidem.'; msg.className = 'pw-match-msg err'; }
            else if (np.length < 8) { msg.textContent = 'Mínimo 8 caracteres.'; msg.className = 'pw-match-msg err'; }
            else { msg.textContent = 'Senhas coincidem ✓'; msg.className = 'pw-match-msg ok'; }
        }
    };

    window.changePassword = function () {
        const curr = document.getElementById('curr-pass')?.value || '';
        const np   = document.getElementById('new-pass-profile')?.value || '';

        // Verifica senha atual
        const users = JSON.parse(localStorage.getItem('nexus_users') || '[]');
        const idx   = users.findIndex(u => u.email === session.email);
        if (idx === -1 || users[idx].password !== curr) {
            showToast('Senha atual incorreta.', 'error');
            return;
        }

        users[idx].password = np;
        localStorage.setItem('nexus_users', JSON.stringify(users));

        document.getElementById('curr-pass').value            = '';
        document.getElementById('new-pass-profile').value     = '';
        document.getElementById('confirm-pass-profile').value = '';
        document.getElementById('btn-change-pw').disabled = true;
        document.getElementById('pw-match-msg').textContent = '';

        showToast('Senha alterada com sucesso!', 'success');
    };

    window.togglePwSmall = function (inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
    };

    // ── Logout ────────────────────────────────────────────────
    window.logout = function () {
        localStorage.removeItem('nexus_session');
        window.location.href = '../screens/login.html';
    };

    window.logoutAll = function () {
        localStorage.removeItem('nexus_session');
        showToast('Sessões encerradas.', 'success');
        setTimeout(() => window.location.href = '../screens/login.html', 1200);
    };

    // ── Toast ─────────────────────────────────────────────────
    window.showToast = function (title, type = 'success', msg = '') {
        const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
            <div class="toast-content"><p class="toast-title">${title}</p>${msg ? `<p class="toast-msg">${msg}</p>` : ''}</div>
            <button class="toast-close" onclick="this.closest('.toast').classList.add('hide'); setTimeout(()=>this.closest('.toast').remove(),400)">
                <i class="fas fa-times"></i>
            </button>`;
        container.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 400); }, 3500);
    };
});