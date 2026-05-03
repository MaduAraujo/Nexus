/* ponto-colaborador.js — Supabase */

let myEmployee    = null;
let myEmployeeId  = null;
let recordsMap    = {};   // { 'YYYY-MM-DD': timeRecord }
let adjRequests   = [];   // adjustment_requests array
let userCoords    = null;
let pendingStep   = null;

const EMPRESA = {
    nome: 'Nexus',
    unidades: [
        { endereco: 'R. Augusta, 1508 - Consolação, São Paulo - SP', lat: -23.5591, lng: -46.6606, raioM: 200 },
        { endereco: 'R. Borges de Figueiredo, 510 - Mooca, São Paulo - SP', lat: -23.5552, lng: -46.6035, raioM: 200 }
    ],
    lat: -23.5591, lng: -46.6606, raioM: 200
};

const pad0 = n => String(n).padStart(2, '0');
const $    = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = '../screens/login.html'; return; }

    const { data: profile } = await sb.from('profiles').select('profile, employee_id').eq('id', user.id).single();
    if (profile?.profile !== 'colaborador' || !profile.employee_id) { window.location.href = '../screens/login.html'; return; }

    myEmployeeId = profile.employee_id;
    const { data: emp } = await sb.from('employees').select('*').eq('id', myEmployeeId).single();
    if (!emp) { window.location.href = '../screens/login.html'; return; }
    myEmployee = emp;

    initSidebar();
    await loadData();
    setupRealtimeSync();

    updateClock();
    setInterval(updateClock, 1000);

    const now = new Date();
    const fmEl = $('filter-month');
    if (fmEl) fmEl.value = `${now.getFullYear()}-${pad0(now.getMonth()+1)}`;

    renderUI();
    initLocation();

    document.querySelectorAll('.modal-overlay').forEach(el => {
        el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAllModals(); } });
});

// ─── Data ─────────────────────────────────────────────────────

async function loadData() {
    const [{ data: records }, { data: adj }] = await Promise.all([
        sb.from('time_records').select('*').eq('employee_id', myEmployeeId).order('date', { ascending: false }),
        sb.from('adjustment_requests').select('*').eq('employee_id', myEmployeeId).order('created_at', { ascending: false }),
    ]);
    recordsMap  = {};
    (records || []).forEach(r => { recordsMap[r.date] = r; });
    adjRequests = adj || [];
}

function todayKey() { const d = new Date(); return `${d.getFullYear()}-${pad0(d.getMonth()+1)}-${pad0(d.getDate())}`; }
function nowISO()   { return new Date().toISOString(); }
function timeStr(iso) { if (!iso) return null; const d = new Date(iso); return `${pad0(d.getHours())}:${pad0(d.getMinutes())}`; }
function diffMin(a, b) { if (!a || !b) return 0; return Math.round((new Date(b) - new Date(a)) / 60000); }
function minToStr(min) { const abs = Math.abs(min); return `${Math.floor(abs/60)}h ${pad0(abs%60)}min`; }
function fmtDate(key) { const [y,m,d] = key.split('-'); return `${d}/${m}/${y}`; }
function diaSemana(key) { const dias=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']; return dias[new Date(key+'T12:00:00').getDay()]; }
function initials(name) { return (name||'?').split(' ').slice(0,2).map(w=>w[0]?.toUpperCase()||'').join(''); }

function getJornadaMin() {
    const tipo = (myEmployee?.contract_type || 'clt').toLowerCase();
    if (tipo === 'estagio' || tipo === 'aprendiz') return 6 * 60;
    if (tipo === 'pj') return null;
    return 8 * 60;
}

function isFalta(rec) { return !rec || !rec.entrada; }

function calcWorkedMin(rec) {
    if (!rec || !rec.entrada) return 0;
    if (rec.saida_almoco) {
        const morning   = diffMin(rec.entrada, rec.saida_almoco);
        const afternoon = (rec.retorno_almoco && rec.saida) ? diffMin(rec.retorno_almoco, rec.saida) : 0;
        return morning + afternoon;
    }
    return rec.saida ? diffMin(rec.entrada, rec.saida) : 0;
}

function calcSaldoMin(rec) {
    if (isFalta(rec) || !rec.saida) return null;
    const j = getJornadaMin();
    if (j === null) return null;
    return calcWorkedMin(rec) - j;
}

function getTodayRec() { return recordsMap[todayKey()] || {}; }

function nextStep(rec) {
    if (!rec.entrada)        return 'entrada';
    if (!rec.saida_almoco)   return 'saida_almoco';
    if (!rec.retorno_almoco) return 'retorno_almoco';
    if (!rec.saida)          return 'saida';
    return 'encerrado';
}

// ─── Sidebar ──────────────────────────────────────────────────

function initSidebar() {
    const color = myEmployee.avatar_color || '#6366f1';
    const ini   = initials(myEmployee.name);
    const av = $('sidebar-avatar'); if (av) { av.textContent = ini; av.style.background = color; }
    const nm = $('sidebar-name');   if (nm) nm.textContent = myEmployee.name || '—';
    const rl = $('sidebar-role');   if (rl) rl.textContent = myEmployee.role || 'Colaborador';

    const sidebar       = $('sidebar');
    const sidebarToggle = $('sidebar-toggle');
    const topbarMenuBtn = $('topbar-menu-btn');
    const sidebarOverlay= $('sidebar-overlay');
    const mainWrapper   = document.querySelector('.main-wrapper');
    const isMobile = () => window.innerWidth <= 768;
    const openSide  = () => { sidebar?.classList.add('open');    sidebarOverlay?.classList.add('active');    document.body.style.overflow='hidden'; };
    const closeSide = () => { sidebar?.classList.remove('open'); sidebarOverlay?.classList.remove('active'); document.body.style.overflow=''; };
    sidebarToggle?.addEventListener('click', e => { e.stopPropagation(); isMobile() ? (sidebar?.classList.contains('open') ? closeSide() : openSide()) : (() => { const c = sidebar?.classList.toggle('collapsed'); mainWrapper?.classList.toggle('sidebar-collapsed', c); })(); });
    topbarMenuBtn?.addEventListener('click', e => { e.stopPropagation(); sidebar?.classList.contains('open') ? closeSide() : openSide(); });
    sidebarOverlay?.addEventListener('click', closeSide);
    window.addEventListener('resize', () => { if (!isMobile()) closeSide(); });
}

window.logout = async function () { await sb.auth.signOut(); window.location.href = '../screens/login.html'; };

// ─── Clock ────────────────────────────────────────────────────

function updateClock() {
    const now = new Date();
    const el  = $('ponto-hora'), elD = $('ponto-data');
    if (el)  el.textContent  = `${pad0(now.getHours())}:${pad0(now.getMinutes())}:${pad0(now.getSeconds())}`;
    if (elD) elD.textContent = `${pad0(now.getDate())}/${pad0(now.getMonth()+1)}/${now.getFullYear()}`;
}

// ─── Render UI ────────────────────────────────────────────────

const STEP_META = {
    entrada:        { label:'Registrar Entrada',    icon:'fa-sign-in-alt',  cls:'',             dotCls:'inativo',   hint:'Jornada não iniciada hoje.' },
    saida_almoco:   { label:'Saída para Almoço',    icon:'fa-coffee',       cls:'btn-almoco',   dotCls:'ativo',     hint:'Registre quando sair para o almoço.' },
    retorno_almoco: { label:'Retorno do Almoço',    icon:'fa-utensils',     cls:'btn-retorno',  dotCls:'almoco',    hint:'Registre quando retornar do almoço.' },
    saida:          { label:'Registrar Saída',      icon:'fa-sign-out-alt', cls:'btn-saida',    dotCls:'ativo',     hint:'Registre sua saída ao final do expediente.' },
    encerrado:      { label:'Jornada encerrada',    icon:'fa-check-circle', cls:'btn-encerrado',dotCls:'encerrado', hint:'Todos os registros do dia foram concluídos.' },
};

function renderUI() {
    const rec  = getTodayRec();
    const step = nextStep(rec);
    const meta = STEP_META[step];
    const btn = $('btn-ponto'), icon = $('btn-ponto-icon'), txt = $('btn-ponto-text');
    if (btn && icon && txt) { btn.className = `btn-ponto ${meta.cls}`; btn.disabled = step === 'encerrado'; icon.className = `fas ${meta.icon}`; txt.textContent = meta.label; }
    const hint = $('ponto-hint'); if (hint) hint.textContent = meta.hint;
    const dot  = $('ponto-dot');  if (dot)  dot.className = `ponto-status-dot ${meta.dotCls}`;
    const stxt = $('ponto-status-text'); if (stxt) stxt.textContent = getStatusText(rec, step);
    renderTimeline(rec, step);
    renderSaldo();
    renderStats();
    renderSolicitacoes();
    runBurnoutCheck();
    renderHistorico();
}

function getStatusText(rec, step) {
    if (step === 'entrada')        return 'Jornada não iniciada hoje';
    if (step === 'saida_almoco')   return `Em expediente desde ${timeStr(rec.entrada)}`;
    if (step === 'retorno_almoco') return `Em almoço desde ${timeStr(rec.saida_almoco)}`;
    if (step === 'saida')          return `Retornou às ${timeStr(rec.retorno_almoco)}`;
    const saldo = calcSaldoMin(rec);
    if (getJornadaMin() === null)  return `Jornada encerrada — ${minToStr(calcWorkedMin(rec))} registradas`;
    if (saldo === null) return 'Jornada encerrada';
    return saldo >= 0 ? `Jornada encerrada — +${minToStr(saldo)} extras` : `Jornada encerrada — ${minToStr(saldo)} em falta`;
}

function renderTimeline(rec, step) {
    const steps   = ['entrada','saida_almoco','retorno_almoco','saida'];
    const ids     = ['ts-entrada','ts-saida-almoco','ts-retorno','ts-saida'];
    const timeIds = ['ts-time-entrada','ts-time-saida-almoco','ts-time-retorno','ts-time-saida'];
    const lines   = ['ts-line-1','ts-line-2','ts-line-3'];
    const stepIdx = steps.indexOf(step);
    ids.forEach((id,i) => { const el=$(id); if (!el) return; const done=rec[steps[i]]; const curr=i===stepIdx; el.className='ts-step'+(done?' done':curr?' current':''); const t=$(timeIds[i]); if(t)t.textContent=done?timeStr(done):'—'; });
    lines.forEach((id,i) => { const el=$(id); if(el)el.className='ts-line'+(rec[steps[i]]?' done':''); });
}

function renderSaldo() {
    const jornadaMin = getJornadaMin();
    let totalMin = 0, diasCompletos = 0;
    Object.values(recordsMap).forEach(rec => {
        if (isFalta(rec)) return;
        const s = calcSaldoMin(rec);
        if (s !== null) { totalMin += s; diasCompletos++; }
    });
    const icon = $('saldo-icon'), val = $('saldo-value'), sub = $('saldo-sub');
    if (jornadaMin === null) {
        let totalWorked = 0;
        Object.values(recordsMap).forEach(rec => { if (!isFalta(rec) && rec.saida) totalWorked += calcWorkedMin(rec); });
        if (icon) icon.className = 'saldo-icon positivo';
        if (val)  { val.textContent = minToStr(totalWorked); val.className = 'saldo-value'; }
        if (sub)  sub.textContent = `Total registrado em ${diasCompletos} dia(s) — PJ`;
        return;
    }
    if (diasCompletos === 0) { if (icon) icon.className = 'saldo-icon'; if (val) { val.textContent='0h 00min'; val.className='saldo-value'; } if (sub) sub.textContent='Nenhum dia finalizado'; return; }
    const sign = totalMin > 0 ? '+' : totalMin < 0 ? '-' : '';
    const cls  = totalMin > 0 ? 'positivo' : totalMin < 0 ? 'negativo' : 'positivo';
    if (icon) icon.className = `saldo-icon ${cls}`;
    if (val)  { val.textContent = `${sign}${minToStr(totalMin)}`; val.className = `saldo-value ${totalMin !== 0 ? cls : ''}`; }
    if (sub)  sub.textContent = `Saldo acumulado de ${diasCompletos} dia(s) registrado(s)`;
}

function renderStats() {
    const now = new Date();
    const mesKey = `${now.getFullYear()}-${pad0(now.getMonth()+1)}`;
    let diasMes=0, extrasMin=0, faltaMin=0;
    Object.entries(recordsMap).forEach(([key, rec]) => {
        if (!key.startsWith(mesKey) || isFalta(rec)) return;
        const s = calcSaldoMin(rec); if (s === null) return;
        diasMes++; if (s > 0) extrasMin += s; else if (s < 0) faltaMin += Math.abs(s);
    });
    const el_dias=$('stat-dias-mes');    if(el_dias)  el_dias.textContent  = diasMes;
    const el_ext =$('stat-horas-extras');if(el_ext)   el_ext.textContent   = extrasMin?minToStr(extrasMin):'0h 00min';
    const el_flt =$('stat-horas-falta'); if(el_flt)   el_flt.textContent   = faltaMin ?minToStr(faltaMin) :'0h 00min';
    const el_j   =$('stat-jornada');
    if (el_j) { const j=getJornadaMin(); el_j.textContent=j===null?'Autônomo':`${Math.floor(j/60)}h/dia`; }
}

window.renderHistorico = function () {
    const tbody = $('historico-tbody'); if (!tbody) return;
    const fmEl  = $('filter-month');
    const now   = new Date();
    const mesAtual = `${now.getFullYear()}-${pad0(now.getMonth()+1)}`;
    if (fmEl && !fmEl.value) fmEl.value = mesAtual;
    const filtroMes = fmEl?.value || mesAtual;
    const dias = Object.entries(recordsMap).filter(([k]) => k.startsWith(filtroMes)).sort(([a],[b]) => b.localeCompare(a));
    if (!dias.length) {
        tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-calendar-times"></i><p>Nenhum registro em ${filtroMes.replace('-','/')}</p><span>Os registros de ponto aparecerão aqui</span></div></td></tr>`;
        return;
    }
    const jornadaMin = getJornadaMin();
    tbody.innerHTML = dias.map(([key, rec]) => {
        if (isFalta(rec)) return `<tr class="row-falta"><td class="td-date">${fmtDate(key)}<span class="dia-semana">${diaSemana(key)}</span></td><td colspan="4" style="color:var(--text-tertiary);font-style:italic;font-size:.8rem">Sem registros</td><td>—</td><td>—</td><td><span class="badge badge-falta">Falta</span></td></tr>`;
        const worked = calcWorkedMin(rec), saldo = calcSaldoMin(rec);
        const workedStr = rec.saida ? minToStr(worked) : '—';
        let saldoStr='—', saldoCls='zero';
        if (jornadaMin === null) { saldoStr = rec.saida ? minToStr(worked) : '—'; }
        else if (saldo !== null) { saldoStr=(saldo>=0?'+':'-')+minToStr(saldo); saldoCls=saldo>0?'positivo':saldo<0?'negativo':'zero'; }
        const badge = getBadge(rec, saldo);
        const t = (f) => { const v=rec[f]; if(!v)return`<span class="td-time missing">—</span>`; return`<span class="td-time ${rec[f+'_ajustado']?'ajustado':''}">${timeStr(v)}</span>`; };
        return `<tr><td class="td-date">${fmtDate(key)}<span class="dia-semana">${diaSemana(key)}</span></td><td>${t('entrada')}</td><td>${t('saida_almoco')}</td><td>${t('retorno_almoco')}</td><td>${t('saida')}</td><td class="td-total">${workedStr}</td><td class="td-saldo ${saldoCls}">${saldoStr}</td><td><span class="badge ${badge.cls}">${badge.label}</span></td></tr>`;
    }).join('');
};

function getBadge(rec, saldo) {
    if (isFalta(rec))   return { cls:'badge-falta',  label:'Falta' };
    if (rec.ajustado)   return { cls:'badge-ajuste', label:'Ajustado' };
    if (!rec.saida)     return { cls:'badge-ajuste', label:'Incompleto' };
    if (saldo === null) return { cls:'badge-normal', label:'Normal' };
    if (saldo > 0)      return { cls:'badge-extra',  label:'Extra' };
    if (saldo < 0)      return { cls:'badge-falta',  label:'Falta' };
    return { cls:'badge-normal', label:'Normal' };
}

function renderSolicitacoes() {
    const pendentes = adjRequests.filter(a => a.status === 'pendente');
    const section = $('section-solicitacoes'), list = $('solicitacoes-list');
    if (!section || !list) return;
    if (!pendentes.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    const tipoMap = { 'entrada':'Correção de Entrada','saida-almoco':'Correção de Saída p/ Almoço','retorno-almoco':'Correção de Retorno','saida':'Correção de Saída','falta':'Justificativa de Falta' };
    list.innerHTML = pendentes.map(a => `<div class="solicitacao-item"><div class="sol-icon"><i class="fas fa-edit"></i></div><div class="sol-info"><p class="sol-tipo">${tipoMap[a.tipo]||a.tipo}</p><p class="sol-meta">Data: ${a.date}${a.horario?` • Horário: ${a.horario}`:''} • Enviado em ${new Date(a.created_at).toLocaleDateString('pt-BR')}</p></div><span class="badge-pendente"><i class="fas fa-hourglass-half"></i> Pendente</span></div>`).join('');
}

// ─── Burnout ──────────────────────────────────────────────────

const BURNOUT_EXTRAS_MIN = 60, BURNOUT_DIAS_CONSECUTIVOS = 3, BURNOUT_SEMANA_MIN = 5 * 60;

function detectBurnout() {
    const jornadaMin = getJornadaMin();
    const alertas = [];
    const diasEncerrados = Object.entries(recordsMap).filter(([, rec]) => !isFalta(rec) && rec.saida).sort(([a], [b]) => a.localeCompare(b));

    if (jornadaMin !== null) {
        let streak = 0, streakDias = [];
        for (const [key, rec] of diasEncerrados) {
            const s = calcSaldoMin(rec);
            if (s !== null && s >= BURNOUT_EXTRAS_MIN) { streak++; streakDias.push(key); } else { streak = 0; streakDias = []; }
        }
        if (streak >= BURNOUT_DIAS_CONSECUTIVOS) {
            alertas.push({ tipo:'extras_consecutivos', nivel:streak>=5?'critico':'atencao', titulo:`${streak} dias consecutivos com horas extras`, mensagem:`Você acumulou horas extras nos últimos ${streak} dias úteis.`, sugestao:'Priorize sair no horário.', dias:streakDias.slice(-streak).map(fmtDate), streakCount:streak });
        }
    }

    const hoje = todayKey();
    const ultimos7 = diasEncerrados.filter(([k]) => k !== hoje).slice(-7);
    const almocosPulados = ultimos7.filter(([, rec]) => rec.entrada && rec.saida && !rec.saida_almoco);
    if (almocosPulados.length >= 2) {
        alertas.push({ tipo:'almoco_pulado', nivel:almocosPulados.length>=4?'critico':'atencao', titulo:`Horário de almoço não registrado ${almocosPulados.length}x nos últimos 7 dias`, mensagem:'Pausas para almoço são essenciais.', sugestao:'Reserve pelo menos 30 minutos para pausar.', dias:almocosPulados.map(([k])=>fmtDate(k)), count:almocosPulados.length });
    }

    if (jornadaMin !== null) {
        const now = new Date(), diaSemanaNum = now.getDay();
        const inicioSemana = new Date(now); inicioSemana.setDate(now.getDate()-(diaSemanaNum===0?6:diaSemanaNum-1));
        const inicioKey = `${inicioSemana.getFullYear()}-${pad0(inicioSemana.getMonth()+1)}-${pad0(inicioSemana.getDate())}`;
        let extrasSemana = 0;
        diasEncerrados.forEach(([key, rec]) => { if (key < inicioKey) return; const s=calcSaldoMin(rec); if(s!==null&&s>0)extrasSemana+=s; });
        if (extrasSemana >= BURNOUT_SEMANA_MIN) {
            alertas.push({ tipo:'sobrecarga_semanal', nivel:extrasSemana>=8*60?'critico':'atencao', titulo:`${minToStr(extrasSemana)} de extras esta semana`, mensagem:`Você acumulou ${minToStr(extrasSemana)} de horas extras.`, sugestao:'Considere compensar saindo mais cedo.', extrasMin:extrasSemana });
        }
    }
    return alertas;
}

async function notificarRH(alertas) {
    if (!alertas.length) return;
    const hoje = todayKey();
    const { data: existing } = await sb.from('burnout_alerts').select('id').eq('employee_id', myEmployeeId).eq('date', hoje).single();
    if (existing) return;
    await sb.from('burnout_alerts').insert({
        employee_id: myEmployeeId,
        date: hoje,
        alertas: alertas.map(a => ({ tipo:a.tipo, nivel:a.nivel, titulo:a.titulo })),
        lido: false
    });
}

function renderBurnoutCard(alertas) {
    const section = $('section-burnout'); if (!section) return;
    if (!alertas.length) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    const nivelGeral = alertas.some(a => a.nivel === 'critico') ? 'critico' : 'atencao';
    const iconePrincipal = nivelGeral === 'critico' ? 'fa-triangle-exclamation' : 'fa-heart-pulse';
    const tituloPrincipal = nivelGeral === 'critico' ? 'Atenção: Risco de Esgotamento' : 'Sugestão de Descanso';
    const itensHTML = alertas.map(a => {
        const icone = { extras_consecutivos:'fa-clock', almoco_pulado:'fa-bowl-food', sobrecarga_semanal:'fa-chart-line' }[a.tipo] || 'fa-circle-exclamation';
        const diasHTML = a.dias?.length ? `<div class="burnout-dias">${a.dias.map(d=>`<span class="burnout-dia-tag">${d}</span>`).join('')}</div>` : '';
        return `<div class="burnout-item burnout-item--${a.nivel}"><div class="burnout-item-icon"><i class="fas ${icone}"></i></div><div class="burnout-item-body"><p class="burnout-item-titulo">${a.titulo}</p><p class="burnout-item-msg">${a.mensagem}</p>${diasHTML}<p class="burnout-item-sugestao"><i class="fas fa-lightbulb"></i> ${a.sugestao}</p></div></div>`;
    }).join('');
    section.innerHTML = `<div class="burnout-card burnout-card--${nivelGeral}"><div class="burnout-header"><div class="burnout-header-left"><div class="burnout-badge-icon burnout-badge-icon--${nivelGeral}"><i class="fas ${iconePrincipal}"></i></div><div><p class="burnout-titulo">${tituloPrincipal}</p><p class="burnout-subtitulo">${nivelGeral==='critico'?'O RH foi notificado. Cuide-se!':'Identificamos padrões que merecem atenção.'}</p></div></div><button class="burnout-dismiss" onclick="dismissBurnout()" title="Fechar"><i class="fas fa-times"></i></button></div><div class="burnout-items">${itensHTML}</div></div>`;
}

window.dismissBurnout = function () { const s=$('section-burnout'); if(s){s.classList.add('burnout-dismissing');setTimeout(()=>s.classList.add('hidden'),350);} };

function runBurnoutCheck() { const alertas=detectBurnout(); renderBurnoutCard(alertas); notificarRH(alertas); }

// ─── Confirmar registro ───────────────────────────────────────

window.abrirConfirmar = function () {
    const rec  = getTodayRec();
    const step = nextStep(rec);
    if (step === 'encerrado') return;
    pendingStep = step;
    const now  = new Date(), ini = initials(myEmployee.name), color = myEmployee.avatar_color || '#6366f1';
    const av=$('confirmar-avatar'); if(av){av.textContent=ini;av.style.background=color;}
    const nm=$('confirmar-nome');   if(nm)nm.textContent=myEmployee.name||'—';
    const em=$('confirmar-email');  if(em)em.textContent=myEmployee.email;
    const tipoLabels={entrada:'Entrada',saida_almoco:'Saída para Almoço',retorno_almoco:'Retorno do Almoço',saida:'Saída'};
    const tp=$('confirmar-tipo'); if(tp)tp.textContent=tipoLabels[step]||step;
    const da=$('confirmar-data'); if(da)da.textContent=`${pad0(now.getDate())}/${pad0(now.getMonth()+1)}/${now.getFullYear()}`;
    const locEl=$('confirmar-loc');
    if (locEl) {
        if (userCoords) { const d=haversineM(userCoords.lat,userCoords.lng,EMPRESA.lat,EMPRESA.lng); const dentro=d<=EMPRESA.raioM; locEl.textContent=dentro?`Dentro da empresa (~${Math.round(d)} m)`:`Fora da empresa (~${Math.round(d)} m)`; locEl.style.color=dentro?'#10b981':'#ef4444'; }
        else { locEl.textContent='Localização não obtida'; locEl.style.color=''; }
    }
    clearInterval(window._confirmTimer);
    const hr=$('confirmar-hora');
    const tick=()=>{const n=new Date();if(hr)hr.textContent=`${pad0(n.getHours())}:${pad0(n.getMinutes())}:${pad0(n.getSeconds())}`;};
    tick(); window._confirmTimer=setInterval(tick,1000);
    openModal('modal-confirmar');
};

window.confirmarRegistro = async function () {
    if (!pendingStep) return;
    clearInterval(window._confirmTimer);
    closeModal('modal-confirmar');
    const key = todayKey();
    const updateData = { employee_id: myEmployeeId, date: key, [pendingStep]: nowISO() };
    if (userCoords) updateData[`${pendingStep}_loc`] = { lat: userCoords.lat, lng: userCoords.lng };
    const { data: upserted, error } = await sb.from('time_records').upsert(updateData, { onConflict: 'employee_id,date' }).select().single();
    if (error) { showToast('Erro ao registrar ponto.', 'error'); return; }
    recordsMap[key] = upserted;
    await sb.from('activity_logs').insert({ employee_id: myEmployeeId, tipo:'ponto', acao:pendingStep, date:key, valor_registrado:updateData[pendingStep], operator_email:myEmployee.email, operator_name:myEmployee.name, operator_profile:'colaborador' });
    const labels={entrada:'Entrada registrada!',saida_almoco:'Saída para almoço registrada!',retorno_almoco:'Retorno registrado!',saida:'Saída registrada — bom descanso!'};
    showToast(labels[pendingStep]||'Ponto registrado!','success');
    pendingStep = null;
    renderUI();
};

// ─── Ajuste modal ─────────────────────────────────────────────

window.openModalAjuste = function () {
    ['ajuste-data','ajuste-horario','ajuste-justificativa'].forEach(id=>{const el=$(id);if(el)el.value='';});
    const tipo=$('ajuste-tipo');if(tipo)tipo.value='';
    ['err-ajuste-data','err-ajuste-tipo','err-ajuste-horario','err-ajuste-just'].forEach(id=>{const el=$(id);if(el)el.textContent='';});
    const hg=$('ajuste-horario-group');if(hg)hg.classList.remove('hidden');
    openModal('modal-ajuste');
};

window.onAjusteTipoChange = function () { const tipo=$('ajuste-tipo')?.value; const hg=$('ajuste-horario-group'); if(hg)hg.classList.toggle('hidden',tipo==='falta'); };

window.enviarSolicitacao = async function () {
    const data  = $('ajuste-data')?.value.trim()          || '';
    const tipo  = $('ajuste-tipo')?.value                 || '';
    const hor   = $('ajuste-horario')?.value              || '';
    const just  = $('ajuste-justificativa')?.value.trim() || '';
    const isFaltaType = tipo === 'falta';
    let ok = true;
    const setErr=(id,msg)=>{const el=$(id);if(el)el.textContent=msg;if(msg)ok=false;};
    setErr('err-ajuste-data',    data?'':'Informe a data.');
    setErr('err-ajuste-tipo',    tipo?'':'Selecione o tipo.');
    setErr('err-ajuste-horario', (isFaltaType||hor)?'':'Informe o horário correto.');
    setErr('err-ajuste-just',    just?'':'A justificativa é obrigatória.');
    if (!ok) return;

    const { data: inserted, error } = await sb.from('adjustment_requests').insert({
        employee_id: myEmployeeId, date: data, tipo,
        horario: isFaltaType ? null : hor,
        justificativa: just
    }).select().single();

    if (error) { showToast('Erro ao enviar solicitação.', 'error'); return; }
    adjRequests.unshift(inserted);
    closeModal('modal-ajuste');
    showToast('Solicitação enviada! Aguarde aprovação do RH.', 'success');
    renderSolicitacoes();
};

// ─── Geolocalização ───────────────────────────────────────────

function haversineM(lat1, lng1, lat2, lng2) {
    const R=6371000; const φ1=lat1*Math.PI/180, φ2=lat2*Math.PI/180;
    const Δφ=(lat2-lat1)*Math.PI/180, Δλ=(lng2-lng1)*Math.PI/180;
    const a=Math.sin(Δφ/2)**2+Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

window.initLocation = function () {
    const dot=$('loc-dot'), stxt=$('loc-status-text'), locVal=$('map-loc-val'), distVal=$('map-dist-val'), refreshBtn=document.querySelector('.btn-refresh-loc');
    if(dot)dot.className='loc-dot loading'; if(stxt)stxt.textContent='Verificando...'; if(locVal)locVal.textContent='Aguardando permissão...'; if(refreshBtn)refreshBtn.classList.add('spin');
    renderMapStatic(null);
    if (!navigator.geolocation) { if(stxt)stxt.textContent='GPS não disponível'; if(dot)dot.className='loc-dot fora'; if(refreshBtn)refreshBtn.classList.remove('spin'); return; }
    navigator.geolocation.getCurrentPosition(
        pos => {
            userCoords={lat:pos.coords.latitude,lng:pos.coords.longitude};
            const distM=haversineM(userCoords.lat,userCoords.lng,EMPRESA.lat,EMPRESA.lng);
            const dentro=distM<=EMPRESA.raioM;
            if(dot)dot.className=`loc-dot ${dentro?'dentro':'fora'}`; if(stxt)stxt.textContent=dentro?'Dentro da empresa':'Fora da empresa';
            if(locVal)locVal.textContent=`${userCoords.lat.toFixed(5)}, ${userCoords.lng.toFixed(5)}`; if(distVal)distVal.textContent=distM<1000?`${Math.round(distM)} m`:`${(distM/1000).toFixed(1)} km`;
            renderMapStatic(userCoords); if(refreshBtn)refreshBtn.classList.remove('spin');
        },
        err => {
            const msg=err.code===2?'GPS indisponível':err.code===3?'Tempo esgotado':'Localização negada';
            if(dot)dot.className='loc-dot fora'; if(stxt)stxt.textContent=msg; if(locVal)locVal.textContent=msg; if(distVal)distVal.textContent='—';
            renderMapStatic(null); if(refreshBtn)refreshBtn.classList.remove('spin');
        },
        { timeout:10000, maximumAge:30000 }
    );
};

function renderMapStatic(user) {
    const wrap=$('map-svg-wrap'), loading=$('map-loading'), empEl=$('map-empresa-nome');
    if(!wrap)return; if(loading)loading.style.display='none'; if(empEl)empEl.textContent=EMPRESA.nome;
    const W=600,H=220,cx=EMPRESA.lat,cy=EMPRESA.lng,scale=9000;
    const toSVG=(lat,lng)=>({x:(lng-cy)*scale+W/2,y:-(lat-cx)*scale+H/2});
    const emp=toSVG(EMPRESA.lat,EMPRESA.lng),usr=user?toSVG(user.lat,user.lng):null,raioSVG=(EMPRESA.raioM/111000)*scale;
    let grid='';
    for(let i=0;i<8;i++){const x=(i/8)*W,y=(i/8)*H;grid+=`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#dde0e8" stroke-width="1"/><line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#dde0e8" stroke-width="1"/>`;}
    for(let i=0;i<3;i++){const x=((i+1)/4)*W,y=((i+1)/4)*H;grid+=`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#cdd1dc" stroke-width="2.5"/><line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#cdd1dc" stroke-width="2.5"/>`;}
    const rotaLine=usr?`<line x1="${emp.x}" y1="${emp.y}" x2="${usr.x}" y2="${usr.y}" stroke="#6366f1" stroke-width="2" stroke-dasharray="6 4" opacity="0.5"/>`:''
    const empLabel=`<text x="${emp.x}" y="${emp.y-22}" text-anchor="middle" font-size="10" font-family="DM Sans,sans-serif" fill="#6366f1" font-weight="700">${EMPRESA.nome}</text>`;
    const dentro=usr&&haversineM(user.lat,user.lng,EMPRESA.lat,EMPRESA.lng)<=EMPRESA.raioM;
    let usrLabel='';
    if(usr){const uc=dentro?'#10b981':'#ef4444';const ut=dentro?'Você (dentro)':'Você (fora)';usrLabel=`<circle cx="${usr.x}" cy="${usr.y}" r="22" fill="${uc}" opacity="0.12"/><circle cx="${usr.x}" cy="${usr.y}" r="8" fill="${uc}" opacity="0.9"/><circle cx="${usr.x}" cy="${usr.y}" r="4" fill="#fff"/><text x="${usr.x}" y="${usr.y-14}" text-anchor="middle" font-size="10" font-family="DM Sans,sans-serif" fill="${uc}" font-weight="700">${ut}</text>`;}
    wrap.innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"><rect width="${W}" height="${H}" fill="#eef0f5"/>${grid}${rotaLine}<circle cx="${emp.x}" cy="${emp.y}" r="${raioSVG}" fill="rgba(99,102,241,0.07)" stroke="rgba(99,102,241,0.28)" stroke-width="1.5" stroke-dasharray="6 3"/><rect x="${emp.x-14}" y="${emp.y-34}" width="28" height="28" rx="7" fill="#6366f1"/><text x="${emp.x}" y="${emp.y-17}" text-anchor="middle" font-size="14" fill="#fff">🏢</text><polygon points="${emp.x},${emp.y-6} ${emp.x-5},${emp.y-12} ${emp.x+5},${emp.y-12}" fill="#6366f1"/>${empLabel}${usrLabel}<line x1="${W-80}" y1="${H-12}" x2="${W-20}" y2="${H-12}" stroke="#9ca3af" stroke-width="1.5"/><text x="${W-50}" y="${H-16}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="DM Sans,sans-serif">~200m</text></svg>`;
}

// ─── Realtime ─────────────────────────────────────────────────

function setupRealtimeSync() {
    sb.channel('ponto-colab')
        .on('postgres_changes', { event:'*', schema:'public', table:'time_records', filter:`employee_id=eq.${myEmployeeId}` }, async () => {
            await loadData(); renderUI();
        })
        .on('postgres_changes', { event:'*', schema:'public', table:'adjustment_requests', filter:`employee_id=eq.${myEmployeeId}` }, async () => {
            const { data } = await sb.from('adjustment_requests').select('*').eq('employee_id', myEmployeeId).order('created_at', { ascending: false });
            adjRequests = data || [];
            renderSolicitacoes();
        })
        .subscribe();
}

// ─── Modal / Toast helpers ────────────────────────────────────

function openModal(id)  { const el=$(id); if(el){el.classList.add('open');document.body.style.overflow='hidden';} }
window.closeModal = function(id) { const el=$(id); if(el){el.classList.remove('open');document.body.style.overflow='';} if(id==='modal-confirmar')clearInterval(window._confirmTimer); };
function closeAllModals() { document.querySelectorAll('.modal-overlay').forEach(el=>el.classList.remove('open')); document.body.style.overflow=''; clearInterval(window._confirmTimer); }

window.showToast = function (title, type='success') {
    const c=$('toast-container'); if(!c)return;
    const icons={success:'fa-check',error:'fa-times',warning:'fa-exclamation-triangle',info:'fa-info'};
    const t=document.createElement('div'); t.className=`toast toast-${type}`;
    t.innerHTML=`<div class="toast-icon"><i class="fas ${icons[type]||'fa-check'}"></i></div><div class="toast-content"><p class="toast-title">${title}</p></div><button class="toast-close" onclick="this.closest('.toast').classList.add('hide');setTimeout(()=>this.closest('.toast').remove(),300)"><i class="fas fa-times"></i></button>`;
    c.appendChild(t); requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));
    setTimeout(()=>{t.classList.remove('show');t.classList.add('hide');setTimeout(()=>t.remove(),300);},4000);
};

function showToast(msg, type) { window.showToast(msg, type); }
