const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const rhClient = (tables = {}, opts = {}) =>
    new FakeSupabase({ user: RH_USER, tables: baseTables({ security_alerts: [], security_rules: [], ...tables }), ...opts });

async function abrirComChaves(client) {
    page = await openPage('seguranca', { client });
    await page.eval(`NexusE2E.afterLogin({ password: 'senha-forte', isAdmin: true })`);
}

async function protegerArquivos() {
    await page.eval('renderEndToEnd()');
    const btn = await page.waitFor(() => page.$$('#e2e-card button').find((b) => /Proteger arquivos antigos/.test(b.textContent)));
    await page.click(btn);
    await page.waitFor(() => /Concluído|Nenhum arquivo/.test(page.text('#e2e-card')));
}

describe('seguranca.html — bordas', () => {
    test('alerta de regra e gravidade desconhecidas aparece pelo nome cru; um só não lido usa o singular', async () => {
        page = await openPage('seguranca', {
            client: rhClient({
                security_alerts: [
                    { id: 'a1', kind: 'regra_nova', severity: 'extrema', title: 'T', message: 'M', lido: false, created_at: '2026-01-10T10:00:00Z' },
                ],
            }),
        });
        assert.ok(page.$('#sec-alerts .sec-alert-icon').classList.contains('fa-shield-alt'));
        assert.equal(page.text('#sec-alerts .sec-sev'), 'extrema');
        assert.match(page.text('#sec-alerts .sec-alert-when'), /^regra_nova · /);
        assert.equal(page.text('#sec-mark-read'), 'Marcar 1 como lida');
    });

    test('sem nada para proteger avisa; falha ao listar as tabelas não quebra', async () => {
        await abrirComChaves(
            rhClient(
                {},
                { errors: { 'documents:select': { message: 'x' }, 'medical_leaves:select': { message: 'y' }, 'time_records:select': { message: 'z' } } }
            )
        );
        await protegerArquivos();
        assert.match(page.text('#e2e-card'), /Nenhum arquivo para proteger/);
    });

    test('selfies do ponto entram na lista; resultado desconhecido aparece cru e falha inesperada conta como falha', async () => {
        await abrirComChaves(
            rhClient({
                documents: [{ employee_id: ANA.id, storage_path: 'ana/rg.pdf' }],
                medical_leaves: [{ employee_id: ANA.id, storage_path: 'ana/atestado.pdf' }],
                time_records: [
                    {
                        employee_id: ANA.id,
                        entrada_selfie_path: 'ana/e.jpg',
                        saida_almoco_selfie_path: null,
                        retorno_almoco_selfie_path: null,
                        saida_selfie_path: null,
                    },
                ],
            })
        );
        await page.eval(`
            window.__vistos = [];
            NexusFiles.migrateToEndToEnd = async (bucket, path) => {
                window.__vistos.push(bucket + ':' + path);
                if (path === 'ana/rg.pdf') return 'estranho';
                if (path === 'ana/atestado.pdf') return 'unsupported';
                throw new Error('boom');
            };
        `);
        await protegerArquivos();
        assert.deepEqual([...page.window.__vistos], ['documents:ana/rg.pdf', 'documents:ana/atestado.pdf', 'ponto-selfies:ana/e.jpg']);
        assert.match(page.text('#e2e-card'), /1 estranho · 1 não puderam ser protegidos neste navegador · 1 falharam/);
    });

    test('administradores pendentes que recebem a chave do RH são informados', async () => {
        await abrirComChaves(rhClient());
        await page.eval('NexusE2E.grantPendingAdmins = async () => 2');
        await page.eval('renderEndToEnd()');
        await page.waitFor(() => /2 administrador\(es\) receberam acesso/.test(page.text('#e2e-card')));
    });

    test('chaves bloqueadas neste navegador oferecem o botão de desbloquear', async () => {
        await abrirComChaves(rhClient());
        await page.eval('NexusE2E.ensureUnlocked = async () => null');
        await page.eval('renderEndToEnd()');
        await page.waitFor(() => /bloqueadas neste navegador/.test(page.text('#e2e-card')));
        assert.equal(page.text('#e2e-card button'), 'Desbloquear');
    });
});
