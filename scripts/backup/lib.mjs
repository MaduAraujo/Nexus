import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export const GPG = process.env.GPG_BIN || 'gpg';

export function gpgEncryptArgs(passphraseFile, outFile) {
    return [
        '--batch',
        '--yes',
        '--pinentry-mode',
        'loopback',
        '--passphrase-file',
        passphraseFile,
        '--symmetric',
        '--cipher-algo',
        'AES256',
        '--s2k-mode',
        '3',
        '--s2k-digest-algo',
        'SHA512',
        '--s2k-count',
        '65011712',
        '--compress-algo',
        'none',
        '-o',
        outFile,
    ];
}

export function gpgDecryptArgs(passphraseFile, inFile) {
    return ['--batch', '--pinentry-mode', 'loopback', '--passphrase-file', passphraseFile, '--decrypt', inFile];
}

export function hasGpg() {
    return spawnSync(GPG, ['--version'], { stdio: 'ignore' }).status === 0;
}

function collect(stream) {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    return () => Buffer.concat(chunks).toString('utf8').trim();
}

function exited(child, label) {
    const stderr = collect(child.stderr);
    return new Promise((resolve, reject) => {
        child.on('error', (e) => reject(new Error(`${label}: ${e.message}`)));
        child.on('close', (code) => (code === 0 ? resolve(stderr()) : reject(new Error(`${label} terminou com código ${code}: ${stderr()}`))));
    });
}

export async function encryptedDump({ dumpCommand, dumpArgs, dumpEnv = {}, outFile, passphraseFile }) {
    const dump = spawn(dumpCommand, dumpArgs, { env: { ...process.env, ...dumpEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    const gpg = spawn(GPG, gpgEncryptArgs(passphraseFile, outFile), { stdio: ['pipe', 'ignore', 'pipe'] });
    const dumpDone = exited(dump, 'pg_dump');
    const gpgDone = exited(gpg, 'gpg');
    dumpDone.catch(() => gpg.kill());
    gpgDone.catch(() => dump.kill());
    dump.stdout.pipe(gpg.stdin);
    let dumpLog;
    try {
        [dumpLog] = await Promise.all([dumpDone, gpgDone]);
    } catch (e) {
        rmSync(outFile, { force: true });
        throw e;
    }
    const sha256 = await sha256File(outFile);
    writeFileSync(`${outFile}.sha256`, `${sha256}  ${outFile.split(/[\\/]/).pop()}\n`);
    return { sha256, dumpLog };
}

export async function sha256File(file) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(file), hash);
    return hash.digest('hex');
}

export function decryptedStream({ file, passphraseFile }) {
    const gpg = spawn(GPG, gpgDecryptArgs(passphraseFile, file), { stdio: ['ignore', 'pipe', 'pipe'] });
    return { stream: gpg.stdout, done: exited(gpg, 'gpg') };
}

export function describeEncryptedFile(file) {
    const out = spawnSync(GPG, ['--batch', '--list-packets', file], { encoding: 'utf8' });
    const text = `${out.stdout}\n${out.stderr}`;
    return {
        symmetric: /:symkey enc packet:/.test(text),
        aes256: /cipher 9\b/.test(text),
        integrityProtected: /mdc_method:\s*2|aead algo/i.test(text),
        raw: text.trim(),
    };
}

export function readSecretFile(file) {
    const secret = readFileSync(file, 'utf8').trim();
    if (secret.length < 24) throw new Error('A frase-secreta do backup precisa ter pelo menos 24 caracteres.');
    return secret;
}
