(function () {
    const STYLE_ID = 'nexus-pwa-style';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .nexus-pwa-toast {
                position: fixed;
                left: 50%;
                bottom: 20px;
                transform: translateX(-50%);
                z-index: 9999;
                display: flex;
                align-items: center;
                gap: 14px;
                max-width: calc(100vw - 32px);
                background: #131318;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 12px;
                padding: 12px 16px;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
                font-family: 'DM Sans', sans-serif;
                color: #eeeef2;
                font-size: 0.9rem;
                animation: nexus-pwa-toast-in 0.25s ease-out;
            }
            @keyframes nexus-pwa-toast-in {
                from { opacity: 0; transform: translate(-50%, 12px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
            .nexus-pwa-toast button {
                flex-shrink: 0;
                border: none;
                border-radius: 8px;
                padding: 7px 14px;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
                font-family: inherit;
            }
            .nexus-pwa-toast .nexus-pwa-primary {
                background: #5e9cf5;
                color: #0a0a0d;
            }
            .nexus-pwa-toast .nexus-pwa-secondary {
                background: transparent;
                color: #7b7b8f;
            }
            .nexus-pwa-modal-overlay {
                position: fixed;
                inset: 0;
                z-index: 9999;
                background: rgba(0, 0, 0, 0.55);
                display: flex;
                align-items: flex-end;
                justify-content: center;
            }
            .nexus-pwa-modal {
                width: 100%;
                max-width: 420px;
                margin: 0 16px 16px;
                background: #131318;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 14px;
                padding: 20px;
                font-family: 'DM Sans', sans-serif;
                color: #eeeef2;
                animation: nexus-pwa-toast-in 0.25s ease-out;
            }
            .nexus-pwa-modal h3 {
                margin: 0 0 8px;
                font-size: 1.05rem;
                font-weight: 700;
            }
            .nexus-pwa-modal p {
                margin: 0 0 16px;
                font-size: 0.9rem;
                color: #a1a1aa;
                line-height: 1.5;
            }
            .nexus-pwa-modal button {
                width: 100%;
                border: none;
                border-radius: 8px;
                padding: 10px 14px;
                font-size: 0.9rem;
                font-weight: 600;
                cursor: pointer;
                background: #5e9cf5;
                color: #0a0a0d;
                font-family: inherit;
            }
            .nexus-pwa-offline-banner {
                position: fixed;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 9998;
                background: #f5b942;
                color: #0a0a0d;
                text-align: center;
                font-family: 'DM Sans', sans-serif;
                font-size: 0.85rem;
                font-weight: 600;
                padding: 10px 16px;
                box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.25);
            }
        `;
        document.head.appendChild(style);
    }

    function showToast(message, primaryLabel, onPrimary) {
        injectStyles();
        const toast = document.createElement('div');
        toast.className = 'nexus-pwa-toast';
        toast.innerHTML =
            '<span>' +
            message +
            '</span><button type="button" class="nexus-pwa-secondary">Depois</button><button type="button" class="nexus-pwa-primary">' +
            primaryLabel +
            '</button>';

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
