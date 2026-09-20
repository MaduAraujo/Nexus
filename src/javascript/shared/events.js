(function () {
    'use strict';

    const EVENTS = ['click', 'change', 'input', 'keydown', 'keyup'];
    const SELECTOR = EVENTS.map((type) => `[data-${type}]`).join(',');
    const ACTION_NAME = /^[A-Za-z_$][\w$]*$/;
    const NATIVE_CODE = /\{\s*\[native code\]\s*\}\s*$/;

    const BUILTINS = {
        noop() {},
        navigate(url) {
            window.location.href = url;
        },
        dismissToast() {
            const toast = this.closest('.toast');
            if (!toast) return;
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 400);
        },
        toggleParentOpen() {
            this.parentElement?.classList.toggle('open');
        },
    };

    const escapeAttr = (value) =>
        String(value).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);

    window.dargs = function dargs(...values) {
        return escapeAttr(JSON.stringify(values));
    };

    function resolveAction(name) {
        if (Object.prototype.hasOwnProperty.call(BUILTINS, name)) return BUILTINS[name];
        if (!ACTION_NAME.test(name) || !Object.prototype.hasOwnProperty.call(window, name)) return null;
        const fn = window[name];
        if (typeof fn !== 'function' || NATIVE_CODE.test(Function.prototype.toString.call(fn))) return null;
        return fn;
    }

    function resolveArg(arg, el, event) {
        if (arg && typeof arg === 'object' && typeof arg.$ === 'string') {
            switch (arg.$) {
                case 'this':
                    return el;
                case 'event':
                    return event;
                case 'this.value':
                    return el.value;
                case 'this.checked':
                    return el.checked;
            }
        }
        return arg;
    }

    function dispatch(el, type, event) {
        const attr = (suffix) => `data-${type}${suffix}`;
        if (el.hasAttribute(attr('-self')) && event.target !== el) return;
        const keys = el.getAttribute(attr('-keys'));
        if (keys !== null && !keys.split('|').includes(event.key)) return;

        if (el.hasAttribute(attr('-stop'))) event.stopPropagation();
        if (el.hasAttribute(attr('-prevent'))) event.preventDefault();
        if (type === 'click' && el.tagName === 'A' && el.getAttribute('href') === '#') event.preventDefault();

        const name = el.getAttribute(`data-${type}`);
        const fn = resolveAction(name);
        if (!fn) {
            console.error(`[events] ação desconhecida em data-${type}: "${name}"`);
            return;
        }

        let args = [];
        const rawArgs = el.getAttribute(attr('-args'));
        if (rawArgs !== null) {
            try {
                args = JSON.parse(rawArgs);
            } catch {
                console.error(`[events] data-${type}-args inválido em "${name}"`);
                return;
            }
            if (!Array.isArray(args)) args = [args];
        }

        const result = fn.apply(
            el,
            args.map((arg) => resolveArg(arg, el, event))
        );
        if (result === false && el.hasAttribute(attr('-return'))) event.preventDefault();
    }

    const bound = new WeakMap();

    function bindElement(el) {
        let types = bound.get(el);
        if (!types) bound.set(el, (types = new Set()));
        for (const type of EVENTS) {
            if (types.has(type) || !el.hasAttribute(`data-${type}`)) continue;
            types.add(type);
            el.addEventListener(type, (event) => dispatch(el, type, event));
        }
    }

    function bindTree(root) {
        if (!root || root.nodeType !== 1) return;
        if (root.matches(SELECTOR)) bindElement(root);
        root.querySelectorAll(SELECTOR).forEach(bindElement);
    }

    window.bindActions = bindTree;

    bindTree(document.documentElement);
    document.addEventListener('DOMContentLoaded', () => bindTree(document.documentElement));
    new MutationObserver((records) => {
        for (const record of records) {
            if (record.type === 'attributes') bindTree(record.target);
            else record.addedNodes.forEach(bindTree);
        }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: EVENTS.map((type) => `data-${type}`) });
})();

window.printWhenLoaded = function printWhenLoaded(win) {
    let done = false;
    const run = () => {
        if (done) return;
        done = true;
        win.focus();
        win.print();
    };
    win.addEventListener('load', run);
    if (win.document.readyState === 'complete') setTimeout(run, 0);
};
