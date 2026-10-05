const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

const vac = (id, employee_id, status) => ({
    id,
    employee_id,
    start_date: '2026-08-03',
    end_date: '2026-08-12',
    days: 10,
    status,
    abono: false,
    created_at: '2026-05-01T10:00:00Z',
});

function rhClient(vacations) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({ vacations, time_records: [], holidays: [], bank_adjustments: [] }),
        rpc: { apply_ferias_recibo: {}, revert_ferias_recibo: {}, revert_ferias_payroll_event: {} },
    });
}

const status = (c, id) => c.tables.vacations.find((v) => v.id === id).status;
const mudou = (p) => p.toasts().some((t) => /mudou desde que a tela foi aberta/.test(t));

describe('ferias.html — decisão sobre solicitação que mudou enquanto a tela estava aberta', () => {
    test('aprovar férias que o colaborador já cancelou não as reativa', async () => {
        const c = rhClient([vac('v1', ANA.id, 'pendente')]);
        page = await openPage('ferias', { client: c, now: NOW, confirm: true });
        c.tables.vacations[0].status = 'cancelado';
        await page.window.approveRequest('v1');
        assert.equal(status(c, 'v1'), 'cancelado');
        assert.ok(mudou(page));
        assert.equal(c.rpcCalls('apply_ferias_recibo').length, 0, 'nenhum recibo de férias é gerado');
    });

    test('recusar férias que já foram aprovadas por outra pessoa não as recusa', async () => {
        const c = rhClient([vac('v1', ANA.id, 'pendente')]);
        page = await openPage('ferias', { client: c, now: NOW, confirm: true });
        c.tables.vacations[0].status = 'aprovado';
        page.window.openRejectModal('v1');
        page.$('#reject-reason').value = 'Equipe desfalcada';
        await page.window.confirmReject();
        assert.equal(status(c, 'v1'), 'aprovado');
        assert.ok(mudou(page));
    });

    test('cancelar férias aprovadas que já tinham sido canceladas não refaz o estorno', async () => {
        const c = rhClient([vac('v1', ANA.id, 'aprovado')]);
        page = await openPage('ferias', { client: c, now: NOW, confirm: true });
        c.tables.vacations[0].status = 'cancelado';
        await page.window.cancelApprovedVacation('v1');
        assert.ok(mudou(page));
        assert.equal(c.rpcCalls('revert_ferias_recibo').length, 0);
    });

    test('aprovação em lote aprova só o que continua pendente e avisa quantas mudaram', async () => {
        const c = rhClient([vac('v1', ANA.id, 'pendente'), vac('v2', BIA.id, 'pendente'), vac('v3', BIA.id, 'pendente')]);
        page = await openPage('ferias', { client: c, now: NOW, confirm: true });
        ['v1', 'v2', 'v3'].forEach((id) => page.window.toggleRowSelect(id, true));
        c.tables.vacations[1].status = 'cancelado';
        c.tables.vacations[2].status = 'cancelado';
        await page.window.bulkApprove();
        assert.deepEqual(
            ['v1', 'v2', 'v3'].map((id) => status(c, id)),
            ['aprovado', 'cancelado', 'cancelado']
        );
        assert.ok(page.toasts().some((t) => /2 solicitações mudaram desde que a tela foi aberta/.test(t)));
    });
});

describe('ferias.html — saldo do banco de horas ao trocar de colaborador', () => {
    test('a resposta atrasada de quem não está mais selecionado é ignorada', async () => {
        const c = rhClient([]);
        page = await openPage('ferias', { client: c, now: NOW });
        page.$('#add-employee').value = ANA.id;
        const pendente = page.eval('renderEmpSaldoBanco()');
        page.$('#add-employee').value = BIA.id;
        await pendente;
        assert.equal(page.text('#add-emp-saldo-info'), '');
    });
});
