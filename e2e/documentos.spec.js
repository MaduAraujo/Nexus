const { test, expect, login, switchUser, resetE2EData, COLAB, ADMIN } = require('./support.js');
const { withServiceRole } = require('../test-support/pg-rls-client.js');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function abrirNoNavegador(page, storagePath) {
    return page.evaluate(async (p) => {
        const { blob, error } = await NexusFiles.download('documents', p);
        if (error) return { error: error.message };
        return { type: blob.type, head: new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 8)) };
    }, storagePath);
}

const docsDoColaborador = () =>
    withServiceRole(
        async (db) =>
            (await db.query('SELECT id, name, tipo, status, source, category, storage_path, version FROM documents WHERE employee_id = $1', [COLAB.employeeId]))
                .rows
    );

test.describe('Documentos do colaborador (Supabase local real)', () => {
    test.beforeEach(resetE2EData);
    test.afterAll(resetE2EData);

    test('colaborador envia, o arquivo vai cifrado ao Storage, o RH aprova e os dois conseguem abrir', async ({ page }) => {
        test.setTimeout(150_000);
        await login(page, ADMIN, 'Administrador');
        await switchUser(page, COLAB, 'colaborador');

        await page.goto('/src/screens/documentos-colaborador.html');
        await page.waitForFunction(() => typeof window.openUploadModal === 'function');
        await page.click('#btn-upload');
        await page.click('#upload-tipo-trigger');
        await page.click('#upload-tipo-popover .select-option[data-value="RG"]');
        await page.setInputFiles('#file-input', { name: 'rg-e2e.pdf', mimeType: 'application/pdf', buffer: PDF });
        await expect(page.locator('#file-selected-name')).toHaveText('rg-e2e.pdf');
        await page.click('#btn-submit-upload');
        await expect(page.locator('.toast', { hasText: 'rg-e2e.pdf foi enviado para análise do RH' })).toBeVisible();

        const [doc] = await docsDoColaborador();
        expect(doc).toMatchObject({ name: 'rg-e2e.pdf', tipo: 'RG', status: 'pendente', source: 'colaborador', category: null, version: 1 });
        expect(doc.storage_path.startsWith(`${COLAB.employeeId}/`)).toBe(true);
        const [objeto] = await withServiceRole(
            async (db) =>
                (await db.query(`SELECT metadata->>'mimetype' AS mime FROM storage.objects WHERE bucket_id = 'documents' AND name = $1`, [doc.storage_path]))
                    .rows
        );
        expect(objeto, 'o arquivo está no bucket documents, sem o tipo original exposto').toEqual({ mime: 'application/octet-stream' });
        await expect
            .poll(() => withServiceRole(async (db) => (await db.query('SELECT action FROM document_audit_log WHERE document_id = $1', [doc.id])).rows))
            .toEqual([{ action: 'criado' }]);

        await switchUser(page, ADMIN, 'Administrador');
        await page.goto('/src/screens/arquivos.html');
        await expect(page.locator('#files-tbody tr').first()).toBeVisible({ timeout: 20000 });
        await page.click('.tab-btn[data-tab="colaborador"]');
        const linha = page.locator('#files-tbody tr', { hasText: 'rg-e2e.pdf' });
        await expect(linha).toContainText(COLAB.name);
        await linha.locator('[data-click="approveColabDoc"]').click();
        await expect(page.locator('.toast', { hasText: 'Documento aprovado!' })).toBeVisible();

        const [aprovado] = await docsDoColaborador();
        expect(aprovado).toMatchObject({ status: 'aprovado', category: 'admissional' });
        await expect
            .poll(async () =>
                (await withServiceRole((db) => db.query('SELECT action FROM document_audit_log WHERE document_id = $1', [doc.id]))).rows
                    .map((r) => r.action)
                    .sort()
            )
            .toEqual(['aprovado', 'criado']);
        expect(await abrirNoNavegador(page, doc.storage_path)).toEqual({ type: 'application/pdf', head: '%PDF-1.4' });

        await switchUser(page, COLAB, 'colaborador');
        await page.goto('/src/screens/documentos-colaborador.html');
        await expect(page.locator('#doc-list')).toContainText('rg-e2e.pdf');
        await expect(page.locator('#doc-list .doc-card-item', { hasText: 'rg-e2e.pdf' })).toContainText('Aprovado');
        expect(await abrirNoNavegador(page, doc.storage_path)).toEqual({ type: 'application/pdf', head: '%PDF-1.4' });
    });

    test('colaborador não lê o arquivo de outra pessoa no Storage', async ({ page, supabaseErrors }) => {
        supabaseErrors.expect(/GET \/storage\/v1\/object\/documents\/.*segredo\.pdf → 4\d\d/);
        await login(page, ADMIN, 'Administrador');
        await page.goto('/src/screens/arquivos.html');
        const caminho = `${ADMIN.employeeId}/segredo.pdf`;
        await page.evaluate(
            async ({ caminho, pdf }) => {
                const { error } = await sb.storage.from('documents').upload(caminho, new Blob([new Uint8Array(pdf)]), { contentType: 'application/pdf' });
                if (error) throw new Error(error.message);
            },
            { caminho, pdf: [...PDF] }
        );

        await switchUser(page, COLAB, 'colaborador');
        const lido = await page.evaluate(async (p) => {
            const { data, error } = await sb.storage.from('documents').download(p);
            return { temDados: Boolean(data), erro: Boolean(error) };
        }, caminho);
        expect(lido).toEqual({ temDados: false, erro: true });
    });
});
