const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, baseTables, AAL1_CHALLENGE } = require('../../test-support/page-fixtures');

const LOGIN = 'http://localhost:4173/src/screens/login.html';

const RH_SCREENS = [
    'alertas',
    'arquivos',
    'banco-horas-rh',
    'chat-rh',
    'colaboradores',
    'comunicacao',
    'dashboard',
    'ferias',
    'inicio-rh',
    'pagamentos',
    'seguranca',
];
const COLAB_SCREENS = [
    'chat-colaborador',
    'comunicados-colaborador',
    'desempenho-colaborador',
    'documentos-colaborador',
    'equipe-colaborador',
    'ferias-colaborador',
    'holerite-colaborador',
    'inicio-colaborador',
    'perfil-colaborador',
    'ponto-colaborador',
];

const AUTH_TABLES = new Set(['profiles']);

function dataCalls(client) {
    return client.calls.filter((c) => (c.table && !AUTH_TABLES.has(c.table)) || c.rpc || c.storage || c.fn);
}

async function expectBlocked(screen, clientOpts) {
    const client = new FakeSupabase({ tables: baseTables(), ...clientOpts });
    const page = await openPage(screen, { client });
    try {
        await page.settle(30);
        assert.equal(page.navigations[0], LOGIN, `${screen}: deveria ir para o login`);
        assert.deepEqual(
            dataCalls(client).map((c) => c.table || c.rpc || c.storage || c.fn),
            [],
            `${screen}: não pode consultar nem gravar dados antes de liberar o acesso`
        );
        assert.deepEqual(page.pageErrors.map(String), [], `${screen}: erros de script`);
    } finally {
        page.close();
    }
}

describe('telas do RH barram quem não é RH', () => {
    for (const screen of RH_SCREENS) {
        test(`${screen}: colaborador`, () => expectBlocked(screen, { user: COLAB_USER }));
        test(`${screen}: sem sessão`, () => expectBlocked(screen, {}));
    }
    test('RH com MFA cadastrado mas não confirmado nesta sessão volta para o login', () => expectBlocked('dashboard', { user: RH_USER, mfa: AAL1_CHALLENGE }));
});

describe('telas do colaborador barram quem não é colaborador', () => {
    for (const screen of COLAB_SCREENS) {
        test(`${screen}: RH`, () => expectBlocked(screen, { user: RH_USER }));
        test(`${screen}: sem sessão`, () => expectBlocked(screen, {}));
    }
});

describe('toda tela abre sem erro para o perfil certo', () => {
    const casos = [...RH_SCREENS.map((s) => [s, RH_USER]), ...COLAB_SCREENS.map((s) => [s, COLAB_USER])];
    for (const [screen, user] of casos) {
        test(screen, async () => {
            const rejeicoes = [];
            const onRejection = (err) => rejeicoes.push(String(err?.stack || err));
            process.on('unhandledRejection', onRejection);
            const page = await openPage(screen, { client: new FakeSupabase({ user, tables: baseTables() }) });
            try {
                await page.settle(40);
                assert.deepEqual(page.navigations, [], `${screen}: não deveria redirecionar`);
                assert.deepEqual(page.pageErrors.map(String), [], `${screen}: erros de script`);
                assert.deepEqual(rejeicoes, [], `${screen}: promessas rejeitadas`);
            } finally {
                process.off('unhandledRejection', onRejection);
                page.close();
            }
        });
    }
});
