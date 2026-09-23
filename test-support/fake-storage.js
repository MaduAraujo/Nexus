const enc = (text) => new TextEncoder().encode(text);

function fakeClient(initial = {}, { failUpload = () => false, corruptOnUpload = false } = {}) {
    const objects = new Map(Object.entries(initial));
    const uploads = [];
    const storage = {
        from(bucket) {
            return {
                async list(prefix, { limit, offset }) {
                    const base = prefix ? `${bucket}/${prefix}/` : `${bucket}/`;
                    const children = new Map();
                    for (const [full, obj] of objects) {
                        if (!full.startsWith(base)) continue;
                        const rest = full.slice(base.length);
                        const [head, ...tail] = rest.split('/');
                        if (tail.length) children.set(head, { name: head, id: null });
                        else children.set(head, { name: head, id: `id-${full}`, metadata: { mimetype: obj.mime } });
                    }
                    const sorted = [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
                    return { data: sorted.slice(offset, offset + limit), error: null };
                },
                async download(path) {
                    const obj = objects.get(`${bucket}/${path}`);
                    if (!obj) return { data: null, error: { message: 'Object not found' } };
                    return { data: new Blob([obj.bytes], { type: obj.mime }), error: null };
                },
                async upload(path, bytes, options) {
                    uploads.push({ bucket, path, options });
                    if (failUpload(path)) return { error: { message: 'boom' } };
                    objects.set(`${bucket}/${path}`, { bytes: corruptOnUpload ? enc('lixo') : new Uint8Array(bytes), mime: options.contentType });
                    return { error: null };
                },
            };
        },
    };
    return { storage, objects, uploads };
}

module.exports = { fakeClient };
