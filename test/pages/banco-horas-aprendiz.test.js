const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const dia = (date, saida) => ({
    id: `tr-${date}`,
    employee_id: ANA.id,
    date,
    entrada: `${date}T08:00:00-03:00`,
    saida_almoco: `${date}T12:00:00-03:00`,
    retorno_almoco: `${date}T13:00:00-03:00`,
    saida: `${date}T${saida}:00-03:00`,
});

function client() {
    const tables = baseTables({
        time_records: [dia('2026-06-15', '15:30'), dia('2026-06-16', '15:05')],
        bank_adjustments: [],
        bank_requests: [],
        holidays: [],
        vacations: [],
        hr_settings: [{ id: 1, banco_horas_vencimento_meses: 6, limite_extra_diario_min: 120 }],
        activity_logs: [],
    });
    tables.employees_decrypted.forEach((e) => {
        if (e.id === ANA.id) Object.assign(e, { contract_type: 'Aprendiz', work_load: '30h', salary: 1200 });
        e.contractType = e.contract_type;
        e.managerId = e.manager_id;
    });
    return new FakeSupabase({ user: RH_USER, tables });
}

const rowOf = (p, name) => p.$$('#banco-tbody tr').find((tr) => tr.textContent.includes(name));
const linhaDoDia = (p, ddmm) => p.$$('#detail-body .detail-table tbody tr').find((tr) => tr.textContent.startsWith(ddmm));

describe('banco-horas-rh.html — aprendiz (CLT art. 432)', () => {
    test('passar da jornada além da tolerância aparece como extra proibida; dentro dos 10 min é só extra', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        assert.match(page.text(linhaDoDia(page, '15/06')), /\+0h 30min Extra proibida/);
        assert.match(linhaDoDia(page, '15/06').querySelector('.badge-sm-excesso').title, /Aprendiz não pode fazer hora extra/);
        assert.match(page.text(linhaDoDia(page, '16/06')), /\+0h 05min Extra/);
        assert.doesNotMatch(page.text(linhaDoDia(page, '16/06')), /proibida/);
    });

    test('o RH não lança crédito nem débito no banco de horas de aprendiz', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openAdjustModal"]'));
        await page.fill('#adjust-horas', '1');
        await page.fill('#adjust-just', 'Compensar sábado');
        await page.click('#adjust-submit-btn');
        assert.match(page.text('#adjust-alert'), /Aprendiz não tem banco de horas/);
        assert.equal(c.writes('bank_requests', 'insert').length, 0);
        assert.equal(c.writes('bank_adjustments', 'insert').length, 0);
    });
});
