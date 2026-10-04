const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000ad01';
const U_A = '00000000-0000-4000-8000-00000000ad02';
const E_RH = '00000000-0000-4000-9000-00000000ad01';
const E_A = '00000000-0000-4000-9000-00000000ad02';
const CCT = '00000000-0000-4000-a000-00000000ad01';
const CCT_VENCIDA = '00000000-0000-4000-a000-00000000ad02';

const gravarComoRH = (sql, params) => withUser({ sub: U_RH, commit: true }, (db) => db.query(sql, params));

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, contract_type, work_load, salary)
             VALUES ($1, 'CCT RH', '964.000.000-01', 'cct.rh@test.local', 'RH', 'Ativo', 'clt', '44h', '9000'),
                    ($2, 'CCT A', '964.000.000-02', 'cct.a@test.local', 'Vendas', 'Ativo', 'clt', '44h', '2000')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4) ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A]
        );
        await db.query(
            `INSERT INTO convencoes_coletivas (id, nome, vigencia_inicio, vigencia_fim, piso_salarial) VALUES
               ($1, 'CCT Teste 106', (now() AT TIME ZONE 'America/Sao_Paulo')::date - 30, (now() AT TIME ZONE 'America/Sao_Paulo')::date + 300, 2200),
               ($2, 'CCT Vencida 106', (now() AT TIME ZONE 'America/Sao_Paulo')::date - 400, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 40, 5000)
             ON CONFLICT (id) DO NOTHING`,
            [CCT, CCT_VENCIDA]
        );
    });
});

beforeEach(async () => {
    await withServiceRole((db) =>
        db.query(
            `UPDATE employees SET status = 'Ativo', salary = '2000', work_load = '44h', contract_type = 'clt', convencao_coletiva_id = NULL,
                    estabilidade_ate = NULL, estabilidade_motivo = NULL, termination_date = NULL, termination_type = NULL WHERE id = $1`,
            [E_A]
        )
    );
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A]]);
        await db.query('DELETE FROM convencoes_coletivas WHERE id = ANY($1)', [[CCT, CCT_VENCIDA]]);
    });
});

describe('Migration 106 — valor da pensão alimentícia', () => {
    test('fica cifrado na tabela, legível na view e entra na rotação de chaves', async () => {
        await gravarComoRH(`UPDATE employees SET pensao_alimenticia = 'true', tipo_pensao = 'percentual', pensao_valor = '30' WHERE id = $1`, [E_A]);
        const cru = await withServiceRole((db) => db.query('SELECT pensao_valor FROM employees WHERE id = $1', [E_A]));
        assert.notEqual(cru.rows[0].pensao_valor, '30.00');
        const view = await withUser({ sub: U_RH }, (db) => db.query('SELECT pensao_valor FROM employees_decrypted WHERE id = $1', [E_A]));
        assert.equal(Number(view.rows[0].pensao_valor), 30);
        const cols = await withServiceRole((db) => db.query("SELECT 1 FROM nexus_encrypted_columns() WHERE tbl = 'employees' AND col = 'pensao_valor'"));
        assert.equal(cols.rows.length, 1);
    });

    test('valor que não é número é recusado', async () => {
        await assert.rejects(gravarComoRH(`UPDATE employees SET pensao_valor = 'trinta' WHERE id = $1`, [E_A]), { code: '22P02' });
    });
});

describe('Migration 106 — piso da convenção coletiva', () => {
    test('só o RH lê e grava as convenções', async () => {
        const rh = await withUser({ sub: U_RH }, (db) => db.query('SELECT 1 FROM convencoes_coletivas WHERE id = $1', [CCT]));
        assert.equal(rh.rows.length, 1);
        const colab = await withUser({ sub: U_A }, (db) => db.query('SELECT 1 FROM convencoes_coletivas'));
        assert.equal(colab.rows.length, 0);
        await assert.rejects(
            withUser({ sub: U_A }, (db) =>
                db.query(`INSERT INTO convencoes_coletivas (nome, vigencia_inicio, vigencia_fim, piso_salarial) VALUES ('X', '2026-01-01', '2026-12-31', 100)`)
            ),
            /row-level security/
        );
    });

    test('vigência acima de 2 anos ou piso zerado são recusados', async () => {
        await assert.rejects(
            gravarComoRH(
                `INSERT INTO convencoes_coletivas (nome, vigencia_inicio, vigencia_fim, piso_salarial) VALUES ('Longa', '2026-01-01', '2028-06-01', 2000)`
            ),
            { code: '23514' }
        );
        await assert.rejects(
            gravarComoRH(
                `INSERT INTO convencoes_coletivas (nome, vigencia_inicio, vigencia_fim, piso_salarial) VALUES ('Zero', '2026-01-01', '2026-12-31', 0)`
            ),
            { code: '23514' }
        );
    });

    test('vincular a convenção vigente com salário abaixo do piso é recusado; no piso passa', async () => {
        await assert.rejects(gravarComoRH('UPDATE employees SET convencao_coletiva_id = $2 WHERE id = $1', [E_A, CCT]), {
            code: '23514',
            message: /abaixo do piso de R\$ 2200,00/,
        });
        const { rows } = await gravarComoRH(`UPDATE employees SET convencao_coletiva_id = $2, salary = '2200' WHERE id = $1 RETURNING id`, [E_A, CCT]);
        assert.equal(rows.length, 1);
        await assert.rejects(gravarComoRH(`UPDATE employees SET salary = '2199.99' WHERE id = $1`, [E_A]), { code: '23514' });
    });

    test('jornada menor tem piso proporcional (OJ 358); 12x36 vale o piso cheio', async () => {
        await gravarComoRH(`UPDATE employees SET work_load = '30h', salary = '1500', convencao_coletiva_id = $2 WHERE id = $1`, [E_A, CCT]);
        await assert.rejects(gravarComoRH(`UPDATE employees SET work_load = '12x36' WHERE id = $1`, [E_A]), { message: /piso de R\$ 2200,00/ });
    });

    test('convenção vencida não trava o salário', async () => {
        const { rows } = await gravarComoRH('UPDATE employees SET convencao_coletiva_id = $2 WHERE id = $1 RETURNING id', [E_A, CCT_VENCIDA]);
        assert.equal(rows.length, 1);
    });

    test('quem já estava abaixo de um piso novo continua podendo ser editado em outros campos', async () => {
        await gravarComoRH(`UPDATE employees SET convencao_coletiva_id = $2, salary = '2200' WHERE id = $1`, [E_A, CCT]);
        await withServiceRole((db) => db.query('UPDATE convencoes_coletivas SET piso_salarial = 2500 WHERE id = $1', [CCT]));
        try {
            const { rows } = await gravarComoRH(`UPDATE employees SET dept = 'Comercial', salary = '2200' WHERE id = $1 RETURNING dept`, [E_A]);
            assert.equal(rows[0].dept, 'Comercial');
        } finally {
            await withServiceRole((db) => db.query('UPDATE convencoes_coletivas SET piso_salarial = 2200 WHERE id = $1', [CCT]));
        }
    });
});

describe('Migration 106 — estabilidade barra a dispensa no banco', () => {
    const estavel = () =>
        withServiceRole((db) =>
            db.query(
                `UPDATE employees SET estabilidade_motivo = 'gestante', estabilidade_ate = (now() AT TIME ZONE 'America/Sao_Paulo')::date + 90 WHERE id = $1`,
                [E_A]
            )
        );

    test('dispensa sem justa causa (ou acordo) dentro da estabilidade é recusada', async () => {
        await estavel();
        for (const tipo of ['sem_justa_causa', 'acordo_mutuo', 'prazo_sem_justa_causa']) {
            await assert.rejects(
                gravarComoRH(
                    `UPDATE employees SET status = 'Inativo', termination_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date, termination_type = $2 WHERE id = $1`,
                    [E_A, tipo]
                ),
                { code: '23514', message: /dispensa sem justa causa nesse período é nula/ },
                tipo
            );
        }
    });

    test('sem o tipo de rescisão também é recusado', async () => {
        await estavel();
        await assert.rejects(gravarComoRH(`UPDATE employees SET status = 'Inativo' WHERE id = $1`, [E_A]), { message: /informe o tipo de rescisão/ });
    });

    test('justa causa e pedido de demissão passam; depois da estabilidade, qualquer tipo passa', async () => {
        await estavel();
        await gravarComoRH(`UPDATE employees SET status = 'Inativo', termination_type = 'justa_causa' WHERE id = $1`, [E_A]);
        await withServiceRole((db) => db.query(`UPDATE employees SET status = 'Ativo' WHERE id = $1`, [E_A]));
        const { rows } = await gravarComoRH(
            `UPDATE employees SET status = 'Inativo', termination_date = estabilidade_ate + 1, termination_type = 'sem_justa_causa' WHERE id = $1 RETURNING status`,
            [E_A]
        );
        assert.equal(rows[0].status, 'Inativo');
    });

    test('sem estabilidade cadastrada, a dispensa sem justa causa segue normal', async () => {
        const { rows } = await gravarComoRH(`UPDATE employees SET status = 'Inativo', termination_type = 'sem_justa_causa' WHERE id = $1 RETURNING status`, [
            E_A,
        ]);
        assert.equal(rows[0].status, 'Inativo');
    });
});
