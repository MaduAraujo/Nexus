let selectedProfileType   = null; 
let selectedSignupProfile = null;
let forgotStep     = 1;
let forgotEmail    = '';
let forgotCode     = '';
let resendInterval = null;

function getUsers() {
    try { return JSON.parse(localStorage.getItem('nexus_users') || '[]'); }
    catch { return []; }
}

function saveUsers(users) {
    localStorage.setItem('nexus_users', JSON.stringify(users));
}

window.selectProfile = function (type, el) {
    selectedProfileType = type;
    document.querySelectorAll('#form-profile .profile-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('btn-continue').disabled = false;
};

window.goToLogin = function () {
    if (!selectedProfileType) return;
    switchTab('login');

    const pill     = document.getElementById('login-profile-pill');
    const title    = document.getElementById('login-title');
    const subtitle = document.getElementById('login-subtitle');

    if (selectedProfileType === 'rh') {
        pill.innerHTML       = '<span class="profile-pill rh-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> RH</span>';
        title.textContent    = 'Bem-vindo de volta';
        subtitle.textContent = 'Acesse o painel de Recursos Humanos';
    } else {
        pill.innerHTML       = '<span class="profile-pill colab-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Colaborador</span>';
        title.textContent    = 'Olá, colaborador!';
        subtitle.textContent = 'Acesse sua área pessoal';
    }
};

window.switchTab = function (tab) {
    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('form-' + tab);
    if (target) target.classList.add('active');
};

window.handleLogin = function () {
    const emailInput = document.getElementById('login-user').value.trim().toLowerCase();
    const pass       = document.getElementById('login-pass').value;

    if (!emailInput || !pass) { showToast('Preencha e-mail e senha.', 'error'); return; }

    setLoginLoading(true);

    setTimeout(() => {
        setLoginLoading(false);

        const users = getUsers();
        const found = users.find(
            u => u.email.toLowerCase() === emailInput &&
                 u.password            === pass &&
                 u.profile             === (selectedProfileType || 'colaborador')
        );

        if (!found) { showToast('E-mail ou senha incorretos.', 'error'); return; }

        const { password: _pw, ...sessionUser } = found;
        localStorage.setItem('nexus_session', JSON.stringify(sessionUser));

        if (found.profile === 'rh') {
            window.location.href = '../screens/dashboard.html';
        } else if (found.firstAccess !== false) {
            openFirstAccessModal(found.email);
        } else {
            window.location.href = '../screens/inicio-colaborador.html';
        }
    }, 1400);
};

function setLoginLoading(on) {
    const btn  = document.getElementById('btn-login');
    const text = document.getElementById('btn-login-text');
    const spin = document.getElementById('spinner-login');
    if (!btn) return;
    btn.disabled       = on;
    text.style.opacity = on ? '0' : '1';
    spin.style.display = on ? 'block' : 'none';
}

function openFirstAccessModal(userEmail) {
    if (document.getElementById('first-access-modal')) {
        document.getElementById('first-access-modal').classList.add('fam-visible');
        return;
    }

    const today   = new Date().toISOString().split('T')[0];
    const overlay = document.createElement('div');
    overlay.id        = 'first-access-modal';
    overlay.className = 'fam-overlay';
    overlay.innerHTML = `
        <div class="fam-card" role="dialog" aria-modal="true" aria-labelledby="fam-title">
            <div class="fam-header">
                <div class="fam-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                    </svg>
                </div>
                <div>
                    <p class="fam-title" id="fam-title">Complete seu perfil</p>
                    <p class="fam-subtitle">Essas informações aparecerão na sua área pessoal.</p>
                </div>
            </div>
            <div class="fam-body">
                <div class="fam-field">
                    <label class="fam-label" for="fam-dept">Setor / Departamento</label>
                    <div class="fam-input-wrap">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="7" width="20" height="14" rx="2"/>
                            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                        </svg>
                        <input type="text" id="fam-dept" placeholder="Ex: Tecnologia da Informação" />
                    </div>
                    <p class="fam-error" id="fam-dept-err"></p>
                </div>
                <div class="fam-field">
                    <label class="fam-label" for="fam-role">Cargo</label>
                    <div class="fam-input-wrap">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            <path d="M2 17l10 5 10-5"/>
                            <path d="M2 12l10 5 10-5"/>
                        </svg>
                        <input type="text" id="fam-role" placeholder="Ex: Desenvolvedor Front-end" />
                    </div>
                    <p class="fam-error" id="fam-role-err"></p>
                </div>
                <div class="fam-field">
                    <label class="fam-label" for="fam-admission">Data de Admissão</label>
                    <div class="fam-input-wrap">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="4" width="18" height="18" rx="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        <input type="date" id="fam-admission" max="${today}" />
                    </div>
                    <p class="fam-error" id="fam-admission-err"></p>
                </div>
            </div>
            <button class="fam-btn" id="fam-btn" onclick="submitFirstAccess('${userEmail}')">
                <span id="fam-btn-text">Salvar e entrar</span>
                <div class="fam-spinner" id="fam-spinner"></div>
            </button>
        </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('fam-visible')));
}

window.submitFirstAccess = function (userEmail) {
    const dept      = document.getElementById('fam-dept').value.trim();
    const role      = document.getElementById('fam-role').value.trim();
    const admission = document.getElementById('fam-admission').value;

    document.getElementById('fam-dept-err').textContent      = dept      ? '' : 'Informe o setor.';
    document.getElementById('fam-role-err').textContent      = role      ? '' : 'Informe o cargo.';
    document.getElementById('fam-admission-err').textContent = admission ? '' : 'Informe a data.';
    if (!dept || !role || !admission) return;

    const btn  = document.getElementById('fam-btn');
    const text = document.getElementById('fam-btn-text');
    const spin = document.getElementById('fam-spinner');
    btn.disabled = true; text.style.opacity = '0'; spin.style.display = 'block';

    setTimeout(() => {
        const users = getUsers();
        const idx   = users.findIndex(u => u.email.toLowerCase() === userEmail.toLowerCase());
        if (idx !== -1) {
            users[idx] = { ...users[idx], dept, role, admissionDate: admission, firstAccess: false };
            saveUsers(users);
            const { password: _pw, ...session } = users[idx];
            localStorage.setItem('nexus_session', JSON.stringify(session));
        }
        window.location.href = '../screens/inicio-colaborador.html';
    }, 900);
};

window.selectSignupProfile = function (type, el) {
    selectedSignupProfile = type;
    document.querySelectorAll('#form-signup .profile-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
};

window.handleSignup = function () {
    const name  = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim().toLowerCase();
    const pass  = document.getElementById('signup-pass').value;

    if (!selectedSignupProfile)                               { showToast('Selecione um perfil.',                  'error'); return; }
    if (!name)                                                { showToast('Informe seu nome.',                     'error'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Informe um e-mail válido.',             'error'); return; }
    if (!pass || pass.length < 8)                             { showToast('Senha deve ter ao menos 8 caracteres.', 'error'); return; }

    const users = getUsers();
    if (users.find(u => u.email === email && u.profile === selectedSignupProfile)) {
        showToast('E-mail já cadastrado neste perfil.', 'error');
        return;
    }

    users.push({
        name, email, password: pass,
        profile:       selectedSignupProfile,
        role:          selectedSignupProfile === 'rh' ? 'Analista de RH' : 'Colaborador',
        dept:          selectedSignupProfile === 'rh' ? 'Recursos Humanos' : '',
        admissionDate: new Date().toISOString().split('T')[0],
        status:        'Ativo',
        phone:         '',
        bio:           '',
        avatarColor:   randomColor(),
        firstAccess:   selectedSignupProfile === 'colaborador',
    });
    saveUsers(users);

    const btn  = document.getElementById('btn-signup');
    const text = document.getElementById('btn-signup-text');
    const spin = document.getElementById('spinner-signup');
    if (btn)  btn.disabled       = true;
    if (text) text.style.opacity = '0';
    if (spin) spin.style.display = 'block';

    showToast('Cadastro realizado com sucesso!', 'success');

    setTimeout(() => {
        if (btn)  btn.disabled       = false;
        if (text) text.style.opacity = '1';
        if (spin) spin.style.display = 'none';

        document.getElementById('signup-name').value  = '';
        document.getElementById('signup-email').value = '';
        document.getElementById('signup-pass').value  = '';
        selectedSignupProfile = null;
        document.querySelectorAll('#form-signup .profile-card').forEach(c => c.classList.remove('selected'));

        selectedProfileType = users[users.length - 1].profile;
        switchTab('login');
        goToLogin();
    }, 1800);
};

function randomColor() {
    const colors = ['#6366f1','#8b5cf6','#ec4899','#10b981','#f59e0b','#3b82f6','#ef4444'];
    return colors[Math.floor(Math.random() * colors.length)];
}

window.onSignupPasswordInput = function (val) {
    const wrap = document.getElementById('strength-wrap');
    if (!wrap) return;
    wrap.style.display = val.length > 0 ? 'block' : 'none';

    const checks = {
        len:   val.length >= 8,
        upper: /[A-Z]/.test(val),
        num:   /[0-9]/.test(val),
        sym:   /[^A-Za-z0-9]/.test(val),
    };

    const score  = Object.values(checks).filter(Boolean).length;
    const colors = ['#ef4444','#f59e0b','#3b82f6','#10b981'];
    const labels = ['Muito fraca','Fraca','Boa','Forte'];

    [1,2,3,4].forEach(i => {
        const bar = document.getElementById('pw-bar-' + i);
        if (bar) bar.style.background = i <= score ? colors[score - 1] : '';
    });

    const lbl = document.getElementById('pw-strength-label');
    if (lbl) { lbl.textContent = score > 0 ? labels[score - 1] : ''; lbl.style.color = colors[score - 1] || ''; }

    Object.entries(checks).forEach(([k, ok]) => {
        document.getElementById('c-' + k)?.classList.toggle('ok', ok);
    });
};

function setForgotStep(step) {
    forgotStep = step;
    [1,2,3,4].forEach(i => {
        const panel = document.getElementById('forgot-s' + i);
        const dot   = document.getElementById('fdot-' + i);
        if (panel) panel.style.display = i === step ? 'block' : 'none';
        if (dot)   dot.classList.toggle('active', i <= step);
    });
}

window.forgotSendCode = function () {
    const email = document.getElementById('forgot-email')?.value.trim().toLowerCase();
    const errEl = document.getElementById('forgot-email-err');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (errEl) errEl.textContent = 'Informe um e-mail válido.';
        return;
    }

    forgotEmail = email;
    forgotCode  = String(Math.floor(100000 + Math.random() * 900000));
    console.info('[Nexus DEV] Código OTP:', forgotCode);

    setForgotBtnLoading('btn-forgot-send', 'btn-forgot-send-text', 'spin-forgot-send', true);

    setTimeout(() => {
        setForgotBtnLoading('btn-forgot-send', 'btn-forgot-send-text', 'spin-forgot-send', false);
        const shown = document.getElementById('forgot-email-shown');
        if (shown) shown.textContent = forgotEmail;
        setForgotStep(2);
        startResendTimer(60);
    }, 1200);
};

function setForgotBtnLoading(btnId, textId, spinId, on) {
    const btn  = document.getElementById(btnId);
    const text = document.getElementById(textId);
    const spin = document.getElementById(spinId);
    if (btn)  btn.disabled       = on;
    if (text) text.style.opacity = on ? '0' : '1';
    if (spin) spin.style.display = on ? 'block' : 'none';
}

window.forgotClearErr = function (errId, input) {
    const err = document.getElementById(errId);
    if (err) err.textContent = '';
    input?.classList.remove('input-error');
};

window.otpInput = function (el, idx) {
    el.value = el.value.replace(/\D/g,'').slice(0,1);
    if (el.value && idx < 5) document.getElementById('otp' + (idx + 1))?.focus();
    checkOtpComplete();
};

window.otpKey = function (e, idx) {
    if (e.key === 'Backspace' && !e.target.value && idx > 0)
        document.getElementById('otp' + (idx - 1))?.focus();
};

window.otpPaste = function (e) {
    e.preventDefault();
    const digits = (e.clipboardData.getData('text') || '').replace(/\D/g,'').slice(0,6);
    digits.split('').forEach((d, i) => { const inp = document.getElementById('otp' + i); if (inp) inp.value = d; });
    checkOtpComplete();
    document.getElementById('otp' + Math.min(digits.length, 5))?.focus();
};

function checkOtpComplete() {
    const complete = [0,1,2,3,4,5].every(i => (document.getElementById('otp' + i)?.value || '') !== '');
    const btn = document.getElementById('btn-otp-verify');
    if (btn) btn.disabled = !complete;
}

window.forgotVerifyOtp = function () {
    const entered = [0,1,2,3,4,5].map(i => document.getElementById('otp' + i)?.value || '').join('');
    const errEl   = document.getElementById('otp-err');

    setForgotBtnLoading('btn-otp-verify', 'btn-otp-text', 'spin-otp', true);

    setTimeout(() => {
        setForgotBtnLoading('btn-otp-verify', 'btn-otp-text', 'spin-otp', false);

        if (entered === forgotCode) {
            if (errEl) errEl.textContent = '';
            setForgotStep(3);
        } else {
            if (errEl) errEl.textContent = 'Código incorreto. Tente novamente.';
            [0,1,2,3,4,5].forEach(i => { const inp = document.getElementById('otp' + i); if (inp) inp.value = ''; });
            document.getElementById('otp0')?.focus();
        }
    }, 900);
};

window.forgotResend = function () {
    forgotCode = String(Math.floor(100000 + Math.random() * 900000));
    console.info('[Nexus DEV] Novo código OTP:', forgotCode);
    showToast('Código reenviado!', 'success');
    startResendTimer(60);
};

function startResendTimer(seconds) {
    const link  = document.getElementById('resend-link');
    const timer = document.getElementById('resend-timer');
    if (link)  { link.style.pointerEvents = 'none'; link.style.opacity = '0.4'; }
    if (timer) timer.textContent = `(${seconds}s)`;

    clearInterval(resendInterval);
    let s = seconds;
    resendInterval = setInterval(() => {
        s--;
        if (timer) timer.textContent = s > 0 ? `(${s}s)` : '';
        if (s <= 0) {
            clearInterval(resendInterval);
            if (link) { link.style.pointerEvents = ''; link.style.opacity = '1'; }
        }
    }, 1000);
}

window.forgotValidatePass = function () {
    const np  = document.getElementById('new-pass')?.value    || '';
    const cp  = document.getElementById('confirm-pass')?.value || '';
    const btn = document.getElementById('btn-reset');
    const err = document.getElementById('confirm-pass-err');
    const match = np.length >= 8 && np === cp;
    if (btn) btn.disabled = !match;
    if (err) err.textContent = cp && !match ? (np !== cp ? 'As senhas não coincidem.' : 'Mínimo 8 caracteres.') : '';
};

window.forgotReset = function () {
    const np = document.getElementById('new-pass')?.value || '';
    if (document.getElementById('btn-reset')?.disabled) return;

    setForgotBtnLoading('btn-reset', 'btn-reset-text', 'spin-reset', true);

    setTimeout(() => {
        setForgotBtnLoading('btn-reset', 'btn-reset-text', 'spin-reset', false);
        const users = getUsers();
        const idx   = users.findIndex(u => u.email.toLowerCase() === forgotEmail);
        if (idx !== -1) { users[idx].password = np; saveUsers(users); }
        setForgotStep(4);
    }, 1200);
};

window.togglePw = function (inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const show = input.type === 'password';
    input.type        = show ? 'text' : 'password';
    btn.style.opacity = show ? '1' : '0.5';
};

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className   = `toast toast--${type} show`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    [1,2,3,4].forEach(i => {
        const p = document.getElementById('forgot-s' + i);
        if (p) p.style.display = i === 1 ? 'block' : 'none';
    });

    document.getElementById('login-user')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('login-pass')?.focus();
    });
});