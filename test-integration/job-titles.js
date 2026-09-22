const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const FORBIDDEN = { code: '42501' };

const U_RH = '00000000-0000-4000-8000-00000000f301';
const U_COLAB = '00000000-0000-4000-8000-00000000f302';
const E_RH = '00000000-0000-4000-9000-00000000f301';
const E_COLAB = '00000000-0000-4000-9000-00000000f302';

let titleId, inactiveId;

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_COLAB]) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status)
             VALUES ($1, 'JT RH Fixture', '907.000.000-01', 'jt.rh@test.local', 'RH', 'Ativo'),
                    ($2, 'JT Colab Fixture', '907.000.000-02', 'jt.colab@test.local', 'TI', 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_COLAB]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_COLAB, E_COLAB]
        );
        const t1 = await db.query(
            `INSERT INTO job_titles (title, track, level, salary_min, salary_max) VALUES ('Cargo de Teste Ativo', 'Teste', 'Pleno', 3000, 5000) RETURNING id`
        );
        titleId = t1.rows[0].id;
        const t2 = await db.query(`INSERT INTO job_titles (title, level, active) VALUES ('Cargo de Teste Inativo', 'Sênior', false) RETURNING id`);
        inactiveId = t2.rows[0].id;
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM job_titles WHERE id = ANY($1)', [[titleId, inactiveId]]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_COLAB]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_COLAB]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_COLAB]]);
    });
});

describe('RLS: job_titles', () => {
    test('RH lê a tabela completa, incluindo faixa salarial', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT title, salary_min, salary_max FROM job_titles WHERE id = $1', [titleId]);
            assert.equal(rows.length, 1);
            assert.equal(Number(rows[0].salary_min), 3000);
        });
    });

    test('colaborador não lê a tabela diretamente (nem título, nem salário)', async () => {
        await withUser({ sub: U_COLAB }, async (db) => {
            const { rows } = await db.query('SELECT * FROM job_titles WHERE id = $1', [titleId]);
            assert.equal(rows.length, 0);
        });
    });

    test('RH cria, atualiza e desativa um cargo', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const ins = await db.query(`INSERT INTO job_titles (title, level) VALUES ('Cargo Temporário RLS', 'Júnior') RETURNING id`);
            const id = ins.rows[0].id;
            const upd = await db.query(`UPDATE job_titles SET salary_min = 2000, salary_max = 3000 WHERE id = $1 RETURNING salary_min`, [id]);
            assert.equal(Number(upd.rows[0].salary_min), 2000);
            const del = await db.query(`DELETE FROM job_titles WHERE id = $1 RETURNING id`, [id]);
            assert.equal(del.rows.length, 1);
        });
    });

    test('colaborador não consegue criar cargo', async () => {
        await withUser({ sub: U_COLAB }, async (db) => {
            await assert.rejects(db.query(`INSERT INTO job_titles (title) VALUES ('Cargo Indevido')`), FORBIDDEN);
        });
    });
});

describe('job_titles_public() — catálogo sem faixa salarial', () => {
    test('colaborador vê título/trilha/nível de cargos ativos, sem salário', async () => {
        await withUser({ sub: U_COLAB }, async (db) => {
            const { rows } = await db.query('SELECT * FROM job_titles_public() WHERE id = $1', [titleId]);
            assert.equal(rows.length, 1);
            assert.equal(rows[0].title, 'Cargo de Teste Ativo');
            assert.equal(rows[0].track, 'Teste');
            assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'level', 'title', 'track'].sort());
        });
    });

    test('cargo inativo não aparece no catálogo público', async () => {
        await withUser({ sub: U_COLAB }, async (db) => {
            const { rows } = await db.query('SELECT * FROM job_titles_public() WHERE id = $1', [inactiveId]);
            assert.equal(rows.length, 0);
        });
    });

    test('RH também usa a mesma função (não precisa da tabela completa para montar o dropdown)', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT * FROM job_titles_public() WHERE id = $1', [titleId]);
            assert.equal(rows.length, 1);
        });
    });
});
