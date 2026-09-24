const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const JS_DIR = path.join(__dirname, '..', 'src', 'javascript');

function findBuilderCatches(source) {
    const ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'script', locations: true, allowAwaitOutsideFunction: true });
    const found = [];
    const rootsInSb = (node) => {
        for (let n = node; n;) {
            if (n.type === 'CallExpression') {
                const c = n.callee;
                if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'sb' && ['from', 'rpc'].includes(c.property.name))
                    return true;
                n = c.type === 'MemberExpression' ? c.object : null;
            } else if (n.type === 'MemberExpression') n = n.object;
            else return false;
        }
        return false;
    };
    (function walk(n) {
        if (!n || typeof n.type !== 'string') return;
        if (
            n.type === 'CallExpression' &&
            n.callee.type === 'MemberExpression' &&
            ['catch', 'finally'].includes(n.callee.property.name) &&
            rootsInSb(n.callee.object)
        )
            found.push(n.loc.start.line);
        for (const k in n) {
            const v = n[k];
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v.type === 'string') walk(v);
        }
    })(ast);
    return found;
}

describe('builder do Supabase não tem .catch/.finally', () => {
    test('nenhum arquivo do front encadeia .catch/.finally direto em sb.from(...)/sb.rpc(...)', () => {
        const files = [...fs.readdirSync(JS_DIR), ...fs.readdirSync(path.join(JS_DIR, 'shared')).map((f) => path.join('shared', f))].filter((f) =>
            f.endsWith('.js')
        );
        const problemas = [];
        for (const f of files) for (const line of findBuilderCatches(fs.readFileSync(path.join(JS_DIR, f), 'utf8'))) problemas.push(`${f}:${line}`);
        assert.deepEqual(problemas, [], `Use Promise.resolve(sb.rpc(...)).catch(...):\n${problemas.join('\n')}`);
    });

    test('o guarda detecta o padrão, inclusive quebrado em várias linhas', () => {
        assert.deepEqual(findBuilderCatches("sb.rpc('x').catch(() => {});"), [1]);
        assert.deepEqual(findBuilderCatches("await sb\n  .from('t')\n  .insert({})\n  .finally(() => {});"), [1]);
        assert.deepEqual(findBuilderCatches("Promise.resolve(sb.rpc('x')).catch(() => {});"), []);
        assert.deepEqual(findBuilderCatches('NexusE2E.status().catch(() => null);'), []);
    });
});
