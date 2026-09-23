import { pathToFileURL } from 'node:url';
import { decryptFile, encryptFile, fileKeyId, isEncrypted, keyringFromEnv } from '../supabase/functions/_shared/file-crypto.mjs';
import { BUCKETS } from '../supabase/functions/_shared/files-core.mjs';
import { walk } from './encrypt-existing-files.mjs';

export async function rotateFileKey({ client, ring, buckets = Object.keys(BUCKETS), dryRun = false, log = console.log }) {
    const totals = { rotated: 0, current: 0, plaintext: 0, failed: 0 };

    for (const bucket of buckets) {
        log(`\n== ${bucket}`);
        for await (const file of walk(client.storage, bucket)) {
            try {
                const { data, error } = await client.storage.from(bucket).download(file.path);
                if (error || !data) throw new Error(error?.message || 'download vazio');
                const stored = new Uint8Array(await data.arrayBuffer());

                if (!isEncrypted(stored)) {
                    log(`   em claro (rode encrypt-existing-files.mjs antes): ${file.path}`);
                    totals.plaintext++;
                    continue;
                }
                const kid = fileKeyId(stored);
                if (kid === ring.active) {
                    totals.current++;
                    continue;
                }
                if (dryRun) {
                    log(`   (simulação) recifraria ${file.path} (${kid} -> ${ring.active})`);
                    totals.rotated++;
                    continue;
                }

                const opened = await decryptFile(ring, { bucket, path: file.path, bytes: stored });
                const sealed = await encryptFile(ring, { bucket, path: file.path, mime: opened.mime, bytes: opened.bytes });
                const { error: uploadError } = await client.storage
                    .from(bucket)
                    .upload(file.path, sealed, { contentType: 'application/octet-stream', upsert: true });
                if (uploadError) throw new Error(uploadError.message);

                const check = await client.storage.from(bucket).download(file.path);
                if (check.error || !check.data) throw new Error('não foi possível reler o arquivo gravado');
                const written = new Uint8Array(await check.data.arrayBuffer());
                const reopened = await decryptFile(ring, { bucket, path: file.path, bytes: written });
                if (
                    fileKeyId(written) !== ring.active ||
                    reopened.mime !== opened.mime ||
                    reopened.bytes.length !== opened.bytes.length ||
                    reopened.bytes.some((b, i) => b !== opened.bytes[i])
                ) {
                    throw new Error('conferência falhou: o arquivo relido não bate com o original');
                }

                log(`   recifrado ${file.path} (${kid} -> ${ring.active})`);
                totals.rotated++;
            } catch (e) {
                log(`   FALHOU ${file.path}: ${e.message}`);
                totals.failed++;
            }
        }
    }

    log(
        `\n${dryRun ? 'Simulação: ' : ''}${totals.rotated} ${dryRun ? 'seriam recifrados' : 'recifrados'} com a chave ${ring.active}, ` +
            `${totals.current} já estavam nela, ${totals.plaintext} em claro, ${totals.failed} falhas.`
    );
    if (!dryRun && !totals.failed && !totals.plaintext) log('Nenhum arquivo depende mais das chaves antigas: elas já podem sair de FILES_ENCRYPTION_OLD_KEYS.');
    return totals;
}

async function main() {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error(
            'Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FILES_ENCRYPTION_KEY, FILES_ENCRYPTION_KEY_ID e FILES_ENCRYPTION_OLD_KEYS (veja o README).'
        );
        process.exit(2);
    }
    let ring;
    try {
        ring = keyringFromEnv((name) => process.env[name]);
    } catch (e) {
        console.error(e.message);
        process.exit(2);
    }
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const totals = await rotateFileKey({ client, ring, dryRun: process.argv.includes('--dry-run') });
    process.exit(totals.failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
