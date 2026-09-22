const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const FORBIDDEN = { code: '42501' };

const U_RH = '00000000-0000-4000-8000-00000000f501';
const U_MGR = '00000000-0000-4000-8000-00000000f502';
const U_SUB = '00000000-0000-4000-8000-00000000f503';
const U_OUT = '00000000-0000-4000-8000-00000000f504';

const E_RH = '00000000-0000-4000-9000-00000000f501';
const E_MGR = '00000000-0000-4000-9000-00000000f502';
const E_SUB = '00000000-0000-4000-9000-00000000f503';
const E_OUT = '00000000-0000-4000-9000-00000000f504';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_MGR, U_SUB, U_OUT]) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, manager_id, status)
             VALUES ($1, 'DA RH Fixture',       '910.000.000-01', 'da.rh@test.local',  'RH', NULL, 'Ativo'),
                    ($2, 'DA Gestor Fixture',    '910.000.000-02', 'da.mgr@test.local', 'TI', NULL, 'Ativo'),
                    ($3, 'DA Liderado Fixture',  '910.000.000-03', 'da.sub@test.local', 'TI', $2, 'Ativo'),
                    ($4, 'DA Fora Fixture',      '910.000.000-04', 'da.out@test.local', 'Vendas', NULL, 'Ativo')
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
        await db.query('DELETE FROM disciplinary_actions WHERE employee_id = ANY($1)', [[E_RH, E_MGR, E_SUB, E_OUT]]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_MGR, U_SUB, U_OUT]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_MGR, U_SUB, U_OUT]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_MGR, E_SUB, E_OUT]]);
    });
});

describe('RLS: disciplinary_actions — registro (só o RH)', () => {
    test('RH registra medida disciplinar para qualquer colaborador', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query(
                `INSERT INTO disciplinary_actions (employee_id, type, reason, created_by_name) VALUES ($1, 'advertencia_verbal', 'Atraso recorrente', 'RH') RETURNING id, type`,
                [E_OUT]
            );
            assert.equal(rows.length, 1);
            assert.equal(rows[0].type, 'advertencia_verbal');
        });
    });

    test('suspensão exige suspension_days > 0 (constraint de tabela)', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO disciplinary_actions (employee_id, type, reason, suspension_days) VALUES ($1, 'suspensao', 'Falta grave', 0)`, [E_OUT])
            );
        });
    });

    test('gestor não consegue registrar medida, nem para quem lidera', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO disciplinary_actions (employee_id, type, reason) VALUES ($1, 'advertencia_verbal', 'Indevido')`, [E_SUB]),
                FORBIDDEN
            );
        });
    });

    test('colaborador não consegue registrar medida para si mesmo', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO disciplinary_actions (employee_id, type, reason) VALUES ($1, 'advertencia_verbal', 'Trapaça')`, [E_SUB]),
                FORBIDDEN
            );
        });
    });
});

describe('RLS: disciplinary_actions — visibilidade', () => {
    let subActionId, outActionId;

    before(async () => {
        await withServiceRole(async (db) => {
            const r1 = await db.query(
                `INSERT INTO disciplinary_actions (employee_id, type, reason, created_by_name) VALUES ($1, 'advertencia_escrita', 'Descumprimento de política', 'RH') RETURNING id`,
                [E_SUB]
            );
            subActionId = r1.rows[0].id;
            const r2 = await db.query(
                `INSERT INTO disciplinary_actions (employee_id, type, reason, created_by_name) VALUES ($1, 'advertencia_verbal', 'Outro caso', 'RH') RETURNING id`,
                [E_OUT]
            );
            outActionId = r2.rows[0].id;
        });
    });

    test('gestor vê o histórico de quem lidera', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query('SELECT id FROM disciplinary_actions WHERE id = $1', [subActionId]);
            assert.equal(rows.length, 1);
        });
    });

    test('gestor não vê o histórico de quem não lidera', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query('SELECT id FROM disciplinary_actions WHERE id = $1', [outActionId]);
            assert.equal(rows.length, 0);
        });
    });

    test('colaborador vê o próprio histórico', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT id, reason FROM disciplinary_actions WHERE id = $1', [subActionId]);
            assert.equal(rows.length, 1);
        });
    });

    test('colaborador não vê o histórico de outro colega', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT id FROM disciplinary_actions WHERE id = $1', [outActionId]);
            assert.equal(rows.length, 0);
        });
    });
});

describe('RLS: disciplinary_actions — dar ciência', () => {
    test('colaborador dá ciência (self-contido: RETURNING confirma dentro da própria chamada)', async () => {
        let actionId;
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO disciplinary_actions (employee_id, type, reason, created_by_name) VALUES ($1, 'advertencia_verbal', 'Para dar ciência', 'RH') RETURNING id`,
                [E_SUB]
            );
            actionId = r.rows[0].id;
        });
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`UPDATE disciplinary_actions SET acknowledged_at = now() WHERE id = $1 RETURNING acknowledged_at`, [actionId]);
            assert.equal(rows.length, 1);
            assert.ok(rows[0].acknowledged_at);
        });
    });

    test('colaborador não consegue alterar o motivo/tipo ao dar ciência', async () => {
        let actionId;
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO disciplinary_actions (employee_id, type, reason, created_by_name) VALUES ($1, 'advertencia_verbal', 'Motivo original', 'RH') RETURNING id`,
                [E_SUB]
            );
            actionId = r.rows[0].id;
        });
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(
                db.query(`UPDATE disciplinary_actions SET acknowledged_at = now(), reason = 'Reescrito' WHERE id = $1`, [actionId]),
                FORBIDDEN
            );
        });
    });

    test('depois de já ter dado ciência, não dá para alterar de novo (nem a própria data)', async () => {
        let actionId;
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO disciplinary_actions (employee_id, type, reason, created_by_name, acknowledged_at) VALUES ($1, 'advertencia_verbal', 'Já ciente', 'RH', now()) RETURNING id`,
                [E_SUB]
            );
            actionId = r.rows[0].id;
        });
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`UPDATE disciplinary_actions SET acknowledged_at = now() WHERE id = $1 RETURNING id`, [actionId]);
            assert.equal(rows.length, 0);
        });
    });

    test('colega de fora não dá ciência em nome de outro colaborador', async () => {
        let actionId;
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO disciplinary_actions (employee_id, type, reason, created_by_name) VALUES ($1, 'advertencia_verbal', 'Alheio', 'RH') RETURNING id`,
                [E_SUB]
            );
            actionId = r.rows[0].id;
        });
        await withUser({ sub: U_OUT }, async (db) => {
            const { rows } = await db.query(`UPDATE disciplinary_actions SET acknowledged_at = now() WHERE id = $1 RETURNING id`, [actionId]);
            assert.equal(rows.length, 0);
        });
    });

    test('colaborador não consegue excluir o próprio registro', async () => {
        let actionId;
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO disciplinary_actions (employee_id, type, reason, created_by_name) VALUES ($1, 'advertencia_verbal', 'Não excluível', 'RH') RETURNING id`,
                [E_SUB]
            );
            actionId = r.rows[0].id;
        });
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`DELETE FROM disciplinary_actions WHERE id = $1 RETURNING id`, [actionId]);
            assert.equal(rows.length, 0);
        });
    });

    test('RH edita e exclui livremente (FOR ALL)', async () => {
        let actionId;
        await withServiceRole(async (db) => {
            const r = await db.query(
                `INSERT INTO disciplinary_actions (employee_id, type, reason, created_by_name) VALUES ($1, 'advertencia_verbal', 'Editável pelo RH', 'RH') RETURNING id`,
                [E_SUB]
            );
            actionId = r.rows[0].id;
        });
        await withUser({ sub: U_RH }, async (db) => {
            const upd = await db.query(`UPDATE disciplinary_actions SET reason = 'Corrigido pelo RH' WHERE id = $1 RETURNING reason`, [actionId]);
            assert.equal(upd.rows[0].reason, 'Corrigido pelo RH');
            const del = await db.query(`DELETE FROM disciplinary_actions WHERE id = $1 RETURNING id`, [actionId]);
            assert.equal(del.rows.length, 1);
        });
    });
});
