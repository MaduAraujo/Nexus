window.NexusAvatar = (function () {
    'use strict';

    const BUCKET = 'avatars';
    const VALIDADE_SEGUNDOS = 3600;
    const MARGEM_MS = 5 * 60 * 1000;
    const URL_PUBLICA = /\/storage\/v1\/object\/public\/avatars\/([^?#]+)/;

    const cache = new Map();
    let fila = new Map();
    let agendado = false;

    function caminho(ref) {
        const v = String(ref || '');
        if (v.startsWith(`${BUCKET}/`)) return v.slice(BUCKET.length + 1).split(/[?#]/)[0] || null;
        const m = URL_PUBLICA.exec(v);
        return m ? decodeURIComponent(m[1]) : null;
    }

    function referencia(path) {
        return `${BUCKET}/${path}?v=${Date.now()}`;
    }

    async function assinarLote() {
        const lote = fila;
        fila = new Map();
        agendado = false;
        const refs = [...lote.keys()];
        const porCaminho = new Map();
        try {
            const { data, error } = await sb.storage.from(BUCKET).createSignedUrls([...new Set(refs.map(caminho))], VALIDADE_SEGUNDOS);
            if (!error) (data || []).forEach((d) => d.signedUrl && porCaminho.set(d.path, d.signedUrl));
        } catch {
            porCaminho.clear();
        }
        const expira = Date.now() + VALIDADE_SEGUNDOS * 1000;
        refs.forEach((ref) => {
            const url = porCaminho.get(caminho(ref)) || null;
            if (url) cache.set(ref, { url, expira });
            lote.get(ref).forEach((resolve) => resolve(url));
        });
    }

    function url(ref) {
        if (!caminho(ref)) return Promise.resolve(null);
        const salvo = cache.get(ref);
        if (salvo && salvo.expira - MARGEM_MS > Date.now()) return Promise.resolve(salvo.url);
        return new Promise((resolve) => {
            if (!fila.has(ref)) fila.set(ref, []);
            fila.get(ref).push(resolve);
            if (!agendado) {
                agendado = true;
                queueMicrotask(assinarLote);
            }
        });
    }

    return { caminho, url, referencia };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.NexusAvatar;
