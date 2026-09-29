const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const HOJE = '2026-06-17';
const NOW = `${HOJE}T10:00:00-03:00`;
const QUEUE_KEY = `nexus_ponto_offline_${ANA.id}`;
const filesOk = async () => new Response('{}', { status: 200 });
const SELFIE = 'data:image/jpeg;base64,AAAA';

function colabClient({ extra = {}, rpc = {}, errors = {} } = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({
            time_records: [],
            adjustment_requests: [],
            bank_requests: [],
            holidays: [],
            hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
            activity_logs: [],
            documents: [],
            burnout_alerts: [],
            ...extra,
        }),
        rpc: { report_daily_overtime_alert: {}, biometric_status: { enrolled: false }, ...rpc },
        defaults: { adjustment_requests: { status: 'pendente' }, bank_requests: { status: 'pendente' } },
        errors,
    });
}

const olho = (aberto) =>
    [
        [0, 0],
        [1, aberto ? -1 : -0.1],
        [2, aberto ? -1 : -0.1],
        [3, 0],
        [2, aberto ? 1 : 0.1],
        [1, aberto ? 1 : 0.1],
    ].map(([x, y]) => ({ x, y }));

function faceApi({ descritor = 0.1, sequencia = [true, false, true], ms = 600 } = {}) {
    return (w) => {
        if (ms) w.NEXUS_PROVA_DE_VIDA_MS = ms;
        let i = 0;
        w.faceapi = {
            nets: new Proxy({}, { get: () => ({ loadFromUri: async () => {} }) }),
            TinyFaceDetectorOptions: class {},
            fetchImage: async (src) => ({ src }),
            detectSingleFace: (entrada) => ({
                withFaceLandmarks: () => ({
                    then: (ok) => {
                        if (entrada?.tagName !== 'VIDEO') return ok(null);
                        const aberto = sequencia[Math.min(i++, sequencia.length - 1)];
                        return ok({ landmarks: { getLeftEye: () => olho(aberto), getRightEye: () => olho(aberto) } });
                    },
                    withFaceDescriptor: async () => (descritor === null ? null : { descriptor: Float32Array.from({ length: 128 }, () => descritor) }),
                }),
            }),
        };
    };
}

const fila = (n) =>
    Array.from({ length: n }, (_, i) => ({
        step: 'entrada',
        date: `2026-06-1${i}`,
        timestamp: `2026-06-1${i}T11:00:00.000Z`,
        loc: { lat: -23.5591, lng: -46.6606 },
        selfie: SELFIE,
        biometricToken: null,
    }));

async function sincronizar({ rpc, entradas = 2, descritor = 0.1 }) {
    const c = colabClient({ rpc: { biometric_status: { enrolled: true, consent_at: '2026-06-01T10:00:00Z' }, ...rpc } });
    page = await openPage('ponto-colaborador', {
        client: c,
        now: NOW,
        online: false,
        fetch: filesOk,
        localStorage: { [QUEUE_KEY]: fila(entradas) },
        before: faceApi({ descritor }),
    });
    await page.setOnline(true);
    await page.settle(40);
    return c;
}

describe('ponto-colaborador.html — biometria e fila offline (bordas)', () => {
    test('duas batidas offline com rosto que não confere: aviso no plural e fila esvaziada', async () => {
        await sincronizar({ rpc: { biometric_verify: { enrolled: true, matched: false } } });
        await page.waitFor(() => page.toasts().some((t) => /2 registros offline recusados/.test(t)));
        assert.deepEqual(JSON.parse(page.window.localStorage.getItem(QUEUE_KEY)), []);
    });

    test('verificação fora do ar interrompe a fila e mantém as batidas', async () => {
        const c = await sincronizar({ rpc: { biometric_verify: { error: { message: 'fora' } } } });
        assert.equal(c.rpcCalls('biometric_verify').length, 1);
        assert.equal(JSON.parse(page.window.localStorage.getItem(QUEUE_KEY)).length, 2);
    });

    test('selfie sem rosto na fila é recusada', async () => {
        await sincronizar({ rpc: {}, entradas: 1, descritor: null });
        await page.waitFor(() => page.toasts().some((t) => /1 registro offline recusado/.test(t)));
    });

    test('rosto confirmado sem código de verificação: a batida vai sem token', async () => {
        const c = await sincronizar({
            rpc: {
                biometric_verify: { enrolled: true, matched: true },
                punch_time_record: (a) => [{ employee_id: ANA.id, date: a.p_date, entrada: `${a.p_date}T08:00:00-03:00` }],
            },
            entradas: 1,
        });
        await page.waitFor(() => c.rpcCalls('punch_time_record').length === 1);
        assert.equal(c.rpcCalls('punch_time_record')[0].args.p_biometric_token, null);
    });

    test('falha ao gravar a batida mantém na fila', async () => {
        const c = colabClient({ errors: { 'rpc:punch_time_record': { message: 'x' } } });
        page = await openPage('ponto-colaborador', {
            client: c,
            now: NOW,
            online: false,
            fetch: filesOk,
            localStorage: { [QUEUE_KEY]: fila(1) },
            before: faceApi(),
        });
        await page.setOnline(true);
        await page.settle(40);
        assert.equal(JSON.parse(page.window.localStorage.getItem(QUEUE_KEY)).length, 1);
    });

    test('situação da biometria que não carrega é consultada de novo ao enviar', async () => {
        let chamadas = 0;
        const c = colabClient({
            rpc: {
                biometric_status: () => (++chamadas === 1 ? { error: { message: 'x' } } : { enrolled: false }),
                punch_time_record: (a) => [{ employee_id: ANA.id, date: a.p_date, entrada: `${a.p_date}T08:00:00-03:00` }],
            },
        });
        page = await openPage('ponto-colaborador', {
            client: c,
            now: NOW,
            online: false,
            fetch: filesOk,
            localStorage: { [QUEUE_KEY]: fila(1) },
            before: faceApi(),
        });
        await page.setOnline(true);
        await page.waitFor(() => c.rpcCalls('punch_time_record').length === 1);
        assert.ok(chamadas >= 2);
    });

    test('tirar selfie sem imagem da câmera não faz nada', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW });
        await page.eval('capturarSelfie()');
        assert.equal(page.visible('#selfie-preview'), false);
    });

    test('cadastro: sem consentimento não captura; sem piscar não cadastra; erro sem mensagem usa o texto padrão; revogar pode ser cancelado', async () => {
        const c = colabClient({ rpc: { biometric_enroll: { error: {} }, biometric_status: { enrolled: true, consent_at: '2026-06-01T10:00:00Z' } } });
        page = await openPage('ponto-colaborador', { client: c, now: NOW, camera: true, confirm: false, before: faceApi({ ms: null }) });
        await page.click('#btn-biometria-cadastrar');
        await page.waitFor(() => page.$('#bio-video').srcObject);
        await page.eval('salvarBiometria()');
        assert.equal(c.rpcCalls('biometric_enroll').length, 0);
        await page.check('#biometria-consentimento');
        await page.click('#btn-biometria-salvar');
        await page.waitFor(() => /Não foi possível cadastrar a biometria/.test(page.text('#biometria-hint')), { timeout: 8000 });
        await page.eval('revogarBiometria()');
        assert.equal(c.rpcCalls('biometric_revoke').length, 0);
    });

    test('cadastro sem piscada não envia nada', async () => {
        const c = colabClient({ rpc: { biometric_enroll: {} } });
        page = await openPage('ponto-colaborador', { client: c, now: NOW, camera: true, before: faceApi({ sequencia: [true] }) });
        await page.click('#btn-biometria-cadastrar');
        await page.waitFor(() => page.$('#bio-video').srcObject);
        await page.check('#biometria-consentimento');
        await page.click('#btn-biometria-salvar');
        await page.waitFor(() => /Não detectamos a piscada/.test(page.text('#biometria-hint')));
        assert.equal(c.rpcCalls('biometric_enroll').length, 0);
    });

    test('relógio: tocar no quadrante superior esquerdo escolhe um horário da tarde/noite', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW });
        const dial = page.$('#clock-dial');
        dial.setPointerCapture = () => {};
        const ev = new page.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: -40, clientY: -40 });
        dial.dispatchEvent(ev);
        dial.dispatchEvent(new page.window.MouseEvent('pointerup', { bubbles: true }));
        assert.ok(page.$('#clockmodal-hour-btn').textContent.trim().length > 0);
    });

    test('sem a biblioteca de mapas a tela funciona sem o mapa', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient(),
            now: NOW,
            geolocation: { lat: -23.5591, lng: -46.6606 },
            before(w) {
                delete w.L;
            },
        });
        await page.settle(20);
        assert.equal(page.pageErrors.length, 0);
    });

    test('tempo real de ajustes que falha ao recarregar deixa a lista vazia', async () => {
        const c = colabClient({
            extra: {
                adjustment_requests: [
                    { id: 'a1', employee_id: ANA.id, tipo: 'entrada', status: 'pendente', date: '2026-06-10', created_at: '2026-06-10T10:00:00Z' },
                ],
            },
        });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        assert.equal(page.visible('#section-solicitacoes'), true);
        c.errors['adjustment_requests:select'] = { message: 'x' };
        c.emit('adjustment_requests', { eventType: 'UPDATE', new: {} });
        await page.settle();
        assert.equal(page.visible('#section-solicitacoes'), false);
    });

    test('intervalo curto em cinco dias deixa o cartão CLT crítico', async () => {
        const curto = (date) => ({
            id: `tr-${date}`,
            employee_id: ANA.id,
            date,
            entrada: `${date}T08:00:00-03:00`,
            saida_almoco: `${date}T12:00:00-03:00`,
            retorno_almoco: `${date}T12:20:00-03:00`,
            saida: `${date}T17:00:00-03:00`,
        });
        page = await openPage('ponto-colaborador', {
            client: colabClient({ extra: { time_records: ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'].map(curto) } }),
            now: NOW,
        });
        assert.ok(/critico/.test(page.$('#section-clt').innerHTML));
    });
});
