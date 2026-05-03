/* comunicados-colaborador.js — Supabase */

document.addEventListener('DOMContentLoaded', async () => {
    // ─── Session ─────────────────────────────────────────────
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles').select('profile, employee_id').eq('id', user.id).single();
    if (profile?.profile !== 'colaborador' || !profile.employee_id) { window.location.href = '../screens/login.html'; return; }

    const { data: employee } = await sb.from('employees').select('id,name,role,dept,avatar_color').eq('id', profile.employee_id).single();
    if (!employee) { window.location.href = '../screens/login.html'; return; }

    const myEmployeeId = employee.id;
    const myDept       = employee.dept || '';

    // ─── Sidebar ─────────────────────────────────────────────
    const ini   = (employee.name || '?').split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join('');
    const color = employee.avatar_color || '#6366f1';
    const sidebarAvatar = document.getElementById('sidebar-avatar');
    const sidebarName   = document.getElementById('sidebar-name');
    const sidebarRole   = document.getElementById('sidebar-role');
    if (sidebarAvatar) { sidebarAvatar.style.background = color; sidebarAvatar.textContent = ini; }
    if (sidebarName)   sidebarName.textContent = employee.name || '—';
    if (sidebarRole)   sidebarRole.textContent = employee.role || 'Colaborador';

    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');
    const isMobile       = () => window.innerWidth <= 768;
    const openSide       = () => { sidebar?.classList.add('open');    sidebarOverlay?.classList.add('active');    document.body.style.overflow = 'hidden'; };
    const closeSide      = () => { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; };
    sidebarToggle?.addEventListener('click', e => { e.stopPropagation(); isMobile() ? (sidebar?.classList.contains('open') ? closeSide() : openSide()) : (() => { const c = sidebar?.classList.toggle('collapsed'); mainWrapper?.classList.toggle('sidebar-collapsed', c); })(); });
    topbarMenuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeSide() : openSide(); });
    sidebarOverlay?.addEventListener('click', closeSide);
    window.addEventListener('resize', () => { if (!isMobile()) closeSide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isMobile()) closeSide(); });

    window.logout = async () => { await sb.auth.signOut(); window.location.href = '../screens/login.html'; };

    // ─── State ───────────────────────────────────────────────
    const searchInput  = document.getElementById('search-input');
    const searchClear  = document.getElementById('search-clear');
    const lista        = document.getElementById('comunicados-list');
    const unreadBadge  = document.getElementById('unread-badge');
    const unreadCount  = document.getElementById('unread-count');
    let filtroAtivo = 'todos-vis';
    let allMsgs     = [];
    let lidos       = new Set();

    // ─── Data ────────────────────────────────────────────────
    async function loadData() {
        const orFilter = myDept ? `destino.eq.Todos,destino.eq.${myDept}` : 'destino.eq.Todos';
        const [{ data: msgs }, { data: reads }] = await Promise.all([
            sb.from('messages').select('*').or(orFilter).order('created_at', { ascending: false }),
            sb.from('message_reads').select('message_id').eq('employee_id', myEmployeeId),
        ]);
        allMsgs = msgs || [];
        lidos   = new Set((reads || []).map(r => r.message_id));
    }

    async function marcarLido(msgId) {
        if (lidos.has(msgId)) return;
        lidos.add(msgId);
        await sb.from('message_reads').upsert({ message_id: msgId, employee_id: myEmployeeId }, { onConflict: 'message_id,employee_id' });
    }

    async function marcarTodosLidos() {
        const naoLidos = allMsgs.filter(m => !lidos.has(m.id));
        if (!naoLidos.length) return;
        naoLidos.forEach(m => lidos.add(m.id));
        await sb.from('message_reads').upsert(
            naoLidos.map(m => ({ message_id: m.id, employee_id: myEmployeeId })),
            { onConflict: 'message_id,employee_id' }
        );
    }

    const escHTML = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    // ─── Render ───────────────────────────────────────────────
    function render() {
        const q = searchInput?.value.toLowerCase().trim() || '';
        const naoLidos = allMsgs.filter(m => !lidos.has(m.id)).length;

        document.getElementById('stat-total').textContent = allMsgs.length;
        document.getElementById('stat-todos').textContent = allMsgs.filter(m => m.destino === 'Todos').length;
        document.getElementById('stat-dept').textContent  = allMsgs.filter(m => m.destino !== 'Todos').length;

        if (unreadBadge && unreadCount) {
            unreadBadge.classList.toggle('hidden', naoLidos === 0);
            unreadCount.textContent = naoLidos;
        }

        let filtered = filtroAtivo === 'nao-lidos' ? allMsgs.filter(m => !lidos.has(m.id)) : allMsgs;
        if (q) filtered = filtered.filter(m => m.texto.toLowerCase().includes(q) || m.destino.toLowerCase().includes(q));

        if (!filtered.length) {
            lista.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><p>${q || filtroAtivo === 'nao-lidos' ? 'Nenhum resultado encontrado' : 'Nenhum comunicado disponível'}</p><span>${q ? `Nenhum resultado para "${escHTML(q)}"` : filtroAtivo === 'nao-lidos' ? 'Todos os comunicados já foram lidos.' : 'Quando o RH enviar comunicados, eles aparecerão aqui.'}</span></div>`;
            return;
        }

        const destIconMap = {
            'Todos': { icon:'fa-globe', cls:'dest--todos' }, 'TI': { icon:'fa-code', cls:'dest--ti' },
            'RH': { icon:'fa-user-tie', cls:'dest--rh' }, 'Financeiro': { icon:'fa-dollar-sign', cls:'dest--fin' },
            'Marketing': { icon:'fa-ad', cls:'dest--mkt' }, 'Jurídico': { icon:'fa-gavel', cls:'dest--jur' },
            'Administrativo': { icon:'fa-building', cls:'dest--adm' },
        };

        const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR');

        lista.innerHTML = filtered.map(m => {
            const lido     = lidos.has(m.id);
            const destInfo = destIconMap[m.destino] || { icon:'fa-users', cls:'dest--outros' };
            return `
                <div class="comunicado-card${lido ? '' : ' nao-lido'}" data-id="${m.id}">
                    <div class="comunicado-icon-wrap ${destInfo.cls}"><i class="fas fa-bullhorn"></i></div>
                    <div class="comunicado-body">
                        <div class="comunicado-top">
                            <div class="comunicado-meta">
                                <span class="comunicado-data"><i class="fas fa-calendar-alt"></i> ${escHTML(fmtDate(m.created_at))}</span>
                                <span class="comunicado-dest ${destInfo.cls}"><i class="fas ${destInfo.icon}"></i> ${escHTML(m.destino)}</span>
                            </div>
                            ${!lido ? '<span class="badge-novo"><i class="fas fa-circle"></i> Novo</span>' : ''}
                        </div>
                        <p class="comunicado-texto">${escHTML(m.texto)}</p>
                    </div>
                </div>`;
        }).join('');

        lista.querySelectorAll('.comunicado-card').forEach(card => {
            card.addEventListener('click', async () => {
                const id = card.dataset.id;
                if (!lidos.has(id)) {
                    await marcarLido(id);
                    render();
                }
            });
        });
    }

    // ─── Filtros ──────────────────────────────────────────────
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filtroAtivo = btn.dataset.filter;
            render();
        });
    });

    searchInput?.addEventListener('input', () => {
        searchClear?.classList.toggle('hidden', !searchInput.value.trim());
        render();
    });
    searchClear?.addEventListener('click', () => { searchInput.value = ''; searchClear.classList.add('hidden'); render(); });

    // ─── Realtime ─────────────────────────────────────────────
    sb.channel('messages-colab')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => {
            await loadData();
            render();
        })
        .subscribe();

    window.addEventListener('beforeunload', () => { marcarTodosLidos(); });

    // ─── Init ─────────────────────────────────────────────────
    await loadData();
    render();
});
