const fs = require('fs');
const path = require('path');
const { Linter } = require('eslint');
const globals = require('globals');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const CDN_GLOBALS = ['supabase', 'Chart', 'jspdf', 'jsPDF', 'XLSX', 'L', 'faceapi', 'marked', 'Tesseract'];

function scriptsOf(htmlPath) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
        .map((m) => m[1])
        .filter((src) => !/^https?:/.test(src))
        .map((src) => (src.startsWith('/') ? path.join(ROOT, src) : path.resolve(path.dirname(htmlPath), src)));
}

function declaredGlobals(file) {
    const src = fs.readFileSync(file, 'utf8');
    const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowAwaitOutsideFunction: true });
    const names = new Set();
    for (const node of ast.body) {
        if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') names.add(node.id.name);
        if (node.type === 'VariableDeclaration') for (const d of node.declarations) if (d.id.type === 'Identifier') names.add(d.id.name);
    }
    for (const m of src.matchAll(/\b(?:window|root|globalThis|self)\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
    return names;
}

function findUndefined(screenHtml) {
    const files = scriptsOf(screenHtml);
    const linter = new Linter({ configType: 'flat' });
    const problems = [];
    const known = new Set(CDN_GLOBALS);
    const perFile = files.map((f) => ({ file: f, names: declaredGlobals(f) }));
    perFile.forEach(({ names }) => names.forEach((n) => known.add(n)));

    for (const { file } of perFile) {
        const config = [
            {
                languageOptions: {
                    ecmaVersion: 2022,
                    sourceType: 'script',
                    globals: { ...globals.browser, ...Object.fromEntries([...known].map((n) => [n, 'writable'])), module: 'readonly' },
                },
                rules: { 'no-undef': 'error' },
            },
        ];
        for (const msg of linter.verify(fs.readFileSync(file, 'utf8'), config, file)) {
            if (msg.ruleId === 'no-undef') problems.push(`${path.relative(ROOT, file)}:${msg.line} ${msg.message}`);
        }
    }
    return problems;
}

function screens() {
    const dir = path.join(ROOT, 'src/screens');
    return [
        path.join(ROOT, 'index.html'),
        ...fs
            .readdirSync(dir)
            .filter((f) => f.endsWith('.html'))
            .map((f) => path.join(dir, f)),
    ];
}

module.exports = { findUndefined, screens };

if (require.main === module) {
    const all = new Set();
    for (const s of screens()) findUndefined(s).forEach((p) => all.add(p));
    console.log([...all].sort().join('\n') || 'nenhum identificador indefinido');
}
