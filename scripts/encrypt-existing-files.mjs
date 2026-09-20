import { pathToFileURL } from 'node:url';
import { decryptFile, encryptFile, isEncrypted } from '../supabase/functions/_shared/file-crypto.mjs';
import { BUCKETS, INLINE_TYPES, matchesSignature, safeMime } from '../supabase/functions/_shared/files-core.mjs';

const PAGE = 100;

async function* walk(storage, bucket, prefix = '') {
    let offset = 0;
    for (;;) {
        const { data, error } = await storage.from(bucket).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
        if (error) throw new Error(`Não foi possível listar ${bucket}/${prefix}: ${error.message}`);
        if (!data || data.length === 0) return;
        for (const entry of data) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.id === null || entry.id === undefined) yield* walk(storage, bucket, path);
            else yield { path, mime: entry.metadata?.mimetype };
        }
        if (data.length < PAGE) return;
        offset += PAGE;
    }
}

export async function encryptExistingFiles({ client, key, buckets = Object.keys(BUCKETS), dryRun = false, log = console.log }) {
    const totals = { encrypted: 0, skipped: 0, failed: 0 };

    for (const bucket of buckets) {
        log(`\n== ${bucket}`);
        for await (const file of walk(client.storage, bucket)) {
            try {
                const { data, error } = await client.storage.from(bucket).download(file.path);
                if (error || !data) throw new Error(error?.message || 'download vazio');
                const original = new Uint8Array(await data.arrayBuffer());

                if (isEncrypted(original)) {
                    totals.skipped++;
                    continue;
                }
                if (dryRun) {
                    log(`   (simulação) cifraria ${file.path}`);
                    totals.encrypted++;
                    continue;
                }

                let mime = safeMime(file.mime || data.type);
                if (INLINE_TYPES.includes(mime) && !matchesSignature(mime, original)) mime = 'application/octet-stream';

                const sealed = await encryptFile(key, { bucket, path: file.path, mime, bytes: original });
                const { error: uploadError } = await client.storage.from(bucket).upload(file.path, sealed, { contentType: 'application/octet-stream', upsert: true });
                if (uploadError) throw new Error(uploadError.message);

                const check = await client.storage.from(bucket).download(file.path);
                if (check.error || !check.data) throw new Error('não foi possível reler o arquivo gravado');
                const reopened = await decryptFile(key, { bucket, path: file.path, bytes: new Uint8Array(await check.data.arrayBuffer()) });
                if (reopened.bytes.length !== original.length || reopened.bytes.some((b, i) => b !== original[i])) {
                    throw new Error('conferência falhou: o conteúdo relido é diferente do original');
                }

                log(`   cifrado ${file.path}`);
                totals.encrypted++;
            } catch (e) {
                log(`   FALHOU ${file.path}: ${e.message}`);
                totals.failed++;
            }
        }
    }

    log(`\n${dryRun ? 'Simulação: ' : ''}${totals.encrypted} ${dryRun ? 'seriam cifrados' : 'cifrados'}, ${totals.skipped} já estavam cifrados, ${totals.failed} falhas.`);
    return totals;
}

async function main() {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FILES_ENCRYPTION_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !FILES_ENCRYPTION_KEY) {
        console.error('Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e FILES_ENCRYPTION_KEY (veja o cabeçalho deste arquivo).');
        process.exit(2);
    }
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const totals = await encryptExistingFiles({ client, key: FILES_ENCRYPTION_KEY, dryRun: process.argv.includes('--dry-run') });
    process.exit(totals.failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();