document.addEventListener('DOMContentLoaded', () => {
    let session = (() => {
        try {
            const s = localStorage.getItem('nexus_session');
            return s ? JSON.parse(s) : null;
        } catch { return null; }
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

    if (!isMobile() && localStorage.getItem(SIDEBAR_KEY) === 'collapsed') {
        sidebar?.classList.add('collapsed');
        mainWrapper?.classList.add('sidebar-collapsed');
    }

    window.addEventListener('resize', () => { if (!isMobile()) closeMobileSidebar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isMobile()) closeMobileSidebar(); });

    // ── Helpers ──
    const PINK = '#ec4899';

    const getInitials = (name) =>
        (name || '?').split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');

    const formatDate = (str) => {
        if (!str) return '—';
        const [y, m, d] = str.split('-');
        return `${d}/${m}/${y}`;
    };

    const greeting = (() => {
        const h = new Date().getHours();
        if (h < 12) return 'Bom dia';
        if (h < 18) return 'Boa tarde';
        return 'Boa noite';
    })();

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };

    const escapeHTML = (str) => String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    // ── Render central ──
    function renderAll(s) {
        const ini   = getInitials(s.name);
        const color = s.avatarColor || PINK;

        // Sidebar footer
        const sidebarAvatar = document.getElementById('sidebar-avatar');
        const sidebarName   = document.getElementById('sidebar-name');
        const sidebarRole   = document.getElementById('sidebar-role');
        if (sidebarAvatar) {
            if (s.avatarPhoto) {
                sidebarAvatar.style.background = `url(${s.avatarPhoto}) center/cover`;
                sidebarAvatar.textContent = '';
            } else {
                sidebarAvatar.style.background = color;
                sidebarAvatar.textContent = ini;
            }
        }
        if (sidebarName) sidebarName.textContent = s.name || '—';
        if (sidebarRole) sidebarRole.textContent = s.role || 'Colaborador';

        // Welcome banner — suporta foto
        const welcomeAvatar   = document.getElementById('welcome-avatar');
        const welcomeGreeting = document.getElementById('welcome-greeting');
        const welcomeName     = document.getElementById('welcome-name');
        const welcomeMeta     = document.getElementById('welcome-meta');
        const welcomeStatus   = document.getElementById('welcome-status');
        const welcomeBadge    = document.getElementById('welcome-badge');

        if (welcomeAvatar) {
            if (s.avatarPhoto) {
                welcomeAvatar.style.backgroundImage    = `url(${s.avatarPhoto})`;
                welcomeAvatar.style.backgroundSize     = 'cover';
                welcomeAvatar.style.backgroundPosition = 'center';
                welcomeAvatar.style.background         = '';
                welcomeAvatar.textContent              = '';
            } else {
                welcomeAvatar.style.backgroundImage = '';
                welcomeAvatar.style.background      = color;
                welcomeAvatar.textContent           = ini;
            }
        }

        if (welcomeGreeting) welcomeGreeting.textContent = greeting + ',';
        if (welcomeName)     welcomeName.textContent     = s.name || '—';
        if (welcomeMeta)     welcomeMeta.textContent     = `${s.role || '—'} · ${s.dept || '—'}`;
        if (welcomeStatus)   welcomeStatus.textContent   = s.status || 'Ativo';

        if (welcomeBadge) {
            const dot = welcomeBadge.querySelector('i');
            if (dot) dot.style.color = s.status === 'Ativo' ? '#4ade80' : s.status === 'Férias' ? '#facc15' : '#f87171';
        }

        // Info cards
        set('info-role',      s.role);
        set('info-dept',      s.dept);
        set('info-admission', formatDate(s.admissionDate));
        set('info-email',     s.email);

        renderComunicados(s.dept);
    }

    function renderComunicados(dept) {
        const comunicadosList = document.getElementById('comunicados-list');
        if (!comunicadosList) return;

        let mensagens = [];
        try {
            const saved = localStorage.getItem('nexus_messages');
            if (saved) {
                const all = JSON.parse(saved);
                mensagens = all.filter(m => m.destino === 'Todos' || m.destino === dept).slice(0, 5);
            }
        } catch { mensagens = []; }

        if (mensagens.length === 0) {
            comunicadosList.innerHTML = `
                <div class="comunicados-empty">
                    <i class="fas fa-bell-slash"></i>
                    Nenhum comunicado disponível para você.
                </div>`;
            return;
        }

        comunicadosList.innerHTML = mensagens.map((m, i) => `
            <div class="comunicado-item" style="animation-delay: ${i * 0.06}s">
                <div class="comunicado-icon"><i class="fas fa-bullhorn"></i></div>
                <div class="comunicado-body">
                    <p class="comunicado-text">${escapeHTML(m.texto)}</p>
                    <div class="comunicado-meta">
                        <span class="comunicado-date"><i class="fas fa-calendar-alt" style="margin-right:4px;opacity:0.6"></i>${escapeHTML(m.data)}</span>
                        <span class="comunicado-dest">${escapeHTML(m.destino)}</span>
                    </div>
                </div>
            </div>`).join('');
    }

    renderAll(session);

    // ── Sync em tempo real ──
    window.addEventListener('storage', (event) => {

        // Alterações feitas pelo próprio colaborador (perfil, avatar, nome…)
        if (event.key === 'nexus_session') {
            try {
                const updated = JSON.parse(event.newValue || 'null');
                if (!updated || updated.email !== session.email) return;
                session = updated;
                renderAll(session);
            } catch {}
            return;
        }

        // Alterações feitas pelo RH
        if (event.key === 'nexus_users') {
            try {
                const users = JSON.parse(event.newValue || '[]');
                const updatedUser = users.find(u => u.email === session.email);
                if (!updatedUser) return;

                const SYNC_FIELDS = ['name','role','dept','status','admissionDate','contractType'];
                const changed = SYNC_FIELDS.some(k => updatedUser[k] !== session[k]);
                if (!changed) return;

                if (updatedUser.status === 'Inativo' || updatedUser.status === 'Bloqueado') {
                    showToast('Conta desativada pelo RH', 'warning', 'Você será desconectado em instantes.');
                    setTimeout(() => { localStorage.removeItem('nexus_session'); window.location.href = '../screens/login.html'; }, 2500);
                    return;
                }

                const { password: _pw, ...cleanUser } = updatedUser;
                session = { ...session, ...cleanUser };
                localStorage.setItem('nexus_session', JSON.stringify(session));
                renderAll(session);
                showToast('Perfil atualizado', 'success', 'Suas informações foram atualizadas pelo RH.');
            } catch {}
            return;
        }

        // Novo comunicado enviado pelo RH
        if (event.key === 'nexus_messages') {
            renderComunicados(session.dept);
        }
    });

    window.logout = function () {
        localStorage.removeItem('nexus_session');
        window.location.href = '../screens/login.html';
    };

    window.showToast = function (title, type = 'success', msg = '') {
        const icons = { success: 'fa-check', error: 'fa-times', warning: 'fa-exclamation-triangle', info: 'fa-info' };
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon"><i class="fas ${icons[type] || icons.success}"></i></div>
            <div class="toast-content">
                <p class="toast-title">${title}</p>
                ${msg ? `<p class="toast-msg">${msg}</p>` : ''}
            </div>
            <button class="toast-close" onclick="this.closest('.toast').classList.add('hide'); setTimeout(()=>this.closest('.toast').remove(),400)">
                <i class="fas fa-times"></i>
            </button>`;
        container.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 400); }, 3500);
    };
});
