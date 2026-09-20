window.escapeHtml = function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);
};

const SANITIZE_DROP_WITH_CONTENT = new Set([
    'SCRIPT',
    'STYLE',
    'IFRAME',
    'OBJECT',
    'EMBED',
    'SVG',
    'MATH',
    'TEMPLATE',
    'LINK',
    'META',
    'FORM',
    'INPUT',
    'BUTTON',
    'TEXTAREA',
    'SELECT',
    'IMG',
    'VIDEO',
    'AUDIO',
    'SOURCE',
]);
const MARKDOWN_TAGS = new Set([
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'P',
    'BR',
    'HR',
    'UL',
    'OL',
    'LI',
    'STRONG',
    'B',
    'EM',
    'I',
    'DEL',
    'CODE',
    'PRE',
    'BLOCKQUOTE',
    'A',
    'TABLE',
    'THEAD',
    'TBODY',
    'TR',
    'TH',
    'TD',
]);

window.sanitizeHtml = function sanitizeHtml(html, allowedTags = MARKDOWN_TAGS) {
    const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
    (function clean(parent) {
        for (const node of Array.from(parent.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) continue;
            if (node.nodeType !== Node.ELEMENT_NODE) {
                node.remove();
                continue;
            }
            clean(node);
            const tag = node.tagName;
            if (SANITIZE_DROP_WITH_CONTENT.has(tag)) {
                node.remove();
                continue;
            }
            if (!allowedTags.has(tag)) {
                node.replaceWith(...node.childNodes);
                continue;
            }
            const href = tag === 'A' ? node.getAttribute('href') || '' : '';
            Array.from(node.attributes).forEach((attr) => node.removeAttribute(attr.name));
            if (tag === 'A') {
                if (!/^https?:\/\//i.test(href)) {
                    node.replaceWith(...node.childNodes);
                    continue;
                }
                node.setAttribute('href', href);
                node.setAttribute('target', '_blank');
                node.setAttribute('rel', 'noopener noreferrer');
            }
        }
    })(doc.body);
    return doc.body.innerHTML;
};

window.sanitizeMarkdownHtml = (html) => window.sanitizeHtml(html, MARKDOWN_TAGS);
