window.NexusMfa = (function () {
    const REQUIRED_PROFILES = ['Administrador'];
    const CODE_LENGTH = 6;
    const RECOVERY_RE = /^[A-HJ-NP-Z2-9]{10}$/;

    function isRequiredFor(profileType) {
        return REQUIRED_PROFILES.includes(profileType);
    }

    function decide(level, profileType) {
        const current = level?.currentLevel;
        const next = level?.nextLevel;
        if (current === 'aal2') return 'ok';
        if (next === 'aal2') return 'challenge';
        return isRequiredFor(profileType) ? 'enroll' : 'ok';
    }

    async function assurance(client) {
        const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error || !data) return null;
        return data;
    }

    function normalizeCode(value) {
        return String(value || '').replace(/\D/g, '');
    }

    function isValidCode(value) {
        return normalizeCode(value).length === CODE_LENGTH;
    }

    function normalizeRecoveryCode(value) {
        return String(value || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
    }

    function isValidRecoveryCode(value) {
        return RECOVERY_RE.test(normalizeRecoveryCode(value));
    }

    async function listFactors(client) {
        const { data, error } = await client.auth.mfa.listFactors();
        if (error) return { verified: [], pending: [], error };
        const all = data?.all || [];
        const totp = all.filter((f) => f.factor_type === 'totp');
        return {
            verified: totp.filter((f) => f.status === 'verified'),
            pending: totp.filter((f) => f.status !== 'verified'),
            error: null,
        };
    }

    async function discardPending(client) {
        const { pending } = await listFactors(client);
        for (const factor of pending) await client.auth.mfa.unenroll({ factorId: factor.id });
    }

    async function startEnroll(client) {
        await discardPending(client);
        const { data, error } = await client.auth.mfa.enroll({
            factorType: 'totp',
            issuer: 'Nexus RH',
            friendlyName: `App autenticador ${new Date().toISOString().slice(0, 10)}`,
        });
        if (error) return { error };
        return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, error: null };
    }

    async function verify(client, factorId, code) {
        if (!isValidCode(code)) return { error: { message: 'invalid-format' } };
        const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: normalizeCode(code) });
        return { error: error || null };
    }

    async function cancelEnroll(client, factorId) {
        await client.auth.mfa.unenroll({ factorId });
    }

    async function disable(client, factorId) {
        const { error } = await client.auth.mfa.unenroll({ factorId });
        return { error: error || null };
    }

    async function generateRecoveryCodes(client) {
        const { data, error } = await client.rpc('mfa_recovery_generate');
        if (error || !Array.isArray(data)) return { codes: [], error: error || { message: 'empty' } };
        return { codes: data, error: null };
    }

    async function recoveryRemaining(client) {
        const { data, error } = await client.rpc('mfa_recovery_remaining');
        return error ? null : Number(data) || 0;
    }

    async function recover(client, code) {
        if (!isValidRecoveryCode(code)) return { error: { status: 400 } };
        const { error } = await client.functions.invoke('mfa-recover', { body: { code: normalizeRecoveryCode(code) } });
        if (!error) return { error: null };
        return { error: { status: error.context?.status || 0 } };
    }

    return {
        REQUIRED_PROFILES,
        isRequiredFor,
        decide,
        assurance,
        normalizeCode,
        isValidCode,
        normalizeRecoveryCode,
        isValidRecoveryCode,
        listFactors,
        startEnroll,
        verify,
        cancelEnroll,
        disable,
        generateRecoveryCodes,
        recoveryRemaining,
        recover,
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.NexusMfa;
