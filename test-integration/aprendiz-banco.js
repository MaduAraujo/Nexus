const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000ab01';
const U_A = '00000000-0000-4000-8000-00000000ab02';
const E_RH = '00000000-0000-4000-9000-00000000ab01';
const E_A = '00000000-0000-4000-9000-00000000ab02';

const REGRA = { code: '23514' };

let hoje;

const somarAnos = (iso, anos) => `${Number(iso.slice(0, 4)) + anos}${iso.slice(4)}`;
const somarDias = (iso, dias) => {
    const [y, m, d] = iso.split('-').map(Number);
    const r = new Date(Date.UTC(y, m - 1, d + dias));
    return r.toISOString().slice(0, 10);
};

const aprendiz = (campos = {}) => ({
    contract_type: 'Aprendiz',
    admission_date: hoje,
    contract_end_date: somarDias(somarAnos(hoje, 2), -1),
    birth_date: somarAnos(hoje, -17),
    pcd: 'false',
    work_load: '30h',
    aprendiz_fundamental_completo: false,
    salary: '1200',
    ...campos,
});

const gravar = (campos) =>
    withUser({ sub: U_RH, commit: true }, (db) =>
        db.query(
            `UPDATE employees SET contract_type = $2, admission_date = $3, contract_end_date = $4, birth_date = $5, pcd = $6,
                    work_load = $7, aprendiz_fundamental_completo = $8, salary = $9
              WHERE id = $1 RETURNING id`,
            [
                E_A,
                campos.contract_type,
                campos.admission_date,
                campos.contract_end_date,
                campos.birth_date,
                campos.pcd,
                campos.work_load,
                campos.aprendiz_fundamental_completo,
                campos.salary,
            ]
        )
    );

const alertas = () =>
    withServiceRole(async (db) => {
        await db.query('DELETE FROM compliance_alerts WHERE employee_id = $1', [E_A]);
        await db.query('SELECT generate_compliance_alerts()');
        const r = await db.query('SELECT alertas FROM compliance_alerts WHERE employee_id = $1', [E_A]);
        return r.rows[0]?.alertas || [];
    });

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, contract_type)
             VALUES ($1, 'Aprendiz RH', '962.000.000-01', 'aprendiz.rh@test.local', 'RH', 'Ativo', 'CLT'),
                    ($2, 'Aprendiz A', '962.000.000-02', 'aprendiz.a@test.local', 'Vendas', 'Ativo', 'CLT')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4) ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A]
        );
        hoje = (await db.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
    });
});

beforeEach(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM time_records WHERE employee_id = $1', [E_A]);
        await db.query("UPDATE employees SET contract_type = 'CLT', contract_end_date = NULL, work_load = '44h' WHERE id = $1", [E_A]);
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM compliance_alerts WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM time_records WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A]]);
    });
});

describe('Cadastro de aprendiz no banco (CLT arts. 428 a 433)', () => {
    test('cadastro dentro da lei é gravado', async () => {
        const { rows } = await gravar(aprendiz());
        assert.equal(rows.length, 1);
    });

    test('sem data de nascimento é recusado', async () => {
        await assert.rejects(gravar(aprendiz({ birth_date: null })), { ...REGRA, message: /data de nascimento do aprendiz/ });
    });

    test('menor de 14 anos é recusado', async () => {
        await assert.rejects(gravar(aprendiz({ birth_date: somarAnos(hoje, -13) })), { ...REGRA, message: /pelo menos 14 anos/ });
    });

    test('24 anos ou mais só para pessoa com deficiência', async () => {
        const velho = { birth_date: somarAnos(hoje, -25), contract_end_date: somarAnos(hoje, 1) };
        await assert.rejects(gravar(aprendiz(velho)), { ...REGRA, message: /menos de 24 anos/ });
        const { rows } = await gravar(aprendiz({ ...velho, pcd: 'true' }));
        assert.equal(rows.length, 1);
    });

    test('sem término, término antes da admissão e prazo acima de 2 anos', async () => {
        await assert.rejects(gravar(aprendiz({ contract_end_date: null })), { ...REGRA, message: /data de término/ });
        await assert.rejects(gravar(aprendiz({ contract_end_date: hoje })), { ...REGRA, message: /depois da admissão/ });
        await assert.rejects(gravar(aprendiz({ contract_end_date: somarDias(somarAnos(hoje, 2), 1) })), { ...REGRA, message: /2 anos/ });
    });

    test('término depois dos 24 anos é recusado', async () => {
        const nasc = somarDias(somarAnos(hoje, -23), -1);
        await assert.rejects(gravar(aprendiz({ birth_date: nasc, contract_end_date: somarAnos(nasc, 24) })), {
            ...REGRA,
            message: /completar 24 anos/,
        });
    });

    test('jornada: 40h só com fundamental completo; 44h e 12x36 nunca', async () => {
        await assert.rejects(gravar(aprendiz({ work_load: '40h', salary: '1500' })), { ...REGRA, message: /6 horas por dia/ });
        const { rows } = await gravar(aprendiz({ work_load: '40h', salary: '1500', aprendiz_fundamental_completo: true }));
        assert.equal(rows.length, 1);
        await assert.rejects(gravar(aprendiz({ work_load: '44h', salary: '1700', aprendiz_fundamental_completo: true })), {
            ...REGRA,
            message: /8 horas por dia/,
        });
        await assert.rejects(gravar(aprendiz({ work_load: '12x36', salary: '1700' })), REGRA);
    });

    test('salário abaixo do mínimo hora proporcional é recusado', async () => {
        await assert.rejects(gravar(aprendiz({ salary: '1000' })), { ...REGRA, message: /R\$ 1105,23/ });
    });

    test('dado cifrado que não mudou não é revalidado em alterações de outros campos', async () => {
        await gravar(aprendiz());
        const { rows } = await withUser({ sub: U_RH, commit: true }, (db) =>
            db.query("UPDATE employees SET dept = 'Financeiro' WHERE id = $1 RETURNING id", [E_A])
        );
        assert.equal(rows.length, 1);
    });

    test('quem não é aprendiz não passa pela trava', async () => {
        const { rows } = await gravar(aprendiz({ contract_type: 'CLT', birth_date: null, contract_end_date: null, work_load: '44h' }));
        assert.equal(rows.length, 1);
    });

    test('o colaborador não altera o próprio término nem a escolaridade', async () => {
        await gravar(aprendiz());
        await assert.rejects(
            withUser({ sub: U_A }, (db) => db.query('UPDATE employees SET contract_end_date = contract_end_date - 30 WHERE id = $1', [E_A])),
            { code: '42501' }
        );
        await assert.rejects(
            withUser({ sub: U_A }, (db) => db.query('UPDATE employees SET aprendiz_fundamental_completo = true WHERE id = $1', [E_A])),
            { code: '42501' }
        );
    });
});

describe('Alertas de conformidade do aprendiz', () => {
    const tipos = (lista) => lista.map((a) => a.tipo);

    test('contrato terminando em até 30 dias', async () => {
        await gravar(aprendiz({ admission_date: somarAnos(hoje, -1), contract_end_date: somarDias(hoje, 10) }));
        const a = (await alertas()).find((x) => x.tipo === 'aprendiz_termino');
        assert.equal(a.nivel, 'atencao');
        assert.match(a.titulo, /termina em 10d/);
    });

    test('aprendiz perto de 24 anos', async () => {
        const nasc = somarDias(somarAnos(hoje, -24), 20);
        await gravar(aprendiz({ admission_date: somarAnos(hoje, -1), birth_date: nasc, contract_end_date: somarDias(hoje, 5) }));
        assert.ok(tipos(await alertas()).includes('aprendiz_24_anos'));
    });

    test('hora extra de aprendiz vira alerta crítico', async () => {
        await gravar(aprendiz());
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO time_records (employee_id, date, entrada, saida)
                 VALUES ($1, $2::date, ($2 || 'T08:00:00-03:00')::timestamptz, ($2 || 'T15:00:00-03:00')::timestamptz)`,
                [E_A, hoje]
            )
        );
        const a = (await alertas()).find((x) => x.tipo === 'aprendiz_hora_extra');
        assert.equal(a.nivel, 'critico');
    });

    test('menor de 18 com marcação depois das 22h', async () => {
        await gravar(aprendiz());
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO time_records (employee_id, date, entrada, saida)
                 VALUES ($1, $2::date, ($2 || 'T17:00:00-03:00')::timestamptz, ($2 || 'T22:30:00-03:00')::timestamptz)`,
                [E_A, hoje]
            )
        );
        assert.ok(tipos(await alertas()).includes('aprendiz_menor_noturno'));
    });

    test('aprendiz dentro da lei não gera alerta de aprendiz', async () => {
        await gravar(aprendiz());
        assert.ok(!tipos(await alertas()).some((t) => t.startsWith('aprendiz_')));
    });
});
