document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles').select('profile, employee_id').eq('id', user.id).single();
    if (profile?.profile !== 'Administrador') { window.location.href = '../screens/login.html'; return; }

    setupSidebar();
    loadUserInfo(user, profile);

    const now = new Date();
    const welcomeDateEl = document.getElementById('welcome-date-text');
    if (welcomeDateEl) welcomeDateEl.textContent = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    const h = now.getHours();
    const greetingEl = document.getElementById('welcome-greeting');
    if (greetingEl) greetingEl.textContent = (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite') + ',';

    await Promise.all([loadStats(), loadComunicados()]);

    window.logout = async function () {
        await sb.auth.signOut();
        window.location.href = '../screens/login.html';
    };
});

async function loadUserInfo(user, profile) {
    let nome = 'Administrador';
    let iniciais = 'ADM';
    let avatarColor = '#6366f1';

    if (profile?.employee_id) {
        const { data: emp } = await sb.from('employees')
            .select('name, avatar_color')
            .eq('id', profile.employee_id)
            .single();
        if (emp?.name) {
            nome = emp.name;
            iniciais = nome.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');
        }
        if (emp?.avatar_color) avatarColor = emp.avatar_color;
    }

    const sidebarAvatar = document.getElementById('rh-sidebar-avatar');
    const sidebarName   = document.getElementById('rh-sidebar-name');
    const welcomeAvatar = document.getElementById('welcome-avatar');
    const welcomeName   = document.getElementById('welcome-name');

    if (sidebarAvatar) { sidebarAvatar.textContent = iniciais; sidebarAvatar.style.background = avatarColor; }
    if (sidebarName)   sidebarName.textContent = nome;
    if (welcomeAvatar) { welcomeAvatar.textContent = iniciais; welcomeAvatar.style.background = avatarColor; }
    if (welcomeName)   welcomeName.textContent = nome;
}

function setupSidebar() {
    const sidebar   = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const menuBtn   = document.getElementById('topbar-menu-btn');
    const overlay   = document.getElementById('sidebar-overlay');
    const wrapper   = document.getElementById('main-wrapper');
    if (!sidebar) return;

    const isMobile = () => window.innerWidth <= 768;
    const openMob  = () => { sidebar.classList.add('open');    overlay?.classList.add('active');    document.body.style.overflow = 'hidden'; };
    const closeMob = () => { sidebar.classList.remove('open'); overlay?.classList.remove('active'); document.body.style.overflow = ''; };

    toggleBtn?.addEventListener('click', e => {
        e.stopPropagation();
        if (isMobile()) {
            sidebar.classList.contains('open') ? closeMob() : openMob();
        } else {
            const c = sidebar.classList.toggle('collapsed');
            wrapper?.classList.toggle('sidebar-collapsed', c);
        }
    });
    menuBtn?.addEventListener('click',  e => { e.stopPropagation(); sidebar.classList.contains('open') ? closeMob() : openMob(); });
    overlay?.addEventListener('click',  closeMob);
    window.addEventListener('resize',   () => { if (!isMobile()) closeMob(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isMobile()) closeMob(); });
}

async function loadStats() {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [{ data: emps }, { data: vacations }, { data: messages }] = await Promise.all([
        sb.from('employees').select('id, status'),
        sb.from('vacations').select('start_date, end_date, status'),
        sb.from('messages').select('id'),
    ]);

    const ativos    = (emps     || []).filter(e => e.status === 'Ativo').length;
    const emFerias  = (vacations || []).filter(v => {
        if (v.status !== 'aprovado') return false;
        const s = new Date(v.start_date + 'T00:00:00');
        const e = new Date(v.end_date   + 'T00:00:00');
        return s <= today && today <= e;
    }).length;
    const pendentes = (vacations || []).filter(v => v.status === 'pendente').length;
    const totalMsgs = (messages  || []).length;

    setText('info-ativos',      ativos);
    setText('info-ferias',      emFerias);
    setText('info-pendentes',   pendentes);
    setText('info-comunicados', totalMsgs);
}

async function loadComunicados() {
    const container = document.getElementById('comunicados-list');
    if (!container) return;

    const { data: msgs } = await sb.from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    const lista = msgs || [];
    if (!lista.length) {
        container.innerHTML = `
            <div class="comunicados-empty">
                <i class="fas fa-bell-slash"></i>
                Nenhum comunicado disponível.
            </div>`;
        return;
    }

    container.innerHTML = lista.map((m, i) => {
        const dateStr = new Date(m.created_at).toLocaleDateString('pt-BR');
        return `
        <div class="comunicado-item" style="animation-delay:${i * 0.06}s">
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

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '—';
}

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
