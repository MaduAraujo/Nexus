import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pgDumpArgs } from './backup-db.mjs';
import { decryptedStream, describeEncryptedFile, encryptedDump, hasGpg, sha256File } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.111';
const SRC = 'nexus-drill-src';
const DST = 'nexus-drill-dst';
const PGPASSWORD = 'postgres';
const KEEP = process.argv.includes('--keep');

const steps = [];
const t0 = Date.now();
let clock = Date.now();

function record(name, ok, detail = '') {
    const now = Date.now();
    steps.push({ name, ok, detail, seconds: +((now - clock) / 1000).toFixed(1) });
    clock = now;
    console.log(`${ok ? 'OK   ' : 'FALHA'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) throw new Error(`Falhou: ${name}${detail ? ` (${detail})` : ''}`);
}

function docker(args, { input, allowFail = false } = {}) {
    const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0 && !allowFail) throw new Error(`docker ${args.slice(0, 3).join(' ')} falhou: ${r.stderr || r.stdout}`);
    return r;
}

function startDb(name) {
    docker(['rm', '-f', name], { allowFail: true });
    docker(['run', '-d', '--name', name, '-e', `POSTGRES_PASSWORD=${PGPASSWORD}`, '-p', '127.0.0.1::5432', IMAGE]);
    const mapping = docker(['port', name, '5432/tcp']).stdout.trim().split('\n')[0];
    return Number(mapping.split(':').pop());
}

async function waitReady(port) {
    let stable = 0;
    for (let i = 0; i < 90 && stable < 3; i++) {
        const c = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: PGPASSWORD, database: 'postgres' });
        try {
            await c.connect();
            const { rows } = await c.query(
                "SELECT to_regclass('auth.users') IS NOT NULL AS auth, (SELECT count(*) FROM pg_roles WHERE rolname = 'authenticated') AS roles"
            );
            stable = rows[0].auth && Number(rows[0].roles) === 1 ? stable + 1 : 0;
        } catch {
            stable = 0;
        } finally {
            await c.end().catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    if (stable < 3) throw new Error('O Postgres do container não ficou pronto.');
}

const conn = (port) => new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: PGPASSWORD, database: 'postgres' });

async function query(port, sql, params) {
    const c = conn(port);
    await c.connect();
    try {
        return await c.query(sql, params);
    } finally {
        await c.end();
    }
}

async function asUser(port, sub, fn) {
    const c = conn(port);
    await c.connect();
    try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE authenticated');
        await c.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub]);
        await c.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
        await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub, role: 'authenticated', aal: 'aal2' })]);
        return await fn(c);
    } finally {
        await c.query('ROLLBACK').catch(() => {});
        await c.end();
    }
}

function psqlSql(container, sql, user = 'postgres') {
    const r = docker(
        ['exec', '-i', '-e', `PGPASSWORD=${PGPASSWORD}`, container, 'psql', '-h', '127.0.0.1', '-U', user, '-d', 'postgres', '-q', '-v', 'ON_ERROR_STOP=0'],
        { input: sql, allowFail: true }
    );
    return { errors: (r.stderr.match(/ERROR:/g) ?? []).length, stderr: r.stderr };
}

const psqlFile = (container, file) => psqlSql(container, readFileSync(file, 'utf8')).errors;

const AUTH_STUBS = `
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
`;

const ids = {
    u: ['00000000-0000-4000-8000-0000000d0001', '00000000-0000-4000-8000-0000000d0002', '00000000-0000-4000-8000-0000000d0003'],
    e: ['00000000-0000-4000-9000-0000000d0001', '00000000-0000-4000-9000-0000000d0002', '00000000-0000-4000-9000-0000000d0003'],
};
const SENTINELAS = ['Sentinela Silva Ferreira', '904.111.222-33', 'sentinela.rh@exemplo.test', 'o gestor humilha a equipe'];

async function seed(port) {
    const c = conn(port);
    await c.connect();
    try {
        for (const id of ids.u) await c.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
        await c.query(
            `INSERT INTO employees (id, name, cpf, email, dept, salary, status, birth_date, telefone) VALUES
               ($1, $4, $5, $6, 'RH', 9000, 'Ativo', '1990-05-17', '11 90000-0001'),
               ($2, 'Colaboradora Um', '904.111.222-44', 'um@exemplo.test', 'TI', 5000, 'Ativo', '1994-01-02', '11 90000-0002'),
               ($3, 'Colaborador Dois', '904.111.222-55', 'dois@exemplo.test', 'TI', 4000, 'Ativo', '1988-11-30', '11 90000-0003')`,
            [ids.e[0], ids.e[1], ids.e[2], SENTINELAS[0], SENTINELAS[1], SENTINELAS[2]]
        );
        await c.query(`INSERT INTO profiles (id, profile, employee_id) VALUES ($1, 'Administrador', $2), ($3, 'colaborador', $4), ($5, 'colaborador', $6)`, [
            ids.u[0],
            ids.e[0],
            ids.u[1],
            ids.e[1],
            ids.u[2],
            ids.e[2],
        ]);
        await c.query(
            `INSERT INTO payslips (employee_id, mes, proventos, descontos, total_proventos, total_descontos, salario_liquido, status) VALUES
               ($1, '2026-08', '[{"descricao":"Salário base","valor":5000}]', '[{"descricao":"INSS","valor":550}]', 5000, 550, 4450.5, 'pago'),
               ($2, '2026-08', '[{"descricao":"Salário base","valor":4000}]', '[{"descricao":"INSS","valor":440}]', 4000, 440, 3560, 'pago')`,
            [ids.e[1], ids.e[2]]
        );
        await c.query("INSERT INTO anonymous_feedback (categoria, message) VALUES ('gestao', $1)", [SENTINELAS[3]]);
        await c.query("INSERT INTO ai_chat_history (role, content) VALUES ('user', 'quem está em risco de burnout?')");
        await c.query(
            `INSERT INTO time_records (employee_id, date, entrada, saida) VALUES ($1, '2026-09-01', '2026-09-01T11:00:00Z', '2026-09-01T20:00:00Z')`,
            [ids.e[1]]
        );
    } finally {
        await c.end();
    }
}

async function tables(port) {
    const { rows } = await query(
        port,
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"
    );
    const counts = {};
    for (const { table_name: t } of rows) {
        if (t === 'nexus_key_store') continue;
        counts[t] = Number((await query(port, `SELECT count(*)::int AS n FROM public."${t}"`)).rows[0].n);
    }
    return counts;
}

async function catalog(port) {
    const { rows } = await query(
        port,
        `SELECT
           (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')::int AS policies,
           (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal)::int AS triggers,
           (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')::int AS functions,
           (SELECT count(*) FROM pg_views WHERE schemaname = 'public')::int AS views,
           (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity)::int AS tables_with_rls`
    );
    return rows[0];
}

async function rawCiphertext(port) {
    const { rows } = await query(
        port,
        `SELECT
           (SELECT md5(string_agg(cpf || coalesce(birth_date, '') || coalesce(salary::text, ''), ',' ORDER BY id)) FROM employees) AS employees,
           (SELECT md5(string_agg(salario_liquido || proventos, ',' ORDER BY employee_id)) FROM payslips) AS payslips,
           (SELECT md5(string_agg(message, ',' ORDER BY id)) FROM anonymous_feedback) AS feedback,
           (SELECT md5(string_agg(content, ',' ORDER BY id)) FROM ai_chat_history) AS ai_chat`
    );
    return rows[0];
}

async function readAsRh(port) {
    return asUser(port, ids.u[0], async (c) => {
        const q = async (sql) => (await c.query(sql)).rows;
        return {
            employees: await q('SELECT id, name, cpf, email, birth_date::text AS birth_date, telefone FROM employees_decrypted ORDER BY id'),
            payslips: await q('SELECT employee_id, mes, proventos, descontos, salario_liquido::text AS liquido FROM payslips_decrypted ORDER BY employee_id'),
            feedback: await q('SELECT message FROM anonymous_feedback_decrypted ORDER BY message'),
            aiChat: await q('SELECT content FROM ai_chat_history_decrypted ORDER BY content'),
        };
    });
}

function cleanup() {
    if (KEEP) return;
    docker(['rm', '-f', SRC, DST], { allowFail: true });
}

async function main() {
    if (!hasGpg()) throw new Error('gpg não encontrado (defina GPG_BIN).');
    if (docker(['version', '--format', '{{.Server.Version}}'], { allowFail: true }).status !== 0) throw new Error('O daemon do Docker não está rodando.');

    const work = mkdtempSync(join(tmpdir(), 'nexus-drill-'));
    const passphraseFile = join(work, 'frase-backup.txt');
    const outFile = join(work, 'nexus-db-drill.dump.gpg');
    writeFileSync(passphraseFile, randomBytes(32).toString('base64'));
    const chaves = {};
    const report = { imagem: IMAGE, inicio: new Date().toISOString() };

    try {
        const srcPort = startDb(SRC);
        await waitReady(srcPort);
        record('Postgres de origem no ar', true, `porta ${srcPort}`);
        const stubs = psqlSql(SRC, AUTH_STUBS, 'supabase_admin');
        if (stubs.errors) throw new Error(`Não consegui criar auth.jwt()/auth.uid(): ${stubs.stderr}`);
        const erros = psqlFile(SRC, join(ROOT, 'supabase/schema.sql'));
        psqlFile(SRC, join(ROOT, 'test-support/local-test-db-grants.sql'));
        record('schema.sql carregado', erros < 60, `${erros} avisos de erro esperados (storage.* não existe neste ambiente)`);
        for (const name of ['data_encryption_key', 'data_hmac_key']) chaves[name] = (await query(srcPort, 'SELECT nexus_secret($1) AS s', [name])).rows[0].s;
        const noVault = (await query(srcPort, "SELECT to_regclass('vault.decrypted_secrets') IS NOT NULL AS v")).rows[0].v;
        record(
            'Chaves de cifragem copiadas da origem (a "cópia offline")',
            Object.values(chaves).every((v) => v && v.length >= 32),
            noVault ? 'estavam no Vault do banco' : 'estavam em nexus_key_store'
        );
        await seed(srcPort);
        const antes = await readAsRh(srcPort);
        record(
            'Dados sintéticos gravados e legíveis pelo RH',
            antes.employees.length === 3 && antes.employees[0].cpf.includes('.'),
            `${antes.employees.length} colaboradores`
        );
        const contagemAntes = await tables(srcPort);
        const catalogoAntes = await catalog(srcPort);
        const cifraAntes = await rawCiphertext(srcPort);
        report.tabelas = Object.keys(contagemAntes).length;

        const dumpArgs = ['exec', '-e', `PGPASSWORD=${PGPASSWORD}`, SRC, 'pg_dump', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', ...pgDumpArgs()];
        const { sha256 } = await encryptedDump({ dumpCommand: 'docker', dumpArgs, outFile, passphraseFile });
        const bytes = readFileSync(outFile);
        record('Backup cifrado gerado', bytes.length > 10_000, `${bytes.length} bytes, sha256 ${sha256.slice(0, 16)}…`);
        report.backup = { bytes: bytes.length, sha256 };

        const info = describeEncryptedFile(outFile);
        record(
            'Arquivo é gpg simétrico AES-256 com proteção de integridade',
            info.symmetric && info.aes256 && info.integrityProtected,
            `simétrico=${info.symmetric} aes256=${info.aes256} integridade=${info.integrityProtected}`
        );
        const legivel = SENTINELAS.filter((s) => bytes.includes(Buffer.from(s)));
        record(
            'Nenhum dado pessoal legível dentro do arquivo',
            legivel.length === 0 && !bytes.subarray(0, 5).equals(Buffer.from('PGDMP')),
            `${SENTINELAS.length} textos sentinela procurados, ${legivel.length} achados`
        );

        const textoPuro = pgDumpArgs()
            .map((a) => (a === '--format=custom' ? '--format=plain' : a))
            .join(' ');
        const plainCheck = docker(
            [
                'exec',
                '-e',
                `PGPASSWORD=${PGPASSWORD}`,
                SRC,
                'sh',
                '-c',
                `pg_dump -h 127.0.0.1 -U postgres -d postgres ${textoPuro} | grep -c "${SENTINELAS[0]}"`,
            ],
            { allowFail: true }
        );
        record(
            'Controle positivo: o mesmo conteúdo em texto puro deixa o nome legível',
            Number(plainCheck.stdout.trim()) > 0,
            'prova que a busca acima consegue enxergar o texto se ele estivesse lá'
        );

        const dumpSemChaves = docker(
            [
                'exec',
                '-e',
                `PGPASSWORD=${PGPASSWORD}`,
                SRC,
                'sh',
                '-c',
                `pg_dump -h 127.0.0.1 -U postgres -d postgres ${textoPuro} | grep -c "${chaves.data_encryption_key}"`,
            ],
            { allowFail: true }
        );
        record(
            'Chave de cifragem de colunas não vai dentro do backup',
            Number(dumpSemChaves.stdout.trim() || 0) === 0,
            'procurada no dump em texto puro, onde ela apareceria se estivesse no banco'
        );

        const wrong = join(work, 'errada.txt');
        writeFileSync(wrong, randomBytes(32).toString('base64'));
        const errada = decryptedStream({ file: outFile, passphraseFile: wrong });
        errada.stream.resume();
        const recusou = await errada.done.then(
            () => false,
            () => true
        );
        record('Frase-secreta errada é recusada', recusou);

        const adulterado = join(work, 'adulterado.dump.gpg');
        const copia = Buffer.from(bytes);
        copia[Math.floor(copia.length / 2)] ^= 0xff;
        writeFileSync(adulterado, copia);
        const tamper = decryptedStream({ file: adulterado, passphraseFile });
        tamper.stream.resume();
        const detectou = await tamper.done.then(
            () => false,
            () => true
        );
        record('Arquivo adulterado é detectado (integridade)', detectou);
        record('SHA-256 registrado confere com o arquivo', (await sha256File(outFile)) === sha256);

        docker(['rm', '-f', SRC]);
        record('Banco de origem destruído (simula a perda do projeto)', true);

        const restoreStart = Date.now();
        const dstPort = startDb(DST);
        await waitReady(dstPort);
        psqlSql(DST, AUTH_STUBS, 'supabase_admin');
        record('Banco novo no ar (equivale a um projeto Supabase recém-criado)', true, `porta ${dstPort}`);

        const restore = async (extra, user = 'postgres') => {
            const { stream, done } = decryptedStream({ file: outFile, passphraseFile });
            const pgRestore = spawn(
                'docker',
                [
                    'exec',
                    '-i',
                    '-e',
                    `PGPASSWORD=${PGPASSWORD}`,
                    DST,
                    'pg_restore',
                    '-h',
                    '127.0.0.1',
                    '-U',
                    user,
                    '-d',
                    'postgres',
                    '--no-owner',
                    '--no-privileges',
                    ...extra,
                ],
                {
                    stdio: ['pipe', 'pipe', 'pipe'],
                }
            );
            stream.pipe(pgRestore.stdin);
            const err = [];
            pgRestore.stderr.on('data', (d) => err.push(d));
            pgRestore.stdout.resume();
            await done;
            await new Promise((resolve) => pgRestore.on('close', resolve));
            return Buffer.concat(err).toString('utf8');
        };

        const erroAuth = await restore(['--schema=auth', '--data-only', '--disable-triggers'], 'supabase_admin');
        const erroPublic = await restore(['--schema=public']);
        const errosRestore = [...(erroAuth + erroPublic).split('\n')].filter((l) => /error/i.test(l));
        report.errosRestore = errosRestore.slice(0, 20);
        record('pg_restore executado a partir do arquivo decifrado em fluxo', true, `${errosRestore.length} linhas de erro/aviso`);

        const contagemDepois = await tables(dstPort);
        const diff = Object.keys(contagemAntes).filter((t) => contagemAntes[t] !== contagemDepois[t]);
        record(
            'Contagem de linhas idêntica em todas as tabelas',
            diff.length === 0 && Object.keys(contagemDepois).length === Object.keys(contagemAntes).length,
            `${Object.keys(contagemAntes).length} tabelas${diff.length ? `; divergem: ${diff.join(', ')}` : ''}`
        );
        const catalogoDepois = await catalog(dstPort);
        record(
            'Políticas RLS, gatilhos, funções e views restaurados',
            JSON.stringify(catalogoAntes) === JSON.stringify(catalogoDepois),
            JSON.stringify(catalogoDepois)
        );
        record('Dados cifrados voltaram byte a byte iguais', JSON.stringify(cifraAntes) === JSON.stringify(await rawCiphertext(dstPort)));

        const semChaves = await readAsRh(dstPort).catch((e) => ({ erro: e.message }));
        const todosNulos = semChaves.employees && semChaves.employees.every((e) => e.cpf === null) && semChaves.payslips.every((p) => p.liquido === null);
        record(
            'SEM as chaves: o banco restaurado abre, mas os campos cifrados vêm vazios (NULL)',
            !!todosNulos,
            'é exatamente o que acontece se restaurar sem recolocar as chaves do Vault'
        );
        report.semChaves = 'CPF, holerites, feedback e histórico da IA voltam NULL';

        const vaultDestino = (await query(dstPort, "SELECT to_regclass('vault.decrypted_secrets') IS NOT NULL AS v")).rows[0].v;
        for (const [name, secret] of Object.entries(chaves)) {
            if (vaultDestino) await query(dstPort, 'SELECT vault.create_secret($1, $2)', [secret, name]);
            else
                await query(dstPort, 'INSERT INTO nexus_key_store (name, secret) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret', [
                    name,
                    secret,
                ]);
        }
        report.chavesRecolocadasVia = vaultDestino ? 'vault.create_secret' : 'nexus_key_store';
        const depois = await readAsRh(dstPort);
        const divergentes = Object.keys(antes).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
        const amostra = divergentes.length
            ? ` | divergem: ${divergentes.join(', ')} | antes=${JSON.stringify(antes[divergentes[0]]).slice(0, 300)} | depois=${JSON.stringify(depois[divergentes[0]]).slice(0, 300)}`
            : '';
        record(
            'COM as chaves recolocadas: tudo legível e idêntico ao original',
            divergentes.length === 0,
            `${depois.employees.length} colaboradores, ${depois.payslips.length} holerites${amostra}`
        );

        const proprio = await asUser(dstPort, ids.u[1], async (c) => (await c.query('SELECT id FROM employees_decrypted')).rows.length);
        const salarios = await asUser(dstPort, ids.u[1], async (c) => (await c.query('SELECT employee_id FROM payslips_decrypted')).rows.length);
        record('RLS continua valendo após a restauração (colaborador vê só o que é dele)', proprio >= 1 && salarios === 1, `vê ${salarios} holerite(s)`);

        const busca = await query(dstPort, 'SELECT count(*)::int AS n FROM employees WHERE cpf_hash = nexus_blind_index($1)', [SENTINELAS[1]]);
        record('Índice cego do CPF funciona (chave HMAC restaurada)', busca.rows[0].n === 1);

        report.restauracaoSegundos = +((Date.now() - restoreStart) / 1000).toFixed(1);
        report.comparacao = { contagemDepois, catalogoDepois };
        report.concluido = true;
    } finally {
        report.fim = new Date().toISOString();
        report.totalSegundos = +((Date.now() - t0) / 1000).toFixed(1);
        report.passos = steps;
        cleanup();
        rmSync(work, { recursive: true, force: true });
        writeReport(report);
    }
}

function writeReport(report) {
    const day = report.inicio.slice(0, 10);
    const dir = join(ROOT, 'test-results/restore-drill');
    mkdirSync(dir, { recursive: true });
    const failed = !report.concluido || steps.some((s) => !s.ok);
    const lines = [
        `# Exercício de restauração — ${day}`,
        '',
        `Resultado: **${failed ? 'FALHOU' : 'APROVADO'}** (${steps.filter((s) => s.ok).length}/${steps.length} verificações concluídas${report.concluido ? '' : '; o exercício parou antes do fim'})`,
        '',
        `- Ambiente: containers Docker descartáveis, imagem \`${report.imagem}\` (a mesma do job rls-integration do CI)`,
        `- Dados: sintéticos, gerados pelo próprio exercício (nenhum dado real)`,
        `- Duração total: ${report.totalSegundos} s${report.restauracaoSegundos ? `; do banco novo ao banco verificado: ${report.restauracaoSegundos} s` : ''}`,
        report.backup ? `- Arquivo de backup: ${report.backup.bytes} bytes, SHA-256 \`${report.backup.sha256}\`` : '',
        '',
        '| # | Verificação | Resultado | Detalhe | s |',
        '|---|---|---|---|---|',
        ...steps.map((s, i) => `| ${i + 1} | ${s.name} | ${s.ok ? 'OK' : 'FALHA'} | ${s.detail.replace(/\|/g, '/')} | ${s.seconds} |`),
        '',
        '## O que este exercício prova e o que não prova',
        '',
        '- Prova: o procedimento (`backup-db.mjs` → arquivo AES-256 → `pg_restore` num banco novo) funciona, o arquivo não contém dado legível nem as chaves de cifragem, adulteração e frase errada são recusadas, e a restauração recompõe tabelas, RLS, gatilhos e dados cifrados.',
        '- Prova: sem recolocar as chaves do Vault, os campos cifrados voltam **NULL sem erro** — o sintoma silencioso a reconhecer numa restauração real.',
        '- **Não prova** que os backups automáticos do Supabase estão cifrados nem que a restauração pelo painel funciona: isso é feito pelo provedor e precisa ser conferido no projeto real.',
        '- Não cobre Storage (arquivos), Edge Functions e segredos da Groq/VAPID: o banco não os contém.',
        '',
        report.errosRestore?.length
            ? `## Mensagens do pg_restore (primeiras ${report.errosRestore.length})\n\n\`\`\`\n${report.errosRestore.join('\n')}\n\`\`\`\n`
            : '',
    ];
    writeFileSync(join(dir, `restore-drill-${day}.md`), lines.filter((l) => l !== undefined).join('\n'));
    writeFileSync(join(dir, `restore-drill-${day}.json`), JSON.stringify(report, null, 2));
    console.log(`\nRelatório: test-results/restore-drill/restore-drill-${day}.md`);
}

main().catch((e) => {
    console.error(`\n${e.message}`);
    process.exitCode = 1;
});