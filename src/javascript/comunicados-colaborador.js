/* comunicados-colaborador.js — Supabase */

document.addEventListener('DOMContentLoaded', async () => {
    // ─── Session ─────────────────────────────────────────────
    const auth = await NexusAuth.requireProfile('colaborador', 'id,name,role,dept,avatar_color,avatar_url');
    if (!auth) return;
    const employee = auth.employee;
    const myEmployeeId = employee.id;
    const myDept       = employee.dept || '';

    window.logout = async () => { await sb.auth.signOut(); window.location.href = '../screens/login.html'; };

    // ─── Helpers ─────────────────────────────────────────────
    const DEST_ICON_MAP = {
        'Todos':          { icon: 'fa-globe',       cls: 'dest--todos' },
        'TI':             { icon: 'fa-code',         cls: 'dest--ti'   },
        'RH':             { icon: 'fa-user-tie',     cls: 'dest--rh'   },
        'Financeiro':     { icon: 'fa-dollar-sign',  cls: 'dest--fin'  },
        'Marketing':      { icon: 'fa-ad',           cls: 'dest--mkt'  },
        'Jurídico':       { icon: 'fa-gavel',        cls: 'dest--jur'  },
        'Administrativo': { icon: 'fa-building',     cls: 'dest--adm'  },
    };

    const CATEGORIA_INFO = {
        'Urgente':       { icon: 'fa-triangle-exclamation', cls: 'cat--urgente' },
        'Institucional': { icon: 'fa-building-columns',     cls: 'cat--institucional' },
        'Benefícios':    { icon: 'fa-gift',                 cls: 'cat--beneficios' },
        'Evento':        { icon: 'fa-star',                 cls: 'cat--evento' },
        'Política':      { icon: 'fa-scale-balanced',       cls: 'cat--politica' },
    };
    const escHTML  = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

    const fmtDate  = iso => new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' });
    const timeAgo  = iso => {
        const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (diff < 60)     return 'agora mesmo';
        if (diff < 3600)   return `há ${Math.floor(diff / 60)}min`;
        if (diff < 86400)  return `há ${Math.floor(diff / 3600)}h`;
        if (diff < 172800) return 'ontem';
        return fmtDate(iso);
    };
    const fmtDateTime = iso => {
        const d = new Date(iso);
        const time = d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
        return `${fmtDate(iso)} às ${time}`;
    };

    const PREVIEW_LEN = 220;

    // ─── State ───────────────────────────────────────────────
    const searchInput    = document.getElementById('search-input');
    const searchClear    = document.getElementById('search-clear');
    const lista          = document.getElementById('comunicados-list');
    const unreadBadge    = document.getElementById('unread-badge');
    const unreadCount    = document.getElementById('unread-count');
    const btnMarcarTodos = document.getElementById('btn-marcar-todos');
    let filtroAtivo = 'todos-vis';
    let allMsgs     = [];
    let lidos       = new Set();

    // ─── Data ────────────────────────────────────────────────
    async function loadData() {
        const orFilter = myDept ? `destino.eq.Todos,destino.eq.${myDept}` : 'destino.eq.Todos';
        const [{ data: msgs }, { data: reads }] = await Promise.all([
            sb.from('messages').select('*').or(orFilter).order('created_at', { ascending: false }),
            sb.from('message_reads').select('message_id').eq('employee_id', myEmployeeId),
        ]);
        allMsgs = msgs || [];
        lidos   = new Set((reads || []).map(r => r.message_id));
    }

    async function marcarLido(msgId) {
        if (lidos.has(msgId)) return;
        lidos.add(msgId);
        await sb.from('message_reads').upsert({ message_id: msgId, employee_id: myEmployeeId }, { onConflict: 'message_id,employee_id' });
    }

    async function marcarTodosLidos() {
        const naoLidos = allMsgs.filter(m => !lidos.has(m.id));
        if (!naoLidos.length) return;
        naoLidos.forEach(m => lidos.add(m.id));
        await sb.from('message_reads').upsert(
            naoLidos.map(m => ({ message_id: m.id, employee_id: myEmployeeId })),
            { onConflict: 'message_id,employee_id' }
        );
    }

    // ─── Modal ───────────────────────────────────────────────
    const msgModal = document.getElementById('msg-modal');

    function openModal(msg) {
        const dateEl = document.getElementById('modal-date');
        const bodyEl = document.getElementById('modal-body');
        const catEl  = document.getElementById('modal-cat');
        const destEl = document.getElementById('modal-dest');

        if (catEl) {
            const catInfo = CATEGORIA_INFO[msg.categoria] || CATEGORIA_INFO['Institucional'];
            catEl.className = `badge-cat ${catInfo.cls}`;
            catEl.innerHTML = `<i class="fas ${catInfo.icon}"></i> ${escHTML(msg.categoria)}`;
        }
        if (destEl) {
            const destInfo = DEST_ICON_MAP[msg.destino] || { icon: 'fa-users', cls: 'dest--outros' };
            destEl.className = `comunicado-dest ${destInfo.cls}`;
            destEl.innerHTML = `<i class="fas ${destInfo.icon}"></i> ${escHTML(msg.destino)}`;
        }
        dateEl.innerHTML = `<i class="fas fa-clock"></i> ${fmtDateTime(msg.created_at)}`;
        bodyEl.innerHTML = sanitizeComunicadoHTML(msg.texto);

        msgModal?.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        msgModal?.classList.add('hidden');
        document.body.style.overflow = '';
    }

    document.getElementById('modal-close')?.addEventListener('click', closeModal);

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (msgModal && !msgModal.classList.contains('hidden')) { closeModal(); return; }
            if (isMobile()) closeSide();
        }
    });

    // ─── Render ───────────────────────────────────────────────
    function render() {
        const q       = searchInput?.value.toLowerCase().trim() || '';
        const naoLidosCount = allMsgs.filter(m => !lidos.has(m.id)).length;

        document.getElementById('stat-total').textContent = allMsgs.length;
        document.getElementById('stat-todos').textContent = allMsgs.filter(m => m.destino === 'Todos').length;
        document.getElementById('stat-dept').textContent  = allMsgs.filter(m => m.destino !== 'Todos').length;

        if (unreadBadge && unreadCount) {
            unreadBadge.classList.toggle('hidden', naoLidosCount === 0);
            unreadCount.textContent = naoLidosCount;
        }
        btnMarcarTodos?.classList.toggle('hidden', naoLidosCount === 0);

        let filtered = filtroAtivo === 'nao-lidos' ? allMsgs.filter(m => !lidos.has(m.id)) : allMsgs;
        if (q) filtered = filtered.filter(m => comunicadoPlainText(m.texto).toLowerCase().includes(q) || m.destino.toLowerCase().includes(q));

        if (!filtered.length) {
            lista.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><p>${q || filtroAtivo === 'nao-lidos' ? 'Nenhum resultado encontrado' : 'Nenhum comunicado disponível'}</p><span>${q ? `Nenhum resultado para "${escHTML(q)}"` : filtroAtivo === 'nao-lidos' ? 'Todos os comunicados já foram lidos.' : 'Quando o RH enviar comunicados, eles aparecerão aqui.'}</span></div>`;
            return;
        }

        lista.innerHTML = filtered.map(m => {
            const lido     = lidos.has(m.id);
            const destInfo = DEST_ICON_MAP[m.destino] || { icon: 'fa-users', cls: 'dest--outros' };
            const plainTexto = comunicadoPlainText(m.texto);
            const preview  = plainTexto.length > PREVIEW_LEN ? plainTexto.slice(0, PREVIEW_LEN) + '…' : plainTexto;
            const hasMore  = plainTexto.length > PREVIEW_LEN;
            return `
                <article class="comunicado-card${lido ? '' : ' nao-lido'}" data-id="${m.id}" role="button" tabindex="0">
                    <div class="comunicado-icon-wrap ${destInfo.cls}"><i class="fas ${destInfo.icon}"></i></div>
                    <div class="comunicado-body">
                        <div class="comunicado-top">
                            <div class="comunicado-meta">
                                ${!lido ? '<span class="badge-novo"><i class="fas fa-circle"></i> Novo</span>' : ''}
                                ${(m.anexos || []).length ? `<span class="badge-attach"><i class="fas fa-paperclip"></i> ${m.anexos.length}</span>` : ''}
                            </div>
                            <span class="comunicado-data"><i class="fas fa-clock"></i> ${timeAgo(m.created_at)}</span>
                        </div>
                        <p class="comunicado-preview">${escHTML(preview)}</p>
                        <span class="card-read-more"><i class="fas fa-arrow-right"></i> ${lido ? 'Ver comunicado' : 'Ler comunicado'}</span>
                    </div>
                </article>`;
        }).join('');

        lista.querySelectorAll('.comunicado-card').forEach(card => {
            const activate = async () => {
                const id  = card.dataset.id;
                const msg = allMsgs.find(m => String(m.id) === id);
                if (msg) openModal(msg);
                if (!lidos.has(id)) {
                    await marcarLido(id);
                    render();
                }
            };
            card.addEventListener('click', activate);
            card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
        });
    }

    // ─── Filtros ──────────────────────────────────────────────
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filtroAtivo = btn.dataset.filter;
            render();
        });
    });

    searchInput?.addEventListener('input', () => {
        searchClear?.classList.toggle('hidden', !searchInput.value.trim());
        render();
    });
    searchClear?.addEventListener('click', () => { searchInput.value = ''; searchClear.classList.add('hidden'); render(); });

    btnMarcarTodos?.addEventListener('click', async () => {
        await marcarTodosLidos();
        render();
    });

    // ─── Realtime ─────────────────────────────────────────────
    sb.channel('messages-colab')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => {
            await loadData();
            render();
        })
        .subscribe();

    window.addEventListener('beforeunload', () => { marcarTodosLidos(); });

    // ─── Polling: revela comunicados agendados assim que a hora chega ──
    setInterval(async () => {
        const before = allMsgs.length;
        await loadData();
        if (allMsgs.length !== before) render();
    }, 60000);

    // ─── Init ─────────────────────────────────────────────────
    await loadData();
    render();
});
