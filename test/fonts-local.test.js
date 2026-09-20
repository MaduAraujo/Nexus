const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCREENS_DIR = path.join(ROOT, 'src', 'screens');
const FONTS_CSS = path.join(ROOT, 'src', 'styles', 'fonts.css');

const htmls = fs
    .readdirSync(SCREENS_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(SCREENS_DIR, f));
htmls.push(path.join(ROOT, 'index.html'));

describe('Fontes hospedadas no próprio site', () => {
    test('nenhuma tela carrega folha de estilo ou fonte do Google Fonts', () => {
        const problemas = htmls.filter((f) => /fonts\.(googleapis|gstatic)\.com/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
        assert.deepEqual(problemas, [], `Ainda apontam para o Google Fonts:\n${problemas.join('\n')}\nUse ../styles/fonts.css (scripts/vendor-fonts.mjs).`);
    });

    test('toda tela que usa as fontes do Nexus inclui fonts.css', () => {
        const sem = htmls
            .filter((f) => /\.\.\/styles\/[\w-]+\.css/.test(fs.readFileSync(f, 'utf8')) && !fs.readFileSync(f, 'utf8').includes('styles/fonts.css'))
            .map((f) => path.relative(ROOT, f));
        assert.deepEqual(sem, [], `Telas sem fonts.css:\n${sem.join('\n')}`);
    });

    test('a CSP não libera mais domínios do Google Fonts', () => {
        const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
        const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
        assert.doesNotMatch(csp, /fonts\.(googleapis|gstatic)\.com/);
    });

    test('fonts.css só aponta para arquivos locais que existem', () => {
        const css = fs.readFileSync(FONTS_CSS, 'utf8');
        const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
        assert.ok(urls.length > 0, 'fonts.css sem nenhum @font-face');
        for (const u of urls) {
            assert.doesNotMatch(u, /^(https?:)?\/\//, `URL externa em fonts.css: ${u}`);
            const file = path.resolve(path.dirname(FONTS_CSS), u);
            assert.ok(fs.existsSync(file), `arquivo de fonte ausente: ${u}`);
            assert.equal(fs.readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', `${u} não é woff2`);
        }
    });
});
