let selectedProfileType = null;
let loginStep = 1;

// ─── UI Utilities ────────────────────────────────────────────
function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast toast--${type} show`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
}

function setLoginLoading(on) {
    const btn = document.getElementById('btn-login');
    const text = document.getElementById('btn-login-text');
    const spin = document.getElementById('spinner-login');
    if (!btn) return;
    btn.disabled = on;
    if (text) text.style.opacity = on ? '0' : '1';
    if (spin) spin.style.display = on ? 'block' : 'none';
}

function setForgotBtnLoading(btnId, textId, spinId, on) {
    const btn = document.getElementById(btnId);
    const text = document.getElementById(textId);
    const spin = document.getElementById(spinId);
    if (btn) btn.disabled = on;
    if (text) text.style.opacity = on ? '0' : '1';
    if (spin) spin.style.display = on ? 'block' : 'none';
}

window.setForgotStep = function (step) {
    [1, 2, 3, 4].forEach(i => {
        const panel = document.getElementById('forgot-s' + i);
        const dot = document.getElementById('fdot-' + i);
        if (panel) panel.style.display = i === step ? 'block' : 'none';
        if (dot) dot.classList.toggle('active', i <= step);
    });
};

// ─── Profile selection ───────────────────────────────────────
window.selectProfile = function (type, el) {
    selectedProfileType = type;
    document.querySelectorAll('#form-profile .profile-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    const continueBtn = document.getElementById('btn-continue');
    if (continueBtn) continueBtn.disabled = false;
};

window.goToLogin = function () {
    if (!selectedProfileType) return;
    switchTab('login');

    const pill = document.getElementById('login-profile-pill');
    const title = document.getElementById('login-title');
    const subtitle = document.getElementById('login-subtitle');
    const passSection = document.getElementById('login-pass-section');
    const btnLoginText = document.getElementById('btn-login-text');
    const loginPass = document.getElementById('login-pass');
    if (loginPass) loginPass.value = '';

    if (selectedProfileType === 'rh') {
        if (pill) pill.innerHTML = '<span class="profile-pill rh-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> RH</span>';
        if (title) title.textContent = 'Bem-vindo de volta';
        if (subtitle) subtitle.textContent = 'Acesse o painel de Recursos Humanos';
        if (passSection) passSection.style.display = '';
        if (btnLoginText) btnLoginText.textContent = 'Entrar';
        loginStep = 2;
    } else {
        if (pill) pill.innerHTML = '<span class="profile-pill colab-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Colaborador</span>';
        if (title) title.textContent = 'Olá, colaborador!';
        if (subtitle) subtitle.textContent = 'Acesse sua área pessoal';
        if (passSection) passSection.style.display = 'none';
        if (btnLoginText) btnLoginText.textContent = 'Continuar';
        loginStep = 1;
    }
};

window.goToProfileSelection = function () {
    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
    const profileSection = document.getElementById('form-profile');
    if (profileSection) profileSection.classList.add('active');
    document.getElementById('login-user').value = '';
    document.getElementById('login-pass').value = '';
    loginStep = 1;
    const passSection = document.getElementById('login-pass-section');
    if (passSection) passSection.style.display = '';
    selectedProfileType = null;
    document.querySelectorAll('#form-profile .profile-card').forEach(c => c.classList.remove('selected'));
    const continueBtn = document.getElementById('btn-continue');
    if (continueBtn) continueBtn.disabled = true;
};

window.switchTab = function (tab) {
    if (tab !== 'login' && tab !== 'forgot') return;
    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('form-' + tab);
    if (target) target.classList.add('active');
};

function showPasswordStep() {
    loginStep = 2;
    const passSection = document.getElementById('login-pass-section');
    const btnLoginText = document.getElementById('btn-login-text');
    const loginPass = document.getElementById('login-pass');
    if (passSection) passSection.style.display = '';
    if (btnLoginText) btnLoginText.textContent = 'Entrar';
    setTimeout(() => loginPass?.focus(), 50);
}

// ─── Login ───────────────────────────────────────────────────
window.handleLogin = async function () {
    const emailInput = document.getElementById('login-user').value.trim().toLowerCase();
    const passInput = document.getElementById('login-pass').value;

    if (!emailInput) {
        showToast('Informe seu e-mail.', 'error');
        return;
    }

    if (loginStep === 1) {
        showPasswordStep();
        return;
    }

    if (!passInput) {
        showToast('Informe sua senha.', 'error');
        return;
    }

    setLoginLoading(true);

    const { data, error } = await sb.auth.signInWithPassword({
        email: emailInput,
        password: passInput
    });

    if (error) {
        setLoginLoading(false);
        if (error.message === 'Email not confirmed') {
            showToast('Confirme seu e-mail antes de acessar.', 'error');
        } else {
            showToast('E-mail ou senha incorretos.', 'error');
        }
        return;
    }

    const { data: profile, error: profileError } = await sb.from('profiles')
        .select('profile, employee_id')
        .eq('id', data.user.id)
        .single();

    if (profileError || !profile) {
        await sb.auth.signOut();
        setLoginLoading(false);
        showToast('Perfil não encontrado. Entre em contato com o RH.', 'error');
        return;
    }

    if (profile.profile !== selectedProfileType) {
        await sb.auth.signOut();
        setLoginLoading(false);
        showToast(
            selectedProfileType === 'rh'
                ? 'Este e-mail não tem acesso ao painel de RH.'
                : 'Este e-mail não tem acesso à área de colaborador.',
            'error'
        );
        return;
    }

    if (profile.profile === 'colaborador' && profile.employee_id) {
        await sb.from('employees')
            .update({ last_access: new Date().toISOString() })
            .eq('id', profile.employee_id);
    }

    window.location.href = profile.profile === 'rh'
        ? '../screens/dashboard.html'
        : '../screens/inicio-colaborador.html';
};

// ─── Forgot password ─────────────────────────────────────────
window.forgotClearErr = function (errId, input) {
    const err = document.getElementById(errId);
    if (err) err.textContent = '';
    input?.classList.remove('input-error');
};

window.backToLogin = function () {
    switchTab('login');
    window.setForgotStep(1);
    const el = document.getElementById('forgot-email');
    if (el) el.value = '';
};

window.forgotSendCode = async function () {
    const email = document.getElementById('forgot-email')?.value.trim().toLowerCase();
    const errEl = document.getElementById('forgot-email-err');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (errEl) errEl.textContent = 'Informe um e-mail válido.';
        return;
    }

    if (errEl) errEl.textContent = '';
    setForgotBtnLoading('btn-forgot-send', 'btn-forgot-send-text', 'spin-forgot-send', true);

    const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.href.split('#')[0]
    });

    setForgotBtnLoading('btn-forgot-send', 'btn-forgot-send-text', 'spin-forgot-send', false);

    if (error) {
        if (errEl) errEl.textContent = 'Erro ao enviar e-mail. Tente novamente.';
        return;
    }

    const shown = document.getElementById('forgot-email-shown');
    if (shown) shown.textContent = email;
    window.setForgotStep(2);
};

window.forgotValidatePass = function () {
    const np = document.getElementById('new-pass')?.value || '';
    const cp = document.getElementById('confirm-pass')?.value || '';
    const btn = document.getElementById('btn-reset');
    const err = document.getElementById('confirm-pass-err');
    const hasLength = np.length >= 8;
    const hasLetter = /[a-zA-Z]/.test(np);
    const hasNumber = /[0-9]/.test(np);
    const valid = hasLength && hasLetter && hasNumber && np === cp;
    if (btn) btn.disabled = !valid;
    if (err) err.textContent = cp && !valid
        ? np !== cp ? 'As senhas não coincidem.' : 'Mínimo 8 caracteres com letras e números.'
        : '';
};

window.forgotReset = async function () {
    const np = document.getElementById('new-pass')?.value || '';
    if (document.getElementById('btn-reset')?.disabled) return;

    setForgotBtnLoading('btn-reset', 'btn-reset-text', 'spin-reset', true);

    const { error } = await sb.auth.updateUser({ password: np });

    setForgotBtnLoading('btn-reset', 'btn-reset-text', 'spin-reset', false);

    if (error) {
        showToast('Erro ao redefinir senha. Tente novamente.', 'error');
        return;
    }

    await sb.auth.signOut();
    window.setForgotStep(4);
};

window.togglePw = function (inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.style.opacity = show ? '1' : '0.5';
};

// ─── Initialization ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    window.setForgotStep(1);

    // Detecta retorno do link de redefinição enviado por e-mail
    sb.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
            switchTab('forgot');
            window.setForgotStep(3);
        }
    });

    // Redireciona se já houver sessão ativa
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        const { data: profile } = await sb.from('profiles')
            .select('profile')
            .eq('id', session.user.id)
            .single();
        if (profile?.profile === 'rh') {
            window.location.href = '../screens/dashboard.html';
            return;
        }
        if (profile?.profile === 'colaborador') {
            window.location.href = '../screens/inicio-colaborador.html';
            return;
        }
    }

    document.getElementById('login-user')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleLogin();
    });

    // Reseta para step 1 se colaborador editar o e-mail depois de ver o campo de senha
    document.getElementById('login-user')?.addEventListener('input', () => {
        if (loginStep === 2 && selectedProfileType === 'colaborador') {
            loginStep = 1;
            const passSection = document.getElementById('login-pass-section');
            if (passSection) passSection.style.display = 'none';
            const btnLoginText = document.getElementById('btn-login-text');
            if (btnLoginText) btnLoginText.textContent = 'Continuar';
            const loginPass = document.getElementById('login-pass');
            if (loginPass) loginPass.value = '';
        }
    });
});
