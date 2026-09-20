const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const PREFIX = 'nexus:enc1:';

const U_RH = '00000000-0000-4000-8000-00000000c001';
const U_MGR = '00000000-0000-4000-8000-00000000c002';
const U_SUB = '00000000-0000-4000-8000-00000000c003';
const U_OTHER = '00000000-0000-4000-8000-00000000c004';

const E_RH = '00000000-0000-4000-9000-00000000c001';
const E_MGR = '00000000-0000-4000-9000-00000000c002';
const E_SUB = '00000000-0000-4000-9000-00000000c003';
const E_OTHER = '00000000-0000-4000-9000-00000000c004';

const CH_DM = '00000000-0000-4000-b000-00000000c001';
const CH_GERAL = '00000000-0000-4000-b000-00000000c002';
const TICKET = '00000000-0000-4000-a000-00000000c001';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_MGR, U_SUB, U_OTHER]) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, rg, telefone, email, dept, salary, chave_pix, agencia, conta, manager_id, status)
             VALUES ($1, 'Cripto RH',    '901.000.000-01', 'RG-RH',  '11 90000-0001', 'cripto.rh@test.local',    'RH', 9000,    'rh@pix',  '0001', '111-1', NULL, 'Ativo'),
                    ($2, 'Cripto Gestor','901.000.000-02', 'RG-MGR', '11 90000-0002', 'cripto.mgr@test.local',   'TI', 7000.5,  'mgr@pix', '0002', '222-2', NULL, 'Ativo'),
                    ($3, 'Cripto Equipe','901.000.000-03', 'RG-SUB', '11 90000-0003', 'cripto.sub@test.local',   'TI', 3500.75, 'sub@pix', '0003', '333-3', $2,   'Ativo'),
                    ($4, 'Cripto Outro', '901.000.000-04', 'RG-OTH', '11 90000-0004', 'cripto.other@test.local', 'TI', 4100,    'oth@pix', '0004', '444-4', NULL, 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_MGR, E_SUB, E_OTHER]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES
                ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6), ($7, 'colaborador', $8)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_MGR, E_MGR, U_SUB, E_SUB, U_OTHER, E_OTHER]
        );
        await db.query(
            `INSERT INTO chat_channels (id, name, slug, kind, dm_key) VALUES ($1, 'Conversa direta cripto', 'dm-cripto-teste', 'dm', $2)
             ON CONFLICT (id) DO NOTHING`,
            [CH_DM, `${E_MGR}:${E_SUB}`]
        );
        await db.query(
            `INSERT INTO chat_channels (id, name, slug, kind) VALUES ($1, 'Canal cripto', 'canal-cripto-teste', 'channel') ON CONFLICT (id) DO NOTHING`,
            [CH_GERAL]
        );
        await db.query(
            `INSERT INTO chat_channel_members (channel_id, employee_id) VALUES ($1, $3), ($1, $4), ($2, $3), ($2, $4)
             ON CONFLICT DO NOTHING`,
            [CH_DM, CH_GERAL, E_MGR, E_SUB]
        );
        await db.query('DELETE FROM chat_messages WHERE channel_id IN ($1, $2)', [CH_DM, CH_GERAL]);
        await db.query(
            `INSERT INTO chat_messages (channel_id, employee_id, content) VALUES ($1, $3, 'segredo da conversa direta'), ($2, $3, 'mensagem do canal')`,
            [CH_DM, CH_GERAL, E_MGR]
        );
        await db.query(`INSERT INTO hr_tickets (id, employee_id, status) VALUES ($1, $2, 'em_atendimento') ON CONFLICT (id) DO NOTHING`, [TICKET, E_SUB]);
        await db.query('DELETE FROM hr_ticket_messages WHERE ticket_id = $1', [TICKET]);
        await db.query(`INSERT INTO hr_ticket_messages (ticket_id, employee_id, role, content) VALUES ($1, $2, 'user', 'dúvida sobre o meu salário')`, [
            TICKET,
            E_SUB,
        ]);
        await db.query("UPDATE employees SET birth_date = '1999-12-31', gender = 'Feminino', raca_cor = 'Preta', deficiencia = 'Visual' WHERE id = $1", [
            E_SUB,
        ]);
    });
});

describe('Dados pessoais sensíveis cifrados (migration 062)', () => {
    test('nascimento, gênero, raça/cor e deficiência ficam cifrados na tabela', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT birth_date, gender, raca_cor, deficiencia FROM employees WHERE id = $1', [E_SUB]);
            for (const [coluna, valor] of Object.entries(rows[0])) assert.ok(valor.startsWith(PREFIX), `${coluna} está em claro`);
        });
    });

    test('RH e a própria pessoa leem em claro; o gestor da equipe não', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT birth_date::text AS nascimento, gender, raca_cor, deficiencia FROM employees_decrypted WHERE id = $1', [
                E_SUB,
            ]);
            assert.deepEqual(rows[0], { nascimento: '1999-12-31', gender: 'Feminino', raca_cor: 'Preta', deficiencia: 'Visual' });
        });
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT birth_date::text AS nascimento, raca_cor FROM employees_decrypted');
            assert.deepEqual(rows[0], { nascimento: '1999-12-31', raca_cor: 'Preta' });
        });
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query('SELECT birth_date, gender, raca_cor, deficiencia FROM employees_decrypted WHERE id = $1', [E_SUB]);
            assert.deepEqual(rows[0], { birth_date: null, gender: null, raca_cor: null, deficiencia: null });
        });
    });
});

describe('Criptografia de colunas (migration 059)', () => {
    test('dados sensíveis ficam cifrados na tabela, sem nenhum valor em claro', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT cpf, rg, telefone, salary, chave_pix, agencia, conta FROM employees WHERE id = $1', [E_SUB]);
            for (const [coluna, valor] of Object.entries(rows[0])) {
                assert.ok(valor.startsWith(PREFIX), `${coluna} está em claro`);
            }
            assert.ok(!JSON.stringify(rows[0]).includes('901.000.000-03'));
        });
    });

    test('mensagens de chat e do atendimento com o RH ficam cifradas na tabela', async () => {
        await withServiceRole(async (db) => {
            const chat = await db.query('SELECT content FROM chat_messages WHERE channel_id IN ($1, $2)', [CH_DM, CH_GERAL]);
            assert.equal(chat.rows.length, 2);
            for (const row of chat.rows) assert.ok(row.content.startsWith(PREFIX));
            const tickets = await db.query('SELECT content FROM hr_ticket_messages WHERE ticket_id = $1', [TICKET]);
            assert.ok(tickets.rows[0].content.startsWith(PREFIX));
        });
    });

    test('mesmo CPF, com ou sem máscara, gera o mesmo índice; e o índice é único', async () => {
        await withServiceRole(async (db) => {
            const hash = await db.query("SELECT nexus_blind_index('901.000.000-03') AS a, nexus_blind_index('90100000003') AS b");
            assert.equal(hash.rows[0].a, hash.rows[0].b);
            const dup = await db.query(
                `INSERT INTO employees (name, cpf, email) VALUES ('Duplicado', '90100000003', 'cripto.dup@test.local')
                 ON CONFLICT (cpf_hash) DO NOTHING RETURNING id`
            );
            assert.equal(dup.rows.length, 0);
        });
    });

    test('RH lê tudo decifrado pela view, com salário numérico', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT cpf, rg, telefone, salary, chave_pix, agencia, conta FROM employees_decrypted WHERE id = $1', [E_SUB]);
            assert.deepEqual(rows[0], {
                cpf: '901.000.000-03',
                rg: 'RG-SUB',
                telefone: '11 90000-0003',
                salary: '3500.75',
                chave_pix: 'sub@pix',
                agencia: '0003',
                conta: '333-3',
            });
        });
    });

    test('colaborador lê os próprios dados decifrados e não enxerga outros', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT id, cpf, salary FROM employees_decrypted');
            assert.equal(rows.length, 1);
            assert.equal(rows[0].id, E_SUB);
            assert.equal(rows[0].cpf, '901.000.000-03');
        });
    });

    test('gestor vê a equipe, mas os campos sensíveis dela vêm vazios', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query('SELECT id, name, cpf, salary FROM employees_decrypted');
            const equipe = rows.find((r) => r.id === E_SUB);
            assert.equal(equipe.name, 'Cripto Equipe');
            assert.equal(equipe.cpf, null);
            assert.equal(equipe.salary, null);
            assert.equal(rows.find((r) => r.id === E_MGR).cpf, '901.000.000-02');
        });
    });

    test('gestor não decifra dado da equipe chamando a função direto, nem trocando o contexto', async () => {
        const { da_equipe: daEquipe, do_outro: doOutro } = await withServiceRole(async (db) => {
            const { rows } = await db.query(
                'SELECT (SELECT cpf FROM employees WHERE id = $1) AS da_equipe, (SELECT cpf FROM employees WHERE id = $2) AS do_outro',
                [E_SUB, E_OTHER]
            );
            return rows[0];
        });
        await withUser({ sub: U_MGR }, async (gestor) => {
            const r = await gestor.query(
                'SELECT nexus_decrypt_ctx($1, $2) AS certo, nexus_decrypt_ctx($3, $2) AS com_meu_id, nexus_decrypt_ctx($3, $4) AS de_outro',
                [`emp:${E_SUB}`, daEquipe, `emp:${E_MGR}`, doOutro]
            );
            assert.equal(r.rows[0].certo, null);
            assert.equal(r.rows[0].com_meu_id, null);
            assert.equal(r.rows[0].de_outro, null);
        });
    });

    test('na tabela base, gestor recebe só texto cifrado', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query('SELECT cpf, salary FROM employees WHERE id = $1', [E_SUB]);
            assert.ok(rows[0].cpf.startsWith(PREFIX));
            assert.ok(rows[0].salary.startsWith(PREFIX));
        });
    });

    test('funções internas e a tabela de chaves não estão liberadas para a API', async () => {
        await withServiceRole(async (db) => {
            for (const assinatura of ['nexus_secret(text)', 'nexus_wrap(text,text)', 'nexus_unwrap(text,text)', 'nexus_blind_index(text)']) {
                const { rows } = await db.query('SELECT has_function_privilege($1, $2, $3) AS anon, has_function_privilege($4, $2, $3) AS auth', [
                    'anon',
                    assinatura,
                    'EXECUTE',
                    'authenticated',
                ]);
                assert.equal(rows[0].anon, false, `${assinatura} liberada para anon`);
                assert.equal(rows[0].auth, false, `${assinatura} liberada para authenticated`);
            }
            const decrypt = await db.query("SELECT has_function_privilege('anon', 'nexus_decrypt_ctx(text,text)', 'EXECUTE') AS anon");
            assert.equal(decrypt.rows[0].anon, false);
        });
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT count(*)::int AS n FROM nexus_key_store');
            assert.equal(rows[0].n, 0, 'a API não pode ler a tabela de chaves');
        });
    });

    test('conversa direta: só os dois participantes leem, o RH não', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT content FROM chat_messages_decrypted WHERE channel_id = $1', [CH_DM]);
            assert.deepEqual(
                rows.map((r) => r.content),
                ['segredo da conversa direta']
            );
        });
        await withUser({ sub: U_OTHER }, async (db) => {
            const { rows } = await db.query('SELECT content FROM chat_messages_decrypted WHERE channel_id = $1', [CH_DM]);
            assert.equal(rows.length, 0);
        });
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT content FROM chat_messages_decrypted WHERE channel_id = $1', [CH_DM]);
            assert.equal(rows.length, 0);
        });
    });

    test('mensagem nova em texto puro é cifrada ao gravar e volta legível pela view', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const inserida = await db.query('INSERT INTO chat_messages (channel_id, employee_id, content) VALUES ($1, $2, $3) RETURNING content', [
                CH_GERAL,
                E_SUB,
                'oi pelo canal',
            ]);
            assert.ok(inserida.rows[0].content.startsWith(PREFIX));
            const lida = await db.query(
                "SELECT content FROM chat_messages_decrypted WHERE channel_id = $1 AND employee_id = $2 AND created_at >= now() - interval '1 minute'",
                [CH_GERAL, E_SUB]
            );
            assert.ok(lida.rows.some((r) => r.content === 'oi pelo canal'));
        });
    });

    test('atendimento com o RH: dono do ticket e RH leem; outro colaborador não', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT content FROM hr_ticket_messages_decrypted WHERE ticket_id = $1', [TICKET]);
            assert.equal(rows[0].content, 'dúvida sobre o meu salário');
        });
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT content FROM hr_ticket_messages_decrypted WHERE ticket_id = $1', [TICKET]);
            assert.equal(rows[0].content, 'dúvida sobre o meu salário');
        });
        await withUser({ sub: U_OTHER }, async (db) => {
            const { rows } = await db.query('SELECT content FROM hr_ticket_messages_decrypted WHERE ticket_id = $1', [TICKET]);
            assert.equal(rows.length, 0);
        });
    });

    test('texto cifrado copiado para outra linha não abre', async () => {
        await withServiceRole((db) =>
            db.query('UPDATE employees SET telefone = (SELECT telefone FROM employees WHERE id = $1) WHERE id = $2', [E_MGR, E_OTHER])
        );
        try {
            await withUser({ sub: U_OTHER }, async (outro) => {
                const { rows } = await outro.query('SELECT telefone FROM employees_decrypted');
                assert.equal(rows[0].telefone, null);
            });
        } finally {
            await withServiceRole((db) => db.query("UPDATE employees SET telefone = '11 90000-0004' WHERE id = $1", [E_OTHER]));
        }
    });

    test('a view acompanha as colunas da tabela (se falhar: SELECT nexus_refresh_employees_view();)', async () => {
        await withServiceRole(async (db) => {
            const tabela = await db.query(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees' AND column_name <> 'cpf_hash' ORDER BY column_name"
            );
            const view = await db.query(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees_decrypted' ORDER BY column_name"
            );
            assert.deepEqual(
                view.rows.map((r) => r.column_name),
                tabela.rows.map((r) => r.column_name)
            );
        });
    });
});
