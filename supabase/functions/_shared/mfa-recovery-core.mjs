const CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;

export function normalizeRecoveryCode(value) {
    return String(value || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

export function isValidRecoveryCode(value) {
    return CODE_RE.test(normalizeRecoveryCode(value));
}

const INVALID = { status: 400, body: { error: 'Código de recuperação inválido ou já usado.' } };

export async function recoverWithCode({ userId, code, rateLimit, verify, reportFailure, listFactors, deleteFactor, complete }) {
    if (!(await rateLimit())) {
        return { status: 429, body: { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' } };
    }

    if (!isValidRecoveryCode(code) || !(await verify(userId, normalizeRecoveryCode(code)))) {
        await reportFailure();
        return INVALID;
    }

    const factors = await listFactors(userId);
    for (const factor of factors) {
        if (factor.factor_type !== 'totp') continue;
        const ok = await deleteFactor(userId, factor.id);
        if (!ok) return { status: 500, body: { error: 'Não foi possível desvincular o app autenticador. Tente de novo.' } };
    }

    await complete(userId);
    return { status: 200, body: { ok: true } };
}
