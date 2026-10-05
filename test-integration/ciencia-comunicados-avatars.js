const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000b101';
const U_A = '00000000-0000-4000-8000-00000000b102';
const U_B = '00000000-0000-4000-8000-00000000b103';
const E_RH = '00000000-0000-4000-9000-00000000b101';
const E_A = '00000000-0000-4000-9000-00000000b102';
const E_B = '00000000-0000-4000-9000-00000000b103';
const M_URGENTE = '00000000-0000-4000-a000-00000000b101';
const M_COMUM = '00000000-0000-4000-a000-00000000b102';
const M_SEM_CIENCIA = '00000000-0000-4000-a000-00000000b103';
const MSGS = [M_URGENTE, M_COMUM, M_SEM_CIENCIA];

const comoRH = (sql, params) => withUser({ sub: U_RH, commit: true }, (db) => db.query(sql, params));
const comoA = (sql, params) => withUser({ sub: U_A, commit: true }, (db) => db.query(sql, params));
const comoB = (sql, params) => withUser({ sub: U_B, commit: true }, (db) => db.query(sql, params));
const leitura = async (msg, emp) =>
    (await withServiceRole((db) => db.query('SELECT read_at, acknowledged_at FROM message_reads WHERE message_id = $1 AND employee_id = $2', [msg, emp])))
        .rows[0];
const temStorage = async () => (await withServiceRole((db) => db.query("SELECT to_regclass('storage.buckets') IS NOT NULL AS ok"))).rows[0].ok;
const recusa = async (promessa, codigo) => {
    await assert.rejects(promessa, (e) => {
        assert.equal(e.code, codigo);
        return true;
    });
};

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A, U_B]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status) VALUES
               ($1, 'Ciência RH', '967.000.000-01', 'ciencia.rh@test.local', 'RH', 'Ativo'),
               ($2, 'Ciência A', '967.000.000-02', 'ciencia.a@test.local', 'TI', 'Ativo'),
               ($3, 'Ciência B', '967.000.000-03', 'ciencia.b@test.local', 'TI', 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A, E_B]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A, U_B, E_B]
        );
        await db.query('DELETE FROM message_reads WHERE message_id = ANY($1)', [MSGS]);
        await db.query('DELETE FROM messages WHERE id = ANY($1)', [MSGS]);
        await db.query(
            `INSERT INTO messages (id, texto, destino, categoria) VALUES
               ($1, 'Nova norma de segurança', 'Todos', 'Urgente'),
               ($2, 'Festa de fim de ano', 'Todos', 'Evento'),
               ($3, 'Aviso sem ciência', 'Todos', 'Política')`,
            MSGS
        );
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM message_reads WHERE message_id = ANY($1)', [MSGS]);
        await db.query('DELETE FROM messages WHERE id = ANY($1)', [MSGS]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A, U_B]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A, U_B]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A, E_B]]);
    });
});

describe('Migration 110 — ciência de comunicado separada da visualização', () => {
    test('abrir registra só a visualização; a hora vem do banco, não do aparelho', async () => {
        await comoA(`INSERT INTO message_reads (message_id, employee_id, read_at) VALUES ($1, $2, '2020-01-01')`, [M_URGENTE, E_A]);
        const r = await leitura(M_URGENTE, E_A);
        assert.ok(r.read_at > new Date(Date.now() - 60000));
        assert.equal(r.acknowledged_at, null);
    });

    test('confirmar ciência pelo upsert grava a hora do servidor e mantém a hora da visualização', async () => {
        const antes = await leitura(M_URGENTE, E_A);
        await comoA(
            `INSERT INTO message_reads (message_id, employee_id, acknowledged_at) VALUES ($1, $2, '2020-01-01')
             ON CONFLICT (message_id, employee_id) DO UPDATE SET acknowledged_at = EXCLUDED.acknowledged_at, read_at = '2020-01-01'`,
            [M_URGENTE, E_A]
        );
        const r = await leitura(M_URGENTE, E_A);
        assert.ok(r.acknowledged_at > new Date(Date.now() - 60000));
        assert.deepEqual(r.read_at, antes.read_at);
    });

    test('ciência já dada não muda nem some, nem pelo colaborador nem pelo RH', async () => {
        const antes = await leitura(M_URGENTE, E_A);
        await comoA("UPDATE message_reads SET acknowledged_at = now() + interval '1 day' WHERE message_id = $1 AND employee_id = $2", [M_URGENTE, E_A]);
        await comoRH('UPDATE message_reads SET acknowledged_at = NULL WHERE message_id = $1 AND employee_id = $2', [M_URGENTE, E_A]);
        assert.deepEqual((await leitura(M_URGENTE, E_A)).acknowledged_at, antes.acknowledged_at);
        await recusa(comoRH('DELETE FROM message_reads WHERE message_id = $1 AND employee_id = $2', [M_URGENTE, E_A]), '55000');
        assert.ok(await leitura(M_URGENTE, E_A));
    });

    test('o RH não consegue confirmar ciência em nome do colaborador', async () => {
        await recusa(comoRH('INSERT INTO message_reads (message_id, employee_id, acknowledged_at) VALUES ($1, $2, now())', [M_URGENTE, E_B]), '42501');
        await comoB('INSERT INTO message_reads (message_id, employee_id) VALUES ($1, $2)', [M_URGENTE, E_B]);
        await recusa(comoRH('UPDATE message_reads SET acknowledged_at = now() WHERE message_id = $1 AND employee_id = $2', [M_URGENTE, E_B]), '42501');
        assert.equal((await leitura(M_URGENTE, E_B)).acknowledged_at, null);
    });

    test('a linha não troca de comunicado nem de colaborador depois de gravada', async () => {
        await comoB('UPDATE message_reads SET message_id = $1 WHERE message_id = $2 AND employee_id = $3', [M_COMUM, M_URGENTE, E_B]);
        assert.ok(await leitura(M_URGENTE, E_B));
        assert.equal(await leitura(M_COMUM, E_B), undefined);
    });

    test('leitura sem ciência pode ser apagada pelo RH', async () => {
        await comoRH('DELETE FROM message_reads WHERE message_id = $1 AND employee_id = $2', [M_URGENTE, E_B]);
        assert.equal(await leitura(M_URGENTE, E_B), undefined);
    });

    test('comunicado com ciência não pode ser editado nem excluído; mudar só o agendamento continua livre', async () => {
        await recusa(comoRH('UPDATE messages SET texto = $1 WHERE id = $2', ['Norma corrigida', M_URGENTE]), '55000');
        await recusa(comoRH('UPDATE messages SET categoria = $1 WHERE id = $2', ['Evento', M_URGENTE]), '55000');
        await recusa(comoRH('UPDATE messages SET destino = $1 WHERE id = $2', ['TI', M_URGENTE]), '55000');
        await recusa(comoRH(`UPDATE messages SET anexos = '[{"name":"x"}]' WHERE id = $1`, [M_URGENTE]), '55000');
        await recusa(comoRH('DELETE FROM messages WHERE id = $1', [M_URGENTE]), '55000');
        const { rowCount } = await comoRH('UPDATE messages SET push_sent_at = now() WHERE id = $1', [M_URGENTE]);
        assert.equal(rowCount, 1);
    });

    test('comunicado só visualizado (sem ciência) continua editável e excluível, levando as leituras junto', async () => {
        await comoA('INSERT INTO message_reads (message_id, employee_id) VALUES ($1, $2)', [M_SEM_CIENCIA, E_A]);
        await comoRH('UPDATE messages SET texto = $1 WHERE id = $2', ['Aviso corrigido', M_SEM_CIENCIA]);
        await comoRH('DELETE FROM messages WHERE id = $1', [M_SEM_CIENCIA]);
        assert.equal(await leitura(M_SEM_CIENCIA, E_A), undefined);
    });

    test('as funções da trava não são executáveis pela API', async () => {
        await withServiceRole(async (db) => {
            for (const fn of ['message_reads_ciencia_guard()', 'messages_ciencia_guard()'])
                for (const role of ['anon', 'authenticated']) {
                    const { rows } = await db.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [role, fn]);
                    assert.equal(rows[0].ok, false, `${fn} ${role}`);
                }
        });
    });
});

describe('Migration 110 — fotos de perfil fora do acesso público', () => {
    test('bucket avatars é privado', async (t) => {
        if (!(await temStorage())) return t.skip('Storage não provisionado neste banco');
        const { rows } = await withServiceRole((db) => db.query("SELECT public FROM storage.buckets WHERE id = 'avatars'"));
        assert.equal(rows[0].public, false);
    });

    test('usuário logado lê fotos de perfil; anônimo não lê nada', async (t) => {
        if (!(await temStorage())) return t.skip('Storage não provisionado neste banco');
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)
                 ON CONFLICT DO NOTHING`,
                [E_B]
            )
        );
        try {
            const logado = await withUser({ sub: U_A }, (db) => db.query("SELECT name FROM storage.objects WHERE bucket_id = 'avatars' AND name = $1", [E_B]));
            assert.equal(logado.rows.length, 1);
            const anonimo = await withUser({ sub: U_A, role: 'anon' }, (db) => db.query("SELECT name FROM storage.objects WHERE bucket_id = 'avatars'"));
            assert.equal(anonimo.rows.length, 0);
        } finally {
            await withServiceRole((db) => db.query("DELETE FROM storage.objects WHERE bucket_id = 'avatars' AND name = $1", [E_B]));
        }
    });

    test('colaborador continua só podendo trocar a própria foto', async (t) => {
        if (!(await temStorage())) return t.skip('Storage não provisionado neste banco');
        await recusa(
            withUser({ sub: U_A }, (db) => db.query("INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)", [E_B])),
            '42501'
        );
    });
});
