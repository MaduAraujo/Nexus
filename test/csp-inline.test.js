const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const SCREENS_DIR = path.join(SRC, 'screens');
const JS_DIR = path.join(SRC, 'javascript');
const BUILTIN_ACTIONS = new Set(['noop', 'navigate', 'dismissToast', 'toggleParentOpen']);

const read = (file) => fs.readFileSync(file, 'utf8');

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const htmlFiles = [
    path.join(ROOT, 'index.html'),
    ...fs
        .readdirSync(SCREENS_DIR)
        .filter((f) => f.endsWith('.html'))
        .map((f) => path.join(SCREENS_DIR, f)),
];
const jsFiles = walk(JS_DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.example.js'));
const rel = (file) => path.relative(ROOT, file).replace(/\\/g, '/');

function globalNames(source) {
    const names = new Set();
    const ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script' });
    for (const node of ast.body) if (node.type === 'FunctionDeclaration') names.add(node.id.name);
    (function visit(node) {
        if (!node || typeof node.type !== 'string') return;
        if (
            node.type === 'AssignmentExpression' &&
            node.left.type === 'MemberExpression' &&
            node.left.object.type === 'Identifier' &&
            node.left.object.name === 'window' &&
            !node.left.computed
        ) {
            names.add(node.left.property.name);
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        }
    })(ast);
    return names;
}

describe('CSP: sem unsafe-inline em script-src', () => {
    test('vercel.json não libera script inline nem eval', () => {
        const config = JSON.parse(read(path.join(ROOT, 'vercel.json')));
        const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
        const scriptSrc = csp
            .split(';')
            .map((d) => d.trim())
            .find((d) => d.startsWith('script-src '));
        assert.ok(scriptSrc, 'script-src ausente');
        assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
        assert.doesNotMatch(scriptSrc, /'unsafe-eval'/);
    });

    test('nenhum HTML ou template JS usa handler inline (onclick=...), <script> inline ou javascript:', () => {
        const problemas = [];
        for (const file of [...htmlFiles, ...jsFiles]) {
            const isHtml = file.endsWith('.html');
            read(file)
                .split(/\r?\n/)
                .forEach((line, i) => {
                    const where = `${rel(file)}:${i + 1}`;
                    if (/\son[a-z]+\s*=\s*["'`$]/i.test(line)) problemas.push(`${where}  handler inline: ${line.trim().slice(0, 100)}`);
                    if (/javascript:/i.test(line) && /href\s*=|src\s*=/.test(line)) problemas.push(`${where}  URL javascript:`);
                    if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(line) && (isHtml || /<script[^>]*>[^<]/.test(line))) problemas.push(`${where}  <script> inline`);
                });
        }
        assert.deepEqual(problemas, [], `Use data-click="fn" (src/javascript/shared/events.js):\n${problemas.join('\n')}`);
    });
});

describe('CSP: data-click/change/input/keydown/keyup apontam para funções globais existentes', () => {
    for (const file of htmlFiles.filter((f) => f.startsWith(SCREENS_DIR))) {
        test(rel(file), () => {
            const html = read(file);
            const scripts = [...html.matchAll(/<script src="\.\.\/javascript\/([^"]+)"/g)].map((m) => path.join(JS_DIR, m[1]));
            const existing = scripts.filter((f) => fs.existsSync(f));
            const sources = existing.map(read);
            const defined = new Set(sources.flatMap((s) => [...globalNames(s)]));
            const used = new Map();
            for (const text of [html, ...existing.filter((f) => !f.endsWith('events.js')).map(read)]) {
                for (const m of text.matchAll(/data-(?:click|change|input|keydown|keyup)="([A-Za-z_$][\w$]*)"/g)) used.set(m[1], true);
            }
            const faltando = [...used.keys()].filter((name) => !BUILTIN_ACTIONS.has(name) && !defined.has(name));
            assert.deepEqual(faltando, [], `Funções usadas em data-* mas não definidas como globais nos scripts de ${rel(file)}: ${faltando.join(', ')}`);
        });
    }
});
