window.NexusFiles = (function () {
    const FUNCTION_PATH = '/functions/v1/nexus-files';
    const FALLBACK_TYPE = 'application/octet-stream';
    const INLINE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const REVOKE_AFTER_MS = 5 * 60 * 1000;
    const E2E_BUCKETS = ['documents', 'ponto-selfies'];
    const SIGNATURES = {
        'application/pdf': [0x25, 0x50, 0x44, 0x46],
        'image/jpeg': [0xff, 0xd8, 0xff],
        'image/png': [0x89, 0x50, 0x4e, 0x47],
        'image/gif': [0x47, 0x49, 0x46, 0x38],
        'image/webp': [0x52, 0x49, 0x46, 0x46],
    };

    function inlineType(contentType) {
        const type = String(contentType || '')
            .split(';')[0]
            .trim()
            .toLowerCase();
        return INLINE_TYPES.includes(type) ? type : FALLBACK_TYPE;
    }

    async function authHeaders(extra) {
        const {
            data: { session },
        } = await sb.auth.getSession();
        if (!session?.access_token) return null;
        return { Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_ANON_KEY, ...extra };
    }

    async function failure(response) {
        let message = 'Não foi possível concluir a operação com o arquivo.';
        try {
            message = (await response.json()).error || message;
        } catch {}
        return { message, status: response.status };
    }

    const SESSION_ERROR = { message: 'Sessão expirada. Entre novamente.', status: 401 };
    const NETWORK_ERROR = { message: 'Erro de conexão. Verifique sua internet e tente novamente.', status: 0 };

    async function authedFetch(url, init, extraHeaders) {
        const headers = await authHeaders(extraHeaders);
        if (!headers) return { session: false };
        const response = await fetch(url, { ...init, headers });
        if (response.status !== 401) return { response };

        const { data } = await sb.auth.refreshSession();
        const token = data?.session?.access_token;
        if (!token) return { session: false };
        return { response: await fetch(url, { ...init, headers: { ...headers, Authorization: `Bearer ${token}` } }) };
    }

    const e2eEnabled = (bucket) => E2E_BUCKETS.includes(bucket) && typeof window.NexusE2E !== 'undefined';

    function safeInlineType(mime, bytes) {
        const type = inlineType(mime);
        const signature = SIGNATURES[type];
        return signature && signature.every((b, i) => bytes[i] === b) ? type : FALLBACK_TYPE;
    }

    async function uploadEndToEnd(bucket, path, file, { contentType, upsert, employeeId }) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sealed = await window.NexusE2E.encryptFile(bytes, { bucket, path, mime: contentType || file.type || FALLBACK_TYPE, employeeId });
        if (!sealed) return null;
        const { error } = await sb.storage
            .from(bucket)
            .upload(path, new Blob([sealed], { type: FALLBACK_TYPE }), { contentType: FALLBACK_TYPE, upsert: Boolean(upsert) });
        if (!error) return { error: null };
        const tooLarge = /too large|payload|exceeded/i.test(error.message || '');
        return { error: { message: tooLarge ? 'Arquivo grande demais' : 'Não foi possível gravar o arquivo', status: tooLarge ? 413 : 400 } };
    }

    async function upload(bucket, path, file, { contentType, upsert = false, employeeId } = {}) {
        try {
            if (e2eEnabled(bucket) && employeeId) {
                const result = await uploadEndToEnd(bucket, path, file, { contentType, upsert, employeeId });
                if (result) return result;
            }
            const { response, session } = await authedFetch(
                `${SUPABASE_URL}${FUNCTION_PATH}`,
                { method: 'POST', body: file },
                {
                    'content-type': FALLBACK_TYPE,
                    'x-nexus-bucket': bucket,
                    'x-nexus-path': encodeURIComponent(path),
                    'x-nexus-mime': contentType || file.type || FALLBACK_TYPE,
                    'x-nexus-upsert': String(Boolean(upsert)),
                }
            );
            if (session === false) return { error: SESSION_ERROR };
            if (!response.ok) return { error: await failure(response) };
            return { error: null };
        } catch {
            return { error: NETWORK_ERROR };
        }
    }

    async function downloadEndToEnd(bucket, path) {
        const { data, error } = await sb.storage.from(bucket).download(path);
        if (error || !data) return null;
        const stored = new Uint8Array(await data.arrayBuffer());
        if (!window.NexusE2E.isEncryptedFile(stored)) return null;
        try {
            const opened = await window.NexusE2E.decryptFile(stored, { bucket, path });
            Promise.resolve(sb.rpc('report_file_download', { p_bucket: bucket })).catch(() => {});
            return { blob: new Blob([opened.bytes], { type: safeInlineType(opened.mime, opened.bytes) }), error: null };
        } catch {
            return { blob: null, error: { message: 'Este arquivo é cifrado de ponta a ponta e não abre com as chaves deste acesso.', status: 403 } };
        }
    }

    async function download(bucket, path) {
        try {
            if (e2eEnabled(bucket)) {
                const result = await downloadEndToEnd(bucket, path);
                if (result) return result;
            }
            return await legacyDownload(bucket, path);
        } catch {
            return { blob: null, error: NETWORK_ERROR };
        }
    }

    async function legacyDownload(bucket, path) {
        try {
            const url = `${SUPABASE_URL}${FUNCTION_PATH}?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
            const { response, session } = await authedFetch(url, {});
            if (session === false) return { blob: null, error: SESSION_ERROR };
            if (!response.ok) return { blob: null, error: await failure(response) };
            const blob = new Blob([await response.arrayBuffer()], { type: inlineType(response.headers.get('content-type')) });
            return { blob, error: null };
        } catch {
            return { blob: null, error: NETWORK_ERROR };
        }
    }

    async function migrateToEndToEnd(bucket, path, employeeId) {
        if (!e2eEnabled(bucket)) return 'unsupported';
        const E2E = window.NexusE2E;
        const recipients = await E2E.recipientsFor(employeeId);
        if (!recipients) return 'no-keys';
        const { data, error } = await sb.storage.from(bucket).download(path);
        if (error || !data) return 'missing';
        const stored = new Uint8Array(await data.arrayBuffer());

        let plain;
        if (E2E.isEncryptedFile(stored)) {
            const have = E2E.fileRecipients(stored);
            if (recipients.every((r) => have.includes(r.fingerprint))) return 'already';
            plain = await E2E.decryptFile(stored, { bucket, path });
        } else {
            const legacy = await legacyDownload(bucket, path);
            if (legacy.error) return 'failed';
            plain = { bytes: new Uint8Array(await legacy.blob.arrayBuffer()), mime: legacy.blob.type || FALLBACK_TYPE };
        }

        const sealed = await E2E.encryptFileFor(plain.bytes, { bucket, path, mime: plain.mime, recipients });
        const { error: uploadError } = await sb.storage
            .from(bucket)
            .upload(path, new Blob([sealed], { type: FALLBACK_TYPE }), { contentType: FALLBACK_TYPE, upsert: true });
        if (uploadError) return 'failed';

        const check = await sb.storage.from(bucket).download(path);
        if (check.error || !check.data) return 'failed';
        const reopened = await E2E.decryptFile(new Uint8Array(await check.data.arrayBuffer()), { bucket, path }).catch(() => null);
        if (!reopened || reopened.bytes.length !== plain.bytes.length || reopened.bytes.some((b, i) => b !== plain.bytes[i])) return 'failed';
        return E2E.isEncryptedFile(stored) ? 'repaired' : 'migrated';
    }

    function saveBlobUrl(url, name) {
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    async function open(bucket, path, { name = 'arquivo' } = {}) {
        const tab = window.open('', '_blank');
        try {
            if (tab) tab.opener = null;
        } catch {}

        const { blob, error } = await download(bucket, path);
        if (error) {
            tab?.close();
            return { error };
        }

        const url = URL.createObjectURL(blob);
        setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
        if (tab && blob.type !== FALLBACK_TYPE) {
            tab.location.href = url;
        } else {
            tab?.close();
            saveBlobUrl(url, name);
        }
        return { error: null };
    }

    function safeName(name) {
        const cleaned = String(name || '')
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^A-Za-z0-9._-]+/g, '_')
            .replace(/^[._]+/, '');
        return (cleaned || 'arquivo').slice(-120);
    }

    return { upload, download, open, migrateToEndToEnd, inlineType, safeName };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.NexusFiles;
