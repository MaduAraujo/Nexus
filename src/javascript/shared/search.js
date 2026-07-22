(function () {
    const SCREENS = [
        { label: 'Painel', href: 'inicio-rh.html', icon: 'fa-home' },
        { label: 'Dashboard', href: 'dashboard.html', icon: 'fa-chart-pie' },
        { label: 'Colaboradores', href: 'colaboradores.html', icon: 'fa-users' },
        { label: 'Arquivos', href: 'arquivos.html', icon: 'fa-folder-open' },
        { label: 'Gestão de Horas', href: 'banco-horas-rh.html', icon: 'fa-clock-rotate-left' },
        { label: 'Gestão de Férias', href: 'ferias.html', icon: 'fa-umbrella-beach' },
        { label: 'Pagamentos', href: 'pagamentos.html', icon: 'fa-money-bill-wave' },
        { label: 'Atendimento', href: 'chat-rh.html', icon: 'fa-headset' },
        { label: 'Central de Alertas', href: 'alertas.html', icon: 'fa-robot' },
        { label: 'Comunicação Interna', href: 'comunicacao.html', icon: 'fa-bullhorn' },
    ];

    const STATUS_LABEL = { pendente: 'Pendente', aprovado: 'Aprovado', rejeitado: 'Rejeitado', recusado: 'Recusado' };

    function esc(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmtDate(str) {
        if (!str) return '';
        const [y, m, d] = String(str).split('-');
        return `${d}/${m}/${y}`;
    }

    let cache = null;
    let loadingPromise = null;

    async function loadData() {
        if (cache) return cache;
        if (loadingPromise) return loadingPromise;
        loadingPromise = (async () => {
            const [{ data: emps }, { data: vacs }, { data: bankReqs }, { data: docs }] = await Promise.all([
                sb.from('employees').select('id,name,dept,role,email').order('name'),
                sb.from('vacations').select('id,employee_id,start_date,end_date,status').order('created_at', { ascending: false }).limit(200),
                sb.from('bank_requests').select('id,employee_id,tipo,minutos,date,status').order('created_at', { ascending: false }).limit(200),
                sb.from('documents').select('id,name,employee_id,category').order('created_at', { ascending: false }).limit(200),
            ]);
            const empMap = {};
            (emps || []).forEach((e) => {
                empMap[e.id] = e;
            });
            cache = { employees: emps || [], vacations: vacs || [], bankRequests: bankReqs || [], documents: docs || [], empMap };
            return cache;
        })();
        return loadingPromise;
    }

    function buildResults(query, data) {
        const q = query.trim().toLowerCase();
        const results = [];
        const here = window.location.pathname;

        SCREENS.forEach((s) => {
            if (!q || s.label.toLowerCase().includes(q)) {
                results.push({
                    group: 'Telas',
                    icon: s.icon,
                    title: s.label,
                    subtitle: here.endsWith(s.href) ? 'Você está aqui' : '',
                    action: () => {
                        window.location.href = s.href;
                    },
                });
            }
        });

        if (q) {
            data.employees.forEach((e) => {
                const hay = `${e.name} ${e.dept || ''} ${e.role || ''} ${e.email || ''}`.toLowerCase();
                if (!hay.includes(q)) return;
                results.push({
                    group: 'Colaboradores',
                    icon: 'fa-user',
                    title: e.name,
                    subtitle: [e.role, e.dept].filter(Boolean).join(' · '),
                    action: () => {
                        window.location.href = `colaboradores.html?emp=${e.id}`;
                    },
                });
            });

            data.vacations.forEach((v) => {
                const emp = data.empMap[v.employee_id];
                if (!emp) return;
                if (!emp.name.toLowerCase().includes(q) && !'férias ferias'.includes(q)) return;
                results.push({
                    group: 'Solicitações de Férias',
                    icon: 'fa-umbrella-beach',
                    title: emp.name,
                    subtitle: `${fmtDate(v.start_date)} → ${fmtDate(v.end_date)} · ${STATUS_LABEL[v.status] || v.status}`,
                    action: () => {
                        window.location.href = `ferias.html?req=${v.id}`;
                    },
                });
            });

            data.bankRequests.forEach((r) => {
                const emp = data.empMap[r.employee_id];
                if (!emp) return;
                if (!emp.name.toLowerCase().includes(q) && !'banco de horas'.includes(q)) return;
                const sinal = r.tipo === 'credito' ? '+' : '-';
                results.push({
                    group: 'Solicitações de Banco de Horas',
                    icon: 'fa-clock-rotate-left',
                    title: emp.name,
                    subtitle: `${fmtDate(r.date)} · ${sinal}${r.minutos}min · ${STATUS_LABEL[r.status] || r.status}`,
                    action: () => {
                        window.location.href = `banco-horas-rh.html?req=${r.id}`;
                    },
                });
            });

            data.documents.forEach((d) => {
                const emp = data.empMap[d.employee_id];
                const hay = `${d.name} ${emp?.name || ''} ${d.category || ''}`.toLowerCase();
                if (!hay.includes(q)) return;
                results.push({
                    group: 'Documentos',
                    icon: 'fa-file-alt',
                    title: d.name,
                    subtitle: emp ? emp.name : d.category || '',
                    action: () => {
                        window.location.href = d.employee_id ? `arquivos.html?colaborador=${d.employee_id}` : 'arquivos.html';
                    },
                });
            });
        }

        return results.slice(0, 40);
    }

    let overlay, input, resultsEl, trigger;
    let currentResults = [];
    let activeIndex = 0;

    function buildDOM() {
        trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'nexus-search-trigger';
        trigger.setAttribute('aria-label', 'Busca universal');
        trigger.innerHTML = `<i class="fas fa-search"></i><span>Buscar</span><kbd>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} K</kbd>`;
        trigger.addEventListener('click', open);
        document.body.appendChild(trigger);

        overlay = document.createElement('div');
        overlay.className = 'nexus-search-overlay hidden';
        overlay.innerHTML = `
            <div class="nexus-search-backdrop"></div>
            <div class="nexus-search-modal" role="dialog" aria-modal="true" aria-label="Busca universal">
                <div class="nexus-search-input-row">
                    <i class="fas fa-search"></i>
                    <input type="text" class="nexus-search-input" placeholder="Buscar colaborador, solicitação, documento ou tela..." autocomplete="off" spellcheck="false" />
                    <kbd>Esc</kbd>
                </div>
                <div class="nexus-search-results"></div>
                <div class="nexus-search-footer">
                    <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
                    <span><kbd>Enter</kbd> abrir</span>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        input = overlay.querySelector('.nexus-search-input');
        resultsEl = overlay.querySelector('.nexus-search-results');

        overlay.querySelector('.nexus-search-backdrop').addEventListener('click', close);
        input.addEventListener('input', renderResults);
        input.addEventListener('keydown', onInputKeydown);
    }

    function renderResults() {
        loadData().then((data) => {
            currentResults = buildResults(input.value, data);
            activeIndex = 0;
            paintResults();
        });
    }

    function paintResults() {
        if (!currentResults.length) {
            resultsEl.innerHTML = `<div class="nexus-search-empty">Nenhum resultado para "${esc(input.value)}".</div>`;
            return;
        }
        let lastGroup = null;
        resultsEl.innerHTML = currentResults
            .map((r, i) => {
                const groupHeader = r.group !== lastGroup ? `<div class="nexus-search-group">${esc(r.group)}</div>` : '';
                lastGroup = r.group;
                return `${groupHeader}<div class="nexus-search-item${i === activeIndex ? ' active' : ''}" data-idx="${i}">
                <i class="fas ${r.icon}"></i>
                <div class="nexus-search-item-body">
                    <span class="nexus-search-item-title">${esc(r.title)}</span>
                    ${r.subtitle ? `<span class="nexus-search-item-sub">${esc(r.subtitle)}</span>` : ''}
                </div>
            </div>`;
            })
            .join('');
        resultsEl.querySelectorAll('.nexus-search-item').forEach((el) => {
            el.addEventListener('click', () => {
                currentResults[+el.dataset.idx]?.action();
            });
            el.addEventListener('mouseenter', () => {
                activeIndex = +el.dataset.idx;
                updateActiveClass();
            });
        });
    }

    function updateActiveClass() {
        resultsEl.querySelectorAll('.nexus-search-item').forEach((el) => {
            el.classList.toggle('active', +el.dataset.idx === activeIndex);
        });
        resultsEl.querySelector('.nexus-search-item.active')?.scrollIntoView({ block: 'nearest' });
    }

    function onInputKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (currentResults.length) {
                activeIndex = (activeIndex + 1) % currentResults.length;
                updateActiveClass();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (currentResults.length) {
                activeIndex = (activeIndex - 1 + currentResults.length) % currentResults.length;
                updateActiveClass();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            currentResults[activeIndex]?.action();
        } else if (e.key === 'Escape') {
            close();
        }
    }

    function open() {
        overlay.classList.remove('hidden');
        input.value = '';
        input.focus();
        renderResults();
        document.addEventListener('keydown', onGlobalKeydownWhileOpen, true);
    }

    function close() {
        overlay.classList.add('hidden');
        document.removeEventListener('keydown', onGlobalKeydownWhileOpen, true);
    }

    function onGlobalKeydownWhileOpen(e) {
        if (e.key === 'Escape') {
            e.stopPropagation();
            close();
        }
    }

    function onGlobalShortcut(e) {
        const isK = e.key === 'k' || e.key === 'K';
        if (isK && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            overlay.classList.contains('hidden') ? open() : close();
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        buildDOM();
        document.addEventListener('keydown', onGlobalShortcut);
    });
})();