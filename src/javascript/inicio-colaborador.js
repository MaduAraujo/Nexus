document.addEventListener('DOMContentLoaded', async () => {
    // ── Auth ──
    const auth = await NexusAuth.requireProfile('colaborador', '*');
    if (!auth) return;
    const myEmployeeId = auth.profile.employee_id;
    let myEmployee      = auth.employee;

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

    // ── Tema claro/escuro ──
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    function syncThemeIcon() {
        const isDark = window.NexusTheme?.current() === 'dark';
        themeToggleBtn.innerHTML = `<i class="fas fa-${isDark ? 'sun' : 'moon'}"></i>`;
        themeToggleBtn.setAttribute('aria-label', isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro');
    }
    if (themeToggleBtn) {
        syncThemeIcon();
        themeToggleBtn.addEventListener('click', () => {
            window.NexusTheme?.toggle();
            syncThemeIcon();
        });
    }

    // ── Date display ──
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    const dateEl = document.getElementById('topbar-date-text');
    if (dateEl) dateEl.textContent = dateFormatted.replace('.', '').replace(/^\w/, c => c.toUpperCase());
    const welcomeDateEl = document.getElementById('welcome-date-text');
    if (welcomeDateEl) welcomeDateEl.textContent = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    setupCalendar();

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
                welcomeAvatar.style.background = `url(${e.avatar_url}) center/cover`;
                welcomeAvatar.textContent = '';
            } else {
                welcomeAvatar.style.background = color;
                welcomeAvatar.textContent = ini;
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

        comunicadosList.innerHTML = lista.map((m, i) => `
            <div class="comunicado-item" style="animation-delay: ${i * 0.06}s">
                <div class="comunicado-icon"><i class="fas fa-bullhorn"></i></div>
                <div class="comunicado-body">
                    <p class="comunicado-text">${escapeHTML(m.texto)}</p>
                    <div class="comunicado-meta">
                        <span class="comunicado-dest">${escapeHTML(m.destino)}</span>
                    </div>
                </div>
            </div>`).join('');
    }

    // ── Jornada de Integração (onboarding 30/60/90 dias) ──
    // Mostrada só dentro da janela de integração (até 100 dias de casa) — depois
    // disso a jornada deixa de fazer sentido e o card simplesmente some.
    const STAGE_LABEL = { 30: '30 dias', 60: '60 dias', 90: '90 dias' };
    let onboardingTasks    = [];
    let onboardingDoneIds  = new Set();

    function daysSinceAdmission(admissionDate) {
        if (!admissionDate) return null;
        const adm = new Date(admissionDate + 'T00:00:00');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        return Math.floor((today - adm) / 86400000);
    }

    async function loadOnboarding(employeeId, admissionDate) {
        const card = document.getElementById('onboarding-card');
        if (!card) return;
        const dias = daysSinceAdmission(admissionDate);
        if (dias === null || dias < 0 || dias > 100) { card.classList.add('hidden'); return; }

        const [{ data: tasks }, { data: progress }] = await Promise.all([
            sb.from('onboarding_tasks').select('*').order('dias', { ascending: true }).order('ordem', { ascending: true }),
            sb.from('onboarding_progress').select('task_id').eq('employee_id', employeeId),
        ]);
        onboardingTasks   = tasks || [];
        onboardingDoneIds = new Set((progress || []).map(p => p.task_id));

        if (!onboardingTasks.length) { card.classList.add('hidden'); return; }
        card.classList.remove('hidden');
        renderOnboarding(dias);
    }

    function renderOnboarding(diasDeCasa) {
        const stagesEl = document.getElementById('onboarding-stages');
        const fillEl   = document.getElementById('onboarding-progress-fill');
        const labelEl  = document.getElementById('onboarding-progress-label');
        if (!stagesEl) return;

        const total = onboardingTasks.length;
        const done  = onboardingTasks.filter(t => onboardingDoneIds.has(t.id)).length;
        if (fillEl)  fillEl.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
        if (labelEl) labelEl.textContent = `${done}/${total}`;

        const stages = [30, 60, 90].map(dias => ({
            dias,
            tasks: onboardingTasks.filter(t => t.dias === dias),
            atual: diasDeCasa <= dias,
        })).filter(s => s.tasks.length);

        stagesEl.innerHTML = stages.map(s => {
            const doneInStage = s.tasks.filter(t => onboardingDoneIds.has(t.id)).length;
            return `
            <div class="onboarding-stage">
                <div class="onboarding-stage-title">
                    <i class="fas ${s.atual ? 'fa-hourglass-half' : 'fa-flag-checkered'}" style="color:${s.atual ? '#f59e0b' : '#10b981'}"></i>
                    ${STAGE_LABEL[s.dias]} <span class="stage-count">(${doneInStage}/${s.tasks.length})</span>
                </div>
                ${s.tasks.map(t => `
                    <label class="onboarding-task ${onboardingDoneIds.has(t.id) ? 'done' : ''}">
                        <input type="checkbox" ${onboardingDoneIds.has(t.id) ? 'checked' : ''} onchange="toggleOnboardingTask('${t.id}', this.checked)">
                        <div class="onboarding-task-body">
                            <span class="onboarding-task-title">${escapeHTML(t.titulo)}</span>
                            ${t.descricao ? `<span class="onboarding-task-desc">${escapeHTML(t.descricao)}</span>` : ''}
                        </div>
                    </label>`).join('')}
            </div>`;
        }).join('');
    }

    window.toggleOnboardingTask = async function (taskId, checked) {
        if (checked) {
            const { error } = await sb.from('onboarding_progress').insert({ employee_id: myEmployeeId, task_id: taskId });
            if (!error) onboardingDoneIds.add(taskId);
        } else {
            const { error } = await sb.from('onboarding_progress').delete().eq('employee_id', myEmployeeId).eq('task_id', taskId);
            if (!error) onboardingDoneIds.delete(taskId);
        }
        renderOnboarding(daysSinceAdmission(myEmployee.admission_date));
    };

    // ── "Minha Equipe" — só aparece para quem tem colaboradores sob sua liderança ──
    async function checkIsManager() {
        const { data: managed } = await sb.from('employees').select('id').eq('manager_id', myEmployeeId);
        const teamIds = (managed || []).map(m => m.id);
        document.getElementById('nav-item-equipe')?.classList.toggle('hidden', !teamIds.length);
        document.getElementById('quick-card-equipe')?.classList.toggle('hidden', !teamIds.length);
        if (!teamIds.length) return;

        const { data: pending } = await sb.from('vacations').select('id').in('employee_id', teamIds).eq('status', 'pendente');
        const count = pending?.length || 0;
        const descEl = document.getElementById('quick-equipe-desc');
        if (descEl) descEl.textContent = count > 0 ? `${count} férias pendente${count > 1 ? 's' : ''}` : 'Aprovar férias';
    }

    renderAll(myEmployee);
    await loadOnboarding(myEmployeeId, myEmployee.admission_date);
    await checkIsManager();

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

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function setupCalendar() {
    const trigger  = document.getElementById('topbar-date');
    const popover  = document.getElementById('calendar-popover');
    const titleEl  = document.getElementById('calendar-title');
    const gridEl   = document.getElementById('calendar-grid');
    const prevBtn  = document.getElementById('calendar-prev');
    const nextBtn  = document.getElementById('calendar-next');
    if (!trigger || !popover) return;

    const today = new Date();
    let viewYear  = today.getFullYear();
    let viewMonth = today.getMonth();

    function render() {
        titleEl.textContent = `${MESES_PT[viewMonth]} ${viewYear}`;

        const startOffset     = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth     = new Date(viewYear, viewMonth + 1, 0).getDate();
        const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

        const cells = [];
        for (let i = startOffset - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, muted: true });
        for (let d = 1; d <= daysInMonth; d++) {
            const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
            cells.push({ day: d, muted: false, isToday });
        }
        let next = 1;
        while (cells.length % 7 !== 0) cells.push({ day: next++, muted: true });

        gridEl.innerHTML = cells.map(c =>
            `<button type="button" class="calendar-day${c.muted ? ' calendar-day--muted' : ''}${c.isToday ? ' calendar-day--today' : ''}">${c.day}</button>`
        ).join('');
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

    function onEscape(e) { if (e.key === 'Escape') close(); }

    trigger.addEventListener('click', e => {
        e.stopPropagation();
        popover.classList.contains('open') ? close() : open();
    });
    trigger.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger.click(); }
    });

    prevBtn?.addEventListener('click', e => {
        e.stopPropagation();
        viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        render();
    });
    nextBtn?.addEventListener('click', e => {
        e.stopPropagation();
        viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        render();
    });
}
