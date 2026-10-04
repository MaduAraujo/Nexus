const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NA_EMPRESA = { lat: -23.5591, lng: -46.6606 };
const HOJE = '2026-06-17';

function punchRpc({ p_date, p_step, p_loc }, client) {
    const rows = client.tables.time_records;
    let rec = rows.find((r) => r.employee_id === ANA.id && r.date === p_date);
    if (!rec) rows.push((rec = { id: `tr-${p_date}`, employee_id: ANA.id, date: p_date }));
    rec[p_step] = client.now();
    rec[`${p_step}_loc`] = p_loc;
    return [rec];
}

function aprendizClient({ records = [], now, contract_type = 'Aprendiz' } = {}) {
    const tables = baseTables({
        time_records: records,
        adjustment_requests: [],
        bank_requests: [],
        holidays: [],
        hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
        activity_logs: [],
    });
    for (const nome of ['employees', 'employees_decrypted'])
        Object.assign(
            tables[nome].find((e) => e.id === ANA.id),
            { contract_type, work_load: '30h', salary: 1200 }
        );
    return new FakeSupabase({
        user: COLAB_USER,
        now: now ? () => new Date(now).toISOString() : undefined,
        tables,
        rpc: { punch_time_record: punchRpc, report_daily_overtime_alert: {}, biometric_status: { enrolled: false } },
    });
}

const filesOk = async () => new Response('{}', { status: 200 });

const manha = {
    id: 'tr-hoje',
    employee_id: ANA.id,
    date: HOJE,
    entrada: `${HOJE}T08:00:00-03:00`,
    saida_almoco: `${HOJE}T12:00:00-03:00`,
    retorno_almoco: `${HOJE}T13:00:00-03:00`,
};

describe('ponto-colaborador.html — aprendiz (CLT art. 432)', () => {
    test('vê o aviso de que não faz hora extra e não tem botão de banco de horas', async () => {
        page = await openPage('ponto-colaborador', { client: aprendizClient(), now: `${HOJE}T08:00:00-03:00`, geolocation: NA_EMPRESA });
        assert.equal(page.visible('#ponto-aprendiz-aviso'), true);
        assert.match(page.text('#ponto-aprendiz-aviso'), /não pode fazer hora extra nem compensar horas/);
        assert.equal(page.$('#btn-bank-request').classList.contains('hidden'), true);
    });

    test('CLT comum não vê o aviso do aprendiz', async () => {
        page = await openPage('ponto-colaborador', {
            client: aprendizClient({ contract_type: 'clt' }),
            now: `${HOJE}T08:00:00-03:00`,
            geolocation: NA_EMPRESA,
        });
        assert.equal(page.$('#ponto-aprendiz-aviso').classList.contains('hidden'), true);
        assert.equal(page.$('#btn-bank-request').classList.contains('hidden'), false);
    });

    test('saída 30 min depois da jornada pede motivo e avisa o RH como hora extra proibida', async () => {
        const now = `${HOJE}T15:30:00-03:00`;
        const client = aprendizClient({ records: [{ ...manha }], now });
        page = await openPage('ponto-colaborador', { client, now, geolocation: NA_EMPRESA, camera: true, fetch: filesOk });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await page.click('#btn-ponto');
        assert.equal(page.visible('#excesso-legal-bloco'), true);
        assert.match(page.text('#excesso-legal-msg'), /passaria 0h 30min da sua jornada hoje\. Aprendiz não pode fazer hora extra/);
        await page.click('#btn-selfie-shoot');
        await page.settle();
        await page.fill('#excesso-legal-just', 'Reunião atrasou');
        await page.click('#btn-confirmar-ponto');
        await page.waitFor(() => page.toasts().length);
        const [alerta] = client.rpcCalls('report_daily_overtime_alert');
        assert.match(alerta.args.p_titulo, /Aprendiz passou da jornada \(0h 30min\)/);
        assert.match(alerta.args.p_mensagem, /\(aprendiz\).*CLT art\. 432.*Justificativa: "Reunião atrasou"/);
    });

    test('dentro da tolerância de 10 minutos não pede motivo', async () => {
        const now = `${HOJE}T14:08:00-03:00`;
        page = await openPage('ponto-colaborador', {
            client: aprendizClient({ records: [{ ...manha, entrada: `${HOJE}T07:00:00-03:00` }], now }),
            now,
            geolocation: NA_EMPRESA,
            camera: true,
            fetch: filesOk,
        });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await page.click('#btn-ponto');
        assert.equal(page.visible('#excesso-legal-bloco'), false);
    });
});
