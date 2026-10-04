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

const toastCom = (p, re) => p.toasts().some((t) => re.test(t));

describe('pagamentos.html — pensão alimentícia', () => {
    test('percentual do líquido: desconta no holerite e abate a pensão da base do IRRF', async () => {
        const slip = await fecharFolhaDaAna(rhClient({}, { salary: 9000, pensao_alimenticia: true, tipo_pensao: 'percentual', pensao_valor: 30 }));
        const inss = page.window.calcINSS(9000);
        const esperado = page.window.Impostos.calcPensaoAlimenticia({ tipo: 'percentual', valor: 30, rendimento: 9000, inss });
        const pensao = slip.descontos.find((d) => d.cod === '907');
        assert.deepEqual([pensao.referencia, pensao.valor], ['30% do líquido', esperado.pensao]);
        assert.equal(slip.descontos.find((d) => d.cod === '902').valor, esperado.irrf);
        assert.ok(esperado.irrf < page.window.calcIRRFMensal({ rendimento: 9000, inss }), 'a pensão reduz o IRRF');
        assert.equal(esperado.pensao, +(0.3 * (9000 - inss - esperado.irrf)).toFixed(2), '30% do que sobra depois de INSS e IRRF');
        assert.equal(slip.salario_liquido, +(slip.total_proventos - slip.total_descontos).toFixed(2));
    });

    test('valor fixo e percentual do salário mínimo aparecem com a referência certa', async () => {
        let slip = await fecharFolhaDaAna(rhClient({}, { pensao_alimenticia: true, tipo_pensao: 'valor-fixo', pensao_valor: 800 }));
        assert.deepEqual(
            ['referencia', 'valor'].map((k) => slip.descontos.find((d) => d.cod === '907')[k]),
            ['Valor fixo', 800]
        );
        page.close();

        slip = await fecharFolhaDaAna(rhClient({}, { pensao_alimenticia: true, tipo_pensao: 'salario-minimo', pensao_valor: 50 }));
        const pensao = slip.descontos.find((d) => d.cod === '907');
        assert.deepEqual([pensao.referencia, pensao.valor], ['50% do salário mínimo', 810.5]);
    });

    test('sem valor informado, ou com a pensão desligada, nada é descontado', async () => {
        let slip = await fecharFolhaDaAna(rhClient({}, { pensao_alimenticia: true, tipo_pensao: 'percentual', pensao_valor: null }));
        assert.equal(
            slip.descontos.some((d) => d.cod === '907'),
            false
        );
        page.close();
        slip = await fecharFolhaDaAna(rhClient({}, { pensao_alimenticia: false, tipo_pensao: null, pensao_valor: 30 }));
        assert.equal(
            slip.descontos.some((d) => d.cod === '907'),
            false
        );
    });

    test('a prévia da folha já mostra o líquido com a pensão descontada; tipo em branco vale como percentual', async () => {
        page = await openPage('pagamentos', { client: rhClient({}, { pensao_alimenticia: true, tipo_pensao: null, pensao_valor: 10 }), now: NOW });
        const calc = page.eval(`calcRow(employees.find((e) => e.name === 'Ana Souza'))`);
        const inss = page.window.calcINSS(4000);
        const { pensao, irrf } = page.window.Impostos.calcPensaoAlimenticia({ tipo: 'percentual', valor: 10, rendimento: 4000, inss });
        assert.equal(calc.irrf, irrf);
        assert.equal(calc.descontos, +(inss + irrf + pensao).toFixed(2));
    });
});

describe('pagamentos.html — faltas descontam também os adicionais', () => {
    test('com periculosidade, o dia de falta e o DSR saem sobre salário + adicional', async () => {
        const uteis = ['01', '02', '03', '06', '07', '10', '13', '14', '15', '16', '17'];
        const time_records = uteis.map((d) => ({ employee_id: ANA.id, date: `2026-07-${d}`, entrada: `2026-07-${d}T08:00:00-03:00` }));
        const slip = await fecharFolhaDaAna(rhClient({ time_records }, { adicional_periculosidade: true }));
        const diaria = (4000 + 1200) / 30;
        assert.equal(slip.descontos.find((d) => d.cod === '905').valor, +(diaria * 2).toFixed(2));
        assert.equal(slip.descontos.find((d) => d.cod === '904').valor, +diaria.toFixed(2));
    });
});

describe('pagamentos.html — o desligamento grava o tipo de rescisão', () => {
    async function calcular(p, tipo) {
        await p.click('[data-click="openRescisaoModal"]');
        await p.click('#rescisao-emp-trigger');
        await p.click(`#rescisao-emp-popover .select-option[data-value="${ANA.id}"]`);
        p.window.setRescisaoDate('2026-07-31');
        await p.click(`#rescisao-tipo-toggle [data-tipo="${tipo}"]`);
        await p.settle();
        await p.click('#btn-calcular-rescisao');
    }

    test('o tipo escolhido vai junto com o status, para o banco conferir a estabilidade', async () => {
        const client = rhClient();
        page = await openPage('pagamentos', { client, now: NOW });
        await calcular(page, 'pedido_demissao');
        await page.click('#btn-confirmar-desligamento');
        const upd = client.writes('employees', 'update').find((w) => w.payload.status === 'Inativo');
        assert.deepEqual([upd.payload.termination_date, upd.payload.termination_type], ['2026-07-31', 'pedido_demissao']);
    });

    test('se o banco recusar pela estabilidade, a mensagem dele aparece para o RH', async () => {
        const client = rhClient();
        page = await openPage('pagamentos', { client, now: NOW });
        await calcular(page, 'justa_causa');
        client.errors['employees:update'] = { code: '23514', message: 'Colaborador com estabilidade até 31/12/2026: informe o tipo de rescisão.' };
        await page.click('#btn-confirmar-desligamento');
        assert.ok(toastCom(page, /estabilidade até 31\/12\/2026/));
        assert.equal(client.writes('documents', 'insert').length, 0);
    });
});
