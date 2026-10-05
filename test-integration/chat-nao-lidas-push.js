const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000c101';
const U_A = '00000000-0000-4000-8000-00000000c102';
const U_B = '00000000-0000-4000-8000-00000000c103';
const U_C = '00000000-0000-4000-8000-00000000c104';
const E_RH = '00000000-0000-4000-9000-00000000c101';
const E_A = '00000000-0000-4000-9000-00000000c102';
const E_B = '00000000-0000-4000-9000-00000000c103';
const E_C = '00000000-0000-4000-9000-00000000c104';
const CANAL = '00000000-0000-4000-a000-00000000c101';
const DM = '00000000-0000-4000-a000-00000000c102';
const TICKET = '00000000-0000-4000-b000-00000000c101';
const USERS = [U_RH, U_A, U_B, U_C];
const EMPS = [E_RH, E_A, E_B, E_C];

const como = (sub, sql, params) => withUser({ sub, commit: true }, (db) => db.query(sql, params));
const resumo = async (sub) =>
    Object.fromEntries((await como(sub, 'SELECT kind, thread, unread FROM chat_unread_summary()')).rows.map((r) => [`${r.kind}:${r.thread}`, r.unread]));
const alvos = async (kind, id) => (await withServiceRole((db) => db.query('SELECT * FROM chat_push_targets($1, $2)', [kind, id]))).rows;
const inserir = async (sql, params) => (await withServiceRole((db) => db.query(sql, params))).rows[0]?.id;
const recusa = async (promessa, codigo) => {
    await assert.rejects(promessa, (e) => {
        assert.equal(e.code, codigo);
        return true;
    });
};

async function limpar(db) {
    await db.query('DELETE FROM chat_reads WHERE user_id = ANY($1)', [USERS]);
    await db.query('DELETE FROM hr_tickets WHERE id = $1', [TICKET]);
    await db.query('DELETE FROM chat_channels WHERE id = ANY($1)', [[CANAL, DM]]);
}

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of USERS) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, notif_prefs) VALUES
               ($1, 'Rita RH', '968.000.000-01', 'chat.rh@test.local', 'RH', 'Ativo', NULL),
               ($2, 'Ana Chat', '968.000.000-02', 'chat.a@test.local', 'TI', 'Ativo', NULL),
               ($3, 'Bia Chat', '968.000.000-03', 'chat.b@test.local', 'TI', 'Ativo', NULL),
               ($4, 'Caio Chat', '968.000.000-04', 'chat.c@test.local', 'TI', 'Ativo', '{"chat": false}')
             ON CONFLICT (id) DO NOTHING`,
            EMPS
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6), ($7, 'colaborador', $8)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A, U_B, E_B, U_C, E_C]
        );
        await limpar(db);
        await db.query(
            `INSERT INTO chat_channels (id, name, slug, kind, dm_key) VALUES
               ($1, 'teste-nao-lidas', 'teste-nao-lidas', 'channel', NULL),
               ($2, 'Mensagem direta', 'dm-teste-nao-lidas', 'dm', 'teste-nao-lidas')`,
            [CANAL, DM]
        );
        await db.query(
            `INSERT INTO chat_channel_members (channel_id, employee_id, joined_at) VALUES
               ($1, $3, '2026-01-01'), ($1, $4, '2026-01-01'), ($1, $5, '2026-01-01'), ($2, $3, '2026-01-01'), ($2, $4, '2026-01-01')`,
            [CANAL, DM, E_A, E_B, E_C]
        );
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await limpar(db);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [USERS]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [USERS]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [EMPS]);
    });
});

describe('Migration 113 — mensagens não lidas e push do chat', () => {
    let m1;
    let m2;

    test('conta só mensagens de outros, depois de entrar na conversa; marcar como lida zera', async () => {
        await inserir(`INSERT INTO chat_messages (channel_id, employee_id, content, created_at) VALUES ($1, $2, 'antiga', '2025-12-01')`, [CANAL, E_B]);
        m1 = await inserir(`INSERT INTO chat_messages (channel_id, employee_id, content, created_at) VALUES ($1, $2, 'oi', '2026-02-01 10:00') RETURNING id`, [
            CANAL,
            E_B,
        ]);
        m2 = await inserir(
            `INSERT INTO chat_messages (channel_id, employee_id, content, created_at) VALUES ($1, $2, 'tudo bem?', '2026-02-01 10:01') RETURNING id`,
            [CANAL, E_B]
        );
        await inserir(`INSERT INTO chat_messages (channel_id, employee_id, content, created_at) VALUES ($1, $2, 'minha', '2026-02-01 10:02')`, [CANAL, E_A]);
        await inserir(`INSERT INTO chat_messages (channel_id, employee_id, content, created_at) VALUES ($1, $2, 'direta', '2026-02-01 10:03')`, [DM, E_B]);

        let r = await resumo(U_A);
        assert.equal(r[`channel:${CANAL}`], 2);
        assert.equal(r[`channel:${DM}`], 1);

        await como(U_A, 'SELECT chat_mark_read($1, $2)', ['channel', CANAL]);
        r = await resumo(U_A);
        assert.equal(r[`channel:${CANAL}`], undefined);
        assert.equal(r[`channel:${DM}`], 1);
        assert.equal((await como(U_B, 'SELECT * FROM chat_reads')).rows.length, 0, 'leituras de um não aparecem para o outro');
    });

    test('só marca conversa da qual participa; ninguém grava em chat_reads direto', async () => {
        await recusa(como(U_C, 'SELECT chat_mark_read($1, $2)', ['channel', DM]), '42501');
        await recusa(como(U_A, 'SELECT chat_mark_read($1, $2)', ['grupo', CANAL]), '22023');
        await recusa(como(U_A, `INSERT INTO chat_reads (user_id, thread_kind, thread_id) VALUES ($1, 'channel', $2)`, [U_A, DM]), '42501');
        await recusa(como(U_A, 'SELECT * FROM chat_push_targets($1, $2)', ['chat', m1]), '42501');
    });

    test('push: autor e quem desligou o chat ficam de fora; em grupo, só a primeira não lida avisa', async () => {
        await withServiceRole((db) => db.query('DELETE FROM chat_reads WHERE user_id = ANY($1)', [USERS]));
        const t = await alvos('chat', m1);
        assert.deepEqual(
            t.map((x) => x.employee_id),
            [E_A]
        );
        assert.equal(t[0].title, '#teste-nao-lidas');
        assert.equal(t[0].body, 'Nova mensagem de Bia Chat.');
        assert.deepEqual(await alvos('chat', m2), []);
    });

    test('atendimento: RH vê as mensagens do colaborador depois da escalada; resposta do RH avisa o colaborador', async () => {
        await inserir(`INSERT INTO hr_tickets (id, employee_id, status) VALUES ($1, $2, 'bot')`, [TICKET, E_A]);
        await inserir(`INSERT INTO hr_ticket_messages (ticket_id, employee_id, role, content) VALUES ($1, $2, 'user', 'quero falar com o RH')`, [TICKET, E_A]);
        assert.equal((await resumo(U_RH))[`ticket:${TICKET}`], undefined);

        await withServiceRole((db) => db.query(`UPDATE hr_tickets SET status = 'aguardando_rh' WHERE id = $1`, [TICKET]));
        assert.equal((await resumo(U_RH))[`ticket:${TICKET}`], 1);
        const esc = await alvos('ticket_escalated', TICKET);
        assert.ok(esc.some((x) => x.profile_id === U_RH && x.body === 'Ana Chat pediu para falar com o RH.'));

        await como(U_RH, 'SELECT chat_mark_read($1, $2)', ['ticket', TICKET]);
        assert.equal((await resumo(U_RH))[`ticket:${TICKET}`], undefined);
        await recusa(como(U_B, 'SELECT chat_mark_read($1, $2)', ['ticket', TICKET]), '42501');

        const resp = await inserir(`INSERT INTO hr_ticket_messages (ticket_id, employee_id, role, content) VALUES ($1, $2, 'rh', 'Olá, Ana') RETURNING id`, [
            TICKET,
            E_RH,
        ]);
        assert.equal((await resumo(U_A))[`ticket:${TICKET}`], 1);
        assert.deepEqual(
            (await alvos('ticket_msg', resp)).map((x) => [x.employee_id, x.title]),
            [[E_A, 'Resposta do RH']]
        );
    });

    test('apagar a conversa limpa as leituras dela', async () => {
        await como(U_A, 'SELECT chat_mark_read($1, $2)', ['ticket', TICKET]);
        await withServiceRole((db) => db.query('DELETE FROM hr_tickets WHERE id = $1', [TICKET]));
        const n = (await withServiceRole((db) => db.query('SELECT count(*)::int AS n FROM chat_reads WHERE thread_id = $1', [TICKET]))).rows[0].n;
        assert.equal(n, 0);
    });
});
