const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'src', 'javascript', 'shared', 'supabase-client.js'), 'utf8');

function loadClient({ file, storage = {} }) {
    const created = [];
    const store = { ...storage };
    const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => {
            store[k] = v;
        },
        removeItem: (k) => {
            delete store[k];
        },
    };

    class Builder {
        then(onFulfilled) {
            return Promise.resolve({}).then(onFulfilled);
        }
    }
    class StorageApi {
        upload() {}
    }
    const supabase = {
        createClient: (url, key, options) => {
            const client = { options, from: () => ({ select: () => new Builder() }), storage: { from: () => new StorageApi() } };
            created.push(client);
            return client;
        },
    };

    const ctx = { supabase, localStorage, location: { pathname: `/src/screens/${file}` }, window: {}, document: {}, URL, console };
    vm.createContext(ctx);
    vm.runInContext(`${CODE}\n;globalThis.__api = { getSb: () => sb, nexusSlotFromPage, nexusUseProfileSession };`, ctx);
    return { api: ctx.__api, created, store };
}

const REF = 'axyagainqlanowuejdcz';
const storageKeyOf = (client) => client.options.auth.storageKey;

describe('sessão separada por perfil no mesmo navegador', () => {
    test('telas do colaborador usam a chave do colaborador', () => {
        for (const file of ['inicio-colaborador.html', 'chat-colaborador.html', 'ponto-colaborador.html', 'perfil-colaborador.html']) {
            const { created } = loadClient({ file });
            assert.equal(storageKeyOf(created[0]), `sb-${REF}-colab-auth-token`, file);
        }
    });

    test('telas do RH usam a chave do RH (inclusive colaboradores.html, que é do RH)', () => {
        for (const file of ['inicio-rh.html', 'dashboard.html', 'colaboradores.html', 'ferias.html', 'pagamentos.html', 'chat-rh.html']) {
            const { created } = loadClient({ file });
            assert.equal(storageKeyOf(created[0]), `sb-${REF}-rh-auth-token`, file);
        }
    });

    test('todas as telas do projeto caem em um dos dois perfis, exceto o login', () => {
        const screensDir = path.join(__dirname, '..', 'src', 'screens');
        for (const file of fs.readdirSync(screensDir).filter((f) => f.endsWith('.html') && f !== 'login.html')) {
            const { api } = loadClient({ file });
            assert.ok(['rh', 'colab'].includes(api.nexusSlotFromPage()), file);
        }
    });

    test('a tela de login começa sem chave própria', () => {
        const { created } = loadClient({ file: 'login.html' });
        assert.equal(created[0].options.auth.storageKey, undefined);
    });

    test('escolher o perfil no login troca o cliente para a chave daquele perfil', () => {
        const { api, created } = loadClient({ file: 'login.html' });
        const rh = api.nexusUseProfileSession('Administrador');
        assert.equal(storageKeyOf(rh), `sb-${REF}-rh-auth-token`);
        assert.equal(api.getSb(), rh);
        const colab = api.nexusUseProfileSession('colaborador');
        assert.equal(storageKeyOf(colab), `sb-${REF}-colab-auth-token`);
        assert.equal(api.getSb(), colab);
        assert.equal(created.length, 3);
    });

    test('as duas sessões mantêm chaves diferentes, então uma aba não sobrescreve a outra', () => {
        const a = loadClient({ file: 'inicio-colaborador.html' }).created[0];
        const b = loadClient({ file: 'inicio-rh.html' }).created[0];
        assert.notEqual(storageKeyOf(a), storageKeyOf(b));
    });

    test('sessão antiga (chave única) é movida para a chave do perfil da tela e a antiga é apagada', () => {
        const legacyKey = `sb-${REF}-auth-token`;
        const { store } = loadClient({ file: 'inicio-colaborador.html', storage: { [legacyKey]: '{"user":{"id":"u1"}}' } });
        assert.equal(store[`sb-${REF}-colab-auth-token`], '{"user":{"id":"u1"}}');
        assert.equal(legacyKey in store, false);
    });

    test('sessão antiga não sobrescreve uma sessão já existente do perfil', () => {
        const legacyKey = `sb-${REF}-auth-token`;
        const slotKey = `sb-${REF}-rh-auth-token`;
        const { store } = loadClient({ file: 'inicio-rh.html', storage: { [legacyKey]: 'antiga', [slotKey]: 'atual' } });
        assert.equal(store[slotKey], 'atual');
        assert.equal(legacyKey in store, false);
    });

    test('na tela de login a sessão antiga é preservada (convite e recuperação de senha dependem dela)', () => {
        const legacyKey = `sb-${REF}-auth-token`;
        const { store } = loadClient({ file: 'login.html', storage: { [legacyKey]: 'convite' } });
        assert.equal(store[legacyKey], 'convite');
    });
});
