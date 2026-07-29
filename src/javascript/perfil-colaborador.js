document.addEventListener('DOMContentLoaded', async () => {
    window.switchPTab = function (btn, tabId) {
        document.querySelectorAll('.ptab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.ptab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById('ptab-' + tabId);
        if (panel) panel.classList.add('active');
    };

    const auth = await NexusAuth.requireProfile('colaborador', '*');
    if (!auth) return;
    const myEmployeeId = auth.profile.employee_id;
    const myProfile = auth.profile.profile;
    let myEmployee = auth.employee;

    const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#14b8a6', '#f97316', '#84cc16'];
    const NOTIF_DEFAULTS = { comunicados: true, holerite: true, ferias: true, horas: false, seguranca: true };

    const initials = (n) =>
        (n || '?')
            .split(' ')
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() || '')
            .join('');
    const formatDate = (s) => {
        if (!s) return '—';
        const [y, m, d] = s.split('-');
        return `${d}/${m}/${y}`;
    };
    const setEl = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.textContent = v || '—';
    };
    const setInput = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.value = v || '';
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
            <button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),400)">
                <i class="fas fa-times"></i>
            </button>`;
        container.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => {
            toast.classList.remove('show');
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    };

    window.toggleEditInfo = function () {
        const view = document.getElementById('info-view');
        const form = document.getElementById('info-edit');
        const btn = document.getElementById('btn-edit-info');
        view?.classList.add('hidden');
        form?.classList.remove('hidden');
        if (btn) btn.style.display = 'none';
        setInput('edit-name', myEmployee.name);
        setInput('edit-phone', myEmployee.telefone);
        setInput('edit-bio', myEmployee.bio);
    };

    window.cancelEditInfo = function () {
        document.getElementById('info-view')?.classList.remove('hidden');
        document.getElementById('info-edit')?.classList.add('hidden');
        const btn = document.getElementById('btn-edit-info');
        if (btn) btn.style.display = '';
    };

    window.saveInfo = async function () {
        const name = document.getElementById('edit-name')?.value.trim() || '';
        const phone = document.getElementById('edit-phone')?.value.trim() || '';
        const bio = document.getElementById('edit-bio')?.value.trim() || '';
        if (!name) {
            showToast('Informe o nome.', 'warning');
            return;
        }

        const { error } = await sb.from('employees').update({ name, telefone: phone, bio }).eq('id', myEmployeeId);

        if (error) {
            showToast('Erro ao salvar.', 'error');
            return;
        }

        myEmployee = { ...myEmployee, name, telefone: phone, bio };
        applySession();
        window.cancelEditInfo();
        showToast('Perfil atualizado!', 'success');
    };

    window.toggleAvatarMenu = function () {
        const menu = document.getElementById('avatar-menu');
        const picker = document.getElementById('color-picker');
        const btn = document.getElementById('avatar-edit-btn');
        if (!menu || !btn) return;
        picker?.classList.remove('open');
        if (menu.classList.contains('open')) {
            menu.classList.remove('open');
        } else {
            menu.classList.add('open');
            positionFloating(menu, btn);
        }
    };

    window.triggerPhotoUpload = function () {
        document.getElementById('avatar-menu')?.classList.remove('open');
        document.getElementById('photo-input')?.click();
    };

    window.handlePhotoUpload = async function (event) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('Selecione uma imagem válida.', 'error');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showToast('Imagem deve ter no máximo 10 MB.', 'warning');
            return;
        }

        const storagePath = `${myEmployeeId}`;
        const { error: uploadError } = await sb.storage.from('avatars').upload(storagePath, file, { upsert: true, contentType: file.type });
        if (uploadError) {
            showToast('Erro ao enviar foto.', 'error');
            return;
        }

        const {
            data: { publicUrl },
        } = sb.storage.from('avatars').getPublicUrl(storagePath);
        const avatarUrl = `${publicUrl}?t=${Date.now()}`;

        const { error } = await sb.from('employees').update({ avatar_url: avatarUrl }).eq('id', myEmployeeId);
        if (error) {
            showToast('Erro ao salvar foto.', 'error');
            return;
        }

        myEmployee = { ...myEmployee, avatar_url: avatarUrl };
        applySession();
        showToast('Foto atualizada!', 'success');
        event.target.value = '';
    };

    window.removePhoto = async function () {
        document.getElementById('avatar-menu')?.classList.remove('open');
        await sb.storage.from('avatars').remove([`${myEmployeeId}`]);
        const { error } = await sb.from('employees').update({ avatar_url: null }).eq('id', myEmployeeId);
        if (error) {
            showToast('Erro ao remover foto.', 'error');
            return;
        }
        myEmployee = { ...myEmployee, avatar_url: null };
        applySession();
        showToast('Foto removida.', 'error');
    };

    window.openColorPicker = function () {
        const picker = document.getElementById('color-picker');
        const btn = document.getElementById('avatar-edit-btn');
        if (!picker || !btn) return;
        document.getElementById('avatar-menu')?.classList.remove('open');
        if (picker.classList.contains('open')) {
            picker.classList.remove('open');
        } else {
            picker.classList.add('open');
            positionFloating(picker, btn);
        }
    };

    window.saveNotifPref = async function (key, value) {
        const current = myEmployee.notif_prefs && typeof myEmployee.notif_prefs === 'object' ? { ...myEmployee.notif_prefs } : { ...NOTIF_DEFAULTS };
        current[key] = value;
        const { error } = await sb.from('employees').update({ notif_prefs: current }).eq('id', myEmployeeId);
        if (error) {
            showToast('Erro ao salvar preferência.', 'error');
            return;
        }
        myEmployee = { ...myEmployee, notif_prefs: current };
        showToast(value ? 'Notificação ativada.' : 'Notificação desativada.', value ? 'success' : 'error');
    };

    const VAPID_PUBLIC_KEY = 'BKEh0-IRJSvTztskLtGWT6syeAf1dyrRJwslbUs9v9ISuu9nMdr4fthxtkT6P8UdEDR4GJMKXJIXRNb-9EJhgAY';

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
    }

    function pushSupported() {
        return 'serviceWorker' in navigator && 'PushManager' in window;
    }

    function isIos() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function iosNeedsInstallFirst() {
        return isIos() && !isStandalone();
    }

    async function getPushSubscription() {
        if (!pushSupported()) return null;
        const registration = await navigator.serviceWorker.ready;
        return registration.pushManager.getSubscription();
    }

    async function syncSubscriptionToServer(json) {
        const { error } = await sb
            .from('push_subscriptions')
            .upsert({ employee_id: myEmployeeId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }, { onConflict: 'endpoint' });
        if (error) console.error('[Nexus] push sync:', error);
        return !error;
    }

    if (pushSupported()) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED' && event.data.subscription) {
                syncSubscriptionToServer(event.data.subscription);
            }
        });
    }

    async function syncPushToggleUI() {
        const toggle = document.getElementById('notif-push-browser');
        if (!toggle) return;

        const desc = document.getElementById('notif-push-desc');

        if (!pushSupported()) {
            toggle.disabled = true;
            if (desc) desc.textContent = 'Não suportado neste navegador.';
            return;
        }

        if (iosNeedsInstallFirst()) {
            toggle.disabled = true;
            if (desc) desc.textContent = 'Instale o app na Tela de Início para ativar (toque em Compartilhar → Adicionar à Tela de Início).';
            return;
        }

        const sub = await getPushSubscription();
        toggle.checked = !!sub;
        if (sub) syncSubscriptionToServer(sub.toJSON());
    }

    window.togglePushNotifications = async function (checked) {
        const toggle = document.getElementById('notif-push-browser');

        if (!checked) {
            try {
                const sub = await getPushSubscription();
                if (sub) {
                    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
                    await sub.unsubscribe();
                }
                showToast('Notificações push desativadas.', 'error');
            } catch (err) {
                console.error('[Nexus] push unsubscribe:', err);
            }
            return;
        }

        if (!pushSupported()) {
            showToast('Não suportado', 'error', 'Notificações push não são suportadas neste navegador.');
            if (toggle) toggle.checked = false;
            return;
        }

        if (iosNeedsInstallFirst()) {
            showToast(
                'Instale o app primeiro',
                'warning',
                'No iPhone/iPad, ative as notificações depois de instalar o app na Tela de Início (toque em Compartilhar → Adicionar à Tela de Início).'
            );
            if (toggle) toggle.checked = false;
            return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            showToast('Permissão negada', 'error', 'Ative as notificações do site nas configurações do navegador.');
            if (toggle) toggle.checked = false;
            return;
        }

        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            });
            const ok = await syncSubscriptionToServer(subscription.toJSON());
            if (!ok) throw new Error('sync failed');
            showToast('Notificações push ativadas.', 'success');
        } catch (err) {
            console.error('[Nexus] push subscribe:', err);
            showToast('Erro ao ativar notificações push.', 'error');
            if (toggle) toggle.checked = false;
        }
    };

    window.checkNewPass = function () {
        const curr = document.getElementById('curr-pass')?.value || '';
        const np = document.getElementById('new-pass-profile')?.value || '';
        const cp = document.getElementById('confirm-pass-profile')?.value || '';
        const msg = document.getElementById('pw-match-msg');
        const btn = document.getElementById('btn-change-pw');
        if (btn) btn.disabled = !(curr && np.length >= 8 && np === cp);
        if (!msg) return;
        if (!cp) {
            msg.textContent = '';
            msg.className = 'pw-match-msg';
        } else if (np !== cp) {
            msg.textContent = 'As senhas não coincidem.';
            msg.className = 'pw-match-msg err';
        } else if (np.length < 8) {
            msg.textContent = 'Mínimo 8 caracteres.';
            msg.className = 'pw-match-msg err';
        } else {
            msg.textContent = 'Senhas coincidem ✓';
            msg.className = 'pw-match-msg ok';
        }
    };

    window.changePassword = async function () {
        const curr = document.getElementById('curr-pass')?.value || '';
        const np = document.getElementById('new-pass-profile')?.value || '';

        const { error: authError } = await sb.auth.signInWithPassword({ email: myEmployee.email, password: curr });
        if (authError) {
            showToast('Senha atual incorreta.', 'error');
            return;
        }

        const { error } = await sb.auth.updateUser({ password: np });
        if (error) {
            showToast('Erro ao alterar senha. Tente novamente.', 'error');
            return;
        }

        ['curr-pass', 'new-pass-profile', 'confirm-pass-profile'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const btn = document.getElementById('btn-change-pw');
        if (btn) btn.disabled = true;
        const msg = document.getElementById('pw-match-msg');
        if (msg) {
            msg.textContent = '';
            msg.className = 'pw-match-msg';
        }
        showToast('Senha alterada com sucesso!', 'success');
    };

    window.togglePwSmall = function (inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        const icon = btn.querySelector('i');
        if (icon) icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
    };

    window.logout = async function () {
        await sb.auth.signOut();
        window.location.href = '../screens/login.html';
    };
    window.logoutAll = async function () {
        await sb.auth.signOut();
        showToast('Sessões encerradas.', 'success');
        setTimeout(() => (window.location.href = '../screens/login.html'), 1200);
    };

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

        const adm = new Date(admissionDate + 'T00:00:00');
        const hoje = new Date();

        let mesesCompletos = (hoje.getFullYear() - adm.getFullYear()) * 12 + (hoje.getMonth() - adm.getMonth());
        if (hoje.getDate() < adm.getDate()) mesesCompletos = Math.max(0, mesesCompletos - 1);

        const periodosCompletos = Math.floor(mesesCompletos / 12);
        const mesesNoPeriodoAtual = mesesCompletos % 12;
        const diasAcumulados = Math.min(Math.floor(mesesNoPeriodoAtual * 2.5), 30);
        const diasDisponiveis = periodosCompletos * 30;

        const proximoAniversario = new Date(adm);
        proximoAniversario.setFullYear(adm.getFullYear() + periodosCompletos + 1);
        const mesesParaProximo = Math.round((proximoAniversario - hoje) / (1000 * 60 * 60 * 24 * 30.44));

        if (mesesCompletos < 12) {
            return { icon: 'prof-icon--green', value: `${diasAcumulados} dias acumulados`, note: `Faltam ${12 - mesesCompletos} mês(es)` };
        }

        if (diasDisponiveis > 0) {
            return {
                icon: 'prof-icon--green',
                value: `${diasDisponiveis} dias disponíveis`,
                note: mesesNoPeriodoAtual > 0 ? `+ ${diasAcumulados} dias acumulados no período atual` : `Próximo vencimento em ${mesesParaProximo} mês(es)`,
            };
        }

        return { icon: 'prof-icon--green', value: `${diasAcumulados} dias acumulados`, note: `Próximo vencimento em ${mesesParaProximo} mês(es)` };
    }

    function applySession() {
        const color = myEmployee.avatar_color || '#6366f1';
        const ini = initials(myEmployee.name);

        const avatarImg = document.getElementById('profile-avatar-img');
        const avatarDiv = document.getElementById('profile-avatar');
        const removeBtn = document.getElementById('avatar-menu-remove');

        if (myEmployee.avatar_url) {
            avatarImg?.classList.remove('hidden');
            if (avatarImg) avatarImg.src = myEmployee.avatar_url;
            avatarDiv?.classList.add('hidden');
            if (removeBtn) removeBtn.style.display = 'flex';
        } else {
            avatarImg?.classList.add('hidden');
            avatarDiv?.classList.remove('hidden');
            if (avatarDiv) {
                avatarDiv.textContent = ini;
                avatarDiv.style.background = color;
            }
            if (removeBtn) removeBtn.style.display = 'none';
        }

        setEl('profile-hero-name', myEmployee.name);
        setEl('profile-hero-sub', `${myEmployee.role || '—'} · ${myEmployee.dept || '—'}`);

        const badge = document.getElementById('profile-status-badge');
        if (badge) {
            const sc = myEmployee.status === 'Ativo' ? '#4ade80' : myEmployee.status === 'Férias' ? '#facc15' : '#f87171';
            badge.innerHTML = `<i class="fas fa-circle" style="color:${sc}"></i> ${myEmployee.status || 'Ativo'}`;
        }

        setEl('view-name', myEmployee.name);
        setEl('view-email', myEmployee.email);
        setEl('view-phone', myEmployee.telefone || 'Não informado');
        setEl('view-bio', myEmployee.bio || 'Nenhuma descrição adicionada.');

        setEl('prof-role', myEmployee.role || '—');
        setEl('prof-dept', myEmployee.dept || '—');
        setEl('prof-admission', formatDate(myEmployee.admission_date));
        setEl('prof-status', myEmployee.status || 'Ativo');
        setEl('prof-profile', myProfile === 'Administrador' ? 'Administrador' : 'Colaborador');

        if (myEmployee.admission_date) {
            const adm = new Date(myEmployee.admission_date);
            const hoje = new Date();
            const days = Math.floor((hoje - adm) / 86400000);
            const months = Math.floor(days / 30);
            const years = Math.floor(months / 12);
            const tenure = years > 0 ? `${years} ano${years > 1 ? 's' : ''} e ${months % 12} mês(es)` : months > 0 ? `${months} mês(es)` : `${days} dia(s)`;
            setEl('prof-tenure', tenure);
            setEl('prof-days', days.toLocaleString('pt-BR'));
        }

        const feriasInfo = calcFeriasInfo(myEmployee.contract_type, myEmployee.admission_date);
        const feriasCard = document.getElementById('prof-highlight-ferias');
        if (feriasCard) {
            const iconEl = feriasCard.querySelector('.prof-highlight-icon');
            const valueEl = feriasCard.querySelector('.prof-highlight-value');
            const noteEl = feriasCard.querySelector('.prof-highlight-note');
            if (iconEl) iconEl.className = `prof-highlight-icon ${feriasInfo.icon}`;
            if (valueEl) valueEl.textContent = feriasInfo.value;
            if (noteEl) noteEl.textContent = feriasInfo.note;
        }
    }

    async function calcBancoHoras() {
        const pad0 = (n) => String(n).padStart(2, '0');
        const diffMin = (a, b) => {
            if (!a || !b) return 0;
            return Math.round((new Date(b) - new Date(a)) / 60000);
        };
        const minToStr = (min) => {
            const abs = Math.abs(min);
            return `${Math.floor(abs / 60)}h ${pad0(abs % 60)}min`;
        };

        const contractType = (myEmployee.contract_type || 'clt').toLowerCase();
        const jornadaMin = contractType === 'estagio' || contractType === 'estágio' || contractType === 'aprendiz' ? 360 : contractType === 'pj' ? null : 480;

        const [{ data: records }, { data: adjustments }] = await Promise.all([
            sb.from('time_records').select('*').eq('employee_id', myEmployeeId),
            sb.from('bank_adjustments').select('*').eq('employee_id', myEmployeeId).is('deleted_at', null),
        ]);

        const adjMinutes = (adjustments || []).reduce((sum, a) => sum + (a.tipo === 'credito' ? a.minutos : -a.minutos), 0);

        const valueEl = document.getElementById('prof-banco-value');
        const noteEl = document.getElementById('prof-banco-note');
        const iconEl = document.getElementById('banco-icon');

        if (jornadaMin === null) {
            let totalWorked = 0,
                diasCompletos = 0;
            (records || []).forEach((rec) => {
                if (!rec.entrada || !rec.saida) return;
                const worked = rec.saida_almoco
                    ? diffMin(rec.entrada, rec.saida_almoco) + (rec.retorno_almoco ? diffMin(rec.retorno_almoco, rec.saida) : 0)
                    : diffMin(rec.entrada, rec.saida);
                totalWorked += worked;
                diasCompletos++;
            });
            totalWorked += adjMinutes;
            if (valueEl) valueEl.textContent = minToStr(totalWorked);
            if (noteEl) noteEl.textContent = `${diasCompletos} dia(s) registrado(s) — PJ`;
            if (iconEl) iconEl.className = 'prof-highlight-icon prof-icon--blue';
            return;
        }

        let totalMin = 0,
            diasCompletos = 0;
        (records || []).forEach((rec) => {
            if (!rec.entrada || !rec.saida) return;
            const worked = rec.saida_almoco
                ? diffMin(rec.entrada, rec.saida_almoco) + (rec.retorno_almoco ? diffMin(rec.retorno_almoco, rec.saida) : 0)
                : diffMin(rec.entrada, rec.saida);
            totalMin += worked - jornadaMin;
            diasCompletos++;
        });
        totalMin += adjMinutes;

        if (diasCompletos === 0 && adjMinutes === 0) {
            if (valueEl) valueEl.textContent = '0h 00min';
            if (noteEl) noteEl.textContent = 'Nenhum dia finalizado';
            if (iconEl) iconEl.className = 'prof-highlight-icon prof-icon--purple';
            return;
        }

        const sign = totalMin > 0 ? '+' : totalMin < 0 ? '-' : '';
        const cls = totalMin > 0 ? 'prof-icon--green' : totalMin < 0 ? 'prof-icon--red' : 'prof-icon--purple';
        if (valueEl) valueEl.textContent = `${sign}${minToStr(totalMin)}`;
        if (noteEl) noteEl.textContent = `Saldo de ${diasCompletos} dia(s) registrado(s)`;
        if (iconEl) iconEl.className = `prof-highlight-icon ${cls}`;
    }

    function positionFloating(el, anchor) {
        const rect = anchor.getBoundingClientRect();
        const margin = 8;
        let top = rect.bottom + margin;
        let left = rect.left;
        const w = el.offsetWidth || 196;
        if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
        const h = el.offsetHeight || 160;
        if (top + h > window.innerHeight - 12) top = rect.top - h - margin;
        el.style.top = top + 'px';
        el.style.left = left + 'px';
    }

    function closeAvatarMenu() {
        document.getElementById('avatar-menu')?.classList.remove('open');
    }
    function closeColorPicker() {
        document.getElementById('color-picker')?.classList.remove('open');
    }

    function buildColorSwatches() {
        const container = document.getElementById('color-swatches');
        if (!container) return;
        container.innerHTML = '';
        const current = myEmployee.avatar_color || '#6366f1';
        AVATAR_COLORS.forEach((color) => {
            const sw = document.createElement('div');
            sw.className = 'color-swatch' + (color === current ? ' active' : '');
            sw.style.background = color;
            sw.title = color;
            sw.addEventListener('click', () => selectAvatarColor(color));
            container.appendChild(sw);
        });
    }

    async function selectAvatarColor(color) {
        const { error } = await sb.from('employees').update({ avatar_color: color, avatar_url: null }).eq('id', myEmployeeId);
        if (error) {
            showToast('Erro ao salvar cor.', 'error');
            return;
        }
        myEmployee = { ...myEmployee, avatar_color: color, avatar_url: null };
        applySession();
        buildColorSwatches();
        closeColorPicker();
        showToast('Cor atualizada!', 'success');
    }

    function loadNotifPrefs() {
        const prefs =
            myEmployee.notif_prefs && typeof myEmployee.notif_prefs === 'object' ? { ...NOTIF_DEFAULTS, ...myEmployee.notif_prefs } : { ...NOTIF_DEFAULTS };
        Object.entries(prefs).forEach(([k, v]) => {
            const el = document.getElementById('notif-' + k);
            if (el) el.checked = v;
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAvatarMenu();
            closeColorPicker();
        }
    });

    document.addEventListener('click', (e) => {
        const menu = document.getElementById('avatar-menu');
        const picker = document.getElementById('color-picker');
        if (menu?.classList.contains('open') && !e.target.closest('#avatar-menu') && !e.target.closest('#avatar-edit-btn')) closeAvatarMenu();
        if (
            picker?.classList.contains('open') &&
            !e.target.closest('#color-picker') &&
            !e.target.closest('#avatar-edit-btn') &&
            !e.target.closest('#avatar-menu')
        )
            closeColorPicker();
    });

    window.addEventListener(
        'scroll',
        () => {
            const btn = document.getElementById('avatar-edit-btn');
            if (!btn) return;
            const m = document.getElementById('avatar-menu');
            const p = document.getElementById('color-picker');
            if (m?.classList.contains('open')) positionFloating(m, btn);
            if (p?.classList.contains('open')) positionFloating(p, btn);
        },
        { passive: true }
    );

    window.addEventListener('resize', () => {
        const btn = document.getElementById('avatar-edit-btn');
        if (!btn) return;
        const m = document.getElementById('avatar-menu');
        const p = document.getElementById('color-picker');
        if (m?.classList.contains('open')) positionFloating(m, btn);
        if (p?.classList.contains('open')) positionFloating(p, btn);
    });

    applySession();
    await calcBancoHoras();
    buildColorSwatches();
    loadNotifPrefs();
    syncPushToggleUI();

    sb.channel('perfil-colab')
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'employees',
                filter: `id=eq.${myEmployeeId}`,
            },
            async (payload) => {
                const updated = payload.new;
                if (updated.status === 'Inativo' || updated.status === 'Bloqueado') {
                    showToast('Conta desativada pelo RH', 'error', 'Você será desconectado em instantes.');
                    setTimeout(async () => {
                        await sb.auth.signOut();
                        window.location.href = '../screens/login.html';
                    }, 2500);
                    return;
                }
                myEmployee = { ...myEmployee, ...updated };
                applySession();
                buildColorSwatches();
                await calcBancoHoras();
            }
        )
        .subscribe();
});
