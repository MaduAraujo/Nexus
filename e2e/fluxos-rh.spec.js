const { test, expect, login, switchUser, pickDate, iso, resetE2EData, COLAB, ADMIN } = require('./support.js');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

globalThis.window ??= globalThis;
const { CLTDomain } = require('../src/javascript/domain/clt-domain.js');

test.describe('Fluxos de RH de ponta a ponta (Supabase local real)', () => {
    test.beforeEach(resetE2EData);

    test('férias: colaborador pede, RH aprova e sai o recibo de férias com INSS, separado da folha do mês', async ({ page }) => {
        const feriados = await withServiceRole(async (db) =>
            (await db.query("SELECT to_char(date, 'YYYY-MM-DD') AS d FROM holidays WHERE abrangencia <> 'facultativo'")).rows.map((r) => r.d)
        );
        const inicio = new Date();
        inicio.setDate(inicio.getDate() + 40);
        while (CLTDomain.motivoInicioFeriasVedado(iso(inicio), { feriados })) inicio.setDate(inicio.getDate() + 1);
        const fim = new Date(inicio);
        fim.setDate(fim.getDate() + 9);

        await login(page, COLAB, 'colaborador');
        await page.goto('/src/screens/ferias-colaborador.html');
        await expect(page.locator('#val-saldo')).not.toHaveText('—');
        await page.click('#btn-solicitar');
        await pickDate(page, 'req-start', iso(inicio));
        await pickDate(page, 'req-end', iso(fim));
        await expect(page.locator('#days-count')).toHaveText('10 dias de descanso');
        await page.click('#btn-confirm');
        await expect(page.locator('.toast')).toContainText('Solicitação enviada');

        const pedido = await withServiceRole(
            async (db) => (await db.query('SELECT id, status, days FROM vacations WHERE employee_id = $1', [COLAB.employeeId])).rows
        );
        expect(pedido).toHaveLength(1);
        expect(pedido[0]).toMatchObject({ status: 'pendente', days: 10 });

        await switchUser(page, ADMIN, 'Administrador');
        await page.goto('/src/screens/ferias.html');
        await page.locator(`#requests-tbody tr[data-id="${pedido[0].id}"] [data-click="approveRequest"]`).click();
        await expect(page.locator('.toast', { hasText: 'aprovada' })).toBeVisible();

        const vac = await withServiceRole(
            async (db) => (await db.query('SELECT status, decided_by_email FROM vacations WHERE id = $1', [pedido[0].id])).rows[0]
        );
        const slip = await withUser(
            { sub: ADMIN.userId, aal: 'aal2' },
            async (db) =>
                (await db.query('SELECT mes, status, proventos, descontos FROM payslips_decrypted WHERE employee_id = $1', [COLAB.employeeId])).rows[0]
        );
        const depois = { vac, slip };
        expect(depois.vac).toMatchObject({ status: 'aprovado', decided_by_email: ADMIN.email });
        const codigos = (depois.slip?.proventos || []).map((p) => p.cod);
        expect(codigos).toEqual(expect.arrayContaining(['040', '041']));
        expect(depois.slip.mes).toBe(`${iso(inicio).slice(0, 7)}-F${iso(inicio).slice(8, 10)}`);
        expect(depois.slip.status).toBe('publicado');
        expect(depois.slip.descontos.map((d) => d.cod)).toContain('901');
    });
});

async function rostoSimulado(page) {
    await page.route('**/@vladmandic/face-api@*/**', (route) => route.abort());
    await page.addInitScript(() => {
        let quadro = 0;
        let selfies = 0;
        const base = Array.from({ length: 128 }, (_, i) => Math.sin(i * 7 + 5) * 0.1);
        const olho = (aberto) =>
            [
                [0, 0],
                [1, aberto ? -1 : -0.1],
                [2, aberto ? -1 : -0.1],
                [3, 0],
                [2, aberto ? 1 : 0.1],
                [1, aberto ? 1 : 0.1],
            ].map(([x, y]) => ({ x, y }));
        const api = {
            nets: new Proxy({}, { get: () => ({ loadFromUri: async () => {} }) }),
            TinyFaceDetectorOptions: class {},
            fetchImage: async (src) => ({ src }),
            detectSingleFace: (entrada) => ({
                withFaceLandmarks: () => ({
                    then: (ok) => {
                        if (entrada?.tagName !== 'VIDEO') return ok(null);
                        const aberto = quadro++ % 3 !== 1;
                        return ok({ landmarks: { getLeftEye: () => olho(aberto), getRightEye: () => olho(aberto) } });
                    },
                    withFaceDescriptor: async () => {
                        const d = selfies++ * 0.002;
                        return { descriptor: Float32Array.from(base, (v) => v + d) };
                    },
                }),
            }),
        };
        Object.defineProperty(window, 'faceapi', { value: api, writable: false, configurable: false });
    });
}

test.describe('Ponto (Supabase local real)', () => {
    test.use({
        geolocation: { latitude: -23.5591, longitude: -46.6606 },
        permissions: ['geolocation', 'camera'],
    });

    test.beforeEach(resetE2EData);

    test('sem biometria o ponto pede o cadastro; depois de cadastrar o rosto, a entrada é registrada e a selfie fica cifrada no Storage', async ({ page }) => {
        await rostoSimulado(page);
        await login(page, ADMIN, 'Administrador');
        await switchUser(page, COLAB, 'colaborador');
        await page.goto('/src/screens/ponto-colaborador.html');
        await expect(page.locator('#loc-status-text')).toHaveText('Dentro da empresa', { timeout: 15000 });
        await expect(page.locator('#btn-ponto-text')).toHaveText('Registrar Entrada');
        await expect(page.locator('#biometria-status-text')).toContainText('não cadastrada');

        await page.click('#btn-ponto');
        await expect(page.locator('.toast', { hasText: 'Cadastre sua biometria facial para registrar o ponto.' })).toBeVisible();
        await expect(page.locator('#modal-biometria')).toHaveClass(/open/);
        await expect(page.locator('#modal-confirmar')).not.toHaveClass(/open/);
        await page.check('#biometria-consentimento');
        await page.click('#btn-biometria-salvar');
        await expect(page.locator('.toast', { hasText: 'Biometria facial cadastrada' })).toBeVisible({ timeout: 20000 });
        await expect(page.locator('#biometria-status-text')).toContainText('cadastrada em');
        const modelos = await withServiceRole(
            async (db) => (await db.query('SELECT consent_version FROM biometric_templates WHERE employee_id = $1', [COLAB.employeeId])).rows
        );
        expect(modelos).toEqual([{ consent_version: 'biometria-ponto-v2' }]);

        await page.click('#btn-ponto');
        await expect(page.locator('#btn-selfie-shoot')).toBeEnabled({ timeout: 15000 });
        await page.click('#btn-selfie-shoot');
        await expect(page.locator('#face-verify-status')).toContainText('Identidade confirmada', { timeout: 60000 });
        await expect(page.locator('#btn-confirmar-ponto')).toBeEnabled();
        await page.click('#btn-confirmar-ponto');
        await expect(page.locator('.toast', { hasText: 'Entrada registrada!' })).toBeVisible({ timeout: 20000 });
        await expect(page.locator('#btn-ponto-text')).toHaveText('Saída para Almoço');

        const batidas = await withServiceRole(
            async (db) => (await db.query('SELECT entrada, entrada_selfie_path FROM time_records WHERE employee_id = $1', [COLAB.employeeId])).rows
        );
        expect(batidas).toHaveLength(1);
        expect(batidas[0].entrada).toBeTruthy();
        expect(batidas[0].entrada_selfie_path).toMatch(new RegExp(`^${COLAB.employeeId}/`));
        const selfie = await withServiceRole(
            async (db) =>
                (
                    await db.query(`SELECT metadata->>'mimetype' AS mime FROM storage.objects WHERE bucket_id = 'ponto-selfies' AND name = $1`, [
                        batidas[0].entrada_selfie_path,
                    ])
                ).rows
        );
        expect(selfie).toEqual([{ mime: 'application/octet-stream' }]);
    });
});
