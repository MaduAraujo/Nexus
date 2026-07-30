const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-000000000001';
const U_A = '00000000-0000-4000-8000-000000000002';
const U_B = '00000000-0000-4000-8000-000000000003';
const U_C = '00000000-0000-4000-8000-000000000004';

const E_RH = '00000000-0000-4000-9000-000000000001';
const E_A = '00000000-0000-4000-9000-000000000002';
const E_B = '00000000-0000-4000-9000-000000000003';
const E_C = '00000000-0000-4000-9000-000000000004';

const TICKET_EM_ATENDIMENTO = '00000000-0000-4000-a000-000000000001';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A, U_B, U_C]) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, manager_id, status)
             VALUES ($1, 'RH Fixture', '00000000001', 'rh.fixture@test.local', 'RH', NULL, 'Ativo'),
                    ($2, 'Colaborador A Fixture', '00000000002', 'a.fixture@test.local', 'Vendas', NULL, 'Ativo'),
                    ($3, 'Colaborador B Fixture', '00000000003', 'b.fixture@test.local', 'Vendas', NULL, 'Ativo'),
                    ($4, 'Colaborador C Fixture', '00000000004', 'c.fixture@test.local', 'Vendas', $5, 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A, E_B, E_C, E_A]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES
                ($1, 'Administrador', $2),
                ($3, 'colaborador', $4),
                ($5, 'colaborador', $6),
                ($7, 'colaborador', $8)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A, U_B, E_B, U_C, E_C]
        );
        await db.query(
            `INSERT INTO time_records (employee_id, date) VALUES ($1, CURRENT_DATE)
             ON CONFLICT (employee_id, date) DO NOTHING`,
            [E_B]
        );
        await db.query(
            `INSERT INTO hr_tickets (id, employee_id, status) VALUES ($1, $2, 'em_atendimento')
             ON CONFLICT (id) DO NOTHING`,
            [TICKET_EM_ATENDIMENTO, E_B]
        );
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A, U_B, U_C]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A, E_B, E_C]]);
    });
});

describe('RLS: employees', () => {
    test('colaborador não enxerga a linha completa de outro colaborador não-gerenciado', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT * FROM employees WHERE id = $1', [E_B]);
            assert.equal(rows.length, 0);
        });
    });

    test('colaborador enxerga a própria linha', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT * FROM employees WHERE id = $1', [E_A]);
            assert.equal(rows.length, 1);
        });
    });

    test('gestor enxerga a linha completa de quem gerencia', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT * FROM employees WHERE id = $1', [E_C]);
            assert.equal(rows.length, 1);
        });
    });

    test('RH (is_rh) enxerga qualquer colaborador', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rows } = await db.query('SELECT * FROM employees WHERE id = $1', [E_B]);
            assert.equal(rows.length, 1);
        });
    });
});

describe('RLS: colleague_directory (migration 040, 055)', () => {
    test('colaborador consegue ver dados básicos de outro colaborador via a function, mesmo sem acesso à linha completa', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const direct = await db.query('SELECT * FROM employees WHERE id = $1', [E_B]);
            assert.equal(direct.rows.length, 0, 'sanity check: acesso direto continua bloqueado');

            const viaFn = await db.query('SELECT * FROM colleague_directory() WHERE id = $1', [E_B]);
            assert.equal(viaFn.rows.length, 1);
            assert.deepEqual(Object.keys(viaFn.rows[0]).sort(), ['avatar_color', 'avatar_url', 'dept', 'id', 'name', 'role'].sort());
        });
    });
});

describe('RLS: time_records', () => {
    test('colaborador não enxerga o ponto de outro colaborador', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('SELECT * FROM time_records WHERE employee_id = $1', [E_B]);
            assert.equal(rows.length, 0);
        });
    });

    test('colaborador consegue bater o próprio ponto dentro da janela permitida (hoje)', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rows } = await db.query('INSERT INTO time_records (employee_id, date) VALUES ($1, CURRENT_DATE) RETURNING id', [E_A]);
            assert.equal(rows.length, 1);
        });
    });

    test('colaborador não consegue inserir ponto retroativo fora da janela permitida', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(
                () => db.query('INSERT INTO time_records (employee_id, date) VALUES ($1, CURRENT_DATE - 5) RETURNING id', [E_A]),
                /row-level security/i
            );
        });
    });
});

describe('RLS: hr_tickets (migration 041)', () => {
    test('colaborador não consegue alterar o próprio ticket enquanto está em_atendimento', async () => {
        await withUser({ sub: U_B }, async (db) => {
            await assert.rejects(
                () => db.query("UPDATE hr_tickets SET subject = 'tentativa de edição' WHERE id = $1", [TICKET_EM_ATENDIMENTO]),
                /row-level security/i
            );
        });
    });

    test('colaborador não consegue criar ticket já como resolvido', async () => {
        await withUser({ sub: U_B }, async (db) => {
            await assert.rejects(
                () => db.query("INSERT INTO hr_tickets (employee_id, status) VALUES ($1, 'resolvido') RETURNING id", [E_B]),
                /row-level security/i
            );
        });
    });

    test('colaborador consegue criar ticket próprio com status inicial válido', async () => {
        await withUser({ sub: U_B }, async (db) => {
            const { rows } = await db.query("INSERT INTO hr_tickets (employee_id, status) VALUES ($1, 'bot') RETURNING id", [E_B]);
            assert.equal(rows.length, 1);
        });
    });
});

describe('RLS: profiles', () => {
    test('colaborador só enxerga o próprio profile', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const own = await db.query('SELECT * FROM profiles WHERE id = $1', [U_A]);
            assert.equal(own.rows.length, 1);

            const other = await db.query('SELECT * FROM profiles WHERE id = $1', [U_B]);
            assert.equal(other.rows.length, 0);
        });
    });
});
