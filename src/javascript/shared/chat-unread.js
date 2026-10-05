window.NexusChatUnread = (function () {
    'use strict';

    const LIMITE = 99;
    const ATRASO_MS = 250;
    const LINKS = '.sidebar-nav a[href*="chat-colaborador.html"], .sidebar-nav a[href*="chat-rh.html"]';

    let contagens = new Map();
    const ouvintes = new Set();
    let ativo = null;
    let agendado = null;
    let iniciado = null;

    const chave = (kind, id) => `${kind}:${id}`;

    function contar(kind, id) {
        return contagens.get(chave(kind, id)) || 0;
    }

    function total(kind) {
        let soma = 0;
        contagens.forEach((n, k) => {
            if (!kind || k.startsWith(`${kind}:`)) soma += n;
        });
        return soma;
    }

    function rotulo(n) {
        return n > LIMITE ? `${LIMITE}+` : String(n);
    }

    function pintarSidebar() {
        const n = total();
        document.querySelectorAll(LINKS).forEach((a) => {
            let badge = a.querySelector('.nav-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'nav-badge';
                a.appendChild(badge);
            }
            badge.textContent = rotulo(n);
            badge.classList.toggle('hidden', n === 0);
            badge.setAttribute('aria-label', n === 1 ? '1 mensagem não lida' : `${rotulo(n)} mensagens não lidas`);
        });
    }

    function avisar() {
        pintarSidebar();
        ouvintes.forEach((cb) => cb(api));
    }

    const visivel = () => document.visibilityState !== 'hidden';

    async function gravarLida(kind, id) {
        const { error } = await sb.rpc('chat_mark_read', { p_kind: kind, p_thread: id });
        return !error;
    }

    async function atualizar() {
        const { data, error } = await sb.rpc('chat_unread_summary');
        if (error) return false;
        const novo = new Map();
        (data || []).forEach((r) => {
            if (r.unread > 0) novo.set(chave(r.kind, r.thread), r.unread);
        });
        const pendenteAtivo = ativo && visivel() && novo.has(chave(ativo.kind, ativo.id));
        if (ativo && visivel()) novo.delete(chave(ativo.kind, ativo.id));
        contagens = novo;
        avisar();
        if (pendenteAtivo) await gravarLida(ativo.kind, ativo.id);
        return true;
    }

    function agendar() {
        clearTimeout(agendado);
        agendado = setTimeout(atualizar, ATRASO_MS);
    }

    async function marcarLida(kind, id) {
        if (contagens.delete(chave(kind, id))) avisar();
        return gravarLida(kind, id);
    }

    function abrir(kind, id) {
        const novo = kind && id ? { kind, id } : null;
        const mesmo = novo && ativo && novo.kind === ativo.kind && novo.id === ativo.id;
        ativo = novo;
        if (!novo || mesmo) return Promise.resolve(true);
        return marcarLida(kind, id);
    }

    function aoMudar(cb) {
        ouvintes.add(cb);
        cb(api);
        return () => ouvintes.delete(cb);
    }

    function assinar() {
        const tabelas = [
            ['INSERT', 'chat_messages'],
            ['INSERT', 'hr_ticket_messages'],
            ['*', 'hr_tickets'],
            ['*', 'chat_reads'],
        ];
        const canal = sb.channel('chat-unread');
        tabelas.forEach(([event, table]) => canal.on('postgres_changes', { event, schema: 'public', table }, agendar));
        canal.subscribe();
    }

    function iniciar() {
        if (iniciado) return iniciado;
        iniciado = (async () => {
            if (typeof sb === 'undefined') return false;
            const { data } = await sb.auth.getSession();
            if (!data?.session) return false;
            document.addEventListener('visibilitychange', () => {
                if (visivel()) atualizar();
            });
            assinar();
            return atualizar();
        })();
        return iniciado;
    }

    const api = { contar, total, rotulo, abrir, marcarLida, atualizar, aoMudar, iniciar };

    return api;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.NexusChatUnread;
