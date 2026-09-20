window.NexusAuth = (function () {
    const LOGIN_PATH = '../screens/login.html';
    const MFA_SETUP_PATH = '../screens/seguranca.html';

    function redirectToLogin() {
        window.location.href = LOGIN_PATH;
    }

    async function getUser() {
        const {
            data: { user },
        } = await sb.auth.getUser();
        return user || null;
    }

    async function passesMfaGate(profileType, allowMfaSetup) {
        const level = await window.NexusMfa.assurance(sb);
        if (!level) {
            redirectToLogin();
            return false;
        }
        const decision = window.NexusMfa.decide(level, profileType);
        if (decision === 'challenge') {
            redirectToLogin();
            return false;
        }
        if (decision === 'enroll' && !allowMfaSetup) {
            window.location.href = MFA_SETUP_PATH;
            return false;
        }
        return true;
    }

    async function requireProfile(requiredProfile, employeeFields, { allowMfaSetup = false } = {}) {
        const user = await getUser();
        if (!user) {
            redirectToLogin();
            return null;
        }

        const { data: profile } = await sb.from('profiles').select('profile, employee_id').eq('id', user.id).single();

        if (profile?.profile !== requiredProfile) {
            redirectToLogin();
            return null;
        }

        if (!(await passesMfaGate(profile.profile, allowMfaSetup))) return null;

        let employee = null;
        if (employeeFields) {
            if (!profile.employee_id) {
                redirectToLogin();
                return null;
            }
            const { data: emp } = await sb.from('employees_decrypted').select(employeeFields).eq('id', profile.employee_id).single();
            if (!emp) {
                redirectToLogin();
                return null;
            }
            employee = emp;
        }

        rememberLastScreen(user.id);
        pingSession(user.id, profile.profile);

        return { user, profile, employee };
    }

    function rememberLastScreen(userId) {
        try {
            localStorage.setItem('nexus:last-screen', JSON.stringify({ path: window.location.pathname + window.location.search, uid: userId }));
        } catch {}
    }

    const SESSION_PING_EVERY_MS = 30 * 60 * 1000;

    function pingSession(userId, profileType) {
        if (profileType !== 'Administrador' || typeof sb.rpc !== 'function') return;
        const key = `nexus:sec-ping:${userId}`;
        try {
            const last = Number(sessionStorage.getItem(key)) || 0;
            if (Date.now() - last < SESSION_PING_EVERY_MS) return;
            sessionStorage.setItem(key, String(Date.now()));
        } catch {}
        Promise.resolve(sb.rpc('record_access', { p_kind: 'session' })).catch(() => {});
    }

    function logExport(source, rows) {
        if (typeof sb.rpc !== 'function') return;
        Promise.resolve(sb.rpc('report_data_export', { p_source: source, p_rows: Number(rows) || 0 })).catch(() => {});
    }

    async function logAccess(employeeId, tipo, detalhe) {
        if (!employeeId) return;
        try {
            const user = await getUser();
            await sb.from('data_access_log').insert({
                employee_id: employeeId,
                tipo,
                detalhe: detalhe || null,
                accessed_by_name: user?.email?.split('@')[0] || null,
                accessed_by_email: user?.email || null,
            });
        } catch {}
    }

    return { getUser, requireProfile, redirectToLogin, logAccess, logExport };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.NexusAuth;
