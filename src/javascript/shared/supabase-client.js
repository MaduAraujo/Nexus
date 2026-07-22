const SUPABASE_URL = 'https://axyagainqlanowuejdcz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bT2radqmJcjyKDiYCf2lOQ_TECJHpzi';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
});

(function interceptSupabaseErrors() {
    const probe = sb.from('__nexus_error_probe__').select();
    const BuilderProto = Object.getPrototypeOf(probe);
    if (!BuilderProto || typeof BuilderProto.then !== 'function' || BuilderProto.__nexusPatched) return;

    const originalThen = BuilderProto.then;
    BuilderProto.then = function (onFulfilled, onRejected) {
        return originalThen.call(
            this,
            (result) => {
                if (result && result.error) reportSupabaseError(result.error);
                return onFulfilled ? onFulfilled(result) : result;
            },
            (err) => {
                reportSupabaseError(err);
                if (onRejected) return onRejected(err);
                throw err;
            }
        );
    };
    BuilderProto.__nexusPatched = true;
})();

(function interceptStorageErrors() {
    const storageProbe = sb.storage.from('__nexus_storage_error_probe__');
    const StorageProto = Object.getPrototypeOf(storageProbe);
    if (!StorageProto || StorageProto.__nexusPatched) return;

    Object.getOwnPropertyNames(StorageProto).forEach((key) => {
        if (key === 'constructor') return;
        const original = StorageProto[key];
        if (typeof original !== 'function') return;
        try {
            StorageProto[key] = function (...args) {
                const result = original.apply(this, args);
                if (result && typeof result.then === 'function') {
                    return result.then(
                        (res) => {
                            if (res && res.error) reportSupabaseError(res.error);
                            return res;
                        },
                        (err) => {
                            reportSupabaseError(err);
                            throw err;
                        }
                    );
                }
                return result;
            };
        } catch {}
    });
    StorageProto.__nexusPatched = true;
})();

function reportSupabaseError(error) {
    if (!error) return;
    if (error.code === 'PGRST116') return;
    console.error('[Nexus] Erro Supabase:', error.message || error, error);
    showNexusErrorToast(error.message || 'Erro ao comunicar com o servidor.');
}

let nexusToastContainer = null;
function showNexusErrorToast(message) {
    if (!document.body) {
        window.addEventListener('DOMContentLoaded', () => showNexusErrorToast(message), { once: true });
        return;
    }
    if (!nexusToastContainer) {
        nexusToastContainer = document.createElement('div');
        nexusToastContainer.id = 'nexus-err-toast-container';
        nexusToastContainer.setAttribute(
            'style',
            'position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:340px;pointer-events:none;'
        );
        document.body.appendChild(nexusToastContainer);
    }

    const toast = document.createElement('div');
    toast.setAttribute(
        'style',
        [
            'background:#fef2f2',
            'border:1px solid #fca5a5',
            'color:#991b1b',
            'padding:10px 14px',
            'border-radius:8px',
            'font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
            'box-shadow:0 4px 12px rgba(0,0,0,.15)',
            'opacity:0',
            'transform:translateY(-6px)',
            'transition:opacity .2s ease,transform .2s ease',
            'pointer-events:auto',
        ].join(';')
    );
    toast.textContent = `Erro ao comunicar com o servidor: ${message}`;
    nexusToastContainer.appendChild(toast);
    requestAnimationFrame(() =>
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        })
    );
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-6px)';
        setTimeout(() => toast.remove(), 250);
    }, 6000);
}