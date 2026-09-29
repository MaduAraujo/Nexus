const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const incompleto = {
    id: 'h1',
    employee_id: ANA.id,
    mes: '2026-05',
    mes_formatado: null,
    competencia: '05/2026',
    status: 'pago',
    proventos: null,
    descontos: null,
    total_proventos: null,
    total_descontos: null,
    salario_liquido: null,
};

function client(slips, opts = {}) {
    const c = new FakeSupabase({ user: COLAB_USER, tables: baseTables({ payslips_decrypted: slips }), ...opts });
    Object.assign(
        c.tables.employees_decrypted.find((e) => e.id === ANA.id),
        { role: null, dept: null, contract_type: null, admission_date: null }
    );
    return c;
}

describe('holerite-colaborador.html — bordas', () => {
    test('holerite sem nome do mês, sem itens e sem valores; cadastro incompleto', async () => {
        page = await openPage('holerite-colaborador', { client: client([incompleto]) });
        assert.equal(page.text('.month-card-competencia'), '2026-05');
        assert.equal(page.text('#action-competencia'), '2026-05');
        assert.equal(page.text('#month-select-mobile-popover .select-option'), '2026-05');
        assert.equal(page.text('#doc-cargo'), '—');
        assert.equal(page.text('#doc-dept'), '—');
        assert.equal(page.text('#doc-contrato'), 'CLT');
        assert.equal(page.text('#doc-admissao'), '—');
        assert.match(page.text('#proventos-tbody'), /Nenhum provento/);
        assert.match(page.text('#doc-liquido'), /0,00/);

        await page.click('[data-click="openComparativoModal"]');
        assert.deepEqual(page.plain(page.charts.at(-1).data.labels), ['2026-05']);
        assert.deepEqual(page.plain(page.charts.at(-1).data.datasets[0].data), [0]);

        await page.click('[data-click="openInformeModal"]');
        assert.match(page.text('#informe-content'), /2026-05/);
        assert.match(page.text('#informe-content'), /INSS retido R\$\s*0,00/);
        await page.click('[data-click="printInforme"]');
        assert.equal(page.text('#informe-print-cargo'), '—');
        assert.equal(page.text('#informe-print-dept'), '—');
        assert.match(page.text('#informe-print-tbody'), /2026-05/);
    });

    test('item com referência vazia e item de desconto sem valor', async () => {
        const slip = {
            ...incompleto,
            mes_formatado: 'Maio 2026',
            proventos: [{ cod: '001', descricao: 'Base', referencia: null, valor: 100 }],
            descontos: [{ cod: '901', descricao: 'INSS', referencia: '9%', valor: null }],
        };
        page = await openPage('holerite-colaborador', { client: client([slip, { ...incompleto, id: 'h13', mes: '2026-13-1', mes_formatado: '13º 2026' }]) });
        await page.click('#month-list .month-card[data-id="h1"]');
        assert.match(page.text('#proventos-tbody'), /001 Base 100,00/);
        await page.click('[data-click="openInformeModal"]');
        assert.match(page.text('#informe-content'), /INSS retido R\$\s*0,00/);
    });

    test('falha ao ler os holerites mostra o vazio; o informe usa o ano atual e imprimir sem dados não faz nada', async () => {
        page = await openPage('holerite-colaborador', {
            client: client([], { errors: { payslips_decrypted: { message: 'x' } } }),
            now: '2026-06-17T10:00:00-03:00',
        });
        assert.match(page.text('#month-list'), /Nenhum holerite/);
        page.eval('printInforme()');
        assert.equal(page.document.body.classList.contains('printing-informe'), false);
        page.eval('printPayslip()');
        assert.equal(page.$('#print-orientation-modal').classList.contains('open'), false);
        page.eval('selectPayslipById("nao-existe")');
        await page.click('[data-click="openInformeModal"]');
        assert.equal(page.text('#informe-year-text'), '2026');
    });

    test('sem a biblioteca de gráficos o comparativo não quebra', async () => {
        page = await openPage('holerite-colaborador', {
            client: client([incompleto]),
            before(w) {
                delete w.Chart;
            },
        });
        await page.click('[data-click="openComparativoModal"]');
        assert.equal(page.pageErrors.length, 0);
    });

    test('seletores: clicar de novo fecha e clicar numa área vazia da lista não escolhe nada', async () => {
        page = await openPage('holerite-colaborador', { client: client([incompleto, { ...incompleto, id: 'h2', mes: '2025-04' }]) });
        const trigger = page.$('#month-select-mobile-trigger');
        await page.click(trigger);
        await page.click('#month-select-mobile-popover');
        assert.ok(page.$('#month-select-mobile-popover').classList.contains('open'));
        await page.click(trigger);
        assert.equal(page.$('#month-select-mobile-popover').classList.contains('open'), false);

        await page.click('[data-click="openInformeModal"]');
        await page.click('#informe-year-trigger');
        await page.click('#informe-year-popover');
        assert.ok(page.$('#informe-year-popover').classList.contains('open'));
        await page.click('#informe-year-trigger');
        assert.equal(page.$('#informe-year-popover').classList.contains('open'), false);
    });
});
