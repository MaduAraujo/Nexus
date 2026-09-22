const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const FORBIDDEN = { code: '42501' };

const U_RH = '00000000-0000-4000-8000-00000000f201';
const U_MGR = '00000000-0000-4000-8000-00000000f202';
const U_SUB = '00000000-0000-4000-8000-00000000f203';
const U_OUT = '00000000-0000-4000-8000-00000000f204';

const E_RH = '00000000-0000-4000-9000-00000000f201';
const E_MGR = '00000000-0000-4000-9000-00000000f202';
const E_SUB = '00000000-0000-4000-9000-00000000f203';
const E_OUT = '00000000-0000-4000-9000-00000000f204';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_MGR, U_SUB, U_OUT]) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, manager_id, status)
             VALUES ($1, 'PDI RH Fixture',   '908.000.000-01', 'pdi.rh@test.local',  'RH', NULL, 'Ativo'),
                    ($2, 'PDI Gestor Fixture','908.000.000-02', 'pdi.mgr@test.local', 'TI', NULL, 'Ativo'),
                    ($3, 'PDI Liderado Fixture','908.000.000-03', 'pdi.sub@test.local', 'TI', $2, 'Ativo'),
                    ($4, 'PDI Fora Fixture',  '908.000.000-04', 'pdi.out@test.local', 'Vendas', NULL, 'Ativo')
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
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM pdi_goals WHERE employee_id = ANY($1)', [[E_MGR, E_SUB, E_OUT]]);
        await db.query('DELETE FROM performance_reviews WHERE employee_id = ANY($1)', [[E_MGR, E_SUB, E_OUT]]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_MGR, U_SUB, U_OUT]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_MGR, U_SUB, U_OUT]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_MGR, E_SUB, E_OUT]]);
    });
});

describe('RLS: performance_reviews — visibilidade (dados semeados como service role)', () => {
    let rascunhoId, concluidaId;

    before(async () => {
        await withServiceRole(async (db) => {
            const r1 = await db.query(
                `INSERT INTO performance_reviews (employee_id, cycle, status, evaluator_name) VALUES ($1, '1º Semestre 2026', 'rascunho', 'Gestor') RETURNING id`,
                [E_SUB]
            );
            rascunhoId = r1.rows[0].id;
            const r2 = await db.query(
                `INSERT INTO performance_reviews (employee_id, cycle, status, overall_rating, manager_comment, completed_at)
                 VALUES ($1, '2º Semestre 2025', 'concluida', 4, 'Bom semestre', now()) RETURNING id`,
                [E_SUB]
            );
            concluidaId = r2.rows[0].id;
        });
    });

    test('colaborador não enxerga a própria avaliação em rascunho', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`SELECT id FROM performance_reviews WHERE id = $1`, [rascunhoId]);
            assert.equal(rows.length, 0);
        });
    });

    test('colaborador enxerga a própria avaliação concluída', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`SELECT overall_rating, manager_comment FROM performance_reviews WHERE id = $1`, [concluidaId]);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].overall_rating, 4);
        });
    });

    test('colaborador de fora não enxerga nenhuma das duas, nem a concluída', async () => {
        await withUser({ sub: U_OUT }, async (db) => {
            const { rows } = await db.query(`SELECT id FROM performance_reviews WHERE id = ANY($1)`, [[rascunhoId, concluidaId]]);
            assert.equal(rows.length, 0);
        });
    });

    test('gestor enxerga o rascunho de quem lidera (RH e gestor não têm a restrição de status)', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query(`SELECT id FROM performance_reviews WHERE id = $1`, [rascunhoId]);
            assert.equal(rows.length, 1);
        });
    });

    test('RH enxerga o rascunho mesmo sem ser o gestor', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query(`SELECT id FROM performance_reviews WHERE id = $1`, [rascunhoId]);
            assert.equal(rows.length, 1);
        });
    });
});

describe('RLS: performance_reviews — escrita (self-contido em cada chamada)', () => {
    test('gestor cria uma avaliação (rascunho) para quem lidera', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query(
                `INSERT INTO performance_reviews (employee_id, cycle, evaluator_name) VALUES ($1, 'Escrita 2026', 'Gestor') RETURNING id, status`,
                [E_SUB]
            );
            assert.equal(rows.length, 1);
            assert.equal(rows[0].status, 'rascunho');
        });
    });

    test('gestor não consegue criar avaliação para quem não lidera', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            await assert.rejects(db.query(`INSERT INTO performance_reviews (employee_id, cycle) VALUES ($1, 'Escrita 2026')`, [E_OUT]), FORBIDDEN);
        });
    });

    test('RH não consegue criar avaliação para colaborador algum (só visualiza o que o gestor define)', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO performance_reviews (employee_id, cycle, evaluator_name) VALUES ($1, 'RH 2026', 'RH')`, [E_OUT]),
                FORBIDDEN
            );
        });
    });

    test('colaborador não consegue criar avaliação, nem para si mesmo (só o gestor/RH escrevem)', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(db.query(`INSERT INTO performance_reviews (employee_id, cycle) VALUES ($1, 'Auto-avaliação')`, [E_SUB]), FORBIDDEN);
        });
    });
});

describe('RLS: performance_review_competencies', () => {
    let reviewId, competencyId;

    before(async () => {
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO performance_reviews (employee_id, cycle, status) VALUES ($1, 'Competências 2026', 'concluida') RETURNING id`,
                [E_SUB]
            );
            reviewId = r.rows[0].id;
            const c = await db.query(`INSERT INTO performance_review_competencies (review_id, competency, rating) VALUES ($1, 'Comunicação', 5) RETURNING id`, [
                reviewId,
            ]);
            competencyId = c.rows[0].id;
        });
    });

    test('colaborador vê as competências da própria avaliação concluída', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`SELECT competency, rating FROM performance_review_competencies WHERE id = $1`, [competencyId]);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].competency, 'Comunicação');
        });
    });

    test('colaborador de fora não vê competências de avaliação alheia', async () => {
        await withUser({ sub: U_OUT }, async (db) => {
            const { rows } = await db.query(`SELECT id FROM performance_review_competencies WHERE id = $1`, [competencyId]);
            assert.equal(rows.length, 0);
        });
    });

    test('gestor adiciona competência à avaliação de quem lidera', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query(
                `INSERT INTO performance_review_competencies (review_id, competency, rating) VALUES ($1, 'Entrega', 4) RETURNING id`,
                [reviewId]
            );
            assert.equal(rows.length, 1);
        });
    });
});

async function tentarAtualizarMeta(sub, set, alvo) {
    return withUser({ sub }, async (db) => {
        await db.query(`DO $$
            DECLARE n int;
            BEGIN
                UPDATE pdi_goals SET ${set} WHERE id = '${alvo}';
                GET DIAGNOSTICS n = ROW_COUNT;
                PERFORM set_config('t.resultado', CASE WHEN n = 0 THEN 'nenhuma-linha' ELSE 'ok' END, true);
            EXCEPTION WHEN insufficient_privilege THEN
                PERFORM set_config('t.resultado', 'bloqueado', true);
            END $$`);
        return (await db.query("SELECT current_setting('t.resultado') AS r")).rows[0].r;
    });
}

describe('RLS + trigger: pdi_goals (metas de desenvolvimento)', () => {
    let goalId;

    before(async () => {
        await withServiceRole(async (db) => {
            const { rows } = await db.query(
                `INSERT INTO pdi_goals (employee_id, title, due_date, created_by_name) VALUES ($1, 'Concluir curso de Excel avançado', '2026-12-31', 'Gestor') RETURNING id`,
                [E_SUB]
            );
            goalId = rows[0].id;
        });
    });

    test('colaborador enxerga a própria meta mesmo sem estar ligada a uma avaliação concluída', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`SELECT title, status FROM pdi_goals WHERE id = $1`, [goalId]);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].status, 'pendente');
        });
    });

    test('colaborador de fora não enxerga a meta alheia', async () => {
        await withUser({ sub: U_OUT }, async (db) => {
            const { rows } = await db.query(`SELECT id FROM pdi_goals WHERE id = $1`, [goalId]);
            assert.equal(rows.length, 0);
        });
    });

    test('colaborador consegue avançar o status da própria meta', async () => {
        assert.equal(await tentarAtualizarMeta(U_SUB, "status = 'em_andamento'", goalId), 'ok');
        assert.equal(await tentarAtualizarMeta(U_SUB, "status = 'concluido'", goalId), 'ok');
    });

    test('colaborador não consegue reescrever título, descrição ou prazo da própria meta', async () => {
        assert.equal(await tentarAtualizarMeta(U_SUB, "title = 'Outro título'", goalId), 'bloqueado');
        assert.equal(await tentarAtualizarMeta(U_SUB, "description = 'reescrito'", goalId), 'bloqueado');
        assert.equal(await tentarAtualizarMeta(U_SUB, "due_date = '2027-01-01'", goalId), 'bloqueado');
    });

    test('colaborador não altera meta de outro colaborador (nem o status)', async () => {
        await withUser({ sub: U_OUT }, async (db) => {
            const { rows } = await db.query(`UPDATE pdi_goals SET status = 'concluido' WHERE id = $1 RETURNING id`, [goalId]);
            assert.equal(rows.length, 0);
        });
    });

    test('gestor altera o conteúdo de meta de quem lidera', async () => {
        assert.equal(await tentarAtualizarMeta(U_MGR, "title = 'Ajustado pelo gestor'", goalId), 'ok');
    });

    test('RH não altera o conteúdo de meta alguma (só visualiza o que o gestor define)', async () => {
        assert.equal(await tentarAtualizarMeta(U_RH, "title = 'Ajustado pelo RH'", goalId), 'nenhuma-linha');
    });

    test('gestor não cria meta para quem não lidera', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            await assert.rejects(db.query(`INSERT INTO pdi_goals (employee_id, title) VALUES ($1, 'Meta indevida')`, [E_OUT]), FORBIDDEN);
        });
    });
});
