const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'src', 'javascript', 'shared');
const lines = (file) => fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/);

test('supabase-client.example.js só difere do real nas duas credenciais (o README manda copiá-lo)', () => {
    const real = lines('supabase-client.js');
    const example = lines('supabase-client.example.js');
    assert.match(example[0], /^const SUPABASE_URL = /);
    assert.match(example[1], /^const SUPABASE_ANON_KEY = /);
    assert.deepEqual(example.slice(2), real.slice(2));
});
