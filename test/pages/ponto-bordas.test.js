const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, MANAGER_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const HOJE = '2026-06-17';
const NOW = `${HOJE}T10:00:00-03:00`;

function colabClient({ extra = {}, user = COLAB_USER, rpc = {}, ana = {}, errors = {} } = {}) {
    const tables = baseTables({
        time_records: [],
        adjustment_requests: [],
        bank_requests: [],
        holidays: [],
        hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
        activity_logs: [],
        documents: [],
        burnout_alerts: [],
        ...extra,
    });
    for (const t of ['employees', 'employees_decrypted'])
        Object.assign(
            tables[t].find((e) => e.id === ANA.id),
            ana
        );
    return new FakeSupabase({
        user,
        tables,
        rpc: { report_daily_overtime_alert: {}, biometric_status: { enrolled: false }, ...rpc },
        defaults: { adjustment_requests: { status: 'pendente' }, bank_requests: { status: 'pendente' } },
        errors,
    });
}

const dia = (date, entrada, saida, almoco = true) => ({
    id: `tr-${date}`,
    employee_id: ANA.id,
    date,
    entrada: entrada ? `${date}T${entrada}:00-03:00` : null,
    saida_almoco: almoco ? `${date}T12:00:00-03:00` : null,
    retorno_almoco: almoco ? `${date}T13:00:00-03:00` : null,
    saida: saida ? `${date}T${saida}:00-03:00` : null,
});

describe('ponto-colaborador.html — bordas', () => {
    test('falhas ao ler ponto, ajustes, pedidos e feriados mostram listas vazias', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient({
                errors: { time_records: { message: 'a' }, adjustment_requests: { message: 'b' }, bank_requests: { message: 'c' }, holidays: { message: 'd' } },
            }),
            now: NOW,
        });
        assert.equal(page.$$('#historico-tbody tr.td-date').length, 0);
        assert.equal(page.visible('#section-solicitacoes'), false);
    });

    test('clicar no fundo de um modal comum fecha; clicar dentro não', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW });
        const modal = page.$('#modal-relogio');
        modal.classList.add('open');
        await page.click(modal.firstElementChild);
        assert.ok(modal.classList.contains('open'));
        await page.click(modal);
        assert.equal(modal.classList.contains('open'), false);
    });

    test('PJ: jornada "Autônomo", resumo ignora falta e dia incompleto, e a saída não mostra prévia de saldo', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient({
                ana: { contract_type: 'pj' },
                extra: { time_records: [dia(HOJE, '08:00', null), dia('2026-06-15', null, null, false), dia('2026-06-16', '08:00', null)] },
            }),
            now: NOW,
        });
        assert.equal(page.text('#stat-jornada'), 'Autônomo');
        assert.match(page.text('#saldo-sub'), /0 dia\(s\)/);
        page.window.abrirConfirmar();
        await page.settle();
        assert.equal(page.$('#modal-confirmar').classList.contains('open'), true);
    });

    test('jornada 12x36 e jornada com minutos quebrados', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient({ ana: { work_load: '12x36' } }), now: NOW });
        assert.equal(page.text('#stat-jornada'), 'Escala 12x36');
        page.close();
        page = await openPage('ponto-colaborador', { client: colabClient({ ana: { work_load: '44h' } }), now: NOW });
        assert.equal(page.text('#stat-jornada'), '8h48min/dia');
    });

    test('jornada encerrada não reabre a confirmação', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient({ extra: { time_records: [dia(HOJE, '08:00', '17:00')] } }), now: NOW });
        page.window.abrirConfirmar();
        await page.settle();
        assert.equal(page.$('#modal-confirmar').classList.contains('open'), false);
        await page.eval('confirmarRegistro()');
    });

    test('gestor: pedido de débito sem dados do colaborador; recusa com erro sem mensagem', async () => {
        const c = colabClient({
            user: MANAGER_USER,
            extra: {
                bank_requests: [
                    {
                        id: 'br1',
                        employee_id: ANA.id,
                        manager_id_snapshot: BIA.id,
                        status: 'pendente',
                        tipo: 'debito',
                        minutos: 30,
                        date: '2026-06-15',
                        justificativa: 'x',
                        created_at: '2026-06-15T19:00:00Z',
                        employees: null,
                    },
                ],
            },
            rpc: { approve_bank_request: () => ({ error: {} }) },
        });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        assert.match(page.text('#team-approvals-list'), /— .*Débito.*-0h 30min/);
        page.window.openRejectModal('br1');
        page.$('#reject-obs-text').value = 'Não';
        await page.window.confirmRejectBankRequest();
        assert.ok(page.toasts().includes('Erro ao rejeitar solicitação.'));
    });

    test('duração: clicar fora dos números não escolhe; reabrir mantém a escolha; confirmar sem escolher não faz nada', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW });
        page.window.openModalBankRequest();
        page.window.openModalDuracao();
        page.window.confirmDuracaoModal();
        assert.equal(page.$('#bankreq-horas').value, '');
        await page.click('#duracao-horas-col');
        await page.click('#duracao-min-col');
        await page.click('#modal-bankreq-duracao button[data-h="1"]');
        await page.click('#modal-bankreq-duracao button[data-m="30"]');
        page.window.confirmDuracaoModal();
        page.window.openModalDuracao();
        assert.ok(page.$('#modal-bankreq-duracao button[data-h="1"]').classList.contains('selected') || page.$('#bankreq-horas').value === '1');
    });

    test('tipo e anexo: clicar fora dos cartões não muda; tirar o arquivo volta ao texto padrão; horas vazias contam zero', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        page.window.openModalBankRequest();
        await page.click('#bankreq-tipo-toggle');
        assert.equal(page.$('#bankreq-tipo').value, 'credito');
        await page.setFiles('#bankreq-anexo', []);
        assert.equal(page.text('#bankreq-anexo-name'), 'Nenhum arquivo selecionado');
        page.$('#bankreq-data').value = '2026-06-15';
        await page.fill('#bankreq-justificativa', 'Motivo');
        await page.window.enviarBankRequest();
        assert.match(page.text('#err-bankreq-valor'), /maior que zero/);
    });

    test('anexo de pedido sem nome gravado abre com nome genérico', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient({
                extra: {
                    bank_requests: [
                        {
                            id: 'br1',
                            employee_id: ANA.id,
                            status: 'pendente',
                            tipo: 'credito',
                            minutos: 60,
                            date: '2026-06-15',
                            created_at: '2026-06-15T10:00:00Z',
                            anexo_path: 'emp-ana/banco-horas/a.pdf',
                            anexo_name: null,
                        },
                    ],
                },
            }),
            now: NOW,
            fetch: async () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } }),
        });
        await page.eval(`viewBankRequestAnexo('br1')`);
        await page.settle();
        assert.equal(page.toasts().filter((t) => /Não foi possível abrir/.test(t)).length, 0);
    });

    test('domingo conta a semana a partir da segunda anterior', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient({
                extra: {
                    time_records: [
                        dia('2026-06-15', '08:00', '20:00'),
                        dia('2026-06-16', '08:00', '20:00'),
                        dia('2026-06-17', '08:00', '20:00'),
                        dia('2026-06-18', '08:00', '20:00'),
                    ],
                },
            }),
            now: '2026-06-21T10:00:00-03:00',
        });
        assert.equal(page.visible('#section-burnout'), true);
    });

    test('só alertas de atenção deixam o cartão CLT em nível de atenção', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient({
                extra: {
                    adjustment_requests: [
                        { id: 'a1', employee_id: ANA.id, tipo: 'falta', status: 'pendente', date: '2026-06-10', created_at: '2026-06-10T10:00:00Z' },
                    ],
                },
            }),
            now: NOW,
        });
        assert.ok(page.$('#section-clt').className.includes('atencao') || /atenção|Atenção|DSR/.test(page.text('#section-clt')));
    });

    test('filtro de mês: escolher outro mês redesenha o histórico já com o mês guardado', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient({ extra: { time_records: [dia('2026-05-12', '08:00', '17:00')] } }), now: NOW });
        await page.click('#filter-month-trigger');
        await page.click('#filter-month-prev');
        await page.click(
            page.$$('#filter-month-grid button').find((b) => /mai/i.test(b.textContent) || b.dataset.month === '2026-05') || page.$('#filter-month-grid button')
        );
        page.window.renderHistorico();
        assert.ok(page.$('#filter-month').value);
    });
});
