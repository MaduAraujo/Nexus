const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

before(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    global.window = dom.window;
    global.document = dom.window.document;
    global.DOMParser = dom.window.DOMParser;
    global.Node = dom.window.Node;
    require('../src/javascript/comunicado-format.js');
});

describe('sanitizeComunicadoHTML', () => {
    test('remove <script> inteiro, inclusive o conteúdo', () => {
        const out = global.window.sanitizeComunicadoHTML('<p>Aviso</p><script>alert(1)</script>');
        assert.ok(!out.includes('script'));
        assert.ok(!out.includes('alert'));
        assert.match(out, /Aviso/);
    });

    test('remove <img>, mesmo com onerror (não dá para vazar nem disparar handler)', () => {
        const out = global.window.sanitizeComunicadoHTML('<img src=x onerror="alert(1)">texto');
        assert.ok(!out.includes('<img'));
        assert.ok(!out.includes('onerror'));
        assert.match(out, /texto/);
    });

    test('remove iframe, object, embed e svg inteiros', () => {
        for (const tag of ['iframe', 'object', 'embed', 'svg']) {
            const out = global.window.sanitizeComunicadoHTML(`<${tag}>x</${tag}>`);
            assert.ok(!out.toLowerCase().includes(`<${tag}`), `${tag} não foi removido: ${out}`);
        }
    });

    test('desembrulha tags não permitidas mas preserva o texto (ex.: <table>, <span>)', () => {
        const out = global.window.sanitizeComunicadoHTML('<span onclick="hack()">oi</span>');
        assert.ok(!out.includes('span'));
        assert.ok(!out.includes('onclick'));
        assert.match(out, /oi/);
    });

    test('mantém <strong>, <ul>/<li>, <div>, <p> e <br> permitidos, sem atributos', () => {
        const out = global.window.sanitizeComunicadoHTML('<div class="x" style="color:red"><p onclick="y()">a</p><ul><li>b</li></ul><br></div>');
        assert.ok(!out.includes('class='));
        assert.ok(!out.includes('style='));
        assert.ok(!out.includes('onclick'));
        assert.match(out, /<div><p>a<\/p><ul><li>b<\/li><\/ul><br><\/div>/);
    });

    test('converte <b> em <strong>', () => {
        const out = global.window.sanitizeComunicadoHTML('<b>negrito</b>');
        assert.match(out, /<strong>negrito<\/strong>/);
        assert.ok(!out.includes('<b>'));
    });

    test('link http(s) legítimo vira target=_blank e rel=noopener noreferrer, sem outros atributos', () => {
        const out = global.window.sanitizeComunicadoHTML('<a href="https://exemplo.com" onclick="steal()" style="x">clique</a>');
        assert.match(out, /<a href="https:\/\/exemplo\.com" target="_blank" rel="noopener noreferrer">clique<\/a>/);
        assert.ok(!out.includes('onclick'));
    });

    test('link javascript: é desembrulhado (não vira <a>, só sobra o texto)', () => {
        const out = global.window.sanitizeComunicadoHTML('<a href="javascript:alert(1)">clique</a>');
        assert.ok(!out.includes('<a'));
        assert.ok(!out.includes('javascript:'));
        assert.match(out, /clique/);
    });

    test('link relativo/sem protocolo também é desembrulhado', () => {
        const out = global.window.sanitizeComunicadoHTML('<a href="/interno">clique</a>');
        assert.ok(!out.includes('<a'));
        assert.match(out, /clique/);
    });

    test('entrada vazia ou nula não quebra', () => {
        assert.equal(global.window.sanitizeComunicadoHTML(''), '');
        assert.equal(global.window.sanitizeComunicadoHTML(null), '');
        assert.equal(global.window.sanitizeComunicadoHTML(undefined), '');
    });
});

describe('comunicadoPlainText', () => {
    test('remove todas as tags e devolve só o texto', () => {
        const out = global.window.comunicadoPlainText('<div><p>Olá <strong>mundo</strong></p></div>');
        assert.equal(out, 'Olá mundo');
    });

    test('colapsa espaços/quebras de linha múltiplos em um único espaço e apara as pontas', () => {
        const out = global.window.comunicadoPlainText('<p>linha 1</p>\n\n<p>  linha   2  </p>');
        assert.equal(out, 'linha 1 linha 2');
    });

    test('script embutido não aparece no texto simples', () => {
        const out = global.window.comunicadoPlainText('<script>alert(1)</script>título');
        assert.equal(out, 'título');
    });

    test('entrada vazia ou nula não quebra', () => {
        assert.equal(global.window.comunicadoPlainText(''), '');
        assert.equal(global.window.comunicadoPlainText(null), '');
    });
});
