process.env.TZ = 'America/Sao_Paulo';

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const doc = (id, name, created_at) => ({
    id,
    name,
    employee_id: BIA.id,
    category: 'admissional',
    source: 'Administrador',
    status: 'aprovado',
    storage_path: `rh/${id}.pdf`,
    created_at,
    retido_ate: '2056-06-10',
    version: 1,
});

describe('arquivos.html — filtro por período usa o dia de Brasília', () => {
    test('documento enviado às 22h de 10/06 (01h de 11/06 em UTC) entra no filtro "até 10/06"', async () => {
        const client = new FakeSupabase({
            user: RH_USER,
            tables: baseTables({
                documents: [
                    doc('noite', 'enviado-a-noite.pdf', '2026-06-11T01:00:00Z'),
                    doc('dia11', 'enviado-no-dia-11.pdf', '2026-06-11T14:00:00Z'),
                    doc('madrugada', 'madrugada-do-dia-1.pdf', '2026-06-01T02:30:00Z'),
                ],
                data_access_log: [],
                document_requirements: [],
                document_audit_log: [],
            }),
        });
        page = await openPage('arquivos', { client, now: '2026-06-17T10:00:00-03:00' });
        await page.settle(20);
        await page.click('#filter-date-trigger');
        await page.click('#filter-calendar-grid [data-day="1"]');
        await page.click('#filter-calendar-grid [data-day="10"]');
        await page.click('#filter-calendar-apply');
        const linhas = page.$$('#files-tbody tr').map((tr) => tr.textContent);
        assert.ok(
            linhas.some((l) => /enviado-a-noite\.pdf/.test(l)),
            'noite de 10/06 no horário de Brasília'
        );
        assert.ok(!linhas.some((l) => /enviado-no-dia-11\.pdf/.test(l)));
        assert.ok(!linhas.some((l) => /madrugada-do-dia-1\.pdf/.test(l)), '23h30 de 31/05 em Brasília fica fora de junho');
    });
});
