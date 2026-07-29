const globals = require('globals');

module.exports = [
    {
        ignores: ['node_modules/**', 'package-lock.json'],
    },
    {
        files: ['src/javascript/**/*.js'],
        ignores: ['**/*.example.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: { ...globals.browser },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
            'no-undef': 'off',
            'no-var': 'error',
            'prefer-const': 'warn',
            eqeqeq: ['warn', 'smart'],
            'no-empty': ['warn', { allowEmptyCatch: true }],
        },
    },
    {
        files: ['test/**/*.js', 'test-support/**/*.js', 'test-integration/**/*.js', 'e2e/**/*.js', 'playwright.config.js', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none' }],
            'no-undef': 'error',
        },
    },
    {
        // page.evaluate() callbacks run in the browser, not Node.
        files: ['test-support/pwa-audit.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...globals.node, ...globals.browser },
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none' }],
            'no-undef': 'error',
        },
    },
];
