const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let core;
before(async () => {
    core = await import('../supabase/functions/_shared/mfa-recovery-core.mjs');
});

function deps(overrides = {}) {
    const calls = [];
    const d = {
        userId: 'u1',
        code: 'abcde-fgh23',
        rateLimit: async () => (calls.push('rateLimit'), true),
        verify: async (userId, code) => (calls.push(`verify:${userId}:${code}`), true),
        reportFailure: async () => calls.push('reportFailure'),
        listFactors: async () => (
            calls.push('listFactors'),
            [
                { id: 'f-totp', factor_type: 'totp' },
                { id: 'f-phone', factor_type: 'phone' },
            ]
        ),
        deleteFactor: async (userId, id) => (calls.push(`delete:${id}`), true),
        complete: async (userId) => calls.push(`complete:${userId}`),
        ...overrides,
    };
    return { d, calls };
}

describe('recoverWithCode', () => {
    test('código certo: confere, remove só o fator TOTP e só então apaga os códigos e alerta', async () => {
        const { d, calls } = deps();
        const res = await core.recoverWithCode(d);
        assert.deepEqual(res, { status: 200, body: { ok: true } });
        assert.deepEqual(calls, ['rateLimit', 'verify:u1:ABCDEFGH23', 'listFactors', 'delete:f-totp', 'complete:u1']);
    });

    test('código errado: conta como falha de MFA e não mexe no fator', async () => {
        const { d, calls } = deps({ verify: async () => false });
        const res = await core.recoverWithCode(d);
        assert.equal(res.status, 400);
        assert.deepEqual(calls, ['rateLimit', 'reportFailure']);
    });

    test('código mal formatado nem chega ao banco, mas conta como falha', async () => {
        const { d, calls } = deps({ code: '123456' });
        const res = await core.recoverWithCode(d);
        assert.equal(res.status, 400);
        assert.deepEqual(calls, ['rateLimit', 'reportFailure']);
    });

    test('limite de tentativas estourado: 429 antes de conferir qualquer coisa', async () => {
        const { d, calls } = deps({ rateLimit: async () => false });
        const res = await core.recoverWithCode(d);
        assert.equal(res.status, 429);
        assert.deepEqual(calls, []);
    });

    test('falha ao remover o fator: 500 e os códigos continuam válidos (complete não roda)', async () => {
        const { d, calls } = deps({ deleteFactor: async () => false });
        const res = await core.recoverWithCode(d);
        assert.equal(res.status, 500);
        assert.ok(!calls.some((c) => c.startsWith('complete')));
    });
});

describe('formato do código', () => {
    test('normaliza e valida como o front', () => {
        assert.equal(core.normalizeRecoveryCode(' abcde-fgh23 '), 'ABCDEFGH23');
        assert.equal(core.isValidRecoveryCode('ABCDE-FGH23'), true);
        assert.equal(core.isValidRecoveryCode('ABCDO-FGH23'), false);
        assert.equal(core.isValidRecoveryCode(null), false);
    });
});
