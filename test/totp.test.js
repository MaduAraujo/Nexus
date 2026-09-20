const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { totp } = require('../test-support/totp.js');

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('gerador TOTP dos testes (RFC 6238)', () => {
    for (const [seconds, expected] of [
        [59, '287082'],
        [1111111109, '081804'],
        [1111111111, '050471'],
        [1234567890, '005924'],
        [2000000000, '279037'],
    ]) {
        test(`t=${seconds}s → ${expected}`, () => {
            assert.equal(totp(RFC_SECRET, { time: seconds * 1000 }), expected);
        });
    }

    test('aceita segredo em minúsculas e com padding', () => {
        assert.equal(totp(RFC_SECRET.toLowerCase() + '====', { time: 59_000 }), '287082');
    });

    test('rejeita caractere fora do alfabeto base32', () => {
        assert.throws(() => totp('ABC1', { time: 0 }), /base32/);
    });
});
