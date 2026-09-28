const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ARQUIVO = path.join(__dirname, '../src/javascript/shared/html.js');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
vm.runInContext(fs.readFileSync(ARQUIVO, 'utf8'), dom.getInternalVMContext(), { filename: ARQUIVO });
const { sanitizeHtml, sanitizeMarkdownHtml, escapeHtml, safeHttpUrl } = dom.window;

describe('sanitizeMarkdownHtml — resposta da IA renderizada como HTML', () => {
    test('mantém a formatação permitida e tira todos os atributos', () => {
        assert.equal(
            sanitizeMarkdownHtml('<h2 id="x" style="color:red">Resumo</h2><p class="a" onclick="roubar()"><strong>2</strong> alertas</p>'),
            '<h2>Resumo</h2><p><strong>2</strong> alertas</p>'
        );
        assert.equal(
            sanitizeMarkdownHtml('<table><thead><tr><th>Nome</th></tr></thead><tbody><tr><td>Ana</td></tr></tbody></table>'),
            '<table><thead><tr><th>Nome</th></tr></thead><tbody><tr><td>Ana</td></tr></tbody></table>'
        );
    });

    test('script, estilo, iframe, imagem, svg e formulário somem junto com o conteúdo', () => {
        const ataques = [
            '<script>alert(1)</script>',
            '<style>body{display:none}</style>',
            '<iframe src="https://mal.example"></iframe>',
            '<img src=x onerror="alert(1)">',
            '<svg onload="alert(1)"><circle/></svg>',
            '<math><mi>x</mi></math>',
            '<form action="https://mal.example"><input name="senha"><button>Enviar</button></form>',
            '<object data="x"></object><embed src="x">',
            '<template><p>oculto</p></template>',
            '<video src="x"></video><audio src="x"></audio>',
        ];
        for (const a of ataques) assert.equal(sanitizeMarkdownHtml(`<p>ok</p>${a}`), '<p>ok</p>', a);
    });

    test('svg e math somem com o conteúdo mesmo com tags em minúsculas (namespace estrangeiro)', () => {
        assert.equal(sanitizeMarkdownHtml('<p>ok</p><svg><text>vazou</text><a href="https://x.com">l</a></svg>'), '<p>ok</p>');
        assert.equal(sanitizeMarkdownHtml('<p>ok</p><math><mtext><style>vazou</style></mtext></math>'), '<p>ok</p>');
    });

    test('tag fora da lista é desembrulhada: o texto fica, a tag e os atributos saem', () => {
        assert.equal(sanitizeMarkdownHtml('<div onmouseover="x()"><span style="x">texto</span> <u>sub</u></div>'), 'texto sub');
        assert.equal(sanitizeMarkdownHtml('<p><span><script>x()</script>ok</span></p>'), '<p>ok</p>', 'script dentro de tag desembrulhada também some');
    });

    test('comentários HTML são removidos (não servem de esconderijo)', () => {
        assert.equal(sanitizeMarkdownHtml('<p>a<!-- <script>x()</script> -->b</p>'), '<p>ab</p>');
    });

    test('links http(s) abrem em nova aba sem dar acesso à página de origem', () => {
        assert.equal(
            sanitizeMarkdownHtml('<a href="https://www.gov.br/trabalho" title="t" onclick="x()">CLT</a>'),
            '<a href="https://www.gov.br/trabalho" target="_blank" rel="noopener noreferrer">CLT</a>'
        );
        assert.match(sanitizeMarkdownHtml('<a href="HTTP://exemplo.com">x</a>'), /href="HTTP:\/\/exemplo\.com"/);
    });

    test('link javascript:, data:, relativo ou sem href vira texto', () => {
        for (const href of [
            'javascript:alert(1)',
            ' javascript:alert(1)',
            'JaVaScRiPt:alert(1)',
            'data:text/html,<script>x</script>',
            '/src/screens/login.html',
            '//mal.example',
        ]) {
            assert.equal(sanitizeMarkdownHtml(`<a href="${href}">clique</a>`), 'clique', href);
        }
        assert.equal(sanitizeMarkdownHtml('<a>sem destino</a>'), 'sem destino');
    });

    test('entrada vazia, nula ou não-texto não quebra', () => {
        assert.equal(sanitizeMarkdownHtml(null), '');
        assert.equal(sanitizeMarkdownHtml(undefined), '');
        assert.equal(sanitizeMarkdownHtml(42), '42');
        assert.equal(sanitizeMarkdownHtml('texto &lt;puro&gt;'), 'texto &lt;puro&gt;');
    });

    test('lista de tags customizada restringe mais', () => {
        const soNegrito = new dom.window.Set(['STRONG']);
        assert.equal(sanitizeHtml('<h1>T</h1><strong>n</strong><a href="https://x.com">l</a>', soNegrito), 'T<strong>n</strong>l');
    });
});

describe('escapeHtml e safeHttpUrl', () => {
    test('escapeHtml escapa os 6 caracteres perigosos e trata nulo', () => {
        assert.equal(escapeHtml(`<a href="x" onclick='y'>&\`</a>`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;');
        assert.equal(escapeHtml(null), '');
        assert.equal(escapeHtml(0), '0');
    });

    test('safeHttpUrl só aceita http(s) sem espaços', () => {
        assert.equal(safeHttpUrl('  https://exemplo.com/a?b=1  '), 'https://exemplo.com/a?b=1');
        for (const u of ['javascript:alert(1)', 'https://a b.com', 'ftp://x', '', null]) assert.equal(safeHttpUrl(u), '', String(u));
    });
});
