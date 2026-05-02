document.addEventListener('DOMContentLoaded', () => {
    const session = (() => {
        try { return JSON.parse(localStorage.getItem('nexus_session') || 'null'); }
        catch { return null; }
    })();

    if (!session || session.profile === 'rh') {
        window.location.href = '../screens/login.html';
        return;
    }

    const MSG_KEY    = 'nexus_messages';
    const LIDOS_KEY  = `nexus_lidos_${session.email}`;
    const SIDEBAR_KEY = 'sidebarState_colab';

    // ── Sidebar ──
    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');

    const isMobile = () => window.innerWidth <= 768;

    const openSidebar  = () => { sidebar?.classList.add('open'); sidebarOverlay?.classList.add('active'); document.body.style.overflow = 'hidden'; };
    const closeSidebar = () => { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; };

    sidebarToggle?.addEventListener('click', e => {
        e.stopPropagation();
        if (isMobile()) { sidebar?.classList.contains('open') ? closeSidebar() : openSidebar(); }
        else { const c = sidebar?.classList.toggle('collapsed'); mainWrapper?.classList.toggle('sidebar-collapsed', c); localStorage.setItem(SIDEBAR_KEY, c ? 'collapsed' : 'expanded'); }
    });
    topbarMenuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeSidebar() : openSidebar(); });
    sidebarOverlay?.addEventListener('click', closeSidebar);

    if (!isMobile() && localStorage.getItem(SIDEBAR_KEY) === 'collapsed') {
        sidebar?.classList.add('collapsed');
        mainWrapper?.classList.add('sidebar-collapsed');
    }

    window.addEventListener('resize', () => { if (!isMobile()) closeSidebar(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isMobile()) closeSidebar(); });

    // Sidebar user info
    const ini   = (session.name || '?').split(' ').slice(0,2).map(w => w[0]?.toUpperCase() || '').join('');
    const color = session.avatarColor || '#6366f1';
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    const sidebarName   = document.getElementById('sidebar-name');
    const sidebarRole   = document.getElementById('sidebar-role');
    if (sidebarAvatar) {
        if (session.avatarPhoto) {
            sidebarAvatar.style.background = `url(${session.avatarPhoto}) center/cover`;
            sidebarAvatar.textContent = '';
        } else {
            sidebarAvatar.style.background = color;
            sidebarAvatar.textContent = ini;
        }
    }
    if (sidebarName)   sidebarName.textContent = session.name || '—';
    if (sidebarRole)   sidebarRole.textContent = session.role || 'Colaborador';

    window.logout = () => { localStorage.removeItem('nexus_session'); window.location.href = '../screens/login.html'; };

    const searchInput  = document.getElementById('search-input');
    const searchClear  = document.getElementById('search-clear');
    const lista        = document.getElementById('comunicados-list');
    const unreadBadge  = document.getElementById('unread-badge');
    const unreadCount  = document.getElementById('unread-count');

    let filtroAtivo = 'todos-vis';

    // ── Helpers ──
    const escapeHTML = s => String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    function getMensagens() {
        try { return JSON.parse(localStorage.getItem(MSG_KEY) || '[]'); }
        catch { return []; }
    }

    function getLidos() {
        try { return new Set(JSON.parse(localStorage.getItem(LIDOS_KEY) || '[]')); }
        catch { return new Set(); }
    }

    function marcarLido(id) {
        const lidos = getLidos();
        lidos.add(id);
        localStorage.setItem(LIDOS_KEY, JSON.stringify([...lidos]));
    }

    function marcarTodosLidos(ids) {
        const lidos = getLidos();
        ids.forEach(id => lidos.add(id));
        localStorage.setItem(LIDOS_KEY, JSON.stringify([...lidos]));
    }

    // Filtra mensagens relevantes para o colaborador
    function mensagensVisiveis() {
        const dept = session.dept || '';
        return getMensagens().filter(m =>
            m.destino === 'Todos' || m.destino === dept
        );
    }

    // ── Render ──
    function render() {
        const msgs  = mensagensVisiveis();
        const lidos = getLidos();
        const q     = searchInput?.value.toLowerCase().trim() || '';

        // Stats
        const para_todos = msgs.filter(m => m.destino === 'Todos').length;
        const para_dept  = msgs.filter(m => m.destino !== 'Todos').length;
        const nao_lidos  = msgs.filter(m => !lidos.has(m.id)).length;

        document.getElementById('stat-total').textContent = msgs.length;
        document.getElementById('stat-todos').textContent = para_todos;
        document.getElementById('stat-dept').textContent  = para_dept;

        if (unreadBadge && unreadCount) {
            if (nao_lidos > 0) {
                unreadBadge.classList.remove('hidden');
                unreadCount.textContent = nao_lidos;
            } else {
                unreadBadge.classList.add('hidden');
            }
        }

        // Filtragem por aba
        let filtered = msgs;
        if (filtroAtivo === 'nao-lidos') filtered = msgs.filter(m => !lidos.has(m.id));

        // Filtragem por busca
        if (q) filtered = filtered.filter(m =>
            m.texto.toLowerCase().includes(q) ||
            m.destino.toLowerCase().includes(q) ||
            m.data.includes(q)
        );

        // Vazio
        if (filtered.length === 0) {
            lista.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-bell-slash"></i>
                    <p>${q || filtroAtivo === 'nao-lidos' ? 'Nenhum resultado encontrado' : 'Nenhum comunicado disponível'}</p>
                    <span>${q ? `Nenhum resultado para "${escapeHTML(q)}"` : filtroAtivo === 'nao-lidos' ? 'Todos os comunicados já foram lidos.' : 'Quando o RH enviar comunicados, eles aparecerão aqui.'}</span>
                </div>`;
            return;
        }

        const destIconMap = {
            'Todos':          { icon: 'fa-globe',       cls: 'dest--todos'   },
            'TI':             { icon: 'fa-code',        cls: 'dest--ti'      },
            'RH':             { icon: 'fa-user-tie',    cls: 'dest--rh'      },
            'Financeiro':     { icon: 'fa-dollar-sign', cls: 'dest--fin'     },
            'Marketing':      { icon: 'fa-ad',          cls: 'dest--mkt'     },
            'Jurídico':       { icon: 'fa-gavel',       cls: 'dest--jur'     },
            'Administrativo': { icon: 'fa-building',    cls: 'dest--adm'     },
        };

        lista.innerHTML = filtered.map(m => {
            const lido     = lidos.has(m.id);
            const destInfo = destIconMap[m.destino] || { icon: 'fa-users', cls: 'dest--outros' };
            const novoBadge = !lido
                ? `<span class="badge-novo"><i class="fas fa-circle"></i> Novo</span>`
                : '';

            return `
                <div class="comunicado-card${lido ? '' : ' nao-lido'}" data-id="${m.id}">
                    <div class="comunicado-icon-wrap ${destInfo.cls}">
                        <i class="fas fa-bullhorn"></i>
                    </div>
                    <div class="comunicado-body">
                        <div class="comunicado-top">
                            <div class="comunicado-meta">
                                <span class="comunicado-data">
                                    <i class="fas fa-calendar-alt"></i> ${escapeHTML(m.data)}
                                </span>
                                <span class="comunicado-dest ${destInfo.cls}">
                                    <i class="fas ${destInfo.icon}"></i> ${escapeHTML(m.destino)}
                                </span>
                            </div>
                            ${novoBadge}
                        </div>
                        <p class="comunicado-texto">${escapeHTML(m.texto)}</p>
                    </div>
                </div>`;
        }).join('');

        // Marca como lido ao clicar
        lista.querySelectorAll('.comunicado-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = Number(card.dataset.id);
                if (!lidos.has(id)) {
                    marcarLido(id);
                    render();
                }
            });
        });
    }

    // ── Filtros ──
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filtroAtivo = btn.dataset.filter;
            render();
        });
    });

    // ── Busca ──
    searchInput?.addEventListener('input', () => {
        searchClear?.classList.toggle('hidden', searchInput.value.trim().length === 0);
        render();
    });

    searchClear?.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.classList.add('hidden');
        render();
    });

    // ── Sync em tempo real ──
    window.addEventListener('storage', e => {
        if (e.key === MSG_KEY) render();
    });

    // Marca todos como lidos ao sair da página
    window.addEventListener('beforeunload', () => {
        marcarTodosLidos(mensagensVisiveis().map(m => m.id));
    });

    render();
});
