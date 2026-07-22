const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './e2e',
    testMatch: '*.spec.js',
    fullyParallel: false,
    workers: 1,
    reporter: 'list',
    globalSetup: require.resolve('./e2e/global-setup.js'),
    globalTeardown: require.resolve('./e2e/global-teardown.js'),
    use: {
        baseURL: 'http://127.0.0.1:4173',
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'node test-support/static-server.js',
        port: 4173,
        reuseExistingServer: !process.env.CI,
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
