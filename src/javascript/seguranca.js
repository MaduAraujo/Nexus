const RULE_LABEL = {
    login_failures: 'Logins falhos em série',
    login_after_failures: 'Login após várias falhas',
    mass_export: 'Exportações em massa',
    mass_download: 'Downloads em massa',
    off_hours_access: 'Acesso fora do horário',
};

const SEVERITY_LABEL = { critical: 'Crítico', warning: 'Atenção', info: 'Info' };

const RULE_ICON = {
    login_failures: 'fa-user-lock',
    login_after_failures: 'fa-key',
    mass_export: 'fa-file-export',
    mass_download: 'fa-download',
    off_hours_access: 'fa-moon',
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

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', async () => {
        const auth = await NexusAuth.requireProfile('Administrador', undefined, { allowMfaSetup: true });
        if (!auth) return;

        NexusMfaSetup.mount(document.getElementById('mfa-card'), {
            client: sb,
            required: NexusMfa.isRequiredFor(auth.profile.profile),
        });

        loadSecurityAlerts();
    });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ruleSummary, formatWhen, RULE_LABEL };
