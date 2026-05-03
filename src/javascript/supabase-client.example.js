// Copie este arquivo para supabase-client.js e preencha com suas credenciais.
// Encontre os valores em: Supabase Dashboard → Project Settings → API

const SUPABASE_URL = 'https://SEU_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_ANON_KEY';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});
