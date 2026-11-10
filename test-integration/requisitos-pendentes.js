const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000b701';
const U_A = '00000000-0000-4000-8000-00000000b702';
const E_RH = '00000000-0000-4000-9000-00000000b701';
const E_A = '00000000-0000-4000-9000-00000000b702';
const T_NR35 = '00000000-0000-4000-a000-00000000b701';

const comoRH = (sql, params) => withUser({ sub: U_RH, commit: true }, (db) => db.query(sql, params));
const comoA = (sql, params) => withUser({ sub: U_A, commit: true }, (db) => db.query(sql, params));

before(async () => {
    await withServiceRole(async (db) => {
        await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'rh.117@test.local'), ($2, 'a.117@test.local') ON CONFLICT (id) DO NOTHING`, [
            U_RH,
            U_A,
        ]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status, contract_type, work_load, salary)
             VALUES ($1, 'Req RH', '966.000.000-01', 'req.rh@test.local', 'RH', 'Ativo', 'clt', '44h', '9000'),
                    ($2, 'Req A', '966.000.000-02', 'req.a@test.local', 'Vendas', 'Ativo', 'clt', '44h', '3000')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4) ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A]
        );
        await db.query(`INSERT INTO trainings (id, title, validade_meses) VALUES ($1, 'NR-35 (teste 117)', 24) ON CONFLICT (id) DO NOTHING`, [T_NR35]);
    });
});

beforeEach(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM payslips WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM employee_audit WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM employee_trainings WHERE employee_id = $1', [E_A]);
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM payslips WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM employee_trainings WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM trainings WHERE id = $1', [T_NR35]);
        await db.query('DELETE FROM activity_logs WHERE employee_id = $1', [E_A]);
        await db.query('DELETE FROM profiles WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A]]);
    });
});

const historico = async () =>
    (await comoRH('SELECT changes, operator_name, operator_email FROM employee_audit_decrypted WHERE employee_id = $1 ORDER BY created_at, id', [E_A])).rows;

const lancar = () =>
    comoRH(
        `INSERT INTO payslips (employee_id, mes, mes_formatado, competencia, proventos, descontos, total_proventos, total_descontos, salario_liquido)
         VALUES ($1, '2026-10', 'Outubro 2026', '10/2026',
                 '[{"cod":"001","descricao":"Salário Base","valor":3000},{"cod":"010","descricao":"Vale Refeição","valor":400}]',
                 '[{"cod":"901","descricao":"INSS","valor":240}]', 3400, 240, 3160)`,
        [E_A]
    );

describe('Migration 117 — log de cada lançamento da folha (RF2.4)', () => {
    test('lançar o holerite registra quem lançou, o líquido e cada provento e desconto', async () => {
        await lancar();
        const [linha] = await historico();
        assert.equal(linha.operator_email, 'rh.117@test.local');
        assert.equal(linha.operator_name, 'rh.117');
        assert.deepEqual(
            linha.changes.map((c) => [c.label, c.oldValue, c.newValue]),
            [
                ['Holerite Outubro 2026', null, 'Lançado · líquido R$ 3.160,00'],
                ['Holerite Outubro 2026 · Provento · Salário Base', null, 'R$ 3.000,00'],
                ['Holerite Outubro 2026 · Provento · Vale Refeição', null, 'R$ 400,00'],
                ['Holerite Outubro 2026 · Desconto · INSS', null, 'R$ 240,00'],
            ]
        );
    });

    test('alterar um lançamento registra só o que mudou, de quanto para quanto', async () => {
        await lancar();
        await comoRH(
            `UPDATE payslips SET proventos = '[{"cod":"001","descricao":"Salário Base","valor":3000},{"cod":"010","descricao":"Vale Refeição","valor":450},{"cod":"050","descricao":"Horas Extras","valor":120.5}]',
                                 total_proventos = 3570.5, salario_liquido = 3330.5
              WHERE employee_id = $1 AND mes = '2026-10'`,
            [E_A]
        );
        const linhas = await historico();
        assert.equal(linhas.length, 2);
        assert.deepEqual(
            linhas[1].changes.map((c) => [c.label, c.oldValue, c.newValue]),
            [
                ['Holerite Outubro 2026 · Provento · Vale Refeição', 'R$ 400,00', 'R$ 450,00'],
                ['Holerite Outubro 2026 · Provento · Horas Extras', null, 'R$ 120,50'],
                ['Holerite Outubro 2026 · Líquido', 'R$ 3.160,00', 'R$ 3.330,50'],
            ]
        );
    });

    test('marcar como pago registra a situação; a assinatura do colaborador sozinha não gera registro', async () => {
        await lancar();
        await comoRH(`UPDATE payslips SET status = 'pago', pago_em = now() WHERE employee_id = $1 AND mes = '2026-10'`, [E_A]);
        await withServiceRole((db) => db.query(`UPDATE payslips SET assinado_em = now(), assinado_por = 'Req A' WHERE employee_id = $1`, [E_A]));
        const linhas = await historico();
        assert.equal(linhas.length, 2);
        assert.deepEqual(linhas[1].changes, [{ field: 'holerite_status', label: 'Holerite Outubro 2026 · Situação', oldValue: 'publicado', newValue: 'pago' }]);
    });

    test('excluir um holerite fica registrado; o colaborador vê o histórico do próprio holerite', async () => {
        await lancar();
        await comoRH(`DELETE FROM payslips WHERE employee_id = $1 AND mes = '2026-10'`, [E_A]);
        const linhas = await historico();
        assert.equal(linhas.at(-1).changes[0].newValue, 'Excluído');
        assert.equal(linhas.at(-1).changes[0].oldValue, 'Líquido R$ 3.160,00');
        const proprio = await comoA('SELECT count(*)::int AS n FROM employee_audit WHERE employee_id = $1', [E_A]);
        assert.equal(proprio.rows[0].n, 2);
    });

    test('lançamento feito pelo sistema (sem usuário) fica como "Sistema"', async () => {
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido)
                 VALUES ($1, '2026-13-1', '[]', '[]', 0, 0, 0)`,
                [E_A]
            )
        );
        const [linha] = await historico();
        assert.equal(linha.operator_name, 'Sistema');
        assert.equal(linha.changes[0].label, 'Holerite 2026-13-1');
    });
});

describe('Migration 117 — validade do certificado (RF3.2)', () => {
    test('concluir um treinamento do catálogo calcula a validade pelos meses do catálogo', async () => {
        await comoRH(`INSERT INTO employee_trainings (employee_id, training_id, title, status) VALUES ($1, $2, 'NR-35', 'pendente')`, [E_A, T_NR35]);
        await comoRH(`UPDATE employee_trainings SET status = 'concluido', completion_date = '2026-01-15' WHERE employee_id = $1`, [E_A]);
        const { rows } = await comoRH(`SELECT certificado_valido_ate::text AS ate FROM employee_trainings WHERE employee_id = $1`, [E_A]);
        assert.equal(rows[0].ate, '2028-01-15');
    });

    test('validade informada é mantida; validade antes da conclusão é recusada', async () => {
        await comoRH(
            `INSERT INTO employee_trainings (employee_id, training_id, title, status, completion_date, certificado_valido_ate)
             VALUES ($1, $2, 'NR-35', 'concluido', '2026-01-15', '2027-01-15')`,
            [E_A, T_NR35]
        );
        const { rows } = await comoRH(`SELECT certificado_valido_ate::text AS ate FROM employee_trainings WHERE employee_id = $1`, [E_A]);
        assert.equal(rows[0].ate, '2027-01-15');
        await assert.rejects(
            comoRH(`UPDATE employee_trainings SET certificado_valido_ate = '2025-12-31' WHERE employee_id = $1`, [E_A]),
            /employee_trainings_certificado_valido_ate_check/
        );
        await assert.rejects(comoRH(`UPDATE trainings SET validade_meses = 0 WHERE id = $1`, [T_NR35]), /trainings_validade_meses_check/);
    });

    test('o colaborador informa a validade ao autodeclarar um curso', async () => {
        await comoA(
            `INSERT INTO employee_trainings (employee_id, title, source, status, certificate_path, certificado_valido_ate)
             VALUES ($1, 'Primeiros socorros', 'autodeclarado', 'aguardando_aprovacao', $2, '2027-11-10')`,
            [E_A, `${E_A}/certificados/primeiros-socorros.pdf`]
        );
        const { rows } = await comoA(`SELECT certificado_valido_ate::text AS ate FROM employee_trainings WHERE employee_id = $1`, [E_A]);
        assert.equal(rows[0].ate, '2027-11-10');
    });
});

describe('Migration 117 — expediente por colaborador e convenção (RNF2.2) e tempo da prova de vida (RF1.1)', () => {
    test('o RH grava expediente completo, inclusive turno que vira a noite; incompleto ou igual é recusado', async () => {
        await comoRH('UPDATE employees SET expediente_inicio = 22, expediente_fim = 6 WHERE id = $1', [E_A]);
        await assert.rejects(comoRH('UPDATE employees SET expediente_fim = NULL WHERE id = $1', [E_A]), /employees_expediente_check/);
        await assert.rejects(comoRH('UPDATE employees SET expediente_fim = 22 WHERE id = $1', [E_A]), /employees_expediente_check/);
        const { rows } = await comoRH('SELECT expediente_inicio, expediente_fim FROM employees_decrypted WHERE id = $1', [E_A]);
        assert.deepEqual(rows[0], { expediente_inicio: 22, expediente_fim: 6 });
        await comoRH('UPDATE employees SET expediente_inicio = NULL, expediente_fim = NULL WHERE id = $1', [E_A]);
    });

    test('o colaborador não muda o próprio expediente', async () => {
        await assert.rejects(comoA('UPDATE employees SET expediente_inicio = 10, expediente_fim = 16 WHERE id = $1', [E_A]), /só pode alterar/);
    });

    test('a convenção coletiva aceita expediente', async () => {
        const { rows } = await comoRH(
            `INSERT INTO convencoes_coletivas (nome, vigencia_inicio, vigencia_fim, piso_salarial, expediente_inicio, expediente_fim)
             VALUES ('CCT teste 117', '2026-01-01', '2026-12-31', 2000, 6, 14) RETURNING id`
        );
        await assert.rejects(
            comoRH(`UPDATE convencoes_coletivas SET expediente_inicio = 30 WHERE id = $1`, [rows[0].id]),
            /convencoes_coletivas_expediente_check/
        );
        await comoRH('DELETE FROM convencoes_coletivas WHERE id = $1', [rows[0].id]);
    });

    test('o tempo da prova de vida fica no registro da batida, dentro de um limite plausível', async () => {
        await comoA(
            `INSERT INTO activity_logs (employee_id, tipo, acao, date, operator_profile, prova_vida_ms) VALUES ($1, 'ponto', 'entrada', CURRENT_DATE, 'colaborador', 1830)`,
            [E_A]
        );
        await assert.rejects(
            comoA(
                `INSERT INTO activity_logs (employee_id, tipo, acao, date, operator_profile, prova_vida_ms) VALUES ($1, 'ponto', 'entrada', CURRENT_DATE, 'colaborador', 90000)`,
                [E_A]
            ),
            /activity_logs_prova_vida_ms_check/
        );
    });

    test('comunicados ganham a lista de quem já recebeu o push e o próximo envio', async () => {
        const { rows } = await withServiceRole((db) =>
            db.query(
                `SELECT column_name, data_type FROM information_schema.columns
                  WHERE table_name = 'messages' AND column_name IN ('push_sent_to', 'push_next_at') ORDER BY column_name`
            )
        );
        assert.deepEqual(rows, [
            { column_name: 'push_next_at', data_type: 'timestamp with time zone' },
            { column_name: 'push_sent_to', data_type: 'ARRAY' },
        ]);
    });
});

describe('Migration 118 — dias de trabalho, escala 12x36 e alerta de certificado', () => {
    test('o RH grava dias de trabalho e a escala 12x36; lista vazia ou dia inválido é recusado', async () => {
        await comoRH(`UPDATE employees SET expediente_dias = '{2,3,4,5,6}', escala_12x36_inicio = '2026-06-12' WHERE id = $1`, [E_A]);
        const { rows } = await comoRH('SELECT expediente_dias, escala_12x36_inicio::text AS escala FROM employees_decrypted WHERE id = $1', [E_A]);
        assert.deepEqual(rows[0], { expediente_dias: [2, 3, 4, 5, 6], escala: '2026-06-12' });
        await assert.rejects(comoRH(`UPDATE employees SET expediente_dias = '{}' WHERE id = $1`, [E_A]), /employees_expediente_dias_check/);
        await assert.rejects(comoRH(`UPDATE employees SET expediente_dias = '{7}' WHERE id = $1`, [E_A]), /employees_expediente_dias_check/);
        await assert.rejects(comoA(`UPDATE employees SET expediente_dias = '{1}' WHERE id = $1`, [E_A]), /só pode alterar/);
        await comoRH('UPDATE employees SET expediente_dias = NULL, escala_12x36_inicio = NULL WHERE id = $1', [E_A]);
    });

    test('certificado vencido ou a 30 dias do vencimento entra no alerta diário; o renovado sai', async () => {
        const hoje = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
        await comoRH(
            `INSERT INTO employee_trainings (employee_id, title, status, completion_date, certificado_valido_ate)
             VALUES ($1, 'NR-10', 'concluido', ${hoje} - 700, ${hoje} - 3),
                    ($1, 'Brigada', 'concluido', ${hoje} - 300, ${hoje} + 10),
                    ($1, 'Excel', 'concluido', ${hoje} - 10, ${hoje} + 400)`,
            [E_A]
        );
        const alertas = async () => {
            await withServiceRole((db) => db.query('SELECT generate_compliance_alerts()'));
            const { rows } = await comoRH(`SELECT alertas FROM compliance_alerts WHERE employee_id = $1 AND date = ${hoje}`, [E_A]);
            return (rows[0]?.alertas || []).filter((a) => a.tipo === 'certificado_validade').map((a) => [a.nivel, a.titulo]);
        };
        assert.deepEqual(await alertas(), [
            ['critico', 'Certificado de "NR-10" venceu há 3d — providencie a reciclagem'],
            ['atencao', 'Certificado de "Brigada" vence em 10d — programe a reciclagem'],
        ]);
        await comoRH(
            `INSERT INTO employee_trainings (employee_id, title, status, completion_date, certificado_valido_ate)
             VALUES ($1, 'nr-10', 'concluido', ${hoje}, ${hoje} + 700)`,
            [E_A]
        );
        assert.deepEqual(await alertas(), [['atencao', 'Certificado de "Brigada" vence em 10d — programe a reciclagem']]);
    });
});
