function matchOne(row, op, col, val) {
    const v = col.includes('.') ? col.split('.').reduce((o, k) => o?.[k], row) : row[col];
    switch (op) {
        case 'eq':
            return v === val || (v != null && val != null && String(v) === String(val));
        case 'neq':
            return !(v === val || (v != null && val != null && String(v) === String(val)));
        case 'in':
            return (
                Array.isArray(val)
                    ? val
                    : String(val)
                          .replace(/^\(|\)$/g, '')
                          .split(',')
            ).some((x) => v === x || String(v) === String(x));
        case 'is':
            return val === null || val === 'null' ? v == null : v === val;
        case 'gte':
            return v != null && v >= val;
        case 'lte':
            return v != null && v <= val;
        case 'lt':
            return v != null && v < val;
        case 'gt':
            return v != null && v > val;
        case 'like':
        case 'ilike': {
            const re = new RegExp(
                '^' +
                    String(val)
                        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                        .replace(/%/g, '.*') +
                    '$',
                op === 'ilike' ? 'i' : ''
            );
            return v != null && re.test(String(v));
        }
        case 'contains':
            if (Array.isArray(v)) return [].concat(val).every((x) => v.includes(x));
            return v != null && typeof v === 'object' && Object.entries(val).every(([k, x]) => v[k] === x);
        default:
            throw new Error(`fake-supabase: filtro não suportado "${op}"`);
    }
}

function parseOrClause(orString) {
    const clauses = [];
    let cur = '',
        quoted = false;
    for (let i = 0; i < orString.length; i++) {
        const ch = orString[i];
        if (quoted && ch === '\\') cur += ch + orString[++i];
        else if (ch === '"') ((quoted = !quoted), (cur += ch));
        else if (ch === ',' && !quoted) (clauses.push(cur), (cur = ''));
        else cur += ch;
    }
    clauses.push(cur);
    return clauses.map((clause) => {
        const [col, op, ...rest] = clause.split('.');
        let val = rest.join('.');
        if (/^".*"$/s.test(val)) val = val.slice(1, -1).replace(/\\(.)/g, '$1');
        if (op === 'is' && val === 'null') val = null;
        return { col, op, val };
    });
}

function matches(row, filters) {
    return filters.every((f) => {
        if (f.op === 'or') return f.clauses.some((c) => matchOne(row, c.op, c.col, c.val));
        if (f.op === 'not') return !matchOne(row, f.inner, f.col, f.val);
        return matchOne(row, f.op, f.col, f.val);
    });
}

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

class FakeQuery {
    constructor(client, table) {
        this._client = client;
        this._table = table;
        this._filters = [];
        this._orders = [];
        this._limit = null;
        this._range = null;
        this._single = null;
        this._op = 'select';
        this._payload = null;
        this._opts = null;
        this._selectOpts = null;
        this._returning = false;
    }

    select(columns, opts) {
        if (this._op === 'select') this._selectOpts = opts || null;
        else this._returning = true;
        this._columns = columns;
        return this;
    }
    insert(rows, opts) {
        this._op = 'insert';
        this._payload = Array.isArray(rows) ? rows : [rows];
        this._opts = opts || null;
        return this;
    }
    upsert(rows, opts) {
        this._op = 'upsert';
        this._payload = Array.isArray(rows) ? rows : [rows];
        this._opts = opts || null;
        return this;
    }
    update(patch) {
        this._op = 'update';
        this._payload = patch;
        return this;
    }
    delete() {
        this._op = 'delete';
        return this;
    }

    _f(op, col, val) {
        this._filters.push({ op, col, val });
        return this;
    }
    eq(c, v) {
        return this._f('eq', c, v);
    }
    neq(c, v) {
        return this._f('neq', c, v);
    }
    in(c, v) {
        return this._f('in', c, v);
    }
    is(c, v) {
        return this._f('is', c, v);
    }
    gte(c, v) {
        return this._f('gte', c, v);
    }
    lte(c, v) {
        return this._f('lte', c, v);
    }
    lt(c, v) {
        return this._f('lt', c, v);
    }
    gt(c, v) {
        return this._f('gt', c, v);
    }
    like(c, v) {
        return this._f('like', c, v);
    }
    ilike(c, v) {
        return this._f('ilike', c, v);
    }
    contains(c, v) {
        return this._f('contains', c, v);
    }
    not(col, op, val) {
        this._filters.push({ op: 'not', inner: op, col, val });
        return this;
    }
    match(obj) {
        Object.entries(obj).forEach(([c, v]) => this._f('eq', c, v));
        return this;
    }
    filter(col, op, val) {
        return this._f(op, col, val);
    }
    or(orString) {
        this._filters.push({ op: 'or', clauses: parseOrClause(orString) });
        return this;
    }
    order(col, opts) {
        this._orders.push({ col, ascending: opts?.ascending !== false });
        return this;
    }
    limit(n) {
        this._limit = n;
        return this;
    }
    range(from, to) {
        this._range = [from, to];
        return this;
    }
    single() {
        this._single = 'single';
        return this;
    }
    maybeSingle() {
        this._single = 'maybe';
        return this;
    }
    abortSignal() {
        return this;
    }

    _execute() {
        const client = this._client;
        const call = { table: this._table, op: this._op, filters: this._filters, payload: clone(this._payload), opts: this._opts };
        client.calls.push(call);

        const injected = client._errorFor(this._table, this._op, call);
        if (injected) return { data: null, error: injected, count: null, status: 400 };

        const store = client.tables[this._table] || (client.tables[this._table] = []);
        let rows;

        if (this._op === 'insert') {
            rows = this._payload.map((row) => {
                const created = { id: client._nextId(this._table), created_at: client.now(), ...clone(row) };
                store.push(created);
                return created;
            });
        } else if (this._op === 'upsert') {
            const conflict = (this._opts?.onConflict || 'id').split(',').map((s) => s.trim());
            rows = this._payload.map((row) => {
                const existing = store.find((r) => conflict.every((c) => row[c] !== undefined && String(r[c]) === String(row[c])));
                if (existing) return Object.assign(existing, clone(row));
                const created = { id: client._nextId(this._table), created_at: client.now(), ...clone(row) };
                store.push(created);
                return created;
            });
        } else if (this._op === 'update') {
            rows = store.filter((r) => matches(r, this._filters));
            rows.forEach((r) => Object.assign(r, clone(this._payload)));
        } else if (this._op === 'delete') {
            rows = store.filter((r) => matches(r, this._filters));
            client.tables[this._table] = store.filter((r) => !rows.includes(r));
        } else {
            rows = store.filter((r) => matches(r, this._filters));
        }

        if (this._orders.length) {
            rows = [...rows].sort((a, b) => {
                for (const { col, ascending } of this._orders) {
                    if (a[col] === b[col]) continue;
                    if (a[col] == null) return 1;
                    if (b[col] == null) return -1;
                    return (a[col] < b[col] ? -1 : 1) * (ascending ? 1 : -1);
                }
                return 0;
            });
        }
        const count = rows.length;
        if (this._range) rows = rows.slice(this._range[0], this._range[1] + 1);
        if (this._limit != null) rows = rows.slice(0, this._limit);

        const mutating = this._op !== 'select';
        if (mutating && !this._returning && !this._single) return { data: null, error: null, count: null, status: 204 };
        if (this._selectOpts?.head) return { data: null, error: null, count, status: 200 };

        const data = clone(rows);
        if (this._single) {
            if (data.length === 1) return { data: data[0], error: null, count, status: 200 };
            if (data.length === 0 && this._single === 'maybe') return { data: null, error: null, count, status: 200 };
            return {
                data: null,
                error:
                    data.length === 0
                        ? { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }
                        : { code: 'PGRST116', message: 'multiple rows' },
                count,
                status: 406,
            };
        }
        return { data, error: null, count: this._selectOpts?.count ? count : null, status: 200 };
    }

    then(onFulfilled, onRejected) {
        return Promise.resolve()
            .then(() => (this._op === 'rpc' ? this._executeRpc() : this._execute()))
            .then(onFulfilled, onRejected);
    }

    async _executeRpc() {
        const client = this._client;
        const { name, args } = this._payload;
        client.calls.push({ rpc: name, args: clone(args) });
        const injected = client._errorFor(`rpc:${name}`, 'rpc', { args });
        if (injected) return { data: null, error: injected, status: 400 };
        const h = client.handlers.rpc[name];
        let out = h === undefined ? null : await (typeof h === 'function' ? h(args, client) : h);
        if (out && typeof out === 'object' && !Array.isArray(out) && ('data' in out || 'error' in out)) {
            if (out.error) return { data: null, error: out.error, status: 400 };
            out = out.data ?? null;
        }
        let data = clone(out);
        if (Array.isArray(data) && this._filters.length) data = data.filter((r) => matches(r, this._filters));
        if (this._single && Array.isArray(data)) {
            if (data.length === 1) data = data[0];
            else if (data.length === 0 && this._single === 'maybe') data = null;
            else return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, status: 406 };
        }
        return { data: data ?? null, error: null, status: 200 };
    }
}

class FakeBucket {
    constructor(client, bucket) {
        this._client = client;
        this._bucket = bucket;
    }
    _files() {
        return this._client.storage._files;
    }
    _log(op, path, extra) {
        this._client.calls.push({ storage: this._bucket, op, path: clone(path), ...clone(extra) });
        return this._client._errorFor(`storage:${this._bucket}`, op, { path });
    }
    async upload(path, body, opts) {
        const err = this._log('upload', path, { opts });
        if (err) return { data: null, error: err };
        const key = `${this._bucket}/${path}`;
        if (this._files().has(key) && !opts?.upsert) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
        this._files().set(key, body);
        return { data: { path }, error: null };
    }
    async download(path) {
        const err = this._log('download', path);
        if (err) return { data: null, error: err };
        const body = this._files().get(`${this._bucket}/${path}`);
        if (body === undefined) return { data: null, error: { message: 'Object not found', statusCode: '404' } };
        const Blob = this._client.Blob || globalThis.Blob;
        return { data: body instanceof Blob ? body : new Blob([body]), error: null };
    }
    async remove(paths) {
        const err = this._log('remove', paths);
        if (err) return { data: null, error: err };
        paths.forEach((p) => this._files().delete(`${this._bucket}/${p}`));
        return { data: paths.map((name) => ({ name })), error: null };
    }
    async createSignedUrl(path, expiresIn) {
        const err = this._log('createSignedUrl', path, { expiresIn });
        if (err) return { data: null, error: err };
        return { data: { signedUrl: `https://storage.test/${this._bucket}/${path}?token=t` }, error: null };
    }
    getPublicUrl(path) {
        this._client.calls.push({ storage: this._bucket, op: 'getPublicUrl', path });
        return { data: { publicUrl: `https://storage.test/public/${this._bucket}/${path}` } };
    }
    async list(prefix) {
        this._log('list', prefix);
        const names = [...this._files().keys()].filter((k) => k.startsWith(`${this._bucket}/${prefix ? prefix + '/' : ''}`));
        return { data: names.map((k) => ({ name: k.split('/').pop() })), error: null };
    }
}

class FakeChannel {
    constructor(client, name) {
        this._client = client;
        this.name = name;
        this.handlers = [];
    }
    on(type, filter, cb) {
        this.handlers.push({ type, filter, cb });
        return this;
    }
    subscribe(cb) {
        if (typeof cb === 'function') cb('SUBSCRIBED');
        return this;
    }
    async unsubscribe() {
        return 'ok';
    }
    async send() {
        return 'ok';
    }
    track() {
        return Promise.resolve('ok');
    }
    presenceState() {
        return this._client.presence || {};
    }
}

class FakeAuth {
    constructor(client, { user, session, mfa }) {
        this._client = client;
        this.user = user || null;
        this.session = session || (user ? { access_token: 'token-test', user } : null);
        this._listeners = [];
        const self = this;
        this.mfa = {
            level: mfa?.level || { currentLevel: 'aal2', nextLevel: 'aal2' },
            factors: mfa?.factors || [],
            async getAuthenticatorAssuranceLevel() {
                client.calls.push({ auth: 'mfa.aal' });
                return { data: self.mfa.level, error: null };
            },
            async listFactors() {
                return { data: { all: self.mfa.factors, totp: self.mfa.factors.filter((f) => f.factor_type === 'totp') }, error: null };
            },
            async enroll(params) {
                client.calls.push({ auth: 'mfa.enroll', params: clone(params) });
                return { data: { id: 'factor-new', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'ABCDEF', uri: 'otpauth://x' } }, error: null };
            },
            async challenge(params) {
                return { data: { id: 'challenge-1', ...params }, error: null };
            },
            async verify(params) {
                client.calls.push({ auth: 'mfa.verify', params: clone(params) });
                return params.code === '123456' ? { data: {}, error: null } : { data: null, error: { message: 'Invalid TOTP code entered' } };
            },
            async challengeAndVerify(params) {
                client.calls.push({ auth: 'mfa.challengeAndVerify', params: clone(params) });
                return params.code === '123456' ? { data: {}, error: null } : { data: null, error: { message: 'Invalid TOTP code entered' } };
            },
            async unenroll(params) {
                client.calls.push({ auth: 'mfa.unenroll', params: clone(params) });
                return { data: {}, error: null };
            },
        };
    }
    async getUser() {
        return { data: { user: this.user }, error: null };
    }
    async getSession() {
        return { data: { session: this.session }, error: null };
    }
    async refreshSession() {
        return { data: { session: this.session }, error: null };
    }
    onAuthStateChange(cb) {
        this._listeners.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
    }
    emit(event, session = this.session) {
        this._listeners.forEach((cb) => cb(event, session));
    }
    async signInWithPassword(creds) {
        this._client.calls.push({ auth: 'signInWithPassword', email: creds.email });
        const handler = this._client.handlers.signIn;
        if (handler) return handler(creds);
        return { data: { user: this.user, session: this.session }, error: null };
    }
    async signOut() {
        this._client.calls.push({ auth: 'signOut' });
        this.session = null;
        return { error: null };
    }
    async updateUser(attrs) {
        this._client.calls.push({ auth: 'updateUser', attrs: clone(attrs) });
        return { data: { user: this.user }, error: null };
    }
    async resetPasswordForEmail(email, opts) {
        this._client.calls.push({ auth: 'resetPasswordForEmail', email, opts: clone(opts) });
        return { data: {}, error: null };
    }
}

class FakeSupabase {
    constructor({ tables = {}, user = null, session, mfa, rpc = {}, functions = {}, errors = {}, signIn, now, views = {} } = {}) {
        this.tables = clone(tables);
        this.views = views;
        this.calls = [];
        this.handlers = { rpc, functions, signIn };
        this.errors = errors;
        this.now = now || (() => new Date().toISOString());
        this._ids = 0;
        this.channels = [];
        this.auth = new FakeAuth(this, { user, session, mfa });
        const client = this;
        this.storage = {
            _files: new Map(),
            from(bucket) {
                return new FakeBucket(client, bucket);
            },
        };
        this.functions = {
            async invoke(name, opts) {
                client.calls.push({ fn: name, body: clone(opts?.body) });
                const h = client.handlers.functions[name];
                return h ? h(opts?.body, opts) : { data: null, error: null };
            },
        };
    }

    _nextId(table) {
        return `${table}-${++this._ids}`;
    }

    _errorFor(target, op, call) {
        const e = this.errors[`${target}:${op}`] || this.errors[target];
        if (!e) return null;
        return typeof e === 'function' ? e(call) : e;
    }

    from(table) {
        return new FakeQuery(this, this.views[table] || table);
    }

    rpc(name, args) {
        const q = new FakeQuery(this, null);
        q._op = 'rpc';
        q._payload = { name, args };
        return q;
    }

    channel(name) {
        const ch = new FakeChannel(this, name);
        this.channels.push(ch);
        return ch;
    }
    async removeChannel(ch) {
        this.channels = this.channels.filter((c) => c !== ch);
        return 'ok';
    }
    removeAllChannels() {
        this.channels = [];
    }

    emit(table, payload) {
        for (const ch of this.channels) {
            for (const h of ch.handlers) {
                if (h.type === 'postgres_changes' && (!h.filter?.table || h.filter.table === table)) h.cb(payload);
            }
        }
    }

    emitPresence(state) {
        this.presence = state;
        for (const ch of this.channels) for (const h of ch.handlers) if (h.type === 'presence') h.cb();
    }
    emitBroadcast(channelName, event, payload) {
        for (const ch of this.channels)
            if (ch.name === channelName) for (const h of ch.handlers) if (h.type === 'broadcast' && h.filter?.event === event) h.cb({ payload });
    }

    writes(table, op) {
        return this.calls.filter((c) => c.table === table && (op ? c.op === op : c.op !== 'select'));
    }
    rpcCalls(name) {
        return this.calls.filter((c) => c.rpc === name);
    }
}

const ORIGINAL = {
    query: Object.fromEntries(Object.getOwnPropertyNames(FakeQuery.prototype).map((k) => [k, FakeQuery.prototype[k]])),
    bucket: Object.fromEntries(Object.getOwnPropertyNames(FakeBucket.prototype).map((k) => [k, FakeBucket.prototype[k]])),
    auth: Object.fromEntries(Object.getOwnPropertyNames(FakeAuth.prototype).map((k) => [k, FakeAuth.prototype[k]])),
};

function resetInterceptors() {
    for (const [proto, orig] of [
        [FakeQuery.prototype, ORIGINAL.query],
        [FakeBucket.prototype, ORIGINAL.bucket],
        [FakeAuth.prototype, ORIGINAL.auth],
    ]) {
        Object.assign(proto, orig);
        delete proto.__nexusPatched;
        delete proto.__nexusE2EPatched;
    }
}

module.exports = { FakeSupabase, resetInterceptors };
