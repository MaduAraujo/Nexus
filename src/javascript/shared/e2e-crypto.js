(function (root) {
    'use strict';

    const subtle = root.crypto.subtle;
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    const CURVE = { name: 'ECDH', namedCurve: 'P-256' };
    const PBKDF2_ITERATIONS = 600000;
    const FILE_MAGIC = [0x4e, 0x58, 0x45, 0x31];
    const MESSAGE_PREFIX = 'e2e:v1:';
    const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    const b64 = (bytes) => {
        let s = '';
        for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
        return btoa(s);
    };
    const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    const random = (n) => root.crypto.getRandomValues(new Uint8Array(n));

    async function aesEncrypt(key, plain, aad) {
        const iv = random(12);
        const params = { name: 'AES-GCM', iv };
        if (aad) params.additionalData = enc.encode(aad);
        const ct = new Uint8Array(await subtle.encrypt(params, key, plain));
        return { iv: b64(iv), ct: b64(ct) };
    }

    async function aesDecrypt(key, { iv, ct }, aad) {
        const params = { name: 'AES-GCM', iv: unb64(iv) };
        if (aad) params.additionalData = enc.encode(aad);
        return new Uint8Array(await subtle.decrypt(params, key, unb64(ct)));
    }

    async function hkdfKey(secret, salt, info, usages = ['encrypt', 'decrypt']) {
        const material = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
        return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, material, { name: 'AES-GCM', length: 256 }, false, usages);
    }

    async function generateIdentity() {
        const pair = await subtle.generateKey(CURVE, true, ['deriveBits']);
        const publicJwk = await subtle.exportKey('jwk', pair.publicKey);
        const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
        return { publicJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, pkcs8 };
    }

    function importPublic(jwk) {
        return subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, CURVE, true, []);
    }

    function importPrivate(pkcs8, extractable = false) {
        return subtle.importKey('pkcs8', pkcs8, CURVE, extractable, ['deriveBits']);
    }

    async function fingerprint(jwk) {
        const digest = await subtle.digest('SHA-256', enc.encode(`${jwk.x}.${jwk.y}`));
        return b64(new Uint8Array(digest).slice(0, 12)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
    }

    async function passwordKey(password, salt, iterations = PBKDF2_ITERATIONS) {
        const material = await subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
        return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [
            'encrypt',
            'decrypt',
        ]);
    }

    async function wrapWithPassword(pkcs8, password, iterations = PBKDF2_ITERATIONS) {
        const salt = random(16);
        const box = await aesEncrypt(await passwordKey(password, salt, iterations), pkcs8, 'nexus-e2e-identity');
        return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), ...box };
    }

    async function unwrapWithPassword(wrapped, password) {
        const key = await passwordKey(password, unb64(wrapped.salt), wrapped.iter);
        return aesDecrypt(key, wrapped, 'nexus-e2e-identity');
    }

    function generateRecoveryKey() {
        const bytes = random(20);
        let bits = 0;
        let value = 0;
        let out = '';
        for (const b of bytes) {
            value = (value << 8) | b;
            bits += 8;
            while (bits >= 5) {
                out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
                bits -= 5;
            }
        }
        return out.match(/.{4}/g).join('-');
    }

    function normalizeRecoveryKey(text) {
        return String(text || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
    }

    function isValidRecoveryKey(text) {
        const norm = normalizeRecoveryKey(text);
        return norm.length === 32 && [...norm].every((c) => RECOVERY_ALPHABET.includes(c));
    }

    async function recoveryWrapKey(recovery) {
        return hkdfKey(enc.encode(normalizeRecoveryKey(recovery)), enc.encode('nexus-e2e-recovery'), 'nexus-e2e-recovery-v1');
    }

    async function wrapWithRecovery(pkcs8, recovery) {
        return { v: 1, ...(await aesEncrypt(await recoveryWrapKey(recovery), pkcs8, 'nexus-e2e-identity')) };
    }

    async function unwrapWithRecovery(wrapped, recovery) {
        return aesDecrypt(await recoveryWrapKey(recovery), wrapped, 'nexus-e2e-identity');
    }

    async function sealTo(recipientJwk, payload, context) {
        const recipient = await importPublic(recipientJwk);
        const eph = await subtle.generateKey(CURVE, true, ['deriveBits']);
        const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256));
        const ephRaw = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
        const key = await hkdfKey(shared, ephRaw, `nexus-e2e-seal-v1:${context}`);
        return { epk: b64(ephRaw), ...(await aesEncrypt(key, payload, context)) };
    }

    async function openSealed(privateKey, sealed, context) {
        const ephRaw = unb64(sealed.epk);
        const eph = await subtle.importKey('raw', ephRaw, CURVE, false, []);
        const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: eph }, privateKey, 256));
        const key = await hkdfKey(shared, ephRaw, `nexus-e2e-seal-v1:${context}`);
        return aesDecrypt(key, sealed, context);
    }

    function importSymmetric(raw) {
        return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    const messageAad = (channelId, senderId, keyVersion) => `nexus-e2e-msg:${channelId}:${senderId}:${keyVersion}`;

    async function encryptMessage(channelKeyRaw, text, { channelId, senderId, keyVersion }) {
        const box = await aesEncrypt(await importSymmetric(channelKeyRaw), enc.encode(text), messageAad(channelId, senderId, keyVersion));
        return `${MESSAGE_PREFIX}${keyVersion}:${box.iv}:${box.ct}`;
    }

    function isEncryptedMessage(content) {
        return typeof content === 'string' && content.startsWith(MESSAGE_PREFIX);
    }

    function messageKeyVersion(content) {
        const version = Number(content.slice(MESSAGE_PREFIX.length).split(':')[0]);
        return Number.isInteger(version) && version > 0 ? version : null;
    }

    async function decryptMessage(channelKeyRaw, content, { channelId, senderId }) {
        const [version, iv, ct] = content.slice(MESSAGE_PREFIX.length).split(':');
        return dec.decode(await aesDecrypt(await importSymmetric(channelKeyRaw), { iv, ct }, messageAad(channelId, senderId, Number(version))));
    }

    const fileAad = (bucket, path, mime) => `nexus-e2e-file:${bucket}/${path}:${mime}`;

    async function encryptFile(bytes, { bucket, path, mime, recipients }) {
        if (!recipients.length) throw new Error('arquivo cifrado sem destinatários');
        const dek = random(32);
        const entries = [];
        for (const r of recipients) entries.push({ fp: r.fingerprint, ...(await sealTo(r.publicJwk, dek, `file:${bucket}/${path}`)) });
        const iv = random(12);
        const ct = new Uint8Array(
            await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(fileAad(bucket, path, mime)) }, await importSymmetric(dek), bytes)
        );
        const header = enc.encode(JSON.stringify({ mime, keys: entries, iv: b64(iv) }));
        const out = new Uint8Array(4 + 4 + header.length + ct.length);
        out.set(FILE_MAGIC, 0);
        new DataView(out.buffer).setUint32(4, header.length);
        out.set(header, 8);
        out.set(ct, 8 + header.length);
        return out;
    }

    function isEncryptedFile(bytes) {
        return bytes.length > 8 && FILE_MAGIC.every((b, i) => bytes[i] === b);
    }

    function fileHeader(bytes) {
        if (!isEncryptedFile(bytes)) throw new Error('não é um arquivo cifrado de ponta a ponta');
        const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
        if (len > 64 * 1024 || bytes.length < 8 + len + 16) throw new Error('cabeçalho inválido');
        return { header: JSON.parse(dec.decode(bytes.subarray(8, 8 + len))), bodyOffset: 8 + len };
    }

    async function decryptFile(bytes, { bucket, path, identities }) {
        const { header, bodyOffset } = fileHeader(bytes);
        for (const id of identities) {
            const entry = header.keys.find((k) => k.fp === id.fingerprint);
            if (!entry) continue;
            const dek = await openSealed(id.privateKey, entry, `file:${bucket}/${path}`);
            const plain = await subtle.decrypt(
                { name: 'AES-GCM', iv: unb64(header.iv), additionalData: enc.encode(fileAad(bucket, path, header.mime)) },
                await importSymmetric(dek),
                bytes.subarray(bodyOffset)
            );
            return { mime: header.mime, bytes: new Uint8Array(plain) };
        }
        throw new Error('este arquivo não foi cifrado para nenhuma das suas chaves');
    }

    function fileRecipients(bytes) {
        return fileHeader(bytes).header.keys.map((k) => k.fp);
    }

    const api = {
        PBKDF2_ITERATIONS,
        b64,
        unb64,
        random,
        generateIdentity,
        importPublic,
        importPrivate,
        fingerprint,
        wrapWithPassword,
        unwrapWithPassword,
        generateRecoveryKey,
        normalizeRecoveryKey,
        isValidRecoveryKey,
        wrapWithRecovery,
        unwrapWithRecovery,
        sealTo,
        openSealed,
        encryptMessage,
        decryptMessage,
        isEncryptedMessage,
        messageKeyVersion,
        encryptFile,
        decryptFile,
        isEncryptedFile,
        fileRecipients,
    };

    root.NexusE2ECrypto = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
