const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fakeClient } = require('../test-support/fake-storage.js');

let script;
let lib;
before(async () => {
    script = await import('../scripts/rotate-file-key.mjs');
    lib = await import('../supabase/functions/_shared/file-crypto.mjs');
});

const OLD = crypto.randomBytes(32).toString('base64');
const NEW = crypto.randomBytes(32).toString('base64');
const RING = { active: 'v2', keys: { v1: OLD, v2: NEW } };
const ONLY_NEW = { active: 'v2', keys: { v2: NEW } };
const enc = (text) => new TextEncoder().encode(text);
const PDF = enc('%PDF-1.4 contrato confidencial');

const sealedWith = (key, bucket, path, bytes = PDF, mime = 'application/pdf') => lib.encryptFile(key, { bucket, path, mime, bytes });
const run = (client, over = {}) => script.rotateFileKey({ client, ring: RING, log: () => {}, ...over });
const stored = (client, full) => client.objects.get(full).bytes;
const object = async (key, bucket, path, bytes, mime) => ({ bytes: await sealedWith(key, bucket, path, bytes, mime), mime: 'application/octet-stream' });

describe('rotação da chave dos arquivos do Storage', () => {
    test('recifra com a chave nova o que estava na antiga, mantendo conteúdo e tipo', async () => {
        const client = fakeClient({
            'documents/rh/a.pdf': await object(OLD, 'documents', 'rh/a.pdf'),
            'ponto-selfies/u1/s.jpg': await object(OLD, 'ponto-selfies', 'u1/s.jpg', enc('jpeg'), 'image/jpeg'),
        });
        const totals = await run(client);
        assert.deepEqual(totals, { rotated: 2, current: 0, plaintext: 0, failed: 0 });

        const a = stored(client, 'documents/rh/a.pdf');
        assert.equal(lib.fileKeyId(a), 'v2');
        const opened = await lib.decryptFile(ONLY_NEW, { bucket: 'documents', path: 'rh/a.pdf', bytes: a });
        assert.deepEqual(opened.bytes, PDF);
        assert.equal(opened.mime, 'application/pdf');
        const selfie = await lib.decryptFile(ONLY_NEW, { bucket: 'ponto-selfies', path: 'u1/s.jpg', bytes: stored(client, 'ponto-selfies/u1/s.jpg') });
        assert.equal(selfie.mime, 'image/jpeg');
    });

    test('é idempotente: o que já está na chave nova não é regravado', async () => {
        const client = fakeClient({ 'documents/a.pdf': await object(RING, 'documents', 'a.pdf') });
        const totals = await run(client);
        assert.deepEqual(totals, { rotated: 0, current: 1, plaintext: 0, failed: 0 });
        assert.equal(client.uploads.length, 0);
    });

    test('simulação não grava nada', async () => {
        const client = fakeClient({ 'documents/a.pdf': await object(OLD, 'documents', 'a.pdf') });
        const totals = await run(client, { dryRun: true });
        assert.equal(totals.rotated, 1);
        assert.equal(client.uploads.length, 0);
        assert.equal(lib.fileKeyId(stored(client, 'documents/a.pdf')), 'v1');
    });

    test('arquivo em claro não é tocado e é contado à parte', async () => {
        const client = fakeClient({ 'documents/a.pdf': { bytes: PDF, mime: 'application/pdf' } });
        const totals = await run(client);
        assert.deepEqual(totals, { rotated: 0, current: 0, plaintext: 1, failed: 0 });
        assert.equal(client.uploads.length, 0);
    });

    test('arquivo de uma chave que não está no chaveiro falha sem ser regravado, e os outros seguem', async () => {
        const perdida = { active: 'v0', keys: { v0: crypto.randomBytes(32).toString('base64') } };
        const client = fakeClient({
            'documents/a.pdf': await object(perdida, 'documents', 'a.pdf'),
            'documents/b.pdf': await object(OLD, 'documents', 'b.pdf'),
        });
        const totals = await run(client);
        assert.deepEqual(totals, { rotated: 1, current: 0, plaintext: 0, failed: 1 });
        assert.equal(lib.fileKeyId(stored(client, 'documents/a.pdf')), 'v0');
    });

    test('gravação que não confere ao reler é contada como falha', async () => {
        const client = fakeClient({ 'documents/a.pdf': await object(OLD, 'documents', 'a.pdf') }, { corruptOnUpload: true });
        const totals = await run(client);
        assert.equal(totals.failed, 1);
    });

    test('nunca mexe no bucket público de avatares', async () => {
        const client = fakeClient({ 'avatars/u1.png': await object(OLD, 'avatars', 'u1.png') });
        const totals = await run(client);
        assert.deepEqual(totals, { rotated: 0, current: 0, plaintext: 0, failed: 0 });
    });
});
