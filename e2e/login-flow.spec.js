const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY } = require('../test-support/e2e-supabase-config.js');
const { E2E_USERS } = require('../test-support/e2e-seed.js');

const ORIGINAL_CLIENT_PATH = path.join(__dirname, '..', 'src', 'javascript', 'shared', 'supabase-client.js');

async function useLocalSupabase(page) {
    const original = fs.readFileSync(ORIGINAL_CLIENT_PATH, 'utf8');
    const patched = original.replace(
        /const SUPABASE_URL = '.*?';\s*\nconst SUPABASE_ANON_KEY = '.*?';/,
        `const SUPABASE_URL = '${LOCAL_SUPABASE_URL}';\nconst SUPABASE_ANON_KEY = '${LOCAL_SUPABASE_ANON_KEY}';`
    );
    await page.route('**/shared/supabase-client.js', (route) => route.fulfill({ contentType: 'text/javascript', body: patched }));
}

async function login(page, { email, password }, profileType) {
    await page.goto('/src/screens/login.html');
    await page.click(profileType === 'Administrador' ? '.profile-card.rh' : '.profile-card.colaborador');
    await page.click('#btn-continue');
    await page.fill('#login-user', email);
    await page.fill('#login-pass', password);
    await page.click('#btn-login');
}

test.describe('Login → dashboard (sistema, ponta a ponta contra Supabase local real)', () => {
    test.beforeEach(async ({ page }) => {
        await useLocalSupabase(page);
    });

    test('colaborador loga e chega ao próprio painel', async ({ page }) => {
        await login(page, E2E_USERS.colaborador, 'colaborador');

        await page.waitForURL('**/inicio-colaborador.html');
        await expect(page.locator('#sidebar-name')).toHaveText(E2E_USERS.colaborador.name);
    });

    test('administrador loga e chega ao painel de RH', async ({ page }) => {
        await login(page, E2E_USERS.administrador, 'Administrador');

        await page.waitForURL('**/inicio-rh.html');
        await expect(page.locator('#rh-sidebar-name')).toHaveText(E2E_USERS.administrador.name);
    });

    test('colaborador não consegue entrar com credenciais erradas', async ({ page }) => {
        await login(page, { email: E2E_USERS.colaborador.email, password: 'senha-errada' }, 'colaborador');

        await expect(page.locator('#toast')).toContainText('incorretos');
        await expect(page).toHaveURL(/login\.html/);
    });

    test('colaborador não consegue entrar pelo card de Administrador', async ({ page }) => {
        await login(page, E2E_USERS.colaborador, 'Administrador');

        await expect(page.locator('#toast')).toContainText('Administrativo');
        await expect(page).toHaveURL(/login\.html/);
    });
});