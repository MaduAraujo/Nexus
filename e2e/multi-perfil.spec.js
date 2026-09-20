const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY } = require('../test-support/e2e-supabase-config.js');
const { E2E_USERS } = require('../test-support/e2e-seed.js');
const { submitAdminMfa } = require('../test-support/e2e-mfa.js');

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
    if (profileType === 'Administrador' && email === E2E_USERS.administrador.email && password === E2E_USERS.administrador.password) await submitAdminMfa(page);
}

test.describe('Colaborador e RH no mesmo navegador, em abas diferentes', () => {
    test('logar como RH em uma aba não troca a sessão do colaborador na outra', async ({ context }) => {
        const colabTab = await context.newPage();
        const rhTab = await context.newPage();
        await useLocalSupabase(colabTab);
        await useLocalSupabase(rhTab);

        await login(colabTab, E2E_USERS.colaborador, 'colaborador');
        await colabTab.waitForURL('**/inicio-colaborador.html');

        await login(rhTab, E2E_USERS.administrador, 'Administrador');
        await rhTab.waitForURL('**/inicio-rh.html');

        await colabTab.reload();
        await expect(colabTab).toHaveURL(/inicio-colaborador\.html/);
        await expect(colabTab.locator('#sidebar-name')).toHaveText(E2E_USERS.colaborador.name);

        await rhTab.reload();
        await expect(rhTab).toHaveURL(/inicio-rh\.html/);
        await expect(rhTab.locator('#rh-sidebar-name')).toHaveText(E2E_USERS.administrador.name);
    });

    test('escolher um perfil que já tem sessão entra direto, sem pedir senha', async ({ context }) => {
        const first = await context.newPage();
        await useLocalSupabase(first);
        await login(first, E2E_USERS.colaborador, 'colaborador');
        await first.waitForURL('**/inicio-colaborador.html');

        const second = await context.newPage();
        await useLocalSupabase(second);
        await second.goto('/src/screens/login.html');
        await second.click('.profile-card.colaborador');
        await second.click('#btn-continue');
        await second.waitForURL('**/inicio-colaborador.html');
    });
});
