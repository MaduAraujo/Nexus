let selectedProfileType = null;
let loginStep = 1;
let _firstAccessSession = null;
let _faDebounce = null;
let _isPasswordRecovery = false;

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast toast--${type} show`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
}

window.updateLoginBtnState = function () {
    const btn = document.getElementById('btn-login');
    const email = document.getElementById('login-user')?.value.trim() || '';
    const pass = document.getElementById('login-pass')?.value || '';
    if (btn) btn.disabled = !email || !pass;
};

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

function validateFirstAccessEmail() {
    const email = document.getElementById('first-access-email')?.value.trim().toLowerCase();
    const btn = document.getElementById('btn-first-access');
    const err = document.getElementById('first-access-email-err');

    if (btn) btn.disabled = true;
    if (err) err.textContent = '';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return;
    }

    const sessionEmail = _firstAccessSession?.user?.email?.toLowerCase();

    if (!sessionEmail) {
        if (err) err.textContent = 'Sessão inválida. Solicite um novo convite ao RH.';
        return;
    }

    if (email !== sessionEmail) {
        if (err) err.textContent = 'Utilize o e-mail do convite recebido.';
        return;
    }

    if (btn) btn.disabled = false;
}

window.onFirstAccessEmailInput = function () {
    clearTimeout(_faDebounce);
    const email = document.getElementById('first-access-email')?.value.trim();
    const btn = document.getElementById('btn-first-access');
    const err = document.getElementById('first-access-email-err');
    if (!email) {
        if (btn) btn.disabled = true;
        if (err) err.textContent = '';
        return;
    }
    _faDebounce = setTimeout(validateFirstAccessEmail, 600);
};

window.selectProfile = function (type, el) {
    selectedProfileType = type;
    document.querySelectorAll('#form-profile .profile-card').forEach(c => { c.classList.remove('selected'); c.setAttribute('aria-checked', 'false'); });
    el.classList.add('selected');
    el.setAttribute('aria-checked', 'true');
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
    const loginUser = document.getElementById('login-user');
    if (loginPass) loginPass.value = '';

    if (selectedProfileType === 'Administrador') {
        if (pill) pill.innerHTML = '';
        if (title) title.textContent = 'Bem-vindo de volta';
        if (subtitle) subtitle.textContent = 'Acesse o painel';
        if (passSection) passSection.style.display = '';
        if (btnLoginText) btnLoginText.textContent = 'Entrar';
        if (loginUser) loginUser.placeholder = '';
        loginStep = 2;
    } else {
        if (pill) pill.innerHTML = '';
        if (title) title.textContent = 'Olá, colaborador!';
        if (subtitle) subtitle.textContent = 'Acesse sua área pessoal';
        if (passSection) passSection.style.display = '';
        if (btnLoginText) btnLoginText.textContent = 'Entrar';
        if (loginUser) loginUser.placeholder = '';
        loginStep = 2;
    }

    updateLoginBtnState();
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
    document.querySelectorAll('#form-profile .profile-card').forEach(c => { c.classList.remove('selected'); c.setAttribute('aria-checked', 'false'); });
    const continueBtn = document.getElementById('btn-continue');
    if (continueBtn) continueBtn.disabled = true;
    setNavBack(false);
};

function setNavBack(visible, onClick) {
    const btn = document.getElementById('nav-back-btn');
    if (!btn) return;
    btn.style.display = visible ? 'flex' : 'none';
    btn.onclick = visible ? onClick : null;
}

window.switchTab = function (tab) {
    if (tab !== 'login' && tab !== 'forgot') return;
    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('form-' + tab);
    if (target) target.classList.add('active');
    setNavBack(true, tab === 'login' ? goToProfileSelection : backToLogin);
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

    try {
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
                selectedProfileType === 'Administrador'
                    ? 'Este e-mail não tem acesso ao painel Administrativo.'
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

        window.location.href = profile.profile === 'Administrador'
            ? '../screens/inicio-rh.html'
            : '../screens/inicio-colaborador.html';

    } catch (err) {
        setLoginLoading(false);
        showToast('Erro de conexão. Verifique sua internet e tente novamente.', 'error');
    }
};

window.forgotClearErr = function (errId, input) {
    const err = document.getElementById(errId);
    if (err) err.textContent = '';
    input?.classList.remove('input-error');
};

window.updateForgotBtnState = function () {
    const btn = document.getElementById('btn-forgot-send');
    const email = document.getElementById('forgot-email')?.value.trim() || '';
    if (btn) btn.disabled = !email;
};

window.backToLogin = function () {
    if (!selectedProfileType) {
        goToProfileSelection();
    } else {
        switchTab('login');
    }
    window.setForgotStep(1);
    const el = document.getElementById('forgot-email');
    if (el) el.value = '';
    updateForgotBtnState();
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
        redirectTo: window.location.origin + window.location.pathname,
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
    btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
};

document.addEventListener('DOMContentLoaded', async () => {
    window.setForgotStep(1);

    const isInvite = new URLSearchParams((window._loginHash || '').replace(/^#/, '')).get('type') === 'invite';

    window.openCreatePasswordModal = function () {
        const modal = document.getElementById('create-pass-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('fam-visible')));
        setTimeout(() => document.getElementById('create-pass-new')?.focus(), 150);
    };

    window.validateCreatePass = function () {
        const np  = document.getElementById('create-pass-new')?.value    || '';
        const cp  = document.getElementById('create-pass-confirm')?.value || '';
        const err = document.getElementById('create-pass-err');
        const btn = document.getElementById('btn-create-pass');
        const valid = np.length >= 8 && np === cp;
        if (btn) btn.disabled = !valid;
        if (!err) return;
        if (!cp)                err.textContent = '';
        else if (np.length < 8) err.textContent = 'Mínimo 8 caracteres.';
        else if (np !== cp)     err.textContent = 'As senhas não coincidem.';
        else                    err.textContent = '';
    };

    window.submitCreatePass = async function () {
        const np   = document.getElementById('create-pass-new')?.value || '';
        const btn  = document.getElementById('btn-create-pass');
        const text = document.getElementById('btn-create-pass-text');
        const spin = document.getElementById('spin-create-pass');
        if (!np || np.length < 8) return;

        if (btn)  btn.disabled       = true;
        if (text) text.style.opacity = '0';
        if (spin) spin.style.display = 'block';

        const { error } = await sb.auth.updateUser({
            password: np,
            data: { first_access_pending: false },
        });

        if (error) {
            if (btn)  btn.disabled       = false;
            if (text) text.style.opacity = '1';
            if (spin) spin.style.display = 'none';
            const err = document.getElementById('create-pass-err');
            if (err) err.textContent = 'Erro ao criar senha. Tente novamente.';
            return;
        }

        await sb.auth.signOut();
        window.location.href = window.location.origin + window.location.pathname;
    };

    function setupFirstAccess(authSession) {
        if (!authSession?.user || _firstAccessSession) return;
        document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
        document.getElementById('form-first-access')?.classList.add('active');
        const faEmailInput = document.getElementById('first-access-email');
        if (faEmailInput) faEmailInput.value = authSession.user.email ?? '';
        _firstAccessSession = authSession;
        validateFirstAccessEmail();
    }

    function isFirstAccessSession(authSession) {
        if (!authSession?.user) return false;
        
        if (authSession.user.user_metadata?.first_access_pending) return true;
        
        return isInvite;
    }

    sb.auth.onAuthStateChange((event, authSession) => {
        if (event === 'PASSWORD_RECOVERY') {
            _isPasswordRecovery = true;
            switchTab('forgot');
            window.setForgotStep(3);
            return;
        }
        if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && isFirstAccessSession(authSession)) {
            setupFirstAccess(authSession);
        }
    });

    const { data: { session } } = await sb.auth.getSession();

    if (_isPasswordRecovery) return;

    if (session?.user) {
        if (isFirstAccessSession(session)) {
            setupFirstAccess(session);
            return;
        }

        const { data: profile } = await sb.from('profiles')
            .select('profile')
            .eq('id', session.user.id)
            .single();
        if (profile?.profile === 'Administrador') {
            window.location.href = '../screens/inicio-rh.html';
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
});