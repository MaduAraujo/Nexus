document.addEventListener('DOMContentLoaded', () => {
    let session = (() => {
        try { return JSON.parse(localStorage.getItem('nexus_session') || 'null'); }
        catch { return null; }
    })();

    if (!session || session.profile === 'rh') {
        window.location.href = '../screens/login.html';
        return;
    }

    const EMAIL = session.email;
    const PONTO_KEY = `nexus_ponto_${EMAIL}`;         
    const AJUSTE_KEY = `nexus_ajustes_${EMAIL}`;      
    const AUDIT_KEY  = 'nexus_ponto_audit';           
    const JORNADA_MIN = 8 * 60;                      

    const sidebar        = document.getElementById('sidebar');
    const sidebarToggle  = document.getElementById('sidebar-toggle');
    const topbarMenuBtn  = document.getElementById('topbar-menu-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mainWrapper    = document.querySelector('.main-wrapper');
    const SIDEBAR_KEY    = 'sidebarState_colab';
    const isMobile       = () => window.innerWidth <= 768;

    const openSidebar  = () => { sidebar?.classList.add('open'); sidebarOverlay?.classList.add('active'); document.body.style.overflow = 'hidden'; };
    const closeSidebar = () => { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow = ''; };

    sidebarToggle?.addEventListener('click', e => {
        e.stopPropagation();
        if (isMobile()) { sidebar?.classList.contains('open') ? closeSidebar() : openSidebar(); }
        else { const c = sidebar?.classList.toggle('collapsed'); mainWrapper?.classList.toggle('sidebar-collapsed', c); localStorage.setItem(SIDEBAR_KEY, c ? 'collapsed' : 'expanded'); }
    });

    topbarMenuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeSidebar() : openSidebar(); });
    sidebarOverlay?.addEventListener('click', closeSidebar);
    if (!isMobile() && localStorage.getItem(SIDEBAR_KEY) === 'collapsed') { sidebar?.classList.add('collapsed'); mainWrapper?.classList.add('sidebar-collapsed'); }
    window.addEventListener('resize', () => { if (!isMobile()) closeSidebar(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSidebar(); closeAllModals(); } });

    const $ = id => document.getElementById(id);
    const fmt2 = n => String(n).padStart(2, '0');

    function pad0(n) { return String(n).padStart(2, '0'); }

    function getRecords() {
        try { return JSON.parse(localStorage.getItem(PONTO_KEY) || '{}'); }
        catch { return {}; }
    }

    function saveRecords(data) {
        localStorage.setItem(PONTO_KEY, JSON.stringify(data));
        saveAudit(EMAIL, data);
    }

    function saveAudit(email, data) {
        try {
            const audit = JSON.parse(localStorage.getItem(AUDIT_KEY) || '{}');
            audit[email] = data;
            localStorage.setItem(AUDIT_KEY, JSON.stringify(audit));
        } catch {}
    }

    function todayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${pad0(d.getMonth()+1)}-${pad0(d.getDate())}`;
    }

    function nowISO() { return new Date().toISOString(); }

    function timeStr(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        return `${pad0(d.getHours())}:${pad0(d.getMinutes())}`;
    }

    function timeStrFull(iso) {
        if (!iso) return null;
        const d = new Date(iso);
        return `${pad0(d.getHours())}:${pad0(d.getMinutes())}:${pad0(d.getSeconds())}`;
    }

    function diffMin(isoA, isoB) {
        if (!isoA || !isoB) return 0;
        return Math.round((new Date(isoB) - new Date(isoA)) / 60000);
    }

    function minToStr(min) {
        const abs = Math.abs(min);
        const h   = Math.floor(abs / 60);
        const m   = abs % 60;
        return `${h}h ${pad0(m)}min`;
    }

    function calcWorkedMin(rec) {
        let total = 0;
        if (rec.entrada) {
            const fim1 = rec.saida_almoco || rec.saida;
            if (fim1) total += diffMin(rec.entrada, fim1);
        }
        if (rec.retorno_almoco && rec.saida) {
            total += diffMin(rec.retorno_almoco, rec.saida);
        }
        return total;
    }

    function calcSaldoMin(rec) {
        if (!rec.saida) return null; 
        return calcWorkedMin(rec) - JORNADA_MIN;
    }

    function fmtDate(key) {
        const [y, m, d] = key.split('-');
        return `${d}/${m}/${y}`;
    }

    function diaSemana(key) {
        const dias = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const d = new Date(key + 'T12:00:00');
        return dias[d.getDay()];
    }

    function initials(name) {
        return (name || '?').split(' ').slice(0,2).map(w => w[0]?.toUpperCase() || '').join('');
    }

    function updateClock() {
        const now   = new Date();
        const h     = pad0(now.getHours());
        const min   = pad0(now.getMinutes());
        const sec   = pad0(now.getSeconds());
        const dia   = pad0(now.getDate());
        const mes   = pad0(now.getMonth() + 1);
        const ano   = now.getFullYear();
        const el    = $('ponto-hora');
        const elD   = $('ponto-data');
        if (el)  el.textContent  = `${h}:${min}:${sec}`;
        if (elD) elD.textContent = `${dia}/${mes}/${ano}`;
    }

    updateClock();
    setInterval(updateClock, 1000);

    function initSidebar() {
        const color = session.avatarColor || '#6366f1';
        const ini   = initials(session.name);
        const av    = $('sidebar-avatar');
        if (av) { av.textContent = ini; av.style.background = color; }
        const nm = $('sidebar-name'); if (nm) nm.textContent = session.name || '—';
        const rl = $('sidebar-role'); if (rl) rl.textContent = session.role || 'Colaborador';
    }

    initSidebar();

    function getTodayRec() {
        const records = getRecords();
        return records[todayKey()] || {};
    }

    function nextStep(rec) {
        if (!rec.entrada)           return 'entrada';
        if (!rec.saida_almoco)      return 'saida_almoco';
        if (!rec.retorno_almoco)    return 'retorno_almoco';
        if (!rec.saida)             return 'saida';
        return 'encerrado';
    }

    const STEP_META = {
        entrada:         { label:'Registrar Entrada',         icon:'fa-sign-in-alt',  cls:'',             dotCls:'ativo',    hint:'Jornada não iniciada hoje.' },
        saida_almoco:    { label:'Saída para Almoço',         icon:'fa-coffee',       cls:'btn-almoco',   dotCls:'ativo',    hint:'Registre quando sair para o almoço.' },
        retorno_almoco:  { label:'Retorno do Almoço',         icon:'fa-utensils',     cls:'btn-retorno',  dotCls:'almoco',   hint:'Registre quando retornar do almoço.' },
        saida:           { label:'Registrar Saída',           icon:'fa-sign-out-alt', cls:'btn-saida',    dotCls:'ativo',    hint:'Registre sua saída ao final do expediente.' },
        encerrado:       { label:'Jornada encerrada',         icon:'fa-check-circle', cls:'btn-encerrado',dotCls:'encerrado',hint:'Todos os registros do dia foram concluídos.' },
    };

    function renderUI() {
        const rec  = getTodayRec();
        const step = nextStep(rec);
        const meta = STEP_META[step];

        const btn  = $('btn-ponto');
        const icon = $('btn-ponto-icon');
        const txt  = $('btn-ponto-text');
        if (btn && icon && txt) {
            btn.className   = `btn-ponto ${meta.cls}`;
            btn.disabled    = step === 'encerrado';
            icon.className  = `fas ${meta.icon}`;
            txt.textContent = meta.label;
        }

        const hint = $('ponto-hint');
        if (hint) hint.textContent = meta.hint;

        const dot  = $('ponto-dot');
        const stxt = $('ponto-status-text');
        if (dot)  dot.className  = `ponto-status-dot ${meta.dotCls}`;
        if (stxt) stxt.textContent = getStatusText(rec, step);

        renderTimeline(rec, step);
        renderSaldo();
        renderStats();
        renderSolicitacoes();
        renderHistorico();
    }

    function getStatusText(rec, step) {
        if (step === 'entrada')         return 'Jornada não iniciada hoje';
        if (step === 'saida_almoco')    return `Em expediente desde ${timeStr(rec.entrada)}`;
        if (step === 'retorno_almoco')  return `Em almoço desde ${timeStr(rec.saida_almoco)}`;
        if (step === 'saida')           return `Retornou às ${timeStr(rec.retorno_almoco)}`;
        const saldo = calcSaldoMin(rec);
        if (saldo === null) return 'Jornada encerrada';
        return saldo >= 0
            ? `Jornada encerrada — +${minToStr(saldo)} extras`
            : `Jornada encerrada — -${minToStr(saldo)} em falta`;
    }

    function renderTimeline(rec, step) {
        const steps = ['entrada','saida_almoco','retorno_almoco','saida'];
        const ids   = ['ts-entrada','ts-saida-almoco','ts-retorno','ts-saida'];
        const timeIds = ['ts-time-entrada','ts-time-saida-almoco','ts-time-retorno','ts-time-saida'];
        const lines   = ['ts-line-1','ts-line-2','ts-line-3'];
        const keys    = ['entrada','saida_almoco','retorno_almoco','saida'];

        const stepIdx = steps.indexOf(step);

        ids.forEach((id, i) => {
            const el   = $(id); if (!el) return;
            const done = rec[keys[i]];
            const curr = i === stepIdx;
            el.className = 'ts-step' + (done ? ' done' : curr ? ' current' : '');
            const t = $(timeIds[i]);
            if (t) t.textContent = done ? timeStr(done) : '—';
        });

        lines.forEach((id, i) => {
            const el = $(id); if (!el) return;
            el.className = 'ts-line' + (rec[keys[i]] ? ' done' : '');
        });
    }

    function renderSaldo() {
        const records = getRecords();
        let totalMin  = 0;
        let hasDias   = false;

        Object.values(records).forEach(rec => {
            const s = calcSaldoMin(rec);
            if (s !== null) { totalMin += s; hasDias = true; }
        });

        const icon  = $('saldo-icon');
        const val   = $('saldo-value');
        const sub   = $('saldo-sub');

        if (!hasDias) {
            if (val) val.textContent = '0h 00min';
            if (sub) sub.textContent = 'Nenhum dia registrado';
            return;
        }

        const sign = totalMin >= 0 ? '+' : '-';
        const str  = minToStr(totalMin);

        if (icon) { icon.className = `saldo-icon ${totalMin >= 0 ? 'positivo' : 'negativo'}`; }
        if (val)  { val.textContent = `${sign}${str}`; val.className = `saldo-value ${totalMin >= 0 ? 'positivo' : 'negativo'}`; }
        if (sub)  { sub.textContent = 'Saldo acumulado de todos os dias'; }
    }

    function renderStats() {
        const records = getRecords();
        const now     = new Date();
        const mesKey  = `${now.getFullYear()}-${pad0(now.getMonth()+1)}`;

        let diasMes  = 0, extrasMin = 0, faltaMin = 0;

        Object.entries(records).forEach(([key, rec]) => {
            if (!key.startsWith(mesKey)) return;
            const s = calcSaldoMin(rec);
            if (s === null) return;
            diasMes++;
            if (s > 0) extrasMin += s;
            else       faltaMin  += Math.abs(s);
        });

        const el_dias  = $('stat-dias-mes');
        const el_extra = $('stat-horas-extras');
        const el_falta = $('stat-horas-falta');

        if (el_dias)  el_dias.textContent  = diasMes;
        if (el_extra) el_extra.textContent = extrasMin ? minToStr(extrasMin) : '0h 00min';
        if (el_falta) el_falta.textContent = faltaMin  ? minToStr(faltaMin)  : '0h 00min';
    }

    window.renderHistorico = function () {
        const tbody = $('historico-tbody'); if (!tbody) return;
        const records = getRecords();

        const fmEl = $('filter-month');
        const now  = new Date();
        const mesAtual = `${now.getFullYear()}-${pad0(now.getMonth()+1)}`;
        if (fmEl && !fmEl.value) fmEl.value = mesAtual;
        const filtroMes = fmEl?.value || mesAtual;

        const dias = Object.entries(records)
            .filter(([k]) => k.startsWith(filtroMes))
            .sort(([a],[b]) => b.localeCompare(a));

        if (!dias.length) {
            tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
                <i class="fas fa-calendar-times"></i>
                <p>Nenhum registro em ${filtroMes.replace('-','/')}</p>
                <span>Os registros de ponto aparecerão aqui</span>
            </div></td></tr>`;
            return;
        }

        tbody.innerHTML = dias.map(([key, rec]) => {
            const worked = calcWorkedMin(rec);
            const saldo  = calcSaldoMin(rec);
            const workedStr = rec.saida ? minToStr(worked) : '—';
            let saldoStr = '—'; let saldoCls = 'zero';
            if (saldo !== null) {
                saldoStr = (saldo >= 0 ? '+' : '-') + minToStr(saldo);
                saldoCls = saldo > 0 ? 'positivo' : saldo < 0 ? 'negativo' : 'zero';
            }

            const badge = getBadge(rec, saldo);

            const t = (field) => {
                const v = rec[field];
                const wasAdjusted = rec[`${field}_ajustado`];
                if (!v) return `<span class="td-time missing">—</span>`;
                return `<span class="td-time ${wasAdjusted ? 'ajustado' : ''}">${timeStr(v)}</span>`;
            };

            return `<tr>
                <td class="td-date">
                    ${fmtDate(key)}
                    <span class="dia-semana">${diaSemana(key)}</span>
                </td>
                <td>${t('entrada')}</td>
                <td>${t('saida_almoco')}</td>
                <td>${t('retorno_almoco')}</td>
                <td>${t('saida')}</td>
                <td class="td-total">${workedStr}</td>
                <td class="td-saldo ${saldoCls}">${saldoStr}</td>
                <td><span class="badge ${badge.cls}">${badge.label}</span></td>
            </tr>`;
        }).join('');
    };

    function getBadge(rec, saldo) {
        if (rec.ajustado)         return { cls:'badge-ajuste', label:'Ajustado' };
        if (!rec.entrada)         return { cls:'badge-falta',  label:'Falta' };
        if (!rec.saida)           return { cls:'badge-ajuste', label:'Incompleto' };
        if (saldo === null)       return { cls:'badge-ajuste', label:'Incompleto' };
        if (saldo > 0)            return { cls:'badge-extra',  label:'Extra' };
        if (saldo < 0)            return { cls:'badge-falta',  label:'Falta' };
        return { cls:'badge-normal', label:'Normal' };
    }

    function renderSolicitacoes() {
        const ajustes = getAjustes().filter(a => a.status === 'pendente');
        const section = $('section-solicitacoes');
        const list    = $('solicitacoes-list');
        if (!section || !list) return;

        if (!ajustes.length) { section.classList.add('hidden'); return; }
        section.classList.remove('hidden');

        const tipoMap = {
            'entrada':'Correção de Entrada','saida-almoco':'Correção de Saída p/ Almoço',
            'retorno-almoco':'Correção de Retorno','saida':'Correção de Saída','falta':'Justificativa de Falta'
        };

        list.innerHTML = ajustes.map(a => `
            <div class="solicitacao-item">
                <div class="sol-icon"><i class="fas fa-edit"></i></div>
                <div class="sol-info">
                    <p class="sol-tipo">${tipoMap[a.tipo] || a.tipo}</p>
                    <p class="sol-meta">Data: ${a.data} ${a.horario ? '• Horário: ' + a.horario : ''} • Enviado em ${a.criadoEm}</p>
                </div>
                <span class="badge-pendente"><i class="fas fa-hourglass-half"></i> Pendente</span>
            </div>
        `).join('');
    }

    let pendingStep = null;

    window.abrirConfirmar = function () {
        const rec  = getTodayRec();
        const step = nextStep(rec);
        if (step === 'encerrado') return;

        pendingStep = step;

        const now     = new Date();
        const ini     = initials(session.name);
        const color   = session.avatarColor || '#6366f1';

        const av = $('confirmar-avatar');
        if (av) { av.textContent = ini; av.style.background = color; }
        const nm = $('confirmar-nome');  if (nm) nm.textContent = session.name || '—';
        const em = $('confirmar-email'); if (em) em.textContent = EMAIL;

        const tipoLabels = {
            entrada:'Entrada','saida_almoco':'Saída para Almoço',
            retorno_almoco:'Retorno do Almoço','saida':'Saída'
        };
        const tp = $('confirmar-tipo');
        if (tp) tp.textContent = tipoLabels[step] || step;

        const da = $('confirmar-data');
        if (da) da.textContent = `${pad0(now.getDate())}/${pad0(now.getMonth()+1)}/${now.getFullYear()}`;

        if (window._confirmTimerInterval) clearInterval(window._confirmTimerInterval);
        const hr = $('confirmar-hora');
        const tick = () => {
            const n = new Date();
            if (hr) hr.textContent = `${pad0(n.getHours())}:${pad0(n.getMinutes())}:${pad0(n.getSeconds())}`;
        };

        tick();
        window._confirmTimerInterval = setInterval(tick, 1000);

        openModal('modal-confirmar');
    };

    window.confirmarRegistro = function () {
        if (!pendingStep) return;
        clearInterval(window._confirmTimerInterval);
        closeModal('modal-confirmar');

        const records = getRecords();
        const key     = todayKey();
        if (!records[key]) records[key] = {};

        records[key][pendingStep] = nowISO();
        records[key].email = EMAIL; 
        saveRecords(records);

        const labels = {
            entrada:'Entrada registrada',saida_almoco:'Saída para almoço registrada',
            retorno_almoco:'Retorno registrado',saida:'Saída registrada — bom descanso!'
        };

        showToast(labels[pendingStep] || 'Ponto registrado!', 'success');
        pendingStep = null;
        renderUI();
    };

    window.openModalAjuste = function () {
        ['ajuste-data','ajuste-horario','ajuste-justificativa'].forEach(id => {
            const el = $(id); if (el) el.value = '';
        });
        const tipo = $('ajuste-tipo'); if (tipo) tipo.value = '';
        ['err-ajuste-data','err-ajuste-tipo','err-ajuste-horario','err-ajuste-just'].forEach(id => {
            const el = $(id); if (el) el.textContent = '';
        });
        const hg = $('ajuste-horario-group');
        if (hg) hg.classList.remove('hidden');
        openModal('modal-ajuste');
    };

    window.onAjusteTipoChange = function () {
        const tipo = $('ajuste-tipo')?.value;
        const hg   = $('ajuste-horario-group');
        if (!hg) return;
        hg.classList.toggle('hidden', tipo === 'falta');
    };

    window.enviarSolicitacao = function () {
        const data   = $('ajuste-data')?.value.trim()          || '';
        const tipo   = $('ajuste-tipo')?.value                 || '';
        const hor    = $('ajuste-horario')?.value              || '';
        const just   = $('ajuste-justificativa')?.value.trim() || '';
        const isFalta = tipo === 'falta';

        let ok = true;
        const setErr = (id, msg) => { const el = $(id); if (el) el.textContent = msg; if (msg) ok = false; };

        setErr('err-ajuste-data',    data  ? '' : 'Informe a data.');
        setErr('err-ajuste-tipo',    tipo  ? '' : 'Selecione o tipo.');
        setErr('err-ajuste-horario', (isFalta || hor) ? '' : 'Informe o horário correto.');
        setErr('err-ajuste-just',    just  ? '' : 'A justificativa é obrigatória.');

        if (!ok) return;

        const ajustes = getAjustes();
        const now     = new Date();
        const criadoEm = `${pad0(now.getDate())}/${pad0(now.getMonth()+1)}/${now.getFullYear()} às ${pad0(now.getHours())}:${pad0(now.getMinutes())}`;

        ajustes.push({
            id:        Date.now(),
            email:     EMAIL,
            nome:      session.name || '—',
            data,
            tipo,
            horario:   isFalta ? null : hor,
            justificativa: just,
            status:    'pendente',
            criadoEm
        });

        saveAjustes(ajustes);
        salvarAjusteAudit(ajustes[ajustes.length - 1]);

        closeModal('modal-ajuste');
        showToast('Solicitação enviada! Aguarde aprovação do RH.', 'success');
        renderSolicitacoes();
    };

    function getAjustes() {
        try { return JSON.parse(localStorage.getItem(AJUSTE_KEY) || '[]'); }
        catch { return []; }
    }

    function saveAjustes(arr) {
        localStorage.setItem(AJUSTE_KEY, JSON.stringify(arr));
    }

    function salvarAjusteAudit(ajuste) {
        try {
            const key  = 'nexus_ajustes_audit';
            const list = JSON.parse(localStorage.getItem(key) || '[]');
            list.push(ajuste);
            localStorage.setItem(key, JSON.stringify(list));
        } catch {}
    }

    function openModal(id)  {
        const el = $(id); if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
    }
    window.closeModal = function (id) {
        const el = $(id); if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
        if (id === 'modal-confirmar') clearInterval(window._confirmTimerInterval);
    };
    function closeAllModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => { el.classList.remove('open'); });
        document.body.style.overflow = '';
        clearInterval(window._confirmTimerInterval);
    }

    document.querySelectorAll('.modal-overlay').forEach(el => {
        el.addEventListener('click', e => { if (e.target === el) { closeModal(el.id); } });
    });

    window.showToast = function (title, type = 'success') {
        const container = $('toast-container'); if (!container) return;
        const icons = { success:'fa-check', error:'fa-times', warning:'fa-exclamation-triangle', info:'fa-info' };
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon"><i class="fas ${icons[type]||'fa-check'}"></i></div>
            <div class="toast-content"><p class="toast-title">${title}</p></div>
            <button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),300)"><i class="fas fa-times"></i></button>`;
        container.appendChild(toast);
        requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
        setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => toast.remove(), 300); }, 4000);
    };

    window.logout = function () {
        localStorage.removeItem('nexus_session');
        window.location.href = '../screens/login.html';
    };
    
    const now = new Date();
    const fmEl = $('filter-month');
    if (fmEl) fmEl.value = `${now.getFullYear()}-${pad0(now.getMonth()+1)}`;

    renderUI();
});