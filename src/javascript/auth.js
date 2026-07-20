/* auth.js — guarda de autenticação/perfil compartilhada entre as páginas.
   Substitui o bloco getUser() → profiles → employees que estava copiado em
   ~19 arquivos (cada tela redirecionava pra login.html "no seu jeito"). Sem
   bundler/ESM neste projeto, então isto é um objeto global simples.
   Carregar depois de supabase-client.js e antes do script da própria página. */

window.NexusAuth = (function () {
    const LOGIN_PATH = '../screens/login.html';

    function redirectToLogin() {
        window.location.href = LOGIN_PATH;
    }

    // Sessão do usuário autenticado, sem checar profile — usado por telas que só
    // precisam de user.email/user.id no meio do fluxo (ex.: trilha de auditoria),
    // não como guarda de acesso da página.
    async function getUser() {
        const { data: { user } } = await sb.auth.getUser();
        return user || null;
    }

    // Garante que há uma sessão válida E que profiles.profile bate com
    // requiredProfile ('colaborador' ou 'Administrador'); redireciona pra
    // login.html e retorna null caso contrário (o chamador só precisa dar
    // `if (!auth) return;`).
    //
    // employeeFields: se informado, também busca a linha de employees do
    // colaborador (via profile.employee_id) com esse SELECT — obrigatória:
    // sem employee_id ou sem linha correspondente também redireciona. Omitir
    // quando a tela não precisa do registro de employees (a maioria das telas
    // de RH/Administrador).
    async function requireProfile(requiredProfile, employeeFields) {
        const user = await getUser();
        if (!user) { redirectToLogin(); return null; }

        const { data: profile } = await sb.from('profiles')
            .select('profile, employee_id')
            .eq('id', user.id)
            .single();

        if (profile?.profile !== requiredProfile) { redirectToLogin(); return null; }

        let employee = null;
        if (employeeFields) {
            if (!profile.employee_id) { redirectToLogin(); return null; }
            const { data: emp } = await sb.from('employees')
                .select(employeeFields)
                .eq('id', profile.employee_id)
                .single();
            if (!emp) { redirectToLogin(); return null; }
            employee = emp;
        }

        return { user, profile, employee };
    }

    // Registra em data_access_log (migration 046) que alguém VISUALIZOU dado sensível de
    // um colaborador — diferente de employee_audit/activity_logs, que só registram
    // alteração. tipo: 'perfil_completo' | 'documento' | 'holerite' | 'selfie_ponto'.
    // Fire-and-forget: nunca deve travar a tela por causa de um log de auditoria.
    async function logAccess(employeeId, tipo, detalhe) {
        if (!employeeId) return;
        try {
            const user = await getUser();
            await sb.from('data_access_log').insert({
                employee_id: employeeId, tipo, detalhe: detalhe || null,
                accessed_by_name: user?.email?.split('@')[0] || null,
                accessed_by_email: user?.email || null,
            });
        } catch { /* auditoria não pode derrubar a tela */ }
    }

    return { getUser, requireProfile, redirectToLogin, logAccess };
})();
