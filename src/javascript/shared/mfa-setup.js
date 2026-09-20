window.NexusMfaSetup = (function () {
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function button(label, className, onClick) {
        const btn = el('button', className, label);
        btn.type = 'button';
        btn.addEventListener('click', onClick);
        return btn;
    }

    function mount(container, { client, required = false, onChange = () => {} }) {
        const mfa = window.NexusMfa;

        function render(...nodes) {
            container.replaceChildren(...nodes);
        }

        function notice(kind, text) {
            return el('p', `mfa-notice mfa-notice--${kind}`, text);
        }

        async function showStatus(flash) {
            render(el('p', 'mfa-muted', 'Carregando…'));
            const { verified, error } = await mfa.listFactors(client);
            if (error) {
                render(
                    notice('error', 'Não foi possível carregar o status da verificação em duas etapas.'),
                    button('Tentar de novo', 'mfa-btn', () => showStatus())
                );
                return;
            }
            const nodes = [];
            if (flash) nodes.push(notice('success', flash));
            if (verified.length) nodes.push(...activeView(verified[0]));
            else nodes.push(...inactiveView());
            render(...nodes);
        }

        function inactiveView() {
            const lead = required
                ? 'A verificação em duas etapas é obrigatória para o perfil RH. Ative para continuar usando o painel.'
                : 'Adicione uma camada extra de proteção: além da senha, será pedido um código do seu app autenticador.';
            return [
                el('span', 'mfa-badge mfa-badge--off', 'Desativada'),
                el('p', 'mfa-lead', lead),
                button('Ativar verificação em duas etapas', 'mfa-btn mfa-btn--primary', startEnroll),
            ];
        }

        function activeView(factor) {
            const row = el('div', 'mfa-row');
            row.append(
                notice('success', 'Verificação em duas etapas ativada.'),
                button('Desativar', 'mfa-btn mfa-btn--danger', () => disable(factor.id))
            );
            return [row];
        }

        async function startEnroll() {
            render(el('p', 'mfa-muted', 'Gerando código…'));
            const result = await mfa.startEnroll(client);
            if (result.error) {
                render(
                    notice('error', 'Não foi possível iniciar a ativação. Verifique se a verificação em duas etapas (TOTP) está habilitada no Supabase Auth.'),
                    button('Voltar', 'mfa-btn', () => showStatus())
                );
                return;
            }
            enrollView(result);
        }

        function enrollView({ factorId, qrCode, secret }) {
            const qr = el('img', 'mfa-qr');
            qr.alt = 'QR code para o app autenticador';
            qr.width = 176;
            qr.height = 176;
            qr.src = qrCode;

            const secretBox = el('code', 'mfa-secret', secret);
            const copyIcon = el('i', 'fas fa-copy');
            copyIcon.setAttribute('aria-hidden', 'true');
            const copyBtn = button('', 'mfa-copy', async () => {
                try {
                    await navigator.clipboard.writeText(secret);
                    copyIcon.className = 'fas fa-check';
                    copyBtn.title = 'Copiado!';
                    setTimeout(() => {
                        copyIcon.className = 'fas fa-copy';
                        copyBtn.title = 'Copiar chave';
                    }, 1500);
                } catch {
                    const range = document.createRange();
                    range.selectNodeContents(secretBox);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            });
            copyBtn.append(copyIcon);
            copyBtn.title = 'Copiar chave';
            copyBtn.setAttribute('aria-label', 'Copiar chave');
            const secretRow = el('div', 'mfa-secret-row');
            secretRow.append(secretBox, copyBtn);
            const input = el('input', 'mfa-input');
            input.type = 'text';
            input.inputMode = 'numeric';
            input.maxLength = 7;
            input.autocomplete = 'one-time-code';
            input.placeholder = '000000';
            input.setAttribute('aria-label', 'Código de 6 dígitos');

            const error = el('p', 'mfa-notice mfa-notice--error');
            error.hidden = true;
            const confirmBtn = button('Ativar', 'mfa-btn mfa-btn--primary', confirm);
            confirmBtn.disabled = true;

            input.addEventListener('input', () => {
                error.hidden = true;
                confirmBtn.disabled = !mfa.isValidCode(input.value);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') confirm();
            });

            async function confirm() {
                if (confirmBtn.disabled) return;
                confirmBtn.disabled = true;
                const { error: verifyError } = await mfa.verify(client, factorId, input.value);
                if (verifyError) {
                    error.textContent = 'Código inválido ou expirado. Confira o app e tente de novo.';
                    error.hidden = false;
                    confirmBtn.disabled = false;
                    input.select();
                    return;
                }
                onChange({ enabled: true });
                showStatus();
            }

            const cancelBtn = () =>
                button('Cancelar', 'mfa-btn', async () => {
                    await mfa.cancelEnroll(client, factorId);
                    showStatus();
                });

            function actionsRow(...buttons) {
                const row = el('div', 'mfa-actions');
                row.append(...buttons);
                return row;
            }

            function screen(...nodes) {
                const wrapper = el('div', 'mfa-enroll');
                wrapper.append(...nodes);
                render(wrapper);
            }

            function scanScreen() {
                screen(
                    el('p', 'mfa-step', '1. Escaneie o QR code com um app autenticador (Google Authenticator, Microsoft Authenticator…).'),
                    qr,
                    el('p', 'mfa-muted', 'Sem câmera? Digite esta chave manualmente no app:'),
                    secretRow,
                    actionsRow(button('Continuar', 'mfa-btn mfa-btn--primary', codeScreen), cancelBtn())
                );
            }

            function codeScreen() {
                screen(el('p', 'mfa-step', '2. Digite o código de 6 dígitos que o app mostrar:'), input, error, actionsRow(confirmBtn, cancelBtn()));
                input.focus();
            }

            scanScreen();
        }

        async function disable(factorId) {
            const extra = required ? ' Você precisará ativar de novo no próximo acesso.' : '';
            if (!window.confirm(`Desativar a verificação em duas etapas?${extra}`)) return;
            const { error } = await mfa.disable(client, factorId);
            if (error) {
                await showStatus();
                container.prepend(notice('error', 'Não foi possível desativar. Saia e entre novamente com o código e tente de novo.'));
                return;
            }
            onChange({ enabled: false });
            showStatus(required ? 'Desativada. Ative novamente para continuar usando o painel.' : 'Verificação em duas etapas desativada.');
        }

        return showStatus();
    }

    return { mount };
})();
