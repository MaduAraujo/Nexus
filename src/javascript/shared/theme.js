(function () {
    const STORAGE_KEY = 'nexus-theme';

    function getStored() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch {
            return null;
        }
    }

    function apply(theme) {
        if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
    }

    function toggle() {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        apply(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {}
        return next;
    }

    apply(getStored());

    window.NexusTheme = {
        toggle: toggle,
        current: function () {
            return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        },
    };
})();
