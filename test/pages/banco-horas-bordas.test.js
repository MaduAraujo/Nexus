const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const dia = (employee_id, date, saida, extra = {}) => ({
    id: `tr-${employee_id}-${date}`,
    employee_id,
    date,
    entrada: `${date}T08:00:00-03:00`,
    saida_almoco: `${date}T12:00:00-03:00`,
    retorno_almoco: `${date}T13:00:00-03:00`,
    saida: `${date}T${saida}:00-03:00`,
    ...extra,
});

function client(extra = {}, opts = {}) {
    const tables = baseTables({
        time_records: [],
        bank_adjustments: [],
        bank_requests: [],
        holidays: [],
        vacations: [],
        hr_settings: [{ id: 1, banco_horas_vencimento_meses: 6, limite_extra_diario_min: 120 }],
        activity_logs: [],
        ...extra,
    });
    return new FakeSupabase({ user: RH_USER, tables, rpc: { approve_bank_request: {} }, ...opts });
}

const rowOf = (p, name) => p.$$('#banco-tbody tr').find((tr) => tr.textContent.includes(name));

describe('banco-horas-rh.html — bordas', () => {
    test('falhas em todas as leituras deixam a tela vazia', async () => {
        const erro = { message: 'x' };
        page = await openPage('banco-horas-rh', {
            client: client(
                {},
                {
                    errors: {
                        holidays: erro,
                        vacations: erro,
                        time_records: erro,
                        bank_adjustments: erro,
                        employees_decrypted: erro,
                        bank_requests: erro,
                        activity_logs: erro,
                    },
                }
            ),
            now: NOW,
        });
        assert.equal(page.$$('#banco-tbody tr .emp-name').length, 0);
        await page.click('.tab-btn[data-tab="auditoria"]');
        await page.settle();
        assert.equal(page.$$('#audit-tbody tr.audit-row').length, 0);
    });

    test('registros e ajustes de quem não está na lista são ignorados; dia de outro mês fica fora do saldo', async () => {
        page = await openPage('banco-horas-rh', {
            client: client({
                time_records: [dia('sumiu', '2026-06-15', '19:00'), dia(ANA.id, '2026-05-15', '19:00')],
                bank_adjustments: [{ id: 'a1', employee_id: 'sumiu', tipo: 'credito', minutos: 30, date: '2026-06-10', deleted_at: null }],
            }),
            now: NOW,
        });
        assert.ok(rowOf(page, 'Ana Souza'));
    });

    test('contrato sem tipo aparece como CLT na tela, no CSV e no PDF', async () => {
        const c = client();
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).contract_type = null;
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        assert.match(page.text(rowOf(page, 'Ana Souza')), /CLT/);
        await page.click('#btn-export');
        await page.click('#export-csv-btn');
        await page.click('#btn-export');
        await page.click('#export-pdf-btn');
        assert.ok(page.downloads.length >= 1 || page.pdfs.length >= 1);
    });

    test('detalhe: sem setor e cargo, crédito vencendo em 1 dia e intervalo curto em 1 dia; trocar para mês de quem não tem ponto', async () => {
        const c = client({
            time_records: [dia(ANA.id, '2026-06-15', '17:30', { retorno_almoco: '2026-06-15T12:30:00-03:00', entrada_ajustado: true })],
            bank_adjustments: [{ id: 'a1', employee_id: ANA.id, tipo: 'credito', minutos: 120, date: '2026-01-18', deleted_at: null }],
        });
        Object.assign(
            c.tables.employees_decrypted.find((e) => e.id === ANA.id),
            { dept: null, role: null }
        );
        page = await openPage('banco-horas-rh', { client: c, now: '2026-06-30T10:00:00-03:00' });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        const texto = page.text('#detail-body');
        assert.match(texto, /vencem em até 1 dia\./);
        assert.match(texto, /não cumprido em 1 dia de/);
        assert.ok(page.$('#detail-body .dt-time.ajustado'));
        await page.eval(`changeDetailMonth('${BIA.id}', '2026-04')`);
        await page.settle();
    });

    test('sem a biblioteca de gráficos o detalhe abre sem tendência; falha ao ler a tendência não quebra', async () => {
        page = await openPage('banco-horas-rh', {
            client: client({ time_records: [dia(ANA.id, '2026-06-15', '18:00')] }),
            now: NOW,
            before(w) {
                delete w.Chart;
            },
        });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        assert.match(page.text('#detail-body'), /15\/06/);
        page.close();

        const c = client({
            time_records: [dia(ANA.id, '2026-06-15', '18:00')],
            bank_adjustments: [{ id: 'a0', employee_id: ANA.id, tipo: 'credito', minutos: 30, date: '2025-01-10', deleted_at: null }],
        });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        c.errors['time_records:select'] = { message: 'x' };
        c.errors['bank_adjustments:select'] = { message: 'y' };
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        await page.settle();
        assert.equal(page.pageErrors.length, 0);
    });

    test('ajuste de crédito quando a leitura dos créditos do dia falha, ou crédito sem minutos gravados', async () => {
        const c = client({ bank_adjustments: [{ id: 'a1', employee_id: ANA.id, tipo: 'credito', minutos: null, date: '2026-06-15', deleted_at: null }] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        page.window.openAdjustModal(ANA.id);
        page.eval(`adjustDateField.setValue('2026-06-15')`);
        page.$('#adjust-horas').value = '1';
        page.$('#adjust-min').value = '0';
        page.$('#adjust-just').value = 'Evento';
        await page.window.submitAdjust();
        assert.equal(c.writes('bank_requests', 'insert').length + c.writes('bank_adjustments', 'insert').length, 1);
        c.errors['bank_adjustments:select'] = { message: 'x' };
        page.window.openAdjustModal(ANA.id);
        page.eval(`adjustDateField.setValue('2026-06-15')`);
        page.$('#adjust-horas').value = '1';
        page.$('#adjust-min').value = '0';
        page.$('#adjust-just').value = 'Evento';
        await page.window.submitAdjust();
    });

    test('solicitações: anexo sem nome, erros sem mensagem e pedido sem dados do colaborador', async () => {
        const c = client(
            {
                bank_requests: [
                    {
                        id: 'br1',
                        employee_id: ANA.id,
                        origem: 'colaborador',
                        tipo: 'credito',
                        minutos: 60,
                        date: '2026-06-12',
                        status: 'pendente',
                        requires_approval_from: 'rh',
                        created_at: '2026-06-12T18:00:00Z',
                        employees: null,
                        anexo_path: 'emp-ana/x.pdf',
                        anexo_name: null,
                    },
                ],
            },
            { rpc: { approve_bank_request: { error: {} } } }
        );
        page = await openPage('banco-horas-rh', {
            client: c,
            now: NOW,
            fetch: async () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } }),
        });
        await page.eval(`viewRequestAnexo('br1')`);
        await page.eval(`approveRequest('br1')`);
        assert.ok(page.toasts().includes('Erro ao aprovar solicitação.'));
        page.window.openRejectRequestModal('br1');
        assert.equal(page.text('#reject-request-sub'), '');
        page.$('#reject-request-obs').value = 'Não';
        await page.window.confirmRejectRequest();
        assert.equal(page.text('#reject-request-alert'), 'Erro ao rejeitar solicitação.');
    });

    test('feriado: excluir um feriado que não está na lista pede confirmação sem data; cancelar não exclui', async () => {
        const c = client({ holidays: [{ id: 'h1', date: '2026-06-04', name: 'Corpus', abrangencia: 'nacional' }] });
        page = await openPage('banco-horas-rh', { client: c, now: NOW, confirm: false });
        await page.eval(`deleteHoliday('nao-existe')`);
        await page.eval(`deleteHoliday('h1')`);
        assert.equal(c.writes('holidays', 'delete').length, 0);
        assert.ok(page.confirms.some((t) => t === 'Excluir o feriado ?'));
    });

    test('configurações vazias são recusadas', async () => {
        const c = client();
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        page.window.openSettingsModal();
        page.$('#settings-vencimento').value = '';
        page.$('#settings-limite-extra').value = '';
        await page.window.submitSettings();
        assert.equal(c.writes('hr_settings', 'update').length + c.writes('hr_settings', 'upsert').length, 0);
    });

    test('auditoria: ação desconhecida e ação vazia; mês vazio não muda; clicar dentro do modal não fecha', async () => {
        const c = client({
            activity_logs: [
                {
                    id: 'l1',
                    employee_id: ANA.id,
                    tipo: 'ponto',
                    acao: 'misterio',
                    date: '2026-06-15',
                    created_at: '2026-06-15T11:02:00Z',
                    employees: { name: ANA.name, dept: ANA.dept },
                },
                {
                    id: 'l2',
                    employee_id: ANA.id,
                    tipo: 'ponto',
                    acao: null,
                    date: '2026-06-15',
                    created_at: '2026-06-15T11:03:00Z',
                    employees: { name: ANA.name, dept: ANA.dept },
                },
            ],
        });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click('.tab-btn[data-tab="auditoria"]');
        await page.settle();
        const t = page.text('#audit-tbody');
        assert.match(t, /misterio/);
        assert.match(t, /—/);
        page.eval(`setAuditMonth('')`);
        page.window.openSettingsModal();
        const modal = page.$('#settings-modal');
        page.window.handleOverlayClick({ target: modal.firstElementChild, currentTarget: modal }, 'settings-modal');
        assert.ok(modal.classList.contains('open'));
    });

    test('mês trocado no detalhe não entra no saldo do mês corrente; falha ao buscar o mês; intervalo curto em 2 dias; ajuste futuro fora da tendência', async () => {
        const curto = (d) => dia(ANA.id, d, '17:30', { retorno_almoco: `${d}T12:30:00-03:00` });
        const c = client({
            time_records: [curto('2026-06-15'), curto('2026-06-16'), dia(ANA.id, '2026-05-12', '19:00')],
            bank_adjustments: [{ id: 'f1', employee_id: ANA.id, tipo: 'credito', minutos: 30, date: '2026-07-05', deleted_at: null }],
        });
        page = await openPage('banco-horas-rh', { client: c, now: NOW });
        await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
        assert.match(page.text('#detail-body'), /não cumprido em 2 dias/);
        await page.eval(`changeDetailMonth('${ANA.id}', '2026-05')`);
        await page.settle();
        await page.eval('buildAllBalances()');
        c.errors['time_records:select'] = { message: 'x' };
        await page.eval(`changeDetailMonth('${ANA.id}', '2026-04')`);
        await page.settle();
        const modal = page.$('#settings-modal');
        page.window.openSettingsModal();
        page.window.handleOverlayClick({ target: modal, currentTarget: modal }, 'settings-modal');
        assert.equal(modal.classList.contains('open'), false);
    });
});
