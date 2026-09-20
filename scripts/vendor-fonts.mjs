import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontsDir = path.join(root, 'src', 'assets', 'fonts');
const cssOut = path.join(root, 'src', 'styles', 'fonts.css');

const SUBSETS = new Set(['latin', 'latin-ext']);
const FAMILIES = [
    'family=Plus+Jakarta+Sans:wght@400..800',
    'family=Syne:wght@400..700',
    'family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,400',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function get(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} ao baixar ${url}`);
    return res;
}

const cssRes = await get(`https://fonts.googleapis.com/css2?${FAMILIES.join('&')}&display=swap`);
const css = await cssRes.text();

const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)];
if (!blocks.length) throw new Error('Nenhum @font-face na resposta do Google Fonts');

await mkdir(fontsDir, { recursive: true });

const out = [
    '/* Gerado por scripts/vendor-fonts.mjs. Não edite à mão: rode o script de novo. */',
    '/* Fontes hospedadas no próprio site (nada é carregado de fonts.googleapis.com / fonts.gstatic.com). */',
    '',
];

for (const [, subset, body] of blocks) {
    if (!SUBSETS.has(subset)) continue;
    const family = /font-family:\s*'([^']+)'/.exec(body)[1];
    const style = /font-style:\s*(\w+)/.exec(body)[1];
    const weight = /font-weight:\s*([\d ]+);/.exec(body)[1].trim();
    const range = /unicode-range:\s*([^;]+);/.exec(body)[1].trim();
    const remote = /url\((https:[^)]+\.woff2)\)/.exec(body)[1];

    const file = `${family.toLowerCase().replace(/\s+/g, '-')}-${style === 'italic' ? 'italic-' : ''}${subset}.woff2`;
    const buf = Buffer.from(await (await get(remote)).arrayBuffer());
    await writeFile(path.join(fontsDir, file), buf);
    console.log(`${file} (${(buf.length / 1024).toFixed(1)} KB)`);

    out.push(
        '@font-face {',
        `    font-family: '${family}';`,
        `    font-style: ${style};`,
        `    font-weight: ${weight};`,
        '    font-display: swap;',
        `    src: url('../assets/fonts/${file}') format('woff2');`,
        `    unicode-range: ${range};`,
        '}',
        ''
    );
}

await writeFile(cssOut, out.join('\n'));
console.log(`\n${path.relative(root, cssOut)} gerado.`);