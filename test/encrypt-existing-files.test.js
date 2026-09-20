const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

let script;
let lib;
let core;
before(async () => {
    script = await import('../scripts/encrypt-existing-files.mjs');
    lib = await import('../supabase/functions/_shared/file-crypto.mjs');
    core = await import('../supabase/functions/_shared/files-core.mjs');
});

const KEY = crypto.randomBytes(32).toString('base64');
const enc = (text) => new TextEncoder().encode(text);
const PDF = enc('%PDF-1.4 contrato confidencial');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);

function fakeClient(initial = {}, { failUpload = () => false, corruptOnUpload = false } = {}) {
    const objects = new Map(Object.entries(initial));
    const uploads = [];
    const storage = {
        from(bucket) {
            return {
                async list(prefix, { limit, offset }) {
                    const base = prefix ? `${bucket}/${prefix}/` : `${bucket}/`;
                    const children = new Map();
                    for (const [full, obj] of objects) {
                        if (!full.startsWith(base)) continue;
                        const rest = full.slice(base.length);
                        const [head, ...tail] = rest.split('/');
                        if (tail.length) children.set(head, { name: head, id: null });
                        else children.set(head, { name: head, id: `id-${full}`, metadata: { mimetype: obj.mime } });
                    }
                    const sorted = [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
                    return { data: sorted.slice(offset, offset + limit), error: null };
                },
                async download(path) {
                    const obj = objects.get(`${bucket}/${path}`);
                    if (!obj) return { data: null, error: { message: 'Object not found' } };
                    return { data: new Blob([obj.bytes], { type: obj.mime }), error: null };
                },
                async upload(path, bytes, options) {
                    uploads.push({ bucket, path, options });
                    if (failUpload(path)) return { error: { message: 'boom' } };
                    objects.set(`${bucket}/${path}`, { bytes: corruptOnUpload ? enc('lixo') : new Uint8Array(bytes), mime: options.contentType });
                    return { error: null };
                },
            };
        },
    };
    return { storage, objects, uploads };
}

const run = (client, over = {}) => script.encryptExistingFiles({ client, key: KEY, log: () => {}, ...over });

describe('backfill: cifrar arquivos que já estavam em claro', () => {
    test('cifra arquivos em subpastas e mantém o conteúdo legível para a função', async () => {
        const client = fakeClient({
            'documents/rh/1_contrato.pdf': { bytes: PDF, mime: 'application/pdf' },
            'documents/e1/2_rg.jpg': { bytes: JPEG, mime: 'image/jpeg' },
            'ponto-selfies/e1/2026-09-20_entrada.jpg': { bytes: JPEG, mime: 'image/jpeg' },
        });
        const totals = await run(client);
        assert.deepEqual(totals, { encrypted: 3, skipped: 0, failed: 0 });

        for (const [full, obj] of client.objects) {
            assert.equal(lib.isEncrypted(obj.bytes), true, full);
            assert.equal(obj.mime, 'application/octet-stream', full);
            assert.ok(!Buffer.from(obj.bytes).toString('latin1').includes('confidencial'));
        }
        assert.ok(client.uploads.every((u) => u.options.upsert === true));

        const served = await core.handleDownload({ storage: client.storage, key: KEY, bucket: 'documents', path: 'rh/1_contrato.pdf' });
        assert.equal(served.status, 200);
        assert.equal(served.contentType, 'application/pdf');
        assert.deepEqual(served.bytes, PDF);
    });

    test('é idempotente: rodar de novo pula o que já está cifrado e não mexe nos bytes', async () => {
        const client = fakeClient({ 'documents/rh/a.pdf': { bytes: PDF, mime: 'application/pdf' } });
        await run(client);
        const before = new Uint8Array(client.objects.get('documents/rh/a.pdf').bytes);
        const again = await run(client);
        assert.deepEqual(again, { encrypted: 0, skipped: 1, failed: 0 });
        assert.deepEqual(client.objects.get('documents/rh/a.pdf').bytes, before);
        assert.equal(client.uploads.length, 1);
    });

    test('simulação (--dry-run) não grava nada', async () => {
        const client = fakeClient({ 'documents/rh/a.pdf': { bytes: PDF, mime: 'application/pdf' } });
        const totals = await run(client, { dryRun: true });
        assert.deepEqual(totals, { encrypted: 1, skipped: 0, failed: 0 });
        assert.equal(client.uploads.length, 0);
        assert.deepEqual(client.objects.get('documents/rh/a.pdf').bytes, PDF);
    });

    test('uma falha não interrompe os demais e é contada; o arquivo com falha continua como estava', async () => {
        const client = fakeClient(
            { 'documents/rh/ruim.pdf': { bytes: PDF, mime: 'application/pdf' }, 'documents/rh/bom.pdf': { bytes: PDF, mime: 'application/pdf' } },
            { failUpload: (path) => path.endsWith('ruim.pdf') }
        );
        const totals = await run(client);
        assert.deepEqual(totals, { encrypted: 1, skipped: 0, failed: 1 });
        assert.deepEqual(client.objects.get('documents/rh/ruim.pdf').bytes, PDF);
        assert.equal(lib.isEncrypted(client.objects.get('documents/rh/bom.pdf').bytes), true);
    });

    test('a conferência depois de gravar pega uma gravação que não bate com o original', async () => {
        const client = fakeClient({ 'documents/rh/a.pdf': { bytes: PDF, mime: 'application/pdf' } }, { corruptOnUpload: true });
        const totals = await run(client);
        assert.equal(totals.failed, 1);
        assert.equal(totals.encrypted, 0);
    });

    test('mais de uma página de arquivos na mesma pasta', async () => {
        const initial = {};
        for (let i = 0; i < 230; i++) initial[`documents/rh/f${String(i).padStart(3, '0')}.pdf`] = { bytes: PDF, mime: 'application/pdf' };
        const client = fakeClient(initial);
        assert.deepEqual(await run(client, { buckets: ['documents'] }), { encrypted: 230, skipped: 0, failed: 0 });
    });

    test('arquivo que diz ser PDF mas não é fica como download genérico (mesma regra do upload)', async () => {
        const client = fakeClient({ 'documents/rh/falso.pdf': { bytes: enc('<html>oi</html>'), mime: 'application/pdf' } });
        await run(client);
        const served = await core.handleDownload({ storage: client.storage, key: KEY, bucket: 'documents', path: 'rh/falso.pdf' });
        assert.equal(served.contentType, 'application/octet-stream');
    });

    test('só processa os buckets cifrados (nunca o avatars, que é público)', async () => {
        const client = fakeClient({ 'avatars/e1': { bytes: JPEG, mime: 'image/jpeg' } });
        assert.deepEqual(await run(client), { encrypted: 0, skipped: 0, failed: 0 });
        assert.deepEqual(client.objects.get('avatars/e1').bytes, JPEG);
    });
});
