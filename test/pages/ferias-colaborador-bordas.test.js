const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function colabClient({ vacations = [], errors = {}, colegas } = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({ vacations, time_records: [], medical_leaves: [], holidays: [], adjustment_requests: [] }),
        rpc: { colleague_directory: colegas || [{ id: BIA.id, name: BIA.name, dept: null }] },
        errors,
    });
}

const ferias = (id, start_date, end_date, days, extra = {}) => ({
    id,
    employee_id: ANA.id,
    start_date,
    end_date,
    days,
    status: 'aprovado',
    created_at: '2026-01-10T10:00:00Z',
    ...extra,
});

async function enviar(inicio, fim) {
    page.$('#req-start').value = inicio;
    page.$('#req-end').value = fim;
    page.$('#req-abono').checked = false;
    await page.window.submitRequest();
    await page.settle();
    return page.text('#modal-alert');
}

describe('ferias-colaborador.html — bordas', () => {
    test('falha ao ler férias e feriados: histórico vazio e saldo indisponível; contrato sem tipo não quebra', async () => {
        const c = colabClient({ errors: { 'vacations:select': { message: 'x' }, holidays: { message: 'y' } } });
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).contract_type = null;
        page = await openPage('ferias-colaborador', { client: c, now: NOW });
        assert.equal(page.$$('.history-card').length, 0);
        assert.equal(page.text('#val-saldo'), '—');
    });

    test('histórico: situação desconhecida, férias coletivas, substituto que saiu da lista e período que atravessa o ano', async () => {
        const c = colabClient({
            vacations: [
                ferias('v1', '2025-12-22', '2026-01-10', 20, {
                    status: 'em_revisao',
                    coletiva: true,
                    substituto_id: 'saiu',
                    created_at: '2025-11-01T10:00:00Z',
                }),
                ferias('v2', '2026-12-28', '2027-01-06', 10, { created_at: '2026-05-01T10:00:00Z' }),
            ],
        });
        page = await openPage('ferias-colaborador', { client: c, now: NOW });
        const card = page.$$('.history-card').find((el) => /22\/12\/2025/.test(el.textContent));
        assert.match(card.textContent, /Coletiva/);
        assert.match(card.textContent, /Pendente/);
        assert.doesNotMatch(card.textContent, /Cobertura/);
        const barras = page.$$('#timeline-bars .tl-bar');
        assert.equal(barras.length, 2);
        const semSituacao = barras.find((b) => b.className.trim() === 'tl-bar');
        const aprovada = barras.find((b) => b !== semSituacao);
        assert.equal(semSituacao.style.left, '0%');
        assert.ok(parseFloat(aprovada.style.left) + parseFloat(aprovada.style.width) <= 100.01);
    });

    test('exportar para o calendário com um id que não existe não faz nada; fundo de outro modal fecha o modal', async () => {
        page = await openPage('ferias-colaborador', { client: colabClient(), now: NOW });
        page.eval(`downloadIcs('nao-existe'); openGoogleCalendar('nao-existe')`);
        assert.equal(page.downloads.length, 0);
        const modal = page.document.createElement('div');
        modal.id = 'outro-modal';
        modal.className = 'open';
        page.document.body.appendChild(modal);
        page.window.handleOverlayClick({ target: modal, currentTarget: modal }, 'outro-modal');
        assert.equal(modal.classList.contains('open'), false);
    });

    test('substituto sem setor aparece só pelo nome', async () => {
        page = await openPage('ferias-colaborador', { client: colabClient(), now: NOW });
        await page.click('#btn-solicitar');
        assert.equal(page.$('#req-substituto-popover .select-option[data-value="' + BIA.id + '"]').textContent, BIA.name);
    });

    test('seletor de ano da linha do tempo: clicar de novo fecha; área vazia não escolhe', async () => {
        page = await openPage('ferias-colaborador', { client: colabClient(), now: NOW });
        await page.click('#timeline-year-trigger');
        await page.click('#timeline-year-popover');
        assert.ok(page.$('#timeline-year-popover').classList.contains('open'));
        await page.click('#timeline-year-trigger');
        assert.equal(page.$('#timeline-year-popover').classList.contains('open'), false);
    });

    test('terceira fração curta é aceita quando outra já tem 14 dias; fração sem dias gravados conta como zero', async () => {
        const c = colabClient({
            vacations: [ferias('f1', '2026-02-02', '2026-02-15', 14), ferias('f2', '2026-03-02', '2026-03-06', null, { created_at: '2026-02-20T10:00:00Z' })],
        });
        page = await openPage('ferias-colaborador', { client: c, now: NOW });
        await page.click('#btn-solicitar');
        page.$('#req-start').value = '2026-08-03';
        page.$('#req-end').value = '2026-08-07';
        page.window.calcDays();
        assert.doesNotMatch(page.text('#modal-alert'), /14 dias/);
        assert.doesNotMatch(await enviar('2026-08-03', '2026-08-07'), /14 dias/);
        assert.equal(c.writes('vacations', 'insert').length, 1);
    });

    test('sem data de admissão o contador de frações considera zero frações', async () => {
        const c = colabClient();
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).admission_date = null;
        page = await openPage('ferias-colaborador', { client: c, now: NOW });
        page.window.openRequestModal();
        assert.match(page.text('#fraction-info'), /Fração 1 de 3/);
    });

    test('admissão futura: nenhum ciclo ainda, frações começam do zero', async () => {
        const c = colabClient();
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).admission_date = '2026-07-01';
        page = await openPage('ferias-colaborador', { client: c, now: NOW });
        page.window.openRequestModal();
        assert.match(page.text('#fraction-info'), /Fração 1 de 3/);
    });
});
