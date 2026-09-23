const { test, describe, beforeEach, afterEach } = require('node:test');
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

    test('401 com sessão renovável: renova o token e repete a chamada uma vez', async () => {
        let calls = 0;
        fetchImpl = async () => (++calls === 1 ? response({ ok: false, status: 401, json: { error: 'Não autorizado' } }) : response());
        global.sb.auth.refreshSession = async () => ({ data: { session: { access_token: 'jwt-novo' } } });
        const { blob, error } = await NexusFiles.download('documents', 'x');
        assert.equal(error, null);
        assert.ok(blob);
        assert.equal(fetchCalls.length, 2);
        assert.equal(fetchCalls[1].options.headers.Authorization, 'Bearer jwt-novo');
    });

    test('401 com sessão encerrada em outro lugar: pede novo login em vez de "Não autorizado"', async () => {
        fetchImpl = async () => response({ ok: false, status: 401, json: { error: 'Não autorizado' } });
        global.sb.auth.refreshSession = async () => ({ data: { session: null }, error: { message: 'Invalid Refresh Token' } });
        const { blob, error } = await NexusFiles.download('documents', 'x');
        assert.equal(blob, null);
        assert.match(error.message, /Sessão expirada/);
        assert.equal(fetchCalls.length, 1);
    });

    test('safeName remove acentos, espaços e símbolos que o Storage recusa', () => {
        assert.equal(NexusFiles.safeName('Comprovante de residência (2ª via).pdf'), 'Comprovante_de_residencia_2_via_.pdf');
        assert.equal(NexusFiles.safeName('../../etc/passwd'), 'etc_passwd');
        assert.equal(NexusFiles.safeName('日本語'), 'arquivo');
        assert.equal(NexusFiles.safeName(''), 'arquivo');
        assert.ok(NexusFiles.safeName('a'.repeat(500) + '.pdf').length <= 120);
    });

    test('erro ao buscar fecha a aba em branco e devolve o erro', async () => {
        fetchImpl = async () => response({ ok: false, status: 403, json: { error: 'Sem permissão' } });
        const { error } = await NexusFiles.open('documents', 'rh/a.pdf');
        assert.equal(error.status, 403);
        assert.equal(tab.closed, true);
        assert.equal(tab.location.href, '');
    });
});

describe('ponta a ponta (NexusE2E presente)', () => {
    const E2E = require('../src/javascript/shared/e2e-crypto.js');
    let storage;
    let rpcs;
    let me;
    let org;

    async function identity() {
        const id = await E2E.generateIdentity();
        return { publicJwk: id.publicJwk, fingerprint: await E2E.fingerprint(id.publicJwk), privateKey: await E2E.importPrivate(id.pkcs8) };
    }

    beforeEach(async () => {
        me = await identity();
        org = await identity();
        storage = new Map();
        rpcs = [];
        global.sb.storage = {
            from: (bucket) => ({
                upload: async (path, blob, opts) => {
                    storage.set(`${bucket}/${path}`, { bytes: new Uint8Array(await blob.arrayBuffer()), opts });
                    return { error: null };
                },
                download: async (path) => {
                    const obj = storage.get(`${bucket}/${path}`);
                    return obj ? { data: new Blob([obj.bytes]), error: null } : { data: null, error: { message: 'not found' } };
                },
            }),
        };
        global.sb.rpc = async (name, args) => {
            rpcs.push([name, args]);
            return { data: null, error: null };
        };
        global.window.NexusE2E = {
            isEncryptedFile: E2E.isEncryptedFile,
            fileRecipients: E2E.fileRecipients,
            recipientsFor: async (employeeId) => (employeeId === 'sem-chave' ? null : [me, org]),
            encryptFile: async (bytes, opts) => (opts.employeeId === 'sem-chave' ? null : E2E.encryptFile(bytes, { ...opts, recipients: [me, org] })),
            encryptFileFor: (bytes, opts) => E2E.encryptFile(bytes, opts),
            decryptFile: (bytes, { bucket, path }) => E2E.decryptFile(bytes, { bucket, path, identities: [me] }),
        };
    });

    afterEach(() => {
        delete global.window.NexusE2E;
    });

    const LEGACY = new Uint8Array([0x4e, 0x58, 0x46, 0x32, 1, 2, 3]);
    const sealFor = (recipients, path, text) =>
        E2E.encryptFile(new TextEncoder().encode(text), { bucket: 'documents', path, mime: 'application/pdf', recipients });

    test('documento é cifrado no navegador e vai direto ao Storage, sem passar pela nexus-files', async () => {
        const pdf = new Blob(['%PDF-1.7 RG 12.345.678-9'], { type: 'application/pdf' });
        const { error } = await NexusFiles.upload('documents', 'e1/rg.pdf', pdf, { employeeId: 'e1' });
        assert.equal(error, null);
        assert.equal(fetchCalls.length, 0);
        const stored = storage.get('documents/e1/rg.pdf');
        assert.equal(E2E.isEncryptedFile(stored.bytes), true);
        assert.ok(!Buffer.from(stored.bytes).toString('latin1').includes('12.345.678'));
        assert.equal(stored.opts.contentType, 'application/octet-stream');
    });

    test('sem as chaves do colaborador, cai na cifragem do servidor (nexus-files)', async () => {
        await NexusFiles.upload('documents', 'e1/rg.pdf', new Blob(['x']), { employeeId: 'sem-chave' });
        assert.equal(fetchCalls.length, 1);
        assert.equal(storage.size, 0);
    });

    test('anexos de comunicado (bucket fora do escopo) continuam pela nexus-files', async () => {
        await NexusFiles.upload('message-attachments', 'm/a.pdf', new Blob(['x']), { employeeId: 'e1' });
        assert.equal(fetchCalls.length, 1);
    });

    test('abrir um arquivo E2E decifra no navegador e registra o download para os alertas', async () => {
        await NexusFiles.upload('documents', 'e1/rg.pdf', new Blob(['%PDF-1.7 conteúdo'], { type: 'application/pdf' }), { employeeId: 'e1' });
        const { blob, error } = await NexusFiles.download('documents', 'e1/rg.pdf');
        assert.equal(error, null);
        assert.equal(blob.type, 'application/pdf');
        assert.equal(await blob.text(), '%PDF-1.7 conteúdo');
        assert.deepEqual(rpcs, [['report_file_download', { p_bucket: 'documents' }]]);
        assert.equal(fetchCalls.length, 0);
    });

    test('arquivo que diz ser PDF mas não é abre como download, não inline', async () => {
        await NexusFiles.upload('documents', 'e1/x.pdf', new Blob(['<html>não sou pdf</html>'], { type: 'application/pdf' }), { employeeId: 'e1' });
        const { blob } = await NexusFiles.download('documents', 'e1/x.pdf');
        assert.equal(blob.type, 'application/octet-stream');
    });

    test('arquivo E2E que não abre com as chaves deste acesso dá erro claro', async () => {
        const outro = await identity();
        storage.set('documents/e1/y.pdf', { bytes: await sealFor([outro], 'e1/y.pdf', 'x') });
        const { blob, error } = await NexusFiles.download('documents', 'e1/y.pdf');
        assert.equal(blob, null);
        assert.equal(error.status, 403);
        assert.match(error.message, /ponta a ponta/);
    });

    test('arquivo antigo (cifrado pelo servidor) continua abrindo pela nexus-files', async () => {
        storage.set('documents/e1/antigo.pdf', { bytes: LEGACY });
        fetchImpl = async () => response({ body: new Uint8Array([7, 7]), type: 'application/pdf' });
        const { blob } = await NexusFiles.download('documents', 'e1/antigo.pdf');
        assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([7, 7]));
        assert.equal(fetchCalls.length, 1);
    });

    test('migração: arquivo antigo vira E2E e é conferido; rodar de novo não regrava', async () => {
        storage.set('documents/e1/antigo.pdf', { bytes: LEGACY });
        fetchImpl = async () => response({ body: new TextEncoder().encode('%PDF-1.4 antigo'), type: 'application/pdf' });
        assert.equal(await NexusFiles.migrateToEndToEnd('documents', 'e1/antigo.pdf', 'e1'), 'migrated');
        const opened = await E2E.decryptFile(storage.get('documents/e1/antigo.pdf').bytes, { bucket: 'documents', path: 'e1/antigo.pdf', identities: [org] });
        assert.equal(new TextDecoder().decode(opened.bytes), '%PDF-1.4 antigo');
        assert.equal(await NexusFiles.migrateToEndToEnd('documents', 'e1/antigo.pdf', 'e1'), 'already');
        assert.equal(await NexusFiles.migrateToEndToEnd('documents', 'e1/antigo.pdf', 'sem-chave'), 'no-keys');
    });

    test('migração recompartilha arquivo E2E cujo colaborador trocou de chave', async () => {
        const velho = await identity();
        storage.set('documents/e1/z.pdf', { bytes: await sealFor([velho, me], 'e1/z.pdf', '%PDF z') });
        assert.equal(await NexusFiles.migrateToEndToEnd('documents', 'e1/z.pdf', 'e1'), 'repaired');
        assert.deepEqual(E2E.fileRecipients(storage.get('documents/e1/z.pdf').bytes).sort(), [me.fingerprint, org.fingerprint].sort());
    });
});
