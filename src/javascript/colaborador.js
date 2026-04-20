document.addEventListener('DOMContentLoaded', () => {

    // ── Sessão ────────────────────────────────────────────────
    const session = (() => {
        try {
            const s = localStorage.getItem('nexus_session');
            return s ? JSON.parse(s) : null;
        } catch { return null; }
    })();

    // Redireciona se não houver sessão ou for RH
    if (!session || session.profile === 'rh') {
        window.location.href = '../screens/login.html';
        return;
    }

    // ── Sidebar ───────────────────────────────────────────────
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

    topbarMenuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar?.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar();
    });

    sidebarOverlay?.addEventListener('click', closeMobileSidebar);

    if (!isMobile() && localStorage.getItem(SIDEBAR_KEY) === 'collapsed') {
        sidebar?.classList.add('collapsed');
        mainWrapper?.classList.add('sidebar-collapsed');
    }

    window.addEventListener('resize', () => { if (!isMobile()) closeMobileSidebar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isMobile()) closeMobileSidebar(); });

    // ── Preenche dados da sessão ──────────────────────────────
    const initials = session.name
        .split(' ')
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase() || '')
        .join('');

    const greeting = (() => {
        const h = new Date().getHours();
        if (h < 12) return 'Bom dia';
        if (h < 18) return 'Boa tarde';
        return 'Boa noite';
    })();

    const formatDate = (str) => {
        if (!str) return '—';
        const [y, m, d] = str.split('-');
        return `${d}/${m}/${y}`;
    };

    // Sidebar footer
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    const sidebarName   = document.getElementById('sidebar-name');
    const sidebarRole   = document.getElementById('sidebar-role');
    if (sidebarAvatar) sidebarAvatar.textContent = initials;
    if (sidebarName)   sidebarName.textContent   = session.name;
    if (sidebarRole)   sidebarRole.textContent   = session.role || 'Colaborador';

    // Welcome banner
    const welcomeAvatar   = document.getElementById('welcome-avatar');
    const welcomeGreeting = document.getElementById('welcome-greeting');
    const welcomeName     = document.getElementById('welcome-name');
    const welcomeMeta     = document.getElementById('welcome-meta');
    const welcomeStatus   = document.getElementById('welcome-status');
    const welcomeBadge    = document.getElementById('welcome-badge');

    if (welcomeAvatar)   welcomeAvatar.textContent   = initials;
    if (welcomeGreeting) welcomeGreeting.textContent = greeting + ',';
    if (welcomeName)     welcomeName.textContent      = session.name;
    if (welcomeMeta)     welcomeMeta.textContent      = `${session.role || '—'} · ${session.dept || '—'}`;
    if (welcomeStatus)   welcomeStatus.textContent    = session.status || 'Ativo';

    // Badge cor conforme status
    if (welcomeBadge) {
        const dot = welcomeBadge.querySelector('i');
        if (session.status === 'Ativo' && dot) dot.style.color = '#4ade80';
        else if (session.status === 'Férias' && dot) dot.style.color = '#facc15';
        else if (dot) dot.style.color = '#f87171';
    }

    // Info cards
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
    set('info-role',      session.role);
    set('info-dept',      session.dept);
    set('info-admission', formatDate(session.admissionDate));
    set('info-email',     session.email);

    // ── Comunicados ───────────────────────────────────────────
    const comunicadosList = document.getElementById('comunicados-list');

    function renderComunicados() {
        if (!comunicadosList) return;

        let mensagens = [];
        try {
            const saved = localStorage.getItem('nexus_messages');
            if (saved) {
                const all = JSON.parse(saved);
                // Filtra mensagens destinadas ao dept ou a "Todos"
                mensagens = all.filter(m =>
                    m.destino === 'Todos' || m.destino === session.dept
                ).slice(0, 5); // máximo 5 recentes
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

    const escapeHTML = (str) => String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    renderComunicados();

    // ── Logout ────────────────────────────────────────────────
    window.logout = function () {
        localStorage.removeItem('nexus_session');
        window.location.href = '../screens/login.html';
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