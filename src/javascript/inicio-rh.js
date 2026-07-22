document.addEventListener('DOMContentLoaded', async () => {
    const auth = await NexusAuth.requireProfile('Administrador');
    if (!auth) return;

    setupSidebar();
    setupCalendar();
    setupThemeToggle();
    loadUserInfo(auth.user, auth.profile);

    const now = new Date();
    const dateFormatted = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    const topbarDateEl = document.getElementById('topbar-date-text');
    if (topbarDateEl) topbarDateEl.textContent = dateFormatted.replace('.', '').replace(/^\w/, (c) => c.toUpperCase());

    const h = now.getHours();
    const greetingEl = document.getElementById('welcome-greeting');
    if (greetingEl) greetingEl.textContent = (h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite') + ',';

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
        const { data: emp } = await sb.from('employees').select('name, avatar_color').eq('id', profile.employee_id).single();
        if (emp?.name) {
            nome = emp.name;
            iniciais = nome
                .split(' ')
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase() || '')
                .join('');
        }
        if (emp?.avatar_color) avatarColor = emp.avatar_color;
    }

    const sidebarAvatar = document.getElementById('rh-sidebar-avatar');
    const sidebarName = document.getElementById('rh-sidebar-name');
    const welcomeAvatar = document.getElementById('welcome-avatar');
    const welcomeName = document.getElementById('welcome-name');

    if (sidebarAvatar) {
        sidebarAvatar.textContent = iniciais;
        sidebarAvatar.style.background = avatarColor;
    }
    if (sidebarName) sidebarName.textContent = nome;
    if (welcomeAvatar) {
        welcomeAvatar.textContent = iniciais;
        welcomeAvatar.style.background = avatarColor;
    }
    if (welcomeName) welcomeName.textContent = nome;
}

function setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const menuBtn = document.getElementById('topbar-menu-btn');
    const overlay = document.getElementById('sidebar-overlay');
    const wrapper = document.getElementById('main-wrapper');
    if (!sidebar) return;

    const isMobile = () => window.innerWidth <= 768;
    const openMob = () => {
        sidebar.classList.add('open');
        overlay?.classList.add('active');
        document.body.style.overflow = 'hidden';
    };
    const closeMob = () => {
        sidebar.classList.remove('open');
        overlay?.classList.remove('active');
        document.body.style.overflow = '';
    };

    toggleBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isMobile()) {
            sidebar.classList.contains('open') ? closeMob() : openMob();
        } else {
            const c = sidebar.classList.toggle('collapsed');
            wrapper?.classList.toggle('sidebar-collapsed', c);
        }
    });
    menuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.contains('open') ? closeMob() : openMob();
    });
    overlay?.addEventListener('click', closeMob);
    window.addEventListener('resize', () => {
        if (!isMobile()) closeMob();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isMobile()) closeMob();
    });
}

function setupThemeToggle() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;

    function syncIcon() {
        const isDark = window.NexusTheme?.current() === 'dark';
        btn.innerHTML = `<i class="fas fa-${isDark ? 'sun' : 'moon'}"></i>`;
        btn.setAttribute('aria-label', isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro');
    }

    syncIcon();
    btn.addEventListener('click', () => {
        window.NexusTheme?.toggle();
        syncIcon();
    });
}

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function setupCalendar() {
    const trigger = document.getElementById('topbar-date');
    const popover = document.getElementById('calendar-popover');
    const titleEl = document.getElementById('calendar-title');
    const gridEl = document.getElementById('calendar-grid');
    const prevBtn = document.getElementById('calendar-prev');
    const nextBtn = document.getElementById('calendar-next');
    if (!trigger || !popover) return;

    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();

    function render() {
        titleEl.textContent = `${MESES_PT[viewMonth]} ${viewYear}`;

        const startOffset = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            cells.push({ day: d, muted: false, isToday });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells
            .map(
                (c) =>
                    `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}">${c.day}</button>`
            )
            .join('');
    }

    function open() {
        render();
        popover.classList.add('open');
        trigger.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onOutsideClick);
        document.addEventListener('keydown', onEscape);
    }

    function close() {
        popover.classList.remove('open');
        trigger.classList.remove('active');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onOutsideClick);
        document.removeEventListener('keydown', onEscape);
    }

    function onOutsideClick(e) {
        if (!popover.contains(e.target) && !trigger.contains(e.target)) close();
    }

    function onEscape(e) {
        if (e.key === 'Escape') close();
    }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });
    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            trigger.click();
        }
    });

    prevBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth--;
        if (viewMonth < 0) {
            viewMonth = 11;
            viewYear--;
        }
        render();
    });
    nextBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth++;
        if (viewMonth > 11) {
            viewMonth = 0;
            viewYear++;
        }
        render();
    });
}
