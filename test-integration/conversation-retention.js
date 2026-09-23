const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole } = require('../test-support/pg-rls-client.js');

const U_COLAB = '00000000-0000-4000-8000-00000000d801';
const E_COLAB = '00000000-0000-4000-9000-00000000d801';
const CH = '00000000-0000-4000-b000-00000000d801';

const T_BOT_VELHO = '00000000-0000-4000-a000-00000000d801';
const T_RESOLVIDO_VELHO = '00000000-0000-4000-a000-00000000d802';
const T_ABERTO_VELHO = '00000000-0000-4000-a000-00000000d803';
const T_VELHO_COM_MSG_NOVA = '00000000-0000-4000-a000-00000000d804';
const T_NOVO = '00000000-0000-4000-a000-00000000d805';
const TICKETS = [T_BOT_VELHO, T_RESOLVIDO_VELHO, T_ABERTO_VELHO, T_VELHO_COM_MSG_NOVA, T_NOVO];

const VELHO = "now() - interval '13 months'";
const RECENTE = "now() - interval '11 months'";

const AI_VELHO = '00000000-0000-4000-c000-00000000d801';
const AI_RECENTE = '00000000-0000-4000-c000-00000000d802';

let resultado;

before(async () => {
    await withServiceRole(async (db) => {
        await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [U_COLAB]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status)
             VALUES ($1, 'Retenção Fixture', '908.000.000-01', 'retencao@test.local', 'TI', 'Ativo') ON CONFLICT (id) DO NOTHING`,
            [E_COLAB]
        );
        await db.query(`INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'colaborador', $2) ON CONFLICT (id) DO NOTHING`, [U_COLAB, E_COLAB]);
        await db.query(
            `INSERT INTO chat_channels (id, name, slug, kind) VALUES ($1, 'Canal retenção', 'canal-retencao-teste', 'channel') ON CONFLICT (id) DO NOTHING`,
            [CH]
        );

        await db.query('DELETE FROM chat_messages WHERE channel_id = $1', [CH]);
        await db.query(
            `INSERT INTO chat_messages (channel_id, employee_id, content, created_at)
             VALUES ($1, $2, 'retencao: mensagem antiga', ${VELHO}), ($1, $2, 'retencao: mensagem recente', ${RECENTE})`,
            [CH, E_COLAB]
        );

        await db.query('DELETE FROM ai_chat_history WHERE id = ANY($1)', [[AI_VELHO, AI_RECENTE]]);
        await db.query(
            `INSERT INTO ai_chat_history (id, role, content, created_at)
             VALUES ($1, 'user', 'pergunta antiga', ${VELHO}), ($2, 'user', 'pergunta recente', ${RECENTE})`,
            [AI_VELHO, AI_RECENTE]
        );

        await db.query('DELETE FROM hr_tickets WHERE id = ANY($1)', [TICKETS]);
        await db.query(
            `INSERT INTO hr_tickets (id, employee_id, status, created_at, updated_at) VALUES
                ($1, $6, 'bot',            ${VELHO},   ${VELHO}),
                ($2, $6, 'resolvido',      ${VELHO},   ${VELHO}),
                ($3, $6, 'aguardando_rh',  ${VELHO},   ${VELHO}),
                ($4, $6, 'bot',            ${VELHO},   ${VELHO}),
                ($5, $6, 'resolvido',      ${RECENTE}, ${RECENTE})`,
            [...TICKETS, E_COLAB]
        );
        await db.query(
            `INSERT INTO hr_ticket_messages (ticket_id, employee_id, role, content, created_at) VALUES
                ($1, $3, 'user', 'retencao: conversa com o assistente', ${VELHO}),
                ($2, $3, 'user', 'retencao: voltou a conversar', ${RECENTE})`,
            [T_BOT_VELHO, T_VELHO_COM_MSG_NOVA, E_COLAB]
        );

        resultado = (await db.query('SELECT purge_expired_conversations() AS r')).rows[0].r;
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM hr_tickets WHERE id = ANY($1)', [TICKETS]);
        await db.query('DELETE FROM ai_chat_history WHERE id = ANY($1)', [[AI_VELHO, AI_RECENTE]]);
        await db.query('DELETE FROM chat_messages WHERE channel_id = $1', [CH]);
        await db.query('DELETE FROM chat_channels WHERE id = $1', [CH]);
        await db.query('DELETE FROM profiles WHERE id = $1', [U_COLAB]);
        await db.query('DELETE FROM auth.users WHERE id = $1', [U_COLAB]);
        await db.query('DELETE FROM employees WHERE id = $1', [E_COLAB]);
    });
});

describe('purge_expired_conversations() — retenção de 12 meses', () => {
    test('devolve quantas linhas apagou de cada tabela', () => {
        assert.ok(resultado.chat_messages >= 1);
        assert.ok(resultado.ai_chat_history >= 1);
        assert.ok(resultado.hr_tickets >= 2);
    });

    test('chat interno: apaga só mensagens com mais de 12 meses', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query("SELECT created_at > now() - interval '12 months' AS recente FROM chat_messages WHERE channel_id = $1", [CH]);
            assert.deepEqual(
                rows.map((r) => r.recente),
                [true]
            );
        });
    });

    test('assistente de IA do RH: apaga só o histórico com mais de 12 meses', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT id FROM ai_chat_history WHERE id = ANY($1)', [[AI_VELHO, AI_RECENTE]]);
            assert.deepEqual(
                rows.map((r) => r.id),
                [AI_RECENTE]
            );
        });
    });

    test('conversas com o assistente e chamados resolvidos: somem após 12 meses de inatividade, com as mensagens', async () => {
        await withServiceRole(async (db) => {
            const t = await db.query('SELECT id FROM hr_tickets WHERE id = ANY($1)', [[T_BOT_VELHO, T_RESOLVIDO_VELHO]]);
            assert.equal(t.rows.length, 0);
            const m = await db.query('SELECT 1 FROM hr_ticket_messages WHERE ticket_id = $1', [T_BOT_VELHO]);
            assert.equal(m.rows.length, 0);
        });
    });

    test('mantém chamado ainda aberto com o RH, conversa retomada recentemente e conversa nova', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT id FROM hr_tickets WHERE id = ANY($1) ORDER BY id', [[T_ABERTO_VELHO, T_VELHO_COM_MSG_NOVA, T_NOVO]]);
            assert.deepEqual(
                rows.map((r) => r.id),
                [T_ABERTO_VELHO, T_VELHO_COM_MSG_NOVA, T_NOVO]
            );
        });
    });

    test('não é executável por anon nem por usuário logado', async () => {
        await withServiceRole(async (db) => {
            for (const role of ['anon', 'authenticated']) {
                const { rows } = await db.query("SELECT has_function_privilege($1, 'purge_expired_conversations()', 'EXECUTE') AS ok", [role]);
                assert.equal(rows[0].ok, false, role);
            }
        });
    });
});
