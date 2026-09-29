const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { fakeClient } = require('../test-support/fake-storage.js');

const RAIZ = path.join(__dirname, '..');
const rodar = (script, env, cwd = RAIZ, args = []) =>
    new Promise((resolve) => {
        execFile(
            process.execPath,
            [path.join(RAIZ, script), ...args],
            { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, cwd, timeout: 60000 },
            (erro, stdout, stderr) => resolve({ codigo: erro ? erro.code : 0, stdout, stderr })
        );
    });

const CHAVE = crypto.randomBytes(32).toString('base64');
const OUTRA = crypto.randomBytes(32).toString('base64');

let storageFalso;
let urlStorage;
let storageComFalha;
let urlComFalha;
before(async () => {
    storageComFalha = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            if (req.url.includes('/object/list/documents')) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify([{ name: 'a.pdf', id: 'id-1', metadata: { mimetype: 'application/pdf' } }]));
            } else if (req.url.includes('/object/list/')) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end('[]');
            } else {
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ statusCode: '400', error: 'Bad', message: 'download recusado' }));
            }
        });
    });
    await new Promise((r) => storageComFalha.listen(0, '127.0.0.1', r));
    urlComFalha = `http://127.0.0.1:${storageComFalha.address().port}`;

    storageFalso = http.createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('[]');
        });
    });
    await new Promise((r) => storageFalso.listen(0, '127.0.0.1', r));
    urlStorage = `http://127.0.0.1:${storageFalso.address().port}`;
});
after(() => {
    storageFalso.close();
    storageComFalha.close();
});

describe('rotação da chave: falhas no meio do caminho', () => {
    let script;
    let lib;
    before(async () => {
        script = await import('../scripts/rotate-file-key.mjs');
        lib = await import('../supabase/functions/_shared/file-crypto.mjs');
    });

    const RING = { active: 'v2', keys: { v1: OUTRA, v2: CHAVE } };
    const ANTIGA = { active: 'v1', keys: { v1: OUTRA } };
    const NOVA = { active: 'v2', keys: { v2: CHAVE } };
    const pdf = new TextEncoder().encode('%PDF-1.4 conteudo');
    const selado = (chave, bytes = pdf, mime = 'application/pdf') => lib.encryptFile(chave, { bucket: 'documents', path: 'a.pdf', mime, bytes });

    async function comDesvio({ download, upload } = {}) {
        const base = fakeClient({ 'documents/a.pdf': { bytes: await selado(ANTIGA), mime: 'application/octet-stream' } });
        const from = base.storage.from.bind(base.storage);
        let downloads = 0;
        base.storage.from = (bucket) => {
            const api = from(bucket);
            return {
                ...api,
                download: async (p) => (download ? download(++downloads, () => api.download(p)) : api.download(p)),
                upload: async (p, bytes, opts) => (upload ? upload(p, bytes, opts, api) : api.upload(p, bytes, opts)),
            };
        };
        const logs = [];
        const totals = await script.rotateFileKey({ client: base, ring: RING, buckets: ['documents'], log: (m) => logs.push(m) });
        return { totals, logs: logs.join('\n') };
    }

    test('download que falha ou volta vazio é contado como falha', async () => {
        const erro = await comDesvio({ download: () => ({ data: null, error: { message: 'rede caiu' } }) });
        assert.equal(erro.totals.failed, 1);
        assert.match(erro.logs, /FALHOU a\.pdf: rede caiu/);
        const vazio = await comDesvio({ download: () => ({ data: null, error: null }) });
        assert.match(vazio.logs, /download vazio/);
    });

    test('regravação recusada pelo Storage é falha e o arquivo antigo fica', async () => {
        const r = await comDesvio({ upload: () => ({ error: { message: 'quota' } }) });
        assert.equal(r.totals.failed, 1);
        assert.match(r.logs, /FALHOU a\.pdf: quota/);
    });

    test('se não der para reler o arquivo gravado, é falha', async () => {
        const r = await comDesvio({ download: (n, real) => (n === 1 ? real() : { data: null, error: { message: 'x' } }) });
        assert.match(r.logs, /não foi possível reler o arquivo gravado/);
    });

    test('a conferência pega arquivo relido com outra chave, outro tipo, outro tamanho ou outro conteúdo', async () => {
        const regrava = (bytesFn) => async (p, _bytes, opts, api) => api.upload(p, await bytesFn(), opts);
        const casos = [
            ['outra chave', regrava(() => selado(ANTIGA))],
            ['outro tipo', regrava(() => selado(NOVA, pdf, 'image/png'))],
            ['outro tamanho', regrava(() => selado(NOVA, new TextEncoder().encode('%PDF-1.4 conteudo maior')))],
            ['outro conteúdo', regrava(() => selado(NOVA, new TextEncoder().encode('%PDF-1.4 CONTEUDO')))],
        ];
        for (const [nome, upload] of casos) {
            const r = await comDesvio({ upload });
            assert.equal(r.totals.failed, 1, nome);
            assert.match(r.logs, /conferência falhou/, nome);
        }
    });
});

describe('scripts pelo terminal', () => {
    test('rotação: sem as variáveis do Supabase ou com chave inválida sai com código 2', async () => {
        const semEnv = await rodar('scripts/rotate-file-key.mjs', {});
        assert.equal(semEnv.codigo, 2);
        assert.match(semEnv.stderr, /Defina SUPABASE_URL/);
        const chaveRuim = await rodar('scripts/rotate-file-key.mjs', {
            SUPABASE_URL: urlStorage,
            SUPABASE_SERVICE_ROLE_KEY: 'x',
            FILES_ENCRYPTION_KEY: 'Y3VydGE=',
        });
        assert.equal(chaveRuim.codigo, 2);
        assert.match(chaveRuim.stderr, /32 bytes/);
    });

    test('rotação e cifragem inicial rodam de ponta a ponta contra o Storage e saem com 0 quando não há falhas', async () => {
        const env = { SUPABASE_URL: urlStorage, SUPABASE_SERVICE_ROLE_KEY: 'chave-de-servico', FILES_ENCRYPTION_KEY: CHAVE, FILES_ENCRYPTION_KEY_ID: 'v2' };
        const rot = await rodar('scripts/rotate-file-key.mjs', env, RAIZ, ['--dry-run']);
        assert.equal(rot.codigo, 0, rot.stderr);
        assert.match(rot.stdout, /Simulação: 0 seriam recifrados com a chave v2/);
        const cif = await rodar('scripts/encrypt-existing-files.mjs', env);
        assert.equal(cif.codigo, 0, cif.stderr);
    });

    test('rotação e cifragem inicial saem com código 1 quando algum arquivo falha', async () => {
        const env = { SUPABASE_URL: urlComFalha, SUPABASE_SERVICE_ROLE_KEY: 'chave-de-servico', FILES_ENCRYPTION_KEY: CHAVE, FILES_ENCRYPTION_KEY_ID: 'v2' };
        const rot = await rodar('scripts/rotate-file-key.mjs', env);
        assert.equal(rot.codigo, 1, rot.stderr);
        assert.match(rot.stdout, /FALHOU a\.pdf/);
        const cif = await rodar('scripts/encrypt-existing-files.mjs', env);
        assert.equal(cif.codigo, 1, cif.stderr);
    });

    test('importar o script de backup sem rodá-lo (sem arquivo de entrada) não dispara o backup', async () => {
        const r = await new Promise((resolve) =>
            execFile(
                process.execPath,
                [
                    '--input-type=module',
                    '-e',
                    `await import(${JSON.stringify(require('node:url').pathToFileURL(path.join(RAIZ, 'scripts/backup/backup-db.mjs')).href)}); console.log('importado')`,
                ],
                { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } },
                (erro, stdout, stderr) => resolve({ codigo: erro ? erro.code : 0, stdout, stderr })
            )
        );
        assert.equal(r.codigo, 0, r.stderr);
        assert.equal(r.stdout.trim(), 'importado');
    });

    test('cifragem inicial: sem variáveis ou com chave inválida sai com código 2', async () => {
        const semEnv = await rodar('scripts/encrypt-existing-files.mjs', {});
        assert.equal(semEnv.codigo, 2);
        const chaveRuim = await rodar('scripts/encrypt-existing-files.mjs', {
            SUPABASE_URL: urlStorage,
            SUPABASE_SERVICE_ROLE_KEY: 'x',
            FILES_ENCRYPTION_KEY: 'não-é-base64!',
        });
        assert.equal(chaveRuim.codigo, 2);
    });

    test('backup: sem configuração, sem GnuPG e com falha no dump sai com código 1 e explica', async () => {
        const semEnv = await rodar('scripts/backup/backup-db.mjs', {});
        assert.equal(semEnv.codigo, 1);
        assert.match(semEnv.stderr, /Falha no backup: Defina BACKUP_DB_URL/);

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-backup-'));
        const frase = path.join(dir, 'frase.txt');
        fs.writeFileSync(frase, 'uma-frase-secreta-bem-longa-para-o-backup');
        const semGpg = await rodar('scripts/backup/backup-db.mjs', {
            BACKUP_DB_URL: 'postgresql://x',
            BACKUP_PASSPHRASE_FILE: frase,
            GPG_BIN: path.join(dir, 'gpg-que-nao-existe'),
        });
        assert.equal(semGpg.codigo, 1);
        assert.match(semGpg.stderr, /gpg não encontrado/);

        const dumpFalha = await rodar(
            'scripts/backup/backup-db.mjs',
            { BACKUP_DB_URL: 'postgresql://127.0.0.1:9/nada', BACKUP_PASSPHRASE_FILE: frase, GPG_BIN: process.execPath },
            dir
        );
        assert.equal(dumpFalha.codigo, 1);
        assert.match(dumpFalha.stderr, /Falha no backup/);
        assert.ok(fs.existsSync(path.join(dir, 'backups')), 'sem --out, grava na pasta backups do diretório atual');
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
