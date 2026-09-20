const SUPABASE_URL = 'https://SEU_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_ANON_KEY';

const NEXUS_AUTH_SLOTS = { Administrador: 'rh', colaborador: 'colab' };
const NEXUS_PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];

function nexusSlotFromPage() {
    if (typeof location === 'undefined') return null;
    const file = location.pathname.split('/').pop() || '';
    if (!file.endsWith('.html') || file === 'login.html') return null;
    return file.endsWith('-colaborador.html') ? 'colab' : 'rh';
}

function nexusMigrateLegacySession(slot) {
    if (!slot) return;
    try {
        const legacyKey = `sb-${NEXUS_PROJECT_REF}-auth-token`;
        const legacy = localStorage.getItem(legacyKey);
        if (!legacy) return;
        const slotKey = `sb-${NEXUS_PROJECT_REF}-${slot}-auth-token`;
        if (!localStorage.getItem(slotKey)) localStorage.setItem(slotKey, legacy);
        localStorage.removeItem(legacyKey);
    } catch {}
}

function nexusCreateClient(slot) {
    nexusMigrateLegacySession(slot);
    return supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            ...(slot ? { storageKey: `sb-${NEXUS_PROJECT_REF}-${slot}-auth-token` } : {}),
        },
    });
}

function nexusUseProfileSession(profileType) {
    sb = nexusCreateClient(NEXUS_AUTH_SLOTS[profileType] || null);
    return sb;
}

let sb = nexusCreateClient(nexusSlotFromPage());
