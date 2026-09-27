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
    test('dois ciclos fechados sem faltas = 60 dias; o abono vendido também sai do saldo', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'v1',
                    employee_id: ANA.id,
                    start_date: '2025-03-03',
                    end_date: '2025-03-22',
                    days: 20,
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
        assert.match(page.text('#history-list'), /03\/03\/2025 → 22\/03\/2025.*20 dias.*Abono Pecuniário.*Concluído/);
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
        await pickDate(page, 'req-end', '2026-08-22');
        assert.equal(page.text('#days-count'), '20 dias de descanso');
        assert.equal(page.$('#req-abono').disabled, false);
        await page.check('#req-abono');
        assert.equal(page.text('#days-count'), '20 dias de descanso + 10 vendidos (abono)');
        assert.match(page.text('#valor-ferias-total'), /5\.333,33/);

        await page.click('#btn-confirm');
        const [ins] = client.writes('vacations', 'insert');
        assert.deepEqual(
            { ...ins.payload[0], obs: undefined },
            {
                employee_id: ANA.id,
                start_date: '2026-08-03',
                end_date: '2026-08-22',
                days: 20,
                abono: true,
                substituto_id: null,
                obs: undefined,
                status: 'pendente',
            }
        );
        assert.ok(page.toasts().includes('Solicitação enviada! Aguardando aprovação do RH.'));
        assert.match(page.text('#history-list'), /Pendente/);
    });

    test('abono só com saldo para os 10 dias vendidos, além do descanso', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'v1',
                    employee_id: ANA.id,
                    start_date: '2025-03-03',
                    end_date: '2025-04-11',
                    days: 40,
                    abono: false,
                    status: 'concluido',
                    created_at: '2025-01-10T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client, now: NOW });
        assert.equal(page.text('#val-saldo'), '20 dias');
        await page.click('#btn-solicitar');
        await pickDate(page, 'req-start', '2026-08-03');
        await pickDate(page, 'req-end', '2026-08-22');
        assert.equal(page.text('#days-count'), '20 dias de descanso');
        assert.equal(page.$('#req-abono').disabled, true);
        assert.match(page.text('#abono-hint'), /Saldo insuficiente para vender 10 dias/);
        await pickDate(page, 'req-end', '2026-08-12');
        assert.equal(page.$('#req-abono').disabled, false, '10 de descanso + 10 vendidos cabem nos 20');
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

describe('ferias-colaborador.html — validações do envio, tempo real e navegação', () => {
    async function abrir(client, now = NOW) {
        page = await openPage('ferias-colaborador', { client, now });
        await page.click('#btn-solicitar');
    }
    async function enviar(inicio, fim, { abono = false } = {}) {
        page.$('#req-start').value = inicio;
        page.$('#req-end').value = fim;
        page.$('#req-abono').checked = abono;
        await page.window.submitRequest();
        await page.settle();
        return page.text('#modal-alert');
    }

    test('o servidor da tela barra o envio mesmo se o botão for burlado', async () => {
        const client = colabClient();
        await abrir(client);
        assert.match(await enviar('', ''), /Selecione as datas de início e fim/);
        assert.match(await enviar('2026-07-01', '2026-07-10'), /Antecedência mínima de 30 dias/);
        assert.match(await enviar('2026-08-03', '2026-08-05'), /Período mínimo de 5 dias/);
        assert.match(await enviar('2026-08-03', '2026-11-30'), /Saldo insuficiente/);
        assert.equal(client.writes('vacations', 'insert').length, 0);
    });

    test('frações: quarta fração é barrada; a terceira exige que alguma tenha 14 dias', async () => {
        const fr = (id, ini, fim, days) => ({
            id,
            employee_id: ANA.id,
            start_date: ini,
            end_date: fim,
            days,
            status: 'aprovado',
            created_at: '2026-01-10T10:00:00Z',
        });
        const client = colabClient({ vacations: [fr('f1', '2026-02-02', '2026-02-06', 5), fr('f2', '2026-03-02', '2026-03-06', 5)] });
        await abrir(client);
        assert.match(await enviar('2026-08-03', '2026-08-07'), /Ao menos uma fração deve ter 14 dias corridos/);
        page.close();

        const tres = colabClient({
            vacations: [fr('f1', '2026-02-02', '2026-02-06', 5), fr('f2', '2026-03-02', '2026-03-06', 5), fr('f3', '2026-04-06', '2026-04-19', 14)],
        });
        await abrir(tres);
        assert.match(await enviar('2026-08-03', '2026-08-07'), /3 frações de férias permitidas/);
    });

    test('menor de 18 ou 50 anos ou mais: férias em período único', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'f1',
                    employee_id: ANA.id,
                    start_date: '2026-03-02',
                    end_date: '2026-03-11',
                    days: 10,
                    status: 'aprovado',
                    created_at: '2026-01-10T10:00:00Z',
                },
            ],
        });
        client.tables.employees_decrypted.find((e) => e.id === ANA.id).birth_date = '1970-01-01';
        await abrir(client);
        assert.match(await enviar('2026-08-03', '2026-08-12'), /devem gozar as férias em período único/);
    });

    test('erro do banco ao enviar mantém o formulário aberto e avisa', async () => {
        const client = colabClient();
        client.errors['vacations:insert'] = { message: 'falhou' };
        await abrir(client);
        assert.match(await enviar('2026-08-03', '2026-08-12'), /Erro ao enviar solicitação/);
        assert.equal(page.$('#btn-confirm').disabled, false, 'o botão volta a ficar disponível');
    });

    test('estagiário: recesso sem abono pecuniário, com aviso da Lei do Estágio', async () => {
        const client = colabClient();
        client.tables.employees_decrypted.find((e) => e.id === ANA.id).contract_type = 'estagio';
        page = await openPage('ferias-colaborador', { client, now: NOW });
        assert.equal(page.$('#req-abono').closest('.form-group').style.display, 'none');
        assert.match(page.text('#request-modal'), /Lei do Estágio \(11\.788\/2008\) — sem abono pecuniário/);
    });

    test('RH decide em tempo real: avisa a aprovação e a recusa e atualiza o histórico', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'p1',
                    employee_id: ANA.id,
                    start_date: '2026-08-03',
                    end_date: '2026-08-12',
                    days: 10,
                    status: 'pendente',
                    created_at: '2026-06-01T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client, now: NOW });
        client.tables.vacations[0].status = 'aprovado';
        client.emit('vacations', { eventType: 'UPDATE', old: { status: 'pendente' }, new: { id: 'p1', status: 'aprovado' } });
        await page.waitFor(() => page.toasts().includes('Suas férias foram aprovadas pelo RH!'));
        await page.waitFor(() => /Aprovado/.test(page.text('#history-list')));
        client.tables.vacations[0].status = 'recusado';
        client.emit('vacations', { eventType: 'UPDATE', old: { status: 'aprovado' }, new: { id: 'p1', status: 'recusado' } });
        await page.waitFor(() => page.toasts().some((t) => /recusada/.test(t)));
        await page.waitFor(() => /Recusado/.test(page.text('#history-list')));
        await page.settle(20);
    });

    test('linha do tempo: escolher o ano pelo seletor; Esc e clique fora fecham', async () => {
        const client = colabClient({
            vacations: [
                {
                    id: 'a1',
                    employee_id: ANA.id,
                    start_date: '2025-03-03',
                    end_date: '2025-03-12',
                    days: 10,
                    status: 'concluido',
                    created_at: '2025-01-10T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client, now: NOW });
        const trigger = page.$('#timeline-year-trigger');
        await page.click(trigger);
        assert.equal(trigger.getAttribute('aria-expanded'), 'true');
        await page.key(page.document, 'Escape');
        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        await page.click(trigger);
        await page.click(page.document.body);
        assert.equal(page.$('#timeline-year-popover').classList.contains('open'), false);
        await page.click(trigger);
        await page.click(page.$('#timeline-year-popover button[data-year="2025"]'));
        assert.equal(page.text('#timeline-year'), '2025');
        assert.ok(page.$$('#timeline-bars > *').length > 0);
    });

    test('motivo da recusa abre e fecha pelo fundo do modal', async () => {
        page = await openPage('ferias-colaborador', { client: colabClient(), now: NOW });
        page.window.showReason('');
        assert.equal(page.text('#detail-reason'), 'Motivo não informado.');
        const modal = page.$('#detail-modal');
        page.window.handleOverlayClick({ target: modal.firstElementChild, currentTarget: modal }, 'detail-modal');
        assert.equal(modal.classList.contains('open'), true, 'clique dentro do cartão não fecha');
        page.window.handleOverlayClick({ target: modal, currentTarget: modal }, 'detail-modal');
        assert.equal(modal.classList.contains('open'), false);
        await page.click('#btn-solicitar');
        const req = page.$('#request-modal');
        page.window.handleOverlayClick({ target: req, currentTarget: req }, 'request-modal');
        assert.equal(req.classList.contains('open'), false);
    });
});
