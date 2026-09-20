const crypto = require('node:crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input) {
    let bits = '';
    for (const ch of input.replace(/=+$/, '').toUpperCase()) {
        const idx = BASE32.indexOf(ch);
        if (idx < 0) throw new Error(`Caractere base32 inválido: ${ch}`);
        bits += idx.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
}

function totp(secretBase32, { time = Date.now(), step = 30, digits = 6 } = {}) {
    const counter = Math.floor(time / 1000 / step);
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
}

module.exports = { totp, base32Decode };