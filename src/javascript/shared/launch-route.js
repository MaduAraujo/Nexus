(function () {
    const LOGIN_PATH = '/src/screens/login.html';
    const LAST_SCREEN_KEY = 'nexus:last-screen';
    const PROFILE_HOME = { rh: '/src/screens/inicio-rh.html', colab: '/src/screens/inicio-colaborador.html' };

    const matches = (query) => !!(window.matchMedia && window.matchMedia(query).matches);

    function decodeJwtSub(token) {
        try {
            const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(atob(payload)).sub || null;
        } catch {
            return null;
        }
    }

    function readSessions() {
        const found = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const slot = /^sb-.+-(rh|colab)-auth-token$/.exec(key)?.[1];
                if (!slot) continue;
                const session = JSON.parse(localStorage.getItem(key));
                const uid = session?.user?.id || (session?.access_token && decodeJwtSub(session.access_token));
                if (uid) found.push({ uid, slot });
            }
        } catch {}
        return found;
    }

    function readLastScreen() {
        try {
            return JSON.parse(localStorage.getItem(LAST_SCREEN_KEY));
        } catch {
            return null;
        }
    }

    const isAppScreen = (path) => typeof path === 'string' && /^\/src\/screens\/[a-z0-9-]+\.html(\?.*)?$/i.test(path) && !path.includes('/login.html');

    const standalone = matches('(display-mode: standalone)') || window.navigator.standalone === true;
    const mobile = standalone || matches('(max-width: 768px)');

    if (!mobile || location.hash || /[?&]landing\b/.test(location.search)) return;

    const sessions = readSessions();

    if (!sessions.length) {
        if (standalone) location.replace(LOGIN_PATH);
        return;
    }

    const last = readLastScreen();
    if (last && isAppScreen(last.path) && sessions.some((s) => s.uid === last.uid)) {
        location.replace(last.path);
        return;
    }

    location.replace(PROFILE_HOME[sessions[0].slot]);
})();
