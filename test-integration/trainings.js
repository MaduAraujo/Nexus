const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const FORBIDDEN = { code: '42501' };

const U_RH = '00000000-0000-4000-8000-00000000f401';
const U_MGR = '00000000-0000-4000-8000-00000000f402';
const U_SUB = '00000000-0000-4000-8000-00000000f403';
const U_OUT = '00000000-0000-4000-8000-00000000f404';

const E_RH = '00000000-0000-4000-9000-00000000f401';
const E_MGR = '00000000-0000-4000-9000-00000000f402';
const E_SUB = '00000000-0000-4000-9000-00000000f403';
const E_OUT = '00000000-0000-4000-9000-00000000f404';

let catalogId, inactiveCatalogId;

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_MGR, U_SUB, U_OUT]) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, manager_id, status)
             VALUES ($1, 'TR RH Fixture',   '909.000.000-01', 'tr.rh@test.local',  'RH', NULL, 'Ativo'),
                    ($2, 'TR Gestor Fixture','909.000.000-02', 'tr.mgr@test.local', 'TI', NULL, 'Ativo'),
                    ($3, 'TR Liderado Fixture','909.000.000-03', 'tr.sub@test.local', 'TI', $2, 'Ativo'),
                    ($4, 'TR Fora Fixture',  '909.000.000-04', 'tr.out@test.local', 'Vendas', NULL, 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_MGR, E_SUB, E_OUT]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES
                ($1, 'Administrador', $2),
                ($3, 'colaborador', $4),
                ($5, 'colaborador', $6),
                ($7, 'colaborador', $8)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_MGR, E_MGR, U_SUB, E_SUB, U_OUT, E_OUT]
        );
        const t1 = await db.query(
            `INSERT INTO trainings (title, category, duration_hours) VALUES ('Treinamento de Teste Ativo', 'Compliance', 4) RETURNING id`
        );
        catalogId = t1.rows[0].id;
        const t2 = await db.query(`INSERT INTO trainings (title, active) VALUES ('Treinamento de Teste Inativo', false) RETURNING id`);
        inactiveCatalogId = t2.rows[0].id;
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM employee_trainings WHERE employee_id = ANY($1)', [[E_RH, E_MGR, E_SUB, E_OUT]]);
        await db.query('DELETE FROM trainings WHERE id = ANY($1)', [[catalogId, inactiveCatalogId]]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_MGR, U_SUB, U_OUT]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_MGR, U_SUB, U_OUT]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_MGR, E_SUB, E_OUT]]);
    });
});

describe('RLS: trainings (catálogo)', () => {
    test('qualquer autenticado vê o catálogo ativo', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT title FROM trainings WHERE id = $1', [catalogId]);
            assert.equal(rows.length, 1);
        });
    });

    test('treinamento inativo não aparece para colaborador nem gestor', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT id FROM trainings WHERE id = $1', [inactiveCatalogId]);
            assert.equal(rows.length, 0);
        });
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query('SELECT id FROM trainings WHERE id = $1', [inactiveCatalogId]);
            assert.equal(rows.length, 0);
        });
    });

    test('RH vê o catálogo inteiro, inclusive inativos, e consegue gerenciar', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const sel = await db.query('SELECT id FROM trainings WHERE id = $1', [inactiveCatalogId]);
            assert.equal(sel.rows.length, 1);
            const ins = await db.query(`INSERT INTO trainings (title) VALUES ('Cat Temp RLS') RETURNING id`);
            const del = await db.query(`DELETE FROM trainings WHERE id = $1 RETURNING id`, [ins.rows[0].id]);
            assert.equal(del.rows.length, 1);
        });
    });

    test('gestor e colaborador não conseguem criar item no catálogo', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            await assert.rejects(db.query(`INSERT INTO trainings (title) VALUES ('Catálogo Indevido Gestor')`), FORBIDDEN);
        });
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(db.query(`INSERT INTO trainings (title) VALUES ('Catálogo Indevido Colab')`), FORBIDDEN);
        });
    });
});

describe('RLS: employee_trainings — atribuição (RH e gestor)', () => {
    test('RH atribui treinamento para qualquer colaborador', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query(
                `INSERT INTO employee_trainings (employee_id, training_id, title, hours, assigned_by_name) VALUES ($1, $2, 'Treinamento de Teste Ativo', 4, 'RH') RETURNING id, status, source`,
                [E_OUT, catalogId]
            );
            assert.equal(rows.length, 1);
            assert.equal(rows[0].status, 'pendente');
            assert.equal(rows[0].source, 'atribuido');
        });
    });

    test('gestor atribui treinamento para quem lidera', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query(
                `INSERT INTO employee_trainings (employee_id, title, hours, assigned_by_name) VALUES ($1, 'Treinamento Avulso', 2, 'Gestor') RETURNING id`,
                [E_SUB]
            );
            assert.equal(rows.length, 1);
        });
    });

    test('gestor não atribui para quem não lidera', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            await assert.rejects(db.query(`INSERT INTO employee_trainings (employee_id, title) VALUES ($1, 'Indevido')`, [E_OUT]), FORBIDDEN);
        });
    });

    test('colaborador não consegue atribuir treinamento "de RH" para si mesmo (fora da autodeclaração)', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO employee_trainings (employee_id, title, source, status) VALUES ($1, 'Trapaça', 'atribuido', 'concluido')`, [E_SUB]),
                FORBIDDEN
            );
        });
    });
});

describe('RLS: employee_trainings — visibilidade e autodeclaração do colaborador', () => {
    let pendingId, approvedId;

    before(async () => {
        await withServiceRole(async (db) => {
            const r1 = await db.query(
                `INSERT INTO employee_trainings (employee_id, title, status) VALUES ($1, 'Atribuído Pendente', 'pendente') RETURNING id`,
                [E_SUB]
            );
            pendingId = r1.rows[0].id;
            const r2 = await db.query(
                `INSERT INTO employee_trainings (employee_id, title, status, completion_date) VALUES ($1, 'Já Concluído', 'concluido', CURRENT_DATE) RETURNING id`,
                [E_SUB]
            );
            approvedId = r2.rows[0].id;
        });
    });

    test('colaborador vê os próprios registros, mesmo os ainda pendentes', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT id FROM employee_trainings WHERE id = ANY($1)', [[pendingId, approvedId]]);
            assert.equal(rows.length, 2);
        });
    });

    test('colega de fora não vê os registros de outro colaborador', async () => {
        await withUser({ sub: U_OUT }, async (db) => {
            const { rows } = await db.query('SELECT id FROM employee_trainings WHERE id = ANY($1)', [[pendingId, approvedId]]);
            assert.equal(rows.length, 0);
        });
    });

    test('colaborador autodeclara um curso externo, ficando pendente de aprovação', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(
                `INSERT INTO employee_trainings (employee_id, title, hours, source, status, certificate_url)
                 VALUES ($1, 'Curso Externo de Excel', 8, 'autodeclarado', 'aguardando_aprovacao', 'https://exemplo.com/cert.pdf') RETURNING id, status`,
                [E_SUB]
            );
            assert.equal(rows.length, 1);
            assert.equal(rows[0].status, 'aguardando_aprovacao');
        });
    });

    test('colaborador não consegue autodeclarar já como concluído (pula a aprovação do RH)', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO employee_trainings (employee_id, title, source, status) VALUES ($1, 'Trapaça 2', 'autodeclarado', 'concluido')`, [E_SUB]),
                FORBIDDEN
            );
        });
    });

    test('colaborador não consegue autodeclarar em nome de outro colaborador', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(
                db.query(
                    `INSERT INTO employee_trainings (employee_id, title, source, status) VALUES ($1, 'Trapaça 3', 'autodeclarado', 'aguardando_aprovacao')`,
                    [E_OUT]
                ),
                FORBIDDEN
            );
        });
    });
});

describe('RLS: employee_trainings — editar/retirar autodeclaração enquanto pendente', () => {
    let selfReportId;

    before(async () => {
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO employee_trainings (employee_id, title, hours, source, status) VALUES ($1, 'Autodeclarado Editável', 6, 'autodeclarado', 'aguardando_aprovacao') RETURNING id`,
                [E_SUB]
            );
            selfReportId = r.rows[0].id;
        });
    });

    test('colaborador corrige a própria autodeclaração enquanto está pendente', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`UPDATE employee_trainings SET hours = 10 WHERE id = $1 RETURNING hours`, [selfReportId]);
            assert.equal(rows.length, 1);
            assert.equal(Number(rows[0].hours), 10);
        });
    });

    test('colega de fora não altera a autodeclaração alheia', async () => {
        await withUser({ sub: U_OUT }, async (db) => {
            const { rows } = await db.query(`UPDATE employee_trainings SET hours = 99 WHERE id = $1 RETURNING id`, [selfReportId]);
            assert.equal(rows.length, 0);
        });
    });

    test('RH aprova a autodeclaração (self-contido: RETURNING confirma dentro da própria chamada)', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query(
                `UPDATE employee_trainings SET status = 'concluido', completion_date = CURRENT_DATE WHERE id = $1 RETURNING status`,
                [selfReportId]
            );
            assert.equal(rows.length, 1);
            assert.equal(rows[0].status, 'concluido');
        });
    });

    test('depois de aprovada, o colaborador não edita nem exclui mais a própria autodeclaração', async () => {
        let approvedId;
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO employee_trainings (employee_id, title, source, status, completion_date) VALUES ($1, 'Já Aprovado', 'autodeclarado', 'concluido', CURRENT_DATE) RETURNING id`,
                [E_SUB]
            );
            approvedId = r.rows[0].id;
        });

        await withUser({ sub: U_SUB }, async (db) => {
            const upd = await db.query(`UPDATE employee_trainings SET hours = 1 WHERE id = $1 RETURNING id`, [approvedId]);
            assert.equal(upd.rows.length, 0);
            const del = await db.query(`DELETE FROM employee_trainings WHERE id = $1 RETURNING id`, [approvedId]);
            assert.equal(del.rows.length, 0);
        });
    });

    test('colaborador retira a própria autodeclaração enquanto ainda está pendente', async () => {
        let toWithdrawId;
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO employee_trainings (employee_id, title, source, status) VALUES ($1, 'Para Retirar', 'autodeclarado', 'aguardando_aprovacao') RETURNING id`,
                [E_SUB]
            );
            toWithdrawId = r.rows[0].id;
        });
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`DELETE FROM employee_trainings WHERE id = $1 RETURNING id`, [toWithdrawId]);
            assert.equal(rows.length, 1);
        });
    });
});
