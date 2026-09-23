const ALIAS_RE = /\[P(\d+)\]/g;
const PARTIAL_ALIAS_TAIL_RE = /\[(?:P\d*)?$/;
const MIN_FIRST_NAME_LEN = 3;

const VARIANTS = { a: 'aáàâãä', e: 'eéèêë', i: 'iíìîï', o: 'oóòôõö', u: 'uúùûü', c: 'cç', n: 'nñ' };

export function normalizeName(s) {
    return String(s ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[\s_.-]+/g, ' ')
        .trim();
}

function loosePattern(normalized) {
    return [...normalized]
        .map((ch) => {
            if (ch === ' ') return '[\\s_.-]+';
            if (VARIANTS[ch]) return `[${VARIANTS[ch]}]`;
            return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
}

export function createPseudonymizer(people) {
    const aliasById = new Map();
    const nameByAlias = new Map();
    const aliasByKey = new Map();
    const firstNameCount = new Map();

    for (const p of people) {
        if (!p?.id || aliasById.has(p.id)) continue;
        const alias = `[P${aliasById.size + 1}]`;
        aliasById.set(p.id, alias);
        nameByAlias.set(alias, p.name ?? '');
        const full = normalizeName(p.name);
        if (!full) continue;
        if (!aliasByKey.has(full)) aliasByKey.set(full, alias);
        const first = full.split(' ')[0];
        firstNameCount.set(first, (firstNameCount.get(first) ?? 0) + 1);
    }
    for (const alias of nameByAlias.keys()) {
        const first = normalizeName(nameByAlias.get(alias)).split(' ')[0];
        if (first.length >= MIN_FIRST_NAME_LEN && firstNameCount.get(first) === 1 && !aliasByKey.has(first)) aliasByKey.set(first, alias);
    }

    const keys = [...aliasByKey.keys()].sort((a, b) => b.length - a.length);
    const nameRe = keys.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.map(loosePattern).join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null;

    function mask(text) {
        if (typeof text !== 'string' || !nameRe) return text;
        return text.normalize('NFC').replace(nameRe, (m) => aliasByKey.get(normalizeName(m)) ?? m);
    }

    function maskDeep(value) {
        if (typeof value === 'string') return mask(value);
        if (Array.isArray(value)) return value.map(maskDeep);
        if (value && typeof value === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value)) out[k] = maskDeep(v);
            return out;
        }
        return value;
    }

    function unmask(text, { jsonSafe = false } = {}) {
        if (typeof text !== 'string') return text;
        return text.replace(ALIAS_RE, (m) => {
            if (!nameByAlias.has(m)) return m;
            const name = nameByAlias.get(m);
            return jsonSafe ? JSON.stringify(name).slice(1, -1) : name;
        });
    }

    return { aliasOf: (id) => aliasById.get(id), mask, maskDeep, unmask };
}

export function createSseUnmaskStream(unmask) {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    let lineBuf = '';
    let held = '';

    const release = (text) => {
        const all = held + text;
        const m = all.match(PARTIAL_ALIAS_TAIL_RE);
        const cut = m ? m.index : all.length;
        held = all.slice(cut);
        return unmask(all.slice(0, cut));
    };
    const flushHeld = (controller) => {
        if (!held) return;
        const content = unmask(held);
        held = '';
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`));
    };
    const handleLine = (line, controller) => {
        if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
                flushHeld(controller);
            } else {
                try {
                    const obj = JSON.parse(payload);
                    const delta = obj?.choices?.[0]?.delta;
                    if (delta && typeof delta.content === 'string') {
                        delta.content = release(delta.content);
                        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n`));
                        return;
                    }
                } catch {
                }
            }
        }
        controller.enqueue(enc.encode(line + '\n'));
    };

    return new TransformStream({
        transform(chunk, controller) {
            lineBuf += dec.decode(chunk, { stream: true });
            const lines = lineBuf.split('\n');
            lineBuf = lines.pop();
            for (const line of lines) handleLine(line.replace(/\r$/, ''), controller);
        },
        flush(controller) {
            lineBuf += dec.decode();
            if (lineBuf) handleLine(lineBuf, controller);
            flushHeld(controller);
        },
    });
}
