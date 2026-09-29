const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const FECHADAS_PARA_ANONIMO = ['public.medical_leaves_team()', 'public.medical_leaves_apply_status()'];

const USADAS_EM_POLITICAS = ['public.is_rh()', 'public.my_employee_id()', 'public.chat_is_member(uuid)', 'public.chat_channel_is_dm(uuid)'];

const pode = (db, papel, funcao) => db.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [papel, funcao]).then((r) => r.rows[0].ok);

describe('funções SECURITY DEFINER não ficam abertas para quem não fez login', () => {
    test('anônimo não executa as funções de atestados da equipe', async () => {
        await withServiceRole(async (db) => {
            for (const funcao of FECHADAS_PARA_ANONIMO) assert.equal(await pode(db, 'anon', funcao), false, funcao);
        });
    });

    test('as funções chamadas nas políticas ficam executáveis por anon, sem o que o Postgres cai ao avaliar a RLS', async () => {
        await withServiceRole(async (db) => {
            for (const funcao of USADAS_EM_POLITICAS) assert.equal(await pode(db, 'anon', funcao), true, funcao);
        });
    });

    test('para anônimo, as funções das políticas não reconhecem ninguém', async () => {
        await withUser({ sub: '', role: 'anon' }, async (db) => {
            const r = (await db.query("SELECT is_rh() AS rh, my_employee_id() AS eu, chat_is_member('00000000-0000-0000-0000-000000000000') AS membro"))
                .rows[0];
            assert.equal(r.rh, false);
            assert.equal(r.eu, null);
            assert.equal(r.membro, false);
        });
    });

    test('quem está logado continua usando as que as telas e as regras de acesso chamam', async () => {
        await withServiceRole(async (db) => {
            for (const funcao of [...USADAS_EM_POLITICAS, ...FECHADAS_PARA_ANONIMO.filter((f) => !f.includes('apply_status'))]) {
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
