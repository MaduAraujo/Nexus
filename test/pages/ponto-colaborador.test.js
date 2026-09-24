const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, MANAGER_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NA_EMPRESA = { lat: -23.5591, lng: -46.6606 };
const LONGE = { lat: -23.6, lng: -46.7 };
const HOJE = '2026-06-17';
const QUEUE_KEY = `nexus_ponto_offline_${ANA.id}`;

function punchRpc({ p_date, p_step, p_loc, p_selfie_path }, client) {
    const rows = client.tables.time_records;
    let rec = rows.find((r) => r.employee_id === ANA.id && r.date === p_date);
    if (!rec) rows.push((rec = { id: `tr-${p_date}`, employee_id: ANA.id, date: p_date }));
    if (rec[p_step]) return { error: { message: 'passo já registrado' } };
    rec[p_step] = client.now();
    rec[`${p_step}_loc`] = p_loc;
    rec[`${p_step}_selfie_path`] = p_selfie_path;
    return [rec];
}

function colabClient({ records = [], extra = {}, now } = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        now: now ? () => new Date(now).toISOString() : undefined,
        tables: baseTables({
            time_records: records,
            adjustment_requests: [],
            bank_requests: [],
            holidays: [],
            hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
            activity_logs: [],
            ...extra,
        }),
        rpc: { punch_time_record: punchRpc, report_daily_overtime_alert: {} },
    });
}

const filesOk = async (url) => {
    assert.match(url, /\/functions\/v1\/nexus-files$/);
    return new Response('{}', { status: 200 });
};

async function baterPonto(p, { justificativa } = {}) {
    await p.click('#btn-ponto');
    assert.ok(p.$('#modal-confirmar').classList.contains('open'), 'modal de confirmação abre');
    await p.click('#btn-selfie-shoot');
    await p.waitFor(() => !p.$('#btn-confirmar-ponto').disabled || justificativa, { message: 'selfie verificada' });
    if (justificativa) await p.fill('#excesso-legal-just', justificativa);
    await p.click('#btn-confirmar-ponto');
    await p.waitFor(() => p.toasts().length);
}

describe('ponto-colaborador.html — acesso e estado inicial', () => {
    test('RH (Administrador) não usa a tela do colaborador', async () => {
        page = await openPage('ponto-colaborador', { client: new FakeSupabase({ user: RH_USER, tables: baseTables() }) });
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/login.html']);
    });

    test('sem registro hoje: botão de entrada e jornada não iniciada', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: `${HOJE}T08:00:00-03:00`, geolocation: NA_EMPRESA });
        assert.equal(page.text('#btn-ponto-text'), 'Registrar Entrada');
        assert.equal(page.text('#ponto-status-text'), 'Jornada não iniciada hoje');
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
    });

    test('meio da jornada: próximo passo é a saída para almoço', async () => {
        const records = [{ employee_id: ANA.id, date: HOJE, entrada: `${HOJE}T08:02:00-03:00` }];
        page = await openPage('ponto-colaborador', { client: colabClient({ records }), now: `${HOJE}T10:00:00-03:00` });
        assert.equal(page.text('#btn-ponto-text'), 'Saída para Almoço');
        assert.equal(page.text('#ponto-status-text'), 'Em expediente desde 08:02');
    });

    test('jornada completa desabilita o botão e mostra o saldo', async () => {
        const records = [
            {
                employee_id: ANA.id,
                date: HOJE,
                entrada: `${HOJE}T08:00:00-03:00`,
                saida_almoco: `${HOJE}T12:00:00-03:00`,
                retorno_almoco: `${HOJE}T13:00:00-03:00`,
                saida: `${HOJE}T18:30:00-03:00`,
            },
        ];
        page = await openPage('ponto-colaborador', { client: colabClient({ records }), now: `${HOJE}T19:00:00-03:00` });
        assert.equal(page.$('#btn-ponto').disabled, true);
        assert.equal(page.text('#ponto-status-text'), 'Jornada encerrada — +1h 30min extras');
    });
});

describe('ponto-colaborador.html — registrar ponto', () => {
    test('entrada dentro da empresa: sobe a selfie, grava o passo e o log', async () => {
        const client = colabClient({ now: `${HOJE}T08:00:00-03:00` });
        page = await openPage('ponto-colaborador', { client, now: `${HOJE}T08:00:00-03:00`, geolocation: NA_EMPRESA, camera: true, fetch: filesOk });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await baterPonto(page);

        assert.deepEqual(page.toasts(), ['Entrada registrada!']);
        const [punch] = client.rpcCalls('punch_time_record');
        assert.equal(punch.args.p_step, 'entrada');
        assert.equal(punch.args.p_date, HOJE);
        assert.match(punch.args.p_selfie_path, new RegExp(`^${ANA.id}/${HOJE}_entrada_\\d+\\.jpg$`));
        assert.equal(page.fetches.length, 1, 'uma selfie enviada');
        assert.equal(client.writes('activity_logs', 'insert').length, 1);
        assert.equal(page.text('#btn-ponto-text'), 'Saída para Almoço');
        assert.equal(page.window.localStorage.getItem(QUEUE_KEY), null);
    });

    test('fora do raio da empresa o ponto não é registrado', async () => {
        const client = colabClient();
        page = await openPage('ponto-colaborador', { client, now: `${HOJE}T08:00:00-03:00`, geolocation: LONGE, camera: true, fetch: filesOk });
        await page.waitFor(() => /Fora/.test(page.text('#loc-status-text')));
        await baterPonto(page);
        assert.match(page.toasts()[0], /fora do raio permitido de 200m/);
        assert.equal(client.rpcCalls('punch_time_record').length, 0);
    });

    test('sem localização o ponto não é registrado', async () => {
        const client = colabClient();
        page = await openPage('ponto-colaborador', { client, now: `${HOJE}T08:00:00-03:00`, camera: true, fetch: filesOk });
        await page.waitFor(() => page.text('#loc-status-text') === 'Localização negada');
        await baterPonto(page);
        assert.match(page.toasts()[0], /Ative a localização/);
        assert.equal(client.rpcCalls('punch_time_record').length, 0);
    });

    test('sem câmera não dá para tirar a selfie nem confirmar', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: `${HOJE}T08:00:00-03:00`, geolocation: NA_EMPRESA });
        await page.click('#btn-ponto');
        assert.match(page.text('#selfie-hint'), /Não foi possível acessar a câmera/);
        assert.equal(page.$('#btn-selfie-shoot').disabled, true);
        assert.equal(page.$('#btn-confirmar-ponto').disabled, true);
    });

    test('saída acima do limite legal de extras exige motivo, avisa o RH e NÃO vira pendência offline', async () => {
        const now = `${HOJE}T20:30:00-03:00`;
        const records = [
            {
                id: 'tr-hoje',
                employee_id: ANA.id,
                date: HOJE,
                entrada: `${HOJE}T08:00:00-03:00`,
                saida_almoco: `${HOJE}T12:00:00-03:00`,
                retorno_almoco: `${HOJE}T13:00:00-03:00`,
            },
        ];
        const client = colabClient({ records, now });
        page = await openPage('ponto-colaborador', { client, now, geolocation: NA_EMPRESA, camera: true, fetch: filesOk });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');

        await page.click('#btn-ponto');
        assert.equal(page.visible('#excesso-legal-bloco'), true);
        assert.match(page.text('#excesso-legal-msg'), /3h 30min de horas extras hoje, acima do limite legal de 2h 00min\/dia/);
        await page.click('#btn-selfie-shoot');
        await page.settle();
        assert.equal(page.$('#btn-confirmar-ponto').disabled, true, 'sem motivo não confirma');
        await page.fill('#excesso-legal-just', 'Fechamento do mês');
        assert.equal(page.$('#btn-confirmar-ponto').disabled, false);
        await page.click('#btn-confirmar-ponto');
        await page.waitFor(() => page.toasts().length);

        assert.deepEqual(page.toasts(), ['Saída registrada — bom descanso!']);
        const [alerta] = client.rpcCalls('report_daily_overtime_alert');
        assert.match(alerta.args.p_titulo, /Limite legal de horas extras diárias excedido \(3h 30min\)/);
        assert.match(alerta.args.p_mensagem, /Justificativa: "Fechamento do mês"/);
        assert.equal(page.window.localStorage.getItem(QUEUE_KEY), null, 'batida já gravada não pode ir para a fila offline');
        assert.equal(client.rpcCalls('punch_time_record').length, 1);
        assert.equal(client.writes('activity_logs', 'insert')[0].payload[0].justificativa, 'Fechamento do mês');
    });

    test('se o aviso ao RH falhar, a batida continua valendo', async () => {
        const now = `${HOJE}T20:30:00-03:00`;
        const records = [
            {
                employee_id: ANA.id,
                date: HOJE,
                entrada: `${HOJE}T08:00:00-03:00`,
                saida_almoco: `${HOJE}T12:00:00-03:00`,
                retorno_almoco: `${HOJE}T13:00:00-03:00`,
            },
        ];
        const client = colabClient({ records, now });
        client.errors['rpc:report_daily_overtime_alert'] = { message: 'falhou' };
        page = await openPage('ponto-colaborador', { client, now, geolocation: NA_EMPRESA, camera: true, fetch: filesOk });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await baterPonto(page, { justificativa: 'Urgência' });
        assert.ok(page.toasts().includes('Saída registrada — bom descanso!'));
        assert.equal(page.window.localStorage.getItem(QUEUE_KEY), null);
    });
});

describe('ponto-colaborador.html — sem conexão', () => {
    test('offline: guarda a batida no aparelho e sincroniza quando a conexão volta', async () => {
        const client = colabClient({ now: `${HOJE}T08:00:00-03:00` });
        page = await openPage('ponto-colaborador', {
            client,
            now: `${HOJE}T08:00:00-03:00`,
            geolocation: NA_EMPRESA,
            camera: true,
            fetch: filesOk,
            online: false,
        });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await baterPonto(page);

        assert.match(page.toasts()[0], /Sem conexão — ponto salvo no aparelho/);
        assert.equal(JSON.parse(page.window.localStorage.getItem(QUEUE_KEY)).length, 1);
        assert.equal(page.visible('#ponto-sync-status'), true);
        assert.equal(page.text('#btn-ponto-text'), 'Saída para Almoço', 'a tela já reflete a batida local');
        assert.equal(client.rpcCalls('punch_time_record').length, 0);

        await page.setOnline(true);
        await page.waitFor(() => page.toasts().some((t) => /1 registro de ponto sincronizado/.test(t)));
        assert.equal(client.rpcCalls('punch_time_record').length, 1);
        assert.deepEqual(JSON.parse(page.window.localStorage.getItem(QUEUE_KEY)), []);
    });

    test('falha no envio da selfie também cai na fila offline', async () => {
        const client = colabClient();
        page = await openPage('ponto-colaborador', {
            client,
            now: `${HOJE}T08:00:00-03:00`,
            geolocation: NA_EMPRESA,
            camera: true,
            fetch: async () => new Response('{"error":"x"}', { status: 500 }),
        });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await baterPonto(page);
        assert.match(page.toasts()[0], /Falha de conexão — ponto salvo no aparelho/);
        assert.equal(JSON.parse(page.window.localStorage.getItem(QUEUE_KEY)).length, 1);
    });
});

describe('ponto-colaborador.html — gestor', () => {
    test('gestor vê e aprova a solicitação de banco de horas da equipe', async () => {
        const client = new FakeSupabase({
            user: MANAGER_USER,
            tables: baseTables({
                time_records: [],
                adjustment_requests: [],
                holidays: [],
                hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
                bank_requests: [
                    {
                        id: 'br1',
                        employee_id: ANA.id,
                        manager_id_snapshot: BIA.id,
                        status: 'pendente',
                        tipo: 'credito',
                        minutos: 90,
                        date: '2026-06-15',
                        justificativa: 'Entrega do trimestre',
                        created_at: '2026-06-15T19:00:00Z',
                        employees: { name: ANA.name, dept: ANA.dept },
                    },
                ],
            }),
            rpc: { decide_bank_request: {} },
        });
        page = await openPage('ponto-colaborador', { client, now: `${HOJE}T10:00:00-03:00` });
        assert.match(page.text('body'), /Ana Souza/);
        const approve = page.$('[data-click="approveTeamRequest"]');
        assert.ok(approve, 'botão de aprovar aparece para o gestor');
        await page.click(approve);
        await page.settle();
        const decided = client.calls.filter((c) => (c.table === 'bank_requests' && c.op === 'update') || c.rpc);
        assert.ok(decided.length, 'a aprovação chega ao banco');
    });
});
