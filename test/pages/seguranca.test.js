const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, ANA, baseTables, AAL1_NO_MFA } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const ALERTS = [
    { id: 'a1', kind: 'login_failures', severity: 'critical', title: 'Logins falhos', message: '5 falhas', lido: false, created_at: new Date().toISOString() },
    { id: 'a2', kind: 'mass_export', severity: 'warning', title: 'Exportação', message: '3 exportações', lido: true, created_at: '2026-01-10T10:00:00Z' },
    { id: 'a3', kind: 'off_hours_access', severity: 'info', title: 'Fora do horário', message: 'acesso 23h', lido: false, created_at: '2026-01-09T10:00:00Z' },
];
const RULES = [
    { kind: 'login_failures', enabled: true, threshold: 5, window_minutes: 15, params: {} },
    { kind: 'off_hours_access', enabled: false, threshold: 1, window_minutes: 60, params: { start_hour: 7, end_hour: 19, profiles: ['Administrador'] } },
];

function rhClient(extra = {}, opts = {}) {
    return new FakeSupabase({ user: RH_USER, tables: baseTables({ security_alerts: ALERTS, security_rules: RULES, ...extra }), ...opts });
}

describe('seguranca.html — acesso', () => {
    test('colaborador é mandado de volta para o login', async () => {
        page = await openPage('seguranca', { client: new FakeSupabase({ user: COLAB_USER, tables: baseTables() }) });
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/login.html']);
        assert.equal(page.text('#sec-alerts'), '');
    });

    test('sem sessão, vai para o login', async () => {
        page = await openPage('seguranca', { client: new FakeSupabase({ tables: baseTables() }) });
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/login.html']);
    });

    test('RH sem MFA pode abrir a tela (é onde ativa) e vê o aviso de obrigatoriedade', async () => {
        page = await openPage('seguranca', { client: rhClient({}, { mfa: AAL1_NO_MFA }) });
        assert.deepEqual(page.navigations, []);
        assert.match(page.text('#mfa-card'), /obrigatória/);
    });
});

describe('seguranca.html — alertas e regras', () => {
    test('lista alertas, marca os não lidos e descreve as regras', async () => {
        page = await openPage('seguranca', { client: rhClient() });
        const items = page.$$('#sec-alerts .sec-alert');
        assert.equal(items.length, 3);
        assert.ok(items[0].classList.contains('sev-critical'));
        assert.ok(items[1].classList.contains('is-read'));
        assert.match(items[0].textContent, /agora há pouco/);
        assert.match(page.text('#sec-rules'), /5 falhas em 15 min na mesma conta/);
        assert.match(page.text('#sec-rules'), /fora de 7h–19h, dias úteis \(Administrador\)/);
        assert.match(page.text('#sec-rules'), /Desligada/);
        assert.equal(page.$('#sec-mark-read').hidden, false);
        assert.equal(page.text('#sec-mark-read'), 'Marcar 2 como lidas');
    });

    test('"marcar como lidas" manda só os ids não lidos e recarrega a lista', async () => {
        const client = rhClient();
        client.handlers.rpc.mark_security_alerts_read = ({ p_ids }, c) => {
            c.tables.security_alerts.forEach((a) => p_ids.includes(a.id) && (a.lido = true));
            return {};
        };
        page = await openPage('seguranca', { client });
        await page.click('#sec-mark-read');
        assert.deepEqual(client.rpcCalls('mark_security_alerts_read')[0].args, { p_ids: ['a1', 'a3'] });
        assert.equal(page.$('#sec-mark-read').hidden, true);
        assert.equal(page.$$('#sec-alerts .is-read').length, 3);
    });

    test('sem alertas mostra estado vazio e esconde o botão', async () => {
        page = await openPage('seguranca', { client: rhClient({ security_alerts: [] }) });
        assert.match(page.text('#sec-alerts'), /Nenhum comportamento anormal/);
        assert.equal(page.$('#sec-mark-read').hidden, true);
    });

    test('erro ao carregar alertas vira mensagem na tela (e toast de erro)', async () => {
        page = await openPage('seguranca', { client: rhClient({}, { errors: { 'security_alerts:select': { message: 'permission denied' } } }) });
        assert.match(page.text('#sec-alerts'), /Não foi possível carregar os alertas/);
        assert.ok(page.toasts().some((t) => /permission denied/.test(t)));
    });
});

describe('seguranca.html — ponta a ponta', () => {
    test('sem chaves criadas, orienta a sair e entrar de novo', async () => {
        page = await openPage('seguranca', { client: rhClient() });
        assert.match(page.text('#e2e-card'), /ainda não foram criadas/);
    });

    test('com chaves e chave do RH, protege arquivos antigos e resume o resultado', async () => {
        const client = rhClient({
            documents: [{ employee_id: ANA.id, storage_path: 'ana/rg.pdf' }],
            medical_leaves: [],
            time_records: [
                { employee_id: ANA.id, entrada_selfie_path: null, saida_almoco_selfie_path: null, retorno_almoco_selfie_path: null, saida_selfie_path: null },
            ],
        });
        page = await openPage('seguranca', { client });
        const created = await page.eval(`NexusE2E.afterLogin({ password: 'senha-forte', isAdmin: true })`);
        assert.equal(created.status, 'created');
        await page.eval('renderEndToEnd()');
        const btn = await page.waitFor(() => page.$$('#e2e-card button').find((b) => /Proteger arquivos antigos/.test(b.textContent)));
        await page.click(btn);
        await page.waitFor(() => /Concluído/.test(page.text('#e2e-card')));
        assert.match(page.text('#e2e-card'), /1 aguardam o primeiro acesso do colaborador/);
    });

    test('conta sem a chave do RH é orientada a pedir a outro administrador', async () => {
        const client = rhClient({ e2e_org_keys: [{ id: 'rh', public_key: {}, fingerprint: 'outra' }] });
        page = await openPage('seguranca', { client });
        await page.eval(`NexusE2E.afterLogin({ password: 'senha-forte', isAdmin: true })`);
        await page.eval('renderEndToEnd()');
        await page.waitFor(() => /ainda não recebeu a chave do RH/.test(page.text('#e2e-card')));
    });
});
