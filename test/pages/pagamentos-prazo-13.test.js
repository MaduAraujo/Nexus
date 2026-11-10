const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

function rhClient(payslips = []) {
    const tables = baseTables({
        payslips,
        payslips_decrypted: [],
        time_records: [],
        holidays: [],
        adjustment_requests: [],
        bank_adjustments: [],
        documents: [],
        employee_audit: [],
        vacations: [],
        data_access_log: [],
    });
    tables.employees_decrypted.forEach((e) => (e.status = e.status || 'Ativo'));
    return new FakeSupabase({ user: RH_USER, tables });
}

const decimo = (employee_id, mes) => ({ id: `${employee_id}-${mes}`, employee_id, mes, status: 'publicado' });
const botao = () => page.$('#btn-open-decimo-terceiro');
const alertaNoBotao = () => botao().classList.contains('btn-topbar-icon--alerta');

describe('pagamentos.html — prazos do 13º (Lei 4.749/65)', () => {
    test('longe do prazo: sem alerta no botão; o modal mostra o prazo de cada parcela e esconde com ano inválido', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: '2026-07-20T10:00:00-03:00' });
        assert.equal(alertaNoBotao(), false);
        assert.equal(botao().title, '13º Salário');

        await page.click('[data-click="openDecimoTerceiroModal"]');
        assert.equal(page.$('#dt-parcela').value, '1');
        assert.equal(page.text('#dt-prazo'), '1ª parcela até 30/11/2026 (Lei 4.749/65, art. 2º), faltam 133 dias.');
        assert.ok(page.$('#dt-prazo').classList.contains('info'));

        await page.click('#dt-parcela-toggle .type-toggle-card[data-parcela="2"]');
        assert.equal(page.text('#dt-prazo'), '2ª parcela até 18/12/2026 (Lei 4.749/65, art. 1º), faltam 151 dias.');

        await page.fill('#dt-ano', '20');
        assert.ok(page.$('#dt-prazo').classList.contains('hidden'));
    });

    test('a 20 dias do prazo da 1ª parcela, o botão avisa quantos ainda não receberam', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: '2026-11-10T10:00:00-03:00' });
        assert.equal(alertaNoBotao(), true);
        assert.equal(botao().title, '13º Salário: 2 colaboradores sem a 1ª parcela, que vence em 30/11/2026');
        assert.equal(botao().getAttribute('aria-label'), botao().title);
    });

    test('1ª parcela paga a todos: o aviso passa para a 2ª, e o modal já abre nela', async () => {
        page = await openPage('pagamentos', {
            client: rhClient([decimo(ANA.id, '2026-13-1'), decimo(BIA.id, '2026-13-1')]),
            now: '2026-12-05T10:00:00-03:00',
        });
        assert.equal(botao().title, '13º Salário: 2 colaboradores sem a 2ª parcela, que vence em 18/12/2026');
        await page.click('[data-click="openDecimoTerceiroModal"]');
        assert.equal(page.$('#dt-parcela').value, '2');
        assert.ok(page.$('#dt-prazo').classList.contains('warning'));
    });

    test('véspera e dia do prazo', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: '2026-12-17T10:00:00-03:00' });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        assert.equal(page.text('#dt-prazo'), '2ª parcela até 18/12/2026 (Lei 4.749/65, art. 1º), faltam 1 dia.');
        page.close();

        page = await openPage('pagamentos', { client: rhClient(), now: '2026-12-18T10:00:00-03:00' });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        assert.equal(page.text('#dt-prazo'), 'O prazo termina hoje: 2ª parcela até 18/12/2026 (Lei 4.749/65, art. 1º).');
    });

    test('prazo vencido: avisa no botão e pede confirmação antes de gerar; depois de gerar, o aviso sai', async () => {
        let aceitar = false;
        const c = rhClient([decimo(ANA.id, '2026-13-1')]);
        page = await openPage('pagamentos', { client: c, now: '2026-12-21T10:00:00-03:00', confirm: () => aceitar });
        assert.equal(botao().title, '13º Salário: 1 colaborador sem a 1ª parcela, que venceu em 30/11/2026');

        await page.click('[data-click="openDecimoTerceiroModal"]');
        await page.click('#dt-parcela-toggle .type-toggle-card[data-parcela="1"]');
        assert.match(page.text('#dt-prazo'), /^Prazo vencido: 1ª parcela até 30\/11\/2026 .*multa administrativa \(Lei 7\.855\/89, art\. 3º\)\.$/);

        await page.click('[data-click="calcularDecimoTerceiroModal"]');
        await page.click('#btn-gerar-decimo-terceiro');
        assert.match(page.confirms.at(-1), /^Prazo vencido: 1ª parcela/);
        assert.equal(c.writes('payslips', 'upsert').length, 0);

        aceitar = true;
        await page.click('#btn-gerar-decimo-terceiro');
        await page.waitFor(() => c.writes('payslips', 'upsert').length === 1);
        await page.waitFor(() => /2ª parcela, que venceu em 18\/12\/2026/.test(botao().title));
    });

    test('sem colaborador elegível não consulta holerites; falha na consulta não derruba a tela', async () => {
        const c = rhClient();
        c.tables.employees_decrypted.forEach((e) => (e.contract_type = 'pj'));
        page = await openPage('pagamentos', { client: c, now: '2026-11-10T10:00:00-03:00' });
        assert.equal(alertaNoBotao(), false);

        const comErro = rhClient();
        comErro.errors['payslips:select'] = { message: 'fora do ar' };
        page.close();
        page = await openPage('pagamentos', { client: comErro, now: '2026-11-10T10:00:00-03:00' });
        assert.equal(botao().title, '13º Salário: 2 colaboradores sem a 1ª parcela, que vence em 30/11/2026');
    });
});
