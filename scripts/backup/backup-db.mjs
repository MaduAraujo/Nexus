import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encryptedDump, hasGpg, readSecretFile } from './lib.mjs';

export const EXCLUDED_DATA = [
    'public.nexus_key_store',
    'auth.refresh_tokens',
    'auth.sessions',
    'auth.flow_state',
    'auth.one_time_tokens',
    'auth.mfa_challenges',
    'auth.audit_log_entries',
    'auth.schema_migrations',
];

export function pgDumpArgs() {
    return ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', '--schema=auth', ...EXCLUDED_DATA.map((t) => `--exclude-table-data=${t}`)];
}

function stamp(now = new Date()) {
    return now
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z');
}

function resolveDumpCommand(url) {
    const local = spawnSync('pg_dump', ['--version'], { stdio: 'ignore' });
    if (local.status === 0) return { dumpCommand: 'pg_dump', dumpArgs: [...pgDumpArgs(), url], dumpEnv: {} };
    return {
        dumpCommand: 'docker',
        dumpArgs: ['run', '--rm', '-e', 'BACKUP_DB_URL', 'postgres:17-alpine', 'sh', '-c', `pg_dump ${pgDumpArgs().join(' ')} "$BACKUP_DB_URL"`],
        dumpEnv: { BACKUP_DB_URL: url },
    };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
    const url = env.BACKUP_DB_URL;
    const passphraseFile = env.BACKUP_PASSPHRASE_FILE;
    if (!url || !passphraseFile) throw new Error('Defina BACKUP_DB_URL e BACKUP_PASSPHRASE_FILE.');
    if (!existsSync(passphraseFile)) throw new Error(`Arquivo de frase-secreta não encontrado: ${passphraseFile}`);
    if (!hasGpg()) throw new Error('gpg não encontrado (instale o GnuPG ou defina GPG_BIN).');
    readSecretFile(passphraseFile);

    const outIdx = argv.indexOf('--out');
    const outDir = resolve(outIdx >= 0 ? argv[outIdx + 1] : 'backups');
    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, `nexus-db-${stamp()}.dump.gpg`);

    const cmd = resolveDumpCommand(url);
    const { sha256 } = await encryptedDump({ ...cmd, outFile, passphraseFile });
    console.log(`Backup cifrado: ${outFile}\nSHA-256: ${sha256}`);
    return { outFile, sha256 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((e) => {
        console.error(`Falha no backup: ${e.message}`);
        process.exit(1);
    });
}