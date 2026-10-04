const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-07-20T10:00:00-03:00';

function rhClient({ contractEndDate = '2027-01-31' } = {}) {
    const tables = baseTables({
        payslips: [],
        payslips_decrypted: [],
        time_records: [],
        holidays: [],
        adjustment_requests: [],
        bank_adjustments: [],
        documents: [],
        employee_audit: [],
        vacations: [],
    });
    tables.employees_decrypted.forEach((e) => {
        e.status = e.status || 'Ativo';
        if (e.id === ANA.id)
            Object.assign(e, { contract_type: 'Aprendiz', work_load: '30h', salary: 1200, admission_date: '2025-02-01', contract_end_date: contractEndDate });
    });
    return new FakeSupabase({ user: RH_USER, tables });
}

async function escolher(p, empId) {
    await p.click('#rescisao-emp-trigger');
    await p.click(`#rescisao-emp-popover .select-option[data-value="${empId}"]`);
}

const titulos = (p) => p.$$('#rescisao-tipo-toggle .type-toggle-card').map((c) => c.dataset.tipo);

describe('pagamentos.html — rescisão do aprendiz (CLT art. 433)', () => {
    test('aprendiz troca as opções para as hipóteses do art. 433 e volta ao padrão para CLT', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        assert.equal(page.$('#rescisao-aprendiz-hint').classList.contains('hidden'), true);
        await escolher(page, ANA.id);
        assert.deepEqual(titulos(page), [
            'aprendiz_termino',
            'aprendiz_desempenho',
            'aprendiz_falta_grave',
            'aprendiz_ausencia_escolar',
            'aprendiz_pedido',
            'aprendiz_sem_justa_causa',
        ]);
        assert.equal(page.$('#rescisao-tipo').value, 'aprendiz_termino');
        assert.equal(page.visible('#rescisao-aprendiz-hint'), true);
        await escolher(page, ANA.id);
        assert.equal(page.$('#rescisao-tipo').value, 'aprendiz_termino');
        await escolher(page, BIA.id);
        assert.deepEqual(titulos(page), ['sem_justa_causa', 'pedido_demissao', 'acordo_mutuo', 'justa_causa']);
        assert.equal(page.$('#rescisao-tipo').value, 'sem_justa_causa');
    });

    test('dispensa antecipada usa o término do cadastro para a indenização do art. 479', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await escolher(page, ANA.id);
        await page.click('#rescisao-tipo-toggle [data-tipo="aprendiz_sem_justa_causa"]');
        page.window.setRescisaoDate('2026-07-31');
        await page.click('#btn-calcular-rescisao');
        assert.match(page.text('#rescisao-result'), /Indenização art\. 479 CLT/);
        assert.match(page.text('#rescisao-result'), /Multa de 40% sobre FGTS/);
        assert.doesNotMatch(page.text('#rescisao-result'), /sem data de término/);
    });

    test('sem término no cadastro avisa que a indenização não foi calculada', async () => {
        page = await openPage('pagamentos', { client: rhClient({ contractEndDate: null }), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await escolher(page, ANA.id);
        await page.click('#rescisao-tipo-toggle [data-tipo="aprendiz_sem_justa_causa"]');
        page.window.setRescisaoDate('2026-07-31');
        await page.click('#btn-calcular-rescisao');
        assert.match(page.text('#rescisao-result'), /sem data de término no cadastro/);
    });

    test('reabrir o modal depois de um aprendiz volta às opções da CLT', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await escolher(page, ANA.id);
        page.window.closeModal?.('rescisao-modal');
        await page.click('[data-click="openRescisaoModal"]');
        assert.deepEqual(titulos(page), ['sem_justa_causa', 'pedido_demissao', 'acordo_mutuo', 'justa_causa']);
    });
});
