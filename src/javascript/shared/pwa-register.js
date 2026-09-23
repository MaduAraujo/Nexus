(function () {
    const STYLE_ID = 'nexus-pwa-style';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const link = document.createElement('link');
        link.id = STYLE_ID;
        link.rel = 'stylesheet';
        link.href = '/src/styles/pwa.css';
        document.head.appendChild(link);
    }

    injectStyles();

    function showToast(message, primaryLabel, onPrimary) {
        injectStyles();
        const toast = document.createElement('div');
        toast.className = 'nexus-pwa-toast';
        const text = document.createElement('span');
        text.textContent = message;
        const later = document.createElement('button');
        later.type = 'button';
        later.className = 'nexus-pwa-secondary';
        later.textContent = 'Depois';
        const primary = document.createElement('button');
        primary.type = 'button';
        primary.className = 'nexus-pwa-primary';
        primary.textContent = primaryLabel;
        toast.append(text, later, primary);

        const [, dismissBtn, primaryBtn] = toast.children;
        dismissBtn.addEventListener('click', function () {
            toast.remove();
        });
        primaryBtn.addEventListener('click', function () {
            toast.remove();
            onPrimary();
        });

        document.body.appendChild(toast);
    }

    function showIosInstallModal() {
        injectStyles();
        const overlay = document.createElement('div');
        overlay.className = 'nexus-pwa-modal-overlay';
        overlay.innerHTML =
            '<div class="nexus-pwa-modal">' +
            '<h3>Instalar o Nexus</h3>' +
            '<p>Toque no ícone de compartilhamento <strong>⎋</strong> na barra do Safari e escolha <strong>“Adicionar à Tela de Início”</strong>.</p>' +
            '<button type="button">Entendi</button>' +
            '</div>';

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) overlay.remove();
        });
        overlay.querySelector('button').addEventListener('click', function () {
            overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });

        window.addEventListener('load', function () {
            navigator.serviceWorker
                .register('/service-worker.js')
                .then(function (registration) {
                    function promptUpdate(worker) {
                        showToast('Nova versão do app disponível.', 'Atualizar', function () {
                            worker.postMessage('SKIP_WAITING');
                        });
                    }

                    if (registration.waiting && registration.active) {
                        promptUpdate(registration.waiting);
                    }

                    registration.addEventListener('updatefound', function () {
                        const newWorker = registration.installing;
                        if (!newWorker) return;
                        newWorker.addEventListener('statechange', function () {
                            if (newWorker.state === 'installed' && registration.active) {
                                promptUpdate(newWorker);
                            }
                        });
                    });
                })
                .catch(function (err) {
                    console.warn('Falha ao registrar o service worker:', err);
                });
        });
    }

    function isIos() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function initInstallButtons() {
        let deferredPrompt = null;
        let installButtons = [];

        function setButtonsVisible(visible) {
            installButtons.forEach(function (btn) {
                btn.hidden = !visible;
            });
        }

        window.addEventListener('beforeinstallprompt', function (event) {
            event.preventDefault();
            deferredPrompt = event;
            setButtonsVisible(true);
        });

        window.addEventListener('appinstalled', function () {
            deferredPrompt = null;
            setButtonsVisible(false);
        });

        function onReady() {
            installButtons = ['btn-install-app']
                .map(function (id) {
                    return document.getElementById(id);
                })
                .filter(Boolean);

            if (!installButtons.length) return;

            const iosEligible = isIos() && !isStandalone();
            setButtonsVisible(!!deferredPrompt || iosEligible);

            installButtons.forEach(function (btn) {
                btn.addEventListener('click', async function () {
                    if (deferredPrompt) {
                        setButtonsVisible(false);
                        deferredPrompt.prompt();
                        await deferredPrompt.userChoice;
                        deferredPrompt = null;
                        return;
                    }
                    if (iosEligible) showIosInstallModal();
                });
            });
        }

        if (document.readyState !== 'loading') onReady();
        else document.addEventListener('DOMContentLoaded', onReady);
    }

    function initOfflineBanner() {
        let banner = null;

        function ensureBanner() {
            if (banner) return banner;
            injectStyles();
            banner = document.createElement('div');
            banner.className = 'nexus-pwa-offline-banner';
            banner.textContent = 'Sem conexão com a internet — alguns dados podem estar desatualizados.';
            document.body.appendChild(banner);
            return banner;
        }

        function update() {
            ensureBanner().hidden = navigator.onLine;
        }

        function onReady() {
            update();
            window.addEventListener('online', update);
            window.addEventListener('offline', update);
        }

        if (document.readyState !== 'loading') onReady();
        else document.addEventListener('DOMContentLoaded', onReady);
    }

    registerServiceWorker();
    initInstallButtons();
    initOfflineBanner();
})();
