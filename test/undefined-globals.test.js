const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { findUndefined, screens } = require('../test-support/undefined-globals');

test('nenhuma tela usa identificador que nenhum dos seus scripts declara', () => {
    const problemas = [...new Set(screens().flatMap(findUndefined))];
    assert.deepEqual(problemas, []);
});

test('o verificador detecta variável solta e aceita globais de outro script da mesma página', () => {
    fs.mkdirSync(path.join(__dirname, '..', 'test-results'), { recursive: true });
    const dir = fs.mkdtempSync(path.join(__dirname, '..', 'test-results', 'undef-'));
    after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'a.js'), 'window.fromA = 1; function helper() {}');
    fs.writeFileSync(path.join(dir, 'b.js'), 'helper(); fromA; naoExiste.id;');
    fs.writeFileSync(path.join(dir, 'p.html'), '<script src="https://cdn.x/lib.js"></script><script src="a.js"></script><script src="b.js"></script>');
    const problemas = findUndefined(path.join(dir, 'p.html'));
    assert.equal(problemas.length, 1);
    assert.match(problemas[0], /b\.js:1 'naoExiste' is not defined/);
});
