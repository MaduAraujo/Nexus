const MAGIC_V1 = new Uint8Array([0x4e, 0x58, 0x46, 0x31]);
const MAGIC_V2 = new Uint8Array([0x4e, 0x58, 0x46, 0x32]);
const MAGIC_LEN = 4;
const SALT_LEN = 16;
const IV_LEN = 12;
const MAX_MIME_LEN = 100;
const KEY_BYTES = 32;
const HKDF_INFO = 'nexus-file-v1';
const LEGACY_KID = 'v1';
const KID_RE = /^[a-z0-9_-]{1,32}$/;

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

export function toKeyring(value) {
    if (typeof value === 'string') return { active: LEGACY_KID, keys: { [LEGACY_KID]: value } };
    if (!value || !KID_RE.test(value.active || '') || !value.keys?.[value.active]) throw new Error('chaveiro de arquivos inválido');
    return value;
}

export function keyringFromEnv(get) {
    const current = get('FILES_ENCRYPTION_KEY');
    if (!current) throw new Error('FILES_ENCRYPTION_KEY não configurada');
    const active = String(get('FILES_ENCRYPTION_KEY_ID') || LEGACY_KID).trim();
    if (!KID_RE.test(active)) throw new Error('FILES_ENCRYPTION_KEY_ID deve ter só letras minúsculas, números, - ou _ (ex.: v2)');

    const keys = {};
    for (const entry of String(get('FILES_ENCRYPTION_OLD_KEYS') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const sep = entry.indexOf(':');
        const kid = entry.slice(0, sep);
        if (sep < 1 || !KID_RE.test(kid)) throw new Error('FILES_ENCRYPTION_OLD_KEYS deve estar no formato "v1:BASE64,v2:BASE64"');
        keys[kid] = entry.slice(sep + 1);
    }
    keys[active] = current;
    for (const key of Object.values(keys)) decodeMasterKey(key);
    return { active, keys };
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

function additionalData(bucket, path, mimeBytes, kidBytes) {
    const parts = [encoder.encode(`${bucket}/${path}`), mimeBytes];
    if (kidBytes) parts.push(kidBytes);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0) + parts.length - 1);
    let offset = 0;
    parts.forEach((part, i) => {
        if (i > 0) out[offset++] = 0;
        out.set(part, offset);
        offset += part.length;
    });
    return out;
}

const startsWith = (bytes, magic) => magic.every((b, i) => bytes[i] === b);

export function isEncrypted(bytes) {
    return bytes.length > MAGIC_LEN && (startsWith(bytes, MAGIC_V1) || startsWith(bytes, MAGIC_V2));
}

function parseHeader(bytes) {
    if (!isEncrypted(bytes)) throw new Error('não é um arquivo cifrado');
    let offset = MAGIC_LEN;
    let kidBytes = null;
    if (startsWith(bytes, MAGIC_V2)) {
        const kidLen = bytes[offset++];
        if (kidLen === 0 || kidLen > 32 || bytes.length < offset + kidLen) throw new Error('cabeçalho inválido');
        kidBytes = bytes.slice(offset, offset + kidLen);
        offset += kidLen;
    }
    const mimeLen = bytes[offset++];
    if (mimeLen === 0 || mimeLen > MAX_MIME_LEN || bytes.length < offset + mimeLen + SALT_LEN + IV_LEN + 16) throw new Error('cabeçalho inválido');
    const mimeBytes = bytes.slice(offset, offset + mimeLen);
    offset += mimeLen;
    const salt = bytes.slice(offset, offset + SALT_LEN);
    offset += SALT_LEN;
    const iv = bytes.slice(offset, offset + IV_LEN);
    offset += IV_LEN;
    return { kid: kidBytes ? decoder.decode(kidBytes) : LEGACY_KID, kidBytes, mimeBytes, salt, iv, sealed: bytes.slice(offset) };
}

export function fileKeyId(bytes) {
    try {
        return parseHeader(bytes).kid;
    } catch {
        return null;
    }
}

export async function encryptFile(keyOrKeyring, { bucket, path, mime, bytes }) {
    const ring = toKeyring(keyOrKeyring);
    const kidBytes = encoder.encode(ring.active);
    const mimeBytes = encoder.encode(mime);
    if (mimeBytes.length === 0 || mimeBytes.length > MAX_MIME_LEN) throw new Error('mime inválido');
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveFileKey(decodeMasterKey(ring.keys[ring.active]), salt);
    const sealed = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(bucket, path, mimeBytes, kidBytes) }, key, bytes)
    );

    const header = MAGIC_LEN + 1 + kidBytes.length + 1 + mimeBytes.length + SALT_LEN + IV_LEN;
    const out = new Uint8Array(header + sealed.length);
    let offset = 0;
    out.set(MAGIC_V2, offset);
    offset += MAGIC_LEN;
    out[offset++] = kidBytes.length;
    out.set(kidBytes, offset);
    offset += kidBytes.length;
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

export async function decryptFile(keyOrKeyring, { bucket, path, bytes }) {
    const ring = toKeyring(keyOrKeyring);
    const header = parseHeader(bytes);
    const master = ring.keys[header.kid];
    if (!master) throw new Error(`chave de arquivos "${header.kid}" não está configurada`);

    const key = await deriveFileKey(decodeMasterKey(master), header.salt);
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: header.iv, additionalData: additionalData(bucket, path, header.mimeBytes, header.kidBytes) },
        key,
        header.sealed
    );
    return { mime: decoder.decode(header.mimeBytes), bytes: new Uint8Array(plain) };
}
