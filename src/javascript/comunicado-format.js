/* comunicado-format.js — sanitização compartilhada do conteúdo formatado dos comunicados
   Usado tanto pelo editor do RH (comunicação.js) quanto pela leitura do colaborador
   (comunicados-colaborador.js), para que a mesma whitelist valha nos dois lados. */
(function () {
    const ALLOWED_TAGS = new Set(['STRONG', 'B', 'UL', 'LI', 'A', 'BR', 'DIV', 'P']);
    const BLOCKED_REMOVE_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG']);

    function unwrap(node) {
        const parent = node.parentNode;
        if (!parent) return;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
    }

    function stripAllAttributes(node) {
        Array.from(node.attributes).forEach(a => node.removeAttribute(a.name));
    }

    function cleanNode(node) {
        Array.from(node.childNodes).forEach(cleanNode);
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName;

        if (BLOCKED_REMOVE_TAGS.has(tag)) { node.remove(); return; }
        if (!ALLOWED_TAGS.has(tag)) { unwrap(node); return; }

        if (tag === 'A') {
            const href = node.getAttribute('href') || '';
            stripAllAttributes(node);
            if (/^https?:\/\//i.test(href)) {
                node.setAttribute('href', href);
                node.setAttribute('target', '_blank');
                node.setAttribute('rel', 'noopener noreferrer');
            } else {
                unwrap(node);
            }
            return;
        }

        if (tag === 'B') {
            const strong = document.createElement('strong');
            strong.innerHTML = node.innerHTML;
            node.replaceWith(strong);
            return;
        }

        stripAllAttributes(node);
    }

    window.sanitizeComunicadoHTML = function (html) {
        const container = document.createElement('div');
        container.innerHTML = String(html || '');
        Array.from(container.childNodes).forEach(cleanNode);
        return container.innerHTML;
    };

    window.comunicadoPlainText = function (html) {
        const container = document.createElement('div');
        container.innerHTML = String(html || '');
        return (container.textContent || '').replace(/\s+/g, ' ').trim();
    };
})();
