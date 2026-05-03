const SUPABASE_URL = 'https://axyagainqlanowuejdcz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bT2radqmJcjyKDiYCf2lOQ_TECJHpzi';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});
