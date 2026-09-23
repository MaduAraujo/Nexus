async function waitForDashboard(page, urlGlob) {
    const savedCheck = page.locator('.e2e-dialog #e2e-saved-check');
    const reached = page.waitForURL(urlGlob).then(() => 'dashboard');
    const recoveryShown = savedCheck
        .waitFor({ state: 'visible' })
        .then(() => 'recovery-key')
        .catch(() => null);

    if ((await Promise.race([reached, recoveryShown])) === 'recovery-key') {
        await savedCheck.check();
        await page.locator('.e2e-dialog').getByRole('button', { name: 'Continuar' }).click();
        await reached;
    }
}

module.exports = { waitForDashboard };
