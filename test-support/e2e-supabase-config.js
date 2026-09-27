const LOCAL_SUPABASE_URL = process.env.E2E_SUPABASE_URL || 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_ANON_KEY =
    process.env.E2E_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

let serviceKey = process.env.E2E_SUPABASE_SERVICE_KEY || null;

function localServiceKey() {
    if (!serviceKey) {
        const env = require('child_process').execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        serviceKey = /^SERVICE_ROLE_KEY="(.+)"$/m.exec(env)?.[1] || null;
        if (!serviceKey) throw new Error('Defina E2E_SUPABASE_SERVICE_KEY: não foi possível ler a chave de serviço do supabase status.');
    }
    return serviceKey;
}

module.exports = { LOCAL_SUPABASE_URL, LOCAL_SUPABASE_ANON_KEY, localServiceKey };
