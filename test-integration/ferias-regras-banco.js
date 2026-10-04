const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

globalThis.window ??= globalThis;
const { CLTDomain } = require('../src/javascript/domain/clt-domain.js');

const U_RH = '00000000-0000-4000-8000-00000000fa01';
const U_A = '00000000-0000-4000-8000-00000000fa02';
const U_GESTOR = '00000000-0000-4000-8000-00000000fa03';

const E_RH = '00000000-0000-4000-9000-00000000fa01';
const E_A = '00000000-0000-4000-9000-00000000fa02';
const E_GESTOR = '00000000-0000-4000-9000-00000000fa03';

const REGRA = { code: '23514' };

let hoje;
let feriados;
const feriadosCriados = [];

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const somar = (isoData, dias) => {
    const [y, m, d] = isoData.split('-').map(Number);
    return iso(new Date(y, m - 1, d + dias));
};
const diaDaSemana = (isoData) => {
    const [y, m, d] = isoData.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
};

function inicioLivre(aPartirDe, { semana = [1, 2, 3, 4] } = {}) {
    let dia = aPartirDe;
    while (!semana.includes(diaDaSemana(dia)) || CLTDomain.motivoInicioFeriasVedado(dia, { feriados }) || feriados.includes(dia)) dia = somar(dia, 1);
    return dia;
}

function proximaSexta(aPartirDe) {
    let dia = aPartirDe;
    while (diaDaSemana(dia) !== 5 || [0, 1, 2].some((n) => feriados.includes(somar(dia, n)))) dia = somar(dia, 1);
    return dia;
}

const pedir = (sub, { inicio, dias = 10, abono = false, employee = E_A, diasDeclarados }) =>
    withUser({ sub, commit: true }, (db) =>
        db.query(
            `INSERT INTO vacations (employee_id, start_date, end_date, days, abono, status) VALUES ($1, $2::date, $2::date + ($3::int - 1), $4, $5, 'pendente') RETURNING id, status`,
            [employee, inicio, dias, diasDeclarados ?? dias, abono]
        )
    );

const cadastro = (campos) =>
    withServiceRole((db) =>
        db.query('UPDATE employees SET contract_type = $2, work_load = $3, admission_date = $4 WHERE id = $1', [
            E_A,
            campos.contract_type ?? 'clt',
            campos.work_load ?? '44h',
            campos.admission_date ?? null,
        ])
    );

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A, U_GESTOR]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, manager_id)
             VALUES ($1, 'Férias RH', '961.000.000-01', 'ferias.rh@test.local', 'RH', 'Ativo', NULL),
                    ($3, 'Férias Gestor', '961.000.000-03', 'ferias.gestor@test.local', 'Vendas', 'Ativo', NULL),
                    ($2, 'Férias A', '961.000.000-02', 'ferias.a@test.local', 'Vendas', 'Ativo', $3)
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A, E_GESTOR]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A, U_GESTOR, E_GESTOR]
        );
        hoje = (await db.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
        feriados = (await db.query("SELECT to_char(date, 'YYYY-MM-DD') AS d FROM holidays WHERE abrangencia IS DISTINCT FROM 'facultativo'")).rows.map(
            (r) => r.d
        );
    });
});

beforeEach(async () => {
    await withServiceRole((db) => db.query('DELETE FROM vacations WHERE employee_id = $1', [E_A]));
    await cadastro({});
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM vacations WHERE employee_id = ANY($1)', [[E_A, E_RH, E_GESTOR]]);
        if (feriadosCriados.length) await db.query('DELETE FROM holidays WHERE date = ANY($1::date[])', [feriadosCriados]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A, U_GESTOR]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A, U_GESTOR]]);
        await db.query('UPDATE employees SET manager_id = NULL WHERE id = $1', [E_A]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A, E_GESTOR]]);
    });
});

describe('Férias no banco — o que o colaborador pede passa pelas regras da CLT', () => {
    test('pedido válido é gravado como pendente', async () => {
        const { rows } = await pedir(U_A, { inicio: inicioLivre(somar(hoje, 35)) });
        assert.equal(rows[0].status, 'pendente');
    });

    test('menos de 30 dias de antecedência é recusado', async () => {
        await assert.rejects(pedir(U_A, { inicio: inicioLivre(somar(hoje, 5)) }), { ...REGRA, message: /30 dias de antecedência/ });
    });

    test('dias declarados diferentes do período são recusados (a folha usa esse número)', async () => {
        await assert.rejects(pedir(U_A, { inicio: inicioLivre(somar(hoje, 35)), dias: 10, diasDeclarados: 3 }), {
            ...REGRA,
            message: /quantidade de dias não confere/,
        });
    });

    test('fim antes do início é recusado', async () => {
        const inicio = inicioLivre(somar(hoje, 35));
        await assert.rejects(
            withUser({ sub: U_A }, (db) =>
                db.query(`INSERT INTO vacations (employee_id, start_date, end_date, days, status) VALUES ($1, $2::date, $2::date - 1, 0, 'pendente')`, [
                    E_A,
                    inicio,
                ])
            ),
            { ...REGRA, message: /fim das férias deve ser igual ou posterior/ }
        );
    });

    test('menos de 5 dias é recusado', async () => {
        await assert.rejects(pedir(U_A, { inicio: inicioLivre(somar(hoje, 35)), dias: 4 }), { ...REGRA, message: /mínimo de férias é de 5 dias/ });
    });

    test('art. 134 §3º: começar na sexta (2 dias antes do domingo) é recusado', async () => {
        await assert.rejects(pedir(U_A, { inicio: proximaSexta(somar(hoje, 35)) }), { ...REGRA, message: /descanso semanal \(domingo, .*art\. 134 §3º/ });
    });

    test('art. 134 §3º: 2 dias antes de feriado cadastrado é recusado; ponto facultativo não conta', async () => {
        const segunda = inicioLivre(somar(hoje, 60), { semana: [1] });
        const quarta = somar(segunda, 2);
        await withServiceRole((db) => db.query("INSERT INTO holidays (date, name, abrangencia) VALUES ($1, 'Feriado de teste', 'facultativo')", [quarta]));
        feriadosCriados.push(quarta);
        const { rows } = await pedir(U_A, { inicio: segunda });
        assert.equal(rows[0].status, 'pendente', 'facultativo não bloqueia');

        await withServiceRole(async (db) => {
            await db.query('DELETE FROM vacations WHERE employee_id = $1', [E_A]);
            await db.query("UPDATE holidays SET abrangencia = 'municipal' WHERE date = $1", [quarta]);
        });
        await assert.rejects(pedir(U_A, { inicio: segunda }), { ...REGRA, message: /2 dias antes de um feriado/ });
    });

    test('escala 12x36 não tem domingo fixo de descanso: pode começar na sexta', async () => {
        await cadastro({ work_load: '12x36' });
        const { rows } = await pedir(U_A, { inicio: proximaSexta(somar(hoje, 35)) });
        assert.equal(rows[0].status, 'pendente');
    });

    test('estagiário segue a Lei do Estágio: pode começar na sexta, mas não vende abono', async () => {
        await withServiceRole((db) =>
            db.query(
                `UPDATE employees SET contract_type = 'Estágio', work_load = '30h', admission_date = $2::date, contract_end_date = $2::date + 700,
                        estagio_nivel = 'superior', estagio_obrigatorio = true, estagio_instituicao = 'Universidade Teste', estagio_supervisor_id = $3
                  WHERE id = $1`,
                [E_A, somar(hoje, -400), E_GESTOR]
            )
        );
        const { rows } = await pedir(U_A, { inicio: proximaSexta(somar(hoje, 35)) });
        assert.equal(rows[0].status, 'pendente');
        await assert.rejects(pedir(U_A, { inicio: inicioLivre(somar(hoje, 80)), abono: true }), { ...REGRA, message: /Sem abono pecuniário/ });
    });

    test('PJ não segue a CLT: começa na sexta, menos de 5 dias e sem limite de frações, mas sem abono', async () => {
        await cadastro({ contract_type: 'pj', admission_date: somar(hoje, -425) });
        const sexta = proximaSexta(somar(hoje, 35));
        const { rows } = await pedir(U_A, { inicio: sexta, dias: 3 });
        assert.equal(rows[0].status, 'pendente');
        for (const n of [1, 2, 3]) {
            const r = await pedir(U_A, { inicio: inicioLivre(somar(sexta, 10 * n)), dias: 2 });
            assert.equal(r.rows[0].status, 'pendente', `pedido ${n + 1}`);
        }
        await assert.rejects(pedir(U_A, { inicio: inicioLivre(somar(sexta, 60)), abono: true }), { ...REGRA, message: /Contrato PJ não tem abono/ });
        await assert.rejects(pedir(U_A, { inicio: somar(hoje, 10), dias: 3 }), { ...REGRA, message: /30 dias de antecedência/ });
    });

    test('frações (art. 134 §1º): a terceira sem nenhuma de 14 dias e a quarta são recusadas; abono só uma vez por ciclo', async () => {
        await cadastro({ admission_date: somar(hoje, -425) });
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO vacations (employee_id, start_date, end_date, days, abono, status) VALUES
                    ($1, $2::date, $2::date + 4, 5, true, 'aprovado'),
                    ($1, $3::date, $3::date + 4, 5, false, 'aprovado')`,
                [E_A, somar(hoje, -50), somar(hoje, -30)]
            )
        );
        const inicio = inicioLivre(somar(hoje, 35));
        await assert.rejects(pedir(U_A, { inicio, dias: 10 }), { ...REGRA, message: /Ao menos uma fração deve ter 14 dias/ });
        await assert.rejects(pedir(U_A, { inicio, dias: 14, abono: true }), { ...REGRA, message: /abono já foi pedido/ });
        const { rows } = await pedir(U_A, { inicio, dias: 14 });
        assert.equal(rows[0].status, 'pendente', 'a terceira com 14 dias passa');
        await assert.rejects(pedir(U_A, { inicio: inicioLivre(somar(inicio, 30)), dias: 14 }), { ...REGRA, message: /3 frações/ });
    });

    test('frações recusadas ou canceladas não contam', async () => {
        await cadastro({ admission_date: somar(hoje, -425) });
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO vacations (employee_id, start_date, end_date, days, status) VALUES
                    ($1, $2::date, $2::date + 4, 5, 'recusado'), ($1, $3::date, $3::date + 4, 5, 'cancelado'), ($1, $4::date, $4::date + 4, 5, 'aprovado')`,
                [E_A, somar(hoje, -60), somar(hoje, -50), somar(hoje, -30)]
            )
        );
        const { rows } = await pedir(U_A, { inicio: inicioLivre(somar(hoje, 35)), dias: 10 });
        assert.equal(rows[0].status, 'pendente');
    });

    test('depois de pedido, o colaborador pode cancelar, mas não mudar o período', async () => {
        const { rows } = await pedir(U_A, { inicio: inicioLivre(somar(hoje, 35)) });
        const id = rows[0].id;
        await assert.rejects(
            withUser({ sub: U_A }, (db) =>
                db.query(`UPDATE vacations SET status = 'cancelado', start_date = start_date - 20, end_date = end_date - 20 WHERE id = $1`, [id])
            ),
            { ...REGRA, message: /não pode ser alterado depois de pedido/ }
        );
        const cancelado = await withUser({ sub: U_A }, (db) => db.query(`UPDATE vacations SET status = 'cancelado' WHERE id = $1 RETURNING status`, [id]));
        assert.equal(cancelado.rows[0].status, 'cancelado');
    });

    test('o gestor aprova as férias da equipe normalmente (só muda o status)', async () => {
        const { rows } = await withServiceRole((db) =>
            db.query(
                `INSERT INTO vacations (employee_id, start_date, end_date, days, status) VALUES ($1, $2::date, $2::date + 9, 10, 'pendente') RETURNING id`,
                [E_A, inicioLivre(somar(hoje, 35))]
            )
        );
        const aprovado = await withUser({ sub: U_GESTOR }, (db) =>
            db.query(`UPDATE vacations SET status = 'aprovado' WHERE id = $1 RETURNING status`, [rows[0].id])
        );
        assert.equal(aprovado.rowCount, 1);
        assert.equal(aprovado.rows[0].status, 'aprovado');
    });

    test('o RH registra fora das regras (com a confirmação feita na tela) e rotinas do servidor não são afetadas', async () => {
        const sexta = proximaSexta(somar(hoje, 2));
        const { rows } = await withUser({ sub: U_RH }, (db) =>
            db.query(
                `INSERT INTO vacations (employee_id, start_date, end_date, days, status) VALUES ($1, $2::date, $2::date + 2, 3, 'aprovado') RETURNING status`,
                [E_A, sexta]
            )
        );
        assert.equal(rows[0].status, 'aprovado');
        const servidor = await withServiceRole((db) =>
            db.query(
                `INSERT INTO vacations (employee_id, start_date, end_date, days, status) VALUES ($1, $2::date, $2::date + 1, 2, 'concluido') RETURNING status`,
                [E_A, somar(hoje, -400)]
            )
        );
        assert.equal(servidor.rows[0].status, 'concluido');
    });
});
