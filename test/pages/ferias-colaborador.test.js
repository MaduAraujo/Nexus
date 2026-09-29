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

    test('50 anos ou mais também pode fracionar: o art. 134 §2º da CLT foi revogado pela Lei 13.467/2017', async () => {
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
        assert.doesNotMatch(await enviar('2026-08-03', '2026-08-12'), /período único/);
        assert.equal(client.writes('vacations', 'insert').length, 1, 'a segunda fração é enviada');
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

describe('ferias-colaborador.html — vencimento, substituto, calendário e validações', () => {
    const comAdmissao = (data, opts) => {
        const c = colabClient(opts);
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).admission_date = data;
        return c;
    };
    async function enviar(inicio, fim, { abono = false } = {}) {
        page.$('#req-start').value = inicio;
        page.$('#req-end').value = fim;
        page.$('#req-abono').checked = abono;
        await page.window.submitRequest();
        await page.settle();
        return page.text('#modal-alert');
    }

    test('saldo vencendo em até 60 dias fica vermelho; em até 120 dias, amarelo', async () => {
        page = await openPage('ferias-colaborador', { client: comAdmissao('2024-08-01'), now: NOW });
        assert.equal(page.text('#val-vencer'), '30 dias');
        assert.match(page.text('#sub-vencer'), /⚠ Vencem em \d+ dias!/);
        assert.ok(page.$('#card-vencer').classList.contains('summary-card--danger'));
        page.close();

        page = await openPage('ferias-colaborador', { client: comAdmissao('2024-09-15'), now: NOW });
        assert.match(page.text('#sub-vencer'), /^Vencem em \d+ dias$/);
        assert.ok(page.$('#card-vencer').classList.contains('summary-card--warning'));
    });

    test('saldo zerado desabilita o botão de solicitar', async () => {
        const gozou = comAdmissao('2024-08-01', {
            vacations: [
                {
                    id: 'v1',
                    employee_id: ANA.id,
                    start_date: '2025-09-01',
                    end_date: '2025-09-30',
                    days: 30,
                    status: 'concluido',
                    created_at: '2025-07-01T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client: gozou, now: NOW });
        assert.equal(page.text('#sub-vencer'), 'Saldo zerado');
        assert.equal(page.$('#btn-solicitar').disabled, true);
        assert.equal(page.$('#btn-solicitar').title, 'Sem saldo de férias');
    });

    test('sem data de admissão o resumo mostra traço e explica', async () => {
        page = await openPage('ferias-colaborador', { client: comAdmissao(null), now: NOW });
        assert.equal(page.text('#val-saldo'), '—');
        assert.equal(page.text('#sub-saldo'), 'Data de admissão não informada');
    });

    test('substituto: lista os colegas (sem a própria pessoa), escolhe e vai no pedido; aparece no histórico', async () => {
        const c = colabClient();
        page = await openPage('ferias-colaborador', { client: c, now: NOW });
        await page.click('#btn-solicitar');
        const pop = page.$('#req-substituto-popover');
        assert.deepEqual(
            page.$$('#req-substituto-popover .select-option').map((o) => o.textContent),
            ['Nenhum', 'Bia Lima — Financeiro']
        );
        await page.click('#req-substituto-trigger');
        assert.equal(pop.classList.contains('open'), true);
        await page.click(pop);
        assert.equal(pop.classList.contains('open'), true, 'clique fora das opções não escolhe');
        await page.click(pop.querySelector(`[data-value="${BIA.id}"]`));
        assert.equal(pop.classList.contains('open'), false);
        assert.equal(page.text('#req-substituto-text'), 'Bia Lima — Financeiro');
        assert.ok(pop.querySelector(`[data-value="${BIA.id}"]`).classList.contains('selected'));

        await page.click('#req-substituto-trigger');
        await page.click('#req-substituto-trigger');
        assert.equal(pop.classList.contains('open'), false);
        await page.click('#req-substituto-trigger');
        await page.key(page.document, 'a');
        assert.equal(pop.classList.contains('open'), true);
        await page.key(page.document, 'Escape');
        assert.equal(pop.classList.contains('open'), false);
        await page.click('#req-substituto-trigger');
        await page.click('#req-obs');
        assert.equal(pop.classList.contains('open'), false);

        assert.equal(await enviar('2026-08-03', '2026-08-12'), '');
        assert.equal(c.writes('vacations', 'insert')[0].payload[0].substituto_id, BIA.id);
        assert.match(page.text('#history-list'), /Cobertura: Bia Lima/);
    });

    test('calendário: vira o ano nos dois sentidos, Esc e clique fora fecham, abrir um fecha o outro', async () => {
        page = await openPage('ferias-colaborador', { client: colabClient(), now: NOW });
        await page.click('#btn-solicitar');
        const pop = page.$('#req-start-popover');
        await page.click('#req-start-trigger');
        const titulo = () => page.text('#req-start-title');
        assert.match(titulo(), /Julho 2026/);
        for (let i = 0; i < 7; i++) await page.click('#req-start-prev');
        assert.match(titulo(), /Dezembro 2025/);
        for (let i = 0; i < 13; i++) await page.click('#req-start-next');
        assert.match(titulo(), /Janeiro 2027/);
        assert.equal(pop.classList.contains('open'), true);

        await page.click(page.$('#req-start-grid .calendar-day--muted') || page.$('#req-start-grid button[disabled]'));
        assert.equal(pop.classList.contains('open'), true, 'dia desabilitado não é escolhido');

        await page.click('#req-end-trigger');
        assert.equal(pop.classList.contains('open'), false, 'abrir o fim fecha o início');
        assert.equal(page.$('#req-end-popover').classList.contains('open'), true);
        await page.key(page.document, 'Tab');
        assert.equal(page.$('#req-end-popover').classList.contains('open'), true);
        await page.key(page.document, 'Escape');
        assert.equal(page.$('#req-end-popover').classList.contains('open'), false);

        await page.click('#req-start-trigger');
        await page.click('#req-start-popover');
        assert.equal(pop.classList.contains('open'), true, 'clique dentro não fecha');
        await page.click('#req-obs');
        assert.equal(pop.classList.contains('open'), false);
    });

    test('fim antes do início é apontado na hora', async () => {
        page = await openPage('ferias-colaborador', { client: colabClient(), now: NOW });
        await page.click('#btn-solicitar');
        page.$('#req-start').value = '2026-08-10';
        page.$('#req-end').value = '2026-08-05';
        page.window.calcDays();
        assert.equal(page.text('#days-count'), 'A data de fim deve ser após o início');
        assert.ok(page.$('#days-preview').classList.contains('days-preview--error'));
        assert.equal(page.$('#btn-confirm').disabled, true);
    });

    test('sem salário cadastrado não mostra a prévia de valor', async () => {
        const c = colabClient();
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).salary = null;
        page = await openPage('ferias-colaborador', { client: c, now: NOW });
        await page.click('#btn-solicitar');
        page.$('#req-start').value = '2026-08-03';
        page.$('#req-end').value = '2026-08-12';
        page.window.calcDays();
        assert.equal(page.$('#valor-ferias-preview').classList.contains('hidden'), true);
    });

    test('abono pedido duas vezes no mesmo período aquisitivo é barrado', async () => {
        const c = colabClient({
            vacations: [
                {
                    id: 'f1',
                    employee_id: ANA.id,
                    start_date: '2026-03-02',
                    end_date: '2026-03-11',
                    days: 10,
                    abono: true,
                    status: 'aprovado',
                    created_at: '2026-01-10T10:00:00Z',
                },
            ],
        });
        page = await openPage('ferias-colaborador', { client: c, now: NOW });
        await page.click('#btn-solicitar');
        assert.match(await enviar('2026-08-03', '2026-08-16', { abono: true }), /O abono já foi pedido neste período aquisitivo/);
        assert.equal(c.writes('vacations', 'insert').length, 0);
    });

    test('estagiário não vê o contador de frações', async () => {
        const c = colabClient();
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).contract_type = 'aprendiz';
        page = await openPage('ferias-colaborador', { client: c, now: NOW });
        await page.click('#btn-solicitar');
        page.$('#req-start').value = '2026-08-03';
        page.$('#req-end').value = '2026-08-12';
        page.window.calcDays();
        assert.equal(page.$('#fraction-info').classList.contains('hidden'), true);
    });

    test('cancelar: desistir na confirmação não cancela; erro do banco avisa', async () => {
        const pendente = {
            id: 'v9',
            employee_id: ANA.id,
            start_date: '2026-09-01',
            end_date: '2026-09-10',
            days: 10,
            status: 'pendente',
            created_at: '2026-06-01T10:00:00Z',
        };
        const c = colabClient({ vacations: [pendente] });
        page = await openPage('ferias-colaborador', { client: c, now: NOW, confirm: false });
        await page.click('[data-click="cancelRequest"]');
        assert.equal(c.writes('vacations', 'update').length, 0);
        page.close();

        const e = colabClient({ vacations: [{ ...pendente }] });
        e.errors['vacations:update'] = { message: 'RLS' };
        page = await openPage('ferias-colaborador', { client: e, now: NOW });
        await page.click('[data-click="cancelRequest"]');
        assert.ok(page.toasts().includes('Erro ao cancelar. Tente novamente.'));
        assert.equal(e.tables.vacations[0].status, 'pendente');
    });

    test('o aviso some sozinho depois de alguns segundos', async () => {
        page = await openPage('ferias-colaborador', { client: colabClient(), now: NOW });
        const w = page.window;
        const original = w.setTimeout;
        w.setTimeout = (fn, ms, ...a) => (ms >= 400 ? (fn(...a), 0) : original(fn, ms, ...a));
        w.showToast('Aviso de teste');
        w.setTimeout = original;
        assert.deepEqual(page.toasts(), []);
    });
});

describe('ferias-colaborador.html — art. 134 §3º (início nos 2 dias antes de feriado ou DSR)', () => {
    async function abrirPedido(client) {
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('#btn-solicitar');
        await page.click('#req-start-trigger');
        for (let i = 0; i < 24 && !page.$('#req-start-grid button[data-date="2026-08-07"]'); i++) await page.click('#req-start-next');
    }
    const dia = (iso) => page.$(`#req-start-grid button[data-date="${iso}"]`);

    test('no calendário, sexta e sábado ficam desabilitados e explicam o motivo', async () => {
        await abrirPedido(colabClient());
        assert.equal(dia('2026-08-07').disabled, true);
        assert.equal(dia('2026-08-08').disabled, true);
        assert.match(dia('2026-08-07').title, /descanso semanal \(domingo, 09\/08\).*art\. 134 §3º/);
        assert.equal(dia('2026-08-06').disabled, false);
        assert.equal(dia('2026-08-06').title, '');
        assert.equal(dia('2026-08-09').disabled, false, 'o próprio domingo pode');
    });

    test('feriado cadastrado pelo RH bloqueia os 2 dias antes; ponto facultativo não', async () => {
        await abrirPedido(
            colabClient({
                extra: {
                    holidays: [
                        { date: '2026-08-20', name: 'Feriado municipal', abrangencia: 'municipal' },
                        { date: '2026-08-13', name: 'Ponto facultativo', abrangencia: 'facultativo' },
                    ],
                },
            })
        );
        assert.equal(dia('2026-08-18').disabled, true);
        assert.equal(dia('2026-08-19').disabled, true);
        assert.match(dia('2026-08-18').title, /feriado \(20\/08\)/);
        assert.equal(dia('2026-08-17').disabled, false);
        assert.equal(dia('2026-08-11').disabled, false, 'facultativo não conta');
        assert.equal(dia('2026-08-12').disabled, false);
    });

    test('mesmo burlando o calendário, o envio é barrado e nada é gravado', async () => {
        const client = colabClient();
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('#btn-solicitar');
        page.$('#req-start').value = '2026-08-07';
        page.$('#req-end').value = '2026-08-16';
        page.window.calcDays();
        assert.match(page.text('#modal-alert'), /descanso semanal/);
        assert.equal(page.$('#btn-confirm').disabled, true);
        await page.window.submitRequest();
        assert.match(page.text('#modal-alert'), /art\. 134 §3º/);
        assert.equal(client.writes('vacations', 'insert').length, 0);
    });

    test('estagiário (recesso da Lei do Estágio) pode começar numa sexta', async () => {
        const client = colabClient();
        client.tables.employees_decrypted.find((e) => e.id === ANA.id).contract_type = 'estagio';
        await abrirPedido(client);
        assert.equal(dia('2026-08-07').disabled, false);
    });
});

describe('ferias-colaborador.html — recusa vinda do banco', () => {
    test('se a regra do banco recusar o pedido, a tela mostra o motivo dado pelo banco', async () => {
        const client = colabClient();
        client.errors['vacations:insert'] = { code: '23514', message: 'O abono já foi pedido neste período aquisitivo.' };
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('#btn-solicitar');
        page.$('#req-start').value = '2026-08-03';
        page.$('#req-end').value = '2026-08-12';
        await page.window.submitRequest();
        await page.settle();
        assert.match(page.text('#modal-alert'), /O abono já foi pedido neste período aquisitivo\./);
    });

    test('outros erros do banco continuam com a mensagem genérica, sem expor detalhes técnicos', async () => {
        const client = colabClient();
        client.errors['vacations:insert'] = { code: '42501', message: 'new row violates row-level security policy for table "vacations"' };
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('#btn-solicitar');
        page.$('#req-start').value = '2026-08-03';
        page.$('#req-end').value = '2026-08-12';
        await page.window.submitRequest();
        await page.settle();
        assert.match(page.text('#modal-alert'), /Erro ao enviar solicitação/);
        assert.doesNotMatch(page.text('#modal-alert'), /row-level security/);
    });
});

describe('ferias-colaborador.html — avisos ao vivo enquanto escolhe as datas', () => {
    async function prever(client, inicio, fim) {
        page = await openPage('ferias-colaborador', { client, now: NOW });
        await page.click('#btn-solicitar');
        page.$('#req-start').value = inicio;
        page.$('#req-end').value = fim;
        page.window.calcDays();
        return page.text('#modal-alert');
    }
    const fr = (id, ini, fim, days) => ({
        id,
        employee_id: ANA.id,
        start_date: ini,
        end_date: fim,
        days,
        status: 'aprovado',
        created_at: '2026-01-10T10:00:00Z',
    });

    test('menos de 30 dias de antecedência e menos de 5 dias aparecem juntos, e o botão fica bloqueado', async () => {
        const alerta = await prever(colabClient(), '2026-07-06', '2026-07-08');
        assert.match(alerta, /Antecedência mínima de 30 dias \(a partir de 17\/07\/2026\)/);
        assert.match(alerta, /período mínimo de férias é de 5 dias corridos/);
        assert.equal(page.$('#btn-confirm').disabled, true);
        assert.equal(page.text('#days-count'), '3 dias de descanso');
    });

    test('um dia só usa o singular', async () => {
        await prever(colabClient(), '2026-08-03', '2026-08-03');
        assert.equal(page.text('#days-count'), '1 dia de descanso');
    });

    test('terceira fração sem nenhuma de 14 dias e quarta fração são avisadas antes de enviar', async () => {
        const duas = colabClient({ vacations: [fr('f1', '2026-02-02', '2026-02-06', 5), fr('f2', '2026-03-02', '2026-03-06', 5)] });
        assert.match(await prever(duas, '2026-08-03', '2026-08-12'), /Ao menos uma fração deve ter 14 dias corridos/);
        page.close();

        const tres = colabClient({
            vacations: [fr('f1', '2026-02-02', '2026-02-06', 5), fr('f2', '2026-03-02', '2026-03-06', 5), fr('f3', '2026-04-06', '2026-04-19', 14)],
        });
        assert.match(await prever(tres, '2026-08-03', '2026-08-12'), /já utilizou as 3 frações/);
        assert.equal(page.$('#btn-confirm').disabled, true);
    });
});

describe('ferias-colaborador.html — falha ao conferir as faltas', () => {
    test('saldo aparece como indisponível e o pedido fica bloqueado, em vez de mostrar um saldo errado', async () => {
        const client = colabClient();
        client.errors['time_records:select'] = { message: 'rede' };
        page = await openPage('ferias-colaborador', { client, now: NOW });
        assert.equal(page.text('#val-saldo'), '—');
        assert.match(page.text('#sub-saldo'), /Não foi possível conferir as faltas agora/);
        assert.equal(page.$('#btn-solicitar').disabled, true);
        assert.match(page.text('#history-list'), /Nenhuma|Solicitações|férias/i, 'o resto da tela continua carregando');
    });
});
