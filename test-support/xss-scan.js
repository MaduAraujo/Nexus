const acorn = require('acorn');

const TEXT_FIELDS = new Set([
    'name',
    'nome',
    'full_name',
    'fullName',
    'title',
    'titulo',
    'message',
    'mensagem',
    'msg',
    'content',
    'conteudo',
    'subject',
    'assunto',
    'bio',
    'description',
    'descricao',
    'desc',
    'justificativa',
    'motivo',
    'reason',
    'comment',
    'comentario',
    'observacao',
    'observacoes',
    'obs',
    'notes',
    'note',
    'text',
    'texto',
    'label',
    'dept',
    'department',
    'role',
    'cargo',
    'email',
    'telefone',
    'phone',
    'endereco',
    'address',
    'bairro',
    'cidade',
    'city',
    'logradouro',
    'filename',
    'fileName',
    'file_name',
    'banco',
    'agencia',
    'conta',
    'chave_pix',
    'cpf',
    'rg',
    'tipo',
    'categoria',
    'category',
    'requester',
    'author',
    'autor',
    'preview',
    'snippet',
    'body',
    'corpo',
    'reply',
    'response',
    'resposta',
    'pergunta',
    'question',
    'answer',
    'seguradora',
    'deficiencia',
    'tipo_pensao',
    'destinatario',
    'remetente',
    'employeeName',
    'empName',
    'deptName',
    'displayName',
    'contract_type',
    'work_load',
    'competencia',
    'assinado_por',
    'document_name',
    'actor_name',
    'operator_name',
    'accessed_by_name',
    'oldValue',
    'newValue',
    'sugestao',
    'referencia',
    'storage_path',
    'avatar_url',
    'avatarUrl',
    'detalhe',
]);

const TEXT_IDENTIFIERS = new Set(['name', 'nome', 'title', 'titulo', 'msg', 'message', 'subject', 'assunto', 'detalhe', 'empName', 'empDept']);

const ESCAPERS = new Set(['esc', 'escHtml', 'escapeHtml', 'escapeHTML', 'escapeText', 'escAttr', 'encodeURIComponent', 'stringify']);
const STRING_METHODS = new Set(['toUpperCase', 'toLowerCase', 'trim', 'slice', 'substring', 'substr', 'toString', 'normalize', 'padStart', 'padEnd']);
const FRAGMENT_METHODS = new Set(['join', 'map', 'reduce', 'filter', 'concat', 'flat', 'flatMap']);

function unwrap(node) {
    while (node && (node.type === 'ChainExpression' || node.type === 'ParenthesizedExpression' || node.type === 'AwaitExpression')) {
        node = node.expression || node.argument;
    }
    return node;
}

function calleeName(call) {
    const c = unwrap(call.callee);
    if (!c) return '';
    if (c.type === 'Identifier') return c.name;
    if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') return c.property.name;
    return '';
}

function collectTaintedIdentifiers(ast) {
    const tainted = new Set(TEXT_IDENTIFIERS);
    const isTextSource = (init) => {
        const n = unwrap(init);
        if (!n) return false;
        if (n.type === 'MemberExpression') return !n.computed && n.property.type === 'Identifier' && TEXT_FIELDS.has(n.property.name);
        if (n.type === 'LogicalExpression') return isTextSource(n.left) || isTextSource(n.right);
        if (n.type === 'ConditionalExpression') return isTextSource(n.consequent) || isTextSource(n.alternate);
        if (n.type === 'CallExpression')
            return ['String'].includes(calleeName(n)) ? n.arguments.some(isTextSource) : STRING_METHODS.has(calleeName(n)) && isTextSource(n.callee.object);
        return false;
    };
    (function walk(node) {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'VariableDeclarator') {
            if (node.id.type === 'Identifier' && isTextSource(node.init)) tainted.add(node.id.name);
            if (node.id.type === 'ObjectPattern') {
                for (const p of node.id.properties) {
                    if (p.type === 'Property' && p.key.type === 'Identifier' && TEXT_FIELDS.has(p.key.name) && p.value.type === 'Identifier')
                        tainted.add(p.value.name);
                }
            }
        }
        for (const key of Object.keys(node)) {
            const v = node[key];
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v.type === 'string') walk(v);
        }
    })(ast);
    return tainted;
}

const hasHtml = (tpl) => tpl.quasis.some((q) => /<[a-zA-Z/!]/.test(q.value.raw));

function scanSource(source, filename = '') {
    const comments = [];
    const ast = acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowAwaitOutsideFunction: true,
        allowReturnOutsideFunction: true,
        locations: true,
        onComment: comments,
    });
    const tainted = collectTaintedIdentifiers(ast);
    const lines = source.split('\n');
    const edits = [];
    const findings = [];

    const isText = (node) => {
        const n = unwrap(node);
        if (!n) return false;
        if (n.type === 'MemberExpression') return !n.computed && n.property.type === 'Identifier' && TEXT_FIELDS.has(n.property.name);
        if (n.type === 'Identifier') return tainted.has(n.name);
        if (n.type === 'Literal') return typeof n.value === 'string' && !/[<&]/.test(n.value);
        if (n.type === 'LogicalExpression') return isText(n.left) && isText(n.right);
        if (n.type === 'ConditionalExpression') return isText(n.consequent) && isText(n.alternate);
        if (n.type === 'CallExpression') {
            const name = calleeName(n);
            if (name === 'String') return n.arguments.length > 0 && isText(n.arguments[0]);
            return STRING_METHODS.has(name) && isText(n.callee.object || unwrap(n.callee).object);
        }
        return false;
    };

    function record(expr, prevQuasi) {
        const line = expr.loc.start.line;
        if (/xss-ok/.test(lines[line - 1] || '')) return;
        const before = prevQuasi ? prevQuasi.value.raw : '';
        const inHandler = /\bon[a-z]+\s*=\s*"[^"]*$/i.test(before) || /\bon[a-z]+\s*=\s*'[^']*$/i.test(before);
        const inUrl = /\b(href|src|action|formaction)\s*=\s*["']?[^"'>]*$/i.test(before);
        findings.push({
            file: filename,
            line,
            code: source.slice(expr.start, expr.end).slice(0, 90),
            kind: inHandler ? 'inline-handler' : inUrl ? 'url-attr' : 'html',
        });
        if (!inHandler) edits.push({ start: expr.start, end: expr.end, text: `escapeHtml(${source.slice(expr.start, expr.end)})` });
    }

    function handle(expr, prevQuasi) {
        const n = unwrap(expr);
        if (!n) return;
        switch (n.type) {
            case 'Literal':
                return;
            case 'TemplateLiteral':
                n.expressions.forEach((e, i) => handle(e, n.quasis[i]));
                return;
            case 'ConditionalExpression':
                handle(n.consequent, prevQuasi);
                handle(n.alternate, prevQuasi);
                return;
            case 'LogicalExpression':
                if (n.operator === '??' && isText(n)) return record(expr, prevQuasi);
                if (n.operator !== '&&') handle(n.left, prevQuasi);
                handle(n.right, prevQuasi);
                return;
            case 'BinaryExpression':
                if (n.operator === '+') {
                    handle(n.left, prevQuasi);
                    handle(n.right, prevQuasi);
                }
                return;
            case 'CallExpression': {
                const name = calleeName(n);
                if (ESCAPERS.has(name) || /(Html|HTML|Markup|Fragment)$/.test(name)) return;
                const c = unwrap(n.callee);
                if (FRAGMENT_METHODS.has(name)) return;
                if (name === 'String') return n.arguments.length && isText(n.arguments[0]) ? record(expr, prevQuasi) : undefined;
                if (c && c.type === 'MemberExpression' && STRING_METHODS.has(name) && isText(c.object)) return record(expr, prevQuasi);
                if (name === 'replace' && c && c.type === 'MemberExpression' && isText(c.object)) return record(expr, prevQuasi);
                return;
            }
            case 'MemberExpression':
            case 'Identifier':
                if (isText(n)) record(expr, prevQuasi);
                return;
            default:
        }
    }

    const flattenConcat = (n, out = []) => {
        const u = unwrap(n);
        if (u && u.type === 'BinaryExpression' && u.operator === '+') {
            flattenConcat(u.left, out);
            flattenConcat(u.right, out);
        } else out.push(n);
        return out;
    };
    const onlyLiterals = (node) => {
        const n = unwrap(node);
        if (!n) return true;
        if (n.type === 'Literal') return true;
        if (n.type === 'ConditionalExpression') return onlyLiterals(n.consequent) && onlyLiterals(n.alternate);
        if (n.type === 'LogicalExpression') return onlyLiterals(n.left) && onlyLiterals(n.right);
        return false;
    };
    const htmlSinkProp = (member) =>
        member && member.type === 'MemberExpression' && !member.computed && ['innerHTML', 'outerHTML'].includes(member.property.name);

    (function walk(node, parent) {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'TemplateLiteral' && hasHtml(node)) {
            node.expressions.forEach((e, i) => handle(e, node.quasis[i]));
        }
        if (node.type === 'BinaryExpression' && node.operator === '+' && !(parent && parent.type === 'BinaryExpression' && parent.operator === '+')) {
            const parts = flattenConcat(node);
            const literalHtml = parts.some((p) => p.type === 'Literal' && typeof p.value === 'string' && /<[a-zA-Z/!]/.test(p.value));
            if (literalHtml)
                parts.forEach((p, i) => handle(p, i > 0 && parts[i - 1].type === 'Literal' ? { value: { raw: String(parts[i - 1].value) } } : null));
        }
        if (node.type === 'AssignmentExpression' && htmlSinkProp(node.left) && isText(node.right) && !onlyLiterals(node.right)) record(node.right, null);
        if (
            node.type === 'CallExpression' &&
            calleeName(node) === 'insertAdjacentHTML' &&
            node.arguments[1] &&
            isText(node.arguments[1]) &&
            !onlyLiterals(node.arguments[1])
        )
            record(node.arguments[1], null);
        for (const key of Object.keys(node)) {
            const v = node[key];
            if (Array.isArray(v)) v.forEach((c) => walk(c, node));
            else if (v && typeof v.type === 'string') walk(v, node);
        }
    })(ast, null);

    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept = [];
    for (const e of edits) if (!kept.length || e.start >= kept[kept.length - 1].end) kept.push(e);
    return { findings, edits: kept };
}

function applyEdits(source, edits) {
    let out = source;
    for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return out;
}

module.exports = { scanSource, applyEdits };