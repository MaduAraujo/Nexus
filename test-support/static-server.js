const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.E2E_STATIC_PORT || 4173;

const CSP = (() => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    const csp = config.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
    return csp
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d.startsWith('script-src ') || d.startsWith('style-src '))
        .join('; ');
})();

const COMO_PRODUCAO = process.env.COMO_PRODUCAO === '1';
const HEADERS_PRODUCAO = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))
    .headers.filter((h) => h.source === '/(.*)')
    .flatMap((h) => h.headers);
const IGNORADOS = fs
    .readFileSync(path.join(ROOT, '.vercelignore'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
const ignorado = (urlPath) =>
    IGNORADOS.some((i) => urlPath === `/${i}` || urlPath.startsWith(`/${i}/`)) || urlPath.startsWith('/node_modules') || urlPath.startsWith('/.git');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);

    if (COMO_PRODUCAO && ignorado(urlPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
    }

    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }
        const ext = path.extname(filePath);
        const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
        if (COMO_PRODUCAO) HEADERS_PRODUCAO.forEach((h) => (headers[h.key] = h.value));
        else if (ext === '.html') headers['Content-Security-Policy'] = CSP;
        res.writeHead(200, headers);
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`E2E static server rodando em http://127.0.0.1:${PORT}`);
});
