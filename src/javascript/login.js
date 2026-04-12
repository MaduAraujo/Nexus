let selectedProfile = null;
let selectedSignupProfile = null;

const profiles = {
    rh: {
        label: 'RH',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
        title: 'Acesso RH',
        subtitle: 'Área restrita',
        btnClass: 'btn-rh',
    },
    colaborador: {
        label: 'Colaborador',
        icon: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        title: 'Bem-vindo de volta',
        subtitle: 'Acesse sua conta para continuar',
        btnClass: 'btn-colaborador',
    }
};

// ─── Força de senha ───────────────────────────────────────
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

    if (!value) {
        wrap.style.display = 'none';
        return 0;
    }

    wrap.style.display = 'block';

    const { score, len, upper, num, sym } = calcPasswordScore(value);
    const level = STRENGTH_LEVELS[Math.max(0, score - 1)];

    for (let i = 1; i <= 4; i++) {
        const bar = document.getElementById(`pw-bar-${i}`);
        bar.className = 'pw-bar' + (i <= level.bars ? ` ${level.barCls}` : '');
    }

    const label = document.getElementById('pw-strength-label');
    label.textContent = level.label;
    label.className = `pw-strength-label ${level.cls}`;

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
    const btn = document.querySelector('#form-signup .btn-submit');
    if (btn) btn.disabled = score < 4;
}

// ─── Validação ────────────────────────────────────────────
const RULES = {
    user: {
        required: 'Preencha o campo de usuário',
        minLength: { value: 3, message: 'Mínimo de 3 caracteres' },
    },
    pass: {
        required: 'Preencha o campo de senha',
        minLength: { value: 6, message: 'Mínimo de 8 caracteres' },
    },
    name: {
        required: 'Preencha seu nome completo',
        minLength: { value: 2, message: 'Nome muito curto' },
    },
    email: {
        required: 'Preencha o e-mail',
        pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'E-mail inválido' },
    },
};

function validateField(input, ruleKey, touched = false) {
    const rule = RULES[ruleKey];
    const value = input.value.trim();
    let error = null;

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
    let errEl = wrap.querySelector('.field-error');

    if (!errEl) {
        errEl = document.createElement('p');
        errEl.className = 'field-error';
        input.closest('.field-input-wrap').insertAdjacentElement('afterend', errEl);
    }

    if (errorMessage) {
        input.classList.add('is-error');
        input.classList.remove('is-ok');
        errEl.textContent = errorMessage;
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

// ─── Login ────────────────────────────────────────────────
function handleLogin() {
    const userInput = document.getElementById('login-user');
    const passInput = document.getElementById('login-pass');

    const userOk = validateField(userInput, 'user', true);
    const passOk = validateField(passInput, 'pass', true);

    if (!userOk || !passOk) return;

    const btn     = document.getElementById('btn-login');
    const txt     = document.getElementById('btn-login-text');
    const spinner = document.getElementById('spinner-login');

    txt.style.display = 'none';
    spinner.classList.add('show');
    btn.disabled = true;

    setTimeout(() => {
        txt.style.display = '';
        spinner.classList.remove('show');
        btn.disabled = false;

        if (selectedProfile === 'rh') {
            window.location.href = '../screens/inicial.html';
        } else {
            showToast('Login realizado com sucesso!');
        }
    }, 1500);
}

function setLoginLoading(loading) {
    const btn     = document.getElementById('btn-login');
    const text    = document.getElementById('btn-login-text');
    const spinner = document.getElementById('spinner-login');
    btn.disabled          = loading;
    text.style.opacity    = loading ? '0' : '1';
    spinner.style.display = loading ? 'block' : 'none';
}

// ─── Cadastro ─────────────────────────────────────────────
function handleSignup() {
    const fields = document.querySelectorAll('#form-signup input');
    const [nameInput, emailInput, passInput] = fields;

    const nameOk  = validateField(nameInput,  'name',  true);
    const emailOk = validateField(emailInput, 'email', true);
    const passOk  = validateField(passInput,  'pass',  true);

    if (!selectedSignupProfile) {
        showToast('Selecione um perfil para continuar');
        return;
    }

    if (!nameOk || !emailOk || !passOk) return;

    showToast('Conta criada com sucesso!');
    setTimeout(() => switchTab('login'), 1500);
}

// ─── Validação em tempo real ──────────────────────────────
function initFieldListeners() {
    const loginUser = document.getElementById('login-user');
    const loginPass = document.getElementById('login-pass');

    loginUser.addEventListener('blur', () => validateField(loginUser, 'user', true));
    loginUser.addEventListener('input', () => {
        if (loginUser.classList.contains('is-error')) validateField(loginUser, 'user', true);
    });

    loginPass.addEventListener('blur', () => validateField(loginPass, 'pass', true));
    loginPass.addEventListener('input', () => {
        if (loginPass.classList.contains('is-error')) validateField(loginPass, 'pass', true);
    });

    document.querySelectorAll('#form-signup input').forEach((input, i) => {
        const ruleKeys = ['name', 'email', 'pass'];
        const key = ruleKeys[i];
        if (!key) return;
        input.addEventListener('blur',  () => validateField(input, key, true));
        input.addEventListener('input', () => {
            if (input.classList.contains('is-error')) validateField(input, key, true);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('nexus_profile');
    if (saved) {
        const card = document.querySelector(`.profile-card.${saved}`);
        if (card) selectProfile(saved, card);
    }

    initFieldListeners();
});

// ─── Perfil ───────────────────────────────────────────────
function selectProfile(type, el) {
    selectedProfile = type;
    localStorage.setItem('nexus_profile', type);

    document.querySelectorAll('#form-profile .profile-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');

    const btn = document.getElementById('btn-continue');
    btn.disabled      = false;
    btn.style.opacity = '1';
    btn.style.cursor  = 'pointer';
}

function selectSignupProfile(type, el) {
    selectedSignupProfile = type;

    document.querySelectorAll('#form-signup .profile-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
}

function goToLogin() {
    if (!selectedProfile) return;
    switchTab('login');
}

function switchTab(tab) {
    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
    document.getElementById('form-' + tab).classList.add('active');

    if (tab === 'login' && selectedProfile) {
        const p = profiles[selectedProfile];

        const pill = document.getElementById('login-profile-pill');
        pill.innerHTML = `<div class="profile-pill ${selectedProfile}">${p.icon}${p.label}</div>`;

        document.getElementById('login-title').textContent    = p.title;
        document.getElementById('login-subtitle').textContent = p.subtitle;

        const btn = document.getElementById('btn-login');
        btn.className = 'btn-submit ' + p.btnClass;
    }
}

// ─── Utilitários ─────────────────────────────────────────
function togglePw(id, btn) {
    const input  = document.getElementById(id);
    const isText = input.type === 'text';
    input.type = isText ? 'password' : 'text';
    btn.querySelector('svg').style.opacity = isText ? '1' : '0.5';
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
}

function logout() {
    localStorage.removeItem('nexus_profile');
    window.location.href = '../screens/login.html';
}