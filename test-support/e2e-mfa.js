const { totp } = require('./totp.js');
const { E2E_ADMIN_TOTP_SECRET } = require('./e2e-seed.js');

const STEP_MS = 30_000;
const usedSteps = new Set();

async function nextAdminCode() {
    for (;;) {
        const now = Date.now();
        for (const delta of [0, 1, -1]) {
            const time = now + delta * STEP_MS;
            const stepId = Math.floor(time / STEP_MS);
            if (!usedSteps.has(stepId)) {
                usedSteps.add(stepId);
                return totp(E2E_ADMIN_TOTP_SECRET, { time });
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

async function submitAdminMfa(page) {
    await page.waitForSelector('#form-mfa.active');
    await page.fill('#mfa-code', await nextAdminCode());
    await page.click('#btn-mfa');
}

module.exports = { submitAdminMfa };
