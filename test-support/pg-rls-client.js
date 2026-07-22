const { Client } = require('pg');

const DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function withServiceRole(fn) {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
        return await fn(client);
    } finally {
        await client.end();
    }
}

async function withUser({ sub, role = 'authenticated' }, fn) {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role === 'anon' ? 'anon' : 'authenticated'}`);
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [sub]);
        await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [role]);
        return await fn(client);
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        await client.end();
    }
}

module.exports = { withServiceRole, withUser, DB_URL };