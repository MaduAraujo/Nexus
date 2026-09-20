const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000a001';
const E_RH = '00000000-0000-4000-9000-00000000a000';
const E1 = '00000000-0000-4000-9000-00000000a001';
const E2 = '00000000-0000-4000-9000-00000000a002';
const CH = '00000000-0000-4000-b000-00000000a001';
const TICKET = '00000000-0000-4000-a000-00000000a001';
const ID = (n) => `00000000-0000-4000-c000-00000000a0${String(n).padStart(2, '0')}`;
const SEED_IDS = { feedback: ID(1), newFeedback: ID(2), history: ID(3), aichat: ID(4), memory: ID(5), log: ID(6) };

const ROTATION_KEYS = ['data_encryption_key_v2', 'data_encryption_key_v3', 'data_hmac_key_v2'];

async function cleanKeys(db) {
    await db.query('DELETE FROM nexus_key_store WHERE name = ANY($1)', [ROTATION_KEYS]);
}

async function seed(db) {
    await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [U_RH]);
    await db.query(
        `INSERT INTO employees (id, name, cpf, email, dept, status)
         VALUES ($1, 'Rot RH', '906.000.000-00', 'rot.rh@test.local', 'RH', 'Ativo') ON CONFLICT (id) DO NOTHING`,
        [E_RH]
    );
    await db.query(`INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2) ON CONFLICT (id) DO NOTHING`, [U_RH, E_RH]);
    await db.query(
        `INSERT INTO employees (id, name, cpf, rg, telefone, email, dept, salary, chave_pix, agencia, conta, birth_date, gender, raca_cor, deficiencia, tipo_pensao, pcd, pensao_alimenticia, status)
         VALUES ($1, 'Rot Um',   '906.100.000-01', 'RG-1', '11 91111-1111', 'rot1@test.local', 'TI', 7000.5, 'rot1@pix', '0011', '111-1', '1990-05-17', 'Feminino',  'Parda',  'Visual', 'Judicial', true,  true,  'Ativo'),
                ($2, 'Rot Dois', '906.100.000-02', 'RG-2', '11 92222-2222', 'rot2@test.local', 'TI', 4200,   'rot2@pix', '0022', '222-2', '1985-11-02', 'Masculino', 'Branca', 'Nenhuma', 'Nenhuma',  false, false, 'Ativo')
         ON CONFLICT (id) DO NOTHING`,
        [E1, E2]
    );
    await db.query(
        `INSERT INTO chat_channels (id, name, slug, kind) VALUES ($1, 'Canal rotação', 'canal-rotacao-teste', 'channel') ON CONFLICT (id) DO NOTHING`,
        [CH]
    );
    await db.query(`INSERT INTO chat_messages (channel_id, employee_id, content) VALUES ($1, $2, 'rot:seed mensagem do canal')`, [CH, E1]);
    await db.query(`INSERT INTO hr_tickets (id, employee_id, status) VALUES ($1, $2, 'em_atendimento') ON CONFLICT (id) DO NOTHING`, [TICKET, E1]);
    await db.query(`INSERT INTO hr_ticket_messages (ticket_id, employee_id, role, content) VALUES ($1, $2, 'user', 'rot:seed dúvida do chamado')`, [
        TICKET,
        E1,
    ]);
    await db.query(
        `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
         VALUES ($1, '2026-10', '[{"descricao":"Base","valor":7000.5}]', '[{"descricao":"INSS","valor":700}]', 7000.5, 700, 6300.5, 'pago')`,
        [E1]
    );
    await db.query(`INSERT INTO anonymous_feedback (id, categoria, message) VALUES ($1, 'clima', 'rot:seed feedback anônimo')`, [SEED_IDS.feedback]);
    await db.query(
        `INSERT INTO ai_analysis_cache (cache_key, summary, alerts, health_score) VALUES ('rot-test', 'rot:seed resumo do cache', '[{"tipo":"a"}]', 70)`
    );
    await db.query(`INSERT INTO ai_analysis_history (id, summary, health_score, alerts) VALUES ($1, 'rot:seed resumo do histórico', 70, '[{"tipo":"b"}]')`, [
        SEED_IDS.history,
    ]);
    await db.query(`INSERT INTO ai_chat_history (id, role, content) VALUES ($1, 'user', 'rot:seed conversa com a IA')`, [SEED_IDS.aichat]);
    await db.query(`INSERT INTO ai_decision_memory (id, action_type, description) VALUES ($1, 'x', 'rot:seed memória de decisão')`, [SEED_IDS.memory]);
    await db.query(
        `INSERT INTO ai_decision_log (id, employee_id, target_table, target_id, action_type, ai_message, evidence)
         VALUES ($1, $2, 'vacations', gen_random_uuid(), 'x', 'rot:seed mensagem da IA', '{"k":1}')`,
        [SEED_IDS.log, E1]
    );
}

async function removeSeed(db) {
    await db.query('DELETE FROM anonymous_feedback WHERE id = ANY($1)', [[SEED_IDS.feedback, SEED_IDS.newFeedback]]);
    await db.query('DELETE FROM ai_analysis_history WHERE id = $1', [SEED_IDS.history]);
    await db.query('DELETE FROM ai_chat_history WHERE id = $1', [SEED_IDS.aichat]);
    await db.query('DELETE FROM ai_decision_memory WHERE id = $1', [SEED_IDS.memory]);
    await db.query('DELETE FROM ai_decision_log WHERE id = $1', [SEED_IDS.log]);
    await db.query("DELETE FROM ai_analysis_cache WHERE cache_key = 'rot-test'");
    await db.query('DELETE FROM hr_ticket_messages WHERE ticket_id = $1', [TICKET]);
    await db.query('DELETE FROM hr_tickets WHERE id = $1', [TICKET]);
    await db.query('DELETE FROM chat_messages WHERE channel_id = $1', [CH]);
    await db.query('DELETE FROM chat_channels WHERE id = $1', [CH]);
    await db.query('DELETE FROM payslips WHERE employee_id = $1', [E1]);
    await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E1, E2, E_RH]]);
    await db.query('DELETE FROM profiles WHERE id = $1', [U_RH]);
}

async function snapshot() {
    return withUser({ sub: U_RH }, async (db) => {
        const q = async (sql, params) => (await db.query(sql, params)).rows;
        return {
            employees: await q(
                `SELECT id, cpf, rg, telefone, salary, chave_pix, agencia, conta, birth_date, gender, raca_cor, deficiencia, tipo_pensao, pcd, pensao_alimenticia
                   FROM employees_decrypted WHERE id = ANY($1) ORDER BY id`,
                [[E1, E2]]
            ),
            chat: await q('SELECT content FROM chat_messages_decrypted WHERE channel_id = $1', [CH]),
            ticket: await q('SELECT content FROM hr_ticket_messages_decrypted WHERE ticket_id = $1', [TICKET]),
            payslips: await q(
                'SELECT mes, proventos, descontos, total_proventos, total_descontos, salario_liquido FROM payslips_decrypted WHERE employee_id = $1',
                [E1]
            ),
            feedback: await q("SELECT message FROM anonymous_feedback_decrypted WHERE message LIKE 'rot:seed%'"),
            cache: await q("SELECT summary, alerts FROM ai_analysis_cache_decrypted WHERE cache_key = 'rot-test'"),
            history: await q("SELECT summary, alerts FROM ai_analysis_history_decrypted WHERE summary LIKE 'rot:seed%'"),
            aichat: await q("SELECT content FROM ai_chat_history_decrypted WHERE content LIKE 'rot:seed%'"),
            memory: await q("SELECT description FROM ai_decision_memory_decrypted WHERE description LIKE 'rot:seed%'"),
            log: await q('SELECT ai_message, evidence FROM ai_decision_log_decrypted WHERE employee_id = $1', [E1]),
        };
    });
}

function assertNothingNull(snap, where) {
    for (const [table, rows] of Object.entries(snap)) {
        assert.ok(rows.length > 0, `${where}: ${table} sem linhas`);
        for (const row of rows)
            for (const [col, value] of Object.entries(row)) assert.notEqual(value, null, `${where}: ${table}.${col} veio NULL (não decifrou)`);
    }
}

const summary = async (db) =>
    Object.fromEntries(
        (await db.query('SELECT scope, kid, cipher_values FROM nexus_key_summary()')).rows.map((r) => [`${r.scope}/${r.kid}`, Number(r.cipher_values)])
    );

async function rewrapUntilDone(db, batch) {
    let total = 0;
    for (let i = 0; i < 500; i++) {
        const { rows } = await db.query('SELECT * FROM nexus_rewrap_all($1)', [batch]);
        const done = rows.reduce((sum, r) => sum + Number(r.rewrapped), 0);
        if (done === 0) return total;
        total += done;
    }
    throw new Error('a recifragem não terminou');
}

let original;

before(async () => {
    await withServiceRole(async (db) => {
        await cleanKeys(db);
        await seed(db);
    });
    original = await snapshot();
});

after(async () => {
    await withServiceRole(async (db) => {
        try {
            await db.query("SELECT nexus_key_activate('encryption', 'v1')");
            await rewrapUntilDone(db, 500);
            await db.query("SELECT nexus_key_activate('hmac', 'v1')");
        } finally {
            await removeSeed(db);
            await cleanKeys(db);
        }
    });
});

describe('Rotação da chave de cifragem de colunas (migration 067)', () => {
    test('ponto de partida: tudo na chave v1, nada em claro, nada fora da lista, e o RH lê tudo', async () => {
        assertNothingNull(original, 'antes');
        await withServiceRole(async (db) => {
            const s = await summary(db);
            assert.ok(s['encryption/v1'] > 0);
            assert.equal(s['encryption/plaintext'] ?? 0, 0);
            assert.equal(Object.keys(s).filter((k) => k.startsWith('unregistered/')).length, 0, JSON.stringify(s));
            assert.deepEqual(
                Object.keys(s).filter((k) => k.startsWith('encryption/')),
                ['encryption/v1']
            );
        });
    });

    test('com a v1 ativa nada muda no que é gravado: continua nexus:enc1:', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT cpf FROM employees WHERE id = $1', [E1]);
            assert.ok(rows[0].cpf.startsWith('nexus:enc1:'));
        });
    });

    test('gerar chave: identificador inválido, "v1" e repetição são recusados; gerar não ativa', async () => {
        await withServiceRole(async (db) => {
            await assert.rejects(db.query("SELECT nexus_key_generate('encryption', 'V 2')"), /inválido/);
            await assert.rejects(db.query("SELECT nexus_key_generate('encryption', 'v1')"), /original/);
            await assert.rejects(db.query("SELECT nexus_key_generate('senha', 'v2')"), /Finalidade/);
            await db.query("SELECT nexus_key_generate('encryption', 'v2')");
            await assert.rejects(db.query("SELECT nexus_key_generate('encryption', 'v2')"), /já existe/);
            assert.equal((await db.query("SELECT nexus_active_kid('encryption') AS k")).rows[0].k, 'v1');
        });
    });

    test('ativar chave que não existe é recusado e nada muda', async () => {
        await withServiceRole(async (db) => {
            await assert.rejects(db.query("SELECT nexus_key_activate('encryption', 'v9')"), /não existe/);
            assert.equal((await db.query("SELECT nexus_active_kid('encryption') AS k")).rows[0].k, 'v1');
        });
    });

    test('ativar v2: gravações novas já usam v2 e o que estava em v1 continua legível (chaves convivem)', async () => {
        await withServiceRole(async (db) => {
            await db.query("SELECT nexus_key_activate('encryption', 'v2')");
            await db.query("INSERT INTO anonymous_feedback (id, categoria, message) VALUES ($1, 'clima', 'rot:novo depois da ativação')", [
                SEED_IDS.newFeedback,
            ]);
            const { rows } = await db.query('SELECT message FROM anonymous_feedback WHERE id = $1', [SEED_IDS.newFeedback]);
            assert.ok(rows[0].message.startsWith('nexus:enc2:v2:'));
            const s = await summary(db);
            assert.ok(s['encryption/v1'] > 0 && s['encryption/v2'] > 0);
        });
        assert.deepEqual(await snapshot(), original);
    });

    test('valores em chaves diferentes na mesma linha: o RH edita normalmente (o trigger reconhece enc1 e enc2)', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await db.query("UPDATE employees SET telefone = '11 91111-1111', bio = 'edição durante a rotação' WHERE id = $1", [E1]);
            const { rows } = await db.query('SELECT telefone, salary FROM employees_decrypted WHERE id = $1', [E1]);
            assert.equal(rows[0].telefone, '11 91111-1111');
            assert.equal(Number(rows[0].salary), 7000.5);
        });
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT telefone, salary FROM employees WHERE id = $1', [E1]);
            assert.ok(rows[0].telefone.startsWith('nexus:enc2:v2:'));
            assert.ok(rows[0].salary.startsWith('nexus:enc1:'));
        });
        assert.deepEqual(await snapshot(), original);
    });

    test('recifrar em lotes: a cada lote, parte já está em v2 e tudo continua legível; no fim, nada resta em v1', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT * FROM nexus_rewrap_all(1)');
            assert.ok(
                rows.some((r) => Number(r.rewrapped) > 0),
                'o primeiro lote deveria recifrar algo'
            );
        });
        assert.deepEqual(await snapshot(), original, 'com a rotação pela metade');

        await withServiceRole(async (db) => {
            assert.ok((await rewrapUntilDone(db, 1)) > 0);
            const s = await summary(db);
            assert.equal(s['encryption/v1'] ?? 0, 0);
            assert.equal(s['encryption/plaintext'] ?? 0, 0);
            assert.ok(s['encryption/v2'] > 0);
            assert.equal(Object.keys(s).filter((k) => k.startsWith('unregistered/')).length, 0);
        });
        assert.deepEqual(await snapshot(), original, 'depois da rotação');
    });

    test('tudo o que está cifrado no banco agora tem o prefixo da v2 (conferido coluna a coluna)', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query("SELECT object, kid, cipher_values FROM nexus_key_status() WHERE scope = 'encryption'");
            assert.ok(rows.length > 20);
            for (const r of rows) assert.equal(r.kid, 'v2', `${r.object} ainda em ${r.kid}`);
        });
    });

    test('rodar de novo não faz nada (idempotente)', async () => {
        await withServiceRole(async (db) => assert.equal(await rewrapUntilDone(db, 500), 0));
    });

    test('depois da rotação o RH segue editando colaborador e holerite (upsert como o pagamentos.js)', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await db.query('UPDATE employees SET salary = 7100 WHERE id = $1', [E1]);
            await db.query(
                `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
                 VALUES ($1, '2026-10', '[{"descricao":"Base","valor":7100}]', '[]', 7100, 0, 7100, 'pago')
                 ON CONFLICT (employee_id, mes) DO UPDATE SET proventos = EXCLUDED.proventos, salario_liquido = EXCLUDED.salario_liquido`,
                [E1]
            );
            const emp = await db.query('SELECT salary FROM employees_decrypted WHERE id = $1', [E1]);
            const slip = await db.query("SELECT salario_liquido FROM payslips_decrypted WHERE employee_id = $1 AND mes = '2026-10'", [E1]);
            assert.equal(Number(emp.rows[0].salary), 7100);
            assert.equal(Number(slip.rows[0].salario_liquido), 7100);
        });
        await withServiceRole(async (db) => {
            await db.query('UPDATE employees SET salary = 7000.5 WHERE id = $1', [E1]);
            await db.query(
                `UPDATE payslips SET proventos = '[{"descricao":"Base","valor":7000.5}]', descontos = '[{"descricao":"INSS","valor":700}]', total_proventos = 7000.5, total_descontos = 700, salario_liquido = 6300.5
                  WHERE employee_id = $1 AND mes = '2026-10'`,
                [E1]
            );
        });
        assert.deepEqual(await snapshot(), original);
    });

    test('valor que não decifra interrompe a rotação com o nome da tabela e não grava nada (a chave antiga não se perde)', async () => {
        await withServiceRole(async (db) => {
            await db.query("SELECT nexus_key_generate('encryption', 'v3')");
            await db.query("SELECT nexus_key_activate('encryption', 'v3')");
            await db.query('UPDATE employees SET telefone = (SELECT telefone FROM employees WHERE id = $1) WHERE id = $2', [E1, E2]);

            await assert.rejects(db.query('SELECT * FROM nexus_rewrap_all(500)'), /Rotação interrompida em employees/);

            const { rows } = await db.query('SELECT kid FROM nexus_key_status() WHERE object = $1', ['employees.cpf']);
            assert.deepEqual(
                rows.map((r) => r.kid),
                ['v2'],
                'nada foi gravado na chamada que falhou'
            );

            await db.query("UPDATE employees SET telefone = '11 92222-2222' WHERE id = $1", [E2]);
            assert.ok((await rewrapUntilDone(db, 500)) > 0);
            const s = await summary(db);
            assert.equal(s['encryption/v2'] ?? 0, 0);
            assert.ok(s['encryption/v3'] > 0);
        });
        assert.deepEqual(await snapshot(), original);
    });

    test('valor cifrado com chave que não está mais no Vault também interrompe (em vez de virar NULL)', async () => {
        await withServiceRole(async (db) => {
            await db.query("UPDATE employees SET rg = 'nexus:enc2:zz9:AAAA' WHERE id = $1", [E2]);
            await assert.rejects(db.query('SELECT * FROM nexus_rewrap_all(500)'), /não está mais no Vault/);
            await db.query("UPDATE employees SET rg = 'RG-2' WHERE id = $1", [E2]);
        });
    });

    test('coluna de texto fora da lista que contenha valor cifrado é apontada (a rotação não a alcançaria)', async () => {
        await withServiceRole(async (db) => {
            await db.query('CREATE TABLE public.zz_rotacao_probe (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nota TEXT)');
            try {
                await db.query("INSERT INTO public.zz_rotacao_probe (nota) VALUES (nexus_wrap('probe:x', 'segredo'))");
                const { rows } = await db.query("SELECT object, kid, cipher_values FROM nexus_key_status() WHERE scope = 'unregistered'");
                assert.deepEqual(
                    rows.map((r) => [r.object, r.kid, Number(r.cipher_values)]),
                    [['zz_rotacao_probe.nota', 'v3', 1]]
                );
            } finally {
                await db.query('DROP TABLE public.zz_rotacao_probe');
            }
            assert.equal((await db.query("SELECT count(*)::int AS n FROM nexus_key_status() WHERE scope = 'unregistered'")).rows[0].n, 0);
        });
    });

    test('voltar para a v1 também funciona (rotação nos dois sentidos) e tudo volta a nexus:enc1:', async () => {
        await withServiceRole(async (db) => {
            await db.query("SELECT nexus_key_activate('encryption', 'v1')");
            assert.ok((await rewrapUntilDone(db, 500)) > 0);
            const s = await summary(db);
            assert.equal(s['encryption/v3'] ?? 0, 0);
            assert.ok(s['encryption/v1'] > 0);
        });
        assert.deepEqual(await snapshot(), original);
    });

    test('as funções de rotação não estão liberadas para a API', async () => {
        await withServiceRole(async (db) => {
            for (const assinatura of [
                'nexus_key_generate(text,text)',
                'nexus_key_activate(text,text)',
                'nexus_rewrap_all(integer)',
                'nexus_rewrap(text,text)',
                'nexus_key_status()',
                'nexus_key_summary()',
                'nexus_encrypt_with(text,text,text)',
                'nexus_active_kid(text)',
            ]) {
                for (const role of ['anon', 'authenticated']) {
                    const { rows } = await db.query('SELECT has_function_privilege($1, $2, $3) AS ok', [role, assinatura, 'EXECUTE']);
                    assert.equal(rows[0].ok, false, `${role} não deveria executar ${assinatura}`);
                }
            }
        });
        await withUser({ sub: U_RH }, async (db) => {
            let visible = 0;
            try {
                visible = (await db.query('SELECT count(*)::int AS n FROM nexus_key_config')).rows[0].n;
            } catch (e) {
                assert.match(e.message, /permission denied/);
            }
            assert.equal(visible, 0);
        });
    });
});

describe('Rotação da chave do índice de CPF (HMAC)', () => {
    test('ativar a nova chave recalcula todos os índices de uma vez e a busca por CPF continua funcionando', async () => {
        await withServiceRole(async (db) => {
            const before = (await db.query('SELECT id, cpf_hash FROM employees WHERE id = ANY($1) ORDER BY id', [[E1, E2]])).rows;
            assert.equal((await db.query("SELECT nexus_blind_index('906.100.000-01') = $1 AS ok", [before[0].cpf_hash])).rows[0].ok, true);

            await db.query("SELECT nexus_key_generate('hmac', 'v2')");
            await db.query("SELECT nexus_key_activate('hmac', 'v2')");

            const after = (await db.query('SELECT id, cpf_hash FROM employees WHERE id = ANY($1) ORDER BY id', [[E1, E2]])).rows;
            assert.notEqual(after[0].cpf_hash, before[0].cpf_hash);
            assert.notEqual(after[1].cpf_hash, before[1].cpf_hash);
            assert.equal((await db.query("SELECT nexus_blind_index('906.100.000-01') = $1 AS ok", [after[0].cpf_hash])).rows[0].ok, true);
            assert.equal(
                (await db.query("SELECT nexus_blind_index('90610000001') = $1 AS ok", [after[0].cpf_hash])).rows[0].ok,
                true,
                'pontuação do CPF não importa'
            );

            const stale = (await db.query("SELECT cipher_values FROM nexus_key_status() WHERE scope = 'hmac' AND kid = 'stale'")).rows[0];
            assert.equal(Number(stale.cipher_values), 0);
            const active = (await db.query("SELECT kid, cipher_values FROM nexus_key_status() WHERE scope = 'hmac' AND kid <> 'stale'")).rows[0];
            assert.equal(active.kid, 'v2');
            assert.ok(Number(active.cipher_values) >= 3);
        });
    });

    test('a unicidade de CPF continua valendo com a chave nova', async () => {
        await withServiceRole(async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO employees (name, cpf, email, status) VALUES ('Duplicado', '906.100.000-01', 'dup.rot@test.local', 'Ativo')`),
                /cpf_hash|duplicate|unique/i
            );
        });
    });

    test('voltar para a chave original recalcula de novo', async () => {
        await withServiceRole(async (db) => {
            await db.query("SELECT nexus_key_activate('hmac', 'v1')");
            const { rows } = await db.query('SELECT cpf_hash FROM employees WHERE id = $1', [E1]);
            assert.equal((await db.query("SELECT nexus_blind_index('906.100.000-01') = $1 AS ok", [rows[0].cpf_hash])).rows[0].ok, true);
            const stale = (await db.query("SELECT cipher_values FROM nexus_key_status() WHERE scope = 'hmac' AND kid = 'stale'")).rows[0];
            assert.equal(Number(stale.cipher_values), 0);
        });
    });
});
