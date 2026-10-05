const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function client(extra = {}) {
    const tables = baseTables({
        time_records: [
            {
                id: 'tr1',
                employee_id: ANA.id,
                date: '2026-06-15',
                entrada: '2026-06-15T08:00:00-03:00',
                saida_almoco: '2026-06-15T12:00:00-03:00',
                retorno_almoco: '2026-06-15T13:00:00-03:00',
                saida: '2026-06-15T17:00:00-03:00',
                offline_steps: ['entrada'],
            },
        ],
        bank_adjustments: [
            {
                id: 'folha',
                employee_id: ANA.id,
                tipo: 'debito',
                minutos: 240,
                date: '2026-06-01',
                justificativa: 'Pago como hora extra',
                created_by_name: 'Folha de pagamento',
                deleted_at: null,
            },
            {
                id: 'manual',
                employee_id: ANA.id,
                tipo: 'credito',
                minutos: 30,
                date: '2026-06-02',
                justificativa: 'Ajuste manual',
                created_by_name: 'rh',
                deleted_at: null,
            },
        ],
        bank_requests: [],
        holidays: [],
        vacations: [],
        hr_settings: [{ id: 1, banco_horas_vencimento_meses: 6, limite_extra_diario_min: 120 }],
        activity_logs: [],
        ...extra,
    });
    return new FakeSupabase({ user: RH_USER, tables });
}

const rowOf = (p, name) => p.$$('#banco-tbody tr').find((tr) => tr.textContent.includes(name));

async function abrirDetalhe(c) {
    page = await openPage('banco-horas-rh', { client: c, now: NOW });
    await page.click(rowOf(page, 'Ana Souza').querySelector('[data-click="openDetailModal"]'));
}

describe('banco-horas-rh.html — débito lançado pela folha', () => {
    test('o débito da folha não tem botão de excluir; o ajuste manual tem', async () => {
        await abrirDetalhe(client());
        const itens = page.$$('#detail-body .ajuste-item');
        const daFolha = itens.find((i) => /Pago como hora extra/.test(i.textContent));
        const manual = itens.find((i) => /Ajuste manual/.test(i.textContent));
        assert.equal(daFolha.querySelector('[data-click="deleteAjuste"]'), null);
        assert.ok(manual.querySelector('[data-click="deleteAjuste"]'));
    });

    test('se o banco recusar a exclusão, a mensagem dele aparece', async () => {
        const c = client();
        c.errors['bank_adjustments:update'] = { code: '55000', message: 'Este débito foi lançado pela folha e não pode ser excluído.' };
        await abrirDetalhe(c);
        page.window.confirm = () => true;
        await page.window.deleteAjuste(ANA.id, 'manual');
        assert.ok(page.toasts().some((t) => /lançado pela folha e não pode ser excluído/.test(t)));
    });
});

describe('banco-horas-rh.html — marcação feita sem internet', () => {
    test('a marcação registrada offline aparece com o selo para o RH', async () => {
        await abrirDetalhe(client());
        const selos = page.$$('#detail-body .dt-offline');
        assert.equal(selos.length, 1);
        assert.match(selos[0].getAttribute('title'), /sem internet/);
    });
});
