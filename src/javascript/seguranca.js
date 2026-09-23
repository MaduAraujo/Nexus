const RULE_LABEL = {
    login_failures: 'Logins falhos em série',
    login_after_failures: 'Login após várias falhas',
    mass_export: 'Exportações em massa',
    mass_download: 'Downloads em massa',
    off_hours_access: 'Acesso fora do horário',
    mfa_recovery_used: 'Código de recuperação do MFA usado',
};

const SEVERITY_LABEL = { critical: 'Crítico', warning: 'Atenção', info: 'Info' };

const RULE_ICON = {
    login_failures: 'fa-user-lock',
    login_after_failures: 'fa-key',
    mass_export: 'fa-file-export',
    mass_download: 'fa-download',
    off_hours_access: 'fa-moon',
    mfa_recovery_used: 'fa-life-ring',
};

function ruleSummary(rule) {
    const p = rule.params || {};
    switch (rule.kind) {
        case 'login_failures':
            return `${rule.threshold} falhas em ${rule.window_minutes} min na mesma conta`;
        case 'login_after_failures':
            return `login concluído após ${rule.threshold} ou mais falhas em ${rule.window_minutes} min`;
        case 'mass_export': {
            const rows = rule.threshold_rows ? ` ou ${rule.threshold_rows} registros` : '';
            return `${rule.threshold} exportações${rows} em ${rule.window_minutes} min`;
        }
        case 'mass_download':
            return `${rule.threshold} arquivos baixados em ${rule.window_minutes} min`;
        case 'off_hours_access': {
            const days = p.weekdays_only === false ? 'todos os dias' : 'dias úteis';
            return `fora de ${p.start_hour ?? 8}h–${p.end_hour ?? 18}h, ${days} (${(p.profiles || []).join(', ') || 'todos os perfis'})`;
        }
        case 'mfa_recovery_used':
            return 'sempre que alguém entra com um código de recuperação no lugar do app autenticador';
        default:
            return '';
    }
}

function formatWhen(iso, now = new Date()) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diffMin = Math.round((now - d) / 60000);
    if (diffMin < 1) return 'agora há pouco';
    if (diffMin < 60) return `há ${diffMin} min`;
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

function renderAlerts(container, alerts) {
    container.replaceChildren();
    if (!alerts.length) {
        container.appendChild(el('p', 'sec-empty', 'Nenhum comportamento anormal detectado até agora.'));
        return;
    }
    for (const a of alerts) {
        const item = el('div', `sec-alert sev-${a.severity}${a.lido ? ' is-read' : ''}`);
        const icon = el('i', `fas ${RULE_ICON[a.kind] || 'fa-shield-alt'} sec-alert-icon`);
        icon.setAttribute('aria-hidden', 'true');
        const body = el('div', 'sec-alert-body');
        const head = el('div', 'sec-alert-head');
        head.appendChild(el('span', 'sec-alert-title', a.title));
        head.appendChild(el('span', 'sec-sev', SEVERITY_LABEL[a.severity] || a.severity));
        body.appendChild(head);
        body.appendChild(el('p', 'sec-alert-msg', a.message));
        body.appendChild(el('span', 'sec-alert-when', `${RULE_LABEL[a.kind] || a.kind} · ${formatWhen(a.created_at)}`));
        item.appendChild(icon);
        item.appendChild(body);
        container.appendChild(item);
    }
}

function renderRules(container, rules) {
    container.replaceChildren();
    for (const r of rules) {
        const row = el('div', 'sec-rule');
        row.appendChild(el('span', 'sec-rule-name', RULE_LABEL[r.kind] || r.kind));
        row.appendChild(el('span', 'sec-rule-desc', ruleSummary(r)));
        row.appendChild(el('span', `sec-rule-state${r.enabled ? ' on' : ''}`, r.enabled ? 'Ativa' : 'Desligada'));
        container.appendChild(row);
    }
}

async function loadSecurityAlerts() {
    const list = document.getElementById('sec-alerts');
    const rulesBox = document.getElementById('sec-rules');
    const markAll = document.getElementById('sec-mark-read');

    const [alertsRes, rulesRes] = await Promise.all([
        sb.from('security_alerts').select('id, kind, severity, title, message, lido, created_at').order('created_at', { ascending: false }).limit(50),
        sb.from('security_rules').select('kind, enabled, threshold, threshold_rows, window_minutes, params').order('kind'),
    ]);

    if (alertsRes.error) {
        list.replaceChildren(el('p', 'sec-empty', 'Não foi possível carregar os alertas agora.'));
    } else {
        const alerts = alertsRes.data || [];
        renderAlerts(list, alerts);
        const unread = alerts.filter((a) => !a.lido).map((a) => a.id);
        markAll.hidden = unread.length === 0;
        markAll.textContent = `Marcar ${unread.length} como lida${unread.length === 1 ? '' : 's'}`;
        markAll.onclick = async () => {
            markAll.disabled = true;
            const { error } = await sb.rpc('mark_security_alerts_read', { p_ids: unread });
            markAll.disabled = false;
            if (!error) loadSecurityAlerts();
        };
    }

    if (!rulesRes.error) renderRules(rulesBox, rulesRes.data || []);
}

const SELFIE_COLUMNS = ['entrada_selfie_path', 'saida_almoco_selfie_path', 'retorno_almoco_selfie_path', 'saida_selfie_path'];

async function filesToProtect() {
    const [docs, leaves, records] = await Promise.all([
        sb.from('documents').select('employee_id, storage_path').not('storage_path', 'is', null),
        sb.from('medical_leaves').select('employee_id, storage_path').not('storage_path', 'is', null),
        sb.from('time_records').select(`employee_id, ${SELFIE_COLUMNS.join(', ')}`),
    ]);
    const items = new Map();
    for (const d of [...(docs.data || []), ...(leaves.data || [])])
        items.set(`documents/${d.storage_path}`, { bucket: 'documents', path: d.storage_path, employeeId: d.employee_id });
    for (const r of records.data || []) {
        for (const col of SELFIE_COLUMNS)
            if (r[col]) items.set(`ponto-selfies/${r[col]}`, { bucket: 'ponto-selfies', path: r[col], employeeId: r.employee_id });
    }
    return [...items.values()];
}

const MIGRATION_LABEL = {
    migrated: 'migrados',
    repaired: 'recompartilhados com chave nova',
    already: 'já estavam protegidos',
    'no-keys': 'aguardam o primeiro acesso do colaborador',
    missing: 'não encontrados no Storage',
    failed: 'falharam',
};

async function migrateFiles(box, btn) {
    btn.disabled = true;
    const progress = el('p', 'e2e-progress', 'Levantando arquivos…');
    box.append(progress);
    const items = await filesToProtect();
    const totals = {};
    for (const [i, item] of items.entries()) {
        progress.textContent = `Protegendo ${i + 1} de ${items.length}…`;
        const result = await NexusFiles.migrateToEndToEnd(item.bucket, item.path, item.employeeId).catch(() => 'failed');
        totals[result] = (totals[result] || 0) + 1;
    }
    const summary = Object.entries(totals)
        .map(([k, n]) => `${n} ${MIGRATION_LABEL[k] || k}`)
        .join(' · ');
    progress.textContent = items.length ? `Concluído: ${summary}.` : 'Nenhum arquivo para proteger.';
    btn.disabled = false;
}

async function renderEndToEnd() {
    const box = document.getElementById('e2e-card');
    if (!box) return;
    box.replaceChildren(el('p', 'e2e-progress', 'Verificando chaves…'));
    const identity = await NexusE2E.ensureUnlocked();
    const state = await NexusE2E.status();
    box.replaceChildren();

    if (!state.registered) {
        box.append(
            el('p', 'e2e-status-warn', 'Suas chaves de ponta a ponta ainda não foram criadas. Com a verificação em duas etapas ativa, saia e entre de novo.')
        );
        return;
    }
    if (!identity) {
        const unlock = el('button', 'sec-btn', 'Desbloquear');
        unlock.type = 'button';
        unlock.addEventListener('click', renderEndToEnd);
        const row = el('div', 'e2e-status-row');
        row.append(el('span', 'e2e-status-warn', 'Chaves de ponta a ponta bloqueadas neste navegador.'), unlock);
        box.append(row);
        return;
    }
    if (!state.org) {
        box.append(
            el('p', 'e2e-status-warn', 'Esta conta ainda não recebeu a chave do RH. Peça a outro administrador que abra esta tela para liberar o acesso.')
        );
        return;
    }

    const granted = await NexusE2E.grantPendingAdmins().catch(() => 0);
    if (granted) box.append(el('p', null, `${granted} administrador(es) receberam acesso à chave do RH agora.`));

    const migrate = el('button', 'sec-btn', 'Proteger arquivos antigos');
    migrate.type = 'button';
    migrate.addEventListener('click', () => migrateFiles(box, migrate));
    const row = el('div', 'e2e-status-row');
    row.append(el('span', null, 'Arquivos enviados antes da criptografia de ponta a ponta continuam com a cifragem do servidor até serem migrados.'), migrate);
    box.append(row);
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', async () => {
        const auth = await NexusAuth.requireProfile('Administrador', undefined, { allowMfaSetup: true });
        if (!auth) return;

        NexusMfaSetup.mount(document.getElementById('mfa-card'), {
            client: sb,
            required: NexusMfa.isRequiredFor(auth.profile.profile),
        });

        loadSecurityAlerts();
        renderEndToEnd();
    });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ruleSummary, formatWhen, RULE_LABEL };
