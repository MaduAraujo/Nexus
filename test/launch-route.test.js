const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'src', 'javascript', 'shared', 'launch-route.js'), 'utf8');

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function launch({ standalone = false, narrow = false, storage = {}, hash = '', search = '' } = {}) {
    let target = null;
    const store = { ...storage };
    const localStorage = {
        get length() {
            return Object.keys(store).length;
        },
        key: (i) => Object.keys(store)[i],
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => {
            store[k] = v;
        },
    };
    const location = {
        hash,
        search,
        replace: (url) => {
            target = url;
        },
    };
    const window = {
        matchMedia: (q) => ({ matches: q.includes('standalone') ? standalone : q.includes('max-width') ? narrow : false }),
        navigator: {},
    };
    const ctx = { window, localStorage, location, atob: (s) => Buffer.from(s, 'base64').toString('binary'), JSON };
    vm.createContext(ctx);
    vm.runInContext(CODE, ctx);
    return target;
}

const session = (slot, uid) => ({ [`sb-abc-${slot}-auth-token`]: JSON.stringify({ access_token: 'x', user: { id: uid } }) });
const jwtSession = (slot, uid) => ({ [`sb-abc-${slot}-auth-token`]: JSON.stringify({ access_token: `h.${b64url({ sub: uid })}.s` }) });
const lastScreen = (uid, p) => ({ 'nexus:last-screen': JSON.stringify({ uid, path: p }) });

const LOGIN = '/src/screens/login.html';
const HOME_COLAB = '/src/screens/inicio-colaborador.html';
const HOME_RH = '/src/screens/inicio-rh.html';

describe('abertura do app no celular', () => {
    test('desktop não é redirecionado, mesmo logado com última tela', () => {
        const target = launch({ storage: { ...session('colab', 'u1'), ...lastScreen('u1', '/src/screens/ponto-colaborador.html') } });
        assert.equal(target, null);
    });

    test('app instalado sem sessão abre direto no login', () => {
        assert.equal(launch({ standalone: true }), LOGIN);
    });

    test('navegador do celular sem sessão continua na página inicial', () => {
        assert.equal(launch({ narrow: true }), null);
    });

    test('logado volta para a última tela do mesmo usuário', () => {
        const target = launch({ narrow: true, storage: { ...session('colab', 'u1'), ...lastScreen('u1', '/src/screens/holerite-colaborador.html') } });
        assert.equal(target, '/src/screens/holerite-colaborador.html');
    });

    test('mantém a query string da última tela', () => {
        const target = launch({ standalone: true, storage: { ...session('rh', 'u1'), ...lastScreen('u1', '/src/screens/arquivos.html?tab=2') } });
        assert.equal(target, '/src/screens/arquivos.html?tab=2');
    });

    test('última tela de outro usuário não é usada: vai para o início do perfil da sessão', () => {
        const target = launch({ standalone: true, storage: { ...session('colab', 'u2'), ...lastScreen('u1', '/src/screens/ponto-colaborador.html') } });
        assert.equal(target, HOME_COLAB);
    });

    test('logado sem última tela vai para o início do perfil (RH e colaborador)', () => {
        assert.equal(launch({ standalone: true, storage: session('colab', 'u1') }), HOME_COLAB);
        assert.equal(launch({ standalone: true, storage: session('rh', 'u1') }), HOME_RH);
    });

    test('lê o usuário do JWT quando a sessão não traz o objeto user', () => {
        const target = launch({ narrow: true, storage: { ...jwtSession('colab', 'u1'), ...lastScreen('u1', '/src/screens/chat-colaborador.html') } });
        assert.equal(target, '/src/screens/chat-colaborador.html');
    });

    test('com os dois perfis logados, usa a última tela do dono dela', () => {
        const target = launch({
            narrow: true,
            storage: { ...session('rh', 'u-rh'), ...session('colab', 'u-colab'), ...lastScreen('u-colab', '/src/screens/ferias-colaborador.html') },
        });
        assert.equal(target, '/src/screens/ferias-colaborador.html');
    });

    test('sessão antiga, sem perfil na chave, é ignorada', () => {
        const legacy = { 'sb-abc-auth-token': JSON.stringify({ access_token: 'x', user: { id: 'u1' } }) };
        assert.equal(launch({ standalone: true, storage: legacy }), LOGIN);
    });

    test('nunca usa login nem endereço externo como última tela', () => {
        assert.equal(launch({ narrow: true, storage: { ...session('colab', 'u1'), ...lastScreen('u1', LOGIN) } }), HOME_COLAB);
        assert.equal(launch({ narrow: true, storage: { ...session('colab', 'u1'), ...lastScreen('u1', 'https://evil.example/x') } }), HOME_COLAB);
    });

    test('âncora e ?landing mantêm a página inicial visível', () => {
        const storage = { ...session('colab', 'u1'), ...lastScreen('u1', '/src/screens/ponto-colaborador.html') };
        assert.equal(launch({ narrow: true, hash: '#features', storage }), null);
        assert.equal(launch({ narrow: true, search: '?landing', storage }), null);
    });

    test('localStorage corrompido não quebra a abertura', () => {
        assert.equal(launch({ standalone: true, storage: { 'sb-abc-colab-auth-token': '{oops' } }), LOGIN);
    });
});
