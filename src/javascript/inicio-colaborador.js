document.addEventListener('DOMContentLoaded', async () => {
    // ── Auth ──
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles')
        .select('profile, employee_id')
        .eq('id', user.id)
        .single();

    if (profile?.profile !== 'colaborador' || !profile.employee_id) {
        window.location.href = '../screens/login.html';
        return;
    }

    const myEmployeeId = profile.employee_id;

    const { data: emp } = await sb.from('employees').select('*').eq('id', myEmployeeId).single();
    if (!emp) { window.location.href = '../screens/login.html'; return; }

    let myEmployee = emp;

    // ── Sidebar toggle (estado de UI — localStorage é aceitável aqui) ──
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

    // ── Date display ──
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    const dateEl = document.getElementById('topbar-date-text');
    if (dateEl) dateEl.textContent = dateFormatted.replace('.', '').replace(/^\w/, c => c.toUpperCase());
    const welcomeDateEl = document.getElementById('welcome-date-text');
    if (welcomeDateEl) welcomeDateEl.textContent = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

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
    function renderAll(e) {
        const ini   = getInitials(e.name);
        const color = e.avatar_color || PINK;

        const sidebarAvatar = document.getElementById('sidebar-avatar');
        const sidebarName   = document.getElementById('sidebar-name');
        const sidebarRole   = document.getElementById('sidebar-role');
        if (sidebarAvatar) {
            if (e.avatar_url) {
                sidebarAvatar.style.background = `url(${e.avatar_url}) center/cover`;
                sidebarAvatar.textContent = '';
            } else {
                sidebarAvatar.style.background = color;
                sidebarAvatar.textContent = ini;
            }
        }
        if (sidebarName) sidebarName.textContent = e.name || '—';
        if (sidebarRole) sidebarRole.textContent = e.role || 'Colaborador';

        const welcomeAvatar   = document.getElementById('welcome-avatar');
        const welcomeGreeting = document.getElementById('welcome-greeting');
        const welcomeName     = document.getElementById('welcome-name');
        const welcomeMeta     = document.getElementById('welcome-meta');
        const welcomeStatus   = document.getElementById('welcome-status');
        const welcomeBadge    = document.getElementById('welcome-badge');

        if (welcomeAvatar) {
            if (e.avatar_url) {
                welcomeAvatar.style.backgroundImage    = `url(${e.avatar_url})`;
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
        if (welcomeName)     welcomeName.textContent     = e.name || '—';
        if (welcomeMeta)     welcomeMeta.textContent     = `${e.role || '—'} · ${e.dept || '—'}`;
        if (welcomeStatus)   welcomeStatus.textContent   = e.status || 'Ativo';

        if (welcomeBadge) {
            const dot = welcomeBadge.querySelector('i');
            if (dot) dot.style.color = e.status === 'Ativo' ? '#4ade80' : e.status === 'Férias' ? '#facc15' : '#f87171';
        }

        set('info-role',      e.role);
        set('info-dept',      e.dept);
        set('info-admission', formatDate(e.admission_date));
        set('info-email',     e.email);

        renderComunicados(e.dept);
    }

    async function renderComunicados(dept) {
        const comunicadosList = document.getElementById('comunicados-list');
        if (!comunicadosList) return;

        const { data: msgs } = await sb.from('messages')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(5);

        const lista = msgs || [];

        if (lista.length === 0) {
            comunicadosList.innerHTML = `
                <div class="comunicados-empty">
                    <i class="fas fa-bell-slash"></i>
                    Nenhum comunicado disponível para você.
                </div>`;
            return;
        }

        comunicadosList.innerHTML = lista.map((m, i) => {
            const dateStr = new Date(m.created_at).toLocaleDateString('pt-BR');
            return `
            <div class="comunicado-item" style="animation-delay: ${i * 0.06}s">
                <div class="comunicado-icon"><i class="fas fa-bullhorn"></i></div>
                <div class="comunicado-body">
                    <p class="comunicado-text">${escapeHTML(m.texto)}</p>
                    <div class="comunicado-meta">
                        <span class="comunicado-date"><i class="fas fa-calendar-alt" style="margin-right:4px;opacity:0.6"></i>${dateStr}</span>
                        <span class="comunicado-dest">${escapeHTML(m.destino)}</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    renderAll(myEmployee);

    // ── Realtime sync ──
    sb.channel('inicio-colab')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'employees',
            filter: `id=eq.${myEmployeeId}`
        }, (payload) => {
            const updated = payload.new;
            if (updated.status === 'Inativo' || updated.status === 'Bloqueado') {
                showToast('Conta desativada pelo RH', 'warning', 'Você será desconectado em instantes.');
                setTimeout(async () => { await sb.auth.signOut(); window.location.href = '../screens/login.html'; }, 2500);
                return;
            }
            myEmployee = { ...myEmployee, ...updated };
            renderAll(myEmployee);
            showToast('Perfil atualizado', 'success', 'Suas informações foram atualizadas pelo RH.');
        })
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages'
        }, () => {
            renderComunicados(myEmployee.dept);
        })
        .subscribe();

    window.logout = async function () {
        await sb.auth.signOut();
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
