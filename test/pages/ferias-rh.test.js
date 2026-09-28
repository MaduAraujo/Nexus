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
        rpc: { apply_ferias_recibo: {}, revert_ferias_recibo: {}, revert_ferias_payroll_event: {} },
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
    test('aprovar grava a decisão e emite o recibo de férias com INSS/IRRF, a pagar 2 dias antes (CLT)', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-30', 'pendente')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));

        assert.equal(status(client, 'v1'), 'aprovado');
        const saved = client.tables.vacations[0];
        assert.equal(saved.decided_by_email, RH_USER.email);
        const [evento] = client.rpcCalls('apply_ferias_recibo');
        assert.equal(evento.args.p_employee_id, ANA.id);
        assert.equal(evento.args.p_mes, '2026-07-F01');
        assert.equal(evento.args.p_competencia, '07/2026');
        assert.deepEqual(
            evento.args.p_proventos.map((p) => p.cod),
            ['040', '041']
        );
        assert.equal(evento.args.p_proventos[0].valor, 4000);
        assert.equal(evento.args.p_proventos[1].valor, 1333.33);
        assert.deepEqual(
            evento.args.p_descontos.map((d) => d.cod),
            ['901', '906']
        );
        assert.deepEqual(page.toasts(), ['Solicitação aprovada com sucesso!']);
    });

    test('com abono, o recibo paga os 20 dias de gozo registrados + os 10 vendidos', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente', { abono: true })]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));
        const proventos = client.rpcCalls('apply_ferias_recibo')[0].args.p_proventos;
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

    test('ao abrir, emite o recibo das férias futuras aprovadas pelo gestor (a RPC ignora as já emitidas)', async () => {
        const client = rhClient([
            vac('v1', ANA.id, '2026-07-01', '2026-07-10', 'aprovado'),
            vac('v2', BIA.id, '2026-05-01', '2026-05-10', 'concluido'),
            vac('v3', CAIO.id, '2026-08-01', '2026-08-10', 'aprovado'),
        ]);
        page = await openPage('ferias', { client, now: NOW });
        assert.deepEqual(
            client.rpcCalls('apply_ferias_recibo').map((c) => [c.args.p_employee_id, c.args.p_mes]),
            [[ANA.id, '2026-07-F01']]
        );
    });

    test('recesso de estagiário não gera recibo de férias ao aprovar', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-15', 'pendente')]);
        for (const t of ['employees', 'employees_decrypted']) {
            const ana = client.tables[t].find((e) => e.id === ANA.id);
            if (ana) ana.contract_type = 'estagio';
        }
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));
        assert.equal(status(client, 'v1'), 'aprovado');
        assert.equal(client.rpcCalls('apply_ferias_recibo').length, 0);
    });

    test('PJ não gera evento de folha ao aprovar', async () => {
        const client = rhClient([vac('v1', CAIO.id, '2026-07-01', '2026-07-10', 'pendente')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click(rowOf(page, 'v1').querySelector('[data-click="approveRequest"]'));
        assert.equal(status(client, 'v1'), 'aprovado');
        assert.equal(client.rpcCalls('apply_ferias_recibo').length, 0);
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
        assert.equal(client.rpcCalls('apply_ferias_recibo').length, 1, 'só a CLT gera evento');
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
        assert.equal(client.rpcCalls('apply_ferias_recibo').length, 0);
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

    test('com abono, o período cadastrado (só o gozo) vai até 20 dias', async () => {
        const client = rhClient([]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click('[data-click="openAddModal"]');
        await pick(page, 'add-employee', ANA.id);
        await page.settle(30);
        page.eval(`setDatePickerValue('add-start', '2026-08-03'); setDatePickerValue('add-end', '2026-08-23'); calcAddDays();`);
        await page.check('#add-abono');
        await page.click('#btn-add-submit');
        assert.match(page.text('#add-alert'), /descanso é de no máximo 20 dias/);
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

describe('ferias.html (RH) — cobertura, indicadores e visões', () => {
    test('cobertura por departamento: mais de 30% da equipe fora ao mesmo tempo é risco', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-10', 'aprovado'), vac('v2', BIA.id, '2026-07-05', '2026-07-15', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click('.tab-btn[data-tab="calendar"]');
        await page.settle();
        const fin = page.$$('#cobertura-wrap .cobertura-item').find((el) => /Financeiro/.test(el.textContent));
        assert.match(page.text(fin), /2\/2/);
        assert.ok(fin.classList.contains('cobertura-item--risk'));
        const ti = page.$$('#cobertura-wrap .cobertura-item').find((el) => /TI/.test(el.textContent));
        assert.ok(!ti.classList.contains('cobertura-item--risk'));
    });

    test('indicadores abrem a lista: pendentes, saindo em 15 dias e em férias hoje', async () => {
        const client = rhClient([
            vac('v1', ANA.id, '2026-06-25', '2026-07-04', 'aprovado'),
            vac('v2', BIA.id, '2026-06-10', '2026-06-20', 'aprovado'),
            vac('v3', CAIO.id, '2026-08-01', '2026-08-10', 'pendente'),
        ]);
        page = await openPage('ferias', { client, now: NOW });
        page.window.openKpiModal('upcoming');
        assert.match(page.text('#kpi-info-body'), /Ana Souza.*sai em 25\/06\/2026.*10d/);
        page.window.openKpiModal('ativas');
        assert.match(page.text('#kpi-info-body'), /Bia Lima.*volta em 20\/06\/2026.*3d/);
        page.window.openKpiModal('pendente');
        assert.match(page.text('#kpi-info-body'), /Caio Prado/);
        page.window.openKpiModal('inexistente');
        const vazio = rhClient([]);
        page.close();
        page = await openPage('ferias', { client: vazio, now: NOW });
        page.window.openKpiModal('ativas');
        assert.match(page.text('#kpi-info-body'), /Nenhum registro no momento/);
    });

    test('férias vencidas: lista quem passou do período concessivo, do maior atraso para o menor', async () => {
        const client = rhClient([]);
        for (const t of ['employees', 'employees_decrypted']) {
            const ana = client.tables[t].find((e) => e.id === ANA.id);
            if (ana) ana.admission_date = '2023-01-10';
        }
        page = await openPage('ferias', { client, now: NOW });
        page.window.openExpiredModal();
        assert.match(page.text('#expired-body'), /Bia Lima.*vencida desde 09\/05\/2024 90d.*Ana Souza.*vencida desde 09\/01\/2025 60d/);
    });

    test('ver solicitação mostra a fração do ciclo; editar preenche o formulário', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-15', 'aprovado', { obs: 'Viagem' })]);
        page = await openPage('ferias', { client, now: NOW });
        page.window.openViewModal('v1');
        assert.match(page.text('#view-modal'), /Ana Souza.*Financeiro.*01\/07\/2026.*15\/07\/2026/);
        page.window.openEditModal('v1');
        assert.equal(page.text('#add-modal-title'), 'Editar Solicitação');
        assert.equal(page.$('#add-obs').value, 'Viagem');
        assert.equal(page.$('#add-start').value, '2026-07-01');
        page.window.openViewModal('nao-existe');
        page.window.openEditModal('nao-existe');
    });

    test('exportar para agenda: arquivo .ics com o fim exclusivo e link do Google Agenda', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-15', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW });
        page.window.downloadIcs('v1');
        assert.equal(page.downloads.at(-1).name, 'ferias_Ana_Souza.ics');
        page.window.openGoogleCalendar('v1');
        const url = page.opened.at(-1).url;
        assert.match(url, /dates=20260701\/20260716/, 'fim exclusivo: 15/07 + 1 dia');
        assert.match(decodeURIComponent(url), /Férias — Ana Souza/);
    });
});

describe('ferias.html (RH) — coletivas e lote', () => {
    test('coletiva abaixo de 10 dias é recusada (CLT art. 139 §1º); estagiário fica de fora', async () => {
        const client = rhClient([]);
        for (const t of ['employees', 'employees_decrypted']) {
            const bia = client.tables[t].find((e) => e.id === BIA.id);
            if (bia) bia.contract_type = 'estagio';
        }
        page = await openPage('ferias', { client, now: NOW });
        await page.click('[data-click="openColetivaModal"]');
        await pick(page, 'coletiva-dept', 'Financeiro');
        page.eval(`setDatePickerValue('coletiva-start', '2026-12-22'); setDatePickerValue('coletiva-end', '2026-12-27'); updateColetivaSubmitState();`);
        await page.settle();
        await page.click('#btn-coletiva-submit');
        assert.match(page.text('#coletiva-alert'), /mínimo 10 dias corridos/);
        assert.equal(client.writes('vacations', 'insert').length, 0);

        page.eval(`setDatePickerValue('coletiva-end', '2026-12-31'); updateColetivaSubmitState();`);
        await page.settle();
        await page.click('#btn-coletiva-submit');
        assert.deepEqual(
            client.writes('vacations', 'insert')[0].payload.map((r) => r.employee_id),
            [ANA.id],
            'estagiária (recesso) não entra na coletiva'
        );
    });

    test('coletiva: data final antes da inicial e departamento sem ninguém elegível', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-12-20', '2026-12-31', 'aprovado'), vac('v2', BIA.id, '2026-12-20', '2026-12-31', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW });
        await page.click('[data-click="openColetivaModal"]');
        await pick(page, 'coletiva-dept', 'Financeiro');
        page.eval(`setDatePickerValue('coletiva-start', '2026-12-31'); setDatePickerValue('coletiva-end', '2026-12-20'); updateColetivaSubmitState();`);
        await page.settle();
        page.window.submitColetiva();
        await page.settle();
        assert.match(page.text('#coletiva-alert'), /Data de fim deve ser após a data de início/);
        page.eval(`setDatePickerValue('coletiva-start', '2026-12-20'); setDatePickerValue('coletiva-end', '2026-12-31');`);
        await page.window.submitColetiva();
        assert.match(page.text('#coletiva-alert'), /já possuem férias no período/);
    });

    test('aprovar em lote com conflito de equipe pede confirmação e cita os nomes; recusar em lote pede motivo', async () => {
        const client = rhClient([
            vac('v1', ANA.id, '2026-07-01', '2026-07-10', 'pendente'),
            vac('v2', BIA.id, '2026-07-05', '2026-07-12', 'aprovado'),
            vac('v3', CAIO.id, '2026-08-01', '2026-08-10', 'pendente'),
        ]);
        page = await openPage('ferias', { client, now: NOW, confirm: false });
        await page.check(rowOf(page, 'v1').querySelector('input[type="checkbox"]'));
        await page.window.bulkApprove();
        assert.match(page.confirms.at(-1), /1 das solicitações selecionadas têm conflito de equipe.*Ana Souza/);
        assert.equal(status(client, 'v1'), 'pendente');

        page.window.bulkReject();
        assert.equal(page.$('#reject-modal').classList.contains('open'), true);
        assert.match(page.text('#reject-sub'), /1 solicitações selecionadas/);
    });

    test('erro do banco ao aprovar em lote avisa e não emite recibo', async () => {
        const client = rhClient([vac('v3', CAIO.id, '2026-08-01', '2026-08-10', 'pendente'), vac('v4', ANA.id, '2026-09-01', '2026-09-10', 'pendente')]);
        page = await openPage('ferias', { client, now: NOW, confirm: true });
        client.errors['vacations:update'] = { message: 'falhou' };
        await page.check(rowOf(page, 'v4').querySelector('input[type="checkbox"]'));
        await page.window.bulkApprove();
        assert.ok(page.toasts().includes('Erro ao aprovar em lote.'));
        assert.equal(client.rpcCalls('apply_ferias_recibo').length, 0);
    });
});

describe('ferias.html (RH) — painel do cadastro manual e validações', () => {
    const setEmp = (client, id, campos) => {
        for (const t of ['employees', 'employees_decrypted']) {
            const e = client.tables[t].find((x) => x.id === id);
            if (e) Object.assign(e, campos);
        }
    };
    async function abrirCadastro(client, empId) {
        page = await openPage('ferias', { client, now: NOW });
        await page.click('[data-click="openAddModal"]');
        if (empId) await pick(page, 'add-employee', empId);
        await page.settle(30);
    }

    test('painel mostra frações do ciclo e o direito; idade não impede fracionar (art. 134 §2º revogado em 2017)', async () => {
        const client = rhClient([]);
        setEmp(client, ANA.id, { birth_date: '1970-03-01' });
        await abrirCadastro(client, ANA.id);
        const info = page.$('#add-emp-ferias-info');
        assert.match(page.text(info), /Ciclo atual: 0\/3 frações utilizadas/);
        assert.match(page.text(info), /direito a 30 dias neste ciclo/);
        assert.doesNotMatch(page.text(info), /período único/);
        assert.ok(!info.classList.contains('negativo'));
    });

    test('estagiário: recesso sem abono no painel e abono desabilitado', async () => {
        const client = rhClient([]);
        setEmp(client, ANA.id, { contract_type: 'estagio' });
        await abrirCadastro(client, ANA.id);
        assert.match(page.text('#add-emp-ferias-info'), /estagiário\/aprendiz: recesso remunerado, sem abono pecuniário/);
        assert.equal(page.$('#add-abono').disabled, true);
    });

    test('saldo do banco de horas usa a jornada do contrato (44h = 8h48 por dia)', async () => {
        const dia = (d, saida) => ({
            employee_id: ANA.id,
            date: `2026-06-${d}`,
            entrada: `2026-06-${d}T08:00:00-03:00`,
            saida_almoco: `2026-06-${d}T12:00:00-03:00`,
            retorno_almoco: `2026-06-${d}T13:00:00-03:00`,
            saida: `2026-06-${d}T${saida}:00-03:00`,
        });
        const client = rhClient([]);
        client.tables.time_records.push(dia('15', '17:48'), dia('16', '18:18'));
        client.tables.bank_adjustments.push({ employee_id: ANA.id, tipo: 'debito', minutos: 10, date: '2026-06-10', deleted_at: null });
        setEmp(client, ANA.id, { work_load: '44h' });
        await abrirCadastro(client, ANA.id);
        assert.match(page.text('#add-emp-saldo-info'), /\+0h 20min/, '30 min extras − 10 de débito; 8h48 cumpridas não contam');
        assert.ok(page.$('#add-emp-saldo-info').classList.contains('positivo'));
    });

    test('PJ não mostra saldo de banco de horas', async () => {
        await abrirCadastro(rhClient([]), CAIO.id);
        assert.ok(page.$('#add-emp-saldo-info').classList.contains('hidden'));
    });

    test('validações: sem colaborador, sem datas, fim antes do início', async () => {
        const client = rhClient([]);
        await abrirCadastro(client, null);
        await page.window.submitAdd();
        assert.match(page.text('#add-alert'), /Selecione um colaborador/);
        await pick(page, 'add-employee', ANA.id);
        await page.window.submitAdd();
        assert.match(page.text('#add-alert'), /Informe o período completo/);
        page.eval(`setDatePickerValue('add-start', '2026-08-20'); setDatePickerValue('add-end', '2026-08-10'); calcAddDays();`);
        assert.match(page.text('#add-days-count'), /Data de fim inválida/);
        await page.window.submitAdd();
        assert.match(page.text('#add-alert'), /Data de fim deve ser após a data de início/);
        assert.equal(client.writes('vacations', 'insert').length, 0);
    });

    test('editar grava no mesmo registro; erro do banco avisa', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-08-03', '2026-08-14', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW, confirm: true });
        page.window.openEditModal('v1');
        await page.settle(30);
        page.$('#add-obs').value = 'Remarcada';
        await page.window.submitAdd();
        await page.settle();
        const [upd] = client.writes('vacations', 'update');
        assert.equal(upd.payload.obs, 'Remarcada');
        assert.equal(client.writes('vacations', 'insert').length, 0);

        client.errors['vacations:update'] = { message: 'falhou' };
        page.window.openEditModal('v1');
        await page.settle(30);
        await page.window.submitAdd();
        assert.match(page.text('#add-alert') + page.toasts().join(' '), /Erro|erro/);
    });

    test('recibo com pop-up bloqueado avisa; exportar sem nada no filtro avisa', async () => {
        const client = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-10', 'aprovado')]);
        page = await openPage('ferias', { client, now: NOW, before: (w) => (w.open = () => null) });
        page.window.generateReceipt('v1');
        assert.ok(page.toasts().includes('Permita pop-ups para gerar o recibo.'));
        await page.fill('#search-input', 'ninguém com esse nome');
        page.window.exportVacationsCSV();
        assert.ok(page.toasts().includes('Nenhuma solicitação para exportar com o filtro atual.'));
    });
});
