const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function colabClient({ vacations = [], time_records = [], medical_leaves = [], extra = {} } = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({ vacations, time_records, medical_leaves, holidays: [], adjustment_requests: [], ...extra }),
        rpc: {
            colleague_directory: [
                { id: ANA.id, name: ANA.name, dept: ANA.dept },
                { id: BIA.id, name: BIA.name, dept: BIA.dept },
            ],
        },
    });
}

function presencas(inicio, fim, exceto = []) {
    const out = [];
    for (let d = new Date(`${inicio}T12:00:00`); d <= new Date(`${fim}T12:00:00`); d.setDate(d.getDate() + 1)) {
        const k = d.toISOString().slice(0, 10);
        if (d.getDay() === 0 || d.getDay() === 6 || exceto.includes(k)) continue;
        out.push({ employee_id: ANA.id, date: k, entrada: `${k}T08:00:00-03:00` });
    }
    return out;
}

async function pickDate(p, prefix, iso) {
    await p.click(`#${prefix}-trigger`);
    for (let i = 0; i < 24 && !p.$(`#${prefix}-grid button[data-date="${iso}"]`); i++) await p.click(`#${prefix}-next`);
    const btn = p.$(`#${prefix}-grid button[data-date="${iso}"]`);
    assert.ok(btn, `data ${iso} no calendário`);
    assert.equal(btn.disabled, false, `data ${iso} habilitada`);
    await p.click(btn);
}

describe('ferias-colaborador.html — saldo', () => {
    test('dois ciclos fechados sem faltas = 60 dias; aprovadas descontam o período inteiro (abono incluso)', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'v1',
                    employee_id: ANA.id,
                    start_date: '2025-03-03',
                    end_date: '2025-04-01',
                    days: 30,
                    abono: true,
                    status: 'concluido',
                    created_at: '2025-01-10T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client, now: NOW });
        assert.equal(page.text('#val-saldo'), '30 dias');
        assert.equal(page.text('#sub-saldo'), '60 ganhos · 30 utilizados');
        assert.equal(page.text('#val-periodo'), '01/02/2026 – 31/01/2027');
        assert.match(page.text('#history-list'), /03\/03\/2025 → 01\/04\/2025.*30 dias.*Abono Pecuniário.*Concluído/);
    });

    test('faltas reduzem o direito, mas férias, atestado e o período sem ponto no sistema não são faltas', async () => {
        const faltas = ['2025-09-01', '2025-09-02', '2025-09-03', '2025-09-04', '2025-09-05', '2025-09-08', '2025-09-09'];
        const client = colabClient({
            time_records: presencas('2025-02-03', '2026-06-16', [...faltas, ...presencas('2025-11-03', '2025-11-14').map((r) => r.date), '2025-12-10']),
            vacations: [
                {
                    id: 'v1',
                    employee_id: ANA.id,
                    start_date: '2025-11-03',
                    end_date: '2025-11-14',
                    days: 12,
                    status: 'concluido',
                    created_at: '2025-09-20T10:00:00Z',
                },
            ],
            medical_leaves: [{ id: 'm1', employee_id: ANA.id, start_date: '2025-12-10', end_date: '2025-12-10', status: 'aprovado' }],
        });
        page = await openPage('ferias-colaborador', { client, now: NOW });
        assert.equal(page.text('#sub-saldo'), '54 ganhos · 12 utilizados · reduzido em 6d por faltas');
        assert.equal(page.text('#val-saldo'), '42 dias');
    });

    test('menos de 12 meses de casa: sem saldo e botão de solicitar desabilitado', async () => {
        const client = colabClient();
        client.tables.employees_decrypted.find((e) => e.id === ANA.id).admission_date = '2026-01-05';
        page = await openPage('ferias-colaborador', { client, now: NOW });
        assert.match(page.text('#sub-saldo'), /Aguardando completar 12 meses \(7 meses restantes\)/);
        assert.equal(page.$('#btn-solicitar').disabled, true);
    });

    test('ciclo fechado sem gozo e com período concessivo vencido mostra alerta de férias em dobro', async () => {
        const client = colabClient();
        page = await openPage('ferias-colaborador', { client, now: NOW });
        assert.equal(page.visible('#expired-banner'), true);
        assert.match(page.text('#expired-banner'), /30 dias de férias vencidas.*art\. 137/);
    });
});

describe('ferias-colaborador.html — solicitar', () => {
    test('valida antecedência de 30 dias no calendário e envia a solicitação com abono', async () => {
        const client = colabClient();
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('#btn-solicitar');
        assert.match(page.text('#fraction-info'), /Fração 1 de 3/);

        await page.click('#req-start-trigger');
        assert.equal(page.$('#req-start-grid button[data-date="2026-07-16"]').disabled, true);
        await page.click('#req-start-trigger');

        await pickDate(page, 'req-start', '2026-08-03');
        await pickDate(page, 'req-end', '2026-09-01');
        assert.equal(page.text('#days-count'), '30 dias selecionados');
        assert.equal(page.$('#req-abono').disabled, false);
        await page.check('#req-abono');
        assert.equal(page.text('#days-count'), '30 dias selecionados · 20 de descanso + 10 de abono');
        assert.match(page.text('#valor-ferias-total'), /5\.333,33/);

        await page.click('#btn-confirm');
        const [ins] = client.writes('vacations', 'insert');
        assert.deepEqual(
            { ...ins.payload[0], obs: undefined },
            {
                employee_id: ANA.id,
                start_date: '2026-08-03',
                end_date: '2026-09-01',
                days: 30,
                abono: true,
                substituto_id: null,
                obs: undefined,
                status: 'pendente',
            }
        );
        assert.ok(page.toasts().includes('Solicitação enviada! Aguardando aprovação do RH.'));
        assert.match(page.text('#history-list'), /Pendente/);
    });

    test('mais dias do que o saldo bloqueia o envio', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'v1',
                    employee_id: ANA.id,
                    start_date: '2025-03-03',
                    end_date: '2025-04-11',
                    days: 40,
                    status: 'concluido',
                    created_at: '2025-01-10T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('#btn-solicitar');
        await pickDate(page, 'req-start', '2026-08-03');
        await pickDate(page, 'req-end', '2026-08-30');
        assert.match(page.text('#request-alert') || page.text('.modal-alert') || page.text('body'), /Saldo insuficiente — você tem apenas 20 dias disponíveis/);
        assert.equal(page.$('#btn-confirm').disabled, true);
    });

    test('cancelar uma solicitação pendente', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'v9',
                    employee_id: ANA.id,
                    start_date: '2026-09-01',
                    end_date: '2026-09-10',
                    days: 10,
                    status: 'pendente',
                    created_at: '2026-06-01T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('[data-click="cancelRequest"]');
        assert.equal(client.tables.vacations[0].status, 'cancelado');
        assert.ok(page.toasts().includes('Solicitação cancelada.'));
    });

    test('solicitação recusada mostra o motivo', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'v9',
                    employee_id: ANA.id,
                    start_date: '2026-09-01',
                    end_date: '2026-09-10',
                    days: 10,
                    status: 'recusado',
                    rejection_reason: 'Fechamento',
                    created_at: '2026-06-01T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('[data-click="showReason"]');
        assert.match(page.text('body'), /Fechamento/);
    });

    test('exporta férias aprovadas para o calendário (.ics e Google)', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'v1',
                    employee_id: ANA.id,
                    start_date: '2026-07-20',
                    end_date: '2026-07-29',
                    days: 10,
                    status: 'aprovado',
                    created_at: '2026-05-01T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('[data-click="downloadIcs"]');
        const ics = await page.objectUrls.at(-1).text();
        assert.match(ics, /DTSTART;VALUE=DATE:20260720/);
        assert.match(ics, /DTEND;VALUE=DATE:20260730/);
        await page.click('[data-click="openGoogleCalendar"]');
        assert.match(page.opened[0].url, /google\.com\/calendar\/render\?action=TEMPLATE.*dates=20260720\/20260730/);
    });
});
