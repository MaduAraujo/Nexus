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
        assert.match(page.text('#notif-panel-body'), /2 solicitações de banco de horas pendentes/);

        page.window.openHolidaysModal();
        c.tables.holidays.push({ id: 'h2', date: '2026-06-20', name: 'Feriado municipal', abrangencia: 'municipal' });
        c.emit('holidays', { eventType: 'INSERT', new: { id: 'h2' } });
        await page.waitFor(() => /Feriado municipal/.test(page.text('#holidays-modal')));
    });
});

describe('banco-horas-rh.html — detalhe do mês, dia a dia', () => {
    const ponto = (date, entrada, saida, extra = {}) => ({
        id: `tr-${ANA.id}-${date}`,
        employee_id: ANA.id,
        date,
        entrada: entrada ? `${date}T${entrada}:00-03:00` : null,
        saida_almoco: extra.semAlmoco || !entrada ? null : `${date}T12:00:00-03:00`,
        retorno_almoco: extra.semAlmoco || !entrada ? null : `${date}T13:00:00-03:00`,
        saida: saida ? `${date}T${saida}:00-03:00` : null,
        ...(extra.campos || {}),
    });
    const junho = [
        ponto('2026-06-01', null, null),
        ponto('2026-06-03', null, null),
        ponto('2026-06-04', null, null),
        ponto('2026-06-05', '08:00', '17:00', { campos: { entrada_selfie_path: 'emp-ana/2026-06-05-entrada.jpg' } }),
        ponto('2026-06-07', '08:00', '17:00'),
        ponto('2026-06-08', '14:00', '23:00', { semAlmoco: true }),
        ponto('2026-06-09', '08:00', null),
        ponto('2026-06-10', '08:00', '16:00'),
        ponto('2026-06-11', '08:00', '17:00'),
        ponto('2026-06-12', '08:00', '17:00', { campos: { ajustado: true } }),
        ponto('2026-06-15', '08:00', '20:30'),
    ];
    const cenario = () =>
        client({
            time_records: [...junho, dia(CAIO.id, '2026-06-05', '18:00')],
            vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2026-06-01', end_date: '2026-06-02', status: 'aprovado' }],
            holidays: [
                { id: 'h1', date: '2026-06-04', name: 'Corpus Christi', abrangencia: 'nacional' },
                { id: 'h2', date: '2026-06-11', name: 'Aniversário da cidade', abrangencia: 'municipal' },
            ],
        });
    const linhaDoDia = (p, ddmm) => p.$$('#detail-body .detail-table tbody tr').find((tr) => tr.textContent.startsWith(ddmm));

    test('cada dia mostra o status certo: férias, feriado, falta, domingo, noturno, intervalo, incompleto, ajustado e excesso', async () => {
        page = await openPage('banco-horas-rh', { client: cenario(), now: NOW });
        assert.match(page.text(rowOf(page, 'Ana Souza')), /1x 2h\+.*1x intervalo/);
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));

        assert.match(page.text(linhaDoDia(page, '01/06')), /Sem registros.*Férias/);
        assert.match(page.text(linhaDoDia(page, '03/06')), /Sem registros.*Falta/);
        assert.match(page.text(linhaDoDia(page, '04/06')), /Sem registros.*Feriado/);
        assert.equal(linhaDoDia(page, '04/06').querySelector('.badge-sm-feriado').title, 'Corpus Christi');
        assert.match(page.text(linhaDoDia(page, '05/06')), /Normal/);
        assert.match(page.text(linhaDoDia(page, '07/06')), /Normal Domingo/);
        assert.match(page.text(linhaDoDia(page, '08/06')), /\+1h 00min Extra Noturno Intervalo -1h 00min/);
        assert.match(page.text(linhaDoDia(page, '09/06')), /Incompleto/);
        assert.match(page.text(linhaDoDia(page, '10/06')), /-1h 00min Falta/);
        assert.match(linhaDoDia(page, '11/06').querySelector('.badge-sm-feriado').title, /Aniversário da cidade — adicional de 100%/);
        assert.match(page.text(linhaDoDia(page, '12/06')), /Ajustado/);
        assert.match(page.text(linhaDoDia(page, '15/06')), /\+3h 30min Excesso 2h\+/);

        assert.match(
            page.text('#detail-body'),
            /Intervalo intrajornada \(art\. 71 CLT\) não cumprido em 1 dia de Junho de 2026\. 1h 00min suprimidos — cerca de 1h 30min indenizáveis/
        );
    });

    test('PJ: dia trabalhado mostra as horas e o selo PJ, sem saldo nem gráfico de tendência', async () => {
        page = await openPage('banco-horas-rh', { client: cenario(), now: NOW });
        await page.click(rowOf(page, 'Caio Prado').querySelector('[data-click="openDetailModal"]'));
        assert.match(page.text('#detail-body'), /PJ — sem jornada fixa/);
        assert.match(page.text('#detail-body .detail-table tbody tr'), /9h 00min 9h 00min PJ/);
        assert.equal(page.$('#detail-trend-canvas'), null);
    });

    test('trocar o mês do detalhe busca os registros daquele mês; mês sem ponto mostra aviso', async () => {
        const c = cenario();
        c.tables.time_records.push(dia(ANA.id, '2026-05-20', '18:00'));
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        await page.click('#detail-month-trigger');
        assert.ok(page.$('#detail-month-popover').classList.contains('open'));
        await page.click('#detail-month-popover .select-option[data-value="2026-05"]');
        await page.waitFor(() => /Maio de 2026/.test(page.text('#detail-body')));
        assert.match(page.text('#detail-body .detail-table'), /20\/05\/2026/);

        await page.click('#detail-month-trigger');
        await page.click('#detail-month-popover .select-option[data-value="2026-04"]');
        await page.waitFor(() => /Abril de 2026/.test(page.text('#detail-body')));
        assert.match(page.text('#detail-body'), /Nenhum registro de ponto neste período/);
    });

    test('seletor de mês do detalhe fecha com clique fora, com Esc e ao clicar de novo no botão', async () => {
        page = await openPage('banco-horas-rh', { client: cenario(), now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        const aberto = () => page.$('#detail-month-popover').classList.contains('open');
        await page.click('#detail-month-trigger');
        assert.ok(aberto());
        await page.click('#detail-month-trigger');
        assert.ok(!aberto());
        await page.click('#detail-month-trigger');
        await page.click('#detail-body .detail-stats');
        assert.ok(!aberto());
        await page.click('#detail-month-trigger');
        await page.key('#detail-month-trigger', 'Escape');
        assert.ok(!aberto());
    });

    test('gráfico de tendência: gradiente, rótulo do tooltip e eixo em horas', async () => {
        page = await openPage('banco-horas-rh', { client: cenario(), now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        await page.settle();
        const chart = page.charts.at(-1);
        const ds = chart.config.data.datasets[0];
        assert.equal(ds.backgroundColor({ chart: {} }), 'rgba(99,102,241,.12)');
        const stops = [];
        const g = ds.backgroundColor({
            chart: { chartArea: { top: 0, bottom: 100 }, ctx: { createLinearGradient: () => ({ addColorStop: (...a) => stops.push(a) }) } },
        });
        assert.ok(g);
        assert.equal(stops.length, 2);
        assert.equal(chart.options.plugins.tooltip.callbacks.label({ parsed: { y: 2.5 } }), ' +2.5h');
        assert.equal(chart.options.plugins.tooltip.callbacks.label({ parsed: { y: -1 } }), ' -1h');
        assert.equal(chart.options.scales.y.ticks.callback(3), '3h');
    });

    test('selfie do registro: abre pelo NexusFiles e registra o acesso; falha avisa', async () => {
        const c = cenario();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        const abertos = [];
        page.window.NexusFiles.open = async (bucket, path) => {
            abertos.push([bucket, path]);
            return { error: abertos.length > 1 ? { message: 'x' } : null };
        };
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        await page.click('#detail-body [data-click="viewPontoSelfie"]');
        assert.deepEqual(abertos[0], ['ponto-selfies', 'emp-ana/2026-06-05-entrada.jpg']);
        await page.waitFor(() => c.writes('data_access_log', 'insert').length);
        const acesso = c.writes('data_access_log', 'insert')[0].payload[0];
        assert.deepEqual([acesso.employee_id, acesso.tipo], ['emp-ana', 'selfie_ponto']);
        await page.click('#detail-body [data-click="viewPontoSelfie"]');
        assert.ok(page.toasts().includes('Não foi possível abrir a selfie.'));
        assert.equal(c.writes('data_access_log', 'insert').length, 1);
    });

    test('novo ajuste a partir do detalhe fecha o detalhe e abre o ajuste; cancelar fecha', async () => {
        page = await openPage('banco-horas-rh', { client: cenario(), now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        await page.click('#detail-body [data-click="openAdjustModalFromDetail"]');
        assert.ok(!page.$('#detail-modal').classList.contains('open'));
        await page.waitFor(() => page.$('#adjust-modal').classList.contains('open'));
        assert.equal(page.text('#adjust-sub'), 'Ana Souza');
        await page.click('[data-click="closeAdjustModal"]');
        assert.ok(!page.$('#adjust-modal').classList.contains('open'));
    });
});

describe('banco-horas-rh.html — vencimento próximo e seus avisos', () => {
    test('crédito de janeiro vence em 1º de julho: KPI, selo, filtro e aviso no detalhe', async () => {
        const c = client({ time_records: [dia(ANA.id, '2026-01-12', '20:00'), dia(ANA.id, '2026-06-15', '17:00')] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        assert.equal(page.text('#kpi-count-vencendo'), '1');
        assert.match(page.text(rowOf(page, 'Ana Souza')), /Vencendo/);
        await page.click('[data-filter="vencendo"]');
        assert.deepEqual(
            page.$$('#banco-tbody tr').map((tr) => page.text(tr.querySelector('.emp-name'))),
            ['Ana Souza']
        );
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        assert.match(page.text('#detail-body'), /2h 30min do banco vencem em até 14 dias/);
    });

    test('crédito vencido aparece no detalhe como passivo trabalhista', async () => {
        const c = client({ time_records: [dia(ANA.id, '2025-10-06', '20:00'), dia(ANA.id, '2026-06-15', '17:00')] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        assert.match(page.text('#detail-body'), /Banco de horas vencido\. 2h 30min ultrapassaram o prazo de compensação de 6 meses \(art\. 59 §2º da CLT\)/);
    });
});

describe('banco-horas-rh.html — controles da tabela e exportação', () => {
    test('menu de exportar e filtro abrem e fecham um ao outro e com clique fora', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        const aberto = (id) => page.$(id).classList.contains('open');
        await page.click('#btn-export');
        assert.ok(aberto('#export-menu'));
        await page.click('#btn-filter');
        assert.ok(aberto('#filter-dropdown-menu'));
        assert.ok(!aberto('#export-menu'), 'abrir o filtro fecha a exportação');
        await page.click('#btn-export');
        assert.ok(aberto('#export-menu'));
        assert.ok(!aberto('#filter-dropdown-menu'), 'abrir a exportação fecha o filtro');
        await page.click('#btn-export');
        assert.ok(!aberto('#export-menu'));
        await page.click('#btn-filter');
        await page.click('#btn-filter');
        assert.ok(!aberto('#filter-dropdown-menu'));
    });

    test('busca sem resultado mostra a tabela vazia; limpar a busca volta a lista', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        await page.fill('#search-input', 'ninguém com esse nome');
        assert.match(page.text('#banco-tbody'), /Nenhum colaborador encontrado/);
        assert.equal(page.text('#table-count'), '');
        await page.click('#search-clear');
        assert.equal(page.$('#search-input').value, '');
        assert.ok(page.$('#search-clear').classList.contains('hidden'));
        assert.equal(page.$$('#banco-tbody tr').length, 3);
    });

    test('PDF: sem a biblioteca avisa; lista vazia escreve o aviso; muitas linhas quebram página', async () => {
        const muitos = Array.from({ length: 30 }, (_, i) => ({ ...ANA, id: `emp-x${i}`, name: `Pessoa ${String(i).padStart(2, '0')}`, manager_id: null }));
        const c = client();
        c.tables.employees_decrypted.push(...muitos.map((e) => ({ ...e, contractType: 'clt' })));
        page = await openPage('banco-horas-rh', { client: c, now: NOW });

        const jspdf = page.window.jspdf;
        page.window.jspdf = undefined;
        await page.click('#export-pdf-btn');
        assert.ok(page.toasts().includes('Biblioteca de PDF não carregada.'));
        page.window.jspdf = jspdf;

        await page.click('#export-pdf-btn');
        const cheio = page.pdfs.at(-1);
        assert.ok(
            cheio.calls.some(([m]) => m === 'addPage'),
            '33 linhas não cabem numa página'
        );

        await page.fill('#search-input', 'ninguém');
        await page.click('#export-pdf-btn');
        const vazio = page.pdfs.at(-1);
        assert.ok(vazio.calls.some(([m, a]) => m === 'text' && a[0] === 'Nenhum colaborador encontrado para os filtros atuais.'));
    });

    test('painel de avisos abre pelo sino e fecha com clique fora', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        assert.ok(page.$('#notif-panel').classList.contains('hidden'));
        await page.click('#btn-notif');
        assert.ok(!page.$('#notif-panel').classList.contains('hidden'));
        await page.click('#banco-tbody');
        assert.ok(page.$('#notif-panel').classList.contains('hidden'));
    });

    test('seletor de mês principal: navega entre anos, escolhe o mês e recarrega; fecha com Esc, clique fora e no botão', async () => {
        const c = client({ time_records: [dia(ANA.id, '2026-01-12', '19:00')] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        const aberto = () => page.$('#month-picker-dropdown').classList.contains('open');
        assert.equal(page.text('#month-picker-label'), 'Junho de 2026');

        await page.click('#month-picker-btn');
        assert.ok(aberto());
        assert.equal(page.text('#mpd-title'), 'Junho 2026');
        for (let i = 0; i < 6; i++) await page.click('#mpd-prev-month');
        assert.equal(page.text('#mpd-title'), 'Dezembro 2025');
        await page.click('#mpd-next-month');
        assert.equal(page.text('#mpd-title'), 'Janeiro 2026');
        await page.click('#mpd-grid .calendar-day:not(.calendar-day--muted)');
        assert.ok(!aberto());
        assert.equal(page.text('#month-picker-label'), 'Janeiro de 2026');
        await page.waitFor(() => /\+2h 00min/.test(page.text(rowOf(page, 'Ana Souza'))));

        await page.click('#month-picker-btn');
        await page.click('#month-picker-btn');
        assert.ok(!aberto());
        await page.click('#month-picker-btn');
        await page.click('#banco-tbody');
        assert.ok(!aberto());
        await page.click('#month-picker-btn');
        await page.key('#month-picker-btn', 'Escape');
        assert.ok(!aberto());

        await page.click('#month-picker-btn');
        for (let i = 0; i < 12; i++) await page.click('#mpd-next-month');
        assert.equal(page.text('#mpd-title'), 'Janeiro 2027');
    });

    test('Esc fecha os modais abertos', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        assert.ok(page.$('#detail-modal').classList.contains('open'));
        await page.key('body', 'Escape');
        assert.ok(!page.$('#detail-modal').classList.contains('open'));
        assert.equal(page.document.body.style.overflow, '');
    });

    test('botão fechar do detalhe e aviso que some sozinho', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        await page.click('[data-click="closeDetailModal"]');
        assert.ok(!page.$('#detail-modal').classList.contains('open'));

        const agendados = [];
        page.window.setTimeout = (fn, ms) => agendados.push([fn, ms]);
        await page.click('#export-csv-btn');
        const toast = page.$('.toast');
        assert.ok(toast);
        agendados.find(([, ms]) => ms === 4000)[0]();
        assert.ok(toast.classList.contains('hide'));
        agendados.find(([, ms]) => ms === 400)[0]();
        assert.equal(page.$('.toast'), null);
    });
});

describe('banco-horas-rh.html — erros do servidor nas ações', () => {
    test('falha ao enviar o ajuste avisa no modal e não fecha', async () => {
        const c = client();
        c.errors['bank_requests:insert'] = { message: 'RLS' };
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Bia Lima').querySelector('[data-click="openAdjustModal"]'));
        await page.fill('#adjust-horas', '1');
        await page.fill('#adjust-just', 'Evento');
        await page.click('#adjust-submit-btn');
        assert.match(page.text('#adjust-alert'), /Erro ao enviar ajuste para aprovação/);
        assert.ok(page.$('#adjust-modal').classList.contains('open'));
    });

    test('falha ao aprovar mostra a mensagem do servidor; falha ao rejeitar mostra no modal', async () => {
        const c = client();
        c.errors['rpc:approve_bank_request'] = { message: 'Somente outro Administrador pode aprovar.' };
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('[data-tab="solicitacoes"]');
        await page.click('#requests-tbody [data-click="approveRequest"]');
        assert.ok(page.toasts().includes('Somente outro Administrador pode aprovar.'));
        assert.equal(c.tables.bank_requests[0].status, 'pendente');

        await page.click('#requests-tbody [data-click="openRejectRequestModal"]');
        assert.equal(page.text('#reject-request-sub'), 'Bia Lima');
        await page.fill('#reject-request-obs', 'Sem comprovante');
        await page.click('[data-click="confirmRejectRequest"]');
        assert.equal(page.text('#reject-request-alert'), 'Somente outro Administrador pode aprovar.');
        assert.ok(page.$('#reject-request-modal').classList.contains('open'));
    });

    test('anexo da solicitação: abre o arquivo; falha avisa; sem anexo não mostra botão', async () => {
        const c = client();
        c.tables.bank_requests[0].anexo_path = 'emp-bia/atestado.pdf';
        c.tables.bank_requests[0].anexo_name = 'atestado.pdf';
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        const abertos = [];
        page.window.NexusFiles.open = async (bucket, path, opts) => {
            abertos.push([bucket, path, opts.name]);
            return { error: abertos.length > 1 ? { message: 'x' } : null };
        };
        await page.click('[data-tab="solicitacoes"]');
        await page.click('#requests-tbody [data-click="viewRequestAnexo"]');
        assert.deepEqual(abertos[0], ['documents', 'emp-bia/atestado.pdf', 'atestado.pdf']);
        await page.click('#requests-tbody [data-click="viewRequestAnexo"]');
        assert.ok(page.toasts().includes('Não foi possível abrir o anexo.'));
        await page.eval(`viewRequestAnexo('br2')`);
        assert.equal(abertos.length, 2, 'solicitação sem anexo não abre nada');
    });
});

describe('banco-horas-rh.html — feriados e configurações', () => {
    test('sem feriados mostra a lista vazia; campos obrigatórios; data repetida e erro genérico', async () => {
        const c = client({ holidays: [] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('#btn-holidays');
        assert.match(page.text('#holidays-list'), /Nenhum feriado cadastrado/);

        await page.click('[data-click="submitHoliday"]');
        assert.ok(page.toasts().includes('Informe a data e o nome do feriado.'));

        page.eval(`holidayDateField.setValue('2026-11-20')`);
        await page.fill('#holiday-name', 'Consciência Negra');
        c.errors['holidays:insert'] = { code: '23505', message: 'duplicate' };
        await page.click('[data-click="submitHoliday"]');
        assert.ok(page.toasts().includes('Já existe um feriado cadastrado nesta data.'));
        c.errors['holidays:insert'] = { code: 'XX000', message: 'falhou' };
        await page.click('[data-click="submitHoliday"]');
        assert.ok(page.toasts().includes('Erro ao salvar feriado.'));
    });

    test('calendário do feriado: navega meses e anos, ignora dias de outro mês, escolhe a data e fecha', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        await page.click('#btn-holidays');
        const aberto = () => page.$('#holiday-date-popover').classList.contains('open');
        await page.click('#holiday-date-trigger');
        assert.ok(aberto());
        assert.equal(page.text('#holiday-date-title'), 'Junho 2026');
        assert.ok(page.$('#holiday-date-grid .calendar-day--today'));
        for (let i = 0; i < 6; i++) await page.click('#holiday-date-prev');
        assert.equal(page.text('#holiday-date-title'), 'Dezembro 2025');
        await page.click('#holiday-date-next');
        assert.equal(page.text('#holiday-date-title'), 'Janeiro 2026');
        for (let i = 0; i < 12; i++) await page.click('#holiday-date-next');
        assert.equal(page.text('#holiday-date-title'), 'Janeiro 2027');

        await page.click('#holiday-date-grid .calendar-day--muted');
        assert.ok(aberto(), 'dia de outro mês não seleciona');
        await page.click('#holiday-date-grid button[data-day="15"]:not(.calendar-day--muted)');
        assert.ok(!aberto());
        assert.equal(page.$('#holiday-date').value, '2027-01-15');
        assert.equal(page.text('#holiday-date-text'), '15/01/2027');

        await page.click('#holiday-date-trigger');
        assert.equal(page.text('#holiday-date-title'), 'Janeiro 2027', 'reabre no mês escolhido');
        await page.click('#holiday-date-trigger');
        assert.ok(!aberto());
        await page.click('#holiday-date-trigger');
        await page.key('#holiday-date-trigger', 'Escape');
        assert.ok(!aberto());
        await page.click('#holiday-date-trigger');
        await page.click('#holidays-list');
        assert.ok(!aberto());
        await page.click('#holiday-date-trigger');
        await page.click('#holiday-abrangencia-trigger');
        assert.ok(!aberto(), 'abrir outro seletor fecha o calendário');
        assert.ok(page.$('#holiday-abrangencia-popover').classList.contains('open'));
        await page.click('#holiday-abrangencia-popover .select-option[data-value="municipal"]');
        assert.equal(page.$('#holiday-abrangencia').value, 'municipal');
    });

    test('feriado novo ou excluído recalcula o detalhe aberto; falha ao excluir avisa', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        page.eval(`openHolidaysModal()`);
        page.eval(`holidayDateField.setValue('2026-06-15')`);
        await page.fill('#holiday-name', 'Feriado local');
        await page.click('[data-click="submitHoliday"]');
        assert.match(page.$('#detail-body .badge-sm-feriado').title, /Feriado local/);

        c.errors['holidays:delete'] = { message: 'RLS' };
        await page.click('#holidays-list [data-click="deleteHoliday"][data-click-args*="h1"]');
        assert.ok(page.toasts().includes('Não foi possível excluir o feriado.'));
        delete c.errors['holidays:delete'];
        const novo = c.tables.holidays.find((h) => h.name === 'Feriado local');
        await page.click(`#holidays-list [data-click="deleteHoliday"][data-click-args*="${novo.id}"]`);
        assert.equal(page.$('#detail-body .badge-sm-feriado'), null);
    });

    test('configurações: setas de número, valores inválidos, erro ao salvar e detalhe recalculado', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        page.eval(`openSettingsModal()`);
        assert.equal(page.$('#settings-vencimento').value, '6');
        await page.click('[data-click="stepNumber"][data-click-args=\'["settings-vencimento",1]\']');
        assert.equal(page.$('#settings-vencimento').value, '7');
        await page.click('[data-click="stepNumber"][data-click-args=\'["settings-vencimento",-1]\']');
        assert.equal(page.$('#settings-vencimento').value, '6');
        page.$('#settings-vencimento').value = '';
        await page.click('[data-click="stepNumber"][data-click-args=\'["settings-vencimento",1]\']');
        assert.equal(page.$('#settings-vencimento').value, '1', 'campo vazio vai para o mínimo');
        page.$('#settings-vencimento').value = '24';
        await page.click('[data-click="stepNumber"][data-click-args=\'["settings-vencimento",1]\']');
        assert.equal(page.$('#settings-vencimento').value, '24', 'não passa do máximo');

        page.$('#settings-vencimento').value = '0';
        await page.click('[data-click="submitSettings"]');
        assert.match(page.text('#settings-alert'), /prazo de vencimento válido/);
        page.$('#settings-vencimento').value = '6';
        page.$('#settings-limite-extra').value = '-5';
        await page.click('[data-click="submitSettings"]');
        assert.match(page.text('#settings-alert'), /limite diário de horas extras válido/);

        page.$('#settings-limite-extra').value = '60';
        c.errors['hr_settings:update'] = { message: 'RLS' };
        await page.click('[data-click="submitSettings"]');
        assert.match(page.text('#settings-alert'), /Erro ao salvar configurações/);
        delete c.errors['hr_settings:update'];
        await page.click('[data-click="submitSettings"]');
        assert.equal(c.tables.hr_settings[0].limite_extra_diario_min, 60);
        assert.ok(page.$('#detail-modal').classList.contains('open'));
    });
});

describe('banco-horas-rh.html — auditoria: filtros, mês e posicionamento', () => {
    test('menus de tipo e de colaborador abrem, fecham um ao outro, com clique fora e ao rolar', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        await page.click('.tab-btn[data-tab="auditoria"]');
        const aberto = (id) => page.$(id).classList.contains('open');
        await page.click('#audit-btn-filter');
        assert.ok(aberto('#audit-filter-dropdown-menu'));
        assert.match(page.$('#audit-filter-dropdown-menu').style.top, /px$/);
        await page.click('#audit-emp-btn');
        assert.ok(aberto('#audit-emp-dropdown-menu'));
        assert.ok(!aberto('#audit-filter-dropdown-menu'));
        assert.match(page.$('#audit-emp-dropdown-menu').style.left, /px$/);
        await page.click('#audit-emp-btn');
        assert.ok(!aberto('#audit-emp-dropdown-menu'));

        await page.click('#audit-btn-filter');
        await page.click('#audit-btn-filter');
        assert.ok(!aberto('#audit-filter-dropdown-menu'));

        await page.click('#audit-btn-filter');
        page.$('#audit-filter-dropdown-menu').dispatchEvent(new page.window.Event('scroll'));
        assert.ok(aberto('#audit-filter-dropdown-menu'), 'rolar dentro do menu não fecha');
        page.document.dispatchEvent(new page.window.Event('scroll'));
        assert.ok(!aberto('#audit-filter-dropdown-menu'));

        await page.click('#audit-emp-btn');
        page.$('#audit-emp-dropdown-menu').dispatchEvent(new page.window.Event('scroll'));
        assert.ok(aberto('#audit-emp-dropdown-menu'));
        page.document.dispatchEvent(new page.window.Event('scroll'));
        assert.ok(!aberto('#audit-emp-dropdown-menu'));
    });

    test('mês da auditoria: navega, escolhe outro mês e refaz a consulta; no celular posiciona o popover', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('.tab-btn[data-tab="auditoria"]');
        const aberto = () => page.$('#audit-month-popover').classList.contains('open');
        Object.defineProperty(page.window, 'innerWidth', { value: 500, configurable: true });

        await page.click('#audit-btn-filter');
        await page.click('#audit-month-trigger');
        assert.ok(aberto());
        assert.ok(!page.$('#audit-filter-dropdown-menu').classList.contains('open'), 'abrir o mês fecha o filtro');
        assert.match(page.$('#audit-month-popover').style.left, /px$/);
        assert.equal(page.text('#audit-month-title'), 'Junho 2026');
        for (let i = 0; i < 6; i++) await page.click('#audit-month-prev');
        assert.equal(page.text('#audit-month-title'), 'Dezembro 2025');
        await page.click('#audit-month-next');
        for (let i = 0; i < 12; i++) await page.click('#audit-month-next');
        assert.equal(page.text('#audit-month-title'), 'Janeiro 2027');
        for (let i = 0; i < 12; i++) await page.click('#audit-month-prev');
        await page.click('#audit-month-prev');
        await page.click('#audit-month-grid .calendar-day:not(.calendar-day--muted)');
        assert.ok(!aberto());
        assert.equal(page.$('#audit-month').value, '2025-12');
        assert.equal(page.text('#audit-month-label'), 'Dezembro de 2025');
        await page.settle();
        const ultima = c.calls.filter((x) => x.table === 'activity_logs').at(-1);
        assert.ok(JSON.stringify(ultima).includes('2025-12-01'));

        await page.click('#audit-month-trigger');
        assert.equal(page.text('#audit-month-title'), 'Dezembro 2025');
        await page.click('#audit-month-trigger');
        assert.ok(!aberto());
        await page.click('#audit-month-trigger');
        await page.key('#audit-month-trigger', 'Escape');
        assert.ok(!aberto());
        await page.click('#audit-month-trigger');
        await page.click('#audit-tbody');
        assert.ok(!aberto());
        await page.click('#audit-month-trigger');
        await page.click('#audit-emp-btn');
        assert.ok(!aberto(), 'abrir o menu de colaborador fecha o mês');
    });
});

describe('banco-horas-rh.html — tempo real e link direto', () => {
    test('mudanças em ponto, ajustes, colaboradores, férias e configurações recarregam os saldos', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('.tab-btn[data-tab="auditoria"]');
        const consultas = () => c.calls.filter((x) => x.table === 'activity_logs').length;

        c.tables.time_records.push(dia(BIA.id, '2026-06-16', '18:00'));
        const antes = consultas();
        c.emit('time_records', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => /-1h 00min/.test(page.text(rowOf(page, 'Bia Lima'))));
        await page.waitFor(() => consultas() > antes, { message: 'auditoria aberta é recarregada' });

        c.tables.bank_adjustments.push({ id: 'adj9', employee_id: BIA.id, tipo: 'credito', minutos: 60, date: '2026-06-16', deleted_at: null });
        c.emit('bank_adjustments', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => /\+0h 00min|0h 00min/.test(page.text(rowOf(page, 'Bia Lima')).split('Financeiro')[1]));

        c.tables.employees_decrypted.find((e) => e.id === CAIO.id).name = 'Caio Prado Jr';
        c.emit('employees', { eventType: 'UPDATE', new: {} });
        await page.waitFor(() => rowOf(page, 'Caio Prado Jr'));

        c.tables.hr_settings[0].banco_horas_vencimento_meses = 12;
        c.emit('hr_settings', { eventType: 'UPDATE', new: {} });
        c.tables.vacations.push({ id: 'v9', employee_id: BIA.id, start_date: '2026-06-01', end_date: '2026-06-05', status: 'aprovado' });
        c.emit('vacations', { eventType: 'INSERT', new: {} });
        await page.settle(30);
        page.eval(`openSettingsModal()`);
        assert.equal(page.$('#settings-vencimento').value, '12');
    });

    test('link com ?req= abre a aba de solicitações em "todos" e destaca a linha', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW, query: '?req=br2' });
        await page.waitFor(() => page.$('#tab-solicitacoes').classList.contains('active'));
        const linha = page.$('#requests-tbody tr[data-id="br2"]');
        assert.ok(linha, 'a solicitação já aprovada aparece porque o filtro vira "todos"');
        assert.ok(linha.classList.contains('row-deep-link-highlight'));
        await page.waitFor(() => !linha.classList.contains('row-deep-link-highlight'), { timeout: 4000, message: 'o destaque some sozinho' });
    });
});

describe('banco-horas-rh.html — regras que aparecem na tabela, no CSV e nas solicitações', () => {
    const LEO = { ...ANA, id: 'emp-leo', name: 'Leo Dias', dept: '', work_load: '12x36', manager_id: null, avatar_url: 'https://cdn.test/leo.png' };
    const RUI = { ...ANA, id: 'emp-rui', name: 'Rui Alves', dept: 'Operações', work_load: '44h', manager_id: null };

    function comMaisGente(extra = {}) {
        const c = client(extra);
        c.tables.employees_decrypted.push({ ...LEO }, { ...RUI });
        return c;
    }

    test('rótulos de jornada: escala 12x36 e 44h semanais (8h48min/dia); avatar com foto', async () => {
        page = await openPage('banco-horas-rh', { client: comMaisGente(), now: NOW });
        assert.match(page.text(rowOf(page, 'Leo Dias')), /Escala 12x36/);
        assert.match(page.text(rowOf(page, 'Leo Dias')), /Leo Dias —/, 'sem departamento mostra travessão');
        assert.match(page.text(rowOf(page, 'Rui Alves')), /8h48min\/dia/);
        assert.equal(rowOf(page, 'Leo Dias').querySelector('.emp-avatar').dataset.bgImg, 'https://cdn.test/leo.png');
    });

    test('filtros de saldo positivo e zerado/PJ', async () => {
        page = await openPage('banco-horas-rh', { client: client(), now: NOW });
        await page.click('[data-filter="positivo"]');
        assert.deepEqual(
            page.$$('#banco-tbody tr').map((tr) => page.text(tr.querySelector('.emp-name'))),
            ['Ana Souza']
        );
        assert.equal(page.text('#filter-label'), 'Saldo Positivo');
        assert.ok(page.$('#btn-filter').classList.contains('filtered'));
        await page.click('[data-filter="zerado"]');
        assert.deepEqual(
            page.$$('#banco-tbody tr').map((tr) => page.text(tr.querySelector('.emp-name'))),
            ['Caio Prado']
        );
    });

    test('CSV traz tipo de contrato, jornada e a coluna de compliance de cada colaborador', async () => {
        const c = comMaisGente({
            time_records: [
                dia(ANA.id, '2025-10-06', '20:00'),
                dia(ANA.id, '2026-06-15', '20:30'),
                dia(BIA.id, '2026-01-12', '20:00'),
                { ...dia(BIA.id, '2026-06-16', '17:00'), saida_almoco: null, retorno_almoco: null },
                dia(CAIO.id, '2026-06-15', '18:00'),
            ],
        });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('#export-csv-btn');
        const csv = await page.objectUrls.at(-1).text();
        const linha = (nome) => csv.split('\r\n').find((l) => l.startsWith(`"${nome}"`));
        assert.match(linha('Ana Souza'), /"CLT";"8h\/dia";.*"Vencido, 1x 2h\+"$/);
        assert.match(linha('Bia Lima'), /"Vencendo, 1x intervalo"$/);
        assert.match(linha('Caio Prado'), /"PJ";"PJ";.*"—";"—"$/);
        assert.match(linha('Leo Dias'), /^"Leo Dias";"";"CLT";"Escala 12x36";.*"Em dia"$/);
        assert.ok(page.toasts().includes('Planilha CSV exportada.'));
        assert.equal(c.rpcCalls('report_data_export')[0].args.p_source, 'banco-horas.csv');
    });

    test('ajuste para quem não tem gestor pede a confirmação de um segundo Administrador', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Bia Lima').querySelector('[data-click="openAdjustModal"]'));
        await page.click('#adjust-tipo-trigger');
        await page.click('#adjust-tipo-popover .select-option[data-value="debito"]');
        await page.fill('#adjust-min', '45');
        await page.fill('#adjust-just', 'Saída antecipada');
        await page.click('#adjust-submit-btn');
        const req = c.writes('bank_requests', 'insert')[0].payload[0];
        assert.deepEqual([req.tipo, req.minutos, req.requires_approval_from, req.manager_id_snapshot], ['debito', 45, 'rh', null]);
        assert.match(page.toasts().at(-1), /Ajuste de -0h 45min enviado para Bia Lima — aguardando confirmação de um segundo Administrador/);
    });

    test('lista de solicitações: rejeitada mostra o motivo; status desconhecido cai em pendente; vazia avisa', async () => {
        const c = client();
        c.tables.bank_requests.push(
            {
                id: 'br4',
                employee_id: ANA.id,
                origem: 'colaborador',
                tipo: 'credito',
                minutos: 20,
                date: '2026-06-02',
                status: 'rejeitado',
                decision_obs: 'Sem "comprovante"',
                requires_approval_from: 'rh',
                created_at: '2026-06-02T18:00:00Z',
                employees: null,
            },
            {
                id: 'br5',
                employee_id: ANA.id,
                origem: 'rh',
                tipo: 'debito',
                minutos: 10,
                date: '2026-06-03',
                status: 'estranho',
                created_at: '2026-06-03T18:00:00Z',
            }
        );
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('[data-tab="solicitacoes"]');
        await page.click('#tab-solicitacoes .chip[data-req-filter="todos"]');
        assert.equal(page.text('#requests-count'), '4 solicitações exibidas');
        const rejeitada = page.$('#requests-tbody tr[data-id="br4"]');
        assert.equal(rejeitada.querySelector('.badge').title, 'Sem "comprovante"');
        assert.match(page.text(rejeitada), /— — Colaborador Crédito \+0h 20min 02\/06\/2026 RH \(2ª aprovação\) Rejeitado/);
        assert.match(page.text('#requests-tbody tr[data-id="br5"]'), /Pendente/);

        await page.click('#tab-solicitacoes .chip[data-req-filter="rejeitado"]');
        assert.equal(page.text('#requests-count'), '1 solicitação exibida');
        c.tables.bank_requests = [];
        c.emit('bank_requests', { eventType: 'DELETE', old: {} });
        await page.waitFor(() => /Nenhuma solicitação encontrada/.test(page.text('#requests-tbody')));
        assert.ok(page.$('#tab-badge-solicitacoes').classList.contains('hidden'));
        assert.match(page.text('#notif-panel-body'), /Tudo em dia por aqui/);
    });

    test('auditoria: débito e exclusão de ajuste, colaborador sem cadastro e ação desconhecida', async () => {
        const c = client({
            activity_logs: [
                {
                    id: 'l3',
                    employee_id: ANA.id,
                    tipo: 'ajuste_banco',
                    acao: 'debito',
                    minutos: 45,
                    date: '2026-06-12',
                    operator_email: 'rh@empresa.com',
                    operator_profile: 'Administrador',
                    created_at: '2026-06-12T20:00:00Z',
                    employees: { name: ANA.name, dept: ANA.dept },
                },
                {
                    id: 'l4',
                    employee_id: null,
                    tipo: 'ajuste_banco',
                    acao: 'exclusao',
                    date: '2026-06-12',
                    operator_name: 'Ex-colaborador',
                    operator_profile: 'colaborador',
                    created_at: '2026-06-12T21:00:00Z',
                    employees: null,
                },
                { id: 'l5', tipo: 'ponto', acao: 'intervalo_extra', date: '2026-06-12', created_at: '2026-06-12T22:00:00Z' },
            ],
        });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('.tab-btn[data-tab="auditoria"]');
        await page.settle();
        const linhas = page.$$('#audit-tbody tr').map((tr) => page.text(tr));
        assert.ok(linhas.some((l) => /Ana Souza.*Banco.*Débito.*-0h 45min.*rh@empresa\.com RH/.test(l)));
        assert.ok(linhas.some((l) => /Ex-colaborador — Banco Exclusão de Ajuste — Ex-colaborador Colaborador/.test(l)));
        assert.ok(linhas.some((l) => /Ponto intervalo_extra — — Colaborador —$/.test(l)));
    });
});

describe('banco-horas-rh.html — ramos de regra que faltavam', () => {
    test('sem configuração do RH vale o padrão da CLT: 2h de extra por dia', async () => {
        const c = client({ hr_settings: [] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Bia Lima').querySelector('[data-click="openAdjustModal"]'));
        await page.fill('#adjust-horas', '2');
        await page.fill('#adjust-min', '30');
        await page.fill('#adjust-just', 'Inventário');
        await page.click('#adjust-submit-btn');
        assert.match(page.text('#adjust-alert'), /Limite legal de horas extras diárias excedido/);
        assert.equal(c.writes('bank_requests', 'insert').length, 0);
    });

    test('ajuste manual: data, valor maior que zero e justificativa são obrigatórios', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Bia Lima').querySelector('[data-click="openAdjustModal"]'));
        const data = page.$('#adjust-data').value;
        page.$('#adjust-data').value = '';
        await page.window.submitAdjust();
        assert.match(page.text('#adjust-alert'), /Informe a data de referência/);
        page.$('#adjust-data').value = data;
        await page.window.submitAdjust();
        assert.match(page.text('#adjust-alert'), /valor de horas\/minutos maior que zero/);
        await page.fill('#adjust-min', '15');
        await page.window.submitAdjust();
        assert.match(page.text('#adjust-alert'), /justificativa é obrigatória/);
        assert.equal(c.writes('bank_requests', 'insert').length, 0);
    });

    test('crédito manual soma no saldo e aparece no detalhe com o sinal de mais', async () => {
        const c = client({
            bank_adjustments: [
                { id: 'cred', employee_id: BIA.id, tipo: 'credito', minutos: 90, date: '2026-06-11', justificativa: 'Evento sábado', deleted_at: null },
            ],
        });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        assert.match(page.text(rowOf(page, 'Bia Lima')), /-0h 30min/, '-2h do dia 15 + 1h30 de crédito');
        await page.click(rowOf(page, 'Bia Lima').querySelector('[data-click="openDetailModal"]'));
        const item = page.$$('#detail-body .ajuste-item').find((el) => /Evento sábado/.test(el.textContent));
        assert.ok(item.querySelector('.fa-plus'));
    });

    test('um único dia sem intervalo: aviso no singular com a indenização de 50%', async () => {
        const semAlmoco = { ...dia(BIA.id, '2026-06-16', '17:00'), saida_almoco: null, retorno_almoco: null };
        const c = client({ time_records: [semAlmoco] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Bia Lima').querySelector('[data-click="openDetailModal"]'));
        assert.match(page.text('#detail-body'), /Intervalo intrajornada \(art\. 71 CLT\) não cumprido em 1 dia de /);
        assert.match(page.text('#detail-body'), /1h 00min suprimidos — cerca de 1h 30min indenizáveis/);
    });
});
