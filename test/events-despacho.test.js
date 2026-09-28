const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const EVENTS = path.join(__dirname, '../src/javascript/shared/events.js');
const THEME = path.join(__dirname, '../src/javascript/shared/theme.js');

function montar(body, { antes } = {}) {
    const erros = [];
    const navegacoes = [];
    const vc = new VirtualConsole();
    vc.on('error', (...a) => erros.push(a.map(String).join(' ')));
    vc.on('jsdomError', (e) => navegacoes.push(e.message));
    const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
        url: 'http://localhost:4173/src/screens/dashboard.html',
        runScripts: 'outside-only',
        virtualConsole: vc,
    });
    const w = dom.window;
    antes?.(w);
    vm.runInContext(fs.readFileSync(EVENTS, 'utf8'), dom.getInternalVMContext(), { filename: EVENTS });
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return { w, doc: w.document, erros, navegacoes, tick };
}

describe('events.js — despacho de data-click e afins', () => {
    test('chama a função global com os argumentos, inclusive o próprio elemento e o valor', () => {
        const { w, doc } = montar(`<button id="b" data-click="salvar" data-click-args='["x", {"$":"this"}, {"$":"event"}, 3]'>ok</button>
            <input id="i" data-input="digitou" data-input-args='[{"$":"this.value"}]'>
            <input id="c" type="checkbox" data-change="marcou" data-change-args='{"$":"this.checked"}'>`);
        const chamadas = [];
        w.salvar = function (...a) {
            chamadas.push(['salvar', this.id, a[0], a[1].id, a[2].type, a[3]]);
        };
        w.digitou = (v) => chamadas.push(['digitou', v]);
        w.marcou = (v) => chamadas.push(['marcou', v]);
        doc.getElementById('b').click();
        const i = doc.getElementById('i');
        i.value = 'abc';
        i.dispatchEvent(new w.Event('input'));
        const c = doc.getElementById('c');
        c.checked = true;
        c.dispatchEvent(new w.Event('change'));
        assert.deepEqual(chamadas, [
            ['salvar', 'b', 'x', 'b', 'click', 3],
            ['digitou', 'abc'],
            ['marcou', true],
        ]);
    });

    test('nunca chama função nativa do navegador nem nome inválido, e avisa no console', () => {
        const { w, doc, erros } = montar(`<button id="a" data-click="alert">a</button>
            <button id="b" data-click="naoExiste">b</button>
            <button id="c" data-click="constructor">c</button>
            <button id="d" data-click="x.y">d</button>
            <button id="e" data-click="naoEhFuncao">e</button>`);
        let alertas = 0;
        w.alert = () => alertas++;
        w.naoEhFuncao = 42;
        ['a', 'b', 'c', 'd', 'e'].forEach((id) => doc.getElementById(id).click());
        assert.equal(erros.filter((e) => /ação desconhecida/.test(e)).length, 4, 'alert foi trocado por uma função comum, então só ele é chamado');
        assert.equal(alertas, 1);

        const nativo = montar(`<button id="n" data-click="eval" data-click-args='["window.invadido = true"]'>n</button>
            <button id="p" data-click="parseInt" data-click-args='["10"]'>p</button>`);
        nativo.doc.getElementById('n').click();
        nativo.doc.getElementById('p').click();
        assert.equal(nativo.w.invadido, undefined, 'eval nunca é chamado a partir do HTML');
        assert.ok(nativo.erros.some((e) => /ação desconhecida em data-click: "eval"/.test(e)));
        assert.ok(nativo.erros.some((e) => /ação desconhecida em data-click: "parseInt"/.test(e)));
    });

    test('argumentos em JSON inválido não chamam a função', () => {
        const { w, doc, erros } = montar(`<button id="b" data-click="f" data-click-args='[oops'>b</button>`);
        let chamou = false;
        w.f = () => (chamou = true);
        doc.getElementById('b').click();
        assert.equal(chamou, false);
        assert.ok(erros.some((e) => /data-click-args inválido em "f"/.test(e)));
    });

    test('-self, -keys, -stop, -prevent e -return controlam o evento', () => {
        const { w, doc } = montar(`<div id="fundo" data-click="fechar" data-click-self><span id="dentro">x</span></div>
            <input id="k" data-keydown="enviar" data-keydown-keys="Enter|NumpadEnter">
            <div id="pai" data-click="pai"><button id="filho" data-click="filho" data-click-stop>f</button></div>
            <a id="link" href="#" data-click="noop">l</a>
            <form><button id="p" data-click="noop" data-click-prevent>p</button></form>
            <button id="r" data-click="recusa" data-click-return>r</button>`);
        const log = [];
        w.fechar = () => log.push('fechar');
        w.enviar = () => log.push('enviar');
        w.pai = () => log.push('pai');
        w.filho = () => log.push('filho');
        w.recusa = () => false;

        doc.getElementById('dentro').click();
        doc.getElementById('fundo').click();
        const k = doc.getElementById('k');
        k.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        k.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        doc.getElementById('filho').click();
        assert.deepEqual(log, ['fechar', 'enviar', 'filho']);

        const clique = (id) => {
            const e = new w.MouseEvent('click', { bubbles: true, cancelable: true });
            doc.getElementById(id).dispatchEvent(e);
            return e.defaultPrevented;
        };
        assert.equal(clique('link'), true, 'link "#" não navega');
        assert.equal(clique('p'), true);
        assert.equal(clique('r'), true, 'retorno false com -return cancela o padrão');
    });

    test('ações prontas: navegar, fechar aviso e abrir/fechar o pai', async () => {
        const { w, doc, navegacoes, tick } = montar(`<button id="nav" data-click="navigate" data-click-args='["/src/screens/login.html"]'>n</button>
            <div class="toast"><button id="fecha" data-click="dismissToast">x</button></div>
            <button id="solto" data-click="dismissToast">x</button>
            <div id="menu"><button id="abre" data-click="toggleParentOpen">m</button></div>`);
        doc.getElementById('nav').click();
        assert.ok(navegacoes.some((m) => /navigation/i.test(m)));

        const origST = w.setTimeout;
        const agendados = [];
        w.setTimeout = (fn, ms) => (ms === 400 ? agendados.push(fn) : origST(fn, ms));
        doc.getElementById('fecha').click();
        assert.ok(doc.querySelector('.toast').classList.contains('hide'));
        agendados.forEach((f) => f());
        assert.equal(doc.querySelector('.toast'), null);
        doc.getElementById('solto').click();
        w.setTimeout = origST;

        doc.getElementById('abre').click();
        assert.ok(doc.getElementById('menu').classList.contains('open'));
        doc.getElementById('abre').click();
        assert.equal(doc.getElementById('menu').classList.contains('open'), false);
        await tick();
    });

    test('elementos criados ou alterados depois também ganham a ação, sem duplicar', async () => {
        const { w, doc, tick } = montar('<div id="raiz"></div>');
        let n = 0;
        w.conta = () => n++;
        const btn = doc.createElement('button');
        btn.setAttribute('data-click', 'conta');
        doc.getElementById('raiz').appendChild(btn);
        await tick();
        btn.click();
        assert.equal(n, 1);

        const outro = doc.createElement('span');
        doc.body.appendChild(outro);
        await tick();
        outro.setAttribute('data-click', 'conta');
        await tick();
        outro.click();
        assert.equal(n, 2);

        w.bindActions(btn);
        w.bindActions(null);
        w.bindActions(doc.createTextNode('x'));
        btn.click();
        assert.equal(n, 3, 'religar não duplica o ouvinte');
    });

    test('printWhenLoaded imprime uma vez só, esteja a janela carregando ou já pronta', async () => {
        const { w, tick } = montar('');
        const janela = (estado) => {
            const ouvintes = [];
            const j = { impressoes: 0, focos: 0, document: { readyState: estado } };
            j.focus = () => j.focos++;
            j.print = () => j.impressoes++;
            j.addEventListener = (t, cb) => ouvintes.push(cb);
            j.carregar = () => ouvintes.forEach((cb) => cb());
            return j;
        };
        const carregando = janela('loading');
        w.printWhenLoaded(carregando);
        await tick();
        assert.equal(carregando.impressoes, 0);
        carregando.carregar();
        carregando.carregar();
        assert.deepEqual([carregando.impressoes, carregando.focos], [1, 1]);

        const pronta = janela('complete');
        w.printWhenLoaded(pronta);
        await tick();
        pronta.carregar();
        assert.equal(pronta.impressoes, 1);
    });

    test('dargs escapa os argumentos para uso seguro em atributo', () => {
        const { w } = montar('');
        assert.equal(w.dargs(`a"b`, "<x>'&`"), '[&quot;a\\&quot;b&quot;,&quot;&lt;x&gt;&#39;&amp;&#96;&quot;]');
    });
});

describe('theme.js — tema claro/escuro', () => {
    function tema({ salvo, quebrado = false } = {}) {
        const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
        const w = dom.window;
        if (quebrado) {
            Object.defineProperty(w, 'localStorage', {
                configurable: true,
                get() {
                    throw new Error('SecurityError: armazenamento bloqueado');
                },
            });
        } else if (salvo) w.localStorage.setItem('nexus-theme', salvo);
        vm.runInContext(fs.readFileSync(THEME, 'utf8'), dom.getInternalVMContext(), { filename: THEME });
        return w;
    }

    test('aplica o tema salvo e alterna gravando a escolha', () => {
        const w = tema({ salvo: 'dark' });
        assert.equal(w.NexusTheme.current(), 'dark');
        assert.equal(w.NexusTheme.toggle(), 'light');
        assert.equal(w.document.documentElement.hasAttribute('data-theme'), false);
        assert.equal(w.localStorage.getItem('nexus-theme'), 'light');
    });

    test('navegador que bloqueia o armazenamento (modo privado) usa o claro e ainda alterna', () => {
        const w = tema({ quebrado: true });
        assert.equal(w.NexusTheme.current(), 'light');
        assert.equal(w.NexusTheme.toggle(), 'dark');
        assert.equal(w.NexusTheme.current(), 'dark');
    });
});
