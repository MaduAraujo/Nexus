const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// mfa-setup.js é a UI de ativação/desativação do MFA (window.NexusMfaSetup.mount), consumida tanto
// pelo fluxo obrigatório do RH quanto pelo opcional do colaborador. Ela lê window.NexusMfa a cada
// chamada de mount(), então cada teste troca esse mock para simular sucesso/erro sem depender do
// Supabase real — o que importa aqui é a máquina de estados da tela (qual botão aparece, o que ele
// dispara) e não a lib de MFA em si (isso já é coberto por mfa.test.js).

let container;
let client;
let confirmCalls;
let clipboardWrites;

before(() => {
    const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://nexus.test/' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;
    require('../src/javascript/shared/mfa-setup.js');
});

beforeEach(() => {
    container = global.document.createElement('div');
    global.document.body.appendChild(container);
    client = {};
    confirmCalls = [];
    clipboardWrites = [];
    global.window.confirm = (msg) => {
        confirmCalls.push(msg);
        return true;
    };
    navigator.clipboard = { writeText: async (text) => clipboardWrites.push(text) };
});

function mount(mfaMock, opts = {}) {
    global.window.NexusMfa = mfaMock;
    return global.window.NexusMfaSetup.mount(container, { client, ...opts });
}

function text() {
    return container.textContent;
}

describe('status inicial', () => {
    test('sem fator ativo: mostra badge "Desativada" e botão de ativar', async () => {
        await mount({ listFactors: async () => ({ verified: [] }) });
        assert.match(text(), /Desativada/);
        assert.ok(container.querySelector('button'));
        assert.match(container.querySelector('button').textContent, /Ativar verificação em duas etapas/);
    });

    test('opcional (required=false): mensagem convida, não exige', async () => {
        await mount({ listFactors: async () => ({ verified: [] }) }, { required: false });
        assert.match(text(), /Adicione uma camada extra de proteção/);
    });

    test('obrigatório (required=true): mensagem avisa que é exigido para o RH', async () => {
        await mount({ listFactors: async () => ({ verified: [] }) }, { required: true });
        assert.match(text(), /obrigatória para o perfil RH/);
    });

    test('com fator ativo: mostra confirmação e botão de desativar, não o de ativar', async () => {
        await mount({ listFactors: async () => ({ verified: [{ id: 'f1' }] }) });
        assert.match(text(), /Verificação em duas etapas ativada/);
        assert.match(container.querySelector('button').textContent, /Desativar/);
    });

    test('erro ao carregar status: mostra aviso e botão para tentar de novo', async () => {
        await mount({ listFactors: async () => ({ error: new Error('offline') }) });
        assert.match(text(), /Não foi possível carregar o status/);
        assert.match(container.querySelector('button').textContent, /Tentar de novo/);
    });
});

describe('ativação (enroll)', () => {
    test('clicar em Ativar chama startEnroll e, em erro, mostra aviso com botão Voltar', async () => {
        await mount({
            listFactors: async () => ({ verified: [] }),
            startEnroll: async () => ({ error: new Error('mfa desabilitado no projeto') }),
        });
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        assert.match(text(), /Não foi possível iniciar a ativação/);
        assert.match(container.querySelector('button').textContent, /Voltar/);
    });

    test('sucesso no startEnroll: mostra a tela de QR code e a chave em texto', async () => {
        await mount({
            listFactors: async () => ({ verified: [] }),
            startEnroll: async () => ({ factorId: 'f1', qrCode: 'data:image/png;base64,xyz', secret: 'ABCD1234' }),
        });
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        assert.ok(container.querySelector('img.mfa-qr'));
        assert.equal(container.querySelector('img.mfa-qr').src, 'data:image/png;base64,xyz');
        assert.match(text(), /ABCD1234/);
        assert.match(text(), /1\. Escaneie o QR code/);
    });

    test('botão Continuar leva à tela de digitar o código, com o campo desabilitado até um código válido', async () => {
        await mount({
            listFactors: async () => ({ verified: [] }),
            startEnroll: async () => ({ factorId: 'f1', qrCode: 'x', secret: 'ABCD1234' }),
            isValidCode: (v) => /^\d{6}$/.test(v),
        });
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        const continuar = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Continuar');
        continuar.click();

        assert.match(text(), /2\. Digite o código de 6 dígitos/);
        const input = container.querySelector('input');
        const confirmBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Ativar');
        assert.equal(confirmBtn.disabled, true);

        input.value = '12345';
        input.dispatchEvent(new global.window.Event('input'));
        assert.equal(confirmBtn.disabled, true, 'código incompleto não deve habilitar o botão');

        input.value = '123456';
        input.dispatchEvent(new global.window.Event('input'));
        assert.equal(confirmBtn.disabled, false, 'código de 6 dígitos deve habilitar o botão');
    });

    test('confirmar com código certo: chama verify, avisa onChange e volta ao status (ativado)', async () => {
        const onChangeCalls = [];
        await mount(
            {
                listFactors: async () => ({ verified: [] }),
                startEnroll: async () => ({ factorId: 'f1', qrCode: 'x', secret: 'ABCD1234' }),
                isValidCode: () => true,
                verify: async (c, factorId, code) => {
                    assert.equal(factorId, 'f1');
                    assert.equal(code, '123456');
                    return {};
                },
            },
            { onChange: (v) => onChangeCalls.push(v) }
        );
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        Array.from(container.querySelectorAll('button'))
            .find((b) => b.textContent === 'Continuar')
            .click();

        const input = container.querySelector('input');
        input.value = '123456';
        input.dispatchEvent(new global.window.Event('input'));

        // Trocamos listFactors depois do clique para simular que agora o fator já está verificado.
        global.window.NexusMfa.listFactors = async () => ({ verified: [{ id: 'f1' }] });
        Array.from(container.querySelectorAll('button'))
            .find((b) => b.textContent === 'Ativar')
            .click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.deepEqual(onChangeCalls, [{ enabled: true }]);
        assert.match(text(), /Verificação em duas etapas ativada/);
    });

    test('confirmar com código errado: mostra erro, reabilita o botão e não fecha a tela', async () => {
        await mount({
            listFactors: async () => ({ verified: [] }),
            startEnroll: async () => ({ factorId: 'f1', qrCode: 'x', secret: 'ABCD1234' }),
            isValidCode: () => true,
            verify: async () => ({ error: new Error('código inválido') }),
        });
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        Array.from(container.querySelectorAll('button'))
            .find((b) => b.textContent === 'Continuar')
            .click();
        const input = container.querySelector('input');
        input.value = '000000';
        input.dispatchEvent(new global.window.Event('input'));

        const confirmBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Ativar');
        confirmBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        assert.match(text(), /Código inválido ou expirado/);
        assert.equal(confirmBtn.disabled, false);
        // continua na tela de código, não voltou ao status
        assert.match(text(), /2\. Digite o código de 6 dígitos/);
    });

    test('cancelar no meio do enroll chama cancelEnroll e volta ao status', async () => {
        let cancelled = null;
        await mount({
            listFactors: async () => ({ verified: [] }),
            startEnroll: async () => ({ factorId: 'f1', qrCode: 'x', secret: 'ABCD1234' }),
            cancelEnroll: async (c, factorId) => {
                cancelled = factorId;
            },
        });
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        Array.from(container.querySelectorAll('button'))
            .find((b) => b.textContent === 'Cancelar')
            .click();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(cancelled, 'f1');
        assert.match(text(), /Desativada/);
    });

    test('copiar a chave grava no clipboard e sinaliza "Copiado!"', async () => {
        await mount({
            listFactors: async () => ({ verified: [] }),
            startEnroll: async () => ({ factorId: 'f1', qrCode: 'x', secret: 'CHAVE-SECRETA' }),
        });
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        const copyBtn = container.querySelector('.mfa-copy');
        copyBtn.click();
        await Promise.resolve();
        await Promise.resolve();

        assert.deepEqual(clipboardWrites, ['CHAVE-SECRETA']);
        assert.equal(copyBtn.title, 'Copiado!');
    });
});

describe('desativação', () => {
    test('cancelar a confirmação do navegador não desativa nada', async () => {
        global.window.confirm = () => false;
        let disableCalled = false;
        await mount({
            listFactors: async () => ({ verified: [{ id: 'f1' }] }),
            disable: async () => {
                disableCalled = true;
                return {};
            },
        });
        container.querySelector('button').click();
        await Promise.resolve();
        assert.equal(disableCalled, false);
    });

    test('confirmar desativa, avisa onChange e mostra aviso de sucesso', async () => {
        const onChangeCalls = [];
        await mount(
            {
                listFactors: async () => ({ verified: [{ id: 'f1' }] }),
                disable: async (c, factorId) => {
                    assert.equal(factorId, 'f1');
                    return {};
                },
            },
            { onChange: (v) => onChangeCalls.push(v) }
        );
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.deepEqual(onChangeCalls, [{ enabled: false }]);
        assert.match(text(), /Verificação em duas etapas desativada/);
    });

    test('obrigatório: mensagem de confirmação avisa que precisará reativar, e o aviso final reflete isso', async () => {
        await mount(
            {
                listFactors: async () => ({ verified: [{ id: 'f1' }] }),
                disable: async () => ({}),
            },
            { required: true }
        );
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.match(confirmCalls[0], /precisará ativar de novo/);
        assert.match(text(), /Ative novamente para continuar usando o painel/);
    });

    test('erro ao desativar: mantém a tela ativa e mostra aviso para relogar', async () => {
        await mount({
            listFactors: async () => ({ verified: [{ id: 'f1' }] }),
            disable: async () => ({ error: new Error('sessão sem AAL2') }),
        });
        container.querySelector('button').click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.match(text(), /Saia e entre novamente com o código/);
        assert.match(text(), /Verificação em duas etapas ativada/);
    });
});
