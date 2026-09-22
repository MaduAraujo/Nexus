// Molda o snapshot que vira contexto do assistente de IA do RH (ai-alerts) a partir das linhas já
// buscadas do banco — sem chamada de rede aqui, só a transformação. `now` é injetável para os
// cálculos de "há quantos dias" (waiting_days, days_at_company) darem resultado determinístico em teste.

const DAY_MS = 86_400_000;
const NEW_HIRE_WINDOW_DAYS = 90;

export function shapeSnapshot(today, rows, now = Date.now()) {
    const { employees = [], pendingVacations = [], pendingAdjustments = [], burnoutAlerts = [], pendingDocs = [], recentRecords = [], decisions = [] } = rows;

    const presentIds = new Set(recentRecords.filter((r) => r.entrada).map((r) => r.employee_id));
    const noRecentRecords = employees.filter((e) => !presentIds.has(e.id)).map((e) => ({ name: e.name, dept: e.dept ?? 'N/A' }));

    const newHires = employees
        .filter((e) => e.admission_date && now - new Date(e.admission_date + 'T00:00:00').getTime() <= NEW_HIRE_WINDOW_DAYS * DAY_MS)
        .map((e) => ({
            name: e.name,
            dept: e.dept ?? 'N/A',
            days_at_company: Math.floor((now - new Date(e.admission_date + 'T00:00:00').getTime()) / DAY_MS),
        }));

    return {
        date: today,
        active_employees: employees.length,
        departments: [...new Set(employees.map((e) => e.dept).filter(Boolean))],
        pending_vacations: pendingVacations.map((v) => ({
            id: v.id,
            employee: v.employees?.name ?? 'N/A',
            start: v.start_date,
            end: v.end_date,
            days: v.days,
            waiting_days: Math.floor((now - new Date(v.created_at).getTime()) / DAY_MS),
        })),
        pending_adjustments: pendingAdjustments.map((a) => ({
            id: a.id,
            employee: a.employees?.name ?? 'N/A',
            date: a.date,
            type: a.tipo,
            justification: String(a.justificativa ?? '').substring(0, 100),
        })),
        burnout_alerts: burnoutAlerts.map((b) => ({
            id: b.id,
            employee: b.employees?.name ?? 'N/A',
            date: b.date,
            alerts: b.alertas,
        })),
        pending_documents: pendingDocs.map((d) => ({ employee: d.employees?.name ?? 'N/A', document: d.name })),
        employees_no_records_last_7days: noRecentRecords,
        new_hires_last_90days: newHires,
        recent_decisions: decisions.map((d) => ({
            action: d.action_type,
            description: d.description,
            date: new Date(d.created_at).toLocaleDateString('pt-BR'),
        })),
    };
}

// Janela usada para consultar time_records: de 7 dias atrás até hoje, no formato AAAA-MM-DD do Postgres.
export function sevenDaysAgo(today = new Date()) {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
}
