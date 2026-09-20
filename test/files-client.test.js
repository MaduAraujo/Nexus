const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.SUPABASE_URL = 'https://proj.supabase.co';
global.SUPABASE_ANON_KEY = 'anon-key';
global.setTimeout = (
    (original) =>
    (fn, ms, ...rest) => {
        const timer = original(fn, ms, ...rest);
        if (ms >= 60_000) timer.unref?.();
        return timer;
    }
)(global.setTimeout);

const NexusFiles = require('../src/javascript/shared/files.js');

let fetchCalls;
let fetchImpl;
let tab;
let tabWasOpenedAt;
let downloads;
let step;

function response({ ok = true, status = 200, body = new Uint8Array([1, 2, 3]), type = 'application/pdf', json } = {}) {
    return {
        ok,
        status,
        headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        json: async () => {
            if (json === undefined) throw new Error('sem json');
            return json;
        },
    };
}

beforeEach(() => {
    fetchCalls = [];
    fetchImpl = async () => response();
    global.fetch = async (url, options) => {
        fetchCalls.push({ url, options });
        return fetchImpl(url, options);
    };
    global.sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt-do-usuario' } } }) } };

    step = 0;
    tabWasOpenedAt = null;
    tab = {
        closed: false,
        opener: 'original',
        location: { href: '' },
        close() {
            this.closed = true;
        },
    };
    global.window.open = (url, target) => {
        tabWasOpenedAt = step;
        assert.equal(url, '');
        assert.equal(target, '_blank');
        return tab;
    };

    downloads = [];
    global.document = {
        createElement: () => ({
            click() {
                downloads.push({ href: this.href, name: this.download });
            },
            remove() {},
        }),
        body: { appendChild() {} },
    };
});

describe('NexusFiles.upload', () => {
    test('envia o arquivo à Edge Function com o token do usuário e o destino nos cabeçalhos', async () => {
        const file = new Blob(['conteúdo'], { type: 'application/pdf' });
        const result = await NexusFiles.upload('documents', 'rh/17_relatório final (1).pdf', file, { contentType: 'application/pdf', upsert: true });

        assert.deepEqual(result, { error: null });
        assert.equal(fetchCalls.length, 1);
        const { url, options } = fetchCalls[0];
        assert.equal(url, 'https://proj.supabase.co/functions/v1/nexus-files');
        assert.equal(options.method, 'POST');
        assert.equal(options.body, file);
        assert.equal(options.headers.Authorization, 'Bearer jwt-do-usuario');
        assert.equal(options.headers.apikey, 'anon-key');
        assert.equal(options.headers['x-nexus-bucket'], 'documents');
        assert.equal(decodeURIComponent(options.headers['x-nexus-path']), 'rh/17_relatório final (1).pdf');
        assert.equal(options.headers['x-nexus-mime'], 'application/pdf');
        assert.equal(options.headers['x-nexus-upsert'], 'true');
    });

    test('sem contentType usa o tipo do arquivo; sem nenhum, octet-stream', async () => {
        await NexusFiles.upload('documents', 'a', new Blob(['x'], { type: 'image/png' }));
        assert.equal(fetchCalls[0].options.headers['x-nexus-mime'], 'image/png');
        await NexusFiles.upload('documents', 'b', new Blob(['x']));
        assert.equal(fetchCalls[1].options.headers['x-nexus-mime'], 'application/octet-stream');
        assert.equal(fetchCalls[1].options.headers['x-nexus-upsert'], 'false');
    });

    test('erro do servidor volta como { error: { message, status } } com a mensagem da função', async () => {
        fetchImpl = async () => response({ ok: false, status: 413, json: { error: 'Arquivo acima do limite de 25 MB' } });
        const { error } = await NexusFiles.upload('documents', 'a', new Blob(['x']));
        assert.equal(error.status, 413);
        assert.equal(error.message, 'Arquivo acima do limite de 25 MB');
    });

    test('resposta de erro sem JSON ainda devolve uma mensagem', async () => {
        fetchImpl = async () => response({ ok: false, status: 502 });
        const { error } = await NexusFiles.upload('documents', 'a', new Blob(['x']));
        assert.equal(error.status, 502);
        assert.ok(error.message.length > 0);
    });

    test('sem sessão não chama a rede', async () => {
        global.sb = { auth: { getSession: async () => ({ data: { session: null } }) } };
        const { error } = await NexusFiles.upload('documents', 'a', new Blob(['x']));
        assert.equal(error.status, 401);
        assert.equal(fetchCalls.length, 0);
    });

    test('falha de rede vira erro, não exceção', async () => {
        fetchImpl = async () => {
            throw new TypeError('Failed to fetch');
        };
        const { error } = await NexusFiles.upload('documents', 'a', new Blob(['x']));
        assert.equal(error.status, 0);
    });
});

describe('NexusFiles.download', () => {
    test('devolve um Blob com os bytes e o tipo da resposta quando é exibível', async () => {
        fetchImpl = async () => response({ body: new Uint8Array([9, 8, 7]), type: 'application/pdf' });
        const { blob, error } = await NexusFiles.download('documents', 'rh/a b.pdf');
        assert.equal(error, null);
        assert.equal(blob.type, 'application/pdf');
        assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([9, 8, 7]));
        assert.equal(fetchCalls[0].url, 'https://proj.supabase.co/functions/v1/nexus-files?bucket=documents&path=rh%2Fa%20b.pdf');
        assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer jwt-do-usuario');
    });

    test('mesmo que o servidor mande um tipo executável, o navegador o trata como download genérico', async () => {
        for (const type of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript', '']) {
            fetchImpl = async () => response({ type });
            const { blob } = await NexusFiles.download('documents', 'x');
            assert.equal(blob.type, 'application/octet-stream', type);
        }
    });

    test('erro do servidor devolve { blob: null, error }', async () => {
        fetchImpl = async () => response({ ok: false, status: 404, json: { error: 'Arquivo não encontrado' } });
        const { blob, error } = await NexusFiles.download('documents', 'x');
        assert.equal(blob, null);
        assert.equal(error.status, 404);
    });
});

describe('NexusFiles.open', () => {
    test('a aba é aberta no mesmo instante do clique, antes de esperar a rede (senão o navegador bloqueia o pop-up)', async () => {
        fetchImpl = async () => {
            step = 1;
            return response();
        };
        const pending = NexusFiles.open('documents', 'rh/a.pdf');
        assert.equal(tabWasOpenedAt, 0);
        assert.equal(fetchCalls.length, 0);
        await pending;
        assert.equal(tabWasOpenedAt, 0);
    });

    test('PDF abre na aba como blob e a aba perde a ligação com o app (opener nulo)', async () => {
        const { error } = await NexusFiles.open('documents', 'rh/a.pdf');
        assert.equal(error, null);
        assert.match(tab.location.href, /^blob:/);
        assert.equal(tab.opener, null);
        assert.equal(tab.closed, false);
        assert.equal(downloads.length, 0);
    });

    test('tipo não exibível (docx, html...) fecha a aba e baixa com o nome do arquivo', async () => {
        fetchImpl = async () => response({ type: 'text/html' });
        const { error } = await NexusFiles.open('documents', 'rh/a.html', { name: 'relatorio.html' });
        assert.equal(error, null);
        assert.equal(tab.closed, true);
        assert.equal(tab.location.href, '');
        assert.equal(downloads.length, 1);
        assert.equal(downloads[0].name, 'relatorio.html');
        assert.match(downloads[0].href, /^blob:/);
    });

    test('se o navegador bloqueou a aba, baixa o arquivo em vez de falhar', async () => {
        global.window.open = () => null;
        const { error } = await NexusFiles.open('documents', 'rh/a.pdf', { name: 'contrato.pdf' });
        assert.equal(error, null);
        assert.equal(downloads.length, 1);
        assert.equal(downloads[0].name, 'contrato.pdf');
    });

    test('erro ao buscar fecha a aba em branco e devolve o erro', async () => {
        fetchImpl = async () => response({ ok: false, status: 403, json: { error: 'Sem permissão' } });
        const { error } = await NexusFiles.open('documents', 'rh/a.pdf');
        assert.equal(error.status, 403);
        assert.equal(tab.closed, true);
        assert.equal(tab.location.href, '');
    });
});
