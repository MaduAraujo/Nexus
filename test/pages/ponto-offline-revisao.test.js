const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NA_EMPRESA = { lat: -23.5591, lng: -46.6606 };
const HOJE = '2026-06-17';
const QUEUE_KEY = `nexus_ponto_offline_${ANA.id}`;

function client(punch) {
    const c = new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({
            time_records: [],
            adjustment_requests: [],
            bank_requests: [],
            holidays: [],
            hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
            activity_logs: [],
        }),
        rpc: { report_daily_overtime_alert: {}, biometric_status: { enrolled: false } },
    });
    c.handlers.rpc.punch_time_record = (args) => {
        const r = punch?.(args);
        if (r) return r;
        const rec = { id: `tr-${args.p_date}`, employee_id: ANA.id, date: args.p_date, [args.p_step]: args.p_marcado_em || `${args.p_date}T09:00:00-03:00` };
        return [rec];
    };
    return c;
}

const filesOk = async () => new Response('{}', { status: 200 });

async function baterPonto(p) {
    await p.click('#btn-ponto');
    await p.click('#btn-selfie-shoot');
    await p.waitFor(() => !p.$('#btn-confirmar-ponto').disabled, { message: 'selfie verificada' });
    await p.click('#btn-confirmar-ponto');
    await p.waitFor(() => p.toasts().length);
}

const fila = () => JSON.parse(page.window.localStorage.getItem(QUEUE_KEY) || '[]');

describe('ponto — horário da batida offline', () => {
    test('a batida offline guarda o horário do aparelho e o envia ao sincronizar', async () => {
        const c = client();
        page = await openPage('ponto-colaborador', {
            client: c,
            now: `${HOJE}T08:00:00-03:00`,
            geolocation: NA_EMPRESA,
            camera: true,
            fetch: filesOk,
            online: false,
        });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await baterPonto(page);
        const [guardada] = fila();
        assert.equal(guardada.offline, true);
        await page.setOnline(true);
        await page.waitFor(() => c.rpcCalls('punch_time_record').length === 1);
        assert.equal(c.rpcCalls('punch_time_record')[0].args.p_marcado_em, guardada.timestamp);
    });

    test('a batida online deixa o servidor marcar a hora', async () => {
        const c = client();
        page = await openPage('ponto-colaborador', { client: c, now: `${HOJE}T08:00:00-03:00`, geolocation: NA_EMPRESA, camera: true, fetch: filesOk });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await baterPonto(page);
        assert.equal(c.rpcCalls('punch_time_record')[0].args.p_marcado_em, null);
    });
});

describe('ponto — a fila offline não trava', () => {
    test('recusa definitiva tira a batida da fila, avisa e segue com as próximas', async () => {
        const c = client((args) =>
            args.p_step === 'entrada' ? { error: { code: '22007', message: 'O horário do registro offline não pertence ao dia 10/06/2026.' } } : null
        );
        page = await openPage('ponto-colaborador', {
            client: c,
            now: `${HOJE}T08:00:00-03:00`,
            online: false,
            localStorage: {
                [QUEUE_KEY]: [
                    { step: 'entrada', date: '2026-06-10', timestamp: '2026-06-10T08:00:00-03:00', offline: true, loc: null, selfie: null },
                    { step: 'saida_almoco', date: HOJE, timestamp: `${HOJE}T07:59:00-03:00`, offline: true, loc: null, selfie: null },
                ],
            },
        });
        await page.setOnline(true);
        await page.waitFor(() =>
            page
                .toasts()
                .some((t) =>
                    /1 registro offline não pôde ser enviado: O horário do registro offline não pertence ao dia 10\/06\/2026\. Peça um ajuste de ponto ao RH\./.test(
                        t
                    )
                )
        );
        assert.ok(page.toasts().some((t) => /1 registro de ponto sincronizado/.test(t)));
        assert.deepEqual(fila(), []);
        assert.equal(c.rpcCalls('punch_time_record').length, 2);
    });

    test('várias recusas usam o plural; falha de rede mantém a batida na fila', async () => {
        let rede = true;
        const c = client(() =>
            rede ? { error: { message: 'Failed to fetch' } } : { error: { code: '42501', message: 'Verificação facial ausente ou expirada.' } }
        );
        const itens = ['entrada', 'saida_almoco'].map((step) => ({
            step,
            date: HOJE,
            timestamp: `${HOJE}T07:00:00-03:00`,
            offline: true,
            loc: null,
            selfie: null,
        }));
        page = await openPage('ponto-colaborador', { client: c, now: `${HOJE}T08:00:00-03:00`, online: false, localStorage: { [QUEUE_KEY]: itens } });
        await page.setOnline(true);
        await page.settle(20);
        assert.equal(fila().length, 2, 'sem resposta do banco, nada sai da fila');
        rede = false;
        await page.eval('flushOfflineQueue()');
        await page.waitFor(() => page.toasts().some((t) => /2 registros offline não puderam ser enviados/.test(t)));
        assert.deepEqual(fila(), []);
    });

    test('batida que já estava registrada sai da fila sem erro', async () => {
        const c = client(() => ({ error: { code: '23505', message: 'Esta marcação (entrada) já foi registrada às 08:00.' } }));
        page = await openPage('ponto-colaborador', {
            client: c,
            now: `${HOJE}T08:00:00-03:00`,
            online: false,
            localStorage: { [QUEUE_KEY]: [{ step: 'entrada', date: HOJE, timestamp: `${HOJE}T07:58:00-03:00`, offline: true, loc: null, selfie: null }] },
        });
        await page.setOnline(true);
        await page.waitFor(() => fila().length === 0);
        assert.equal(
            page.toasts().some((t) => /não pôde|sincronizado/.test(t)),
            false
        );
    });

    test('duas sincronizações ao mesmo tempo não enviam a mesma batida duas vezes', async () => {
        const c = client();
        page = await openPage('ponto-colaborador', {
            client: c,
            now: `${HOJE}T08:00:00-03:00`,
            online: false,
            localStorage: { [QUEUE_KEY]: [{ step: 'entrada', date: HOJE, timestamp: `${HOJE}T07:58:00-03:00`, offline: true, loc: null, selfie: null }] },
        });
        Object.defineProperty(page.window.navigator, 'onLine', { get: () => true, configurable: true });
        await page.eval('Promise.all([flushOfflineQueue(), flushOfflineQueue()])');
        assert.equal(c.rpcCalls('punch_time_record').length, 1);
    });
});

describe('ponto — respostas do banco na batida online', () => {
    test('marcação repetida avisa sem erro; recusa definitiva mostra o motivo e não vai para a fila', async () => {
        const c = client(() => ({ error: { code: '23505', message: 'já foi registrada' } }));
        page = await openPage('ponto-colaborador', { client: c, now: `${HOJE}T08:00:00-03:00`, geolocation: NA_EMPRESA, camera: true, fetch: filesOk });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await baterPonto(page);
        assert.ok(page.toasts().some((t) => /Essa marcação já estava registrada/.test(t)));
        page.close();

        const c2 = client(() => ({ error: { code: '42501', message: 'Verificação facial ausente ou expirada. Tire a selfie novamente.' } }));
        page = await openPage('ponto-colaborador', { client: c2, now: `${HOJE}T08:00:00-03:00`, geolocation: NA_EMPRESA, camera: true, fetch: filesOk });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await baterPonto(page);
        assert.ok(page.toasts().some((t) => /Verificação facial ausente ou expirada/.test(t)));
        assert.deepEqual(fila(), []);
    });
});
