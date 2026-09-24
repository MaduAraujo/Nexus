const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-07-20T10:00:00-03:00';
const MES = '2026-07';

function rhClient(extra = {}, opts = {}) {
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
        ...extra,
    });
    tables.employees_decrypted.forEach((e) => (e.status = e.status || 'Ativo'));
    return new FakeSupabase({ user: RH_USER, tables, ...opts });
}

function espelharPayslips(client) {
    const orig = client.from.bind(client);
    client.from = (t) => {
        if (t === 'payslips_decrypted') client.tables.payslips_decrypted = client.tables.payslips;
        return orig(t);
    };
    return client;
}

const rowFor = (p, name) => p.$$('#folha-tbody tr').find((tr) => tr.textContent.includes(name));

describe('pagamentos.html — folha do mês', () => {
    test('calcula bruto, INSS, IRRF e líquido por contrato; PJ sem encargos', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        assert.equal(page.text('#folha-count'), '3 colaboradores na folha');
        const ana = page.text(rowFor(page, 'Ana Souza'));
        assert.match(ana, /CLT.*R\$\s*4\.000,00/);
        const caio = page.text(rowFor(page, 'Caio Prado'));
        assert.match(caio, /PJ.*R\$\s*9\.000,00.*—.*—.*R\$\s*9\.000,00/);
        assert.equal(page.text('#kpi-colab'), '3');
        assert.equal(page.text('#kpi-pagos'), '0/3');
    });

    test('marcar selecionados como pagos grava o holerite com adicional noturno do mês', async () => {
        const client = espelharPayslips(
            rhClient({
                time_records: [
                    {
                        employee_id: ANA.id,
                        date: '2026-07-07',
                        entrada: '2026-07-07T18:00:00-03:00',
                        saida_almoco: '2026-07-07T22:00:00-03:00',
                        retorno_almoco: '2026-07-07T23:00:00-03:00',
                        saida: '2026-07-08T03:00:00-03:00',
                    },
                ],
            })
        );
        page = await openPage('pagamentos', { client, now: NOW });
        await page.check(rowFor(page, 'Ana Souza').querySelector('.cb-row'));
        assert.match(page.text('#bulk-count'), /1/);
        await page.click('[data-click="marcarSelecionadosPagos"]');

        const [up] = client.writes('payslips', 'upsert');
        assert.equal(up.opts.onConflict, 'employee_id,mes');
        const slip = up.payload[0];
        assert.equal(slip.employee_id, ANA.id);
        assert.equal(slip.mes, MES);
        assert.equal(slip.status, 'pago');
        assert.equal(slip.competencia, '07/2026');
        const noturno = slip.proventos.find((p) => p.cod === '020');
        assert.ok(noturno, 'adicional noturno lançado');
        assert.equal(noturno.referencia, '4.0h reais');
        assert.ok(slip.descontos.some((d) => d.cod === '901'));
        assert.equal(slip.salario_liquido, +(slip.total_proventos - slip.total_descontos).toFixed(2));
        assert.match(page.toasts().join(' '), /1 colaborador marcado como pago/);
    });

    test('fechar a folha mantém o adiantamento de férias já lançado no holerite do mês', async () => {
        const ferias = [
            { cod: '040', descricao: 'Adiantamento de Férias', referencia: '20 dias', valor: 2666.67 },
            { cod: '041', descricao: '1/3 Constitucional de Férias', referencia: '—', valor: 888.89 },
        ];
        const client = espelharPayslips(
            rhClient({
                payslips: [
                    {
                        id: 'ps1',
                        employee_id: ANA.id,
                        mes: MES,
                        proventos: ferias,
                        descontos: [],
                        total_proventos: 3555.56,
                        total_descontos: 0,
                        status: 'publicado',
                    },
                ],
            })
        );
        page = await openPage('pagamentos', { client, now: NOW });
        page.window.toggleSelectAll({ checked: true });
        await page.settle();
        await page.click('[data-click="marcarSelecionadosPagos"]');
        const slipAna = client.writes('payslips', 'upsert')[0].payload.find((s) => s.employee_id === ANA.id);
        assert.deepEqual(
            slipAna.proventos.map((p) => p.cod),
            ['001', '040', '041']
        );
        assert.equal(slipAna.total_proventos, 4000 + 2666.67 + 888.89);
    });

    test('férias aprovadas pelo gestor (sem evento lançado) entram no holerite do mês de início', async () => {
        const client = espelharPayslips(
            rhClient({
                vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2026-07-13', end_date: '2026-07-22', days: 10, abono: false, status: 'aprovado' }],
            })
        );
        page = await openPage('pagamentos', { client, now: NOW });
        page.window.toggleSelectAll({ checked: true });
        await page.settle();
        await page.click('[data-click="marcarSelecionadosPagos"]');
        const slipAna = client.writes('payslips', 'upsert')[0].payload.find((s) => s.employee_id === ANA.id);
        assert.deepEqual(
            slipAna.proventos.filter((p) => p.cod >= '040' && p.cod <= '043').map((p) => [p.cod, p.valor]),
            [
                ['040', 1333.33],
                ['041', 444.44],
            ]
        );
    });

    test('desconto de DSR por falta injustificada (justificativa recusada)', async () => {
        const client = espelharPayslips(rhClient({ adjustment_requests: [{ employee_id: ANA.id, date: '2026-07-08', tipo: 'falta', status: 'rejeitado' }] }));
        page = await openPage('pagamentos', { client, now: NOW });
        page.window.toggleSelectAll({ checked: true });
        await page.settle();
        await page.click('[data-click="marcarSelecionadosPagos"]');
        const slipAna = client.writes('payslips', 'upsert')[0].payload.find((s) => s.employee_id === ANA.id);
        const dsr = slipAna.descontos.find((d) => d.cod === '904');
        assert.deepEqual([dsr.referencia, dsr.valor], ['1 semana', 133.33]);
    });

    test('pagos saem da folha e aparecem nos holerites; o holerite abre e registra o acesso', async () => {
        const client = rhClient({
            payslips_decrypted: [
                {
                    id: 'ps1',
                    employee_id: ANA.id,
                    mes: MES,
                    competencia: '07/2026',
                    status: 'pago',
                    proventos: [{ cod: '001', descricao: 'Salário Base', referencia: '30 dias', valor: 4000 }],
                    descontos: [{ cod: '901', descricao: 'INSS', referencia: '9%', valor: 360 }],
                    total_proventos: 4000,
                    total_descontos: 360,
                    salario_liquido: 3640,
                },
            ],
            data_access_log: [],
        });
        page = await openPage('pagamentos', { client, now: NOW });
        assert.ok(!rowFor(page, 'Ana Souza'), 'Ana já paga não aparece na folha pendente');
        assert.equal(page.text('#kpi-pagos'), '1/3');
        await page.click(page.$('[data-click="verHolerite"]'));
        assert.equal(page.text('#slip-modal-sub'), 'Ana Souza — 07/2026');
        assert.match(page.text('#slip-modal-body'), /Salário Base.*INSS/);
        assert.equal(client.writes('data_access_log', 'insert')[0].payload[0].tipo, 'holerite');
    });

    test('busca por nome filtra a folha', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await page.fill('#search-input', 'caio');
        assert.equal(page.$$('#folha-tbody tr').length, 1);
        assert.match(page.text('#folha-tbody'), /Caio Prado/);
    });
});

describe('pagamentos.html — 13º salário', () => {
    test('2ª parcela desconta INSS e IRRF sobre o valor integral; PJ fica de fora', async () => {
        const client = rhClient();
        page = await openPage('pagamentos', { client, now: NOW });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        page.$('#dt-ano').value = '2026';
        page.$('#dt-parcela').value = '2';
        await page.click('[data-click="calcularDecimoTerceiroModal"]');
        assert.match(page.text('#dt-result'), /Colaboradores\s*2/);
        assert.doesNotMatch(page.text('#dt-result'), /Caio/);
        await page.click('#btn-gerar-decimo-terceiro');
        const slips = client.writes('payslips', 'upsert')[0].payload;
        assert.deepEqual(
            slips.map((s) => [s.employee_id, s.mes, s.proventos[0].cod]),
            [
                [ANA.id, '2026-13-2', '031'],
                [BIA.id, '2026-13-2', '031'],
            ].sort((a, b) => (a[0] < b[0] ? -1 : 1))
        );
        assert.ok(slips.every((s) => s.descontos.some((d) => d.cod === '901')));
    });

    test('ano inválido é recusado', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        page.$('#dt-ano').value = '1990';
        await page.click('[data-click="calcularDecimoTerceiroModal"]');
        assert.equal(page.text('#dt-error'), 'Informe um ano válido.');
    });
});

describe('pagamentos.html — rescisão', () => {
    test('calcula as verbas, confirma o desligamento, inativa, anexa o termo e audita', async () => {
        const client = rhClient({ vacations: [{ id: 'v1', employee_id: ANA.id, status: 'pendente' }] });
        page = await openPage('pagamentos', { client, now: NOW, fetch: async () => new Response('{}', { status: 200 }) });
        await page.click('[data-click="openRescisaoModal"]');
        await page.click('#rescisao-emp-trigger');
        await page.click(`#rescisao-emp-popover .select-option[data-value="${ANA.id}"]`);
        page.window.setRescisaoDate('2026-07-31');
        await page.settle();
        assert.equal(page.$('#rescisao-admissao').value, '01/02/2024');
        await page.click('#btn-calcular-rescisao');
        assert.equal(page.visible('#rescisao-result'), true);
        assert.match(page.text('#rescisao-result'), /Saldo de salário/i);
        assert.match(page.text('#rescisao-result'), /Aviso prévio/i);

        await page.click('#btn-confirmar-desligamento');
        await page.waitFor(() => page.toasts().some((t) => /Desligamento confirmado/.test(t)));
        const emp = client.tables.employees.find((e) => e.id === ANA.id);
        assert.deepEqual([emp.status, emp.termination_date], ['Inativo', '2026-07-31']);
        assert.equal(client.tables.vacations[0].status, 'recusado', 'férias pendentes são recusadas');
        const [doc] = client.writes('documents', 'insert');
        assert.equal(doc.payload[0].category, 'demissional');
        assert.equal(doc.payload[0].retido_ate, '2056-07-20');
        assert.equal(client.writes('employee_audit', 'insert')[0].payload[0].changes[0].newValue, 'Inativo');
        assert.equal(page.fetches.filter((f) => /nexus-files/.test(f.url)).length, 1, 'termo enviado ao Storage');
    });

    test('data anterior à admissão é recusada', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await page.click('#rescisao-emp-trigger');
        await page.click(`#rescisao-emp-popover .select-option[data-value="${ANA.id}"]`);
        page.window.setRescisaoDate('2024-01-10');
        await page.settle();
        await page.click('#btn-calcular-rescisao');
        assert.equal(page.text('#rescisao-error'), 'A data de desligamento deve ser posterior à admissão.');
    });
});

describe('pagamentos.html — exportação', () => {
    test('Excel, CSV e PDF da folha, todos registrados como exportação', async () => {
        const client = rhClient();
        page = await openPage('pagamentos', { client, now: NOW });
        await page.click('#export-excel');
        await page.click('#export-csv');
        await page.click('#export-pdf');
        await page.settle(30);
        assert.equal(page.saved.length >= 2, true, `arquivos salvos: ${page.saved}`);
        assert.ok(client.rpcCalls('report_data_export').length >= 2);
    });
});
