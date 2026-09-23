const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const FORBIDDEN = { code: '42501' };

const U_RH = '00000000-0000-4000-8000-00000000f601';
const U_MGR = '00000000-0000-4000-8000-00000000f602';
const U_SUB = '00000000-0000-4000-8000-00000000f603';
const U_OUT = '00000000-0000-4000-8000-00000000f604';

const E_RH = '00000000-0000-4000-9000-00000000f601';
const E_MGR = '00000000-0000-4000-9000-00000000f602';
const E_SUB = '00000000-0000-4000-9000-00000000f603';
const E_OUT = '00000000-0000-4000-9000-00000000f604';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_MGR, U_SUB, U_OUT]) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, manager_id, status)
             VALUES ($1, 'ML RH Fixture',      '911.000.000-01', 'ml.rh@test.local',  'RH', NULL, 'Ativo'),
                    ($2, 'ML Gestor Fixture',   '911.000.000-02', 'ml.mgr@test.local', 'TI', NULL, 'Ativo'),
                    ($3, 'ML Liderado Fixture', '911.000.000-03', 'ml.sub@test.local', 'TI', $2, 'Ativo'),
                    ($4, 'ML Fora Fixture',     '911.000.000-04', 'ml.out@test.local', 'Vendas', NULL, 'Ativo')
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
        await db.query('DELETE FROM medical_leaves WHERE employee_id = ANY($1)', [[E_RH, E_MGR, E_SUB, E_OUT]]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_MGR, U_SUB, U_OUT]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_MGR, U_SUB, U_OUT]]);
        await db.query(`UPDATE employees SET status = 'Ativo' WHERE id = ANY($1)`, [[E_RH, E_MGR, E_SUB, E_OUT]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_MGR, E_SUB, E_OUT]]);
    });
});

describe('RLS: medical_leaves — autodeclaração (só o colaborador)', () => {
    test('colaborador autodeclara um atestado, ficando pendente de aprovação', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(
                `INSERT INTO medical_leaves (employee_id, start_date, end_date, doctor_name, cid, storage_path) VALUES ($1, CURRENT_DATE, CURRENT_DATE + 2, 'Dra. Ana', 'J11', $2) RETURNING id, status, days`,
                [E_SUB, `${E_SUB}/atestados/atestado.pdf`]
            );
            assert.equal(rows.length, 1);
            assert.equal(rows[0].status, 'pendente');
            assert.equal(rows[0].days, 3);
        });
    });

    test('colaborador não consegue enviar atestado sem anexo', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE)`, [E_SUB]),
                FORBIDDEN
            );
        });
    });

    test('colaborador não consegue apontar o anexo para um arquivo da pasta de outro colaborador', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date, storage_path) VALUES ($1, CURRENT_DATE, CURRENT_DATE, $2)`, [
                    E_SUB,
                    `${E_OUT}/atestados/alheio.pdf`,
                ]),
                FORBIDDEN
            );
        });
    });

    test('colaborador não consegue autodeclarar já aprovado (pula a aprovação do RH)', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date, status) VALUES ($1, CURRENT_DATE, CURRENT_DATE, 'aprovado')`, [E_SUB]),
                FORBIDDEN
            );
        });
    });

    test('colaborador não consegue autodeclarar em nome de outro colaborador', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE)`, [E_OUT]),
                FORBIDDEN
            );
        });
    });

    test('gestor e RH não conseguem inserir diretamente (só o colaborador autodeclara)', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE)`, [E_SUB]),
                FORBIDDEN
            );
        });
        await withUser({ sub: U_RH }, async (db) => {
            await assert.rejects(
                db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE)`, [E_SUB]),
                FORBIDDEN
            );
        });
    });
});

describe('RLS: medical_leaves — visibilidade', () => {
    let subLeaveId, outLeaveId;

    before(async () => {
        await withServiceRole(async (db) => {
            const r1 = await db.query(
                `INSERT INTO medical_leaves (employee_id, start_date, end_date, cid) VALUES ($1, CURRENT_DATE, CURRENT_DATE + 1, 'M54') RETURNING id`,
                [E_SUB]
            );
            subLeaveId = r1.rows[0].id;
            const r2 = await db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE) RETURNING id`, [
                E_OUT,
            ]);
            outLeaveId = r2.rows[0].id;
        });
    });

    test('colaborador vê o próprio atestado, inclusive o CID', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT id, cid FROM medical_leaves WHERE id = $1', [subLeaveId]);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].cid, 'M54');
        });
    });

    test('colega de fora não vê o atestado alheio', async () => {
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query('SELECT id FROM medical_leaves WHERE id = $1', [outLeaveId]);
            assert.equal(rows.length, 0);
        });
    });

    test('gestor não enxerga a tabela diretamente (nem CID nem período pela tabela crua)', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query('SELECT id FROM medical_leaves WHERE id = $1', [subLeaveId]);
            assert.equal(rows.length, 0);
        });
    });

    test('gestor vê o resumo do time via medical_leaves_team(), sem CID', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query('SELECT * FROM medical_leaves_team() WHERE id = $1', [subLeaveId]);
            assert.equal(rows.length, 1);
            assert.deepEqual(Object.keys(rows[0]).sort(), ['days', 'employee_id', 'end_date', 'id', 'start_date', 'status'].sort());
        });
    });

    test('medical_leaves_team() não traz atestado de fora do time do gestor', async () => {
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query('SELECT id FROM medical_leaves_team() WHERE id = $1', [outLeaveId]);
            assert.equal(rows.length, 0);
        });
    });

    test('RH vê tudo direto na tabela', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT id FROM medical_leaves WHERE id = ANY($1)', [[subLeaveId, outLeaveId]]);
            assert.equal(rows.length, 2);
        });
    });
});

describe('RLS: medical_leaves — editar/retirar enquanto pendente, aprovar/recusar (RH)', () => {
    test('colaborador corrige a própria autodeclaração enquanto pendente', async () => {
        let leaveId;
        await withServiceRole(async (db) => {
            const r = await db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE) RETURNING id`, [
                E_SUB,
            ]);
            leaveId = r.rows[0].id;
        });
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`UPDATE medical_leaves SET doctor_name = 'Dr. Corrigido' WHERE id = $1 RETURNING doctor_name`, [leaveId]);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].doctor_name, 'Dr. Corrigido');
        });
    });

    test('colaborador retira a própria autodeclaração enquanto pendente', async () => {
        let leaveId;
        await withServiceRole(async (db) => {
            const r = await db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE) RETURNING id`, [
                E_SUB,
            ]);
            leaveId = r.rows[0].id;
        });
        await withUser({ sub: U_SUB }, async (db) => {
            const { rows } = await db.query(`DELETE FROM medical_leaves WHERE id = $1 RETURNING id`, [leaveId]);
            assert.equal(rows.length, 1);
        });
    });

    test('RH aprova e o atestado deixa de poder ser editado pelo colaborador', async () => {
        let leaveId;
        await withServiceRole(async (db) => {
            const r = await db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE) RETURNING id`, [
                E_SUB,
            ]);
            leaveId = r.rows[0].id;
            await db.query(`UPDATE medical_leaves SET status = 'aprovado' WHERE id = $1`, [leaveId]);
        });
        await withUser({ sub: U_SUB }, async (db) => {
            const upd = await db.query(`UPDATE medical_leaves SET doctor_name = 'Trapaça' WHERE id = $1 RETURNING id`, [leaveId]);
            assert.equal(upd.rows.length, 0);
            const del = await db.query(`DELETE FROM medical_leaves WHERE id = $1 RETURNING id`, [leaveId]);
            assert.equal(del.rows.length, 0);
        });
    });

    test('RH recusa e o motivo fica registrado', async () => {
        let leaveId;
        await withServiceRole(async (db) => {
            const r = await db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE) RETURNING id`, [
                E_SUB,
            ]);
            leaveId = r.rows[0].id;
        });
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query(
                `UPDATE medical_leaves SET status = 'recusado', rejection_reason = 'Atestado ilegível' WHERE id = $1 RETURNING status, rejection_reason`,
                [leaveId]
            );
            assert.equal(rows[0].status, 'recusado');
            assert.equal(rows[0].rejection_reason, 'Atestado ilegível');
        });
    });

    test('gestor não aprova nem recusa (sem policy de escrita)', async () => {
        let leaveId;
        await withServiceRole(async (db) => {
            const r = await db.query(`INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE) RETURNING id`, [
                E_SUB,
            ]);
            leaveId = r.rows[0].id;
        });
        await withUser({ sub: U_MGR }, async (db) => {
            const { rows } = await db.query(`UPDATE medical_leaves SET status = 'aprovado' WHERE id = $1 RETURNING id`, [leaveId]);
            assert.equal(rows.length, 0);
        });
    });
});

describe('Trigger: aprovar atestado que cobre hoje muda o status do colaborador para Afastado', () => {
    test('status vira Afastado ao aprovar atestado vigente, e não mexe em quem não está Ativo', async () => {
        let leaveId;
        await withServiceRole(async (db) => {
            await db.query(`UPDATE employees SET status = 'Ativo' WHERE id = $1`, [E_SUB]);
            const r = await db.query(
                `INSERT INTO medical_leaves (employee_id, start_date, end_date) VALUES ($1, CURRENT_DATE, CURRENT_DATE + 3) RETURNING id`,
                [E_SUB]
            );
            leaveId = r.rows[0].id;
            await db.query(`UPDATE medical_leaves SET status = 'aprovado' WHERE id = $1`, [leaveId]);
            const { rows } = await db.query(`SELECT status FROM employees WHERE id = $1`, [E_SUB]);
            assert.equal(rows[0].status, 'Afastado');
        });
    });

    test('job diário devolve para Ativo quem já encerrou o atestado e não tem outro cobrindo hoje', async () => {
        await withServiceRole(async (db) => {
            await db.query('DELETE FROM medical_leaves WHERE employee_id = $1', [E_SUB]);
            const r = await db.query(
                `INSERT INTO medical_leaves (employee_id, start_date, end_date, status) VALUES ($1, CURRENT_DATE - 5, CURRENT_DATE - 2, 'aprovado') RETURNING id`,
                [E_SUB]
            );
            await db.query(`UPDATE employees SET status = 'Afastado', afastado_by_medical_leave_id = $1 WHERE id = $2`, [r.rows[0].id, E_SUB]);
            await db.query('SELECT sync_medical_leave_statuses()');
            const { rows } = await db.query(`SELECT status FROM employees WHERE id = $1`, [E_SUB]);
            assert.equal(rows[0].status, 'Ativo');
        });
    });
});
