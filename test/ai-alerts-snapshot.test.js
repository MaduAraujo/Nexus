const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// shapeSnapshot é o que vira o contexto do assistente de IA do RH (ai-alerts): funcionários sem
// registro de ponto recente, admissões novas, férias/ajustes/documentos pendentes com "há quantos
// dias esperando". Extraído de gatherSnapshot para _shared/ai-alerts-snapshot.mjs (mesmo padrão de
// files-core.mjs) — `now` é injetável para os cálculos de dias darem resultado determinístico aqui.
let shapeSnapshot, sevenDaysAgo;
const NOW = new Date('2026-06-15T12:00:00Z').getTime();

before(async () => {
    ({ shapeSnapshot, sevenDaysAgo } = await import('../supabase/functions/_shared/ai-alerts-snapshot.mjs'));
});

describe('sevenDaysAgo', () => {
    test('volta 7 dias e devolve só a data (AAAA-MM-DD)', () => {
        assert.equal(sevenDaysAgo(new Date('2026-06-15T23:00:00Z')), '2026-06-08');
    });
});

describe('shapeSnapshot — colaboradores ativos e departamentos', () => {
    test('conta ativos e lista departamentos sem repetir, ignorando os sem departamento', () => {
        const snap = shapeSnapshot(
            '2026-06-15',
            {
                employees: [
                    { id: 'e1', dept: 'TI' },
                    { id: 'e2', dept: 'TI' },
                    { id: 'e3', dept: 'RH' },
                    { id: 'e4', dept: null },
                ],
            },
            NOW
        );
        assert.equal(snap.active_employees, 4);
        assert.deepEqual(snap.departments.sort(), ['RH', 'TI']);
    });

    test('nenhuma seção quebra quando não vem nenhuma linha (objeto vazio)', () => {
        const snap = shapeSnapshot('2026-06-15', {}, NOW);
        assert.equal(snap.active_employees, 0);
        assert.deepEqual(snap.departments, []);
        assert.deepEqual(snap.pending_vacations, []);
        assert.deepEqual(snap.employees_no_records_last_7days, []);
        assert.deepEqual(snap.new_hires_last_90days, []);
    });
});

describe('shapeSnapshot — quem não bateu ponto nos últimos 7 dias', () => {
    test('funcionário sem nenhum registro no período aparece na lista', () => {
        const snap = shapeSnapshot(
            '2026-06-15',
            {
                employees: [
                    { id: 'e1', name: 'Ana', dept: 'TI' },
                    { id: 'e2', name: 'Bruno', dept: 'RH' },
                ],
                recentRecords: [{ employee_id: 'e1', entrada: '08:00' }],
            },
            NOW
        );
        assert.deepEqual(snap.employees_no_records_last_7days, [{ name: 'Bruno', dept: 'RH' }]);
    });

    test('registro do dia sem entrada (ex.: só saída) não conta como presença', () => {
        const snap = shapeSnapshot(
            '2026-06-15',
            { employees: [{ id: 'e1', name: 'Ana', dept: 'TI' }], recentRecords: [{ employee_id: 'e1', entrada: null }] },
            NOW
        );
        assert.deepEqual(snap.employees_no_records_last_7days, [{ name: 'Ana', dept: 'TI' }]);
    });

    test('departamento ausente vira "N/A"', () => {
        const snap = shapeSnapshot('2026-06-15', { employees: [{ id: 'e1', name: 'Ana', dept: null }], recentRecords: [] }, NOW);
        assert.deepEqual(snap.employees_no_records_last_7days, [{ name: 'Ana', dept: 'N/A' }]);
    });
});

describe('shapeSnapshot — admissões recentes (90 dias)', () => {
    test('admitido há 10 dias entra na lista, com a contagem de dias certa', () => {
        const snap = shapeSnapshot('2026-06-15', { employees: [{ id: 'e1', name: 'Ana', dept: 'TI', admission_date: '2026-06-05' }] }, NOW);
        assert.deepEqual(snap.new_hires_last_90days, [{ name: 'Ana', dept: 'TI', days_at_company: 10 }]);
    });

    test('admitido há mais de 90 dias não entra', () => {
        const snap = shapeSnapshot('2026-06-15', { employees: [{ id: 'e1', name: 'Ana', dept: 'TI', admission_date: '2025-01-01' }] }, NOW);
        assert.deepEqual(snap.new_hires_last_90days, []);
    });

    test('89 dias atrás (dentro da janela de 90) ainda entra', () => {
        const oitentaNoveDiasAtras = new Date(NOW - 89 * 86_400_000).toISOString().slice(0, 10);
        const snap = shapeSnapshot('2026-06-15', { employees: [{ id: 'e1', name: 'Ana', dept: 'TI', admission_date: oitentaNoveDiasAtras }] }, NOW);
        assert.equal(snap.new_hires_last_90days.length, 1);
    });

    test('sem data de admissão não entra (e não quebra)', () => {
        const snap = shapeSnapshot('2026-06-15', { employees: [{ id: 'e1', name: 'Ana', dept: 'TI' }] }, NOW);
        assert.deepEqual(snap.new_hires_last_90days, []);
    });
});

describe('shapeSnapshot — férias, ajustes, burnout e documentos pendentes', () => {
    test('férias pendentes trazem o nome do funcionário e há quantos dias esperam', () => {
        const criadoHa5Dias = new Date(NOW - 5 * 86_400_000).toISOString();
        const snap = shapeSnapshot(
            '2026-06-15',
            {
                pendingVacations: [
                    { id: 'v1', employees: { name: 'Ana' }, start_date: '2026-07-01', end_date: '2026-07-10', days: 10, created_at: criadoHa5Dias },
                ],
            },
            NOW
        );
        assert.deepEqual(snap.pending_vacations, [{ id: 'v1', employee: 'Ana', start: '2026-07-01', end: '2026-07-10', days: 10, waiting_days: 5 }]);
    });

    test('funcionário removido (join nulo) vira "N/A", não quebra', () => {
        const snap = shapeSnapshot('2026-06-15', { pendingVacations: [{ id: 'v1', employees: null, created_at: new Date(NOW).toISOString() }] }, NOW);
        assert.equal(snap.pending_vacations[0].employee, 'N/A');
    });

    test('justificativa de ajuste é cortada em 100 caracteres', () => {
        const longa = 'x'.repeat(150);
        const snap = shapeSnapshot('2026-06-15', { pendingAdjustments: [{ id: 'a1', employees: { name: 'Ana' }, justificativa: longa }] }, NOW);
        assert.equal(snap.pending_adjustments[0].justification.length, 100);
    });

    test('ajuste sem justificativa não quebra (vira string vazia)', () => {
        const snap = shapeSnapshot('2026-06-15', { pendingAdjustments: [{ id: 'a1', employees: { name: 'Ana' } }] }, NOW);
        assert.equal(snap.pending_adjustments[0].justification, '');
    });

    test('alertas de burnout preservam o array de alertas e o nome do funcionário', () => {
        const snap = shapeSnapshot(
            '2026-06-15',
            { burnoutAlerts: [{ id: 'b1', employees: { name: 'Ana' }, date: '2026-06-10', alertas: ['sem-pausa'] }] },
            NOW
        );
        assert.deepEqual(snap.burnout_alerts, [{ id: 'b1', employee: 'Ana', date: '2026-06-10', alerts: ['sem-pausa'] }]);
    });

    test('documentos pendentes trazem funcionário e nome do documento', () => {
        const snap = shapeSnapshot('2026-06-15', { pendingDocs: [{ employees: { name: 'Ana' }, name: 'RG.pdf' }] }, NOW);
        assert.deepEqual(snap.pending_documents, [{ employee: 'Ana', document: 'RG.pdf' }]);
    });
});

describe('shapeSnapshot — memória de decisões recentes', () => {
    test('formata a data em pt-BR e preserva ação/descrição', () => {
        const snap = shapeSnapshot(
            '2026-06-15',
            { decisions: [{ action_type: 'approve_vacation', description: 'Aprovou férias de Ana', created_at: '2026-06-10T00:00:00Z' }] },
            NOW
        );
        assert.equal(snap.recent_decisions[0].action, 'approve_vacation');
        assert.equal(snap.recent_decisions[0].description, 'Aprovou férias de Ana');
        assert.match(snap.recent_decisions[0].date, /^\d{2}\/\d{2}\/\d{4}$/);
    });
});
