const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const PREFIX = 'nexus:enc1:';

const U_RH = '00000000-0000-4000-8000-00000000f001';
const U_A = '00000000-0000-4000-8000-00000000f002';
const U_B = '00000000-0000-4000-8000-00000000f003';

const E_RH = '00000000-0000-4000-9000-00000000f001';
const E_A = '00000000-0000-4000-9000-00000000f002';
const E_B = '00000000-0000-4000-9000-00000000f003';

const MES = '2026-09';
const PROVENTOS = [{ descricao: 'Salário base', valor: 5000 }];
const DESCONTOS = [{ descricao: 'INSS', valor: 550 }];

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A, U_B]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, salary, status)
             VALUES ($1, 'Fin RH', '904.000.000-01', 'fin.rh@test.local', 'RH', 9000, 'Ativo'),
                    ($2, 'Fin A',  '904.000.000-02', 'fin.a@test.local',  'TI', 5000, 'Ativo'),
                    ($3, 'Fin B',  '904.000.000-03', 'fin.b@test.local',  'TI', 4000, 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A, E_B]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A, U_B, E_B]
        );
        await db.query('DELETE FROM payslips WHERE employee_id = ANY($1)', [[E_A, E_B]]);
        await db.query(
            `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
             VALUES ($1, $3, $4, $5, 5000, 550, 4450.5, 'pago'),
                    ($2, $3, $4, $5, 5000, 550, 4450.5, 'pago')`,
            [E_A, E_B, MES, JSON.stringify(PROVENTOS), JSON.stringify(DESCONTOS)]
        );
    });
});

const soCifrado = (valor) => typeof valor === 'string' && valor.startsWith(PREFIX);

async function cru(db, sql, params) {
    await db.query('RESET ROLE');
    try {
        return await db.query(sql, params);
    } finally {
        await db.query('SET LOCAL ROLE authenticated');
    }
}

describe('Holerites cifrados (migration 064)', () => {
    test('o banco guarda tudo cifrado: nenhum valor de salário aparece em claro', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query(
                'SELECT proventos, descontos, total_proventos, total_descontos, salario_liquido FROM payslips WHERE employee_id = $1',
                [E_A]
            );
            for (const coluna of Object.keys(rows[0])) assert.ok(soCifrado(rows[0][coluna]), coluna);
            assert.ok(!JSON.stringify(rows[0]).includes('Salário base'));
        });
    });

    test('o RH lê os valores pela view decifrada, com os tipos originais', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT * FROM payslips_decrypted WHERE employee_id = $1', [E_A]);
            assert.deepEqual(rows[0].proventos, PROVENTOS);
            assert.deepEqual(rows[0].descontos, DESCONTOS);
            assert.equal(Number(rows[0].total_proventos), 5000);
            assert.equal(Number(rows[0].total_descontos), 550);
            assert.equal(Number(rows[0].salario_liquido), 4450.5);
        });
    });

    test('o colaborador lê só o próprio holerite', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT employee_id, salario_liquido FROM payslips_decrypted');
            assert.equal(rows.length, 1);
            assert.equal(rows[0].employee_id, E_A);
            assert.equal(Number(rows[0].salario_liquido), 4450.5);
        });
    });

    test('cifra copiada para o holerite de outra pessoa não abre', async () => {
        await withServiceRole((db) =>
            db.query(
                'UPDATE payslips SET salario_liquido = (SELECT salario_liquido FROM payslips WHERE employee_id = $1 AND mes = $3) WHERE employee_id = $2 AND mes = $3',
                [E_A, E_B, MES]
            )
        );
        try {
            await withUser({ sub: U_B }, async (db) => {
                const { rows } = await db.query('SELECT salario_liquido FROM payslips_decrypted');
                assert.equal(rows[0].salario_liquido, null);
            });
        } finally {
            await withServiceRole((db) => db.query('UPDATE payslips SET salario_liquido = 4450.5 WHERE employee_id = $1 AND mes = $2', [E_B, MES]));
        }
    });

    test('upsert do RH (INSERT ... ON CONFLICT DO UPDATE, como o pagamentos.js) continua legível', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await db.query(
                `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
                 VALUES ($1, $2, $3, $4, 6000, 700, 5300, 'pago')
                 ON CONFLICT (employee_id, mes) DO UPDATE SET
                    proventos = EXCLUDED.proventos, descontos = EXCLUDED.descontos, total_proventos = EXCLUDED.total_proventos,
                    total_descontos = EXCLUDED.total_descontos, salario_liquido = EXCLUDED.salario_liquido, status = EXCLUDED.status`,
                [E_A, MES, JSON.stringify([{ descricao: 'Salário base', valor: 6000 }]), JSON.stringify([{ descricao: 'INSS', valor: 700 }])]
            );
            const { rows } = await db.query('SELECT proventos, salario_liquido FROM payslips_decrypted WHERE employee_id = $1', [E_A]);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].proventos[0].valor, 6000);
            assert.equal(Number(rows[0].salario_liquido), 5300);
        });
        await withServiceRole((db) =>
            db.query(
                `UPDATE payslips SET proventos = $2, descontos = $3, total_proventos = 5000, total_descontos = 550, salario_liquido = 4450.5 WHERE employee_id = $1 AND mes = $4`,
                [E_A, JSON.stringify(PROVENTOS), JSON.stringify(DESCONTOS), MES]
            )
        );
    });

    test('assinar o holerite (sign_payslip) não estraga a cifra', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows: slip } = await db.query('SELECT id FROM payslips_decrypted WHERE mes = $1', [MES]);
            await db.query('SELECT sign_payslip($1, $2)', [slip[0].id, 'Fin A']);
            const { rows } = await db.query('SELECT salario_liquido, assinado_por FROM payslips_decrypted WHERE mes = $1', [MES]);
            assert.equal(Number(rows[0].salario_liquido), 4450.5);
            assert.equal(rows[0].assinado_por, 'Fin A');
        });
    });

    test('um holerite não muda de colaborador nem de mês (a cifra está amarrada aos dois)', async () => {
        await withServiceRole(async (db) => {
            await assert.rejects(db.query("UPDATE payslips SET mes = '2026-10' WHERE employee_id = $1 AND mes = $2", [E_A, MES]), /mudar de colaborador/);
        });
    });

    test('valor monetário inválido é recusado antes de cifrar', async () => {
        await withServiceRole(async (db) => {
            await assert.rejects(
                db.query(
                    `INSERT INTO payslips (employee_id, mes, proventos, descontos, salario_liquido) VALUES ($1, '2026-01', '[]', '[]', 'muito dinheiro')`,
                    [E_A]
                ),
                /inválido/
            );
        });
    });

    test('holerite antigo em claro é lido normalmente e vira cifra no backfill', async () => {
        await withServiceRole(async (db) => {
            await db.query('ALTER TABLE payslips DISABLE TRIGGER payslips_encrypt_trg');
            await db.query(
                `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido)
                 VALUES ($1, '2025-12', '[{"valor":100}]', '[]', '100.00', '0.00', '100.00')`,
                [E_A]
            );
            await db.query('ALTER TABLE payslips ENABLE TRIGGER payslips_encrypt_trg');
        });
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query("SELECT salario_liquido FROM payslips_decrypted WHERE mes = '2025-12'");
            assert.equal(Number(rows[0].salario_liquido), 100);
        });
        await withServiceRole(async (db) => {
            await db.query('UPDATE payslips SET proventos = proventos');
            const { rows } = await db.query("SELECT salario_liquido, proventos FROM payslips WHERE employee_id = $1 AND mes = '2025-12'", [E_A]);
            assert.ok(soCifrado(rows[0].salario_liquido));
            assert.ok(soCifrado(rows[0].proventos));
        });
    });
});

describe('Feedback anônimo cifrado', () => {
    const TEXTO = 'o gestor humilha a equipe nas reuniões';

    test('colaborador envia e o banco guarda cifrado (o texto não aparece em claro)', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await db.query("INSERT INTO anonymous_feedback (categoria, message) VALUES ('infraestrutura', $1)", [TEXTO]);
            const { rows } = await cru(db, "SELECT message FROM anonymous_feedback WHERE categoria = 'infraestrutura'");
            assert.ok(soCifrado(rows[0].message));
            assert.ok(!rows[0].message.includes('humilha'));
        });
    });

    test('o RH lê a mensagem pela view decifrada', async () => {
        await withServiceRole((db) => db.query("INSERT INTO anonymous_feedback (categoria, message) VALUES ('gestao', $1)", [TEXTO]));
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query("SELECT message FROM anonymous_feedback_decrypted WHERE categoria = 'gestao'");
            assert.ok(rows.some((r) => r.message === TEXTO));
        });
    });

    test('colaborador não lê feedback de ninguém, nem o próprio', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT message FROM anonymous_feedback_decrypted');
            assert.equal(rows.length, 0);
        });
    });

    test('o RH marcar como lido não estraga a mensagem', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await db.query("UPDATE anonymous_feedback SET status = 'lido' WHERE categoria = 'gestao'");
            const { rows } = await db.query("SELECT message, status FROM anonymous_feedback_decrypted WHERE categoria = 'gestao'");
            assert.ok(rows.every((r) => r.status === 'lido'));
            assert.ok(rows.some((r) => r.message === TEXTO));
        });
    });

    test('a tabela continua sem qualquer ligação com quem enviou', async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'anonymous_feedback' ORDER BY 1"
            );
            assert.deepEqual(
                rows.map((r) => r.column_name),
                ['categoria', 'created_at', 'id', 'message', 'status']
            );
        });
    });
});

describe('Histórico da IA do RH cifrado', () => {
    test('cache da análise: upsert repetido e atualização de alertas continuam legíveis', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const upsert = (summary, alerts) =>
                db.query(
                    `INSERT INTO ai_analysis_cache (cache_key, summary, alerts, health_score) VALUES ('latest', $1, $2, 80)
                     ON CONFLICT (cache_key) DO UPDATE SET summary = EXCLUDED.summary, alerts = EXCLUDED.alerts, health_score = EXCLUDED.health_score`,
                    [summary, JSON.stringify(alerts)]
                );
            await upsert('Primeira análise', [{ tipo: 'burnout', resolved: false }]);
            await upsert('Segunda análise: 3 pessoas em risco', [{ tipo: 'burnout', resolved: false }, { tipo: 'ferias' }]);
            await db.query("UPDATE ai_analysis_cache SET alerts = $1 WHERE cache_key = 'latest'", [JSON.stringify([{ tipo: 'burnout', resolved: true }])]);

            const { rows } = await db.query("SELECT summary, alerts FROM ai_analysis_cache_decrypted WHERE cache_key = 'latest'");
            assert.equal(rows.length, 1);
            assert.equal(rows[0].summary, 'Segunda análise: 3 pessoas em risco');
            assert.deepEqual(rows[0].alerts, [{ tipo: 'burnout', resolved: true }]);

            const bruto = await cru(db, "SELECT summary, alerts FROM ai_analysis_cache WHERE cache_key = 'latest'");
            assert.ok(soCifrado(bruto.rows[0].summary));
            assert.ok(soCifrado(bruto.rows[0].alerts));
        });
    });

    test('histórico de análises, conversa e memória de decisões: cifrados no banco, legíveis pelo RH', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await db.query("INSERT INTO ai_analysis_history (summary, health_score, alerts) VALUES ('Resumo secreto do mês', 70, $1)", [
                JSON.stringify([{ tipo: 'x' }]),
            ]);
            await db.query("INSERT INTO ai_chat_history (role, content) VALUES ('user', 'quem vai ser demitido?'), ('assistant', 'ninguém está na lista')");
            await db.query("INSERT INTO ai_decision_memory (action_type, description) VALUES ('approve_vacation', 'aprovou férias da Fulana')");

            assert.equal(
                (await db.query("SELECT 1 FROM ai_analysis_history_decrypted WHERE summary = 'Resumo secreto do mês' AND alerts->0->>'tipo' = 'x'")).rows
                    .length,
                1
            );
            assert.equal((await db.query("SELECT 1 FROM ai_chat_history_decrypted WHERE content = 'quem vai ser demitido?'")).rows.length, 1);
            assert.equal((await db.query("SELECT 1 FROM ai_decision_memory_decrypted WHERE description = 'aprovou férias da Fulana'")).rows.length, 1);

            for (const [tabela, coluna] of [
                ['ai_analysis_history', 'summary'],
                ['ai_chat_history', 'content'],
                ['ai_decision_memory', 'description'],
            ]) {
                const { rows } = await cru(db, `SELECT ${coluna} AS v FROM ${tabela}`);
                assert.ok(rows.length > 0 && rows.every((r) => soCifrado(r.v)), tabela);
            }
        });
    });

    test('colaborador não lê nada do histórico da IA do RH', async () => {
        await withServiceRole(async (db) => {
            await db.query("INSERT INTO ai_chat_history (role, content) VALUES ('user', 'conversa só do RH')");
            await db.query("INSERT INTO ai_decision_memory (action_type, description) VALUES ('x', 'memória só do RH')");
        });
        await withUser({ sub: U_A }, async (db) => {
            for (const view of ['ai_analysis_cache_decrypted', 'ai_analysis_history_decrypted', 'ai_chat_history_decrypted', 'ai_decision_memory_decrypted']) {
                assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${view}`)).rows[0].n, 0, view);
            }
        });
    });

    test('log de decisões: RH lê tudo; o colaborador citado lê só o seu; os outros nada', async () => {
        const evidencia = { dias: 30, motivo: 'atestado' };
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO ai_decision_log (employee_id, target_table, target_id, action_type, ai_message, evidence)
                 VALUES ($1, 'vacations', gen_random_uuid(), 'approve_vacation', 'Férias aprovadas por baixo risco', $2)`,
                [E_A, JSON.stringify(evidencia)]
            )
        );
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT ai_message, evidence FROM ai_decision_log WHERE employee_id = $1', [E_A]);
            assert.ok(soCifrado(rows[0].ai_message));
            assert.ok(soCifrado(rows[0].evidence));
        });
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT ai_message, evidence FROM ai_decision_log_decrypted WHERE employee_id = $1', [E_A]);
            assert.equal(rows[0].ai_message, 'Férias aprovadas por baixo risco');
            assert.deepEqual(rows[0].evidence, evidencia);
        });
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT ai_message FROM ai_decision_log_decrypted');
            assert.equal(rows.length, 1);
            assert.equal(rows[0].ai_message, 'Férias aprovadas por baixo risco');
        });
        await withUser({ sub: U_B }, async (db) => {
            assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_decision_log_decrypted')).rows[0].n, 0);
        });
    });

    test('a decifragem do histórico da IA depende do RH logado (service role, sem usuário, recebe NULL)', async () => {
        await withServiceRole(async (db) => {
            await db.query("INSERT INTO ai_decision_memory (action_type, description) VALUES ('y', 'memória para o teste do service role')");
            const { rows } = await db.query(
                "SELECT nexus_decrypt_ctx('ai:mem:' || id::text || ':description', description) AS d FROM ai_decision_memory LIMIT 1"
            );
            assert.equal(rows[0].d, null);
        });
    });
});

describe('Indicadores PcD e pensão alimentícia cifrados', () => {
    test('o banco guarda cifrado; a view devolve booleanos; o dono lê o próprio', async () => {
        await withServiceRole((db) => db.query('UPDATE employees SET pcd = $2, pensao_alimenticia = $3 WHERE id = $1', [E_A, 'true', 'false']));
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT pcd, pensao_alimenticia FROM employees WHERE id = $1', [E_A]);
            assert.ok(soCifrado(rows[0].pcd));
            assert.ok(soCifrado(rows[0].pensao_alimenticia));
        });
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT pcd, pensao_alimenticia FROM employees_decrypted WHERE id = $1', [E_A]);
            assert.equal(rows[0].pcd, true);
            assert.equal(rows[0].pensao_alimenticia, false);
        });
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT pcd FROM employees_decrypted WHERE id = $1', [E_A]);
            assert.equal(rows[0].pcd, true);
        });
    });

    test('quem não informou usa o padrão (false), também cifrado', async () => {
        await withServiceRole(async (db) => {
            const { rows: cru } = await db.query('SELECT pcd FROM employees WHERE id = $1', [E_B]);
            assert.ok(soCifrado(cru[0].pcd));
        });
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT pcd, pensao_alimenticia FROM employees_decrypted WHERE id = $1', [E_B]);
            assert.equal(rows[0].pcd, false);
            assert.equal(rows[0].pensao_alimenticia, false);
        });
    });

    test('a cifra do indicador de uma pessoa não abre na linha de outra', async () => {
        await withServiceRole((db) => db.query('UPDATE employees SET pcd = (SELECT pcd FROM employees WHERE id = $1) WHERE id = $2', [E_A, E_B]));
        try {
            await withUser({ sub: U_RH }, async (db) => {
                const { rows } = await db.query('SELECT pcd FROM employees_decrypted WHERE id = $1', [E_B]);
                assert.equal(rows[0].pcd, null);
            });
        } finally {
            await withServiceRole((db) => db.query("UPDATE employees SET pcd = 'false' WHERE id = $1", [E_B]));
        }
    });

    test('valor que não é booleano é recusado', async () => {
        await withServiceRole(async (db) => {
            await assert.rejects(db.query("UPDATE employees SET pcd = 'talvez' WHERE id = $1", [E_A]), /PcD inválido/);
            await assert.rejects(db.query("UPDATE employees SET pensao_alimenticia = 'quase' WHERE id = $1", [E_A]), /pensão alimentícia inválido/);
        });
    });

    test('a view acompanha as colunas da tabela', async () => {
        await withServiceRole(async (db) => {
            const cols = async (tabela) =>
                (
                    await db.query(
                        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name <> 'cpf_hash' ORDER BY column_name`,
                        [tabela]
                    )
                ).rows.map((r) => r.column_name);
            assert.deepEqual(await cols('employees_decrypted'), await cols('employees'));
        });
    });
});

describe('Views decifradas de dados novos', () => {
    const VIEWS = [
        'payslips_decrypted',
        'anonymous_feedback_decrypted',
        'ai_analysis_cache_decrypted',
        'ai_analysis_history_decrypted',
        'ai_chat_history_decrypted',
        'ai_decision_memory_decrypted',
        'ai_decision_log_decrypted',
    ];

    for (const view of VIEWS) {
        test(`anon não recebe nenhuma linha de ${view}`, async () => {
            await withUser({ sub: '', role: 'anon' }, async (db) => {
                let n = 0;
                try {
                    n = (await db.query(`SELECT count(*)::int AS n FROM ${view}`)).rows[0].n;
                } catch (e) {
                    assert.match(e.message, /permission denied/);
                }
                assert.equal(n, 0);
            });
        });
    }
});
