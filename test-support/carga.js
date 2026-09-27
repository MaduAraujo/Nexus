const { createClient } = require('@supabase/supabase-js');
const { LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY } = require('./e2e-supabase-config.js');
const { E2E_USERS, E2E_ADMIN_TOTP_SECRET, seedE2EUsers } = require('./e2e-seed.js');
const { totp } = require('./totp.js');
const { withServiceRole } = require('./pg-rls-client.js');

const VUS = Number(process.env.CARGA_VUS || 20);
const VUS_RH = Number(process.env.CARGA_VUS_RH || 3);
const SEGUNDOS = Number(process.env.CARGA_SEGUNDOS || 20);
const FUNCIONARIOS = Number(process.env.CARGA_FUNCIONARIOS || 150);
const P95_MAX_MS = Number(process.env.CARGA_P95_MS || 2000);
const PREFIXO_CPF = '777';

const hoje = new Date();
const MES = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

async function semear() {
    await withServiceRole(async (db) => {
        await seedE2EUsers(db);
        await db.query('BEGIN');
        const { rows } = await db.query(
            `INSERT INTO employees (name, cpf, email, dept, status, admission_date, contract_type, work_load, salary)
             SELECT 'Carga ' || g, $1 || lpad(g::text, 8, '0'), 'carga' || g || '@nexustest.local',
                    (ARRAY['TI','RH','Financeiro','Marketing','Jurídico'])[1 + g % 5], 'Ativo', '2023-03-01', 'clt', '40h', 3000 + (g % 20) * 250
               FROM generate_series(1, $2) g
             RETURNING id`,
            [PREFIXO_CPF, FUNCIONARIOS]
        );
        const ids = rows.map((r) => r.id);
        await db.query(
            `INSERT INTO time_records (employee_id, date, entrada, saida_almoco, retorno_almoco, saida)
             SELECT e, d, d + time '08:00', d + time '12:00', d + time '13:00', d + time '17:00'
               FROM unnest($1::uuid[]) e
              CROSS JOIN generate_series(date_trunc('month', current_date), current_date - 1, interval '1 day') d
              WHERE extract(isodow FROM d) < 6`,
            [ids]
        );
        await db.query(
            `INSERT INTO payslips (employee_id, mes, mes_formatado, competencia, proventos, descontos, total_proventos, total_descontos, salario_liquido, status)
             SELECT e, $2, 'Carga', '00/0000', '[{"cod":"001","descricao":"Salário Base","referencia":"30 dias","valor":4000}]',
                    '[{"cod":"901","descricao":"INSS","referencia":"9%","valor":360}]', '4000', '360', '3640', 'publicado'
               FROM unnest($1::uuid[]) e`,
            [ids, MES]
        );
        await db.query('COMMIT');
    });
}

async function limpar() {
    await withServiceRole(async (db) => {
        const cond = `employee_id IN (SELECT id FROM employees WHERE name LIKE 'Carga %' AND email LIKE 'carga%@nexustest.local')`;
        await db.query(`DELETE FROM payslips WHERE ${cond}`);
        await db.query(`DELETE FROM time_records WHERE ${cond}`);
        await db.query(`DELETE FROM employees WHERE name LIKE 'Carga %' AND email LIKE 'carga%@nexustest.local'`);
    });
}

async function sessao(user, { mfa = false } = {}) {
    const sb = createClient(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await sb.auth.signInWithPassword({ email: user.email, password: user.password });
    if (error) throw new Error(`login ${user.email}: ${error.message}`);
    if (mfa) {
        const { data } = await sb.auth.mfa.listFactors();
        const factorId = data.totp[0].id;
        const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId, code: totp(E2E_ADMIN_TOTP_SECRET) });
        if (e2) throw new Error(`MFA: ${e2.message}`);
    }
    return sb;
}

const falhou = (label) => (r) => {
    if (r.error) throw new Error(`${label}: ${r.error.message}`);
    return r;
};

function cenarios(colab, rh) {
    const inicio = `${MES}-01`;
    return {
        'colaborador abre o ponto, holerites e comunicados': {
            vus: VUS,
            fn: async () => {
                await Promise.all([
                    colab.rpc('biometric_status').then(falhou('biometric_status')),
                    colab.from('time_records').select('*').gte('date', inicio).then(falhou('time_records')),
                    colab.from('payslips_decrypted').select('*').in('status', ['pago', 'publicado']).then(falhou('payslips')),
                    colab.from('messages').select('*').order('created_at', { ascending: false }).limit(50).then(falhou('messages')),
                ]);
            },
        },
        'RH abre a folha do mês (holerites decifrados no banco)': {
            vus: VUS_RH,
            fn: async () => {
                await Promise.all([
                    rh.from('employees_decrypted').select('id,name,salary,contract_type,dept').in('status', ['Ativo', 'ativo']).then(falhou('employees')),
                    rh.from('payslips_decrypted').select('*').eq('mes', MES).then(falhou('payslips')),
                    rh.from('vacations').select('employee_id,start_date,end_date,days,abono').in('status', ['aprovado', 'concluido']).then(falhou('vacations')),
                ]);
            },
        },
        'RH abre o banco de horas (ponto do mês de todos)': {
            vus: VUS_RH,
            fn: async () => {
                await rh
                    .from('time_records')
                    .select('employee_id,date,entrada,saida_almoco,retorno_almoco,saida')
                    .gte('date', inicio)
                    .then(falhou('time_records'));
            },
        },
    };
}

async function rodar(nome, { vus, fn }) {
    const tempos = [];
    const erros = [];
    const fim = Date.now() + SEGUNDOS * 1000;
    await Promise.all(
        Array.from({ length: vus }, async () => {
            while (Date.now() < fim) {
                const t0 = performance.now();
                try {
                    await fn();
                    tempos.push(performance.now() - t0);
                } catch (e) {
                    erros.push(e.message);
                }
            }
        })
    );
    tempos.sort((a, b) => a - b);
    const p = (q) => Math.round(tempos[Math.min(tempos.length - 1, Math.floor(q * tempos.length))] || 0);
    return { nome, vus, iteracoes: tempos.length, erros, p50: p(0.5), p95: p(0.95), p99: p(0.99), rps: +(tempos.length / SEGUNDOS).toFixed(1) };
}

async function main() {
    console.log(
        `Carga: ${VUS} colaboradores + ${VUS_RH} RH simultâneos × ${SEGUNDOS}s por cenário, ${FUNCIONARIOS} colaboradores semeados, limite p95 ${P95_MAX_MS} ms`
    );
    await limpar();
    await semear();
    let falhas = 0;
    try {
        const colab = await sessao(E2E_USERS.colaborador);
        const rh = await sessao(E2E_USERS.administrador, { mfa: true });
        for (const [nome, cenario] of Object.entries(cenarios(colab, rh))) {
            const r = await rodar(nome, cenario);
            const ok = !r.erros.length && r.p95 <= P95_MAX_MS && r.iteracoes > 0;
            if (!ok) falhas++;
            console.log(
                `${ok ? 'ok  ' : 'FALHA'} ${r.nome} (${r.vus} simultâneos): ${r.iteracoes} requisições (${r.rps}/s) · p50 ${r.p50} ms · p95 ${r.p95} ms · p99 ${r.p99} ms · erros ${r.erros.length}`
            );
            if (r.erros.length) console.log(`      primeiros erros: ${[...new Set(r.erros)].slice(0, 3).join(' | ')}`);
        }
    } finally {
        await limpar();
    }
    process.exit(falhas ? 1 : 0);
}

if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}

module.exports = { semear, limpar };
