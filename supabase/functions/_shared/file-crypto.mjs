const MAGIC = new Uint8Array([0x4e, 0x58, 0x46, 0x31]);
const SALT_LEN = 16;
const IV_LEN = 12;
const MAX_MIME_LEN = 100;
const KEY_BYTES = 32;
const HKDF_INFO = 'nexus-file-v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function decodeMasterKey(base64) {
    let raw;
    try {
        raw = atob(String(base64 || '').trim());
    } catch {
        throw new Error('FILES_ENCRYPTION_KEY não é base64 válido');
    }
    if (raw.length !== KEY_BYTES) throw new Error(`FILES_ENCRYPTION_KEY deve ter ${KEY_BYTES} bytes (base64 de 32 bytes aleatórios)`);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function deriveFileKey(masterKey, salt) {
    const material = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(HKDF_INFO) },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function additionalData(bucket, path, mimeBytes) {
    const location = encoder.encode(`${bucket}/${path}`);
    const out = new Uint8Array(location.length + 1 + mimeBytes.length);
    out.set(location, 0);
    out[location.length] = 0;
    out.set(mimeBytes, location.length + 1);
    return out;
}

export function isEncrypted(bytes) {
    return bytes.length > MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}

export async function encryptFile(masterKeyBase64, { bucket, path, mime, bytes }) {
    const mimeBytes = encoder.encode(mime);
    if (mimeBytes.length === 0 || mimeBytes.length > MAX_MIME_LEN) throw new Error('mime inválido');
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveFileKey(decodeMasterKey(masterKeyBase64), salt);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(bucket, path, mimeBytes) }, key, bytes));

    const header = MAGIC.length + 1 + mimeBytes.length + SALT_LEN + IV_LEN;
    const out = new Uint8Array(header + sealed.length);
    let offset = 0;
    out.set(MAGIC, offset);
    offset += MAGIC.length;
    out[offset++] = mimeBytes.length;
    out.set(mimeBytes, offset);
    offset += mimeBytes.length;
    out.set(salt, offset);
    offset += SALT_LEN;
    out.set(iv, offset);
    offset += IV_LEN;
    out.set(sealed, offset);
    return out;
}

export async function decryptFile(masterKeyBase64, { bucket, path, bytes }) {
    if (!isEncrypted(bytes)) throw new Error('não é um arquivo cifrado');
    let offset = MAGIC.length;
    const mimeLen = bytes[offset++];
    if (mimeLen === 0 || mimeLen > MAX_MIME_LEN || bytes.length < offset + mimeLen + SALT_LEN + IV_LEN + 16) throw new Error('cabeçalho inválido');
    const mimeBytes = bytes.slice(offset, offset + mimeLen);
    offset += mimeLen;
    const salt = bytes.slice(offset, offset + SALT_LEN);
    offset += SALT_LEN;
    const iv = bytes.slice(offset, offset + IV_LEN);
    offset += IV_LEN;

    const key = await deriveFileKey(decodeMasterKey(masterKeyBase64), salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: additionalData(bucket, path, mimeBytes) }, key, bytes.slice(offset));
    return { mime: decoder.decode(mimeBytes), bytes: new Uint8Array(plain) };
}
