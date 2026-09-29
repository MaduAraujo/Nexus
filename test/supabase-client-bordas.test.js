const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const FILE = path.join(__dirname, '..', 'src', 'javascript', 'shared', 'supabase-client.js');
const CODE = fs.readFileSync(FILE, 'utf8');
const REF = 'axyagainqlanowuejdcz';
const SEM_MOTIVO = Symbol('rejeição sem motivo');

const respostas = [];
const criados = [];
const avisos = [];
class Builder {
    then(onFulfilled, onRejected) {
        const r = respostas.length ? respostas.shift() : { data: [], error: null };
        return (r === SEM_MOTIVO ? Promise.reject(undefined) : Promise.resolve(r)).then(onFulfilled, onRejected);
    }
}
class Bucket {}
const biblioteca = {
    createClient: (url, key, options) => {
        const client = { options, from: () => ({ select: () => new Builder() }), storage: { from: () => new Bucket() } };
        criados.push(client);
        return client;
    },
};

let ctx;
let api;
before(() => {
    ctx = vm.createContext({
        supabase: biblioteca,
        URL,
        console: { error: (...a) => avisos.push(a) },
        window: { addEventListener() {} },
        setTimeout,
        location: { pathname: '/src/screens/dashboard.html' },
        document: {},
    });
    vm.runInContext(CODE, ctx, { filename: FILE });
    vm.runInContext(
        'globalThis.__api = { sb: () => sb, nexusSlotFromPage, nexusUseProfileSession, reportSupabaseError, interceptSupabaseErrors, interceptStorageErrors, ligarAvisoDeErroDaTela };',
        ctx,
        { filename: 'acesso-do-teste.js' }
    );
    api = ctx.__api;
});

beforeEach(() => {
    respostas.splice(0);
    avisos.splice(0);
    ctx.location = { pathname: '/src/screens/dashboard.html' };
    delete ctx.localStorage;
});

describe('supabase-client — qual sessão usar', () => {
    test('sem location (execução fora de uma página), não há perfil', () => {
        delete ctx.location;
        assert.equal(api.nexusSlotFromPage(), null);
    });

    test('caminho terminado em barra não é uma tela: sem perfil', () => {
        ctx.location = { pathname: '/src/screens/' };
        assert.equal(api.nexusSlotFromPage(), null);
    });

    test('perfil desconhecido cai na sessão sem perfil; colaborador usa a chave do colaborador', () => {
        api.nexusUseProfileSession('Visitante');
        assert.equal(criados.at(-1).options.auth.storageKey, undefined);
        api.nexusUseProfileSession('colaborador');
        assert.equal(criados.at(-1).options.auth.storageKey, `sb-${REF}-colab-auth-token`);
    });

    test('armazenamento local bloqueado não impede o cliente de subir', () => {
        ctx.localStorage = {
            getItem() {
                throw new Error('SecurityError');
            },
        };
        api.nexusUseProfileSession('Administrador');
        assert.equal(criados.at(-1).options.auth.storageKey, `sb-${REF}-rh-auth-token`);
    });
});

describe('supabase-client — interceptação das consultas', () => {
    test('consulta aguardada sem tratadores devolve o resultado; com tratador, entrega a ele', async () => {
        respostas.push({ data: [1], error: null }, { data: [2], error: null });
        const semTratador = await new Promise((resolve) => api.sb().from('x').select().then(undefined, undefined).then(resolve));
        assert.deepEqual(semTratador, { data: [1], error: null });
        assert.deepEqual(await api.sb().from('x').select(), { data: [2], error: null });
    });

    test('rejeição sem motivo é repassada e não gera aviso; relatar erro vazio também não', async () => {
        respostas.push(SEM_MOTIVO);
        await assert.rejects(Promise.resolve().then(() => api.sb().from('x').select()));
        api.reportSupabaseError(null);
        assert.equal(avisos.length, 0);
    });

    test('interceptar de novo não embrulha duas vezes: um erro gera um aviso só', async () => {
        api.interceptSupabaseErrors();
        respostas.push({ data: null, error: { message: 'x' } });
        await api.sb().from('x').select();
        assert.equal(avisos.length, 1);
    });

    test('biblioteca cujas consultas não são "thenable" fica sem interceptação, sem quebrar', () => {
        const original = api.sb().from;
        api.sb().from = () => ({ select: () => ({}) });
        try {
            assert.doesNotThrow(() => api.interceptSupabaseErrors());
        } finally {
            api.sb().from = original;
        }
    });

    test('Storage já interceptado não é embrulhado de novo; método que não aceita ser trocado segue funcionando', async () => {
        assert.doesNotThrow(() => api.interceptStorageErrors());
        const original = async () => ({ data: 'ok', error: null });
        class BucketTravado {}
        Object.defineProperty(BucketTravado.prototype, 'download', {
            configurable: true,
            get: () => original,
            set() {
                throw new Error('somente leitura');
            },
        });
        const storageOriginal = api.sb().storage.from;
        api.sb().storage.from = () => new BucketTravado();
        try {
            api.interceptStorageErrors();
            assert.deepEqual(await api.sb().storage.from('documents').download('a'), { data: 'ok', error: null });
        } finally {
            api.sb().storage.from = storageOriginal;
        }
    });

    test('sem document com addEventListener (execução fora de página), o aviso da tela não é ligado', () => {
        const doc = ctx.document;
        delete ctx.document;
        try {
            assert.doesNotThrow(() => api.ligarAvisoDeErroDaTela());
        } finally {
            ctx.document = doc;
        }
        assert.doesNotThrow(() => api.ligarAvisoDeErroDaTela());
    });
});
