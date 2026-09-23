const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('../test-support/mock-supabase');

global.window = global;
const NexusMfa = require('../src/javascript/shared/mfa.js');

const AAL1_SEM_FATOR = { currentLevel: 'aal1', nextLevel: 'aal1' };
const AAL1_COM_FATOR = { currentLevel: 'aal1', nextLevel: 'aal2' };
const AAL2 = { currentLevel: 'aal2', nextLevel: 'aal2' };

describe('decide (o que a página deve fazer com esta sessão)', () => {
    test('sessão aal2 sempre passa, seja qual for o perfil', () => {
        assert.equal(NexusMfa.decide(AAL2, 'Administrador'), 'ok');
        assert.equal(NexusMfa.decide(AAL2, 'colaborador'), 'ok');
    });

    test('fator ativo mas código ainda não digitado exige o desafio, para qualquer perfil', () => {
        assert.equal(NexusMfa.decide(AAL1_COM_FATOR, 'Administrador'), 'challenge');
        assert.equal(NexusMfa.decide(AAL1_COM_FATOR, 'colaborador'), 'challenge');
    });

    test('Administrador sem fator precisa ativar; colaborador sem fator segue (MFA opcional)', () => {
        assert.equal(NexusMfa.decide(AAL1_SEM_FATOR, 'Administrador'), 'enroll');
        assert.equal(NexusMfa.decide(AAL1_SEM_FATOR, 'colaborador'), 'ok');
    });

    test('nível ausente não vira "ok" para perfil obrigatório', () => {
        assert.equal(NexusMfa.decide(undefined, 'Administrador'), 'enroll');
        assert.equal(NexusMfa.decide(null, 'Administrador'), 'enroll');
    });
});

describe('código de 6 dígitos', () => {
    test('aceita só dígitos, ignorando espaços que apps autenticadores costumam inserir', () => {
        assert.equal(NexusMfa.normalizeCode('123 456'), '123456');
        assert.equal(NexusMfa.isValidCode('123 456'), true);
    });

    test('recusa tamanho errado e letras', () => {
        assert.equal(NexusMfa.isValidCode('12345'), false);
        assert.equal(NexusMfa.isValidCode('1234567'), false);
        assert.equal(NexusMfa.isValidCode('12345a'), false);
        assert.equal(NexusMfa.isValidCode(''), false);
        assert.equal(NexusMfa.isValidCode(undefined), false);
    });
});

describe('assurance', () => {
    test('devolve o nível do Supabase', async () => {
        const sb = createMockSupabase({}, { mfaLevel: AAL1_COM_FATOR });
        assert.deepEqual(await NexusMfa.assurance(sb), AAL1_COM_FATOR);
    });

    test('erro ao consultar devolve null (quem chama deve negar acesso)', async () => {
        const sb = createMockSupabase({}, { mfaError: { message: 'boom' } });
        assert.equal(await NexusMfa.assurance(sb), null);
    });
});

describe('listFactors', () => {
    test('separa fatores verificados dos pendentes e ignora os que não são TOTP', async () => {
        const sb = createMockSupabase(
            {},
            {
                mfaFactors: [
                    { id: 'a', factor_type: 'totp', status: 'verified' },
                    { id: 'b', factor_type: 'totp', status: 'unverified' },
                    { id: 'c', factor_type: 'phone', status: 'verified' },
                ],
            }
        );
        const { verified, pending } = await NexusMfa.listFactors(sb);
        assert.deepEqual(
            verified.map((f) => f.id),
            ['a']
        );
        assert.deepEqual(
            pending.map((f) => f.id),
            ['b']
        );
    });
});

describe('startEnroll', () => {
    test('descarta ativação abandonada antes de gerar um novo QR code', async () => {
        const sb = createMockSupabase({}, { mfaFactors: [{ id: 'velho', factor_type: 'totp', status: 'unverified' }] });
        const result = await NexusMfa.startEnroll(sb);
        assert.equal(result.error, null);
        assert.equal(result.factorId, 'f-new');
        assert.equal(result.secret, 'ABCDEF');
        assert.match(result.qrCode, /^data:image\/svg\+xml/);
        assert.deepEqual(
            sb.mfaCalls.map((c) => c[0]),
            ['unenroll', 'enroll']
        );
        assert.deepEqual(sb.mfaCalls[0][1], { factorId: 'velho' });
        assert.equal(sb.mfaCalls[1][1].factorType, 'totp');
    });
});

describe('verify', () => {
    test('código no formato errado nem chega ao servidor', async () => {
        const sb = createMockSupabase();
        const { error } = await NexusMfa.verify(sb, 'f1', '12');
        assert.ok(error);
        assert.equal(sb.mfaCalls.length, 0);
    });

    test('código correto passa (sem espaços) e código errado devolve erro', async () => {
        const sb = createMockSupabase();
        assert.equal((await NexusMfa.verify(sb, 'f1', '123 456')).error, null);
        assert.deepEqual(sb.mfaCalls[0][1], { factorId: 'f1', code: '123456' });
        assert.ok((await NexusMfa.verify(sb, 'f1', '000000')).error);
    });
});

describe('perfis obrigatórios', () => {
    test('só o RH é obrigado', () => {
        assert.equal(NexusMfa.isRequiredFor('Administrador'), true);
        assert.equal(NexusMfa.isRequiredFor('colaborador'), false);
    });
});

describe('códigos de recuperação', () => {
    test('aceita com ou sem hífen, em minúsculas e com espaços; recusa letras ambíguas (I, O) e 0/1', () => {
        assert.equal(NexusMfa.isValidRecoveryCode('ABCDE-FGH23'), true);
        assert.equal(NexusMfa.isValidRecoveryCode(' abcde fgh23 '), true);
        assert.equal(NexusMfa.normalizeRecoveryCode('abcde-fgh23'), 'ABCDEFGH23');
        assert.equal(NexusMfa.isValidRecoveryCode('ABCDE-FGH2'), false);
        assert.equal(NexusMfa.isValidRecoveryCode('ABCDI-FGH23'), false);
        assert.equal(NexusMfa.isValidRecoveryCode('ABCD0-FGH23'), false);
        assert.equal(NexusMfa.isValidRecoveryCode(''), false);
    });

    test('recover não chama o servidor com código mal formatado', async () => {
        let called = false;
        const client = { functions: { invoke: async () => ((called = true), {}) } };
        const { error } = await NexusMfa.recover(client, '123');
        assert.equal(error.status, 400);
        assert.equal(called, false);
    });

    test('recover envia o código normalizado para a Edge Function mfa-recover', async () => {
        const calls = [];
        const client = { functions: { invoke: async (name, opts) => (calls.push([name, opts.body]), { error: null }) } };
        const { error } = await NexusMfa.recover(client, 'abcde-fgh23');
        assert.equal(error, null);
        assert.deepEqual(calls, [['mfa-recover', { code: 'ABCDEFGH23' }]]);
    });

    test('recover devolve o status HTTP do erro (429 = muitas tentativas)', async () => {
        const client = { functions: { invoke: async () => ({ error: { context: { status: 429 } } }) } };
        const { error } = await NexusMfa.recover(client, 'ABCDE-FGH23');
        assert.equal(error.status, 429);
    });

    test('generateRecoveryCodes e recoveryRemaining usam as RPCs do banco', async () => {
        const rpcs = [];
        const client = {
            rpc: async (name) => {
                rpcs.push(name);
                return name === 'mfa_recovery_generate' ? { data: ['AAAAA-22222'], error: null } : { data: 7, error: null };
            },
        };
        assert.deepEqual(await NexusMfa.generateRecoveryCodes(client), { codes: ['AAAAA-22222'], error: null });
        assert.equal(await NexusMfa.recoveryRemaining(client), 7);
        assert.deepEqual(rpcs, ['mfa_recovery_generate', 'mfa_recovery_remaining']);
    });

    test('erro ao gerar ou consultar não vira lista vazia silenciosa', async () => {
        const client = { rpc: async () => ({ data: null, error: { message: 'aal1' } }) };
        const gerado = await NexusMfa.generateRecoveryCodes(client);
        assert.deepEqual(gerado.codes, []);
        assert.ok(gerado.error);
        assert.equal(await NexusMfa.recoveryRemaining(client), null);
    });
});
