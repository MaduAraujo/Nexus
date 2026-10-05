const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

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
    Object.assign(
        tables.employees_decrypted.find((e) => e.id === ANA.id),
        ana
    );
    return new FakeSupabase({ user: RH_USER, tables });
}

const rowFor = (p, name) => p.$$('#folha-tbody tr').find((tr) => tr.textContent.includes(name));

describe('pagamentos.html — benefícios com centavos', () => {
    test('vale-refeição, vale-alimentação e passagem com centavos entram pelo valor certo', async () => {
        const c = rhClient({}, { vale_refeicao: 35.5, vale_alimentacao: 600.5, vale_transporte: true, valor_passagem: 4.4, conducoes_dia: 2 });
        const orig = c.from.bind(c);
        c.from = (t) => {
            if (t === 'payslips_decrypted') c.tables.payslips_decrypted = c.tables.payslips;
            return orig(t);
        };
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.check(rowFor(page, 'Ana Souza').querySelector('.cb-row'));
        await page.click('[data-click="marcarSelecionadosPagos"]');
        const slip = c.writes('payslips', 'upsert')[0].payload.find((s) => s.employee_id === ANA.id);
        const valor = (cod) => slip.proventos.find((p) => p.cod === cod).valor;
        assert.equal(valor('010'), 781, 'R$ 35,50 × 22 dias');
        assert.equal(valor('011'), 600.5);
        assert.equal(valor('012'), 193.6, 'R$ 4,40 × 2 conduções × 22 dias');
        assert.equal(slip.descontos.find((d) => d.cod === '903').valor, 193.6);
        const calc = page.eval(`calcRow(employees.find((e) => e.name === 'Ana Souza'))`);
        assert.equal(calc.benef, +(35.5 * 22 + 600.5 + 193.6).toFixed(2));
    });
});

describe('pagamentos.html — total bruto do rodapé', () => {
    test('o rodapé soma o bruto de verdade, igual ao cartão Folha Bruta', async () => {
        page = await openPage('pagamentos', { client: rhClient({}, { adicional_periculosidade: true }), now: NOW });
        await page.waitFor(() => page.$('#folha-tbody').getAttribute('data-previa') === 'ok');
        assert.equal(page.text('#sum-bruto'), page.text('#kpi-bruto'));
        const somaSalarios = page.eval('fmtCurrency(allRows.reduce((s, r) => s + r.calc.salary, 0))');
        assert.notEqual(page.text('#sum-bruto'), somaSalarios.replace(/ /g, ' '), 'com periculosidade, o bruto passa da soma dos salários');
    });
});

describe('pagamentos.html — 13º salário com parcela já paga', () => {
    async function calcular(c, parcela) {
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        page.$('#dt-ano').value = '2026';
        page.$('#dt-parcela').value = String(parcela);
        await page.click('[data-click="calcularDecimoTerceiroModal"]');
    }

    test('a 2ª parcela desconta a 1ª que foi paga de fato, e quem já recebeu a parcela fica de fora', async () => {
        const c = rhClient({
            payslips_decrypted: [
                { employee_id: ANA.id, mes: '2026-13-1', status: 'pago', proventos: [{ cod: '030', valor: 1500 }] },
                { employee_id: BIA.id, mes: '2026-13-2', status: 'pago', proventos: [{ cod: '031', valor: 4000 }] },
            ],
        });
        await calcular(c, 2);
        assert.match(page.text('#dt-result'), /1 colaborador já recebeu esta parcela e ficou de fora/);
        await page.click('#btn-gerar-decimo-terceiro');
        const payload = c.writes('payslips', 'upsert')[0].payload;
        assert.deepEqual(
            payload.map((s) => s.employee_id),
            [ANA.id]
        );
        assert.equal(payload[0].proventos[0].valor, 2500, 'R$ 4.000 integral − R$ 1.500 pagos em novembro');
    });

    test('sem a 1ª parcela registrada, a 2ª é a metade; com todos já pagos, avisa e não gera', async () => {
        let c = rhClient();
        await calcular(c, 2);
        await page.click('#btn-gerar-decimo-terceiro');
        assert.equal(c.writes('payslips', 'upsert')[0].payload.find((s) => s.employee_id === ANA.id).proventos[0].valor, 2000);
        page.close();

        c = rhClient({
            payslips_decrypted: [ANA.id, BIA.id].map((id) => ({ employee_id: id, mes: '2026-13-1', status: 'pago', proventos: [{ cod: '030', valor: 1 }] })),
        });
        await calcular(c, 1);
        assert.equal(page.text('#dt-error'), 'Esta parcela já foi paga a todos os colaboradores elegíveis.');
        assert.match(page.text('#dt-result'), /^$/);
    });

    test('dois colaboradores já pagos usam o plural', async () => {
        const c = rhClient({
            payslips_decrypted: [ANA.id, BIA.id].map((id) => ({ employee_id: id, mes: '2026-13-2', status: 'pago', proventos: [] })),
        });
        c.tables.employees_decrypted.push({ ...ANA, id: 'emp-nova', name: 'Nova Pessoa', status: 'Ativo' });
        await calcular(c, 2);
        assert.match(page.text('#dt-result'), /2 colaboradores já receberam esta parcela e ficaram de fora/);
    });
});

describe('pagamentos.html — rescisão e desligamento', () => {
    async function calcularRescisaoDaAna(p, data = '2026-12-10') {
        await p.click('[data-click="openRescisaoModal"]');
        await p.click('#rescisao-emp-trigger');
        await p.click(`#rescisao-emp-popover .select-option[data-value="${ANA.id}"]`);
        p.window.setRescisaoDate(data);
        await p.settle();
        await p.click('#btn-calcular-rescisao');
    }

    const filesOk = async () => new Response('{}', { status: 200 });

    test('o 13º já pago no ano aparece descontado na rescisão', async () => {
        const c = rhClient({
            payslips_decrypted: [
                { employee_id: ANA.id, mes: '2026-13-1', status: 'pago', proventos: [{ cod: '030', valor: 1800 }] },
                { employee_id: ANA.id, mes: '2026-13-2', status: 'publicado', proventos: [{ cod: '031', valor: 1800 }] },
            ],
        });
        page = await openPage('pagamentos', { client: c, now: '2026-12-10T10:00:00-03:00' });
        await calcularRescisaoDaAna(page);
        const linha = page.$$('#rescisao-result tr').find((tr) => /13º já pago no ano \(adiantamento\), descontado/.test(tr.textContent));
        assert.ok(linha, 'a linha do desconto aparece');
        assert.match(linha.textContent.replace(/ /g, ' '), /-R\$ 1\.800,00/, 'só a 1ª parcela, que foi paga');
    });

    test('desligamento completo mostra só a confirmação', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', { client: c, now: NOW, confirm: true, fetch: filesOk });
        await calcularRescisaoDaAna(page, '2026-07-31');
        await page.click('#btn-confirmar-desligamento');
        await page.waitFor(() => page.toasts().some((t) => /Desligamento confirmado/.test(t)));
        assert.equal(
            page.toasts().some((t) => /Colaborador desligado, mas/.test(t)),
            false
        );
    });

    test('falhas depois de inativar viram um aviso com tudo o que ficou pendente', async () => {
        const c = rhClient();
        c.errors['vacations:update'] = { message: 'x' };
        c.errors['documents:insert'] = { message: 'x' };
        c.errors['employee_audit:insert'] = { message: 'x' };
        page = await openPage('pagamentos', { client: c, now: NOW, confirm: true, fetch: filesOk });
        await calcularRescisaoDaAna(page, '2026-07-31');
        await page.click('#btn-confirmar-desligamento');
        await page.waitFor(() => page.toasts().some((t) => /Colaborador desligado, mas/.test(t)));
        const aviso = page.toasts().find((t) => /Colaborador desligado, mas/.test(t));
        assert.match(aviso, /as férias pendentes não foram recusadas/);
        assert.match(aviso, /não foi possível anexar o documento de rescisão/);
        assert.match(aviso, /o registro da rescisão no histórico do colaborador não foi gravado/);
        assert.equal(
            page.toasts().some((t) => /Desligamento confirmado/.test(t)),
            false,
            'não mostra sucesso por cima do aviso'
        );
        assert.equal(c.writes('employee_audit', 'insert').length, 2, 'tenta gravar a auditoria duas vezes');
        assert.ok(
            c.calls.some((x) => x.storage && /remove/.test(JSON.stringify(x))),
            'o arquivo enviado é apagado'
        );
    });

    test('a auditoria que falha uma vez e grava na segunda não gera aviso', async () => {
        const c = rhClient();
        let falhas = 1;
        c.errors['employee_audit:insert'] = () => (falhas-- > 0 ? { message: 'instável' } : null);
        page = await openPage('pagamentos', { client: c, now: NOW, confirm: true, fetch: filesOk });
        await calcularRescisaoDaAna(page, '2026-07-31');
        await page.click('#btn-confirmar-desligamento');
        await page.waitFor(() => page.toasts().some((t) => /Desligamento confirmado/.test(t)));
    });
});
