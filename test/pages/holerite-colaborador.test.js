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

    test('informe: IRRF de férias (recibo próprio) entra nos retidos e o 13º aparece em quadro separado', async () => {
        const recibo = slip('rf', ANA.id, '2026-07-F06', 'Recibo de Férias — gozo a partir de 06/07/2026', 'pago', 3000, {
            proventos: [{ cod: '040', descricao: 'Férias', referencia: '20 dias', valor: 2666.67 }],
            descontos: [
                { cod: '901', descricao: 'INSS sobre férias', referencia: '20 dias', valor: 240, competencia: '2026-07', base: 3555.56 },
                { cod: '906', descricao: 'IRRF sobre férias', referencia: 'Tabela', valor: 55 },
            ],
            total_proventos: 3555.56,
            total_descontos: 295,
        });
        const decimo = slip('d13', ANA.id, '2026-13-2', '13º Salário — 2ª Parcela 2026', 'publicado', 1800, {
            proventos: [{ cod: '031', descricao: '13º', referencia: '12/12', valor: 2000 }],
            descontos: [{ cod: '902', descricao: 'IRRF sobre 13º', referencia: 'Tabela', valor: 40 }],
            total_proventos: 2000,
            total_descontos: 40,
        });
        const c = new FakeSupabase({ user: COLAB_USER, tables: baseTables({ payslips_decrypted: [...SLIPS, recibo, decimo] }) });
        page = await openPage('holerite-colaborador', { client: c });
        await page.click('[data-click="openInformeModal"]');
        const t = page.text('#informe-content');
        assert.match(t, /IRRF retido\s*R\$\s*295,00/, '100 + 100 dos meses + 55 das férias + 40 do 13º');
        assert.match(t, /13º salário \(tributação exclusiva\)\s*R\$\s*2\.000,00/);
    });

    test('ano sem holerites no informe mostra o vazio', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        await page.click('[data-click="openInformeModal"]');
        page.window.renderInforme('2019');
        assert.equal(page.text('#informe-content'), '');
        assert.equal(page.visible('#informe-empty'), true);
        page.window.closeInformeModal();
        assert.equal(page.$('#informe-modal').classList.contains('open'), false);
    });

    test('seletor de competência no celular: abre, fecha com Esc e clique fora, e troca o holerite', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        const trigger = page.$('#month-select-mobile-trigger');
        const popover = page.$('#month-select-mobile-popover');
        await page.click(trigger);
        assert.equal(trigger.getAttribute('aria-expanded'), 'true');
        await page.key(page.document, 'Escape');
        assert.equal(popover.classList.contains('open'), false);
        await page.click(trigger);
        await page.click(page.document.body);
        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        await page.click(trigger);
        await page.click(popover.querySelector('.select-option[data-value="p1"]'));
        assert.equal(page.text('#doc-competencia'), 'Competência: 05/2026');
        assert.equal(page.text('#month-select-mobile-text'), 'Maio 2026');
    });

    test('imprimir o holerite pede a orientação e aplica o tamanho da página', async () => {
        const adoptedStyleSheets = (w) => {
            Object.defineProperty(w.document, 'adoptedStyleSheets', { value: [], writable: true });
            w.CSSStyleSheet = class {
                replaceSync(css) {
                    this.css = css;
                }
            };
        };
        page = await openPage('holerite-colaborador', { client: client(), before: adoptedStyleSheets });
        page.window.printPayslip();
        assert.equal(page.$('#print-orientation-modal').classList.contains('open'), true);
        page.window.printPayslipWithOrientation('diagonal');
        assert.equal(page.printed || 0, 0, 'orientação inválida não imprime');
        page.window.printPayslipWithOrientation('landscape');
        assert.equal(page.$('#print-orientation-modal').classList.contains('open'), false);
        assert.equal(page.printed, 1);
        assert.equal(page.document.adoptedStyleSheets[0].css, '@page { size: landscape; }');
    });

    test('comparativo sem holerites mostra o vazio; fechar devolve a rolagem', async () => {
        page = await openPage('holerite-colaborador', { client: new FakeSupabase({ user: COLAB_USER, tables: baseTables({ payslips_decrypted: [] }) }) });
        page.window.openComparativoModal();
        assert.equal(page.visible('#comparativo-empty'), true);
        page.window.closeComparativoModal();
        assert.equal(page.document.body.style.overflow, '');
    });

    test('RH publica um holerite novo: a tela recarrega e avisa', async () => {
        const c = client();
        page = await openPage('holerite-colaborador', { client: c });
        c.tables.payslips_decrypted.push(slip('p9', ANA.id, '2026-08', 'Agosto 2026', 'publicado', 3600));
        c.emit('payslips', { eventType: 'INSERT', new: { id: 'p9' } });
        await page.waitFor(() => page.toasts().some((t) => /Holerite atualizado pelo RH/.test(t)));
        assert.equal(page.$$('#month-list .month-card').length, 4);
        assert.equal(page.text('#doc-competencia'), 'Competência: 06/2026', 'continua no holerite que estava aberto');
    });

    test('conta desativada pelo RH encerra a sessão', async () => {
        const c = client();
        page = await openPage('holerite-colaborador', { client: c });
        c.emit('employees', { eventType: 'UPDATE', new: { id: ANA.id, status: 'Inativo' } });
        await page.waitFor(() => page.toasts().some((t) => /Conta desativada/.test(t)));
        await page.waitFor(() => page.navigations.some((u) => /login\.html/.test(u)), { timeout: 5000 });
    });
});
