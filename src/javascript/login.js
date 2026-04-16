let selectedProfile       = null;
let selectedSignupProfile = null;
let forgotResendInterval  = null;

const profiles = {
    rh: {
        label:    'RH',
        icon:     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        title:    'Acesso RH',
        subtitle: 'Área restrita',
        btnClass: 'btn-rh',
    },
    colaborador: {
        label:    'Colaborador',
        icon:     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        title:    'Bem-vindo de volta',
        subtitle: 'Acesse sua conta para continuar',
        btnClass: 'btn-colaborador',
    },
};

function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

let currentOtp = null;

/* ─── Força de senha ─────────────────────────────────────── */
const STRENGTH_LEVELS = [
    { label: 'Muito fraca', cls: 's1', bars: 1, barCls: 'active-1' },
    { label: 'Fraca',       cls: 's2', bars: 2, barCls: 'active-2' },
    { label: 'Boa',         cls: 's3', bars: 3, barCls: 'active-3' },
    { label: 'Forte',       cls: 's4', bars: 4, barCls: 'active-4' },
];

function calcPasswordScore(value) {
    const criteria = {
        len:   value.length >= 8,
        upper: /[A-Z]/.test(value),
        num:   /[0-9]/.test(value),
        sym:   /[^A-Za-z0-9]/.test(value),
    };
    const score = Object.values(criteria).filter(Boolean).length;
    return { score, ...criteria };
}

function checkPasswordStrength(value) {
    const wrap = document.getElementById('strength-wrap');
    if (!value) { wrap.style.display = 'none'; return 0; }

    wrap.style.display = 'block';

    const { score, len, upper, num, sym } = calcPasswordScore(value);
    const level = STRENGTH_LEVELS[Math.max(0, score - 1)];

    for (let i = 1; i <= 4; i++) {
        const bar = document.getElementById(`pw-bar-${i}`);
        bar.className = 'pw-bar' + (i <= level.bars ? ` ${level.barCls}` : '');
    }

    const label = document.getElementById('pw-strength-label');
    label.textContent = level.label;
    label.className   = `pw-strength-label ${level.cls}`;

    const pool = (len ? 8 : 0) + (upper ? 26 : 0) + (num ? 10 : 0) + (sym ? 32 : 0) || 26;
    const bits = Math.round(value.length * Math.log2(pool));
    document.getElementById('pw-entropy').textContent = `~${bits} bits`;

    setCriteria('c-len',   len);
    setCriteria('c-upper', upper);
    setCriteria('c-num',   num);
    setCriteria('c-sym',   sym);

    return score;
}

function setCriteria(id, met) {
    document.getElementById(id)?.classList.toggle('met', met);
}

function onSignupPasswordInput(value) {
    const score = checkPasswordStrength(value);
    /* O botão só fica ativo quando a senha é forte (score 4) E o perfil foi selecionado */
    updateSignupBtn();
}

function updateSignupBtn() {
    const passInput = document.getElementById('signup-pass');
    const { score } = calcPasswordScore(passInput ? passInput.value : '');
    const btn = document.querySelector('#form-signup .btn-submit');
    if (btn) btn.disabled = score < 4 || !selectedSignupProfile;
}

/* ─── Validação ──────────────────────────────────────────── */
const RULES = {
    user: {
        required:  'Preencha o campo de usuário',
        minLength: { value: 3, message: 'Mínimo de 3 caracteres' },
    },
    pass: {
        required:  'Preencha o campo de senha',
        minLength: { value: 8, message: 'Mínimo de 8 caracteres' },
    },
    name: {
        required:  'Preencha seu nome completo',
        minLength: { value: 2, message: 'Nome muito curto' },
    },
    email: {
        required: 'Preencha o e-mail',
        pattern:  { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'E-mail inválido' },
    },
};

function validateField(input, ruleKey, touched = false) {
    const rule  = RULES[ruleKey];
    const value = input.value.trim();
    let error   = null;

    if (!value) {
        error = touched ? rule.required : null;
    } else if (rule.minLength && value.length < rule.minLength.value) {
        error = rule.minLength.message;
    } else if (rule.pattern && !rule.pattern.value.test(value)) {
        error = rule.pattern.message;
    }

    applyFieldState(input, error);
    return error === null && value.length > 0;
}

function applyFieldState(input, errorMessage) {
    const wrap = input.closest('.field') || input.parentElement.parentElement;
    let errEl  = wrap.querySelector('.field-error');

    if (!errEl) {
        errEl = document.createElement('p');
        errEl.className = 'field-error';
        input.closest('.field-input-wrap').insertAdjacentElement('afterend', errEl);
    }

    if (errorMessage) {
        input.classList.add('is-error');
        input.classList.remove('is-ok');
        errEl.textContent   = errorMessage;
        errEl.style.display = 'flex';
        input.setAttribute('aria-invalid', 'true');
    } else if (input.value.trim()) {
        input.classList.remove('is-error');
        input.classList.add('is-ok');
        errEl.style.display = 'none';
        input.setAttribute('aria-invalid', 'false');
    } else {
        input.classList.remove('is-error', 'is-ok');
        errEl.style.display = 'none';
        input.removeAttribute('aria-invalid');
    }
}

/* ─── Loading helper ─────────────────────────────────────── */
function setBtnLoading(btnId, spinId, textId, on) {
    const btn  = document.getElementById(btnId);
    const spin = document.getElementById(spinId);
    const text = document.getElementById(textId);
    if (btn)  btn.disabled       = on;
    if (text) text.style.opacity = on ? '0' : '1';
    if (spin) spin.classList.toggle('show', on);
}

/* ─── Login ──────────────────────────────────────────────── */
function handleLogin() {
    const userInput = document.getElementById('login-user');
    const passInput = document.getElementById('login-pass');

    const userOk = validateField(userInput, 'user', true);
    const passOk = validateField(passInput, 'pass', true);

    if (!userOk || !passOk) return;

    setBtnLoading('btn-login', 'spinner-login', 'btn-login-text', true);

    setTimeout(() => {
        setBtnLoading('btn-login', 'spinner-login', 'btn-login-text', false);

        if (selectedProfile === 'rh') {
            window.location.href = '../screens/dashboard.html';
        } else {
            showToast('Login realizado com sucesso!');
        }
    }, 1500);
}

/* ─── Cadastro ───────────────────────────────────────────── */
function handleSignup() {
    const nameInput  = document.getElementById('signup-name');
    const emailInput = document.getElementById('signup-email');
    const passInput  = document.getElementById('signup-pass');

    if (!selectedSignupProfile) {
        showToast('Selecione um perfil para continuar');
        return;
    }

    const nameOk  = validateField(nameInput,  'name',  true);
    const emailOk = validateField(emailInput, 'email', true);
    const passOk  = validateField(passInput,  'pass',  true);

    if (!nameOk || !emailOk || !passOk) return;

    showToast('Conta criada com sucesso!');
    setTimeout(() => switchTab('login'), 1500);
}

/* ─── Esqueci minha senha ────────────────────────────────── */
function forgotGoTo(step) {
    [1, 2, 3, 4].forEach(i => {
        const s   = document.getElementById(`forgot-s${i}`);
        const dot = document.getElementById(`fdot-${i}`);

        if (s) s.style.display = i === step ? 'block' : 'none';

        if (dot) {
            dot.classList.remove('active', 'done');
            if (i === step) dot.classList.add('active');
            else if (i < step) dot.classList.add('done');
        }
    });

    const steps = document.getElementById('forgot-steps');
    if (steps) steps.style.display = step === 4 ? 'none' : 'flex';
}

function forgotClearErr(errId, input) {
    const el = document.getElementById(errId);
    if (el) { el.textContent = ''; el.classList.remove('show'); }
    if (input) input.classList.remove('is-error');
}

function forgotShowErr(errId, msg, input) {
    const el = document.getElementById(errId);
    if (el) { el.textContent = msg; el.classList.add('show'); }
    if (input) { input.classList.add('is-error'); input.focus(); }
}

async function forgotSendCode() {
    const input = document.getElementById('forgot-email');
    const value = input.value.trim();

    if (!value) {
        forgotShowErr('forgot-email-err', 'Preencha o e-mail', input);
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        forgotShowErr('forgot-email-err', 'E-mail inválido', input);
        return;
    }

    setBtnLoading('btn-forgot-send', 'spin-forgot-send', 'btn-forgot-send-text', true);

    await new Promise(r => setTimeout(r, 800));

    currentOtp = generateOtp();
    console.info(`[DEV] Código OTP: ${currentOtp}`);

    document.getElementById('forgot-email-shown').textContent = value;
    forgotClearOtp();
    forgotStartResendTimer();
    forgotGoTo(2);
    setTimeout(() => document.getElementById('otp0')?.focus(), 100);

    setBtnLoading('btn-forgot-send', 'spin-forgot-send', 'btn-forgot-send-text', false);
}

/* ─── OTP ────────────────────────────────────────────────── */
function otpInput(el, idx) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    el.classList.toggle('otp-filled', el.value !== '');

    const errEl = document.getElementById('otp-err');
    if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
    document.querySelectorAll('.otp-input').forEach(i => i.classList.remove('is-error'));

    if (el.value && idx < 5) document.getElementById(`otp${idx + 1}`)?.focus();

    const btn = document.getElementById('btn-otp-verify');
    if (btn) btn.disabled = getOtpValue().length < 6;
}

function otpKey(e, idx) {
    if (e.key === 'Backspace' && !e.target.value && idx > 0)
        document.getElementById(`otp${idx - 1}`)?.focus();
    if (e.key === 'ArrowLeft'  && idx > 0) document.getElementById(`otp${idx - 1}`)?.focus();
    if (e.key === 'ArrowRight' && idx < 5) document.getElementById(`otp${idx + 1}`)?.focus();
}

function otpPaste(e) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    digits.split('').forEach((d, i) => {
        const inp = document.getElementById(`otp${i}`);
        if (inp) { inp.value = d; inp.classList.add('otp-filled'); }
    });
    const btn = document.getElementById('btn-otp-verify');
    if (btn) btn.disabled = digits.length < 6;
    document.getElementById(`otp${Math.min(digits.length, 5)}`)?.focus();
}

function getOtpValue() {
    return [0, 1, 2, 3, 4, 5]
        .map(i => document.getElementById(`otp${i}`)?.value || '')
        .join('');
}

function forgotClearOtp() {
    [0, 1, 2, 3, 4, 5].forEach(i => {
        const el = document.getElementById(`otp${i}`);
        if (el) { el.value = ''; el.classList.remove('otp-filled', 'is-error'); }
    });
    const btn = document.getElementById('btn-otp-verify');
    if (btn) btn.disabled = true;
}

async function forgotVerifyOtp() {
    const code = getOtpValue();
    if (code.length < 6) return;

    setBtnLoading('btn-otp-verify', 'spin-otp', 'btn-otp-text', true);

    await new Promise(r => setTimeout(r, 400));

    if (code !== currentOtp) {
        const errEl = document.getElementById('otp-err');
        if (errEl) { errEl.textContent = 'Código incorreto. Tente novamente.'; errEl.classList.add('show'); }
        document.querySelectorAll('.otp-input').forEach(i => i.classList.add('is-error'));
        setBtnLoading('btn-otp-verify', 'spin-otp', 'btn-otp-text', false);
        return;
    }

    currentOtp = null;
    forgotGoTo(3);
    setTimeout(() => document.getElementById('new-pass')?.focus(), 100);
    setBtnLoading('btn-otp-verify', 'spin-otp', 'btn-otp-text', false);
}

function forgotStartResendTimer() {
    let seconds = 30;
    const link  = document.getElementById('resend-link');
    const timer = document.getElementById('resend-timer');
    if (!link || !timer) return;

    link.classList.add('resend-disabled');
    if (forgotResendInterval) clearInterval(forgotResendInterval);

    timer.textContent = `(${seconds}s)`;
    forgotResendInterval = setInterval(() => {
        seconds--;
        timer.textContent = `(${seconds}s)`;
        if (seconds <= 0) {
            clearInterval(forgotResendInterval);
            link.classList.remove('resend-disabled');
            timer.textContent = '';
        }
    }, 1000);
}

async function forgotResend() {
    const email = document.getElementById('forgot-email-shown').textContent;
    if (!email) return;

    forgotClearOtp();
    forgotStartResendTimer();

    await new Promise(r => setTimeout(r, 400));
    currentOtp = generateOtp();
    console.info(`[DEV] Código OTP reenviado: ${currentOtp}`);
}

/* ─── Nova senha ─────────────────────────────────────────── */
function forgotValidatePass() {
    const np = document.getElementById('new-pass').value;
    const cp = document.getElementById('confirm-pass').value;

    const npOk = np.length >= 8;
    const cpOk = cp.length > 0 && np === cp;

    const npErr = document.getElementById('new-pass-err');
    const cpErr = document.getElementById('confirm-pass-err');

    if (np.length > 0 && !npOk) {
        npErr.textContent = 'Mínimo 8 caracteres';
        npErr.classList.add('show');
    } else {
        npErr.classList.remove('show');
    }

    if (cp.length > 0 && !cpOk) {
        cpErr.textContent = 'As senhas não coincidem';
        cpErr.classList.add('show');
    } else {
        cpErr.classList.remove('show');
    }

    const btn = document.getElementById('btn-reset');
    if (btn) btn.disabled = !(npOk && cpOk);
}

async function forgotReset() {
    const np = document.getElementById('new-pass').value;
    const cp = document.getElementById('confirm-pass').value;
    if (np.length < 8 || np !== cp) return;

    setBtnLoading('btn-reset', 'spin-reset', 'btn-reset-text', true);

    await new Promise(r => setTimeout(r, 1200));
    forgotGoTo(4);

    setBtnLoading('btn-reset', 'spin-reset', 'btn-reset-text', false);
}

/* ─── Validação em tempo real ────────────────────────────── */
function initFieldListeners() {
    const loginUser = document.getElementById('login-user');
    const loginPass = document.getElementById('login-pass');

    if (loginUser) {
        loginUser.addEventListener('blur',  () => validateField(loginUser, 'user', true));
        loginUser.addEventListener('input', () => {
            if (loginUser.classList.contains('is-error')) validateField(loginUser, 'user', true);
        });
    }

    if (loginPass) {
        loginPass.addEventListener('blur',  () => validateField(loginPass, 'pass', true));
        loginPass.addEventListener('input', () => {
            if (loginPass.classList.contains('is-error')) validateField(loginPass, 'pass', true);
        });
    }

    const signupName  = document.getElementById('signup-name');
    const signupEmail = document.getElementById('signup-email');
    const signupPass  = document.getElementById('signup-pass');
    const pairs       = [[signupName, 'name'], [signupEmail, 'email'], [signupPass, 'pass']];

    pairs.forEach(([input, key]) => {
        if (!input) return;
        input.addEventListener('blur',  () => validateField(input, key, true));
        input.addEventListener('input', () => {
            if (input.classList.contains('is-error')) validateField(input, key, true);
        });
    });
}

/* ─── DOMContentLoaded ───────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    /* Tenta restaurar perfil salvo; usa try/catch caso localStorage
       esteja bloqueado (modo privado em alguns navegadores) */
    try {
        const saved = localStorage.getItem('nexus_profile');
        if (saved && profiles[saved]) {
            const card = document.querySelector(`#form-profile .profile-card.${saved}`);
            if (card) selectProfile(saved, card);
        }
    } catch (e) {
        /* localStorage indisponível — ignora silenciosamente */
    }

    initFieldListeners();
});

/* ─── Perfil ─────────────────────────────────────────────── */
function selectProfile(type, el) {
    if (!profiles[type]) return;

    selectedProfile = type;

    try {
        localStorage.setItem('nexus_profile', type);
    } catch (e) { /* ignorado */ }

    document.querySelectorAll('#form-profile .profile-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');

    const btn = document.getElementById('btn-continue');
    if (btn) {
        btn.disabled      = false;
        btn.style.opacity = '1';
        btn.style.cursor  = 'pointer';
    }
}

function selectSignupProfile(type, el) {
    if (!profiles[type]) return;

    selectedSignupProfile = type;
    document.querySelectorAll('#form-signup .profile-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');

    /* Reavalia botão de criar conta após seleção de perfil */
    updateSignupBtn();
}

function goToLogin() {
    if (!selectedProfile) return;
    switchTab('login');
}

function switchTab(tab) {
    const validTabs = ['profile', 'login', 'signup', 'forgot'];
    if (!validTabs.includes(tab)) return;

    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));

    const target = document.getElementById('form-' + tab);
    if (!target) return;
    target.classList.add('active');

    if (tab === 'login' && selectedProfile) {
        const p = profiles[selectedProfile];

        const pill = document.getElementById('login-profile-pill');
        if (pill) pill.innerHTML = `<div class="profile-pill ${selectedProfile}">${p.icon}${p.label}</div>`;

        const loginTitle    = document.getElementById('login-title');
        const loginSubtitle = document.getElementById('login-subtitle');
        if (loginTitle)    loginTitle.textContent    = p.title;
        if (loginSubtitle) loginSubtitle.textContent = p.subtitle;

        const btn = document.getElementById('btn-login');
        if (btn) btn.className = 'btn-submit ' + p.btnClass;
    }

    if (tab === 'forgot') {
        forgotGoTo(1);
        const emailInput = document.getElementById('forgot-email');
        if (emailInput) emailInput.value = '';
        forgotClearErr('forgot-email-err');
    }
}

/* ─── Utilitários ────────────────────────────────────────── */
function togglePw(id, btn) {
    const input  = document.getElementById(id);
    if (!input) return;
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    const svg = btn.querySelector('svg');
    if (svg) svg.style.opacity = isText ? '1' : '0.5';
}

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
}

function logout() {
    try {
        localStorage.removeItem('nexus_profile');
    } catch (e) { /* ignorado */ }
    window.location.href = '../screens/login.html';
}