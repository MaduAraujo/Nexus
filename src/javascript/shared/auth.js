window.NexusAuth = (function () {
    const LOGIN_PATH = '../screens/login.html';

    function redirectToLogin() {
        window.location.href = LOGIN_PATH;
    }

    async function getUser() {
        const {
            data: { user },
        } = await sb.auth.getUser();
        return user || null;
    }

    async function requireProfile(requiredProfile, employeeFields) {
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

        let employee = null;
        if (employeeFields) {
            if (!profile.employee_id) {
                redirectToLogin();
                return null;
            }
            const { data: emp } = await sb.from('employees').select(employeeFields).eq('id', profile.employee_id).single();
            if (!emp) {
                redirectToLogin();
                return null;
            }
            employee = emp;
        }

        return { user, profile, employee };
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

    return { getUser, requireProfile, redirectToLogin, logAccess };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.NexusAuth;