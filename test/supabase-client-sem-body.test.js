const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = path.join(__dirname, '..', 'src', 'javascript', 'shared', 'supabase-client.js');
const CODE = fs.readFileSync(FILE, 'utf8');

test('supabase-client — erro antes de a página ter <body> aparece quando o documento carrega', async () => {
    const dom = new JSDOM('', {
        url: 'http://localhost:4173/src/screens/dashboard.html',
        runScripts: 'outside-only',
        virtualConsole: new VirtualConsole(),
    });
    const w = dom.window;
    w.document.documentElement.removeChild(w.document.body);
    const respostas = [];
    class Builder {
        then(onFulfilled, onRejected) {
            return Promise.resolve(respostas.shift() || { data: [], error: null }).then(onFulfilled, onRejected);
        }
    }
    class Bucket {}
    w.supabase = {
        createClient: () => ({ from: () => ({ select: () => new Builder() }), storage: { from: () => new Bucket() } }),
    };
    w.requestAnimationFrame = () => {};
    const pendentes = [];
    const setTimeoutReal = w.setTimeout.bind(w);
    w.setTimeout = (fn, ms, ...a) => (ms === 600 ? pendentes.push(fn) : ms === 6000 ? 0 : setTimeoutReal(fn, ms, ...a));
    vm.runInContext(CODE, dom.getInternalVMContext(), { filename: FILE });
    vm.runInContext('globalThis.__sb = () => sb;', dom.getInternalVMContext(), { filename: 'acesso-do-teste.js' });
    const sb = w.__sb();

    respostas.push({ data: null, error: { message: 'cedo demais' } });
    await sb.from('x').select();
    await new Promise((r) => setTimeout(r, 0));
    pendentes.splice(0).forEach((fn) => fn());
    assert.equal(w.document.getElementById('nexus-err-toast-container'), null);
    w.document.documentElement.appendChild(w.document.createElement('body'));
    w.dispatchEvent(new w.Event('DOMContentLoaded'));
    const toasts = [...w.document.querySelectorAll('#nexus-err-toast-container > div')].map((d) => d.textContent);
    assert.deepEqual(toasts, ['Erro ao comunicar com o servidor: cedo demais']);
    w.close();
});
