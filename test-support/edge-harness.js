
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { stripTypeScriptTypes } = require('node:module');

const FUNCTIONS_DIR = path.resolve(__dirname, '..', 'supabase', 'functions');
const OUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-edge-'));

const STUBS = {
    'https://deno.land/std@0.177.0/http/server.ts': 'export const serve = (handler) => { globalThis.__edgeHandler = handler; };',
    'https://esm.sh/@supabase/supabase-js@2': 'export const createClient = (...args) => globalThis.__edgeCreateClient(...args);',
    'npm:web-push@3.6.7': 'export default new Proxy({}, { get: (_t, k) => globalThis.__edgeWebpush[k] });',
};

function dataUrl(code) {
    return `data:text/javascript,${encodeURIComponent(code)}`;
}

function transpile(file) {
    const out = path.join(OUT_DIR, path.relative(FUNCTIONS_DIR, file)).replace(/\.ts$/, '.mjs');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let code = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.ts')) code = stripTypeScriptTypes(code);
    code = code.replace(/from\s+"([^"]+)"/g, (m, spec) => {
        if (STUBS[spec]) return `from ${JSON.stringify(dataUrl(STUBS[spec]))}`;
        if (spec.startsWith('.')) {
            const target = path.resolve(path.dirname(file), spec);
            const url = target.endsWith('.ts') ? pathToFileURL(transpile(target)).href : pathToFileURL(target).href;
            return `from ${JSON.stringify(url)}`;
        }
        throw new Error(`edge-harness: import não tratado "${spec}" em ${file}`);
    });
    fs.writeFileSync(out, code);
    return out;
}

let counter = 0;

async function loadEdgeFunction(name, { env = {}, createClient, webpush } = {}) {
    globalThis.Deno = { env: { get: (k) => env[k] } };
    globalThis.__edgeCreateClient =
        createClient ||
        (() => {
            throw new Error('createClient não configurado no teste');
        });
    globalThis.__edgeWebpush = webpush || { setVapidDetails() {}, sendNotification: async () => ({}) };
    globalThis.__edgeHandler = null;
    const file = transpile(path.join(FUNCTIONS_DIR, name, 'index.ts'));
    await import(`${pathToFileURL(file).href}?v=${++counter}`);
    if (typeof globalThis.__edgeHandler !== 'function') throw new Error(`${name}: serve() não foi chamado`);
    return globalThis.__edgeHandler;
}

function fakeJwt(payload) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

function request(url, { method = 'POST', body, headers = {} } = {}) {
    const init = { method, headers: { Origin: 'https://nexus-nine-zeta.vercel.app', ...headers } };
    if (body !== undefined) init.body = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
    return new Request(url, init);
}

module.exports = { loadEdgeFunction, fakeJwt, request };
