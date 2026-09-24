process.env.TZ = 'America/Sao_Paulo';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const jsdomLib = path.join(path.dirname(require.resolve('jsdom')), 'jsdom');
const navigation = require(path.join(jsdomLib, 'living/window/navigation.js'));
const whatwgURL = require(require.resolve('whatwg-url', { paths: [jsdomLib] }));
const originalNavigate = navigation.navigate;
navigation.navigate = (window, newURL, flags) => {
    const href = whatwgURL.serializeURL(newURL);
    const current = window.location.href.split('#')[0];
    if (!flags.reloadTriggered && newURL.fragment !== null && href.split('#')[0] === current) return originalNavigate(window, newURL, flags);
    (window.__navigations || (window.__navigations = [])).push(flags.reloadTriggered ? 'reload' : href);
};

const { JSDOM, VirtualConsole } = require('jsdom');
const { FakeSupabase, resetInterceptors } = require('./fake-supabase');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'http://localhost:4173';

function chainable(log = [], name = 'stub') {
    const fn = function () {};
    const proxy = new Proxy(fn, {
        get(_t, prop) {
            if (prop === 'then') return undefined;
            if (prop === Symbol.toPrimitive) return () => 0;
            if (prop === 'length') return 0;
            return (...args) => {
                log.push([`${name}.${String(prop)}`, args]);
                return proxy;
            };
        },
        apply(_t, _this, args) {
            log.push([name, args]);
            return proxy;
        },
        construct(_t, args) {
            log.push([`new ${name}`, args]);
            return proxy;
        },
    });
    return proxy;
}

function fakeIndexedDB() {
    const dbs = new Map();
    function request(fn) {
        const req = { result: undefined, error: null };
        setTimeout(() => {
            try {
                req.result = fn();
                req.onsuccess?.({ target: req });
            } catch (e) {
                req.error = e;
                req.onerror?.({ target: req });
            }
        }, 0);
        return req;
    }
    return {
        open(name) {
            const req = { result: null, error: null };
            setTimeout(() => {
                let stores = dbs.get(name);
                const fresh = !stores;
                if (fresh) dbs.set(name, (stores = new Map()));
                req.result = {
                    createObjectStore(s) {
                        stores.set(s, new Map());
                    },
                    transaction(storeName) {
                        const tx = { error: null };
                        const store = stores.get(storeName) || stores.set(storeName, new Map()).get(storeName);
                        let pending = 0;
                        const done = () => setTimeout(() => pending === 0 && tx.oncomplete?.(), 0);
                        const wrap = (fn) => {
                            pending++;
                            const r = request(fn);
                            const orig = r;
                            setTimeout(() => {
                                pending--;
                                done();
                            }, 0);
                            return orig;
                        };
                        tx.objectStore = () => ({
                            get: (k) => wrap(() => store.get(k)),
                            put: (v, k) => wrap(() => (store.set(k, v), k)),
                            delete: (k) => wrap(() => (store.delete(k), undefined)),
                        });
                        return tx;
                    },
                    close() {},
                };
                if (fresh) req.onupgradeneeded?.();
                req.onsuccess?.();
            }, 0);
            return req;
        },
    };
}

function installStubs(w, opts, rec) {
    w.alert = (m) => rec.alerts.push(String(m));
    w.confirm = (m) => {
        rec.confirms.push(String(m));
        return typeof opts.confirm === 'function' ? opts.confirm(m) : opts.confirm !== false;
    };
    w.prompt = (m, d) => {
        rec.prompts.push(String(m));
        return typeof opts.prompt === 'function' ? opts.prompt(m, d) : (opts.prompt ?? null);
    };
    w.open = (u) => {
        const popup = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: `${BASE_URL}/popup` }).window;
        popup.print = () => rec.printed++;
        rec.opened.push({ url: u, window: popup, text: () => popup.document.body.textContent.replace(/\s+/g, ' ').trim() });
        return popup;
    };
    w.print = () => rec.printed++;
    w.document.addEventListener(
        'click',
        (e) => {
            const a = e.target?.closest?.('a[download]');
            if (!a) return;
            e.preventDefault();
            rec.downloads.push({ name: a.download, href: a.href });
        },
        true
    );
    const originalClick = w.HTMLElement.prototype.click;
    w.HTMLElement.prototype.click = function () {
        if (this.tagName === 'A' && this.hasAttribute('download') && !this.isConnected) {
            rec.downloads.push({ name: this.download, href: this.href });
            return;
        }
        return originalClick.call(this);
    };
    w.scrollTo = () => {};
    w.Element.prototype.scrollIntoView = function () {};
    w.Element.prototype.scrollTo = function () {};
    w.HTMLMediaElement.prototype.play = async function () {};
    w.HTMLMediaElement.prototype.pause = function () {};
    w.HTMLCanvasElement.prototype.getContext = function () {
        return chainable([], 'ctx2d');
    };
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
    w.HTMLCanvasElement.prototype.toBlob = function (cb) {
        cb(new w.Blob(['png'], { type: 'image/png' }));
    };
    if (!w.HTMLDialogElement?.prototype.showModal && w.HTMLDialogElement) {
        w.HTMLDialogElement.prototype.showModal = function () {
            this.open = true;
        };
        w.HTMLDialogElement.prototype.close = function () {
            this.open = false;
        };
    }
    const media = opts.media || [];
    w.matchMedia = (q) => ({ matches: media.includes(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    w.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
    w.IntersectionObserver = class {
        constructor(cb) {
            this.cb = cb;
        }
        observe(target) {
            setTimeout(() => this.cb([{ target, isIntersecting: true, intersectionRatio: 1 }], this), 0);
        }
        unobserve() {}
        disconnect() {}
    };
    w.URL.createObjectURL = (blob) => {
        rec.objectUrls.push(blob);
        return `blob:${BASE_URL}/${rec.objectUrls.length}`;
    };
    w.URL.revokeObjectURL = () => {};
    Object.defineProperty(w, 'crypto', { value: nodeCrypto.webcrypto, configurable: true });
    w.indexedDB = fakeIndexedDB();
    for (const name of [
        'TextEncoder',
        'TextDecoder',
        'structuredClone',
        'Response',
        'Request',
        'Headers',
        'FormData',
        'ReadableStream',
        'CompressionStream',
        'DecompressionStream',
    ]) {
        if (!w[name] && globalThis[name]) w[name] = globalThis[name];
    }
    w.fetch = async (url, init) => {
        rec.fetches.push({ url: String(url), init });
        if (opts.fetch) return opts.fetch(String(url), init);
        return new Response(JSON.stringify({ error: 'fetch não configurado no teste' }), { status: 404 });
    };
    const push = opts.push;
    w.Notification = class {
        static permission = push?.permission || 'default';
        static async requestPermission() {
            return push?.permission || 'denied';
        }
    };
    if (push) {
        const makeSub = () => ({
            endpoint: 'https://push.test/sub-1',
            toJSON: () => ({ endpoint: 'https://push.test/sub-1', keys: { p256dh: 'p256', auth: 'auth' } }),
            unsubscribe: async () => {
                rec.push.subscribed = false;
                return true;
            },
        });
        rec.push = { subscribed: !!push.subscribed };
        const registration = {
            addEventListener() {},
            pushManager: {
                getSubscription: async () => (rec.push.subscribed ? makeSub() : null),
                subscribe: async (o) => {
                    rec.push.subscribeOptions = o;
                    rec.push.subscribed = true;
                    return makeSub();
                },
            },
        };
        Object.defineProperty(w.navigator, 'serviceWorker', {
            value: { controller: {}, ready: Promise.resolve(registration), register: async () => registration, addEventListener() {} },
            configurable: true,
        });
        w.PushManager = class {};
    }
    Object.defineProperty(w.navigator, 'clipboard', {
        value: {
            writeText: async (t) => rec.clipboard.push(t),
        },
        configurable: true,
    });
    const geo = opts.geolocation;
    Object.defineProperty(w.navigator, 'geolocation', {
        value: {
            getCurrentPosition: (ok, fail) =>
                setTimeout(
                    () => (geo ? ok({ coords: { latitude: geo.lat, longitude: geo.lng, accuracy: 10 } }) : fail && fail({ code: 1, message: 'denied' })),
                    0
                ),
            watchPosition: () => 1,
            clearWatch() {},
        },
        configurable: true,
    });
    Object.defineProperty(w.navigator, 'mediaDevices', {
        value: {
            getUserMedia: async () => {
                if (!opts.camera) throw new Error('sem câmera no teste');
                return { getTracks: () => [{ stop() {} }] };
            },
        },
        configurable: true,
    });
    if (opts.camera) {
        Object.defineProperty(w.HTMLVideoElement.prototype, 'videoWidth', { get: () => 640, configurable: true });
        Object.defineProperty(w.HTMLVideoElement.prototype, 'videoHeight', { get: () => 480, configurable: true });
    }
    Object.defineProperty(w.navigator, 'onLine', { get: () => rec.online, configurable: true });

    if (opts.now) {
        const RealDate = w.Date;
        const fixed = new RealDate(opts.now).getTime();
        w.Date = class extends RealDate {
            constructor(...args) {
                if (args.length) super(...args);
                else super(fixed);
            }
            static now() {
                return fixed;
            }
        };
    }

    const libLog = rec.libs;
    w.Chart = class Chart {
        static defaults = {
            font: {},
            color: '',
            plugins: { legend: { labels: {} }, tooltip: {} },
            scale: { grid: {} },
            elements: { arc: {}, line: {}, point: {}, bar: {} },
        };
        static register() {}
        constructor(ctx, config) {
            this.ctx = ctx;
            this.config = config;
            this.data = config?.data;
            this.options = config?.options;
            rec.charts.push(this);
        }
        update() {}
        destroy() {
            this.destroyed = true;
        }
        resize() {}
    };
    class JsPDF {
        constructor() {
            this.internal = { pageSize: { width: 210, height: 297, getWidth: () => 210, getHeight: () => 297 }, getNumberOfPages: () => 1 };
            this.lastAutoTable = { finalY: 100 };
            rec.pdfs.push(this);
            this.calls = [];
            this.proxy = new Proxy(this, {
                get(t, p) {
                    if (p in t) return t[p];
                    if (typeof p !== 'string') return undefined;
                    return (...args) => {
                        t.calls.push([p, args]);
                        return t.proxy;
                    };
                },
            });
            return this.proxy;
        }
        splitTextToSize(text) {
            return String(text ?? '').split('\n');
        }
        getTextWidth(text) {
            return String(text ?? '').length * 2;
        }
        getNumberOfPages() {
            return 1;
        }
        getStringUnitWidth(text) {
            return String(text ?? '').length;
        }
        getFontSize() {
            return 10;
        }
        autoTable(opts) {
            this.calls.push(['autoTable', [opts]]);
            this.lastAutoTable = { finalY: 120 };
            return this;
        }
        save(name) {
            rec.saved.push(name);
        }
        output(type) {
            return type === 'blob' ? new w.Blob(['%PDF'], { type: 'application/pdf' }) : 'data:application/pdf;base64,JVBERg==';
        }
    }
    w.jspdf = { jsPDF: JsPDF };
    w.jsPDF = JsPDF;
    w.XLSX = {
        utils: {
            json_to_sheet: (rows) => ({ rows }),
            aoa_to_sheet: (rows) => ({ rows }),
            book_new: () => ({ SheetNames: [], Sheets: {} }),
            book_append_sheet: (wb, ws, name) => {
                wb.SheetNames.push(name);
                wb.Sheets[name] = ws;
            },
            sheet_to_json: (ws) => (ws?.rows ? ws.rows : opts.xlsxRows || []),
            encode_cell: ({ r, c }) => `${String.fromCharCode(65 + c)}${r + 1}`,
            decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }),
        },
        read: () => ({ SheetNames: ['Planilha1'], Sheets: { Planilha1: { rows: opts.xlsxRows || [] } } }),
        writeFile: (wb, name) => rec.saved.push(name),
        write: () => new Uint8Array([1]),
    };
    w.L = chainable(libLog, 'L');
    w.faceapi = {
        nets: new Proxy({}, { get: () => ({ loadFromUri: async () => {}, isLoaded: true }) }),
        TinyFaceDetectorOptions: class {},
        detectSingleFace: () => ({ withFaceLandmarks: () => ({ withFaceDescriptor: async () => null }), then: (r) => r(null) }),
        detectAllFaces: async () => [],
        euclideanDistance: () => 0.1,
    };
    w.marked = { parse: (s) => `<p>${String(s)}</p>`, use() {}, setOptions() {} };
    w.Tesseract = { recognize: async () => ({ data: { text: opts.ocrText || '' } }) };
}

async function openPage(screen, opts = {}) {
    resetInterceptors();
    const client = opts.client || new FakeSupabase(opts.supabase || {});
    const relPath = screen.startsWith('/') ? screen.slice(1) : `src/screens/${screen}.html`;
    const htmlPath = path.join(ROOT, relPath);
    const html = fs.readFileSync(htmlPath, 'utf8');
    const url = `${BASE_URL}/${relPath}${opts.query || ''}${opts.hash || ''}`;

    const rec = {
        alerts: [],
        confirms: [],
        prompts: [],
        opened: [],
        printed: 0,
        fetches: [],
        clipboard: [],
        objectUrls: [],
        charts: [],
        pdfs: [],
        saved: [],
        downloads: [],
        libs: [],
        consoleErrors: [],
        pageErrors: [],
        online: opts.online !== false,
    };

    const virtualConsole = new VirtualConsole();
    virtualConsole.on('error', (...args) => rec.consoleErrors.push(args.map(String).join(' ')));
    virtualConsole.on('jsdomError', (e) => {
        if (/Not implemented: navigation/.test(e.message)) return;
        rec.pageErrors.push(e.detail || e);
    });

    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
    const w = dom.window;
    w.__navigations = [];
    for (const [k, v] of Object.entries(opts.localStorage || {})) w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    for (const [k, v] of Object.entries(opts.sessionStorage || {})) w.sessionStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));

    installStubs(w, opts, rec);
    client.Blob = w.Blob;
    w.supabase = { createClient: () => client };
    if (opts.before) opts.before(w, client);

    const context = dom.getInternalVMContext();
    const srcs = [...w.document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    for (const src of srcs) {
        if (/^https?:\/\//.test(src)) continue;
        const file = src.startsWith('/') ? path.join(ROOT, src) : path.resolve(path.dirname(htmlPath), src);
        if ((opts.skipScripts || []).includes(path.basename(file))) continue;
        new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInContext(context);
    }

    if (w.document.readyState !== 'complete') await new Promise((r) => w.addEventListener('load', r, { once: true }));
    const page = makePage(dom, client, rec);
    await page.settle();
    return page;
}

function makePage(dom, client, rec) {
    const w = dom.window;
    const doc = w.document;
    const el = (target) => (typeof target === 'string' ? doc.querySelector(target) : target);
    const must = (target) => {
        const node = el(target);
        if (!node) throw new Error(`elemento não encontrado: ${target}`);
        return node;
    };

    const page = {
        window: w,
        document: doc,
        client,
        ...rec,
        get printed() {
            return rec.printed;
        },
        plain(value) {
            return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        },
        get navigations() {
            return w.__navigations;
        },
        $: (sel) => doc.querySelector(sel),
        $$: (sel) => [...doc.querySelectorAll(sel)],
        text(target) {
            const node = el(target);
            if (!node) return null;
            const parts = [];
            const walker = doc.createTreeWalker(node, w.NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
            return parts.join(' ').replace(/\s+/g, ' ').trim();
        },
        visible(target) {
            const node = el(target);
            if (!node) return false;
            for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
                if (n.hidden || n.style.display === 'none' || n.classList.contains('hidden')) return false;
            }
            return true;
        },
        async settle(rounds = 12) {
            for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
        },
        async waitFor(condition, { timeout = 5000, message } = {}) {
            const deadline = Date.now() + timeout;
            for (;;) {
                const value = await condition();
                if (value) return value;
                if (Date.now() > deadline) throw new Error(`waitFor: tempo esgotado${message ? ` (${message})` : ''}`);
                await new Promise((r) => setTimeout(r, 10));
            }
        },
        async click(target) {
            const node = must(target);
            node.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
            await page.settle();
            return node;
        },
        async fill(target, value) {
            const node = must(target);
            node.value = value;
            node.dispatchEvent(new w.Event('input', { bubbles: true }));
            node.dispatchEvent(new w.Event('change', { bubbles: true }));
            node.dispatchEvent(new w.KeyboardEvent('keyup', { bubbles: true }));
            await page.settle();
            return node;
        },
        async check(target, checked = true) {
            const node = must(target);
            node.checked = checked;
            node.dispatchEvent(new w.Event('change', { bubbles: true }));
            await page.settle();
        },
        async key(target, key, extra = {}) {
            const node = must(target);
            node.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
            await page.settle();
        },
        async submit(target) {
            const form = must(target);
            form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
            await page.settle();
        },
        eval(code) {
            return vm.runInContext(code, dom.getInternalVMContext());
        },
        file(name, content, type = 'application/pdf') {
            return new w.File([content], name, { type });
        },
        async setFiles(target, files) {
            const node = must(target);
            Object.defineProperty(node, 'files', { value: files, configurable: true });
            node.dispatchEvent(new w.Event('change', { bubbles: true }));
            await page.settle();
        },
        async setOnline(online) {
            rec.online = online;
            w.dispatchEvent(new w.Event(online ? 'online' : 'offline'));
            await page.settle();
        },
        toasts() {
            return [...doc.querySelectorAll('.toast, #nexus-err-toast-container > div')].map((t) => t.textContent.replace(/\s+/g, ' ').trim());
        },
        close() {
            for (const o of rec.opened) o.window.close();
            w.close();
        },
    };
    return page;
}

module.exports = { openPage, FakeSupabase, BASE_URL };
