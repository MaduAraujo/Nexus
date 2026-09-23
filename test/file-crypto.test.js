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
        const saltAt = 4 + 1 + 'v1'.length + 1 + mime.length;
        const ivAt = saltAt + 16;
        const a = await lib.encryptFile(KEY, { ...ctx, mime, bytes: PLAIN });
        const b = await lib.encryptFile(KEY, { ...ctx, mime, bytes: PLAIN });
        assert.notDeepEqual(a.slice(saltAt, saltAt + 16), b.slice(saltAt, saltAt + 16));
        assert.notDeepEqual(a.slice(ivAt, ivAt + 12), b.slice(ivAt, ivAt + 12));
    });

    test('tamanho = cabeçalho + conteúdo + 16 bytes de autenticação', async () => {
        const mime = 'application/pdf';
        const sealed = await lib.encryptFile(KEY, { ...ctx, mime, bytes: PLAIN });
        assert.equal(sealed.length, 4 + 1 + 'v1'.length + 1 + mime.length + 16 + 12 + PLAIN.length + 16);
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

async function legacyV1(masterBase64, { bucket, path, mime, bytes }) {
    const te = new TextEncoder();
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const material = await crypto.subtle.importKey('raw', Buffer.from(masterBase64, 'base64'), 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode('nexus-file-v1') },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    const mimeBytes = te.encode(mime);
    const aad = Buffer.concat([te.encode(`${bucket}/${path}`), Buffer.from([0]), mimeBytes]);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, bytes));
    return new Uint8Array(Buffer.concat([Buffer.from('NXF1'), Buffer.from([mimeBytes.length]), mimeBytes, salt, iv, sealed]));
}

describe('rotação da chave de arquivos', () => {
    const RING_V2 = { active: 'v2', keys: { v1: KEY, v2: OTHER_KEY } };

    test('arquivo novo leva o identificador da chave ativa no cabeçalho', async () => {
        const sealed = await lib.encryptFile(RING_V2, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        assert.equal(Buffer.from(sealed.slice(0, 4)).toString(), 'NXF2');
        assert.equal(lib.fileKeyId(sealed), 'v2');
        assert.equal(lib.fileKeyId(await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN })), 'v1');
        assert.equal(lib.fileKeyId(PLAIN), null);
    });

    test('depois da troca, arquivos da chave antiga continuam abrindo e os novos usam a nova', async () => {
        const antigo = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        const novo = await lib.encryptFile(RING_V2, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        assert.deepEqual((await lib.decryptFile(RING_V2, { ...ctx, bytes: antigo })).bytes, PLAIN);
        assert.deepEqual((await lib.decryptFile(RING_V2, { ...ctx, bytes: novo })).bytes, PLAIN);
    });

    test('arquivo no formato antigo NXF1 (sem identificador) abre com a chave v1', async () => {
        const legado = await legacyV1(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        assert.equal(lib.isEncrypted(legado), true);
        assert.equal(lib.fileKeyId(legado), 'v1');
        const opened = await lib.decryptFile(RING_V2, { ...ctx, bytes: legado });
        assert.equal(opened.mime, 'application/pdf');
        assert.deepEqual(opened.bytes, PLAIN);
    });

    test('sem a chave antiga no chaveiro, o erro diz qual chave falta', async () => {
        const antigo = await lib.encryptFile(KEY, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        await assert.rejects(
            lib.decryptFile({ active: 'v2', keys: { v2: OTHER_KEY } }, { ...ctx, bytes: antigo }),
            /chave de arquivos "v1" não está configurada/
        );
    });

    test('trocar o identificador da chave no cabeçalho faz a decifragem falhar', async () => {
        const sealed = await lib.encryptFile({ active: 'v1', keys: { v1: KEY, v2: KEY } }, { ...ctx, mime: 'application/pdf', bytes: PLAIN });
        const tampered = fresh(sealed);
        tampered[6] = '2'.charCodeAt(0);
        assert.equal(lib.fileKeyId(tampered), 'v2');
        await assert.rejects(lib.decryptFile({ active: 'v1', keys: { v1: KEY, v2: KEY } }, { ...ctx, bytes: tampered }));
    });

    test('keyringFromEnv: sem variáveis novas, a chave atual vira v1 (nada muda para quem já usa)', () => {
        const env = { FILES_ENCRYPTION_KEY: KEY };
        assert.deepEqual(
            lib.keyringFromEnv((n) => env[n]),
            { active: 'v1', keys: { v1: KEY } }
        );
    });

    test('keyringFromEnv: chave nova ativa + antigas só para leitura', () => {
        const env = { FILES_ENCRYPTION_KEY: OTHER_KEY, FILES_ENCRYPTION_KEY_ID: 'v2', FILES_ENCRYPTION_OLD_KEYS: ` v1:${KEY} ` };
        assert.deepEqual(
            lib.keyringFromEnv((n) => env[n]),
            RING_V2
        );
    });

    test('keyringFromEnv: recusa configuração errada antes de tocar em qualquer arquivo', () => {
        assert.throws(() => lib.keyringFromEnv(() => undefined), /FILES_ENCRYPTION_KEY não configurada/);
        const env = (over) => (n) => ({ FILES_ENCRYPTION_KEY: KEY, ...over })[n];
        assert.throws(() => lib.keyringFromEnv(env({ FILES_ENCRYPTION_KEY_ID: 'V 2' })), /FILES_ENCRYPTION_KEY_ID/);
        assert.throws(() => lib.keyringFromEnv(env({ FILES_ENCRYPTION_OLD_KEYS: KEY })), /FILES_ENCRYPTION_OLD_KEYS/);
        assert.throws(() => lib.keyringFromEnv(env({ FILES_ENCRYPTION_OLD_KEYS: 'v0:curta' })), /32 bytes|base64/);
    });
});
