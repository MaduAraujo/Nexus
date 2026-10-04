const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-07-20T10:00:00-03:00';

function rhClient(extra = {}, ana = {}) {
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
    for (const t of ['employees', 'employees_decrypted']) {
        const row = tables[t]?.find((e) => e.id === ANA.id);
        if (row) Object.assign(row, ana);
    }
    const client = new FakeSupabase({ user: RH_USER, tables });
    const orig = client.from.bind(client);
    client.from = (t) => {
        if (t === 'payslips_decrypted') client.tables.payslips_decrypted = client.tables.payslips;
        return orig(t);
    };
    return client;
}

const rowFor = (p, name) => p.$$('#folha-tbody tr').find((tr) => tr.textContent.includes(name));

async function fecharFolhaDaAna(client) {
    page = await openPage('pagamentos', { client, now: NOW });
    await page.check(rowFor(page, 'Ana Souza').querySelector('.cb-row'));
    await page.click('[data-click="marcarSelecionadosPagos"]');
    return client.writes('payslips', 'upsert')[0].payload.find((s) => s.employee_id === ANA.id);
}

describe('pagamentos.html — adicionais de risco, hora extra e DSR', () => {
    test('periculosidade entra no holerite e na base do INSS', async () => {
        const slip = await fecharFolhaDaAna(rhClient({}, { adicional_periculosidade: true }));
        const peric = slip.proventos.find((p) => p.cod === '023');
        assert.equal(peric.valor, 1200);
        assert.match(peric.descricao, /Periculosidade/);
        assert.equal(slip.descontos.find((d) => d.cod === '901').valor, page.window.calcINSS(5200));
    });

    test('insalubridade usa o salário mínimo e é proporcional aos dias de salário', async () => {
        const client = rhClient(
            { vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2026-07-01', end_date: '2026-07-15', days: 15, abono: false, status: 'aprovado' }] },
            { grau_insalubridade: 'medio' }
        );
        const slip = await fecharFolhaDaAna(client);
        const insal = slip.proventos.find((p) => p.cod === '024');
        assert.equal(insal.referencia, '15 dias');
        assert.equal(insal.valor, +((1621 * 0.2) / 2).toFixed(2));
    });

    test('banco de horas vencido é pago como hora extra 50%, com reflexo no DSR, e baixado do banco ao fechar', async () => {
        const client = rhClient({
            hr_settings: [{ id: 1, banco_horas_vencimento_meses: 6 }],
            time_records: [
                { employee_id: ANA.id, date: '2026-01-05', entrada: '2026-01-05T08:00:00-03:00', saida: '2026-01-05T20:00:00-03:00' },
                { employee_id: ANA.id, date: '2026-07-01', entrada: '2026-07-01T08:00:00-03:00', saida: '2026-07-01T16:00:00-03:00' },
            ],
        });
        const slip = await fecharFolhaDaAna(client);
        const he = slip.proventos.find((p) => p.cod === '025');
        assert.equal(he.referencia, '4.0h');
        assert.equal(he.valor, 120);
        assert.deepEqual(page.plain(he.buckets), [{ mk: '2026-01', minutos: 240 }]);
        assert.equal(slip.proventos.find((p) => p.cod === '026').valor, +((120 / 27) * 4).toFixed(2));

        const [baixa] = client.writes('bank_adjustments', 'insert');
        assert.deepEqual(
            page.plain(baixa.payload).map((l) => [l.employee_id, l.tipo, l.minutos, l.date]),
            [[ANA.id, 'debito', 240, '2026-01-01']]
        );
        assert.match(baixa.payload[0].justificativa, /folha de 07\/2026/);
    });

    test('se a baixa no banco falhar, a folha fecha e o RH é avisado', async () => {
        const client = rhClient({
            hr_settings: [{ id: 1, banco_horas_vencimento_meses: 6 }],
            time_records: [{ employee_id: ANA.id, date: '2026-01-05', entrada: '2026-01-05T08:00:00-03:00', saida: '2026-01-05T20:00:00-03:00' }],
        });
        const orig = client.from.bind(client);
        client.from = (t) => {
            const q = orig(t);
            if (t === 'bank_adjustments') q.insert = async () => ({ error: { message: 'falhou' } });
            return q;
        };
        await fecharFolhaDaAna(client);
        assert.match(page.toasts().join(' '), /não foram baixadas do banco de horas/);
    });

    test('sem vencimento configurado vale 6 meses; banco ainda no prazo não vira hora extra', async () => {
        const slip = await fecharFolhaDaAna(
            rhClient({
                time_records: [{ employee_id: ANA.id, date: '2026-03-02', entrada: '2026-03-02T08:00:00-03:00', saida: '2026-03-02T20:00:00-03:00' }],
            })
        );
        assert.equal(
            slip.proventos.find((p) => p.cod === '025'),
            undefined
        );
    });
});

describe('pagamentos.html — rescisão: estabilidade, aviso do empregado, férias vencidas e prazo', () => {
    async function prepararRescisao(p, data, tipo) {
        await p.click('[data-click="openRescisaoModal"]');
        await p.click('#rescisao-emp-trigger');
        await p.click(`#rescisao-emp-popover .select-option[data-value="${ANA.id}"]`);
        p.window.setRescisaoDate(data);
        if (tipo) await p.click(`#rescisao-tipo-toggle [data-tipo="${tipo}"]`);
        await p.settle();
    }

    test('estabilidade bloqueia a dispensa sem justa causa e só avisa na justa causa', async () => {
        page = await openPage('pagamentos', { client: rhClient({}, { estabilidade_ate: '2026-12-31', estabilidade_motivo: 'gestante' }), now: NOW });
        await prepararRescisao(page, '2026-07-31');
        await page.window.calcularRescisaoModal();
        assert.match(page.text('#rescisao-error'), /estabilidade até 31\/12\/2026/);
        assert.equal(page.visible('#rescisao-result'), false);

        await page.click('#rescisao-tipo-toggle [data-tipo="justa_causa"]');
        await page.window.calcularRescisaoModal();
        assert.equal(page.visible('#rescisao-result'), true);
        assert.match(page.text('#rescisao-result'), /revertida/);
    });

    test('pedido de demissão mostra a escolha do aviso e desconta quando não cumprido', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await prepararRescisao(page, '2026-07-31');
        assert.equal(page.visible('#rescisao-aviso-empregado-group'), false);
        await page.click('#rescisao-tipo-toggle [data-tipo="pedido_demissao"]');
        assert.equal(page.visible('#rescisao-aviso-empregado-group'), true);
        await page.click('#rescisao-aviso-toggle [data-aviso="descontar"]');
        await page.click('#rescisao-aviso-toggle');
        assert.equal(page.$('#rescisao-aviso-empregado').value, 'descontar');
        await page.window.calcularRescisaoModal();
        assert.match(page.text('#rescisao-result'), /Desconto do Aviso Prévio não cumprido/);
        assert.match(page.text('#rescisao-result'), /até 10\/08\/2026/);

        await page.click('[data-click="openRescisaoModal"]');
        assert.equal(page.$('#rescisao-aviso-empregado').value, 'cumprido');
    });

    test('férias já gozadas (com abono) abatem o período mais antigo; o restante sai como vencida', async () => {
        const client = rhClient({
            vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2025-06-02', end_date: '2025-06-21', days: 20, abono: true, status: 'concluido' }],
        });
        page = await openPage('pagamentos', { client, now: NOW });
        await prepararRescisao(page, '2026-07-31');
        await page.window.calcularRescisaoModal();
        const texto = page.text('#rescisao-result');
        assert.match(texto, /Férias Vencidas \(CLT art\. 146\)/);
        assert.doesNotMatch(texto, /em Dobro/);
    });

    test('sem férias gozadas o período com prazo vencido sai em dobro', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await prepararRescisao(page, '2026-07-31');
        await page.window.calcularRescisaoModal();
        assert.match(page.text('#rescisao-result'), /Férias Vencidas em Dobro/);
    });
});
