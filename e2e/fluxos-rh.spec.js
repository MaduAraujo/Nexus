const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY } = require('../test-support/e2e-supabase-config.js');
const { E2E_USERS } = require('../test-support/e2e-seed.js');
const { submitAdminMfa } = require('../test-support/e2e-mfa.js');
const { waitForDashboard } = require('../test-support/e2e-dashboard.js');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const ORIGINAL_CLIENT_PATH = path.join(__dirname, '..', 'src', 'javascript', 'shared', 'supabase-client.js');
const COLAB = E2E_USERS.colaborador;
const ADMIN = E2E_USERS.administrador;

async function useLocalSupabase(page) {
    const original = fs.readFileSync(ORIGINAL_CLIENT_PATH, 'utf8');
    const patched = original.replace(
        /const SUPABASE_URL = '.*?';\s*\nconst SUPABASE_ANON_KEY = '.*?';/,
        `const SUPABASE_URL = '${LOCAL_SUPABASE_URL}';\nconst SUPABASE_ANON_KEY = '${LOCAL_SUPABASE_ANON_KEY}';`
    );
    await page.route('**/shared/supabase-client.js', (route) => route.fulfill({ contentType: 'text/javascript', body: patched }));
}

async function login(page, user, profileType) {
    await page.goto('/src/screens/login.html');
    await page.click(profileType === 'Administrador' ? '.profile-card.rh' : '.profile-card.colaborador');
    await page.click('#btn-continue');
    await page.fill('#login-user', user.email);
    await page.fill('#login-pass', user.password);
    await page.click('#btn-login');
    if (profileType === 'Administrador') await submitAdminMfa(page);
    await waitForDashboard(page, profileType === 'Administrador' ? '**/inicio-rh.html' : '**/inicio-colaborador.html');
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function pickDate(page, prefix, date) {
    await page.click(`#${prefix}-trigger`);
    const btn = page.locator(`#${prefix}-grid button[data-date="${date}"]`);
    for (let i = 0; i < 6 && !(await btn.count()); i++) await page.click(`#${prefix}-next`);
    await btn.click();
}

async function limparDadosDoColaborador() {
    await withServiceRole(async (db) => {
        await db.query('DELETE FROM vacations WHERE employee_id = $1', [COLAB.employeeId]);
        await db.query('DELETE FROM payslips WHERE employee_id = $1', [COLAB.employeeId]);
        await db.query('DELETE FROM time_records WHERE employee_id = $1', [COLAB.employeeId]);
    });
}

test.describe('Fluxos de RH de ponta a ponta (Supabase local real)', () => {
    test.beforeEach(async ({ page }) => {
        await limparDadosDoColaborador();
        await useLocalSupabase(page);
    });

    test('férias: colaborador pede, RH aprova e o adiantamento entra na folha', async ({ page }) => {
        const inicio = new Date();
        inicio.setDate(inicio.getDate() + 40);
        const fim = new Date(inicio);
        fim.setDate(fim.getDate() + 9);

        await login(page, COLAB, 'colaborador');
        await page.goto('/src/screens/ferias-colaborador.html');
        await expect(page.locator('#val-saldo')).not.toHaveText('—');
        await page.click('#btn-solicitar');
        await pickDate(page, 'req-start', iso(inicio));
        await pickDate(page, 'req-end', iso(fim));
        await expect(page.locator('#days-count')).toHaveText('10 dias selecionados');
        await page.click('#btn-confirm');
        await expect(page.locator('.toast')).toContainText('Solicitação enviada');

        const pedido = await withServiceRole(
            async (db) => (await db.query('SELECT id, status, days FROM vacations WHERE employee_id = $1', [COLAB.employeeId])).rows
        );
        expect(pedido).toHaveLength(1);
        expect(pedido[0]).toMatchObject({ status: 'pendente', days: 10 });

        await page.context().clearCookies();
        await page.evaluate(() => localStorage.clear());
        await login(page, ADMIN, 'Administrador');
        await page.goto('/src/screens/ferias.html');
        page.on('dialog', (d) => d.accept());
        await page.locator(`#requests-tbody tr[data-id="${pedido[0].id}"] [data-click="approveRequest"]`).click();
        await expect(page.locator('.toast').last()).toContainText('aprovada');

        const vac = await withServiceRole(
            async (db) => (await db.query('SELECT status, decided_by_email FROM vacations WHERE id = $1', [pedido[0].id])).rows[0]
        );
        const slip = await withUser(
            { sub: ADMIN.userId, aal: 'aal2' },
            async (db) => (await db.query('SELECT proventos FROM payslips_decrypted WHERE employee_id = $1', [COLAB.employeeId])).rows[0]
        );
        const depois = { vac, slip };
        expect(depois.vac).toMatchObject({ status: 'aprovado', decided_by_email: ADMIN.email });
        const codigos = (depois.slip?.proventos || []).map((p) => p.cod);
        expect(codigos).toEqual(expect.arrayContaining(['040', '041']));
    });
});

test.describe('Ponto (Supabase local real)', () => {
    test.use({
        geolocation: { latitude: -23.5591, longitude: -46.6606 },
        permissions: ['geolocation', 'camera'],
    });

    test.beforeEach(async ({ page }) => {
        await limparDadosDoColaborador();
        await useLocalSupabase(page);
        await page.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"ok"}' }));
        await page.route('**/functions/v1/nexus-files', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: '{}' }));
    });

    test('colaborador na empresa tira a selfie e registra a entrada', async ({ page }) => {
        await login(page, COLAB, 'colaborador');
        await page.goto('/src/screens/ponto-colaborador.html');
        await expect(page.locator('#loc-status-text')).toHaveText('Dentro da empresa', { timeout: 15000 });
        await expect(page.locator('#btn-ponto-text')).toHaveText('Registrar Entrada');

        await page.click('#btn-ponto');
        await expect(page.locator('#btn-selfie-shoot')).toBeEnabled({ timeout: 15000 });
        await page.click('#btn-selfie-shoot');
        await expect(page.locator('#btn-confirmar-ponto')).toBeEnabled({ timeout: 60000 });
        await page.click('#btn-confirmar-ponto');
        await expect(page.locator('.toast').last()).toContainText('Entrada registrada!');
        await expect(page.locator('#btn-ponto-text')).toHaveText('Saída para Almoço');

        const batidas = await withServiceRole(
            async (db) => (await db.query('SELECT entrada, entrada_selfie_path FROM time_records WHERE employee_id = $1', [COLAB.employeeId])).rows
        );
        expect(batidas).toHaveLength(1);
        expect(batidas[0].entrada).toBeTruthy();
        expect(batidas[0].entrada_selfie_path).toMatch(new RegExp(`^${COLAB.employeeId}/`));
    });
});
