window.NexusFiles = (function () {
    const FUNCTION_PATH = '/functions/v1/nexus-files';
    const FALLBACK_TYPE = 'application/octet-stream';
    const INLINE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const REVOKE_AFTER_MS = 5 * 60 * 1000;

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

    async function upload(bucket, path, file, { contentType, upsert = false } = {}) {
        try {
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

    async function download(bucket, path) {
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

    return { upload, download, open, inlineType, safeName };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.NexusFiles;
