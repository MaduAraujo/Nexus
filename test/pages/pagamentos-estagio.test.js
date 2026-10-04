const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-07-20T10:00:00-03:00';

function rhClient(vacations) {
    const tables = baseTables({
        payslips: [],
        payslips_decrypted: [],
        time_records: [],
        holidays: [],
        adjustment_requests: [],
        bank_adjustments: [],
        documents: [],
        employee_audit: [],
        vacations,
    });
    tables.employees_decrypted.forEach((e) => {
        e.status = e.status || 'Ativo';
        if (e.id === ANA.id)
            Object.assign(e, { contract_type: 'Estágio', work_load: '30h', salary: 1200, admission_date: '2025-01-10', contract_end_date: '2026-12-31' });
    });
    return new FakeSupabase({ user: RH_USER, tables });
}

async function calcular(p) {
    await p.click('[data-click="openRescisaoModal"]');
    await p.click('#rescisao-emp-trigger');
    await p.click(`#rescisao-emp-popover .select-option[data-value="${ANA.id}"]`);
    p.window.setRescisaoDate('2026-02-09');
    await p.click('#btn-calcular-rescisao');
}

describe('pagamentos.html — encerramento de estágio (Lei 11.788/2008)', () => {
    test('recesso de ano completo não gozado entra no desligamento, descontando só o recesso aprovado ou concluído', async () => {
        const client = rhClient([
            { id: 'v1', employee_id: ANA.id, start_date: '2025-12-01', end_date: '2025-12-10', days: 10, status: 'concluido' },
            { id: 'v2', employee_id: ANA.id, start_date: '2026-01-05', end_date: '2026-01-09', days: 5, status: 'recusado' },
            { id: 'v3', employee_id: ANA.id, start_date: '2026-03-01', end_date: '2026-03-05', days: 5, status: 'aprovado' },
        ]);
        page = await openPage('pagamentos', { client, now: NOW });
        await calcular(page);
        const texto = page.text('#rescisao-result');
        assert.match(texto, /Recesso devido no período: 33 dia\(s\), já gozados 10/);
        assert.match(texto, /Recesso Proporcional \(Lei 11\.788 art\. 13\)\s*23/);
        assert.match(texto, /termo de realização do estágio/);
        assert.doesNotMatch(texto.split('Verbas Rescisórias')[1], /FGTS|13º|Aviso Prévio/);
    });

    test('sem recesso registrado, a lista vazia do banco conta como zero gozado', async () => {
        page = await openPage('pagamentos', { client: rhClient(null), now: NOW });
        await calcular(page);
        assert.match(page.text('#rescisao-result'), /Recesso devido no período: 33 dia\(s\), já gozados 0/);
    });
});
