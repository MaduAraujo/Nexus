const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const ARQUIVO = path.join(__dirname, '../src/javascript/shared/pwa-register.js');
const CODIGO = fs.readFileSync(ARQUIVO, 'utf8');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';

const tick = () => new Promise((r) => setTimeout(r, 0));

function worker(state = 'installing') {
    const w = { state, mensagens: [], ouvintes: {} };
    w.postMessage = (m) => w.mensagens.push(m);
    w.addEventListener = (t, cb) => (w.ouvintes[t] = cb);
    return w;
}

function registro({ waiting = null, active = null, installing = null } = {}) {
    const r = { waiting, active, installing, ouvintes: {} };
    r.addEventListener = (t, cb) => (r.ouvintes[t] = cb);
    return r;
}

function serviceWorker({ controller = null, registration = registro(), falha = null } = {}) {
    const sw = { controller, registros: [], ouvintes: {} };
    sw.addEventListener = (t, cb) => (sw.ouvintes[t] = cb);
    sw.register = async (url) => {
        sw.registros.push(url);
        if (falha) throw falha;
        return registration;
    };
    return sw;
}

async function montar({ body = '', ua = ANDROID, standalone = false, sw, online = true, carregarDepois = false } = {}) {
    const avisos = [];
    const navegacoes = [];
    const vc = new VirtualConsole();
    vc.on('warn', (...a) => avisos.push(a.map(String).join(' ')));
    vc.on('jsdomError', (e) => {
        if (/navigation|reload/i.test(e.message)) navegacoes.push(e.message);
        else throw e;
    });
    const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
        url: 'http://localhost:4173/src/screens/login.html',
        runScripts: 'outside-only',
        virtualConsole: vc,
        beforeParse(w) {
            Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true });
            Object.defineProperty(w.navigator, 'onLine', { get: () => estado.online, configurable: true });
            if (sw) Object.defineProperty(w.navigator, 'serviceWorker', { value: sw, configurable: true });
            w.matchMedia = (q) => ({ matches: q === '(display-mode: standalone)' && standalone });
        },
    });
    const estado = { online };
    const w = dom.window;
    await new Promise((r) => (w.document.readyState === 'complete' ? r() : w.addEventListener('load', r)));
    if (!carregarDepois) Object.defineProperty(w.document, 'readyState', { value: 'loading', configurable: true });
    vm.runInContext(CODIGO, dom.getInternalVMContext(), { filename: ARQUIVO });
    if (!carregarDepois) {
        delete w.document.readyState;
        w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
        w.dispatchEvent(new w.Event('load'));
    }
    await tick();
    await tick();
    const ficarOffline = (valor) => {
        estado.online = !valor;
        w.dispatchEvent(new w.Event(valor ? 'offline' : 'online'));
    };
    return { w, doc: w.document, avisos, navegacoes, ficarOffline, fechar: () => w.close() };
}

const toast = (doc) => doc.querySelector('.nexus-pwa-toast');

describe('pwa-register — estilos', () => {
    test('injeta a folha de estilo do PWA uma vez só, mesmo com vários avisos', async () => {
        const p = await montar();
        p.ficarOffline(true);
        p.ficarOffline(false);
        const links = p.doc.querySelectorAll('#nexus-pwa-style');
        assert.equal(links.length, 1);
        assert.equal(links[0].getAttribute('href'), '/src/styles/pwa.css');
        p.fechar();
    });
});

describe('pwa-register — service worker e atualização', () => {
    test('registra o service worker depois do load', async () => {
        const sw = serviceWorker();
        const p = await montar({ sw });
        assert.deepEqual(sw.registros, ['/service-worker.js']);
        assert.equal(toast(p.doc), null, 'sem versão nova, sem aviso');
        p.fechar();
    });

    test('versão nova já esperando: avisa, e "Atualizar" manda o worker assumir', async () => {
        const novo = worker('installed');
        const sw = serviceWorker({ controller: {}, registration: registro({ waiting: novo, active: worker('activated') }) });
        const p = await montar({ sw });
        assert.match(toast(p.doc).textContent, /Nova versão do app disponível/);
        p.doc.querySelector('.nexus-pwa-primary').click();
        assert.deepEqual(novo.mensagens, ['SKIP_WAITING']);
        assert.equal(toast(p.doc), null);
        p.fechar();
    });

    test('"Depois" fecha o aviso sem atualizar', async () => {
        const novo = worker('installed');
        const sw = serviceWorker({ controller: {}, registration: registro({ waiting: novo, active: worker('activated') }) });
        const p = await montar({ sw });
        p.doc.querySelector('.nexus-pwa-secondary').click();
        assert.equal(toast(p.doc), null);
        assert.deepEqual(novo.mensagens, []);
        p.fechar();
    });

    test('atualização encontrada durante o uso avisa quando termina de instalar', async () => {
        const reg = registro({ active: worker('activated') });
        const p = await montar({ sw: serviceWorker({ controller: {}, registration: reg }) });
        const novo = worker('installing');
        reg.installing = novo;
        reg.ouvintes.updatefound();
        novo.ouvintes.statechange();
        assert.equal(toast(p.doc), null, 'ainda instalando');
        novo.state = 'installed';
        novo.ouvintes.statechange();
        assert.match(toast(p.doc).textContent, /Nova versão/);
        p.fechar();
    });

    test('primeira instalação (sem worker ativo) não mostra aviso de atualização', async () => {
        const reg = registro();
        const p = await montar({ sw: serviceWorker({ registration: reg }) });
        reg.ouvintes.updatefound();
        const novo = worker('installed');
        reg.installing = novo;
        reg.ouvintes.updatefound();
        novo.ouvintes.statechange();
        assert.equal(toast(p.doc), null);
        p.fechar();
    });

    test('troca de controlador: na primeira instalação não recarrega; em atualização recarrega uma vez só', async () => {
        const primeiro = serviceWorker();
        const p1 = await montar({ sw: primeiro });
        primeiro.ouvintes.controllerchange();
        assert.equal(p1.navegacoes.length, 0);
        primeiro.ouvintes.controllerchange();
        assert.equal(p1.navegacoes.length, 1);
        p1.fechar();

        const atualizando = serviceWorker({ controller: {} });
        const p2 = await montar({ sw: atualizando });
        atualizando.ouvintes.controllerchange();
        atualizando.ouvintes.controllerchange();
        assert.equal(p2.navegacoes.length, 1);
        p2.fechar();
    });

    test('falha ao registrar só gera aviso no console', async () => {
        const p = await montar({ sw: serviceWorker({ falha: new Error('https obrigatório') }) });
        assert.ok(p.avisos.some((a) => /Falha ao registrar o service worker/.test(a)));
        p.fechar();
    });

    test('navegador sem service worker segue funcionando', async () => {
        const p = await montar({ body: '<button id="btn-install-app" hidden></button>' });
        assert.equal(p.doc.getElementById('btn-install-app').hidden, true);
        assert.ok(p.doc.querySelector('.nexus-pwa-offline-banner'));
        p.fechar();
    });
});

describe('pwa-register — botão de instalar', () => {
    const BOTAO = '<button id="btn-install-app" hidden>Instalar</button>';

    test('Android/Chrome: aparece quando o navegador oferece instalar, abre o prompt e some', async () => {
        const p = await montar({ body: BOTAO });
        const btn = p.doc.getElementById('btn-install-app');
        assert.equal(btn.hidden, true);

        let prompts = 0;
        const evento = new p.w.Event('beforeinstallprompt', { cancelable: true });
        evento.prompt = () => prompts++;
        evento.userChoice = Promise.resolve({ outcome: 'accepted' });
        p.w.dispatchEvent(evento);
        assert.equal(evento.defaultPrevented, true);
        assert.equal(btn.hidden, false);

        btn.click();
        await tick();
        assert.equal(prompts, 1);
        assert.equal(btn.hidden, true);
        btn.click();
        await tick();
        assert.equal(prompts, 1, 'o prompt só pode ser usado uma vez');
        p.fechar();
    });

    test('app instalado esconde o botão', async () => {
        const p = await montar({ body: BOTAO });
        const evento = new p.w.Event('beforeinstallprompt');
        p.w.dispatchEvent(evento);
        p.w.dispatchEvent(new p.w.Event('appinstalled'));
        assert.equal(p.doc.getElementById('btn-install-app').hidden, true);
        p.fechar();
    });

    test('iPhone no Safari: mostra o botão e explica como adicionar à tela de início', async () => {
        const p = await montar({ body: BOTAO, ua: IPHONE });
        const btn = p.doc.getElementById('btn-install-app');
        assert.equal(btn.hidden, false);

        btn.click();
        const overlay = p.doc.querySelector('.nexus-pwa-modal-overlay');
        assert.match(overlay.textContent, /Adicionar à Tela de Início/);
        overlay.querySelector('.nexus-pwa-modal h3').click();
        assert.ok(p.doc.querySelector('.nexus-pwa-modal-overlay'), 'clique dentro do modal não fecha');
        overlay.click();
        assert.equal(p.doc.querySelector('.nexus-pwa-modal-overlay'), null, 'clique fora fecha');

        btn.click();
        p.doc.querySelector('.nexus-pwa-modal button').click();
        assert.equal(p.doc.querySelector('.nexus-pwa-modal-overlay'), null, '"Entendi" fecha');
        p.fechar();
    });

    test('iPhone com o app já aberto da tela de início não mostra o botão', async () => {
        const p = await montar({ body: BOTAO, ua: IPHONE, standalone: true });
        const btn = p.doc.getElementById('btn-install-app');
        assert.equal(btn.hidden, true);
        btn.click();
        assert.equal(p.doc.querySelector('.nexus-pwa-modal-overlay'), null);
        p.fechar();
    });

    test('script carregado depois do DOM pronto também liga o botão', async () => {
        const p = await montar({ body: BOTAO, ua: IPHONE, carregarDepois: true });
        assert.equal(p.doc.getElementById('btn-install-app').hidden, false);
        assert.ok(p.doc.querySelector('.nexus-pwa-offline-banner'));
        p.fechar();
    });
});

describe('pwa-register — aviso de sem conexão', () => {
    test('aparece ao perder a conexão e some ao voltar, sem duplicar', async () => {
        const p = await montar();
        const banner = () => p.doc.querySelectorAll('.nexus-pwa-offline-banner');
        assert.equal(banner().length, 1);
        assert.equal(banner()[0].hidden, true);

        p.ficarOffline(true);
        assert.equal(banner()[0].hidden, false);
        assert.match(banner()[0].textContent, /Sem conexão com a internet/);

        p.ficarOffline(false);
        assert.equal(banner().length, 1);
        assert.equal(banner()[0].hidden, true);
        p.fechar();
    });

    test('abrir já sem conexão mostra o aviso de cara', async () => {
        const p = await montar({ online: false });
        assert.equal(p.doc.querySelector('.nexus-pwa-offline-banner').hidden, false);
        p.fechar();
    });
});
