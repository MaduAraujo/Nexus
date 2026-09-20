const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-0000000000d1';
const U_A = '00000000-0000-4000-8000-0000000000d2';
const E_RH = '00000000-0000-4000-9000-0000000000d1';
const E_A = '00000000-0000-4000-9000-0000000000d2';

const D_COLAB = '00000000-0000-4000-b000-0000000000d1';
const D_RH_SIGN = '00000000-0000-4000-b000-0000000000d2';

const FORBIDDEN = { code: '42501' };

function insertDoc(db, { tipo = 'RG', status, category, requer_assinatura, assinado_em } = {}) {
    return db.query(
        `INSERT INTO documents (name, employee_id, tipo, source, status, category, requer_assinatura, assinado_em)
         VALUES ('arquivo.pdf', $1, $2, 'colaborador', COALESCE($3, 'pendente'), $4, COALESCE($5, false), $6)`,
        [E_A, tipo, status ?? null, category ?? null, requer_assinatura ?? null, assinado_em ?? null]
    );
}

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A]) {
            await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        }
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, manager_id, status)
             VALUES ($1, 'RH Docs Fixture', '00000000011', 'rh.docs@test.local', 'RH', NULL, 'Ativo'),
                    ($2, 'Colab Docs Fixture', '00000000012', 'colab.docs@test.local', 'Vendas', NULL, 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A]
        );
        await db.query(
            `INSERT INTO documents (id, name, employee_id, tipo, source, status, category)
             VALUES ($1, 'meu-rg.pdf', $2, 'RG', 'colaborador', 'pendente', NULL)`,
            [D_COLAB, E_A]
        );
        await db.query(
            `INSERT INTO documents (id, name, employee_id, tipo, source, status, category, requer_assinatura)
             VALUES ($1, 'termo.pdf', $2, 'Termo de Vale-Transporte', 'Administrador', 'aprovado', 'admissional', true)`,
            [D_RH_SIGN, E_A]
        );
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM documents WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A]]);
    });
});

describe('documents: colaborador não se auto-aprova (INSERT)', () => {
    test('envio normal entra como pendente', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await insertDoc(db);
        });
    });

    test('não consegue inserir já aprovado', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(insertDoc(db, { status: 'aprovado' }), FORBIDDEN);
        });
    });

    test('não consegue escolher categoria admissional/demissional', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(insertDoc(db, { category: 'admissional' }), FORBIDDEN);
        });
    });

    test('não consegue inserir documento que exige ou já traz assinatura', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(insertDoc(db, { requer_assinatura: true }), FORBIDDEN);
        });
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(insertDoc(db, { assinado_em: new Date().toISOString() }), FORBIDDEN);
        });
    });

    test('anexo de banco de horas continua entrando aprovado', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await insertDoc(db, { tipo: 'Atestado/Comprovante', status: 'aprovado', category: 'banco_horas' });
        });
    });

    test('categoria banco_horas não serve para aprovar outro tipo de documento', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(insertDoc(db, { tipo: 'RG', status: 'aprovado', category: 'banco_horas' }), FORBIDDEN);
        });
    });
});

describe('documents: colaborador não altera status/categoria/assinatura (UPDATE)', () => {
    test('não consegue aprovar o próprio documento', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(db.query("UPDATE documents SET status = 'aprovado' WHERE id = $1", [D_COLAB]), FORBIDDEN);
        });
    });

    test('não consegue trocar a categoria', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(db.query("UPDATE documents SET category = 'admissional' WHERE id = $1", [D_COLAB]), FORBIDDEN);
        });
    });

    test('não consegue assinar por update direto (nem no documento do RH, nem no próprio)', async () => {
        await withUser({ sub: U_A }, async (db) => {
            // Documento do RH: a política de UPDATE nem enxerga a linha.
            const { rowCount } = await db.query("UPDATE documents SET assinado_em = NOW(), assinado_por = 'eu' WHERE id = $1", [D_RH_SIGN]);
            assert.equal(rowCount, 0);
        });
        await withUser({ sub: U_A }, async (db) => {
            await assert.rejects(db.query('UPDATE documents SET requer_assinatura = true, assinado_em = NOW() WHERE id = $1', [D_COLAB]), FORBIDDEN);
        });
    });

    test('continua podendo marcar a versão anterior como não atual', async () => {
        await withUser({ sub: U_A }, async (db) => {
            const { rowCount } = await db.query('UPDATE documents SET is_current = false WHERE id = $1', [D_COLAB]);
            assert.equal(rowCount, 1);
        });
    });

    test('a assinatura pelo fluxo oficial (sign_document) continua funcionando', async () => {
        await withUser({ sub: U_A }, async (db) => {
            await db.query("SELECT sign_document($1, 'Colab Docs Fixture')", [D_RH_SIGN]);
            const { rows } = await db.query('SELECT assinado_em, assinado_por FROM documents WHERE id = $1', [D_RH_SIGN]);
            assert.ok(rows[0].assinado_em);
            assert.equal(rows[0].assinado_por, 'Colab Docs Fixture');
        });
    });
});

describe('documents: RH e serviço não são afetados', () => {
    test('RH aprova e define a categoria', async () => {
        await withUser({ sub: U_RH }, async (db) => {
            const { rowCount } = await db.query("UPDATE documents SET status = 'aprovado', category = 'admissional' WHERE id = $1", [D_COLAB]);
            assert.equal(rowCount, 1);
        });
    });

    test('service_role altera livremente', async () => {
        await withServiceRole(async (db) => {
            const { rowCount } = await db.query("UPDATE documents SET status = 'recusado' WHERE id = $1", [D_COLAB]);
            assert.equal(rowCount, 1);
            await db.query("UPDATE documents SET status = 'pendente' WHERE id = $1", [D_COLAB]);
        });
    });
});
