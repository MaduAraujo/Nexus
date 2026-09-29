const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const FECHADAS_PARA_ANONIMO = [
    'public.is_rh()',
    'public.my_employee_id()',
    'public.chat_is_member(uuid)',
    'public.chat_channel_is_dm(uuid)',
    'public.medical_leaves_team()',
    'public.medical_leaves_apply_status()',
];

const pode = (db, papel, funcao) => db.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [papel, funcao]).then((r) => r.rows[0].ok);

describe('funções SECURITY DEFINER não ficam abertas para quem não fez login', () => {
    test('anônimo não executa as funções de identidade, chat e atestados da equipe', async () => {
        await withServiceRole(async (db) => {
            for (const funcao of FECHADAS_PARA_ANONIMO) assert.equal(await pode(db, 'anon', funcao), false, funcao);
        });
    });

    test('quem está logado continua usando as que as telas e as regras de acesso chamam', async () => {
        await withServiceRole(async (db) => {
            for (const funcao of FECHADAS_PARA_ANONIMO.filter((f) => !f.includes('apply_status'))) {
                assert.equal(await pode(db, 'authenticated', funcao), true, funcao);
            }
        });
    });

    test('a função de trigger dos atestados não é chamável pela API por ninguém logado', async () => {
        await withServiceRole(async (db) => {
            assert.equal(await pode(db, 'authenticated', 'public.medical_leaves_apply_status()'), false);
        });
    });

    test('registrar tentativa de login que falhou continua aberto: acontece antes de existir sessão', async () => {
        await withServiceRole(async (db) => {
            assert.equal(await pode(db, 'anon', 'public.report_login_failure(text)'), true);
        });
    });

    test('anônimo consultando uma tabela protegida recebe acesso negado ou nada, nunca dados', async () => {
        await withUser({ sub: '', role: 'anon' }, async (db) => {
            let linhas = 0;
            try {
                linhas = (await db.query('SELECT count(*)::int AS n FROM vacations')).rows[0].n;
            } catch (e) {
                assert.match(e.message, /permission denied/);
            }
            assert.equal(linhas, 0);
        });
    });
});
