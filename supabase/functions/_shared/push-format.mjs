// Lógica pura compartilhada pelas três Edge Functions de push (send-alert-push, send-document-push,
// send-push): texto/título da notificação, quem deve recebê-la e quando uma inscrição está morta.
// Sem chamadas de rede nem Deno.* — só transformação de dados, testável a partir do Node.

export const SECURITY_PUSH_BODY = {
    login_failures: 'Várias tentativas de login falhas em uma conta.',
    login_after_failures: 'Login concluído logo depois de várias falhas.',
    mass_export: 'Volume incomum de exportações de dados.',
    mass_download: 'Volume incomum de downloads de arquivos.',
    off_hours_access: 'Acesso ao painel fora do horário comercial.',
};

export function securityAlertBody(kind) {
    return SECURITY_PUSH_BODY[kind] ?? 'Comportamento incomum detectado.';
}

// compliance_alerts/burnout_alerts guardam uma lista de alertas (`alertas: [{titulo, ...}]`); o corpo
// do push mostra o primeiro título e, se houver mais de um, quantos ficaram de fora.
export function alertNotificationBody(alertas, fallbackTitle) {
    const list = alertas || [];
    const first = list[0]?.titulo || fallbackTitle;
    return list.length > 1 ? `${first} (+${list.length - 1})` : first;
}

// web-push sinaliza inscrição morta (usuário revogou a permissão, trocou de navegador etc.) com 404
// ou 410 — é quando vale remover do banco em vez de tentar de novo.
export function isStalePushError(err) {
    const statusCode = err?.statusCode;
    return statusCode === 404 || statusCode === 410;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidDocumentIds(ids, maxCount) {
    return Array.isArray(ids) && ids.length > 0 && ids.length <= maxCount && ids.every((id) => typeof id === 'string' && UUID_RE.test(id));
}

// Agrupa documentos por colaborador: quantos tipos e quantos ainda precisam de assinatura — é o que
// decide o título/corpo do push (ver documentPushMessage).
export function groupDocumentsByEmployee(docs) {
    const byEmployee = new Map();
    for (const d of docs) {
        const entry = byEmployee.get(d.employee_id) ?? { tipos: [], toSign: 0 };
        entry.tipos.push(d.tipo);
        if (d.requer_assinatura) entry.toSign++;
        byEmployee.set(d.employee_id, entry);
    }
    return byEmployee;
}

export function documentPushMessage(entry) {
    const n = entry.tipos.length;
    return {
        title: entry.toSign ? 'Documento para assinar' : 'Novo documento do RH',
        body: n === 1 ? entry.tipos[0] : `${n} documentos: ${entry.tipos.slice(0, 3).join(', ')}${n > 3 ? '…' : ''}`,
    };
}

// Cada colaborador escolhe quais tipos de notificação recebe (notif_prefs); ausência de preferência
// (undefined) é tratada como permitido — só `false` explícito bloqueia.
export function filterEmployeeIdsByPref(employees, prefKey) {
    return (employees ?? []).filter((e) => e.notif_prefs?.[prefKey] !== false).map((e) => e.id);
}

// Comunicados são HTML sanitizado; o push mostra só o texto, cortado em maxLen caracteres.
export function plainTextPreview(html, maxLen = 140) {
    const plain = String(html ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;
}
