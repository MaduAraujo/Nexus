let selectedProfileType = null;
let forgotStep = 1;
let forgotEmail = '';
let forgotCode = '';
let resendInterval = null;
let pendingLoginUser = null;
let loginStep = 1;

function getUsers() {
    try {
        return JSON.parse(localStorage.getItem('nexus_users') || '[]');
    } catch {
        return [];
    }
}

function saveUsers(users) {
    localStorage.setItem('nexus_users', JSON.stringify(users));
}

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `toast toast--${type} show`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove('show'), 3000);
}

function isBlocked(user) {
    return user && (user.status === 'Bloqueado' || user.status === 'Inativo');
}

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
    loginStep = 1;

    const pill = document.getElementById('login-profile-pill');
    const title = document.getElementById('login-title');
    const subtitle = document.getElementById('login-subtitle');
    const passSection = document.getElementById('login-pass-section');
    const btnLoginText = document.getElementById('btn-login-text');
    const loginPass = document.getElementById('login-pass');

    if (selectedProfileType === 'rh') {
        if (pill) pill.innerHTML = '<span class="profile-pill rh-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> RH</span>';
        if (title) title.textContent = 'Bem-vindo de volta';
        if (subtitle) subtitle.textContent = 'Acesse o painel de Recursos Humanos';
        if (passSection) passSection.style.display = 'none';
        if (btnLoginText) btnLoginText.textContent = 'Entrar';
    } else {
        if (pill) pill.innerHTML = '<span class="profile-pill colab-pill"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Colaborador</span>';
        if (title) title.textContent = 'Olá, colaborador!';
        if (subtitle) subtitle.textContent = 'Acesse sua área pessoal';
        if (passSection) passSection.style.display = 'none';
        if (btnLoginText) btnLoginText.textContent = 'Continuar';
    }

    if (loginPass) loginPass.value = '';
};

window.goToProfileSelection = function () {
    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));

    const profileSection = document.getElementById('form-profile');
    if (profileSection) profileSection.classList.add('active');

    const loginUser = document.getElementById('login-user');
    const loginPass = document.getElementById('login-pass');
    if (loginUser) loginUser.value = '';
    if (loginPass) loginPass.value = '';

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

window.handleLogin = function () {
    const emailInput = document.getElementById('login-user').value.trim().toLowerCase();
    const passInput = document.getElementById('login-pass').value;

    if (selectedProfileType === 'rh') {
        setLoginLoading(true);
        setTimeout(() => {
            setLoginLoading(false);
            window.location.href = '../screens/dashboard.html';
        }, 800);
        return;
    }

    if (!emailInput) {
        showToast('Informe seu e-mail.', 'error');
        return;
    }

    setLoginLoading(true);

    setTimeout(() => {
        setLoginLoading(false);

        const users = getUsers();
        const found = users.find(
            u => u.email.toLowerCase() === emailInput &&
                u.profile === 'colaborador'
        );

        if (!found) {
            showToast('E-mail não encontrado. Solicite seu cadastro ao RH.', 'error');
            return;
        }

        if (isBlocked(found)) {
            const statusMsg = found.status === 'Bloqueado'
                ? 'Sua conta está bloqueada.'
                : 'Sua conta está inativa.';
            showToast(`${statusMsg} Entre em contato com o RH.`, 'error');
            return;
        }

        if (loginStep === 1) {
            if (!found.password) {
                pendingLoginUser = found;
                openFirstAccessModal(found.email);
                return;
            }
            showPasswordStep();
            return;
        }

        if (!passInput) {
            showToast('Informe sua senha.', 'error');
            return;
        }

        if (found.password !== passInput) {
            showToast('Senha incorreta.', 'error');
            return;
        }

        completeLogin(found);
    }, 1400);
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

function completeLogin(user) {
    syncLastAccess(user);

    const { password: _pw, ...sessionUser } = user;
    localStorage.setItem('nexus_session', JSON.stringify(sessionUser));

    if (user.profile === 'rh') {
        window.location.href = '../screens/dashboard.html';
    } else {
        window.location.href = '../screens/inicio-colaborador.html';
    }
}

function openFirstAccessModal(userEmail) {
    const existing = document.getElementById('first-access-modal');
    if (existing) {
        existing.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'first-access-modal';
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
                    <p class="fam-title" id="fam-title">Primeiro Acesso</p>
                    <p class="fam-subtitle">Defina sua senha para acessar o sistema.</p>
                </div>
            </div>
            <div class="fam-body">
                <div class="fam-field">
                    <label class="fam-label">E-mail</label>
                    <div class="fam-input-wrap" style="opacity: 0.7;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                        </svg>
                        <input type="email" value="${userEmail}" disabled style="background: #f3f4f6;" />
                    </div>
                </div>
                <div class="fam-field">
                    <label class="fam-label" for="fam-password">Nova Senha</label>
                    <div class="fam-input-wrap">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        <input type="password" id="fam-password" placeholder="Mínimo 8 caracteres"
                               oninput="window.validateFirstAccessPassword()" />
                    </div>
                    <p class="fam-error" id="fam-password-err"></p>
                    <div class="strength-wrap" id="fam-strength-wrap">
                        <div class="pw-bars">
                            <div class="pw-bar" id="fam-bar-1"></div>
                            <div class="pw-bar" id="fam-bar-2"></div>
                            <div class="pw-bar" id="fam-bar-3"></div>
                        </div>
                        <div class="pw-strength-footer">
                            <span class="pw-strength-label" id="fam-strength-label"></span>
                        </div>
                        <ul class="pw-criteria">
                            <li class="crit" id="fam-crit-length"><span class="crit-dot"></span>Mínimo 8 caracteres</li>
                            <li class="crit" id="fam-crit-letter"><span class="crit-dot"></span>Contém letras</li>
                            <li class="crit" id="fam-crit-number"><span class="crit-dot"></span>Contém números</li>
                        </ul>
                    </div>
                </div>
                <div class="fam-field">
                    <label class="fam-label" for="fam-confirm-password">Confirmar Nova Senha</label>
                    <div class="fam-input-wrap">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        <input type="password" id="fam-confirm-password" placeholder="Repita a senha"
                               oninput="window.validateFirstAccessPassword()" />
                    </div>
                    <p class="fam-error" id="fam-confirm-password-err"></p>
                </div>
            </div>
            <button class="fam-btn" id="fam-btn" onclick="submitFirstAccess('${userEmail}')" disabled>
                <span id="fam-btn-text">Definir Senha</span>
                <div class="fam-spinner" id="fam-spinner"></div>
            </button>
            <p class="fam-footer-text">
                Em caso de dúvidas, entre em contato com o RH.
            </p>
        </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            overlay.classList.add('fam-visible');
            document.getElementById('fam-password')?.focus();
        });
    });
}

window.validateFirstAccessPassword = function () {
    const password = document.getElementById('fam-password')?.value || '';
    const confirmPassword = document.getElementById('fam-confirm-password')?.value || '';
    const btn = document.getElementById('fam-btn');

    const hasLength = password.length >= 8;
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);

    const critLength = document.getElementById('fam-crit-length');
    const critLetter = document.getElementById('fam-crit-letter');
    const critNumber = document.getElementById('fam-crit-number');
    if (critLength) critLength.classList.toggle('ok', hasLength);
    if (critLetter) critLetter.classList.toggle('ok', hasLetter);
    if (critNumber) critNumber.classList.toggle('ok', hasNumber);

    const strengthWrap = document.getElementById('fam-strength-wrap');
    const bar1 = document.getElementById('fam-bar-1');
    const bar2 = document.getElementById('fam-bar-2');
    const bar3 = document.getElementById('fam-bar-3');
    const strengthLabel = document.getElementById('fam-strength-label');

    if (password.length > 0) {
        if (strengthWrap) strengthWrap.style.display = 'block';
        const strength = [hasLength, hasLetter, hasNumber].filter(Boolean).length;
        const level = strength < 2 ? 1 : strength;
        const colors = { 1: '#ef4444', 2: '#f59e0b', 3: '#22c55e' };
        const labels = { 1: 'Fraca', 2: 'Média', 3: 'Forte' };
        const inactive = '#e5e7eb';
        const color = colors[level];
        if (bar1) bar1.style.background = level >= 1 ? color : inactive;
        if (bar2) bar2.style.background = level >= 2 ? color : inactive;
        if (bar3) bar3.style.background = level >= 3 ? color : inactive;
        if (strengthLabel) {
            strengthLabel.textContent = labels[level];
            strengthLabel.style.color = color;
        }
    } else {
        if (strengthWrap) strengthWrap.style.display = 'none';
    }

    const passErr = document.getElementById('fam-password-err');
    const confirmErr = document.getElementById('fam-confirm-password-err');

    if (password && !hasLength) {
        if (passErr) passErr.textContent = 'Senha deve ter no mínimo 8 caracteres.';
    } else {
        if (passErr) passErr.textContent = '';
    }

    if (confirmPassword && password !== confirmPassword) {
        if (confirmErr) confirmErr.textContent = 'As senhas não coincidem.';
    } else {
        if (confirmErr) confirmErr.textContent = '';
    }

    const allCriteriaMet = hasLength && hasLetter && hasNumber;
    if (btn) {
        btn.disabled = !password || !confirmPassword || !allCriteriaMet || password !== confirmPassword;
    }
};

window.submitFirstAccess = function (userEmail) {
    const password = document.getElementById('fam-password').value;
    const confirmPassword = document.getElementById('fam-confirm-password').value;

    let hasError = false;

    if (!password || password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        document.getElementById('fam-password-err').textContent = 'A senha deve ter no mínimo 8 caracteres, letras e números.';
        hasError = true;
    } else {
        document.getElementById('fam-password-err').textContent = '';
    }

    if (password !== confirmPassword) {
        document.getElementById('fam-confirm-password-err').textContent = 'As senhas não coincidem.';
        hasError = true;
    } else {
        document.getElementById('fam-confirm-password-err').textContent = '';
    }

    if (hasError) return;

    const btn = document.getElementById('fam-btn');
    const text = document.getElementById('fam-btn-text');
    const spin = document.getElementById('fam-spinner');
    btn.disabled = true;
    text.style.opacity = '0';
    spin.style.display = 'block';

    setTimeout(() => {
        const users = getUsers();
        const idx = users.findIndex(u => u.email.toLowerCase() === userEmail.toLowerCase());

        if (idx !== -1) {
            users[idx].password = password;
            users[idx].firstAccess = false;
            users[idx].status = 'Ativo';
            saveUsers(users);

            const modal = document.getElementById('first-access-modal');
            if (modal) {
                modal.classList.remove('fam-visible');
                setTimeout(() => modal.remove(), 300);
            }

            loginStep = 1;
            const loginUser = document.getElementById('login-user');
            const loginPass = document.getElementById('login-pass');
            const passSection = document.getElementById('login-pass-section');
            const btnLoginText = document.getElementById('btn-login-text');
            if (loginUser) loginUser.value = '';
            if (loginPass) loginPass.value = '';
            if (passSection) passSection.style.display = 'none';
            if (btnLoginText) btnLoginText.textContent = 'Continuar';

            showToast('Senha definida com sucesso! Faça seu login para continuar.', 'success');
            setTimeout(() => loginUser?.focus(), 400);
        }
    }, 900);
};

function syncLastAccess(user) {
    if (user.profile !== 'colaborador') return;

    const employees = JSON.parse(localStorage.getItem('nexus_employees') || '[]');
    const empIndex = employees.findIndex(e =>
        e.email?.toLowerCase() === user.email.toLowerCase() ||
        e.cpf === user.cpf ||
        e.id === user.employeeId
    );

    if (empIndex !== -1) {
        employees[empIndex].lastAccess = new Date().toISOString();
        localStorage.setItem('nexus_employees', JSON.stringify(employees));

        window.dispatchEvent(new StorageEvent('storage', {
            key: 'nexus_employees',
            newValue: JSON.stringify(employees),
            oldValue: null,
            storageArea: localStorage
        }));
    }
}

window.setUserBlocked = function (targetId, block) {
    const users = getUsers();
    const idx = users.findIndex(u => u.id === targetId);

    if (idx === -1) {
        return { ok: false, message: 'Usuário não encontrado.' };
    }

    users[idx].status = block ? 'Bloqueado' : 'Ativo';
    saveUsers(users);

    if (users[idx].profile === 'colaborador') {
        const employees = JSON.parse(localStorage.getItem('nexus_employees') || '[]');
        const empIndex = employees.findIndex(e =>
            e.email?.toLowerCase() === users[idx].email.toLowerCase() ||
            e.cpf === users[idx].cpf ||
            e.id === users[idx].employeeId
        );

        if (empIndex !== -1) {
            employees[empIndex].status = block ? 'Inativo' : 'Ativo';
            localStorage.setItem('nexus_employees', JSON.stringify(employees));
        }
    }

    return {
        ok: true,
        message: block
            ? `${users[idx].name} foi bloqueado com sucesso.`
            : `${users[idx].name} foi reativado com sucesso.`,
    };
};

function setForgotStep(step) {
    forgotStep = step;
    [1, 2, 3, 4].forEach(i => {
        const panel = document.getElementById('forgot-s' + i);
        const dot = document.getElementById('fdot-' + i);
        if (panel) panel.style.display = i === step ? 'block' : 'none';
        if (dot) dot.classList.toggle('active', i <= step);
    });
}

window.backToLogin = function () {
    switchTab('login');
    setForgotStep(1);
    document.getElementById('forgot-email').value = '';
    forgotEmail = '';
    forgotCode = '';
    clearInterval(resendInterval);
};

window.forgotSendCode = function () {
    const email = document.getElementById('forgot-email')?.value.trim().toLowerCase();
    const errEl = document.getElementById('forgot-email-err');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (errEl) errEl.textContent = 'Informe um e-mail válido.';
        return;
    }

    const users = getUsers();
    const userExists = users.some(u => u.email.toLowerCase() === email);
    if (!userExists) {
        if (errEl) errEl.textContent = 'E-mail não encontrado no sistema.';
        return;
    }

    forgotEmail = email;
    forgotCode = String(Math.floor(100000 + Math.random() * 900000));
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

window.forgotClearErr = function (errId, input) {
    const err = document.getElementById(errId);
    if (err) err.textContent = '';
    input?.classList.remove('input-error');
};

window.otpInput = function (el, idx) {
    el.value = el.value.replace(/\D/g, '').slice(0, 1);
    if (el.value && idx < 5) document.getElementById('otp' + (idx + 1))?.focus();
    checkOtpComplete();
};

window.otpKey = function (e, idx) {
    if (e.key === 'Backspace' && !e.target.value && idx > 0)
        document.getElementById('otp' + (idx - 1))?.focus();
};

window.otpPaste = function (e) {
    e.preventDefault();
    const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    digits.split('').forEach((d, i) => {
        const inp = document.getElementById('otp' + i);
        if (inp) inp.value = d;
    });
    checkOtpComplete();
    document.getElementById('otp' + Math.min(digits.length, 5))?.focus();
};

function checkOtpComplete() {
    const complete = [0, 1, 2, 3, 4, 5].every(i => (document.getElementById('otp' + i)?.value || '') !== '');
    const btn = document.getElementById('btn-otp-verify');
    if (btn) btn.disabled = !complete;
}

window.forgotVerifyOtp = function () {
    const entered = [0, 1, 2, 3, 4, 5].map(i => document.getElementById('otp' + i)?.value || '').join('');
    const errEl = document.getElementById('otp-err');

    setForgotBtnLoading('btn-otp-verify', 'btn-otp-text', 'spin-otp', true);

    setTimeout(() => {
        setForgotBtnLoading('btn-otp-verify', 'btn-otp-text', 'spin-otp', false);

        if (entered === forgotCode) {
            if (errEl) errEl.textContent = '';
            setForgotStep(3);
        } else {
            if (errEl) errEl.textContent = 'Código incorreto. Tente novamente.';
            [0, 1, 2, 3, 4, 5].forEach(i => {
                const inp = document.getElementById('otp' + i);
                if (inp) inp.value = '';
            });
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
    const link = document.getElementById('resend-link');
    const timer = document.getElementById('resend-timer');
    if (link) {
        link.style.pointerEvents = 'none';
        link.style.opacity = '0.4';
    }
    if (timer) timer.textContent = `(${seconds}s)`;

    clearInterval(resendInterval);
    let s = seconds;
    resendInterval = setInterval(() => {
        s--;
        if (timer) timer.textContent = s > 0 ? `(${s}s)` : '';
        if (s <= 0) {
            clearInterval(resendInterval);
            if (link) {
                link.style.pointerEvents = '';
                link.style.opacity = '1';
            }
        }
    }, 1000);
}

window.forgotValidatePass = function () {
    const np = document.getElementById('new-pass')?.value || '';
    const cp = document.getElementById('confirm-pass')?.value || '';
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
        const idx = users.findIndex(u => u.email.toLowerCase() === forgotEmail);
        if (idx !== -1) {
            users[idx].password = np;
            saveUsers(users);
        }
        setForgotStep(4);
    }, 1200);
};

window.togglePw = function (inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.style.opacity = show ? '1' : '0.5';
};

document.addEventListener('DOMContentLoaded', () => {
    [1, 2, 3, 4].forEach(i => {
        const p = document.getElementById('forgot-s' + i);
        if (p) p.style.display = i === 1 ? 'block' : 'none';
    });

    document.getElementById('login-user')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            if (selectedProfileType === 'colaborador' && loginStep === 1) {
                handleLogin();
            } else {
                document.getElementById('login-pass')?.focus();
            }
        }
    });

    document.getElementById('login-user')?.addEventListener('input', () => {
        if (loginStep === 2) {
            loginStep = 1;
            const passSection = document.getElementById('login-pass-section');
            if (passSection) passSection.style.display = 'none';
            const btnLoginText = document.getElementById('btn-login-text');
            if (btnLoginText) btnLoginText.textContent = 'Continuar';
            const loginPass = document.getElementById('login-pass');
            if (loginPass) loginPass.value = '';
        }
    });

    window.addEventListener('storage', (event) => {
        if (event.key === 'nexus_users' || event.key === 'nexus_employees') {
            console.log('[Nexus Login] Dados sincronizados de outra aba:', event.key);
        }
    });
});