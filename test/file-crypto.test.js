const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

let lib;
before(async () => {
    lib = await import('../supabase/functions/_shared/file-crypto.mjs');
});

const KEY = crypto.randomBytes(32).toString('base64');
const OTHER_KEY = crypto.randomBytes(32).toString('base64');
const PLAIN = new TextEncoder().encode('%PDF-1.7 salário de Fulana: R$ 12.345,67 — CPF 123.456.789-00');
const ctx = { bucket: 'documents', path: 'rh/1700000000_contrato.pdf' };

const fresh = (bytes) => new Uint8Array(bytes);

describe('cifragem de arquivos (AES-256-GCM)', () => {
    test('ida e volta devolve os mesmos bytes e o mesmo tipo', async () => {
        const sealed = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        const opened = await lib.decryptFile(KEY, { ...ctx, bytes: sealed });
        assert.equal(opened.mime, 'application/pdf');
        assert.deepEqual(opened.bytes, PLAIN);
    });

    test('o que vai para o bucket não contém o conteúdo original e é identificado como arquivo Nexus', async () => {
        const sealed = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        assert.equal(lib.isEncrypted(sealed), true);
        assert.equal(lib.isEncrypted(PLAIN), false);
        const text = Buffer.from(sealed).toString('latin1');
        assert.ok(!text.includes('salário'));
        assert.ok(!text.includes('123.456.789'));
        assert.ok(!text.includes('%PDF'));
    });

    test('duas cifragens do mesmo arquivo dão resultados diferentes (salt e iv aleatórios)', async () => {
        const a = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        const b = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        assert.notDeepEqual(a, b);
    });

    test('salt e iv são aleatórios a cada arquivo (nunca repetem)', async () => {
        const mime = 'application/pdf';
        const saltAt = 4 + 1 + mime.length;
        const ivAt = saltAt + 16;
        const a = await lib.encryptFile(KEY, { ...ctx, mime, bytes: PLAIN });
        const b = await lib.encryptFile(KEY, { ...ctx, mime, bytes: PLAIN });
        assert.notDeepEqual(a.slice(saltAt, saltAt + 16), b.slice(saltAt, saltAt + 16));
        assert.notDeepEqual(a.slice(ivAt, ivAt + 12), b.slice(ivAt, ivAt + 12));
    });

    test('tamanho = cabeçalho + conteúdo + 16 bytes de autenticação', async () => {
        const mime = 'application/pdf';
        const sealed = await lib.encryptFile(KEY, { ...ctx, mime, bytes: PLAIN });
        assert.equal(sealed.length, 4 + 1 + mime.length + 16 + 12 + PLAIN.length + 16);
    });

    test('arquivo vazio também cifra e decifra', async () => {
        const sealed = await lib.encryptFile(KEY, { ...ctx, mime: 'text/plain', bytes: new Uint8Array(0) });
        assert.equal((await lib.decryptFile(KEY, { ...ctx, bytes: sealed })).bytes.length, 0);
    });

    test('chave errada não abre', async () => {
        const sealed = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        await assert.rejects(lib.decryptFile(OTHER_KEY, { ...ctx, bytes: sealed }));
    });

    test('o objeto copiado para outro caminho ou outro bucket não abre (o caminho entra na autenticação)', async () => {
        const sealed = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        await assert.rejects(lib.decryptFile(KEY, { bucket: 'documents', path: 'rh/outro.pdf', bytes: sealed }));
        await assert.rejects(lib.decryptFile(KEY, { bucket: 'message-attachments', path: ctx.path, bytes: sealed }));
    });

    test('qualquer byte alterado (conteúdo, tag, iv, salt ou tipo) faz a decifragem falhar', async () => {
        const sealed = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        const mimeAt = 5;
        const saltAt = 5 + 15;
        const ivAt = saltAt + 16;
        for (const position of [mimeAt, saltAt, ivAt, sealed.length - 1, sealed.length - 20]) {
            const tampered = fresh(sealed);
            tampered[position] ^= 0x01;
            await assert.rejects(lib.decryptFile(KEY, { ...ctx, bytes: tampered }), `byte ${position}`);
        }
    });

    test('arquivo truncado ou que não é nosso é recusado', async () => {
        const sealed = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        await assert.rejects(lib.decryptFile(KEY, { ...ctx, bytes: sealed.slice(0, 30) }));
        await assert.rejects(lib.decryptFile(KEY, { ...ctx, bytes: sealed.slice(0, sealed.length - 5) }));
        await assert.rejects(lib.decryptFile(KEY, { ...ctx, bytes: PLAIN }), /não é um arquivo cifrado/);
    });

    test('a chave mestra precisa ser base64 de 32 bytes', () => {
        assert.equal(lib.decodeMasterKey(KEY).length, 32);
        assert.throws(() => lib.decodeMasterKey(Buffer.from('curta').toString('base64')), /32 bytes/);
        assert.throws(() => lib.decodeMasterKey('***não é base64***'), /base64/);
        assert.throws(() => lib.decodeMasterKey(''), /32 bytes/);
    });

    test('tipo vazio ou longo demais é recusado ao cifrar', async () => {
        await assert.rejects(lib.encryptFile(KEY, { ...ctx, mime: '', bytes: PLAIN }));
        await assert.rejects(lib.encryptFile(KEY, { ...ctx, mime: 'a/' + 'b'.repeat(120), bytes: PLAIN }));
    });
});
