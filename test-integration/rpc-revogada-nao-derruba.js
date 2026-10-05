const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { withServiceRole, withUser, DB_URL } = require('../test-support/pg-rls-client.js');

const ID_QUALQUER = '00000000-0000-0000-0000-000000000000';

async function funcoesRevogadas() {
    return withServiceRole(async (db) => {
        const { rows } = await db.query(`
            SELECT p.oid::regprocedure::text AS assinatura,
                   format('%I.%I', n.nspname, p.proname) AS nome,
                   coalesce(array(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) AS t), '{}') AS tipos
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.prokind = 'f'
               AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
             ORDER BY 1`);
        return rows;
    });
}

async function sentinela() {
    const client = new Client({ connectionString: DB_URL });
    const quedas = [];
    client.on('error', (e) => quedas.push(e.message));
    await client.connect();
    return {
        async continuaViva() {
            try {
                await client.query('SELECT 1');
                return quedas.length === 0;
            } catch {
                return false;
            }
        },
        fechar: () => client.end().catch(() => {}),
    };
}

function chamada({ nome, tipos }) {
    const args = tipos.map((tipo) => `NULL::${tipo}`).join(', ');
    return `SELECT ${nome}(${args})`;
}

async function chamarTodas(role, funcoes) {
    const recusas = [];
    await withUser({ sub: role === 'anon' ? '' : ID_QUALQUER, role }, async (db) => {
        for (const f of funcoes) {
            await db.query('SAVEPOINT tentativa');
            try {
                await db.query(chamada(f));
                recusas.push({ assinatura: f.assinatura, erro: null });
            } catch (e) {
                recusas.push({ assinatura: f.assinatura, erro: e.code });
            }
            await db.query('ROLLBACK TO SAVEPOINT tentativa');
        }
    });
    return recusas;
}

describe('chamar pela API uma função revogada não derruba o Postgres', () => {
    test('existem funções internas no schema public sem EXECUTE para quem está logado', async () => {
        assert.ok((await funcoesRevogadas()).length > 0);
    });

    for (const role of ['anon', 'authenticated']) {
        test(`${role}: cada chamada é recusada com permissão negada e o servidor continua no ar`, async () => {
            const funcoes = await funcoesRevogadas();
            const outra = await sentinela();
            try {
                const resultado = await chamarTodas(role, funcoes);
                for (const r of resultado) assert.equal(r.erro, '42501', `${r.assinatura} deveria dar permissão negada`);
                assert.equal(await outra.continuaViva(), true, 'o Postgres derrubou as outras conexões durante as chamadas');
            } finally {
                await outra.fechar();
            }
        });
    }
});
