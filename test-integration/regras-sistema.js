const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_RH = '00000000-0000-4000-8000-00000000f801';
const U_A = '00000000-0000-4000-8000-00000000f802';
const U_B = '00000000-0000-4000-8000-00000000f803';

const E_RH = '00000000-0000-4000-9000-00000000f801';
const E_A = '00000000-0000-4000-9000-00000000f802';
const E_B = '00000000-0000-4000-9000-00000000f803';

const rh = (fn, opts = {}) => withUser({ sub: U_RH, ...opts }, fn);
const colabA = (fn, opts = {}) => withUser({ sub: U_A, ...opts }, fn);
const colabB = (fn, opts = {}) => withUser({ sub: U_B, ...opts }, fn);

before(async () => {
    await withServiceRole(async (db) => {
        for (const id of [U_RH, U_A, U_B]) await db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status)
             VALUES ($1, 'Regras RH', '951.000.000-01', 'regras.rh@test.local', 'RH', 'Ativo'),
                    ($2, 'Regras A', '951.000.000-02', 'regras.a@test.local', 'Vendas', 'Ativo'),
                    ($3, 'Regras B', '951.000.000-03', 'regras.b@test.local', 'Vendas', 'Ativo')
             ON CONFLICT (id) DO NOTHING`,
            [E_RH, E_A, E_B]
        );
        await db.query(
            `INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6)
             ON CONFLICT (id) DO NOTHING`,
            [U_RH, E_RH, U_A, E_A, U_B, E_B]
        );
    });
});

after(async () => {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM payslips WHERE employee_id = ANY($1)', [[E_A, E_B]]);
        await db.query('DELETE FROM documents WHERE employee_id = ANY($1)', [[E_A, E_B]]);
        await db.query('DELETE FROM document_audit_log WHERE employee_id = ANY($1)', [[E_A, E_B]]);
        await db.query('DELETE FROM hr_tickets WHERE employee_id = ANY($1)', [[E_A, E_B]]);
        await db.query('DELETE FROM time_records WHERE employee_id = ANY($1)', [[E_A, E_B]]);
        await db.query('DELETE FROM auth.users WHERE id = ANY($1)', [[U_RH, U_A, U_B]]);
        await db.query('DELETE FROM employees WHERE id = ANY($1)', [[E_RH, E_A, E_B]]);
    });
});

const FERIAS = [
    { cod: '040', descricao: 'Adiantamento de Férias', referencia: '20 dias', valor: 1500 },
    { cod: '041', descricao: '1/3 Constitucional de Férias', referencia: '—', valor: 500 },
];
const SALARIO = { cod: '001', descricao: 'Salário Base', referencia: '30 dias', valor: 3000 };
const INSS = { cod: '901', descricao: 'INSS (salário + férias)', referencia: '11%', valor: 452.2 };

const upsertSlip = (db, mes, { proventos, descontos, status }) =>
    db.query(
        `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
         VALUES ($1, $2, $3, $4, '0', '0', '0', $5)
         ON CONFLICT (employee_id, mes) DO UPDATE SET proventos = EXCLUDED.proventos, descontos = EXCLUDED.descontos, status = EXCLUDED.status`,
        [E_A, mes, JSON.stringify(proventos), JSON.stringify(descontos), status]
    );

describe('Regra 3 — férias só fecham no holerite com INSS/IRRF', () => {
    test('o evento de férias cria o holerite em rascunho, invisível ao colaborador', async () => {
        await rh(
            (db) => db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-08', 'Agosto 2026', '08/2026', JSON.stringify(FERIAS)]),
            { commit: true }
        );
        const { rows } = await rh((db) => db.query('SELECT status FROM payslips WHERE employee_id = $1 AND mes = $2', [E_A, '2026-08']));
        assert.deepEqual(rows, [{ status: 'rascunho' }]);
        const visto = await colabA((db) => db.query('SELECT 1 FROM payslips WHERE mes = $1', ['2026-08']));
        assert.equal(visto.rowCount, 0);
    });

    test('RH não publica nem paga holerite com férias sem desconto de INSS', async () => {
        await rh(async (db) => {
            await assert.rejects(
                () => upsertSlip(db, '2026-09', { proventos: [SALARIO, ...FERIAS], descontos: [], status: 'publicado' }),
                /férias sem desconto de INSS/
            );
        });
        await rh(async (db) => {
            await assert.rejects(() => upsertSlip(db, '2026-09', { proventos: [SALARIO, ...FERIAS], descontos: [], status: 'pago' }), /sem desconto de INSS/);
        });
    });

    test('com INSS calculado, o holerite com férias fecha normalmente', async () => {
        await rh(async (db) => {
            await upsertSlip(db, '2026-09', { proventos: [SALARIO, ...FERIAS], descontos: [INSS], status: 'pago' });
            const { rows } = await db.query('SELECT status FROM payslips WHERE employee_id = $1 AND mes = $2', [E_A, '2026-09']);
            assert.deepEqual(rows, [{ status: 'pago' }]);
        });
    });

    test('rascunho não vira publicado só trocando o status (sem recalcular)', async () => {
        await rh(async (db) => {
            await assert.rejects(
                () => db.query(`UPDATE payslips SET status = 'publicado' WHERE employee_id = $1 AND mes = '2026-08'`, [E_A]),
                /rascunho só é publicado com a folha recalculada/
            );
        });
    });

    test('evento de férias num holerite já pago é recusado (vai para folha complementar)', async () => {
        await rh((db) => upsertSlip(db, '2026-10', { proventos: [SALARIO], descontos: [], status: 'pago' }), { commit: true });
        await rh(async (db) => {
            await assert.rejects(
                () => db.query('SELECT apply_ferias_payroll_event($1, $2, $3, $4, $5)', [E_A, '2026-10', 'Outubro 2026', '10/2026', JSON.stringify(FERIAS)]),
                /já foi pago/
            );
        });
    });
});

describe('Recibo de férias (migration 093) — pago antes do gozo, fora da folha do mês', () => {
    const PROV = [
        { cod: '040', descricao: 'Adiantamento de Férias', referencia: '20 dias', valor: 2000 },
        { cod: '041', descricao: '1/3 Constitucional de Férias', referencia: '—', valor: 666.67 },
        { cod: '042', descricao: 'Abono Pecuniário', referencia: '10 dias', valor: 1000 },
    ];
    const DESC = [{ cod: '901', descricao: 'INSS sobre férias', referencia: '9%', valor: 215.68 }];
    const emitir = (db, mes, descontos = DESC) =>
        db.query('SELECT apply_ferias_recibo($1, $2, $3, $4, $5, $6)', [
            E_A,
            mes,
            'Recibo de Férias',
            '11/2026',
            JSON.stringify(PROV),
            JSON.stringify(descontos),
        ]);

    test('RH emite o recibo com totais calculados; colaborador vê; repetir não duplica', async () => {
        await colabA(async (db) => {
            await assert.rejects(() => emitir(db, '2026-11-F09'), /Apenas o RH/);
        });
        await rh(
            async (db) => {
                await emitir(db, '2026-11-F09');
                await emitir(db, '2026-11-F09');
            },
            { commit: true }
        );
        const { rows } = await colabA((db) =>
            db.query(`SELECT status, total_proventos, total_descontos, salario_liquido FROM payslips_decrypted WHERE mes = '2026-11-F09'`)
        );
        assert.deepEqual(rows, [{ status: 'publicado', total_proventos: '3666.67', total_descontos: '215.68', salario_liquido: '3450.99' }]);
    });

    test('recibo com férias sem INSS é recusado; chave fora do padrão também', async () => {
        await rh(async (db) => {
            await assert.rejects(() => emitir(db, '2026-11-F16', []), /sem desconto de INSS/);
        });
        await rh(async (db) => {
            await assert.rejects(() => emitir(db, '2026-11'), /Chave de recibo de férias inválida/);
        });
    });

    test('cancelar apaga o recibo a pagar; recibo pago não se apaga', async () => {
        await rh((db) => emitir(db, '2026-11-F23'), { commit: true });
        await rh((db) => db.query(`SELECT revert_ferias_recibo($1, '2026-11-F23')`, [E_A]), { commit: true });
        const sobrou = await withServiceRole((db) => db.query(`SELECT 1 FROM payslips WHERE employee_id = $1 AND mes = '2026-11-F23'`, [E_A]));
        assert.equal(sobrou.rowCount, 0);

        await rh((db) => db.query(`UPDATE payslips SET status = 'pago' WHERE employee_id = $1 AND mes = '2026-11-F09'`, [E_A]), { commit: true });
        await rh(async (db) => {
            await assert.rejects(() => db.query(`SELECT revert_ferias_recibo($1, '2026-11-F09')`, [E_A]), /já foi pago/);
        });
    });

    test('férias vencidas: os 10 dias vendidos no abono contam como usados', async () => {
        await withServiceRole(async (db) => {
            await db.query(
                `UPDATE employees SET admission_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '3 years' + interval '5 days', contract_type = 'clt' WHERE id = $1`,
                [E_B]
            );
            await db.query(
                `INSERT INTO vacations (employee_id, start_date, end_date, days, abono, status) VALUES ($1, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 400, (now() AT TIME ZONE 'America/Sao_Paulo')::date - 381, 20, true, 'concluido')`,
                [E_B]
            );
        });
        const vencidas = async () => {
            await withServiceRole((db) => db.query('SELECT generate_compliance_alerts()'));
            const { rows } = await withServiceRole((db) =>
                db.query(`SELECT alertas FROM compliance_alerts WHERE employee_id = $1 AND date = (now() AT TIME ZONE 'America/Sao_Paulo')::date`, [E_B])
            );
            return (rows[0]?.alertas || []).filter((a) => a.tipo === 'ferias_vencidas').map((a) => a.titulo);
        };
        assert.deepEqual(await vencidas(), [], '20 de gozo + 10 vendidos quitam o primeiro período');

        await withServiceRole((db) => db.query('UPDATE vacations SET abono = false WHERE employee_id = $1', [E_B]));
        assert.deepEqual(await vencidas(), ['10 dia(s) de férias vencidas']);
        await withServiceRole(async (db) => {
            await db.query('DELETE FROM compliance_alerts WHERE employee_id = $1', [E_B]);
            await db.query('DELETE FROM vacations WHERE employee_id = $1', [E_B]);
        });
    });
});

describe('Regra 5 — documentos sob guarda legal', () => {
    const D_APROVADO = '00000000-0000-4000-a000-00000000f801';
    const D_PENDENTE = '00000000-0000-4000-a000-00000000f802';
    const D_VENCIDO = '00000000-0000-4000-a000-00000000f803';

    before(async () => {
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO documents (id, name, employee_id, tipo, source, status, storage_path, retido_ate) VALUES
                   ($1, 'rg-aprovado.pdf', $4, 'RG', 'colaborador', 'aprovado', 'x/rg-aprovado.pdf', CURRENT_DATE + 365),
                   ($2, 'rg-pendente.pdf', $4, 'RG', 'colaborador', 'pendente', 'x/rg-pendente.pdf', CURRENT_DATE + 365),
                   ($3, 'rg-vencido.pdf',  $4, 'RG', 'colaborador', 'aprovado', 'x/rg-vencido.pdf',  CURRENT_DATE - 1)
                 ON CONFLICT (id) DO NOTHING`,
                [D_APROVADO, D_PENDENTE, D_VENCIDO, E_A]
            )
        );
    });

    test('colaborador não apaga documento aprovado dentro da guarda; apaga o pendente e o de guarda vencida', async () => {
        await colabA(async (db) => {
            const retido = await db.query('DELETE FROM documents WHERE id = $1', [D_APROVADO]);
            assert.equal(retido.rowCount, 0, 'a política de DELETE não alcança o documento retido');
            assert.equal((await db.query('DELETE FROM documents WHERE id = $1', [D_PENDENTE])).rowCount, 1);
            assert.equal((await db.query('DELETE FROM documents WHERE id = $1', [D_VENCIDO])).rowCount, 1);
        });
    });

    test('nem o RH apaga fisicamente um documento sob guarda', async () => {
        await rh(async (db) => {
            await assert.rejects(() => db.query('DELETE FROM documents WHERE id = $1', [D_APROVADO]), /sob guarda legal/);
        });
    });

    test('exclusão lógica exige motivo; registra quem, quando e por quê; some para o colaborador', async () => {
        await rh(async (db) => {
            await assert.rejects(() => db.query('SELECT soft_delete_documents($1, $2)', [[D_APROVADO], 'curto']), /motivo da exclusão/);
        });
        await colabA(async (db) => {
            await assert.rejects(() => db.query('SELECT soft_delete_documents($1, $2)', [[D_APROVADO], 'Não quero mais este documento']), /Apenas o RH/);
        });

        const n = await rh((db) => db.query('SELECT soft_delete_documents($1, $2) AS n', [[D_APROVADO], 'Enviado ao colaborador errado']), { commit: true });
        assert.equal(n.rows[0].n, 1);

        const { rows } = await withServiceRole((db) =>
            db.query(
                `SELECT d.deleted_at IS NOT NULL AS excluido, d.deleted_by, d.deleted_reason, a.action, a.details->>'motivo' AS motivo
                   FROM documents d JOIN document_audit_log a ON a.document_id = d.id WHERE d.id = $1`,
                [D_APROVADO]
            )
        );
        assert.deepEqual(rows, [
            { excluido: true, deleted_by: U_RH, deleted_reason: 'Enviado ao colaborador errado', action: 'excluido', motivo: 'Enviado ao colaborador errado' },
        ]);

        const visto = await colabA((db) => db.query('SELECT 1 FROM documents WHERE id = $1', [D_APROVADO]));
        assert.equal(visto.rowCount, 0);
    });

    test('documento excluído fica imutável e a exclusão não se faz por UPDATE direto', async () => {
        await rh(async (db) => {
            await assert.rejects(() => db.query('UPDATE documents SET deleted_at = NULL WHERE id = $1', [D_APROVADO]), /não pode ser alterado/);
        });
        const outro = '00000000-0000-4000-a000-00000000f804';
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO documents (id, name, employee_id, tipo, source, status, retido_ate) VALUES ($1, 'cpf.pdf', $2, 'CPF', 'Administrador', 'aprovado', CURRENT_DATE + 30)`,
                [outro, E_A]
            )
        );
        await rh(async (db) => {
            await assert.rejects(() => db.query(`UPDATE documents SET deleted_at = NOW() WHERE id = $1`, [outro]), /soft_delete_documents/);
        });
    });

    test('o arquivo de documento sob guarda não sai do Storage', async () => {
        const { rows } = await withServiceRole((db) =>
            db.query('SELECT document_path_locked($1) AS aprovado, document_path_locked($2) AS livre', ['x/rg-aprovado.pdf', 'x/qualquer.pdf'])
        );
        assert.deepEqual(rows, [{ aprovado: true, livre: false }]);
    });
});

describe('Regra 6 — histórico de atendimentos preservado', () => {
    const T1 = '00000000-0000-4000-b000-00000000f801';

    before(async () => {
        await withServiceRole(async (db) => {
            await db.query(`INSERT INTO hr_tickets (id, employee_id, subject, status) VALUES ($1, $2, 'Dúvida', 'aguardando_rh') ON CONFLICT (id) DO NOTHING`, [
                T1,
                E_A,
            ]);
            await db.query(`INSERT INTO hr_ticket_messages (ticket_id, employee_id, role, content) VALUES ($1, $2, 'user', 'Olá')`, [T1, E_A]);
        });
    });

    test('colaborador não apaga o atendimento; "apagar" só esconde para ele', async () => {
        await colabA(async (db) => {
            const del = await db.query('DELETE FROM hr_tickets WHERE id = $1', [T1]);
            assert.equal(del.rowCount, 0);
            await db.query('INSERT INTO hr_ticket_hidden (employee_id, ticket_id) VALUES ($1, $2)', [E_A, T1]);
        });
        const { rows } = await rh((db) => db.query('SELECT count(*)::int AS n FROM hr_ticket_messages WHERE ticket_id = $1', [T1]));
        assert.equal(rows[0].n, 1, 'o RH continua vendo tudo');
    });

    test('nem o RH apaga ou reescreve o histórico pela API', async () => {
        await rh(async (db) => {
            await assert.rejects(() => db.query('DELETE FROM hr_tickets WHERE id = $1', [T1]), /histórico de atendimentos é preservado/);
        });
        await rh(async (db) => {
            await assert.rejects(() => db.query(`UPDATE hr_ticket_messages SET content = 'editado' WHERE ticket_id = $1`, [T1]), /não podem ser alteradas/);
        });
        await rh(async (db) => {
            await assert.rejects(() => db.query('DELETE FROM hr_ticket_messages WHERE ticket_id = $1', [T1]), /preservado/);
        });
    });
});

describe('Regra 7 — biometria facial isolada, cifrada e comparada só no banco', () => {
    const rosto = (seed) => JSON.stringify(Array.from({ length: 128 }, (_, i) => +(Math.sin(i * 7 + seed) * 0.1).toFixed(6)));
    let selfies = 0;
    const parecido = (seed) => {
        const d = 0.01 + ++selfies * 0.0001;
        return JSON.stringify(JSON.parse(rosto(seed)).map((v) => +(v + d).toFixed(6)));
    };

    test('sem consentimento ou com vetor inválido não cadastra', async () => {
        await colabA(async (db) => {
            await assert.rejects(() => db.query('SELECT biometric_enroll($1, false, $2)', [rosto(1), 'v1']), /consentimento/);
        });
        await colabA(async (db) => {
            await assert.rejects(() => db.query('SELECT biometric_enroll($1, true, $2)', ['[1,2,3]', 'v1']), /Modelo facial inválido/);
        });
    });

    test('sem biometria cadastrada, a batida segue sem verificação', async () => {
        const { rows } = await colabA((db) =>
            db.query(`SELECT (punch_time_record((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'entrada')).entrada IS NOT NULL AS ok`)
        );
        assert.deepEqual(rows, [{ ok: true }]);
    });

    test('cadastro cifra o modelo e ninguém o lê pela API (nem o RH, nem o próprio colaborador)', async () => {
        await colabA((db) => db.query('SELECT biometric_enroll($1, true, $2)', [rosto(1), 'lgpd-bio-v1']), { commit: true });
        const { rows } = await withServiceRole((db) => db.query('SELECT template, consent_version FROM biometric_templates WHERE employee_id = $1', [E_A]));
        assert.match(rows[0].template, /^nexus:enc/);
        assert.equal(rows[0].consent_version, 'lgpd-bio-v1');

        const semAcesso = (db, sql, params) =>
            db.query(sql, params).then(
                (r) => r.rowCount,
                (e) => (/permission denied|row-level security/.test(e.message) ? 0 : Promise.reject(e))
            );
        for (const quem of [colabA, rh]) {
            await quem(async (db) => {
                assert.equal(await semAcesso(db, 'SELECT * FROM biometric_templates'), 0);
                assert.equal(await semAcesso(db, 'SELECT * FROM biometric_verifications'), 0);
            });
            await quem(async (db) => {
                assert.equal(await semAcesso(db, `UPDATE biometric_verifications SET matched = true`), 0);
            });
        }
        const status = await colabA((db) => db.query('SELECT biometric_status() AS s'));
        assert.equal(status.rows[0].s.enrolled, true);
        assert.equal(status.rows[0].s.template, undefined, 'o status não devolve o modelo');
    });

    test('verificação compara no banco e só devolve o resultado', async () => {
        const outro = await colabA((db) => db.query('SELECT biometric_verify($1) AS r', [rosto(40)]));
        assert.deepEqual(outro.rows[0].r, { enrolled: true, matched: false, verification_id: null });
        const mesmo = await colabA((db) => db.query('SELECT biometric_verify($1) AS r', [parecido(1)]));
        assert.equal(mesmo.rows[0].r.matched, true);
        assert.match(mesmo.rows[0].r.verification_id, /^[0-9a-f-]{36}$/);
        assert.equal(Object.keys(mesmo.rows[0].r).sort().join(','), 'enrolled,matched,verification_id');
    });

    test('com biometria cadastrada, a batida exige verificação aprovada, do próprio colaborador e de uso único', async () => {
        await colabA(async (db) => {
            await assert.rejects(
                () => db.query(`SELECT punch_time_record((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'saida_almoco')`),
                /Verificação facial ausente/
            );
        });
        await colabA(async (db) => {
            const falhou = (await db.query('SELECT biometric_verify($1) AS r', [rosto(40)])).rows[0].r;
            assert.equal(falhou.verification_id, null);
            const ok = (await db.query('SELECT biometric_verify($1) AS r', [parecido(1)])).rows[0].r.verification_id;
            await db.query(`SELECT punch_time_record((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'saida_almoco', NULL, NULL, $1)`, [ok]);
            await db.query('SAVEPOINT s');
            await assert.rejects(
                () => db.query(`SELECT punch_time_record((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'retorno_almoco', NULL, NULL, $1)`, [ok]),
                /ausente ou expirada/
            );
            await db.query('ROLLBACK TO SAVEPOINT s');
        });

        const tokenDeA = await colabA((db) => db.query('SELECT biometric_verify($1) AS r', [parecido(1)]), { commit: true });
        await colabB((db) => db.query('SELECT biometric_enroll($1, true, $2)', [rosto(2), 'lgpd-bio-v1']), { commit: true });
        await colabB(async (db) => {
            await assert.rejects(
                () =>
                    db.query(`SELECT punch_time_record((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'entrada', NULL, NULL, $1)`, [
                        tokenDeA.rows[0].r.verification_id,
                    ]),
                /ausente ou expirada/
            );
        });
    });

    test('reenvio não passa: o mesmo vetor duas vezes, ou o próprio modelo cadastrado, é recusado', async () => {
        const selfie = parecido(1);
        const primeira = await colabA((db) => db.query('SELECT biometric_verify($1) AS r', [selfie]), { commit: true });
        assert.equal(primeira.rows[0].r.matched, true);
        const replay = await colabA((db) => db.query('SELECT biometric_verify($1) AS r', [selfie]));
        assert.deepEqual(replay.rows[0].r, { enrolled: true, matched: false, verification_id: null });
        const modelo = await colabA((db) => db.query('SELECT biometric_verify($1) AS r', [rosto(1)]));
        assert.equal(modelo.rows[0].r.matched, false, 'vetor idêntico ao cadastro não é uma selfie nova');
    });

    test('revogar o consentimento apaga o modelo e o histórico de verificações', async () => {
        await colabA((db) => db.query('SELECT biometric_revoke()'), { commit: true });
        const { rows } = await withServiceRole((db) =>
            db.query(
                'SELECT (SELECT count(*) FROM biometric_templates WHERE employee_id = $1)::int AS t, (SELECT count(*) FROM biometric_verifications WHERE employee_id = $1)::int AS v',
                [E_A]
            )
        );
        assert.deepEqual(rows, [{ t: 0, v: 0 }]);
    });

    test('a foto de perfil não é referência biométrica: o modelo entra na rotação de chaves como coluna cifrada', async () => {
        const { rows } = await withServiceRole((db) =>
            db.query(`SELECT 1 FROM nexus_encrypted_columns() WHERE tbl = 'biometric_templates' AND col = 'template'`)
        );
        assert.equal(rows.length, 1);
    });
});
