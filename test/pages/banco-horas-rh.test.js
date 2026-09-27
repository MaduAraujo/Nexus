const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const dia = (employee_id, date, saida) => ({
    id: `tr-${employee_id}-${date}`,
    employee_id,
    date,
    entrada: `${date}T08:00:00-03:00`,
    saida_almoco: `${date}T12:00:00-03:00`,
    retorno_almoco: `${date}T13:00:00-03:00`,
    saida: `${date}T${saida}:00-03:00`,
});

function client(extra = {}) {
    const tables = baseTables({
        time_records: [
            dia(ANA.id, '2026-06-15', '19:00'),
            dia(ANA.id, '2026-06-16', '18:00'),
            dia(BIA.id, '2026-06-15', '15:00'),
            dia(CAIO.id, '2026-06-15', '18:00'),
        ],
        bank_adjustments: [
            { id: 'adj1', employee_id: ANA.id, tipo: 'debito', minutos: 30, date: '2026-06-10', justificativa: 'Saída antecipada', deleted_at: null },
        ],
        bank_requests: [
            {
                id: 'br1',
                employee_id: BIA.id,
                origem: 'colaborador',
                tipo: 'credito',
                minutos: 60,
                date: '2026-06-12',
                status: 'pendente',
                requires_approval_from: 'rh',
                created_at: '2026-06-12T18:00:00Z',
                employees: { name: BIA.name, dept: BIA.dept },
            },
            {
                id: 'br2',
                employee_id: ANA.id,
                origem: 'rh',
                tipo: 'debito',
                minutos: 15,
                date: '2026-06-01',
                status: 'aprovado',
                requires_approval_from: 'gestor',
                created_at: '2026-06-01T18:00:00Z',
                employees: { name: ANA.name, dept: ANA.dept },
            },
        ],
        holidays: [{ id: 'h1', date: '2026-06-04', name: 'Corpus Christi', abrangencia: 'nacional' }],
        vacations: [],
        hr_settings: [{ id: 1, banco_horas_vencimento_meses: 6, limite_extra_diario_min: 120 }],
        activity_logs: [],
        ...extra,
    });
    tables.employees_decrypted.forEach((e) => {
        e.contractType = e.contract_type;
        e.managerId = e.manager_id;
    });
    return new FakeSupabase({
        user: RH_USER,
        tables,
        rpc: {
            approve_bank_request: ({ p_request_id, p_decision, p_obs }, c) => {
                const r = c.tables.bank_requests.find((x) => x.id === p_request_id);
                Object.assign(r, { status: p_decision, decision_obs: p_obs || null });
                if (p_decision === 'aprovado')
                    c.tables.bank_adjustments.push({
                        id: 'adj-new',
                        employee_id: r.employee_id,
                        tipo: r.tipo,
                        minutos: r.minutos,
                        date: r.date,
                        deleted_at: null,
                    });
                return {};
            },
        },
    });
}

const rowOf = (p, name) => p.$$('#banco-tbody tr').find((tr) => tr.textContent.includes(name));

describe('banco-horas-rh.html — saldos', () => {
    test('saldo do mês por colaborador: extras, faltas, ajustes; PJ sem saldo', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        assert.match(page.text(rowOf(page, 'Ana Souza')), /\+3h 00min.*0h 00min.*\+2h 30min/);
        assert.match(page.text(rowOf(page, 'Bia Lima')), /-2h 00min/);
        assert.match(page.text(rowOf(page, 'Caio Prado')), /—/);
        assert.equal(page.text('#kpi-total-extras'), '3h 00min');
        assert.equal(page.text('#kpi-total-faltas'), '2h 00min');
    });

    test('filtros positivo/negativo e busca', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        await page.click('[data-filter="negativo"]');
        assert.equal(page.$$('#banco-tbody tr').length, 1);
        assert.ok(rowOf(page, 'Bia Lima'));
        await page.click('[data-filter="todos"]');
        await page.fill('#search-input', 'ti');
        assert.equal(page.text('#table-count'), '1 colaborador exibido');
    });

    test('detalhe do colaborador mostra os dias e o ajuste; excluir ajuste pede confirmação e audita', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        assert.match(page.text('#detail-body'), /15\/06/);
        assert.match(page.text('#detail-body'), /Saída antecipada/);

        page.window.confirm = () => false;
        await page.click('#detail-body [data-click="deleteAjuste"]');
        assert.equal(c.writes('bank_adjustments', 'update').length, 0, 'cancelou: nada muda');

        page.window.confirm = () => true;
        await page.click('#detail-body [data-click="deleteAjuste"]');
        assert.ok(c.tables.bank_adjustments[0].deleted_at);
        assert.equal(c.writes('activity_logs', 'insert')[0].payload[0].acao, 'exclusao');
    });

    test('falha ao excluir ajuste não gera registro de auditoria', async () => {
        const c = client();
        c.errors['bank_adjustments:update'] = { message: 'RLS' };
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        await page.click('#detail-body [data-click="deleteAjuste"]');
        assert.equal(c.writes('activity_logs', 'insert').length, 0);
        assert.ok(page.toasts().includes('Não foi possível excluir o ajuste.'));
    });
});

describe('banco-horas-rh.html — ajustes e solicitações', () => {
    test('lançar ajuste vira solicitação para o gestor (quando há gestor)', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openAdjustModal"]'));
        await page.fill('#adjust-horas', '1');
        await page.fill('#adjust-min', '30');
        await page.fill('#adjust-just', 'Evento no sábado');
        assert.equal(page.$('#adjust-submit-btn').disabled, false);
        await page.click('#adjust-submit-btn');
        const req = c.writes('bank_requests', 'insert')[0].payload[0];
        assert.deepEqual([req.minutos, req.tipo, req.requires_approval_from, req.manager_id_snapshot, req.origem], [90, 'credito', 'gestor', BIA.id, 'rh']);
        assert.match(page.toasts()[0], /aguardando aprovação do gestor/);
    });

    test('crédito acima do limite diário de extras é bloqueado', async () => {
        const c = client({ bank_adjustments: [{ id: 'x', employee_id: ANA.id, tipo: 'credito', minutos: 90, date: '2026-06-17', deleted_at: null }] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openAdjustModal"]'));
        await page.fill('#adjust-horas', '1');
        await page.fill('#adjust-just', 'Mais horas');
        await page.click('#adjust-submit-btn');
        assert.match(page.text('#adjust-alert'), /Limite legal de horas extras diárias excedido/);
        assert.equal(c.writes('bank_requests', 'insert').length, 0);
    });

    test('solicitações: aprovar via RPC; rejeitar exige motivo', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        assert.equal(page.text('#tab-badge-solicitacoes'), '1');
        await page.click('[data-tab="solicitacoes"]');
        assert.equal(page.$$('#requests-tbody tr').length, 1, 'filtro padrão: pendentes');
        await page.click('#requests-tbody [data-click="approveRequest"]');
        assert.deepEqual(c.rpcCalls('approve_bank_request')[0].args.p_decision, 'aprovado');
        assert.equal(c.tables.bank_requests[0].status, 'aprovado');

        c.tables.bank_requests.push({
            id: 'br3',
            employee_id: ANA.id,
            origem: 'colaborador',
            tipo: 'credito',
            minutos: 30,
            date: '2026-06-16',
            status: 'pendente',
            requires_approval_from: 'rh',
            created_at: '2026-06-16T18:00:00Z',
            employees: { name: ANA.name },
        });
        await page.eval('loadBankRequests().then(renderRequestsTab)');
        await page.settle();
        await page.click('#requests-tbody [data-click="openRejectRequestModal"]');
        await page.click('[data-click="confirmRejectRequest"]');
        assert.match(page.text('#reject-request-alert'), /Informe o motivo/);
        await page.fill('#reject-request-obs', 'Sem comprovante');
        await page.click('[data-click="confirmRejectRequest"]');
        assert.deepEqual([c.tables.bank_requests[2].status, c.tables.bank_requests[2].decision_obs], ['rejeitado', 'Sem comprovante']);
    });
});

describe('banco-horas-rh.html — feriados, configurações e exportação', () => {
    test('cadastrar e excluir feriado (com confirmação)', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('#btn-holidays');
        assert.match(page.text('#holidays-list'), /04\/06\/2026 Corpus Christi/);
        page.eval(`holidayDateField.setValue('2026-11-20')`);
        await page.fill('#holiday-name', 'Consciência Negra');
        await page.click('[data-click="submitHoliday"]');
        assert.deepEqual(c.writes('holidays', 'insert')[0].payload[0], { date: '2026-11-20', name: 'Consciência Negra', abrangencia: 'nacional' });

        await page.click('#holidays-list [data-click="deleteHoliday"][data-click-args*="h1"]');
        assert.equal(c.writes('holidays', 'delete').length, 1);
        assert.doesNotMatch(page.text('#holidays-list'), /Corpus Christi/);
    });

    test('configurações aceitam limite zero de extras (não volta para o padrão)', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('#btn-settings');
        page.$('#settings-limite-extra').value = '0';
        await page.click('[data-click="submitSettings"]');
        assert.equal(c.tables.hr_settings[0].limite_extra_diario_min, 0);
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openAdjustModal"]'));
        await page.fill('#adjust-min', '10');
        await page.fill('#adjust-just', 'x');
        await page.click('#adjust-submit-btn');
        assert.match(page.text('#adjust-alert'), /limite de 0h 00min\/dia/);
    });

    test('exporta CSV e PDF e registra a exportação', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('#export-csv-btn');
        await page.click('#export-pdf-btn');
        await page.settle(20);
        assert.ok(c.rpcCalls('report_data_export').length >= 1);
        assert.ok(page.objectUrls.length + page.pdfs.length + page.opened.length >= 2);
    });
});

describe('banco-horas-rh.html — vencimento, avisos, auditoria e tempo real', () => {
    const extras = (employee_id, date) => dia(employee_id, date, '20:00');

    test('crédito antigo não compensado vence (prazo de 6 meses): KPI, aviso e filtro de vencidos', async () => {
        const c = client({ time_records: [extras(ANA.id, '2025-10-06'), extras(ANA.id, '2025-10-07'), dia(ANA.id, '2026-06-15', '17:00')] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        assert.equal(page.text('#kpi-count-vencido'), '1');
        assert.match(page.text('#notif-panel-body'), /1 colaborador com banco de horas vencido/);
        assert.match(page.text('#notif-panel-body'), /1 solicitação de banco de horas pendente/);
        await page.click('#notif-panel-body [data-click="goToVencidos"]');
        assert.deepEqual(
            page.$$('#banco-tbody tr').map((tr) => tr.textContent.includes('Ana Souza')),
            [true]
        );
        await page.click('#notif-panel-body [data-click="goToSolicitacoes"]');
        assert.equal(page.$('#tab-solicitacoes').classList.contains('active'), true);
    });

    test('saldo crítico (mais de 20h negativas) aparece nos avisos', async () => {
        const c = client({
            bank_adjustments: [
                { id: 'adjc', employee_id: ANA.id, tipo: 'debito', minutos: 1500, date: '2026-06-02', justificativa: 'Faltas', deleted_at: null },
            ],
        });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        assert.match(page.text('#notif-panel-body'), /1 colaborador em saldo crítico/);
        await page.click('#notif-panel-body [data-click="goToCriticos"]');
        assert.ok(page.$$('#banco-tbody tr').every((tr) => tr.textContent.includes('Ana Souza')));
    });

    test('aba de auditoria lista batidas e ajustes com operador; filtros por tipo e colaborador; vazio', async () => {
        const c = client({
            activity_logs: [
                {
                    id: 'l1',
                    employee_id: ANA.id,
                    tipo: 'ponto',
                    acao: 'entrada',
                    date: '2026-06-15',
                    valor_registrado: '2026-06-15T08:02:00-03:00',
                    operator_name: 'Ana Souza',
                    operator_profile: 'colaborador',
                    created_at: '2026-06-15T11:02:00Z',
                    employees: { name: ANA.name, dept: ANA.dept },
                },
                {
                    id: 'l2',
                    employee_id: BIA.id,
                    tipo: 'ajuste_banco',
                    acao: 'credito',
                    minutos: 90,
                    date: '2026-06-12',
                    operator_name: 'RH Admin',
                    operator_profile: 'Administrador',
                    justificativa: 'Evento no sábado',
                    created_at: '2026-06-12T20:00:00Z',
                    employees: { name: BIA.name, dept: BIA.dept },
                },
            ],
        });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('.tab-btn[data-tab="auditoria"]');
        await page.settle();
        assert.equal(page.text('#audit-count'), '2 registros encontrados');
        assert.match(page.text('#audit-tbody'), /Ana Souza.*Ponto.*Entrada.*08:02.*Colaborador/);
        assert.match(page.text('#audit-tbody'), /Bia Lima.*Banco.*Crédito.*\+1h 30min.*RH Admin.*RH.*Evento no sábado/);

        await page.click('#audit-filter-dropdown-menu [data-audit-tipo="ajuste_banco"]');
        await page.settle();
        assert.equal(page.text('#audit-count'), '1 registro encontrado');
        assert.equal(page.text('#audit-filter-label'), 'Ajustes de Banco');

        await page.click(`#audit-emp-chips [data-emp-id="${ANA.id}"]`);
        await page.settle();
        assert.match(page.text('#audit-tbody'), /Nenhum registro de auditoria encontrado/);
    });

    test('tempo real: nova solicitação atualiza o selo; feriado novo recarrega a lista aberta', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        assert.equal(page.text('#tab-badge-solicitacoes'), '1');
        c.tables.bank_requests.push({
            id: 'br3',
            employee_id: ANA.id,
            origem: 'colaborador',
            tipo: 'credito',
            minutos: 30,
            date: '2026-06-16',
            status: 'pendente',
            requires_approval_from: 'rh',
            created_at: '2026-06-16T18:00:00Z',
            employees: { name: ANA.name, dept: ANA.dept },
        });
        c.emit('bank_requests', { eventType: 'INSERT', new: { id: 'br3' } });
        await page.waitFor(() => page.text('#tab-badge-solicitacoes') === '2');

        page.window.openHolidaysModal();
        c.tables.holidays.push({ id: 'h2', date: '2026-06-20', name: 'Feriado municipal', abrangencia: 'municipal' });
        c.emit('holidays', { eventType: 'INSERT', new: { id: 'h2' } });
        await page.waitFor(() => /Feriado municipal/.test(page.text('#holidays-modal')));
    });
});
