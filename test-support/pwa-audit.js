const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const PORT = process.env.E2E_STATIC_PORT || 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function waitForServer(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        (function attempt() {
            http.get(url, (res) => {
                res.resume();
                resolve();
            }).on('error', () => {
                if (Date.now() > deadline) reject(new Error('Static server did not start in time'));
                else setTimeout(attempt, 200);
            });
        })();
    });
}

async function main() {
    const failures = [];
    const server = spawn(process.execPath, ['test-support/static-server.js'], {
        env: { ...process.env, E2E_STATIC_PORT: String(PORT) },
        stdio: 'ignore',
    });

    try {
        await waitForServer(`${BASE_URL}/index.html`, 10000);

        const browser = await chromium.launch();
        const page = await browser.newPage();
        const consoleErrors = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => consoleErrors.push(err.message));

        await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'networkidle' });

        async function fetchStatus(url) {
            return page.evaluate(async (u) => {
                try {
                    const r = await fetch(u);
                    return r.status;
                } catch {
                    return -1;
                }
            }, url);
        }

        const manifestHref = await page.evaluate(() => {
            const link = document.querySelector('link[rel="manifest"]');
            return link ? link.href : null;
        });

        if (!manifestHref) {
            failures.push('No <link rel="manifest"> found on index.html');
        } else {
            const manifestStatus = await fetchStatus(manifestHref);
            if (manifestStatus !== 200) failures.push(`manifest.json returned ${manifestStatus}`);

            const manifest = await page.evaluate(async (href) => {
                const r = await fetch(href);
                return r.json();
            }, manifestHref);

            for (const field of ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color']) {
                if (!manifest[field]) failures.push(`manifest.json missing "${field}"`);
            }

            const iconSizes = (manifest.icons || []).map((i) => i.sizes);
            if (!iconSizes.includes('192x192')) failures.push('manifest.json missing a 192x192 icon');
            if (!iconSizes.includes('512x512')) failures.push('manifest.json missing a 512x512 icon');
            if (!(manifest.icons || []).some((i) => i.purpose === 'maskable')) {
                failures.push('manifest.json missing a maskable icon');
            }

            for (const icon of manifest.icons || []) {
                const url = new URL(icon.src, manifestHref).href;
                const status = await fetchStatus(url);
                if (status !== 200) failures.push(`icon "${icon.src}" returned ${status}`);
            }

            for (const shot of manifest.screenshots || []) {
                const url = new URL(shot.src, manifestHref).href;
                const status = await fetchStatus(url);
                if (status !== 200) failures.push(`screenshot "${shot.src}" returned ${status}`);
            }

            for (const shortcut of manifest.shortcuts || []) {
                const shortcutUrl = new URL(shortcut.url, manifestHref).href;
                const status = await fetchStatus(shortcutUrl);
                if (status !== 200) failures.push(`shortcut "${shortcut.name}" url returned ${status}`);
                for (const icon of shortcut.icons || []) {
                    const url = new URL(icon.src, manifestHref).href;
                    const iconStatus = await fetchStatus(url);
                    if (iconStatus !== 200) failures.push(`shortcut "${shortcut.name}" icon returned ${iconStatus}`);
                }
            }
        }

        const swState = await page.evaluate(async () => {
            if (!('serviceWorker' in navigator)) return 'unsupported';
            const start = Date.now();
            while (Date.now() - start < 8000) {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg && reg.active && reg.active.state === 'activated') return 'activated';
                await new Promise((r) => setTimeout(r, 200));
            }
            return 'timeout';
        });
        if (swState !== 'activated') failures.push(`service worker did not activate (state: ${swState})`);

        if (consoleErrors.length) failures.push(`console errors on load: ${consoleErrors.join(' | ')}`);

        await browser.close();
    } finally {
        server.kill();
    }

    if (failures.length) {
        console.error('PWA audit FAILED:\n' + failures.map((f) => ` - ${f}`).join('\n'));
        process.exit(1);
    }

    console.log('PWA audit passed: manifest, icons, screenshots, shortcuts and service worker all OK.');
}

main().catch((err) => {
    console.error('PWA audit crashed:', err);
    process.exit(1);
});
