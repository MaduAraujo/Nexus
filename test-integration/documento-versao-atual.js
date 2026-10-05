const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000af01';
const U_A = '00000000-0000-4000-8000-00000000af02';
const E_RH = '00000000-0000-4000-9000-00000000af01';
const E_A = '00000000-0000-4000-9000-00000000af02';

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status) VALUES
               ($1, 'Versão RH', '966.000.000-01', 'versao.rh@test.local', 'RH', 'Ativo'),
               ($2, 'Versão A', '966.000.000-02', 'versao.a@test.local', 'Vendas', 'Ativo')
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
        await db.query('DELETE FROM documents WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A]]);
    });
});

const enviar = (sub, campos) =>
    withUser({ sub, commit: true }, (db) =>
        db.query(
            `INSERT INTO documents (name, employee_id, tipo, source, status, storage_path, replaces_document_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [campos.name, E_A, campos.tipo, campos.source, campos.status, `${E_A}/${campos.name}`, campos.replaces ?? null]
        )
    ).then((r) => r.rows[0].id);

const atual = async (id) => (await withServiceRole((db) => db.query('SELECT is_current FROM documents WHERE id = $1', [id]))).rows[0].is_current;

describe('Migration 109 — a versão nova desmarca a anterior na mesma gravação', () => {
    test('colaborador reenvia o próprio documento: só a versão nova fica atual', async () => {
        const v1 = await enviar(U_A, { name: 'rg-v1.pdf', tipo: 'RG', source: 'colaborador', status: 'pendente' });
        const v2 = await enviar(U_A, { name: 'rg-v2.pdf', tipo: 'RG', source: 'colaborador', status: 'pendente', replaces: v1 });
        assert.equal(await atual(v1), false);
        assert.equal(await atual(v2), true);
    });

    test('colaborador não desmarca documento entregue pelo RH', async () => {
        const doRH = await enviar(U_RH, { name: 'contrato.pdf', tipo: 'Contrato', source: 'Administrador', status: 'aprovado' });
        await enviar(U_A, { name: 'contrato-falso.pdf', tipo: 'Contrato', source: 'colaborador', status: 'pendente', replaces: doRH });
        assert.equal(await atual(doRH), true);
    });
});
