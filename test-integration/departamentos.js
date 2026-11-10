const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000b901';
const U_A = '00000000-0000-4000-8000-00000000b902';
const E_RH = '00000000-0000-4000-9000-00000000b901';
const E_A = '00000000-0000-4000-9000-00000000b902';
const NOME = 'Depto Teste 119';

const comoRH = (sql, params) => withUser({ sub: U_RH, commit: true }, (db) => db.query(sql, params));
const comoA = (sql, params) => withUser({ sub: U_A, commit: true }, (db) => db.query(sql, params));

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, contract_type, work_load, salary)
             VALUES ($1, 'Dep RH', '967.000.000-01', 'dep.rh@test.local', 'RH', 'Ativo', 'clt', '44h', '9000'),
                    ($2, 'Dep A', '967.000.000-02', 'dep.a@test.local', 'TI', 'Ativo', 'clt', '44h', '3000')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4) ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A]
        );
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A]]);
        await db.query(`DELETE FROM departments WHERE nome IN ($1, $2)`, [NOME, `${NOME} renomeado`]);
    });
});

const deptDe = async (id) =>
    (await comoRH('SELECT e.dept, d.nome FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.id = $1', [id])).rows[0];

describe('Migration 119 — cadastro de departamentos (RF6.1)', () => {
    test('colaborador lê os departamentos, mas não cria, edita nem exclui', async () => {
        const { rows } = await comoA(`SELECT nome FROM departments WHERE nome = 'TI'`);
        assert.equal(rows.length, 1);
        await assert.rejects(comoA(`INSERT INTO departments (nome) VALUES ($1)`, [NOME]), /row-level security/);
        const upd = await comoA(`UPDATE departments SET ativo = false WHERE nome = 'TI' RETURNING id`);
        assert.equal(upd.rowCount, 0);
    });

    test('o RH cria; nome repetido sem diferenciar maiúsculas é recusado', async () => {
        await comoRH(`INSERT INTO departments (nome, descricao, responsavel_id) VALUES ($1, 'Teste', $2)`, [NOME, E_RH]);
        await assert.rejects(comoRH(`INSERT INTO departments (nome) VALUES ($1)`, [NOME.toUpperCase()]), /departments_nome_unico/);
    });

    test('mudar o departamento do colaborador liga pelo id e normaliza o texto', async () => {
        await comoRH(`UPDATE employees SET dept = $1 WHERE id = $2`, [` ${NOME.toLowerCase()}`, E_A]);
        assert.deepEqual(await deptDe(E_A), { dept: NOME, nome: NOME });
    });

    test('renomear leva o nome novo ao colaborador', async () => {
        await comoRH(`UPDATE departments SET nome = $1 WHERE nome = $2`, [`${NOME} renomeado`, NOME]);
        assert.deepEqual(await deptDe(E_A), { dept: `${NOME} renomeado`, nome: `${NOME} renomeado` });
    });

    test('inativo: quem está continua editável, ninguém novo entra; com colaborador não exclui', async () => {
        await comoRH(`UPDATE departments SET ativo = false WHERE nome = $1`, [`${NOME} renomeado`]);
        await comoRH(`UPDATE employees SET bio = 'oi', dept = dept WHERE id = $1`, [E_A]);
        await assert.rejects(comoRH(`UPDATE employees SET dept = $1 WHERE id = $2`, [`${NOME} renomeado`, E_RH]), /está inativo/);
        await assert.rejects(comoRH(`DELETE FROM departments WHERE nome = $1`, [`${NOME} renomeado`]), /foreign key/);
        await comoRH(`UPDATE employees SET dept = 'TI' WHERE id = $1`, [E_A]);
        await comoRH(`DELETE FROM departments WHERE nome = $1`, [`${NOME} renomeado`]);
    });

    test('o colaborador não muda o próprio departamento', async () => {
        await assert.rejects(comoA(`UPDATE employees SET dept = 'RH' WHERE id = $1`, [E_A]), /só pode alterar/);
    });
});
