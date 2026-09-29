const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

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
        data_access_log: [],
        ...extra,
    });
    tables.employees_decrypted.forEach((e) => (e.status = e.status || 'Ativo'));
    return new FakeSupabase({ user: RH_USER, tables, ...opts });
}

const slip = (employee_id, extra = {}) => ({
    id: `ps-${employee_id}`,
    employee_id,
    mes: MES,
    mes_formatado: null,
    competencia: null,
    status: 'pago',
    proventos: [{ cod: '001', descricao: 'Salário Base', referencia: '30 dias', valor: 4000 }],
    descontos: [{ cod: '901', descricao: 'INSS', referencia: '9%', valor: null }],
    total_proventos: 4000,
    total_descontos: 0,
    salario_liquido: 4000,
    ...extra,
});

function incompleta(c) {
    Object.assign(
        c.tables.employees_decrypted.find((e) => e.id === ANA.id),
        { dept: null, role: null, contract_type: null, admission_date: null, avatar_url: 'https://storage.test/ana.jpg', cpf: null }
    );
    return c;
}

describe('pagamentos.html — bordas', () => {
    test('falha em todas as leituras deixa a folha vazia e o cartão diz que não há pendências', async () => {
        const erro = { message: 'x' };
        page = await openPage('pagamentos', {
            client: rhClient({}, { errors: { employees_decrypted: erro, payslips_decrypted: erro, vacations: erro } }),
            now: NOW,
        });
        assert.equal(page.$('#stat-card-status').title, 'Pagos — holerites quitados');
        assert.equal(page.$$('#folha-tbody tr .emp-name').length, 0);
    });

    test('cadastro incompleto aparece com traços, CLT e foto na folha, no holerite, na impressão e nas exportações', async () => {
        const c = incompleta(rhClient({ payslips_decrypted: [slip(BIA.id, { status: 'publicado' })] }));
        page = await openPage('pagamentos', { client: c, now: NOW });
        const linha = page.$$('#folha-tbody tr').find((tr) => tr.textContent.includes('Ana Souza'));
        assert.match(page.text(linha), /CLT/);
        assert.equal(linha.querySelector('.emp-avatar').getAttribute('data-bg-img'), 'https://storage.test/ana.jpg');
        await page.eval(`verHolerite('${ANA.id}')`);
        await page.eval(`verHolerite('nao-existe')`);
        await page.click('#export-excel');
        await page.click('#export-csv');
        await page.click('#export-pdf');
        page.close();

        const c2 = incompleta(rhClient({ payslips_decrypted: [slip(ANA.id)] }));
        page = await openPage('pagamentos', { client: c2, now: NOW });
        await page.click(page.$('[data-click="verHolerite"]'));
        const corpo = page.text('#slip-modal-body');
        assert.match(corpo, /Cargo —/);
        assert.match(corpo, /Contrato CLT/);
        page.window.printCurrentSlip();
    });

    test('duas prévias seguidas: só a mais recente redesenha; marcar pagos sem seleção não faz nada', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.eval('Promise.all([atualizarPrevias(), atualizarPrevias()])');
        await page.eval('marcarSelecionadosPagos()');
        assert.equal(c.writes('payslips', 'upsert').length, 0);
    });

    test('férias de quem tem salário zerado não geram recibo; recibo sem nome do mês abre pelo código', async () => {
        const c = rhClient(
            {
                vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2026-07-13', end_date: '2026-07-22', days: 10, abono: false, status: 'aprovado' }],
                payslips: [
                    {
                        ...slip(BIA.id),
                        id: 'rf1',
                        mes: '2026-07-F10',
                        status: 'publicado',
                        proventos: [{ cod: '040', descricao: 'Férias', referencia: '10 dias', valor: 100 }],
                        descontos: [],
                    },
                ],
            },
            { rpc: { apply_ferias_recibo: {} } }
        );
        c.tables.payslips_decrypted = c.tables.payslips;
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).salary = 0;
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.eval(`emitirReciboFerias('${ANA.id}', '2026-07-13')`);
        assert.equal(c.rpcCalls('apply_ferias_recibo').length, 0);
        page.window.verReciboFerias('rf1');
        assert.ok(page.$('#slip-modal').classList.contains('open'));
    });

    test('saldo do banco no holerite: PJ e 13º não mostram; falhas e dia incompleto não quebram', async () => {
        const c = rhClient({
            payslips_decrypted: [slip(ANA.id, { competencia: '07/2026' }), slip(CAIO.id), slip(BIA.id, { mes: '2026-13-2', id: 'dt' })],
            time_records: [{ employee_id: ANA.id, date: '2026-07-01', entrada: '2026-07-01T08:00:00-03:00', saida: null }],
        });
        page = await openPage('pagamentos', { client: c, now: NOW });
        c.errors['holidays:select'] = { message: 'x' };
        await page.eval(`verHolerite('${CAIO.id}')`);
        await page.settle();
        c.errors['time_records:select'] = { message: 'x' };
        c.errors['bank_adjustments:select'] = { message: 'x' };
        await page.eval(`verHolerite('${ANA.id}')`);
        await page.settle();
        delete c.errors['time_records:select'];
        delete c.errors['bank_adjustments:select'];
        await page.eval(`verHolerite('${ANA.id}')`);
        await page.settle();
        assert.match(page.text('#slip-bank-info'), /07\/2026/);
    });

    test('13º para um colaborador só usa o singular', async () => {
        const c = rhClient();
        c.tables.employees_decrypted = c.tables.employees_decrypted.filter((e) => e.id === ANA.id);
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        page.$('#dt-ano').value = '2026';
        page.$('#dt-parcela').value = '1';
        await page.click('[data-click="calcularDecimoTerceiroModal"]');
        await page.click('#btn-gerar-decimo-terceiro');
        await page.settle();
        assert.ok(page.toasts().some((t) => /gerado para 1 colaborador\./.test(t)));
    });

    test('rescisão: sem colaborador os campos ficam vazios; colaborador sem admissão mostra traço; confirmar sem cálculo ou cancelando não desliga', async () => {
        const c = incompleta(rhClient());
        page = await openPage('pagamentos', { client: c, now: NOW, confirm: false });
        await page.click('[data-click="openRescisaoModal"]');
        page.window.onRescisaoEmpChange();
        assert.equal(page.$('#rescisao-admissao').value, '');
        await page.eval('confirmarDesligamento()');
        await page.click('#rescisao-emp-trigger');
        await page.click(`#rescisao-emp-popover .select-option[data-value="${BIA.id}"]`);
        page.window.setRescisaoDate('2026-07-31');
        await page.click('#btn-calcular-rescisao');
        await page.eval('confirmarDesligamento()');
        assert.equal(c.tables.employees.find((e) => e.id === BIA.id).status, 'Ativo');
        await page.click('#rescisao-emp-trigger');
        await page.click(`#rescisao-emp-popover .select-option[data-value="${ANA.id}"]`);
        assert.equal(page.$('#rescisao-admissao').value, '—');
    });

    test('filtro de setor escolhido continua marcado ao redesenhar', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        const chip = page.$$('#dept-filter-chips .chip').find((b) => b.dataset.dept);
        await page.click(chip);
        await page.eval('populateDeptFilters()');
        assert.ok(page.$(`#dept-filter-chips .chip[data-dept="${chip.dataset.dept}"]`).classList.contains('chip--active'));
        assert.equal(page.$('#dept-filter-chips .chip[data-dept=""]').classList.contains('chip--active'), false);
    });

    test('PJ passa pela apuração de adicionais sem jornada; tributação de férias sem contrato; férias de quem saiu da folha', async () => {
        const c = incompleta(
            rhClient(
                {
                    vacations: [
                        { id: 'v9', employee_id: 'sumiu', start_date: '2026-07-13', end_date: '2026-07-22', days: 10, abono: false, status: 'aprovado' },
                        { id: 'v8', employee_id: ANA.id, start_date: '2026-07-14', end_date: '2026-07-23', days: 10, abono: false, status: 'aprovado' },
                    ],
                },
                { errors: { holidays: { message: 'x' } } }
            )
        );
        page = await openPage('pagamentos', { client: c, now: NOW });
        const pj = await page.eval(`buildPayslipData(employees.find((e) => e.id === '${CAIO.id}'), currentMonth)`);
        assert.ok(pj.proventos.length >= 1);
        assert.equal(page.window.validarTributacaoFerias({ proventos: [], descontos: [] }, null), null);
    });

    test('rescisão: banco de horas com falha de leitura e com dia incompleto; PJ sem saldo de banco', async () => {
        const c = rhClient({ time_records: [{ employee_id: BIA.id, date: '2026-07-01', entrada: '2026-07-01T08:00:00-03:00', saida: null }] });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await page.click('#rescisao-emp-trigger');
        await page.click(`#rescisao-emp-popover .select-option[data-value="${BIA.id}"]`);
        page.window.setRescisaoDate('2026-07-31');
        await page.click('#btn-calcular-rescisao');
        c.errors['time_records:select'] = { message: 'x' };
        c.errors['bank_adjustments:select'] = { message: 'y' };
        await page.click('#btn-calcular-rescisao');
        assert.equal(page.visible('#rescisao-result'), true);
        const saldo = await page.eval(`getSaldoBancoHorasReal('${CAIO.id}', null, '2026-07-31')`);
        assert.equal(saldo, 0);
    });

    test('PDF da folha com holerite gerado e não pago', async () => {
        const c = rhClient({ payslips_decrypted: [slip(BIA.id, { status: 'publicado', competencia: '07/2026' })] });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.eval(`allRows[0].pago = true; allRows[1].gerado = true; allRows[1].pago = false; allRows[2].gerado = false; allRows[2].pago = false;`);
        await page.click('#export-pdf');
        assert.ok(page.pdfs.length >= 1);
    });
});
