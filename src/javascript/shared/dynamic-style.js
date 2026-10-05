(function () {
    'use strict';

    const COLOR = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%]+\)|var\(--[\w-]+\)|[a-z]+)$/i;
    const NUMBER = /^-?\d+(\.\d+)?$/;
    const SAFE_URL = /^(https:\/\/|blob:|data:image\/(png|jpeg|gif|webp);base64,)/i;

    const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
    const cssString = (value) => `"${value.replace(/["\\\n\r]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;

    const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
    const canais = (hex) => {
        const h = hex.slice(1);
        const full = h.length === 3 ? h.replace(/./g, '$&$&') : h;
        return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    };
    const luminancia = (c) =>
        c
            .map((v) => v / 255)
            .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contraste = (a, b) => {
        const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
        return (x + 0.05) / (y + 0.05);
    };

    function textoClaro(el) {
        if (!el.textContent.trim()) return false;
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(el).color);
        return !!m && luminancia([+m[1], +m[2], +m[3]]) > 0.6;
    }

    function fundoParaTextoBranco(hex) {
        if (!HEX.test(hex || '')) return hex;
        let c = canais(hex);
        for (let i = 0; i < 40 && contraste(c, [255, 255, 255]) < 4.5; i++) c = c.map((v) => v * 0.93);
        return `rgb(${c.map(Math.round).join(', ')})`;
    }

    function fundoLegivel(el, hex) {
        return textoClaro(el) ? fundoParaTextoBranco(hex) : hex;
    }

    window.nexusFundoLegivel = fundoParaTextoBranco;

    function comImagem(el, attr, v, aplicar) {
        if (window.NexusAvatar?.caminho(v)) {
            window.NexusAvatar.url(v).then((url) => {
                if (url && el.getAttribute(attr)?.trim() === v) aplicar(url);
            });
            return;
        }
        if (SAFE_URL.test(v)) aplicar(v);
    }

    const RULES = {
        'data-bg': (el, v) => COLOR.test(v) && (el.style.background = fundoLegivel(el, v)),
        'data-color': (el, v) => COLOR.test(v) && (el.style.color = v),
        'data-w': (el, v) => NUMBER.test(v) && (el.style.width = `${clamp(Number(v), 0, 100)}%`),
        'data-x': (el, v) => NUMBER.test(v) && (el.style.left = `${Number(v)}px`),
        'data-y': (el, v) => NUMBER.test(v) && (el.style.top = `${Number(v)}px`),
        'data-delay': (el, v) => NUMBER.test(v) && (el.style.animationDelay = `${clamp(Number(v), 0, 10)}s`),
        'data-bg-img': (el, v) =>
            comImagem(el, 'data-bg-img', v, (url) => {
                el.style.backgroundImage = `url(${cssString(url)})`;
                el.style.backgroundPosition = 'center';
                el.style.backgroundSize = 'cover';
            }),
        'data-src': (el, v) =>
            comImagem(el, 'data-src', v, (url) => {
                el.src = url;
            }),
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
