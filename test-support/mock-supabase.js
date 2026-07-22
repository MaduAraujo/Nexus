function applyFilters(rows, filters) {
    return rows.filter((row) =>
        filters.every((f) => {
            switch (f.op) {
                case 'eq':
                    return row[f.col] === f.val;
                case 'neq':
                    return row[f.col] !== f.val;
                case 'in':
                    return f.val.includes(row[f.col]);
                case 'is':
                    return row[f.col] === f.val;
                case 'gte':
                    return row[f.col] >= f.val;
                case 'lte':
                    return row[f.col] <= f.val;
                case 'lt':
                    return row[f.col] < f.val;
                case 'gt':
                    return row[f.col] > f.val;
                default:
                    return true;
            }
        })
    );
}

function createMockSupabase(tables = {}, { user = null, authError = null } = {}) {
    function builder(table) {
        const filters = [];
        let single = false;
        let orderBy = null;
        let limitN = null;

        const api = {
            select() {
                return api;
            },
            eq(col, val) {
                filters.push({ op: 'eq', col, val });
                return api;
            },
            neq(col, val) {
                filters.push({ op: 'neq', col, val });
                return api;
            },
            in(col, val) {
                filters.push({ op: 'in', col, val });
                return api;
            },
            is(col, val) {
                filters.push({ op: 'is', col, val });
                return api;
            },
            gte(col, val) {
                filters.push({ op: 'gte', col, val });
                return api;
            },
            lte(col, val) {
                filters.push({ op: 'lte', col, val });
                return api;
            },
            lt(col, val) {
                filters.push({ op: 'lt', col, val });
                return api;
            },
            gt(col, val) {
                filters.push({ op: 'gt', col, val });
                return api;
            },
            order(col, opts) {
                orderBy = { col, ascending: opts?.ascending !== false };
                return api;
            },
            limit(n) {
                limitN = n;
                return api;
            },
            single() {
                single = true;
                return api;
            },
            then(resolve, reject) {
                try {
                    let rows = applyFilters(tables[table] || [], filters);
                    if (orderBy) {
                        const { col, ascending } = orderBy;
                        rows = [...rows].sort((a, b) => {
                            if (a[col] < b[col]) return ascending ? -1 : 1;
                            if (a[col] > b[col]) return ascending ? 1 : -1;
                            return 0;
                        });
                    }
                    if (limitN != null) rows = rows.slice(0, limitN);
                    if (single) {
                        if (rows.length === 1) return resolve({ data: rows[0], error: null });
                        return resolve({
                            data: null,
                            error: rows.length === 0 ? { code: 'PGRST116', message: 'no rows' } : { message: 'multiple rows' },
                        });
                    }
                    return resolve({ data: rows, error: null });
                } catch (e) {
                    return reject ? reject(e) : resolve({ data: null, error: e });
                }
            },
        };
        return api;
    }

    return {
        from(table) {
            return builder(table);
        },
        auth: {
            async getUser() {
                return { data: { user }, error: authError };
            },
            async signOut() {
                return { error: null };
            },
        },
    };
}

module.exports = { createMockSupabase };
