(function () {
    'use strict';

    const COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%]+\)|var\(--[\w-]+\)|[a-z]+)$/i;
    const NUMBER = /^-?\d+(\.\d+)?$/;
    const SAFE_URL = /^(https:\/\/|blob:|data:image\/(png|jpeg|gif|webp);base64,)/i;

    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const cssString = (value) => `"${value.replace(/["\\\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

    const RULES = {
        'data-bg': (el, v) => COLOR.test(v) && (el.style.background = v),
        'data-color': (el, v) => COLOR.test(v) && (el.style.color = v),
        'data-w': (el, v) => NUMBER.test(v) && (el.style.width = `${clamp(Number(v), 0, 100)}%`),
        'data-x': (el, v) => NUMBER.test(v) && (el.style.left = `${Number(v)}px`),
        'data-y': (el, v) => NUMBER.test(v) && (el.style.top = `${Number(v)}px`),
        'data-delay': (el, v) => NUMBER.test(v) && (el.style.animationDelay = `${clamp(Number(v), 0, 10)}s`),
        'data-bg-img': (el, v) => {
            if (!SAFE_URL.test(v)) return;
            el.style.backgroundImage = `url(${cssString(v)})`;
            el.style.backgroundPosition = 'center';
            el.style.backgroundSize = 'cover';
        },
        'data-hide': (el) => {
            el.style.display = 'none';
            el.removeAttribute('data-hide');
        },
    };
    const ATTRS = Object.keys(RULES);
    const SELECTOR = ATTRS.map((a) => `[${a}]`).join(',');

    function applyElement(el) {
        for (const attr of ATTRS) {
            const value = el.getAttribute(attr);
            if (value !== null) RULES[attr](el, value.trim());
        }
    }

    function applyTree(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.matches(SELECTOR)) applyElement(root);
        root.querySelectorAll(SELECTOR).forEach(applyElement);
    }

    window.applyDynamicStyles = applyTree;

    applyTree(document.documentElement);
    document.addEventListener('DOMContentLoaded', () => applyTree(document.documentElement));
    new MutationObserver((records) => {
        for (const record of records) {
            if (record.type === 'attributes') applyTree(record.target);
            else record.addedNodes.forEach(applyTree);
        }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRS });
})();
