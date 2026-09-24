const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const slip = (id, employee_id, mes, mes_formatado, status, liquido, extra = {}) => ({
    id,
    employee_id,
    mes,
    mes_formatado,
    competencia: mes.slice(5, 7) + '/' + mes.slice(0, 4),
    status,
    proventos: [{ cod: '001', descricao: 'Salário Base', referencia: '30 dias', valor: 4000 }],
    descontos: [
        { cod: '901', descricao: 'INSS', referencia: '9%', valor: 360 },
        { cod: '902', descricao: 'IRRF', referencia: 'Tabela', valor: 100 },
    ],
    total_proventos: 4000,
    total_descontos: 460,
    salario_liquido: liquido,
    ...extra,
});

const SLIPS = [
    slip('p1', ANA.id, '2026-05', 'Maio 2026', 'pago', 3540),
    slip('p2', ANA.id, '2026-06', 'Junho 2026', 'pago', 3540),
    slip('p3', ANA.id, '2026-07', 'Julho 2026', 'rascunho', 3540),
    slip('p4', ANA.id, '2025-12-13-2', '13º Salário — 2ª Parcela 2025', 'publicado', 1900, {
        mes: '2025-13-2',
        competencia: '13/2025',
        proventos: [{ cod: '031', descricao: '13º Salário (2ª Parcela)', referencia: '12/12', valor: 2000 }],
        descontos: [{ cod: '901', descricao: 'INSS sobre 13º', referencia: 'Tabela', valor: 100 }],
        total_proventos: 2000,
        total_descontos: 100,
    }),
    slip('x1', BIA.id, '2026-06', 'Junho 2026', 'pago', 7000),
];

function client() {
    return new FakeSupabase({ user: COLAB_USER, tables: baseTables({ payslips_decrypted: SLIPS }) });
}

describe('holerite-colaborador.html', () => {
    test('lista só os próprios holerites pagos ou publicados (inclusive o 13º), mais recente primeiro', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        const meses = page.$$('#month-list .month-card').map((c) => c.querySelector('.month-card-competencia').textContent);
        assert.deepEqual(meses, ['Junho 2026', 'Maio 2026', '13º Salário — 2ª Parcela 2025']);
        assert.equal(page.text('#month-count-badge'), '3');
    });

    test('abre o mais recente com proventos, descontos e líquido', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        assert.equal(page.text('#doc-competencia'), 'Competência: 06/2026');
        assert.equal(page.text('#doc-name'), 'Ana Souza');
        assert.match(page.text('#proventos-tbody'), /001 Salário Base 30 dias 4\.000,00/);
        assert.match(page.text('#descontos-tbody'), /901 INSS.*902 IRRF/);
        assert.match(page.text('#doc-liquido'), /3\.540,00/);
        assert.match(page.text('.payslip-status-badge'), /Pago/);
    });

    test('trocar de competência mostra o holerite escolhido; o 13º aparece como Publicado', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        await page.click(page.$('#month-list .month-card[data-id="p4"]'));
        assert.equal(page.text('#doc-competencia'), 'Competência: 13/2025');
        assert.match(page.text('#proventos-tbody'), /13º Salário \(2ª Parcela\)/);
        assert.match(page.text('.payslip-status-badge'), /Publicado/);
        assert.ok(page.$('#month-list .month-card[data-id="p4"]').classList.contains('active'));
    });

    test('informe de rendimentos soma o ano: brutos, INSS e IRRF retidos', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        await page.click('[data-click="openInformeModal"]');
        assert.equal(page.$('#informe-year-select').value, '2026');
        const t = page.text('#informe-content');
        assert.match(t, /Rendimentos brutos\s*R\$\s*8\.000,00/);
        assert.match(t, /INSS retido\s*R\$\s*720,00/);
        assert.match(t, /IRRF retido\s*R\$\s*200,00/);
        await page.click('#informe-year-trigger');
        await page.click('#informe-year-popover .select-option[data-value="2025"]');
        assert.match(page.text('#informe-content'), /Rendimentos brutos\s*R\$\s*2\.000,00/);
    });

    test('comparativo desenha o gráfico do líquido', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        await page.click('[data-click="openComparativoModal"]');
        assert.equal(page.charts.length, 1, `gráficos: ${page.charts.length}; erros: ${page.pageErrors}`);
        const chart = page.charts.at(-1);
        assert.deepEqual(page.plain(chart.data.datasets[0].data), [1900, 3540, 3540]);
    });

    test('sem holerites mostra o estado vazio', async () => {
        page = await openPage('holerite-colaborador', { client: new FakeSupabase({ user: COLAB_USER, tables: baseTables({ payslips_decrypted: [] }) }) });
        assert.match(page.text('#month-list'), /Nenhum holerite disponível/);
        assert.equal(page.visible('#payslip-wrap'), false);
    });

    test('imprimir o informe', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        await page.click('[data-click="openInformeModal"]');
        await page.click('[data-click="printInforme"]');
        await page.waitFor(() => page.printed === 1);
        assert.equal(page.text('#informe-print-name'), 'Ana Souza');
    });
});
