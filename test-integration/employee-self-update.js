const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000d001';
const U_MGR = '00000000-0000-4000-8000-00000000d002';
const U_SUB = '00000000-0000-4000-8000-00000000d003';

const E_RH = '00000000-0000-4000-9000-00000000d001';
const E_MGR = '00000000-0000-4000-9000-00000000d002';
const E_SUB = '00000000-0000-4000-9000-00000000d003';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_MGR, U_SUB]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, role, salary, status, manager_id)
             VALUES ($1, 'Perfil RH',     '902.000.000-01', 'perfil.rh@test.local',  'RH', 'Analista de RH', 9000,   'Ativo', NULL),
                    ($2, 'Perfil Gestor', '902.000.000-02', 'perfil.mgr@test.local', 'TI', 'Gerente',        7000,   'Ativo', NULL),
                    ($3, 'Perfil Equipe', '902.000.000-03', 'perfil.sub@test.local', 'TI', 'Estagiário',     1500.5, 'Ativo', $2)
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_MGR, E_SUB]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_MGR, E_MGR, U_SUB, E_SUB]
        );
        await db.query("UPDATE employees SET role = 'Estagiário', dept = 'TI', status = 'Ativo', salary = 1500.5, manager_id = $2, bio = NULL WHERE id = $1", [
            E_SUB,
            E_MGR,
        ]);
    });
});

async function tentarAtualizar(sub, set, alvo) {
    return withUser({ sub }, async (db) => {
        await db.query(`DO $$
            DECLARE n int;
            BEGIN
                UPDATE employees SET ${set} WHERE id = '${alvo}';
                GET DIAGNOSTICS n = ROW_COUNT;
                PERFORM set_config('t.resultado', CASE WHEN n = 0 THEN 'nenhuma-linha' ELSE 'ok' END, true);
            EXCEPTION WHEN insufficient_privilege THEN
                PERFORM set_config('t.resultado', 'bloqueado', true);
            END $$`);
        return (await db.query("SELECT current_setting('t.resultado') AS r")).rows[0].r;
    });
}

describe('Colaborador só edita o próprio perfil (migration 060)', () => {
    test('edita nome, telefone, bio, avatar, preferências e último acesso', async () => {
        assert.equal(await tentarAtualizar(U_SUB, "name = 'Perfil Equipe', telefone = '11 98888-7777', bio = 'olá'", E_SUB), 'ok');
        assert.equal(await tentarAtualizar(U_SUB, "avatar_url = 'a.png', avatar_color = '#123456'", E_SUB), 'ok');
        assert.equal(await tentarAtualizar(U_SUB, 'notif_prefs = \'{"horas":true}\'::jsonb', E_SUB), 'ok');
        assert.equal(await tentarAtualizar(U_SUB, 'last_access = now()', E_SUB), 'ok');
    });

    test('não altera salário, cargo, departamento, status, gestor, e-mail, CPF nem contrato', async () => {
        for (const set of [
            'salary = 99999',
            "role = 'Diretor'",
            "dept = 'RH'",
            "status = 'Inativo'",
            'manager_id = NULL',
            "email = 'x@y.z'",
            "cpf = '000.000.000-00'",
            "contract_type = 'PJ'",
        ]) {
            assert.equal(await tentarAtualizar(U_SUB, set, E_SUB), 'bloqueado', set);
        }
        await withServiceRole(async (db) => {
            const { rows } = await db.query('SELECT role, dept, status, manager_id FROM employees WHERE id = $1', [E_SUB]);
            assert.deepEqual(rows[0], { role: 'Estagiário', dept: 'TI', status: 'Ativo', manager_id: E_MGR });
        });
    });

    test('misturar campo permitido com proibido recusa tudo', async () => {
        assert.equal(await tentarAtualizar(U_SUB, "bio = 'tentativa', salary = 50000", E_SUB), 'bloqueado');
    });

    test('não edita a linha de outra pessoa, nem o gestor a da equipe', async () => {
        assert.equal(await tentarAtualizar(U_SUB, "bio = 'invasão'", E_MGR), 'nenhuma-linha');
        assert.equal(await tentarAtualizar(U_MGR, "bio = 'invasão do gestor'", E_SUB), 'nenhuma-linha');
    });

    test('o RH continua editando qualquer campo', async () => {
        assert.equal(await tentarAtualizar(U_RH, "salary = 2000, role = 'Analista', dept = 'Financeiro'", E_SUB), 'ok');
        await withServiceRole((db) => db.query("UPDATE employees SET role = 'Estagiário', dept = 'TI', salary = 1500.5 WHERE id = $1", [E_SUB]));
    });
});
