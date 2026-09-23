const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let window;
let document;

before(() => {
    const dom = new JSDOM('<!doctype html><body><p id="static" data-hide>oi</p></body>', { url: 'https://nexus.test/', runScripts: 'outside-only' });
    window = dom.window;
    document = window.document;
    window.eval(require('fs').readFileSync(require('path').join(__dirname, '../src/javascript/shared/dynamic-style.js'), 'utf8'));
});

function render(html) {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    window.applyDynamicStyles(host);
    return host.firstElementChild;
}

describe('dynamic-style', () => {
    test('data-hide já presente no HTML vira display:none inline e sai do elemento', () => {
        const el = document.getElementById('static');
        assert.equal(el.style.display, 'none');
        assert.equal(el.hasAttribute('data-hide'), false);
    });

    test('mostrar com style.display = "" continua funcionando depois do data-hide', () => {
        const el = render('<div data-hide>x</div>');
        el.style.display = '';
        assert.equal(window.getComputedStyle(el).display, 'block');
    });

    test('cores: hex, rgb, var(--x) e nome passam; qualquer outra coisa é ignorada', () => {
        assert.equal(render('<span data-bg="#6366f1"></span>').style.background, 'rgb(99, 102, 241)');
        assert.match(render('<span data-color="var(--accent)"></span>').style.color, /var\(--accent\)/);
        assert.equal(render('<span data-bg="url(https://evil.test/x.png)"></span>').style.background, '');
        assert.equal(render('<span data-bg="red;position:fixed"></span>').style.cssText, '');
    });

    test('largura em % é limitada entre 0 e 100', () => {
        assert.equal(render('<i data-w="42.5"></i>').style.width, '42.5%');
        assert.equal(render('<i data-w="250"></i>').style.width, '100%');
        assert.equal(render('<i data-w="10px"></i>').style.width, '');
    });

    test('posição e atraso de animação só aceitam número', () => {
        const el = render('<i data-x="-12.5" data-y="30" data-delay="0.12"></i>');
        assert.equal(el.style.left, '-12.5px');
        assert.equal(el.style.top, '30px');
        assert.equal(el.style.animationDelay, '0.12s');
        assert.equal(render('<i data-x="1;color:red"></i>').style.cssText, '');
    });

    test('imagem de fundo só de https, blob ou data:image; aspas no endereço não escapam do url()', () => {
        const ok = render('<i data-bg-img="https://cdn.test/a.png"></i>');
        assert.match(ok.style.backgroundImage, /https:\/\/cdn\.test\/a\.png/);
        assert.equal(ok.style.backgroundSize, 'cover');
        assert.equal(render('<i data-bg-img="javascript:alert(1)"></i>').style.backgroundImage, '');
        assert.equal(render('<i data-bg-img="http://inseguro.test/a.png"></i>').style.backgroundImage, '');
        const tricky = render('<i data-bg-img=\'https://cdn.test/a.png"), url("https://evil.test/b.png\'></i>');
        assert.doesNotMatch(tricky.style.backgroundImage, /url\("https:\/\/evil/);
    });

    test('HTML inserido depois (innerHTML) é aplicado pelo MutationObserver', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        host.innerHTML = '<b data-color="#ff0000">x</b>';
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(host.firstElementChild.style.color, 'rgb(255, 0, 0)');
    });
});
