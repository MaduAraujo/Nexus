const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let lib;
let backup;
let dir;
const gpgOk = spawnSync(process.env.GPG_BIN || 'gpg', ['--version'], { stdio: 'ignore' }).status === 0;

before(async () => {
    lib = await import('../scripts/backup/lib.mjs');
    backup = await import('../scripts/backup/backup-db.mjs');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-backup-test-'));
    fs.writeFileSync(path.join(dir, 'frase.txt'), 'frase-de-teste-com-mais-de-24-caracteres');
    fs.writeFileSync(path.join(dir, 'outra.txt'), 'outra-frase-de-teste-com-mais-de-24-caracteres');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const SEGREDO = 'CPF 904.111.222-33 de Fulana de Tal';
const produz = (texto) => ['node', ['-e', `process.stdout.write(${JSON.stringify(texto)})`]];

async function cifra(nome = 'backup.gpg') {
    const [dumpCommand, dumpArgs] = produz(SEGREDO);
    const outFile = path.join(dir, nome);
    const r = await lib.encryptedDump({ dumpCommand, dumpArgs, outFile, passphraseFile: path.join(dir, 'frase.txt') });
    return { outFile, ...r };
}

async function decifra(file, frase = 'frase.txt') {
    const { stream, done } = lib.decryptedStream({ file, passphraseFile: path.join(dir, frase) });
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    await done;
    return Buffer.concat(chunks).toString('utf8');
}

describe('Backup cifrado (scripts/backup)', () => {
    test('o pg_dump pede só o que interessa e deixa as chaves e as sessões de fora', () => {
        const args = backup.pgDumpArgs();
        assert.ok(args.includes('--format=custom'));
        assert.ok(args.includes('--no-owner'));
        for (const t of ['public.nexus_key_store', 'auth.refresh_tokens', 'auth.sessions', 'auth.audit_log_entries']) {
            assert.ok(args.includes(`--exclude-table-data=${t}`), t);
        }
    });

    test('recusa frase-secreta curta', () => {
        const curta = path.join(dir, 'curta.txt');
        fs.writeFileSync(curta, 'curta');
        assert.throws(() => lib.readSecretFile(curta), /24 caracteres/);
    });

    test('a frase-secreta nunca vai na linha de comando do gpg', () => {
        const args = lib.gpgEncryptArgs('/x/frase.txt', '/x/out.gpg');
        assert.ok(args.includes('--passphrase-file'));
        assert.ok(!args.includes('--passphrase'));
        assert.ok(args.includes('AES256'));
    });

    test('cifra, confere o formato e decifra de volta', { skip: !gpgOk && 'gpg não instalado' }, async () => {
        const { outFile, sha256 } = await cifra();
        const bytes = fs.readFileSync(outFile);
        assert.ok(!bytes.includes(Buffer.from('904.111.222-33')), 'o arquivo não pode conter o texto claro');
        assert.equal(await lib.sha256File(outFile), sha256);
        assert.match(fs.readFileSync(`${outFile}.sha256`, 'utf8'), new RegExp(`^${sha256}  backup.gpg`));

        const info = lib.describeEncryptedFile(outFile);
        assert.ok(info.symmetric && info.aes256 && info.integrityProtected, info.raw);
        assert.equal(await decifra(outFile), SEGREDO);
    });

    test('frase-secreta errada não decifra', { skip: !gpgOk && 'gpg não instalado' }, async () => {
        const { outFile } = await cifra('errada.gpg');
        await assert.rejects(decifra(outFile, 'outra.txt'), /gpg terminou com código/);
    });

    test('arquivo adulterado é detectado', { skip: !gpgOk && 'gpg não instalado' }, async () => {
        const { outFile } = await cifra('adulterado.gpg');
        const bytes = fs.readFileSync(outFile);
        bytes[bytes.length - 20] ^= 0xff;
        fs.writeFileSync(outFile, bytes);
        await assert.rejects(decifra(outFile), /gpg terminou com código/);
    });

    test('se o pg_dump falha, o backup falha (nada de arquivo "bom" pela metade)', { skip: !gpgOk && 'gpg não instalado' }, async () => {
        await assert.rejects(
            lib.encryptedDump({
                dumpCommand: 'node',
                dumpArgs: ['-e', 'process.stdout.write("parcial"); process.exit(3)'],
                outFile: path.join(dir, 'falha.gpg'),
                passphraseFile: path.join(dir, 'frase.txt'),
            }),
            /pg_dump terminou com código 3/
        );
        assert.ok(!fs.existsSync(path.join(dir, 'falha.gpg')), 'não pode sobrar arquivo parcial');
    });
});

describe('backup-db main()', () => {
    const env = () => ({ BACKUP_DB_URL: 'postgresql://u:senha@db/postgres', BACKUP_PASSPHRASE_FILE: path.join(dir, 'frase.txt') });

    test('sem URL ou sem frase-secreta: recusa antes de rodar qualquer coisa', async () => {
        await assert.rejects(backup.main([], {}), /BACKUP_DB_URL e BACKUP_PASSPHRASE_FILE/);
        await assert.rejects(backup.main([], { BACKUP_DB_URL: 'postgresql://x' }), /BACKUP_DB_URL e BACKUP_PASSPHRASE_FILE/);
    });

    test('arquivo de frase-secreta inexistente: recusa', async () => {
        await assert.rejects(backup.main([], { ...env(), BACKUP_PASSPHRASE_FILE: path.join(dir, 'nao-existe.txt') }), /frase-secreta não encontrado/);
    });

    test('frase-secreta curta: recusa antes de chamar o pg_dump', { skip: !gpgOk && 'gpg não instalado' }, async () => {
        const curta = path.join(dir, 'curta-main.txt');
        fs.writeFileSync(curta, 'curta');
        let chamou = false;
        await assert.rejects(backup.main([], { ...env(), BACKUP_PASSPHRASE_FILE: curta }, { dumpCommandFor: () => (chamou = true) }), /24 caracteres/);
        assert.equal(chamou, false);
    });

    test('gera o arquivo cifrado em --out com nome datado, e decifra de volta', { skip: !gpgOk && 'gpg não instalado' }, async (t) => {
        t.mock.method(console, 'log', () => {});
        const out = path.join(dir, 'saida-main');
        const [dumpCommand, dumpArgs] = produz(SEGREDO);
        let urlRecebida;
        const { outFile, sha256 } = await backup.main(['--out', out], env(), {
            dumpCommandFor: (url) => {
                urlRecebida = url;
                return { dumpCommand, dumpArgs, dumpEnv: {} };
            },
        });
        assert.equal(urlRecebida, 'postgresql://u:senha@db/postgres');
        assert.equal(path.dirname(outFile), out);
        assert.match(path.basename(outFile), /^nexus-db-\d{8}T\d{6}Z\.dump\.gpg$/);
        assert.equal(await lib.sha256File(outFile), sha256);
        assert.equal(await decifra(outFile), SEGREDO);
        assert.ok(!console.log.mock.calls.some((c) => String(c.arguments[0]).includes('senha')), 'a URL (com senha) não vai para o log');
    });

    test('stamp: carimbo UTC sem separadores nem milissegundos', () => {
        assert.equal(backup.stamp(new Date('2026-09-26T08:05:09.123Z')), '20260926T080509Z');
    });

    test('com pg_dump local usa ele direto; sem ele, cai no Docker sem pôr a URL na linha de comando', () => {
        const url = 'postgresql://u:senha@db/postgres';
        const local = backup.resolveDumpCommand(url, () => true);
        assert.equal(local.dumpCommand, 'pg_dump');
        assert.deepEqual(local.dumpArgs, [...backup.pgDumpArgs(), url]);

        const docker = backup.resolveDumpCommand(url, () => false);
        assert.equal(docker.dumpCommand, 'docker');
        assert.ok(!docker.dumpArgs.some((a) => a.includes('senha')), 'a senha não pode aparecer em ps/linha de comando');
        assert.ok(docker.dumpArgs.includes('BACKUP_DB_URL'));
        assert.deepEqual(docker.dumpEnv, { BACKUP_DB_URL: url });
        assert.match(docker.dumpArgs.at(-1), /--exclude-table-data=public\.nexus_key_store/);
    });
});
