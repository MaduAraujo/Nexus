const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-07-20T10:00:00-03:00';

function rhClient(anaCampos) {
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
        if (e.id === ANA.id) Object.assign(e, { salary: 3000, admission_date: '2026-02-02', ...anaCampos });
    });
    return new FakeSupabase({ user: RH_USER, tables });
}

const TEMPORARIO = { contract_type: 'Temporário', contract_end_date: '2026-10-30' };
const PRAZO = { contract_type: 'Prazo determinado', contract_end_date: '2027-02-01' };

async function escolher(p, empId) {
    await p.click('#rescisao-emp-trigger');
    await p.click(`#rescisao-emp-popover .select-option[data-value="${empId}"]`);
}

const titulos = (p) => p.$$('#rescisao-tipo-toggle .type-toggle-card').map((c) => c.dataset.tipo);

describe('pagamentos.html — temporário (Lei 6.019/1974)', () => {
    test('fica fora da folha, com a explicação na contagem, e fora da exportação', async () => {
        page = await openPage('pagamentos', { client: rhClient(TEMPORARIO), now: NOW });
        assert.doesNotMatch(page.text('#folha-tbody'), /Ana Souza/);
        assert.match(page.text('#folha-count'), /1 temporário fora da folha: pago pela empresa de trabalho temporário/);
    });

    test('a rescisão só registra o encerramento, sem verbas, e o desligamento continua possível', async () => {
        page = await openPage('pagamentos', { client: rhClient(TEMPORARIO), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await escolher(page, ANA.id);
        assert.equal(page.visible('#rescisao-temporario-hint'), true);
        assert.equal(page.visible('#rescisao-tipo-group'), false);
        page.window.setRescisaoDate('2026-07-31');
        await page.click('#btn-calcular-rescisao');
        assert.match(page.text('#rescisao-result'), /o empregador é a empresa de trabalho temporário/);
        assert.equal(page.visible('#btn-confirmar-desligamento'), true);
        await escolher(page, BIA.id);
        assert.equal(page.visible('#rescisao-temporario-hint'), false);
        assert.equal(page.visible('#rescisao-tipo-group'), true);
    });
});

describe('pagamentos.html — prazo determinado (CLT art. 443)', () => {
    test('troca as opções de rescisão para as do contrato a prazo e volta às da CLT', async () => {
        page = await openPage('pagamentos', { client: rhClient(PRAZO), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        assert.equal(page.visible('#rescisao-prazo-hint'), false);
        await escolher(page, ANA.id);
        assert.deepEqual(titulos(page), ['prazo_termino', 'prazo_sem_justa_causa', 'prazo_pedido', 'prazo_justa_causa']);
        assert.equal(page.$('#rescisao-tipo').value, 'prazo_termino');
        assert.equal(page.visible('#rescisao-prazo-hint'), true);
        await escolher(page, BIA.id);
        assert.deepEqual(titulos(page), ['sem_justa_causa', 'pedido_demissao', 'acordo_mutuo', 'justa_causa']);
    });

    test('dispensa antecipada calcula o art. 479 com o término do cadastro; pedido antecipado avisa do art. 480', async () => {
        page = await openPage('pagamentos', { client: rhClient(PRAZO), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await escolher(page, ANA.id);
        await page.click('#rescisao-tipo-toggle [data-tipo="prazo_sem_justa_causa"]');
        page.window.setRescisaoDate('2026-07-31');
        await page.click('#btn-calcular-rescisao');
        assert.match(page.text('#rescisao-result'), /Indenização art\. 479 CLT/);
        assert.match(page.text('#rescisao-result'), /Multa de 40% sobre FGTS/);
        assert.doesNotMatch(page.text('#rescisao-result'), /Aviso Prévio/);
    });

    test('sem término no cadastro o aviso fala do contrato por prazo determinado', async () => {
        page = await openPage('pagamentos', { client: rhClient({ ...PRAZO, contract_end_date: null }), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await escolher(page, ANA.id);
        await page.click('#rescisao-tipo-toggle [data-tipo="prazo_sem_justa_causa"]');
        page.window.setRescisaoDate('2026-07-31');
        await page.click('#btn-calcular-rescisao');
        assert.match(page.text('#rescisao-result'), /Contrato por prazo determinado sem data de término no cadastro/);
    });

    test('pedido antecipado avisa da indenização do art. 480', async () => {
        page = await openPage('pagamentos', { client: rhClient(PRAZO), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await escolher(page, ANA.id);
        await page.click('#rescisao-tipo-toggle [data-tipo="prazo_pedido"]');
        page.window.setRescisaoDate('2026-07-31');
        await page.click('#btn-calcular-rescisao');
        assert.match(page.text('#rescisao-result'), /CLT art\. 480/);
    });
});
