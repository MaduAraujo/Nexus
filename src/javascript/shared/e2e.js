window.NexusE2E = (function () {
    'use strict';

    const C = window.NexusE2ECrypto;
    const DB_NAME = 'nexus-e2e';
    const STORE = 'identities';

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idb(mode, fn) {
        const db = await openDb();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, mode);
                const req = fn(tx.objectStore(STORE));
                tx.oncomplete = () => resolve(req?.result);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        } finally {
            db.close();
        }
    }

    const readStored = (userId) => idb('readonly', (s) => s.get(userId));
    const writeStored = (userId, value) => idb('readwrite', (s) => s.put(value, userId));
    const deleteStored = (userId) => idb('readwrite', (s) => s.delete(userId));

    let cached = null;

    async function currentUserId() {
        const {
            data: { session },
        } = await sb.auth.getSession();
        return session?.user?.id || null;
    }

    async function loaded() {
        const userId = await currentUserId();
        if (!userId) return null;
        if (cached?.userId === userId) return cached;
        const stored = await readStored(userId).catch(() => null);
        cached = stored || null;
        return cached;
    }

    async function persist(identity) {
        cached = identity;
        await writeStored(identity.userId, identity);
    }

    async function lock(userId) {
        const id = userId || (await currentUserId());
        if (cached?.userId === id) cached = null;
        if (id) await deleteStored(id).catch(() => {});
    }

    (function wrapSignOut() {
        const proto = typeof sb !== 'undefined' ? Object.getPrototypeOf(sb.auth) : null;
        if (!proto || proto === Object.prototype || typeof proto.signOut !== 'function' || proto.__nexusE2EPatched) return;
        const original = proto.signOut;
        proto.signOut = async function (...args) {
            try {
                const {
                    data: { session },
                } = await this.getSession();
                if (session?.user?.id) await lock(session.user.id);
            } catch {}
            return original.apply(this, args);
        };
        proto.__nexusE2EPatched = true;
    })();

    async function identityFromPkcs8(userId, pkcs8, row) {
        return { userId, fingerprint: row.fingerprint, publicJwk: row.public_key, privateKey: await C.importPrivate(pkcs8), org: null };
    }

    async function fetchOwnRow(userId) {
        const { data, error } = await sb.from('e2e_keys').select('*').eq('user_id', userId).maybeSingle();
        if (error) throw error;
        return data;
    }

    async function createIdentity(userId, password) {
        const id = await C.generateIdentity();
        const recoveryKey = C.generateRecoveryKey();
        const row = {
            user_id: userId,
            public_key: id.publicJwk,
            fingerprint: await C.fingerprint(id.publicJwk),
            wrapped_by_password: await C.wrapWithPassword(id.pkcs8, password),
            wrapped_by_recovery: await C.wrapWithRecovery(id.pkcs8, recoveryKey),
        };
        const { error } = await sb.from('e2e_keys').upsert(row);
        if (error) throw error;
        return { identity: await identityFromPkcs8(userId, id.pkcs8, row), recoveryKey };
    }

    async function loadOrgKey(identity, retried = false) {
        const { data: org } = await sb.from('e2e_org_keys').select('*').eq('id', 'rh').maybeSingle();
        if (!org) {
            if (retried) return null;
            const created = await C.generateIdentity();
            const fingerprint = await C.fingerprint(created.publicJwk);
            const { error } = await sb.from('e2e_org_keys').insert({ id: 'rh', public_key: created.publicJwk, fingerprint, created_by: identity.userId });
            if (error) return loadOrgKey(identity, true);
            await grantOrgKey(identity, created.pkcs8, { user_id: identity.userId, public_key: identity.publicJwk, fingerprint: identity.fingerprint });
            return { fingerprint, publicJwk: created.publicJwk, privateKey: await C.importPrivate(created.pkcs8) };
        }
        const pkcs8 = await orgPkcs8(identity);
        if (!pkcs8) return null;
        return { fingerprint: org.fingerprint, publicJwk: org.public_key, privateKey: await C.importPrivate(pkcs8) };
    }

    async function orgPkcs8(identity) {
        const { data: grant } = await sb
            .from('e2e_org_key_grants')
            .select('wrapped_private')
            .eq('user_id', identity.userId)
            .eq('recipient_fp', identity.fingerprint)
            .maybeSingle();
        if (!grant) return null;
        return C.openSealed(identity.privateKey, grant.wrapped_private, 'org:rh');
    }

    async function grantOrgKey(identity, pkcs8, admin) {
        const wrapped = await C.sealTo(admin.public_key, pkcs8, 'org:rh');
        const { error } = await sb
            .from('e2e_org_key_grants')
            .insert({ user_id: admin.user_id, recipient_fp: admin.fingerprint, wrapped_private: wrapped, granted_by: identity.userId });
        if (error) throw error;
    }

    async function grantPendingAdmins() {
        const identity = await loaded();
        if (!identity?.org) return 0;
        const { data: pending } = await sb.rpc('e2e_admins_pending_grant');
        if (!pending?.length) return 0;
        const pkcs8 = await orgPkcs8(identity);
        if (!pkcs8) return 0;
        for (const admin of pending) await grantOrgKey(identity, pkcs8, admin);
        return pending.length;
    }

    async function withOrg(identity, isAdmin) {
        if (isAdmin) identity.org = await loadOrgKey(identity).catch(() => null);
        await persist(identity);
        if (isAdmin) await grantPendingAdmins().catch(() => {});
        return identity;
    }

    async function afterLogin({ password, isAdmin }) {
        const userId = await currentUserId();
        if (!userId || !password) return { status: 'skipped' };
        const row = await fetchOwnRow(userId);
        if (!row) {
            const { identity, recoveryKey } = await createIdentity(userId, password);
            await withOrg(identity, isAdmin);
            return { status: 'created', recoveryKey };
        }
        try {
            const pkcs8 = await C.unwrapWithPassword(row.wrapped_by_password, password);
            await withOrg(await identityFromPkcs8(userId, pkcs8, row), isAdmin);
            return { status: 'unlocked' };
        } catch {
            return { status: 'needs-recovery' };
        }
    }

    async function recover({ recoveryKey, password, isAdmin }) {
        const userId = await currentUserId();
        const row = await fetchOwnRow(userId);
        const pkcs8 = await C.unwrapWithRecovery(row.wrapped_by_recovery, recoveryKey);
        const { error } = await sb
            .from('e2e_keys')
            .update({ wrapped_by_password: await C.wrapWithPassword(pkcs8, password) })
            .eq('user_id', userId);
        if (error) throw error;
        await withOrg(await identityFromPkcs8(userId, pkcs8, row), isAdmin);
    }

    async function resetIdentity({ password, isAdmin }) {
        const userId = await currentUserId();
        const { identity, recoveryKey } = await createIdentity(userId, password);
        await withOrg(identity, isAdmin);
        return recoveryKey;
    }

    async function rewrapPassword(oldPassword, newPassword) {
        const userId = await currentUserId();
        const row = await fetchOwnRow(userId);
        if (!row) return;
        const pkcs8 = await C.unwrapWithPassword(row.wrapped_by_password, oldPassword);
        const { error } = await sb
            .from('e2e_keys')
            .update({ wrapped_by_password: await C.wrapWithPassword(pkcs8, newPassword) })
            .eq('user_id', userId);
        if (error) throw error;
    }

    async function unlockWithPassword(password, isAdmin) {
        const userId = await currentUserId();
        const row = await fetchOwnRow(userId);
        if (!row) return false;
        const pkcs8 = await C.unwrapWithPassword(row.wrapped_by_password, password);
        await withOrg(await identityFromPkcs8(userId, pkcs8, row), isAdmin);
        return true;
    }

    async function isAdminSession() {
        const userId = await currentUserId();
        const { data } = await sb.from('profiles').select('profile').eq('id', userId).maybeSingle();
        return data?.profile === 'Administrador';
    }

    async function status() {
        const identity = await loaded();
        const userId = await currentUserId();
        const registered = Boolean(identity) || Boolean(userId && (await fetchOwnRow(userId).catch(() => null)));
        return { registered, unlocked: Boolean(identity), org: Boolean(identity?.org) };
    }

    async function ensureUnlocked() {
        const identity = await loaded();
        if (identity) return identity;
        const userId = await currentUserId();
        if (!userId || !(await fetchOwnRow(userId).catch(() => null))) return null;
        const isAdmin = await isAdminSession();
        const ok = await window.NexusE2EUI.promptPassword(async (password) => {
            try {
                return await unlockWithPassword(password, isAdmin);
            } catch {
                return false;
            }
        });
        return ok ? loaded() : null;
    }

    async function identities() {
        const identity = await ensureUnlocked();
        if (!identity) return [];
        return [identity, identity.org].filter(Boolean);
    }

    async function orgPublic() {
        const { data } = await sb.from('e2e_org_keys').select('public_key, fingerprint').eq('id', 'rh').maybeSingle();
        return data ? { publicJwk: data.public_key, fingerprint: data.fingerprint } : null;
    }

    async function recipientsFor(employeeId) {
        if (!employeeId) return null;
        const [{ data: emp }, org] = await Promise.all([sb.rpc('e2e_employee_key', { p_employee_id: employeeId }), orgPublic()]);
        const employee = Array.isArray(emp) ? emp[0] : emp;
        if (!employee?.public_key || !org) return null;
        return [{ publicJwk: employee.public_key, fingerprint: employee.fingerprint }, org];
    }

    async function encryptFile(bytes, { bucket, path, mime, employeeId }) {
        const recipients = await recipientsFor(employeeId);
        if (!recipients) return null;
        return C.encryptFile(bytes, { bucket, path, mime, recipients });
    }

    function encryptFileFor(bytes, { bucket, path, mime, recipients }) {
        return C.encryptFile(bytes, { bucket, path, mime, recipients });
    }

    async function decryptFile(bytes, { bucket, path }) {
        return C.decryptFile(bytes, { bucket, path, identities: await identities() });
    }

    const channelKeys = new Map();

    async function openChannelKey(identity, channelId, version) {
        const cacheKey = `${identity.fingerprint}:${channelId}:${version}`;
        if (channelKeys.has(cacheKey)) return channelKeys.get(cacheKey);
        const { data } = await sb
            .from('e2e_channel_keys')
            .select('wrapped_key')
            .eq('channel_id', channelId)
            .eq('key_version', version)
            .eq('recipient_fp', identity.fingerprint)
            .maybeSingle();
        if (!data) return null;
        const raw = await C.openSealed(identity.privateKey, data.wrapped_key, `chan:${channelId}:${version}`);
        channelKeys.set(cacheKey, raw);
        return raw;
    }

    async function channelRecipients(channelId, isDm) {
        const { data: members } = await sb.rpc('e2e_channel_member_keys', { p_channel: channelId });
        const all = members || [];
        const recipients = all.filter((m) => m.public_key).map((m) => ({ employeeId: m.employee_id, publicJwk: m.public_key, fingerprint: m.fingerprint }));
        if (isDm) return all.length === 2 && recipients.length === 2 ? { recipients, memberIds: all.map((m) => m.employee_id) } : null;
        const org = await orgPublic();
        if (!org) return null;
        return { recipients: [...recipients, { employeeId: null, ...org }], memberIds: all.map((m) => m.employee_id) };
    }

    async function channelKey(channelId, { isDm }) {
        const identity = await ensureUnlocked();
        if (!identity) return null;
        const info = await channelRecipients(channelId, isDm);
        if (!info || !info.recipients.some((r) => r.fingerprint === identity.fingerprint)) return null;

        const { data: rows } = await sb.from('e2e_channel_keys').select('key_version, recipient_fp, employee_id').eq('channel_id', channelId);
        const latest = Math.max(0, ...(rows || []).map((r) => r.key_version));
        const current = (rows || []).filter((r) => r.key_version === latest);
        const someoneLeft = current.some((r) => r.employee_id && !info.memberIds.includes(r.employee_id));

        if (latest && !someoneLeft && current.some((r) => r.recipient_fp === identity.fingerprint)) {
            const raw = await openChannelKey(identity, channelId, latest);
            if (raw) {
                const ctx = `chan:${channelId}:${latest}`;
                for (const r of info.recipients.filter((x) => !current.some((c) => c.recipient_fp === x.fingerprint))) {
                    await sb.from('e2e_channel_keys').insert({
                        channel_id: channelId,
                        key_version: latest,
                        recipient_fp: r.fingerprint,
                        employee_id: r.employeeId,
                        wrapped_key: await C.sealTo(r.publicJwk, raw, ctx),
                    });
                }
                return { raw, version: latest };
            }
        }

        const version = latest + 1;
        const raw = C.random(32);
        const ctx = `chan:${channelId}:${version}`;
        const entries = [];
        for (const r of info.recipients) {
            entries.push({
                channel_id: channelId,
                key_version: version,
                recipient_fp: r.fingerprint,
                employee_id: r.employeeId,
                wrapped_key: await C.sealTo(r.publicJwk, raw, ctx),
            });
        }
        const { error } = await sb.from('e2e_channel_keys').insert(entries);
        if (error) {
            const retry = await openChannelKey(identity, channelId, version);
            return retry ? { raw: retry, version } : null;
        }
        channelKeys.set(`${identity.fingerprint}:${channelId}:${version}`, raw);
        return { raw, version };
    }

    async function channelReady(channelId, { isDm }) {
        return Boolean(await channelKey(channelId, { isDm }).catch(() => null));
    }

    async function encryptMessage(text, { channelId, myEmployeeId, isDm }) {
        const key = await channelKey(channelId, { isDm });
        if (!key) return null;
        return C.encryptMessage(key.raw, text, { channelId, senderId: myEmployeeId, keyVersion: key.version });
    }

    async function decryptMessage(content, { channelId, senderId }) {
        const identity = await loaded();
        if (!identity) return null;
        const version = C.messageKeyVersion(content);
        if (!version) return null;
        for (const who of [identity, identity.org].filter(Boolean)) {
            const raw = await openChannelKey(who, channelId, version);
            if (raw) return C.decryptMessage(raw, content, { channelId, senderId });
        }
        return null;
    }

    return {
        afterLogin,
        recover,
        resetIdentity,
        rewrapPassword,
        ensureUnlocked,
        status,
        grantPendingAdmins,
        lock,
        recipientsFor,
        encryptFile,
        encryptFileFor,
        decryptFile,
        fileRecipients: C.fileRecipients,
        channelReady,
        encryptMessage,
        decryptMessage,
        isEncryptedMessage: C.isEncryptedMessage,
        isEncryptedFile: C.isEncryptedFile,
    };
})();
