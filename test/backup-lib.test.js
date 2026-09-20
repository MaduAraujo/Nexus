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
