const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let window;
let document;

before(() => {
    const dom = new JSDOM('<!doctype html><body><p id="static" data-hide>oi</p></body>', { url: 'https://nexus.test/', runScripts: 'outside-only' });
    window = dom.window;
    document = window.document;
    const arquivo = require('path').join(__dirname, '../src/javascript/shared/dynamic-style.js');
    require('vm').runInContext(require('fs').readFileSync(arquivo, 'utf8'), dom.getInternalVMContext(), { filename: arquivo });
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

    test('avatar com iniciais brancas: o fundo escurece até 4.5:1 (WCAG AA); fundo sem texto fica igual', () => {
        const lum = (rgb) =>
            rgb
                .map((v) => v / 255)
                .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
                .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const contraBranco = (css) => 1.05 / (lum(css.match(/\d+/g).map(Number)) + 0.05);

        const avatar = render('<span style="color:#fff" data-bg="#f59e0b">AS</span>');
        assert.ok(contraBranco(avatar.style.background) >= 4.5, avatar.style.background);
        assert.equal(render('<span style="color:#fff" data-bg="#4f46e5">AS</span>').style.background, 'rgb(79, 70, 229)', 'já legível: não muda');
        assert.equal(render('<span data-bg="#f59e0b"></span>').style.background, 'rgb(245, 158, 11)', 'sem texto (barra, bolinha): não muda');
        assert.ok(contraBranco(window.nexusFundoLegivel('#10b981')) >= 4.5);
        assert.equal(window.nexusFundoLegivel('var(--accent)'), 'var(--accent)');
    });
});

describe('dynamic-style — contraste e entradas inválidas', () => {
    test('fundo escurece até o texto branco ficar legível (contraste 4,5); cor hexadecimal curta também vale', () => {
        const claro = render('<span data-bg="#ffd" style="color: rgb(255, 255, 255)">Novo</span>');
        assert.match(claro.style.background, /^rgb\(/);
        assert.notEqual(claro.style.background, 'rgb(255, 255, 221)');
        const escuro = render('<span data-bg="#123456" style="color: rgb(255, 255, 255)">Ok</span>');
        assert.match(escuro.style.background, /rgb\(18, 52, 86\)|#123456/);
    });

    test('texto escuro, texto sem cor definida ou elemento vazio mantêm o fundo pedido', () => {
        assert.match(render('<span data-bg="#ffd" style="color: rgb(20, 20, 20)">x</span>').style.background, /255, 255, 221|#ffd/);
        assert.match(render('<span data-bg="#ffd">sem cor</span>').style.background, /255, 255, 221|#ffd/);
        assert.match(render('<span data-bg="#ffd" style="color: rgb(255, 255, 255)">   </span>').style.background, /255, 255, 221|#ffd/);
    });

    test('ajuste de legibilidade não mexe em cores que não são hexadecimais', () => {
        assert.equal(window.nexusFundoLegivel('red'), 'red');
        assert.equal(window.nexusFundoLegivel(undefined), undefined);
        assert.match(render('<span data-bg="rgb(250, 250, 250)" style="color: rgb(255, 255, 255)">x</span>').style.background, /250, 250, 250/);
    });

    test('imagem de fundo só aceita https, blob ou imagem embutida; javascript: é ignorado', () => {
        assert.equal(render('<div data-bg-img="javascript:alert(1)"></div>').style.backgroundImage, '');
        assert.equal(render('<div data-bg-img="http://inseguro.test/a.png"></div>').style.backgroundImage, '');
        assert.match(render('<div data-bg-img="https://cdn.test/a.png"></div>').style.backgroundImage, /https:\/\/cdn\.test\/a\.png/);
    });
});

describe('dynamic-style — nós que não são elementos', () => {
    test('texto solto adicionado à página e chamadas sem nó são ignorados sem erro', async () => {
        document.body.appendChild(document.createTextNode('texto solto'));
        await new Promise((r) => setTimeout(r, 0));
        assert.doesNotThrow(() => window.applyDynamicStyles(null));
        assert.doesNotThrow(() => window.applyDynamicStyles(document.createTextNode('x')));
    });
});

describe('dynamic-style — fotos do bucket privado de avatares', () => {
    let pendentes;

    before(() => {
        pendentes = [];
        window.NexusAvatar = {
            caminho: (v) => (v.startsWith('avatars/') ? v.slice(8) : null),
            url: (v) =>
                new Promise((resolve) => {
                    pendentes.push({ v, resolve });
                }),
        };
    });

    const resolverTodos = async (url) => {
        pendentes.splice(0).forEach((p) => p.resolve(url === undefined ? `https://storage.test/sign/${p.v}` : url));
        await new Promise((r) => setTimeout(r, 0));
    };

    test('data-bg-img com referência de avatar usa o link assinado, não a referência', async () => {
        const el = render('<div data-bg-img="avatars/e1?v=1"></div>');
        assert.equal(el.style.backgroundImage, '');
        await resolverTodos();
        assert.match(el.style.backgroundImage, /https:\/\/storage\.test\/sign\/avatars\/e1\?v=1/);
        assert.equal(el.style.backgroundSize, 'cover');
    });

    test('data-src põe o link assinado na imagem; endereço https comum passa direto; javascript: é ignorado', async () => {
        const img = render('<img data-src="avatars/e2?v=1">');
        await resolverTodos();
        assert.equal(img.src, 'https://storage.test/sign/avatars/e2?v=1');
        assert.equal(render('<img data-src="https://cdn.test/a.png">').src, 'https://cdn.test/a.png');
        assert.equal(render('<img data-src="javascript:alert(1)">').getAttribute('src'), null);
    });

    test('se a foto mudou antes do link chegar, o link antigo não é aplicado', async () => {
        const el = render('<div data-bg-img="avatars/velha"></div>');
        el.setAttribute('data-bg-img', 'https://cdn.test/nova.png');
        await new Promise((r) => setTimeout(r, 0));
        await resolverTodos();
        assert.match(el.style.backgroundImage, /nova\.png/);
        assert.doesNotMatch(el.style.backgroundImage, /velha/);
    });

    test('sem link assinado (acesso negado ou falha), nada é aplicado', async () => {
        const el = render('<div data-bg-img="avatars/sem-acesso"></div>');
        await resolverTodos(null);
        assert.equal(el.style.backgroundImage, '');
    });
});
