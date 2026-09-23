const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const E2E = require('../src/javascript/shared/e2e-crypto.js');

const enc = (t) => new TextEncoder().encode(t);
const dec = (b) => new TextDecoder().decode(b);
const FAST = 1000;

async function identity() {
    const id = await E2E.generateIdentity();
    return { ...id, fingerprint: await E2E.fingerprint(id.publicJwk), privateKey: await E2E.importPrivate(id.pkcs8) };
}

describe('identidade (par de chaves por pessoa)', () => {
    test('a chave privada embrulhada pela senha só volta com a mesma senha', async () => {
        const id = await E2E.generateIdentity();
        const wrapped = await E2E.wrapWithPassword(id.pkcs8, 'senha-certa-123', FAST);
        assert.deepEqual(await E2E.unwrapWithPassword(wrapped, 'senha-certa-123'), id.pkcs8);
        await assert.rejects(E2E.unwrapWithPassword(wrapped, 'senha-errada-123'));
        assert.ok(!JSON.stringify(wrapped).includes(E2E.b64(id.pkcs8)));
    });

    test('o padrão usa PBKDF2 com 600 mil iterações', async () => {
        const id = await E2E.generateIdentity();
        const wrapped = await E2E.wrapWithPassword(id.pkcs8, 'x');
        assert.equal(wrapped.iter, 600000);
        assert.equal(wrapped.kdf, 'PBKDF2-SHA256');
    });

    test('chave de recuperação: 160 bits em 8 grupos, aceita minúsculas e sem hífen, e abre a chave privada', async () => {
        const recovery = E2E.generateRecoveryKey();
        assert.match(recovery, /^([A-HJ-NP-Z2-9]{4}-){7}[A-HJ-NP-Z2-9]{4}$/);
        assert.notEqual(recovery, E2E.generateRecoveryKey());
        assert.equal(E2E.isValidRecoveryKey(recovery.toLowerCase().replace(/-/g, ' ')), true);
        assert.equal(E2E.isValidRecoveryKey('AAAA-BBBB'), false);

        const id = await E2E.generateIdentity();
        const wrapped = await E2E.wrapWithRecovery(id.pkcs8, recovery);
        assert.deepEqual(await E2E.unwrapWithRecovery(wrapped, recovery.toLowerCase()), id.pkcs8);
        await assert.rejects(E2E.unwrapWithRecovery(wrapped, E2E.generateRecoveryKey()));
    });

    test('a impressão digital é estável para a mesma chave pública e muda entre chaves', async () => {
        const a = await E2E.generateIdentity();
        const b = await E2E.generateIdentity();
        assert.equal(await E2E.fingerprint(a.publicJwk), await E2E.fingerprint({ ...a.publicJwk }));
        assert.notEqual(await E2E.fingerprint(a.publicJwk), await E2E.fingerprint(b.publicJwk));
    });
});

describe('envelope para uma chave pública (ECDH + HKDF + AES-GCM)', () => {
    test('só a chave privada do destinatário abre, e só no mesmo contexto', async () => {
        const ana = await identity();
        const bia = await identity();
        const sealed = await E2E.sealTo(ana.publicJwk, enc('segredo'), 'chan:1');
        assert.equal(dec(await E2E.openSealed(ana.privateKey, sealed, 'chan:1')), 'segredo');
        await assert.rejects(E2E.openSealed(bia.privateKey, sealed, 'chan:1'));
        await assert.rejects(E2E.openSealed(ana.privateKey, sealed, 'chan:2'));
    });
});

describe('mensagens diretas', () => {
    const channelKey = E2E.random(32);
    const ctx = { channelId: 'c1', senderId: 'e1', keyVersion: 2 };

    test('ida e volta; o que vai ao banco não contém o texto', async () => {
        const stored = await E2E.encryptMessage(channelKey, 'oi, tudo bem? salário 5.000', ctx);
        assert.equal(E2E.isEncryptedMessage(stored), true);
        assert.ok(!stored.includes('salário'));
        assert.equal(await E2E.decryptMessage(channelKey, stored, ctx), 'oi, tudo bem? salário 5.000');
    });

    test('mensagem copiada para outra conversa ou atribuída a outra pessoa não abre', async () => {
        const stored = await E2E.encryptMessage(channelKey, 'x', ctx);
        await assert.rejects(E2E.decryptMessage(channelKey, stored, { ...ctx, channelId: 'c2' }));
        await assert.rejects(E2E.decryptMessage(channelKey, stored, { ...ctx, senderId: 'e2' }));
        await assert.rejects(E2E.decryptMessage(E2E.random(32), stored, ctx));
    });

    test('a versão da chave da conversa vai junto e também é autenticada', async () => {
        const stored = await E2E.encryptMessage(channelKey, 'x', ctx);
        assert.equal(E2E.messageKeyVersion(stored), 2);
        const forged = stored.replace('e2e:v1:2:', 'e2e:v1:3:');
        await assert.rejects(E2E.decryptMessage(channelKey, forged, ctx));
    });

    test('mensagens antigas (texto normal) não são confundidas com cifradas', () => {
        assert.equal(E2E.isEncryptedMessage('olá'), false);
        assert.equal(E2E.isEncryptedMessage(null), false);
    });
});

describe('arquivos', () => {
    const where = { bucket: 'documents', path: 'e1/1700_rg.pdf', mime: 'application/pdf' };
    const PDF = enc('%PDF-1.7 RG de Fulana 12.345.678-9');

    test('colaborador e RH abrem; terceiro não; o arquivo não contém o original', async () => {
        const colab = await identity();
        const rh = await identity();
        const outro = await identity();
        const sealed = await E2E.encryptFile(PDF, { ...where, recipients: [colab, rh] });

        assert.equal(E2E.isEncryptedFile(sealed), true);
        assert.ok(!Buffer.from(sealed).toString('latin1').includes('12.345.678'));
        assert.deepEqual(E2E.fileRecipients(sealed).sort(), [colab.fingerprint, rh.fingerprint].sort());

        for (const who of [colab, rh]) {
            const opened = await E2E.decryptFile(sealed, { bucket: where.bucket, path: where.path, identities: [who] });
            assert.equal(opened.mime, 'application/pdf');
            assert.deepEqual(opened.bytes, PDF);
        }
        await assert.rejects(E2E.decryptFile(sealed, { bucket: where.bucket, path: where.path, identities: [outro] }), /nenhuma das suas chaves/);
    });

    test('arquivo movido para outro caminho não abre, e byte alterado é detectado', async () => {
        const colab = await identity();
        const sealed = await E2E.encryptFile(PDF, { ...where, recipients: [colab] });
        await assert.rejects(E2E.decryptFile(sealed, { bucket: where.bucket, path: 'e2/rg.pdf', identities: [colab] }));
        const tampered = new Uint8Array(sealed);
        tampered[tampered.length - 1] ^= 1;
        await assert.rejects(E2E.decryptFile(tampered, { bucket: where.bucket, path: where.path, identities: [colab] }));
    });

    test('arquivo sem destinatário é recusado; arquivo que não é E2E é identificado', async () => {
        await assert.rejects(E2E.encryptFile(PDF, { ...where, recipients: [] }));
        assert.equal(E2E.isEncryptedFile(PDF), false);
        assert.equal(E2E.isEncryptedFile(enc('NXF2....')), false);
    });

    test('a pessoa com duas chaves (pessoal e do RH) abre pela que estiver no arquivo', async () => {
        const pessoal = await identity();
        const orgRh = await identity();
        const colab = await identity();
        const sealed = await E2E.encryptFile(PDF, { ...where, recipients: [colab, orgRh] });
        const opened = await E2E.decryptFile(sealed, { bucket: where.bucket, path: where.path, identities: [pessoal, orgRh] });
        assert.deepEqual(opened.bytes, PDF);
    });
});
