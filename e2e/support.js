const base = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY, localServiceKey } = require('../test-support/e2e-supabase-config.js');
const { E2E_USERS } = require('../test-support/e2e-seed.js');
const { submitAdminMfa } = require('../test-support/e2e-mfa.js');
const { waitForDashboard } = require('../test-support/e2e-dashboard.js');
const { withServiceRole } = require('../test-support/pg-rls-client.js');

const { expect } = base;
const ORIGINAL_CLIENT_PATH = path.join(__dirname, '..', 'src', 'javascript', 'shared', 'supabase-client.js');
const COLAB = E2E_USERS.colaborador;
const ADMIN = E2E_USERS.administrador;
const E2E_EMPLOYEES = [COLAB.employeeId, ADMIN.employeeId];

const WATCHED = ['/rest/v1/', '/storage/v1/', '/auth/v1/', '/functions/v1/nexus-files'];

async function useLocalSupabase(page) {
    const original = fs.readFileSync(ORIGINAL_CLIENT_PATH, 'utf8');
    const patched = original.replace(
        /const SUPABASE_URL = '.*?';\s*\nconst SUPABASE_ANON_KEY = '.*?';/,
        `const SUPABASE_URL = '${LOCAL_SUPABASE_URL}';\nconst SUPABASE_ANON_KEY = '${LOCAL_SUPABASE_ANON_KEY}';`
    );
    await page.route('**/shared/supabase-client.js', (route) => route.fulfill({ contentType: 'text/javascript', body: patched }));
}

async function stubPushFunctions(page) {
    await page.route(/\/functions\/v1\/send-(push|document-push|alert-push)$/, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{"sent":0}' })
    );
}

function watchSupabase(page) {
    const failures = [];
    page.on('response', async (res) => {
        const url = res.url();
        if (!url.startsWith(LOCAL_SUPABASE_URL) || res.status() < 400) return;
        const route = url.slice(LOCAL_SUPABASE_URL.length);
        if (!WATCHED.some((p) => route.startsWith(p))) return;
        let body = '';
        try {
            body = (await res.text()).slice(0, 300);
        } catch {}
        failures.push(`${res.request().method()} ${route.split('?')[0]} → ${res.status()} ${body}`);
    });
    page.on('pageerror', (err) => failures.push(`erro de JavaScript na tela: ${err.message}`));
    if (process.env.E2E_DEBUG) {
        page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
        page.on(
            'response',
            (r) => r.url().startsWith(LOCAL_SUPABASE_URL) && console.log('[res]', r.status(), r.request().method(), r.url().slice(LOCAL_SUPABASE_URL.length))
        );
    }
    return failures;
}

const test = base.test.extend({
    supabaseErrors: async ({}, use) => {
        const expected = [];
        await use({ expect: (pattern) => expected.push(pattern), expected });
    },
    page: async ({ page, supabaseErrors }, use) => {
        await useLocalSupabase(page);
        await stubPushFunctions(page);
        const failures = watchSupabase(page);
        page.on('dialog', (d) => d.accept());
        await use(page);
        const pending = [...supabaseErrors.expected];
        const unexpected = failures.filter((f) => {
            const i = pending.findIndex((p) => p.test(f));
            if (i === -1) return true;
            pending.splice(i, 1);
            return false;
        });
        expect(unexpected, 'o Supabase real recusou alguma chamada da tela').toEqual([]);
        expect(pending, 'recusa esperada não aconteceu').toEqual([]);
    },
});

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

async function switchUser(page, user, profileType) {
    await page.goto('/manifest.json');
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await login(page, user, profileType);
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function pickDate(page, prefix, date) {
    await page.click(`#${prefix}-trigger`);
    const btn = page.locator(`#${prefix}-grid button[data-date="${date}"]`);
    for (let i = 0; i < 6 && !(await btn.count()); i++) await page.click(`#${prefix}-next`);
    await btn.click();
}

async function removeStorageObjects(bucket, paths) {
    if (!paths.length) return;
    const key = localServiceKey();
    const res = await fetch(`${LOCAL_SUPABASE_URL}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
    });
    if (!res.ok) throw new Error(`Limpeza do Storage falhou: ${res.status} ${await res.text()}`);
}

async function resetE2EData() {
    const objects = await withServiceRole(async (db) => {
        const { rows } = await db.query(
            `SELECT bucket_id, name FROM storage.objects
              WHERE bucket_id IN ('documents', 'ponto-selfies', 'message-attachments')
                AND (split_part(name, '/', 1) = ANY($1::text[]) OR name IN (SELECT storage_path FROM documents WHERE employee_id = ANY($1::uuid[])))`,
            [E2E_EMPLOYEES]
        );
        await db.query('DELETE FROM messages WHERE created_by = ANY($1)', [[COLAB.userId, ADMIN.userId]]);
        await db.query('DELETE FROM document_audit_log WHERE employee_id = ANY($1)', [E2E_EMPLOYEES]);
        for (const table of ['documents', 'vacations', 'payslips', 'time_records', 'employee_audit', 'data_access_log']) {
            await db.query(`DELETE FROM ${table} WHERE employee_id = ANY($1)`, [E2E_EMPLOYEES]);
        }
        await db.query(`UPDATE employees SET status = 'Ativo', termination_date = NULL WHERE id = ANY($1)`, [E2E_EMPLOYEES]);
        return rows;
    });
    for (const bucket of new Set(objects.map((o) => o.bucket_id))) {
        await removeStorageObjects(
            bucket,
            objects.filter((o) => o.bucket_id === bucket).map((o) => o.name)
        );
    }
}

module.exports = { test, expect, login, switchUser, pickDate, iso, resetE2EData, COLAB, ADMIN };
