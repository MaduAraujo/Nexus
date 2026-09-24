const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function vac(id, employee_id, start_date, end_date, status, extra = {}) {
    const days = Math.round((new Date(end_date) - new Date(start_date)) / 86400000) + 1;
    return { id, employee_id, start_date, end_date, days, status, abono: false, created_at: `2026-05-0${id.length}T10:00:00Z`, ...extra };
}

function rhClient(vacations, opts = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({ vacations, time_records: [], holidays: [], bank_adjustments: [] }),
        rpc: { apply_ferias_payroll_event: {}, revert_ferias_payroll_event: {} },
        ...opts,
    });
}

const rowOf = (p, id) => p.$(`#requests-tbody tr[data-id="${id}"]`);
const status = (client, id) => client.tables.vacations.find((v) => v.id === id).status;

async function pick(p, id, value) {
    await p.click(`#${id}-trigger`);
    await p.click(p.$(`#${id}-popover .select-option[data-value="${value}"]`));
}

describe('ferias.html (RH) — lista e indicadores', () => {
    test('lista as solicitações com nome, período, status e ações certas', async () => {
        const client = rhClient([
            vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente', { abono: true }),
            vac('v2', BIA.id, '2026-06-10', '2026-06-29', 'aprovado'),
            vac('v3', CAIO.id, '2026-03-01', '2026-03-10', 'recusado'),
        ]);
        page = await openPage('ferias', { client, now: NOW });
        assert.equal(page.$$('#requests-tbody tr').length, 3);
        assert.match(page.text(rowOf(page, 'v1')), /Ana Souza.*Financeiro.*01\/07\/2026 → 20\/07\/2026.*20.*Abono.*Pendente/);
        assert.ok(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));
        assert.ok(!rowOf(page, 'v2').querySelector('[data-click="approveRequest"]'));
        assert.ok(rowOf(page, 'v2').querySelector('[data-click="cancelApprovedVacation"]'));
        assert.equal(page.text('#kpi-pending'), '1');
        assert.equal(page.text('#table-count'), '3 solicitações encontradas');
    });

    test('filtro por status e busca por nome/departamento', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente'), vac('v2', CAIO.id, '2026-08-01', '2026-08-10', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click('.chip[data-filter="aprovado"]');
        assert.deepEqual(
            page.$$('#requests-tbody tr').map((r) => r.dataset.id),
            ['v2']
        );
        await page.click('.chip[data-filter="todos"]');
        await page.fill('#search-input', 'financ');
        assert.deepEqual(
            page.$$('#requests-tbody tr').map((r) => r.dataset.id),
            ['v1']
        );
    });

    test('férias aprovadas que já terminaram viram "concluído" no banco', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-05-01', '2026-05-20', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW });
        assert.equal(status(client, 'v1'), 'concluido');
        assert.match(page.text(rowOf(page, 'v1')), /Concluído/);
    });
});

describe('ferias.html (RH) — decisões', () => {
    test('aprovar grava a decisão e lança o adiantamento de férias na folha (CLT)', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-30', 'pendente')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));

        assert.equal(status(client, 'v1'), 'aprovado');
        const saved = client.tables.vacations[0];
        assert.equal(saved.decided_by_email, RH_USER.email);
        const [evento] = client.rpcCalls('apply_ferias_payroll_event');
        assert.equal(evento.args.p_employee_id, ANA.id);
        assert.equal(evento.args.p_mes, '2026-07');
        assert.equal(evento.args.p_competencia, '07/2026');
        assert.deepEqual(
            evento.args.p_novos_proventos.map((p) => p.cod),
            ['040', '041']
        );
        assert.equal(evento.args.p_novos_proventos[0].valor, 4000);
        assert.equal(evento.args.p_novos_proventos[1].valor, 1333.33);
        assert.deepEqual(page.toasts(), ['Solicitação aprovada com sucesso!']);
    });

    test('com abono, a folha paga 20 dias de férias + 10 de abono (não 30 + 10)', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-30', 'pendente', { abono: true })]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));
        const proventos = client.rpcCalls('apply_ferias_payroll_event')[0].args.p_novos_proventos;
        assert.deepEqual(
            proventos.map((p) => [p.cod, p.referencia, p.valor]),
            [
                ['040', '20 dias', 2666.67],
                ['041', '—', 888.89],
                ['042', '10 dias', 1333.33],
                ['043', '—', 444.44],
            ]
        );
    });

    test('ao abrir, lança na folha as férias futuras aprovadas pelo gestor (a RPC ignora as já lançadas)', async () => {
        const client = rhClient([
            vac('v1', ANA.id, '2026-07-01', '2026-07-10', 'aprovado'),
            vac('v2', BIA.id, '2026-05-01', '2026-05-10', 'concluido'),
            vac('v3', CAIO.id, '2026-08-01', '2026-08-10', 'aprovado'),
        ]);
        page = await openPage('ferias', { client, now: NOW });
        assert.deepEqual(
            client.rpcCalls('apply_ferias_payroll_event').map((c) => [c.args.p_employee_id, c.args.p_mes]),
            [[ANA.id, '2026-07']]
        );
    });

    test('PJ não gera evento de folha ao aprovar', async () => {
        const client = rhClient([vac('v1', CAIO.id, '2026-07-01', '2026-07-10', 'pendente')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));
        assert.equal(status(client, 'v1'), 'aprovado');
        assert.equal(client.rpcCalls('apply_ferias_payroll_event').length, 0);
    });

    test('conflito com colega do mesmo departamento pede confirmação; recusando, nada muda', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente'), vac('v2', BIA.id, '2026-07-10', '2026-07-25', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW, confirm: false });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));
        assert.match(page.confirms[0], /departamento "Financeiro" já está\(ão\) de férias no mesmo período:\nBia Lima/);
        assert.equal(status(client, 'v1'), 'pendente');
        assert.equal(client.writes('vacations', 'update').length, 0);
    });

    test('recusar exige motivo e grava o motivo', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="openRejectModal"]'));
        assert.equal(page.text('#reject-sub'), 'Colaborador: Ana Souza');
        await page.click('[data-click="confirmReject"]');
        assert.match(page.text('#reject-alert'), /Informe o motivo da recusa/);
        assert.equal(status(client, 'v1'), 'pendente');

        await page.fill('#reject-reason', 'Período de fechamento contábil');
        await page.click('[data-click="confirmReject"]');
        assert.equal(status(client, 'v1'), 'recusado');
        assert.equal(client.tables.vacations[0].rejection_reason, 'Período de fechamento contábil');
        assert.deepEqual(page.toasts(), ['Solicitação recusada.']);
    });

    test('aprovação em lote das selecionadas', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-10', 'pendente'), vac('v2', CAIO.id, '2026-09-01', '2026-09-10', 'pendente')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.check('#select-all-check');
        page.window.toggleSelectAll(true);
        await page.settle();
        assert.equal(page.text('#bulk-count'), '2 selecionadas');
        await page.click('[data-click="bulkApprove"]');
        assert.match(page.confirms[0], /Aprovar 2 solicitações selecionadas\?/);
        assert.equal(status(client, 'v1'), 'aprovado');
        assert.equal(status(client, 'v2'), 'aprovado');
        assert.equal(client.rpcCalls('apply_ferias_payroll_event').length, 1, 'só a CLT gera evento');
    });

    test('cancelar férias aprovadas desfaz o evento de folha', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="cancelApprovedVacation"]'));
        assert.equal(status(client, 'v1'), 'cancelado');
        assert.deepEqual(client.rpcCalls('revert_ferias_payroll_event')[0].args, { p_employee_id: ANA.id, p_mes: '2026-07' });
    });

    test('erro do banco ao aprovar avisa e mantém pendente', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente')], {
            errors: { 'vacations:update': { message: 'violação de RLS' } },
        });
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));
        assert.ok(page.toasts().includes('Erro ao aprovar.'));
        assert.equal(client.rpcCalls('apply_ferias_payroll_event').length, 0);
        assert.match(page.text(rowOf(page, 'v1')), /Pendente/);
    });
});

describe('ferias.html (RH) — cadastro manual e coletivas', () => {
    test('nova solicitação: valida mínimo de 5 dias e grava', async () => {
        const client = rhClient([]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click('[data-click="openAddModal"]');
        await pick(page, 'add-employee', ANA.id);
        page.eval(`setDatePickerValue('add-start', '2026-08-03'); setDatePickerValue('add-end', '2026-08-05'); calcAddDays();`);
        await page.settle();
        assert.equal(page.text('#add-days-count'), '3 dias de férias');
        await page.click('#btn-add-submit');
        assert.match(page.text('#add-alert'), /mínimo de férias é de 5 dias/);
        assert.equal(client.writes('vacations', 'insert').length, 0);

        page.eval(`setDatePickerValue('add-end', '2026-08-17'); calcAddDays();`);
        await page.settle();
        await page.click('#btn-add-submit');
        const [ins] = client.writes('vacations', 'insert');
        assert.deepEqual(
            { ...ins.payload[0], obs: undefined },
            {
                employee_id: ANA.id,
                start_date: '2026-08-03',
                end_date: '2026-08-17',
                days: 15,
                status: 'pendente',
                abono: false,
                obs: undefined,
                substituto_id: null,
            }
        );
        assert.ok(page.toasts().includes('Solicitação registrada!'));
    });

    test('abono pecuniário exige 20 dias ou mais', async () => {
        const client = rhClient([]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click('[data-click="openAddModal"]');
        await pick(page, 'add-employee', ANA.id);
        await page.settle(30);
        page.eval(`setDatePickerValue('add-start', '2026-08-03'); setDatePickerValue('add-end', '2026-08-17'); calcAddDays();`);
        await page.check('#add-abono');
        await page.click('#btn-add-submit');
        assert.match(page.text('#add-alert'), /abono pecuniário exige um período de 20 dias ou mais/);
        assert.equal(client.writes('vacations', 'insert').length, 0);
    });

    test('quarta fração no mesmo ciclo aquisitivo pede confirmação (CLT art. 134)', async () => {
        const client = rhClient([
            vac('v1', ANA.id, '2026-03-02', '2026-03-15', 'concluido'),
            vac('v2', ANA.id, '2026-04-06', '2026-04-10', 'concluido'),
            vac('v3', ANA.id, '2026-05-04', '2026-05-08', 'concluido'),
        ]);
        page = await openPage('ferias', { client, now: NOW, confirm: false });
        await page.click('[data-click="openAddModal"]');
        await pick(page, 'add-employee', ANA.id);
        page.eval(`setDatePickerValue('add-start', '2026-09-01'); setDatePickerValue('add-end', '2026-09-06'); calcAddDays();`);
        await page.settle();
        await page.click('#btn-add-submit');
        assert.match(page.confirms.at(-1), /já tem 3 frações de férias neste ciclo aquisitivo/);
        assert.equal(client.writes('vacations', 'insert').length, 0);
    });

    test('férias coletivas: cria para o departamento, pula quem já tem férias no período', async () => {
        const client = rhClient([vac('v1', BIA.id, '2026-12-20', '2026-12-31', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click('[data-click="openColetivaModal"]');
        await pick(page, 'coletiva-dept', 'Financeiro');
        page.eval(`setDatePickerValue('coletiva-start', '2026-12-22'); setDatePickerValue('coletiva-end', '2026-12-31'); updateColetivaSubmitState();`);
        await page.settle();
        await page.click('#btn-coletiva-submit');
        const [ins] = client.writes('vacations', 'insert');
        assert.deepEqual(
            ins.payload.map((r) => [r.employee_id, r.coletiva, r.status]),
            [[ANA.id, true, 'aprovado']]
        );
        assert.ok(page.toasts().some((t) => /registradas para 1 colaborador \(1 pulado por conflito de datas\)/.test(t)));
    });
});

describe('ferias.html (RH) — exportação e recibo', () => {
    test('exporta CSV e PDF e registra a exportação', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW });
        page.window.exportVacationsCSV();
        page.window.exportVacationsPDF();
        await page.settle();
        const csv = await page.objectUrls[0].text();
        assert.match(csv, /Ana Souza/);
        assert.match(page.opened[0].text(), /Calendário de Férias.*1 solicitação.*Ana Souza.*Financeiro/);
        assert.deepEqual(
            client.rpcCalls('report_data_export').map((c) => c.args.p_source),
            ['ferias.csv', 'ferias.pdf']
        );
    });

    test('recibo de férias aprovadas abre em PDF', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="generateReceipt"]'));
        assert.match(page.opened[0].text(), /Ana Souza/);
    });
});
