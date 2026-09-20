const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

let core;
let lib;
before(async () => {
    core = await import('../supabase/functions/_shared/files-core.mjs');
    lib = await import('../supabase/functions/_shared/file-crypto.mjs');
});

const KEY = crypto.randomBytes(32).toString('base64');
const enc = (text) => new TextEncoder().encode(text);
const PDF = enc('%PDF-1.4\nconteúdo confidencial do contrato\n%%EOF');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function fakeStorage({ denyUpload = null, denyDownload = false } = {}) {
    const objects = new Map();
    const calls = [];
    return {
        objects,
        calls,
        from(bucket) {
            return {
                async upload(path, bytes, options) {
                    calls.push({ bucket, path, options });
                    if (denyUpload) return { error: denyUpload };
                    if (objects.has(`${bucket}/${path}`) && !options.upsert) return { error: { message: 'The resource already exists', statusCode: '409' } };
                    objects.set(`${bucket}/${path}`, { bytes: new Uint8Array(bytes), type: options.contentType });
                    return { data: { path }, error: null };
                },
                async download(path) {
                    const found = objects.get(`${bucket}/${path}`);
                    if (denyDownload || !found) return { data: null, error: { message: 'Object not found' } };
                    return { data: new Blob([found.bytes], { type: found.type }), error: null };
                },
            };
        },
    };
}

const up = (storage, over = {}) =>
    core.handleUpload({ storage, key: KEY, bucket: 'documents', path: 'rh/1_contrato.pdf', mime: 'application/pdf', bytes: PDF, ...over });
const down = (storage, over = {}) => core.handleDownload({ storage, key: KEY, bucket: 'documents', path: 'rh/1_contrato.pdf', ...over });

describe('upload cifrado', () => {
    test('o Storage recebe só texto cifrado, como application/octet-stream', async () => {
        const storage = fakeStorage();
        const result = await up(storage);
        assert.equal(result.status, 201);
        const stored = storage.objects.get('documents/rh/1_contrato.pdf');
        assert.equal(stored.type, 'application/octet-stream');
        assert.equal(lib.isEncrypted(stored.bytes), true);
        assert.ok(!Buffer.from(stored.bytes).toString('latin1').includes('confidencial'));
    });

    test('ida e volta: o que foi enviado é o que se lê depois, com o tipo original', async () => {
        const storage = fakeStorage();
        await up(storage);
        const result = await down(storage);
        assert.equal(result.status, 200);
        assert.equal(result.contentType, 'application/pdf');
        assert.deepEqual(result.bytes, PDF);
    });

    test('o pedido de sobrescrever (upsert) chega ao Storage', async () => {
        const storage = fakeStorage();
        await up(storage, { upsert: true });
        assert.equal(storage.calls[0].options.upsert, true);
        assert.equal((await up(storage, { upsert: true })).status, 201);
    });

    test('a negativa das policies do Storage vira 403 e nada é gravado', async () => {
        const storage = fakeStorage({ denyUpload: { message: 'new row violates row-level security policy', statusCode: '403' } });
        const result = await up(storage);
        assert.equal(result.status, 403);
        assert.equal(storage.objects.size, 0);
    });

    test('caminho já existente sem upsert vira 409', async () => {
        const storage = fakeStorage();
        await up(storage);
        assert.equal((await up(storage)).status, 409);
    });

    test('bucket fora da lista (inclusive o público avatars) e caminhos perigosos são recusados', async () => {
        const storage = fakeStorage();
        for (const bucket of ['avatars', 'outro', '__proto__', 'toString']) assert.equal((await up(storage, { bucket })).status, 400, bucket);
        for (const path of ['', '/abs', '../x', 'a/../b', 'a//b', './a', 'a/./b', 'x\u0000y', 'a'.repeat(301)]) {
            assert.equal((await up(storage, { path })).status, 400, JSON.stringify(path));
        }
        assert.equal(storage.objects.size, 0);
    });

    test('arquivo vazio e arquivo acima do limite do bucket são recusados', async () => {
        const storage = fakeStorage();
        assert.equal((await up(storage, { bytes: new Uint8Array(0) })).status, 400);
        const big = new Uint8Array(3 * 1024 * 1024 + 1);
        big.set(JPEG);
        assert.equal((await up(storage, { bucket: 'ponto-selfies', path: 'e1/s.jpg', mime: 'image/jpeg', bytes: big })).status, 413);
    });

    test('selfie do ponto só aceita JPEG de verdade', async () => {
        const storage = fakeStorage();
        const base = { bucket: 'ponto-selfies', path: 'e1/2026-09-20_entrada_1.jpg' };
        assert.equal((await up(storage, { ...base, mime: 'image/jpeg', bytes: JPEG })).status, 201);
        assert.equal((await up(storage, { ...base, path: 'e1/b.jpg', mime: 'image/png', bytes: PNG })).status, 415);
        assert.equal((await up(storage, { ...base, path: 'e1/c.jpg', mime: 'image/jpeg', bytes: enc('<html><script>alert(1)</script>') })).status, 415);
    });

    test('anexos de comunicado: só imagens e PDF, e o conteúdo precisa bater com o tipo', async () => {
        const storage = fakeStorage();
        const base = { bucket: 'message-attachments', path: 'm1/a' };
        assert.equal((await up(storage, { ...base, mime: 'application/pdf', bytes: PDF })).status, 201);
        assert.equal((await up(storage, { ...base, path: 'm1/b', mime: 'image/png', bytes: PNG })).status, 201);
        assert.equal((await up(storage, { ...base, path: 'm1/c', mime: 'text/html', bytes: enc('<h1>oi</h1>') })).status, 415);
        assert.equal((await up(storage, { ...base, path: 'm1/d', mime: 'application/pdf', bytes: enc('não sou pdf') })).status, 415);
    });
});

describe('download decifrado', () => {
    test('arquivo inexistente ou negado pelas policies (o Storage não distingue) vira 404', async () => {
        assert.equal((await down(fakeStorage())).status, 404);
        const negado = fakeStorage({ denyDownload: true });
        negado.objects.set('documents/rh/1_contrato.pdf', { bytes: PDF, type: 'application/pdf' });
        assert.equal((await down(negado)).status, 404);
    });

    test('objeto copiado para outro caminho não abre (422)', async () => {
        const storage = fakeStorage();
        await up(storage);
        storage.objects.set('documents/rh/outro.pdf', storage.objects.get('documents/rh/1_contrato.pdf'));
        assert.equal((await down(storage, { path: 'rh/outro.pdf' })).status, 422);
    });

    test('objeto adulterado no bucket não é entregue (422)', async () => {
        const storage = fakeStorage();
        await up(storage);
        storage.objects.get('documents/rh/1_contrato.pdf').bytes[40] ^= 0xff;
        assert.equal((await down(storage)).status, 422);
    });

    test('HTML/SVG/qualquer tipo que o navegador executaria sai como download genérico, nunca inline', async () => {
        const storage = fakeStorage();
        for (const [i, mime] of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript', 'application/x-msdownload'].entries()) {
            const path = `rh/${i}.bin`;
            assert.equal((await up(storage, { path, mime, bytes: enc('<script>alert(document.cookie)</script>') })).status, 201);
            const result = await down(storage, { path });
            assert.equal(result.contentType, 'application/octet-stream', mime);
        }
    });

    test('documento que diz ser PDF mas não é vira download genérico, não PDF', async () => {
        const storage = fakeStorage();
        await up(storage, { path: 'rh/falso.pdf', mime: 'application/pdf', bytes: enc('<html>não sou PDF</html>') });
        assert.equal((await down(storage, { path: 'rh/falso.pdf' })).contentType, 'application/octet-stream');
    });

    test('tipos inline legítimos continuam exibíveis', async () => {
        const storage = fakeStorage();
        await up(storage, { path: 'rh/foto.png', mime: 'IMAGE/PNG; charset=binary', bytes: PNG });
        assert.equal((await down(storage, { path: 'rh/foto.png' })).contentType, 'image/png');
    });

    test('arquivo antigo em claro: devolvido enquanto o backfill não terminou (com tipo saneado), recusado depois', async () => {
        const storage = fakeStorage();
        storage.objects.set('documents/rh/antigo.pdf', { bytes: PDF, type: 'application/pdf' });
        storage.objects.set('documents/rh/antigo.html', { bytes: enc('<script>x</script>'), type: 'text/html' });

        const liberado = await down(storage, { path: 'rh/antigo.pdf', allowLegacyPlaintext: true });
        assert.equal(liberado.status, 200);
        assert.equal(liberado.contentType, 'application/pdf');
        assert.deepEqual(liberado.bytes, PDF);
        assert.equal((await down(storage, { path: 'rh/antigo.html', allowLegacyPlaintext: true })).contentType, 'application/octet-stream');

        assert.equal((await down(storage, { path: 'rh/antigo.pdf', allowLegacyPlaintext: false })).status, 422);
        assert.equal((await down(storage, { path: 'rh/antigo.pdf' })).status, 422);
    });

    test('caminho inválido no download é recusado antes de consultar o Storage', async () => {
        const storage = fakeStorage();
        assert.equal((await down(storage, { path: '../segredo' })).status, 400);
        assert.equal((await down(storage, { bucket: 'avatars' })).status, 400);
    });
});

describe('utilitários', () => {
    test('safeMime normaliza e cai para octet-stream quando não é um tipo válido', () => {
        assert.equal(core.safeMime('Application/PDF; charset=x'), 'application/pdf');
        assert.equal(core.safeMime(''), 'application/octet-stream');
        assert.equal(core.safeMime('lixo'), 'application/octet-stream');
        assert.equal(core.safeMime('a/b\n<script>'), 'application/octet-stream');
        assert.equal(core.safeMime(undefined), 'application/octet-stream');
    });
});
