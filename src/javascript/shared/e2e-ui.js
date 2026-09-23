window.NexusE2EUI = (function () {
    'use strict';

    const STYLE_ID = 'nexus-e2e-style';

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const link = document.createElement('link');
        link.id = STYLE_ID;
        link.rel = 'stylesheet';
        link.href = '/src/styles/e2e.css';
        document.head.appendChild(link);
    }

    injectStyles();

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

    function dialog(title, ...nodes) {
        const overlay = el('div', 'e2e-overlay');
        const box = el('div', 'e2e-dialog');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.append(el('h3', 'e2e-title', title), ...nodes);
        overlay.append(box);
        document.body.append(overlay);
        return { close: () => overlay.remove(), box };
    }

    function passwordField(placeholder) {
        const input = el('input', 'e2e-input');
        input.type = 'password';
        input.autocomplete = 'current-password';
        input.placeholder = placeholder;
        return input;
    }

    function promptPassword(verify) {
        return new Promise((resolve) => {
            const input = passwordField('Sua senha');
            const error = el('p', 'e2e-error');
            error.hidden = true;
            const submit = async () => {
                if (!input.value) return;
                ok.disabled = true;
                const valid = await verify(input.value);
                if (valid) {
                    ui.close();
                    resolve(true);
                    return;
                }
                ok.disabled = false;
                error.textContent = 'Senha incorreta.';
                error.hidden = false;
                input.select();
            };
            const ok = button('Desbloquear', 'e2e-btn e2e-btn--primary', submit);
            const cancel = button('Agora não', 'e2e-btn', () => {
                ui.close();
                resolve(false);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submit();
            });
            const actions = el('div', 'e2e-actions');
            actions.append(cancel, ok);
            const ui = dialog(
                'Desbloquear dados cifrados',
                el('p', 'e2e-text', 'Suas conversas e documentos são cifrados de ponta a ponta. Digite sua senha para abri-los neste navegador.'),
                input,
                error,
                actions
            );
            input.focus();
        });
    }

    function showRecoveryKey(recoveryKey) {
        return new Promise((resolve) => {
            const text = [
                'Nexus RH - chave de recuperação da criptografia de ponta a ponta',
                `Gerada em ${new Date().toLocaleString('pt-BR')}`,
                'Guarde em local seguro. Sem ela, se você redefinir a senha, suas conversas e documentos cifrados não poderão ser abertos.',
                '',
                recoveryKey,
                '',
            ].join('\n');
            const code = el('code', 'e2e-recovery', recoveryKey);
            const check = el('input');
            check.type = 'checkbox';
            check.id = 'e2e-saved-check';
            const label = el('label', 'e2e-check');
            label.htmlFor = check.id;
            label.append(check, el('span', null, 'Guardei a chave em local seguro'));
            const done = button('Continuar', 'e2e-btn e2e-btn--primary', () => {
                ui.close();
                resolve();
            });
            done.disabled = true;
            check.addEventListener('change', () => {
                done.disabled = !check.checked;
            });
            const copy = button('Copiar', 'e2e-btn', async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    copy.textContent = 'Copiado!';
                } catch {
                    copy.textContent = 'Não foi possível copiar';
                }
            });
            const download = button('Baixar .txt', 'e2e-btn', () => {
                const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                const link = el('a');
                link.href = url;
                link.download = 'nexus-chave-de-recuperacao.txt';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            });
            const tools = el('div', 'e2e-actions e2e-actions--start');
            tools.append(copy, download);
            const actions = el('div', 'e2e-actions');
            actions.append(done);
            const ui = dialog(
                'Sua chave de recuperação',
                el(
                    'p',
                    'e2e-text',
                    'Suas conversas diretas e documentos agora são cifrados de ponta a ponta: nem o servidor nem o suporte conseguem lê-los. Se você esquecer a senha, só esta chave recupera o acesso. Ela não será mostrada de novo.'
                ),
                code,
                tools,
                label,
                actions
            );
        });
    }

    function promptRecovery(isValid) {
        return new Promise((resolve) => {
            const input = el('input', 'e2e-input');
            input.type = 'text';
            input.autocomplete = 'off';
            input.placeholder = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX';
            const error = el('p', 'e2e-error');
            error.hidden = true;
            const ok = button('Recuperar', 'e2e-btn e2e-btn--primary', () => {
                if (!isValid(input.value)) {
                    error.textContent = 'Formato inválido. São 8 grupos de 4 letras e números.';
                    error.hidden = false;
                    return;
                }
                ui.close();
                resolve({ action: 'recover', key: input.value });
            });
            const reset = button('Não tenho a chave', 'e2e-btn e2e-btn--danger', () => {
                const sure = window.confirm(
                    'Sem a chave de recuperação, suas conversas diretas antigas não poderão mais ser abertas. Documentos voltam a ficar acessíveis quando o RH os recompartilhar. Criar chaves novas?'
                );
                if (!sure) return;
                ui.close();
                resolve({ action: 'reset' });
            });
            const actions = el('div', 'e2e-actions');
            actions.append(reset, ok);
            const ui = dialog(
                'Recuperar acesso aos dados cifrados',
                el(
                    'p',
                    'e2e-text',
                    'Sua senha mudou desde o último acesso, então ela não abre mais suas chaves de ponta a ponta. Digite a chave de recuperação que você guardou.'
                ),
                input,
                error,
                actions
            );
            input.focus();
        });
    }

    return { promptPassword, showRecoveryKey, promptRecovery };
})();
