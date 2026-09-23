const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const U_ADMIN = '00000000-0000-4000-8000-00000000f101';
const U_ADMIN2 = '00000000-0000-4000-8000-00000000f102';
const U_COLAB = '00000000-0000-4000-8000-00000000f103';
const E_COLAB = '00000000-0000-4000-9000-00000000f103';

const EMAIL = { [U_ADMIN]: 'sec-admin@test.local', [U_ADMIN2]: 'sec-admin2@test.local', [U_COLAB]: 'sec-ana@test.local' };

before(async () => {
    await withServiceRole(async (db) => {
        await db.query(
            `INSERT INTO employees (id, name, cpf, email, dept, status) VALUES ($1, 'Ana Segurança', '905.000.000-03', $2, 'TI', 'Ativo') ON CONFLICT (id) DO NOTHING`,
            [E_COLAB, EMAIL[U_COLAB]]
        );
        for (const [uid, email] of Object.entries(EMAIL)) {
            await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email', [uid, email]);
        }
        await db.query(`INSERT INTO profiles (id, profile) VALUES ($1, 'Administrador'), ($2, 'Administrador') ON CONFLICT (id) DO NOTHING`, [
            U_ADMIN,
            U_ADMIN2,
        ]);
        await db.query(`INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'colaborador', $2) ON CONFLICT (id) DO NOTHING`, [U_COLAB, E_COLAB]);
    });
});

async function as(db, role, sub) {
    await db.query('RESET ROLE');
    await db.query(`SET LOCAL ROLE ${role}`);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub ?? '']);
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role, aal: 'aal2' })]);
}

async function asOwner(db, fn) {
    await db.query('RESET ROLE');
    return fn();
}

const falhas = async (db, email, vezes) => {
    await as(db, 'anon');
    for (let i = 0; i < vezes; i++) await db.query('SELECT report_login_failure($1)', [email]);
};
const alertas = async (db, kind) => {
    await db.query('RESET ROLE');
    return (await db.query('SELECT * FROM security_alerts WHERE kind = $1 ORDER BY created_at', [kind])).rows;
};

async function tentar(db, sql) {
    await db.query('SAVEPOINT tentativa');
    try {
        const r = await db.query(sql);
        await db.query('RELEASE SAVEPOINT tentativa');
        return r.rowCount ?? 0;
    } catch (e) {
        assert.match(e.message, /permission denied|row-level security/);
        await db.query('ROLLBACK TO SAVEPOINT tentativa');
        await db.query('RELEASE SAVEPOINT tentativa');
        return 0;
    }
}

describe('Alertas de comportamento anormal (migration 066)', () => {
    test('logins falhos em série: alerta na 5ª falha, uma vez só, citando a conta', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await falhas(db, EMAIL[U_COLAB], 4);
            assert.equal((await alertas(db, 'login_failures')).length, 0);
            await falhas(db, ` ${EMAIL[U_COLAB].toUpperCase()} `, 4);
            const a = await alertas(db, 'login_failures');
            assert.equal(a.length, 1);
            assert.match(a[0].message, /Ana Segurança/);
            assert.equal(a[0].actor_id, U_COLAB);
        });
    });

    test('e-mail que não existe: alerta de baixa gravidade e o e-mail digitado não é guardado', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await falhas(db, 'nao-existe@test.local', 5);
            const a = await alertas(db, 'login_failures');
            assert.equal(a.length, 1);
            assert.equal(a[0].severity, 'info');
            const { rows } = await db.query(
                "SELECT count(*)::int AS n FROM security_events WHERE detail::text ILIKE '%nao-existe%' OR ip ILIKE '%nao-existe%'"
            );
            assert.equal(rows[0].n, 0);
        });
    });

    test('login concluído depois de 3 falhas gera alerta próprio; sem falhas não gera', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await as(db, 'authenticated', U_ADMIN2);
            await db.query("SELECT record_access('login')");
            assert.equal((await alertas(db, 'login_after_failures')).length, 0);

            await falhas(db, EMAIL[U_COLAB], 3);
            await as(db, 'authenticated', U_COLAB);
            await db.query("SELECT record_access('login')");
            const a = await alertas(db, 'login_after_failures');
            assert.equal(a.length, 1);
            assert.match(a[0].title, /3 falhas/);
        });
    });

    test('código de MFA errado repetido conta como falha de login', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await as(db, 'authenticated', U_ADMIN);
            for (let i = 0; i < 5; i++) await db.query('SELECT report_mfa_failure()');
            assert.equal((await alertas(db, 'login_failures')).length, 1);
        });
    });

    test('acesso do RH fora do horário alerta uma vez; colaborador e horário comercial não alertam', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await asOwner(db, () =>
                db.query(`UPDATE security_rules SET params = params || '{"start_hour":0,"end_hour":24,"weekdays_only":false}' WHERE kind = 'off_hours_access'`)
            );
            await as(db, 'authenticated', U_ADMIN);
            await db.query("SELECT record_access('session')");
            assert.equal((await alertas(db, 'off_hours_access')).length, 0);

            await asOwner(db, () => db.query(`UPDATE security_rules SET params = params || '{"start_hour":0,"end_hour":0}' WHERE kind = 'off_hours_access'`));
            await as(db, 'authenticated', U_COLAB);
            await db.query("SELECT record_access('session')");
            assert.equal((await alertas(db, 'off_hours_access')).length, 0);

            await as(db, 'authenticated', U_ADMIN);
            await db.query("SELECT record_access('session')");
            await db.query("SELECT record_access('login')");
            const a = await alertas(db, 'off_hours_access');
            assert.equal(a.length, 1);
            assert.match(a[0].message, /sec-admin@test\.local/);
        });
    });

    test('exportações em massa: 5 exportações ou 500 registros em 1 h', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await as(db, 'authenticated', U_ADMIN);
            for (let i = 0; i < 4; i++) await db.query("SELECT report_data_export('colaboradores.xlsx', 3)");
            assert.equal((await alertas(db, 'mass_export')).length, 0);
            await as(db, 'authenticated', U_ADMIN);
            await db.query("SELECT report_data_export('ferias.csv', 3)");
            const a = await alertas(db, 'mass_export');
            assert.equal(a.length, 1);
            assert.match(a[0].message, /colaboradores\.xlsx, ferias\.csv/);

            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await asOwner(db, () => db.query('DELETE FROM security_events'));
            await as(db, 'authenticated', U_ADMIN2);
            await db.query("SELECT report_data_export('folha.xlsx', 600)");
            assert.equal((await alertas(db, 'mass_export')).length, 1);
        });
    });

    test('downloads em massa: 30 arquivos em 10 min', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await as(db, 'authenticated', U_COLAB);
            for (let i = 0; i < 29; i++) await db.query("SELECT report_file_download('documents')");
            assert.equal((await alertas(db, 'mass_download')).length, 0);
            await as(db, 'authenticated', U_COLAB);
            await db.query("SELECT report_file_download('documents')");
            assert.equal((await alertas(db, 'mass_download')).length, 1);
        });
    });

    test('eventos fora da janela não contam e alerta fora do período de espera pode se repetir', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await falhas(db, EMAIL[U_COLAB], 4);
            await asOwner(db, () => db.query("UPDATE security_events SET created_at = now() - interval '2 hours'"));
            await falhas(db, EMAIL[U_COLAB], 1);
            assert.equal((await alertas(db, 'login_failures')).length, 0);

            await falhas(db, EMAIL[U_COLAB], 4);
            assert.equal((await alertas(db, 'login_failures')).length, 1);
            await asOwner(db, () => db.query("UPDATE security_alerts SET created_at = now() - interval '2 hours'"));
            await falhas(db, EMAIL[U_COLAB], 1);
            assert.equal((await alertas(db, 'login_failures')).length, 2);
        });
    });

    test('regra desligada não alerta', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await asOwner(db, () => db.query("UPDATE security_rules SET enabled = false WHERE kind = 'login_failures'"));
            await falhas(db, EMAIL[U_COLAB], 8);
            assert.equal((await alertas(db, 'login_failures')).length, 0);
        });
    });

    test('só o RH lê alertas e regras; ninguém edita, apaga nem lê os eventos pela API', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await falhas(db, EMAIL[U_COLAB], 5);

            await as(db, 'authenticated', U_ADMIN);
            assert.equal((await db.query('SELECT id FROM security_alerts')).rows.length, 1);
            assert.equal((await db.query('SELECT kind FROM security_rules')).rows.length, 6);

            await as(db, 'authenticated', U_COLAB);
            assert.equal((await db.query('SELECT id FROM security_alerts')).rows.length, 0);
            assert.equal((await db.query('SELECT kind FROM security_rules')).rows.length, 0);

            await as(db, 'authenticated', U_ADMIN);
            assert.equal(await tentar(db, 'SELECT * FROM security_events'), 0);
            assert.equal(await tentar(db, 'UPDATE security_alerts SET lido = true'), 0);
            assert.equal(await tentar(db, 'DELETE FROM security_alerts'), 0);

            const { rows } = await asOwner(db, () => db.query('SELECT count(*)::int AS n FROM security_alerts WHERE NOT lido'));
            assert.equal(rows[0].n, 1);
        });
    });

    test('anon só chama report_login_failure; funções internas ficam fechadas', async () => {
        await withServiceRole(async (db) => {
            const priv = async (fn, role) => (await db.query('SELECT has_function_privilege($1, $2, $3) AS ok', [role, fn, 'EXECUTE'])).rows[0].ok;
            assert.equal(await priv('report_login_failure(text)', 'anon'), true);
            for (const fn of [
                'record_access(text)',
                'report_data_export(text,integer)',
                'report_file_download(text)',
                'report_mfa_failure()',
                'mark_security_alerts_read(uuid[])',
            ]) {
                assert.equal(await priv(fn, 'anon'), false, `${fn} não deveria estar aberta para anon`);
                assert.equal(await priv(fn, 'authenticated'), true, `${fn} deveria estar aberta para authenticated`);
            }
            for (const fn of [
                'security_raise_alert(security_rules,text,uuid,text,text,text,jsonb,text)',
                'security_insert_event(text,uuid,text,jsonb,integer)',
                'purge_security_events()',
            ]) {
                assert.equal(await priv(fn, 'anon'), false);
                assert.equal(await priv(fn, 'authenticated'), false);
            }
        });
    });

    test('marcar como lido é só para o RH e registra quem leu', async () => {
        await withUser({ sub: U_ADMIN }, async (db) => {
            await asOwner(db, () => db.query('DELETE FROM security_alerts'));
            await falhas(db, EMAIL[U_COLAB], 5);
            const [alerta] = await alertas(db, 'login_failures');

            await as(db, 'authenticated', U_COLAB);
            await db.query('SAVEPOINT s');
            await assert.rejects(db.query('SELECT mark_security_alerts_read($1)', [[alerta.id]]), /Sem permissão/);
            await db.query('ROLLBACK TO SAVEPOINT s');

            await as(db, 'authenticated', U_ADMIN);
            const { rows } = await db.query('SELECT mark_security_alerts_read($1) AS n', [[alerta.id]]);
            assert.equal(rows[0].n, 1);
            const [lido] = await alertas(db, 'login_failures');
            assert.equal(lido.lido, true);
            assert.equal(lido.lido_por, U_ADMIN);
        });
    });
});
