const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { scanSource, applyEdits } = require('../test-support/xss-scan.js');

const JS_DIR = path.join(__dirname, '..', 'src', 'javascript');

describe('XSS: texto de usuário em HTML precisa passar por escapeHtml', () => {
    test('nenhum arquivo do front-end interpola nome, mensagem, título etc. em HTML sem escapar', () => {
        const problemas = [];
        const arquivos = [...fs.readdirSync(JS_DIR), ...fs.readdirSync(path.join(JS_DIR, 'shared')).map((f) => path.join('shared', f))].filter(
            (f) => f.endsWith('.js') && !f.endsWith('.example.js')
        );
        for (const file of arquivos) {
            const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8').replace(/\r\n/g, '\n');
            for (const f of scanSource(source, file).findings) problemas.push(`${f.file}:${f.line}  ${f.code}  (${f.kind})`);
        }
        assert.deepEqual(
            problemas,
            [],
            `Interpolações sem escapeHtml:\n${problemas.join('\n')}\nUse escapeHtml(...) (src/javascript/shared/html.js) ou, se for justificado, comente // xss-ok na linha.`
        );
    });

    test('o guarda de fato detecta os padrões perigosos (senão o teste acima não provaria nada)', () => {
        const perigosos = [
            'el.innerHTML = `<b>${user.name}</b>`;',
            'el.innerHTML = `<p title="${d.name}">x</p>`;',
            "el.innerHTML = '<div>' + doc.mensagem + '</div>';",
            'const nome = emp.name; el.innerHTML = `<td>${nome}</td>`;',
            'el.innerHTML = `<td>${emp.name || "—"}</td>`;',
            'el.innerHTML = cond ? `<i>${a.title}</i>` : `<i>${b.title}</i>`;',
            'el.innerHTML = msg.content;',
            'const html = `<li>${(x.label ?? "-")}</li>`;',
            'el.innerHTML = `<div>${String(row.bio)}</div>`;',
            'el.innerHTML = `<div>${f.filename.toLowerCase()}</div>`;',
        ];
        for (const code of perigosos) {
            assert.ok(scanSource(code).findings.length > 0, `não detectou: ${code}`);
        }
    });

    test('não acusa o que é seguro', () => {
        const seguros = [
            'el.innerHTML = `<b>${escapeHtml(user.name)}</b>`;',
            'el.innerHTML = `<b>${esc(user.name)}</b>`;',
            'el.innerHTML = `<td>${emp.id}</td><td>${count}</td><td>${total.toFixed(2)}</td>`;',
            'el.innerHTML = `<div class="${cls}">${badgeHtml}</div>`;',
            'el.innerHTML = rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td></tr>`).join("");',
            "el.innerHTML = '';",
            "btn.innerHTML = cond ? 'Agendar' : 'Enviar';",
            'el.textContent = `${user.name}`;',
            'el.innerHTML = `<td>${user.name}</td>`; // xss-ok texto vem de constante interna',
            'console.log(`${user.name} entrou`);',
        ];
        for (const code of seguros) {
            assert.deepEqual(scanSource(code).findings, [], `falso positivo: ${code}`);
        }
    });

    test('a correção automática escapa sem quebrar a expressão original', () => {
        const source = 'el.innerHTML = `<td>${emp.name || "—"}</td><td title="${d.name}">${a ? b.title : "x"}</td>`;';
        const fixed = applyEdits(source, scanSource(source).edits);
        assert.ok(fixed.includes('escapeHtml(emp.name)') || fixed.includes('escapeHtml(emp.name || "—")'));
        assert.ok(fixed.includes('escapeHtml(d.name)'));
        assert.ok(fixed.includes('escapeHtml(b.title)'));
        assert.deepEqual(scanSource(fixed).findings, []);
    });
});
