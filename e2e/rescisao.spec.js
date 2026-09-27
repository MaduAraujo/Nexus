const { test, expect, login, switchUser, resetE2EData, COLAB, ADMIN } = require('./support.js');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

test.describe('Rescisão (Supabase local real)', () => {
    test.beforeEach(resetE2EData);
    test.afterAll(resetE2EData);

    test('RH calcula, confirma o desligamento e o termo fica cifrado no Storage, legível para o RH', async ({ page }) => {
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO vacations (employee_id, start_date, end_date, days, status) VALUES ($1, current_date + 60, current_date + 69, 10, 'pendente')`,
                [COLAB.employeeId]
            )
        );

        await login(page, COLAB, 'colaborador');
        await switchUser(page, ADMIN, 'Administrador');

        await page.goto('/src/screens/pagamentos.html');
        await expect(page.locator('#folha-tbody tr', { hasText: COLAB.name })).toBeVisible();
        await page.click('[data-click="openRescisaoModal"]');
        await page.click('#rescisao-emp-trigger');
        await page.click(`#rescisao-emp-popover .select-option[data-value="${COLAB.employeeId}"]`);
        await expect(page.locator('#rescisao-admissao')).toHaveValue('02/01/2024');
        await page.click('#rescisao-data-trigger');
        const hoje = new Date();
        await page.locator('#rescisao-data-grid .calendar-day:not(.calendar-day--muted)', { hasText: new RegExp(`^${hoje.getDate()}$`) }).click();
        await page.click('#btn-calcular-rescisao');
        await expect(page.locator('#rescisao-result')).toContainText(/Saldo de salário/i);
        await page.click('#btn-confirmar-desligamento');
        await expect(page.locator('.toast', { hasText: 'Desligamento confirmado' })).toBeVisible({ timeout: 20000 });

        const dataStr = await page.inputValue('#rescisao-data');
        const estado = await withServiceRole(async (db) => ({
            emp: (await db.query('SELECT status, termination_date::text FROM employees WHERE id = $1', [COLAB.employeeId])).rows[0],
            ferias: (await db.query('SELECT status FROM vacations WHERE employee_id = $1', [COLAB.employeeId])).rows,
            docs: (await db.query('SELECT category, tipo, status, storage_path, retido_ate::text FROM documents WHERE employee_id = $1', [COLAB.employeeId]))
                .rows,
            audit: (await db.query('SELECT changes, operator_email FROM employee_audit WHERE employee_id = $1', [COLAB.employeeId])).rows,
        }));
        expect(estado.emp).toEqual({ status: 'Inativo', termination_date: dataStr });
        expect(estado.ferias).toEqual([{ status: 'recusado' }]);
        expect(estado.docs).toHaveLength(1);
        expect(estado.docs[0]).toMatchObject({ category: 'demissional', tipo: 'Termo de Rescisão', status: 'aprovado' });
        expect(estado.docs[0].retido_ate.slice(0, 4)).toBe(String(hoje.getFullYear() + 30));
        expect(estado.audit).toHaveLength(1);
        expect(estado.audit[0].changes, 'a trilha é gravada cifrada').not.toContain('Inativo');
        const audit = await withUser(
            { sub: ADMIN.userId, aal: 'aal2' },
            async (db) => (await db.query('SELECT changes, operator_email FROM employee_audit_decrypted WHERE employee_id = $1', [COLAB.employeeId])).rows
        );
        expect(audit).toHaveLength(1);
        expect(audit[0].operator_email).toBe(ADMIN.email);
        expect(audit[0].changes[0]).toMatchObject({ field: 'status', newValue: 'Inativo' });
        expect(audit[0].changes[1].newValue).toMatchObject({ dataDesligamento: dataStr });

        const guardado = await withServiceRole(
            async (db) =>
                (
                    await db.query(`SELECT metadata->>'size' AS size FROM storage.objects WHERE bucket_id = 'documents' AND name = $1`, [
                        estado.docs[0].storage_path,
                    ])
                ).rows
        );
        expect(guardado, 'o termo foi gravado no bucket documents').toHaveLength(1);

        await page.goto('/src/screens/arquivos.html');
        await expect(page.locator('#files-tbody tr').first()).toBeVisible({ timeout: 20000 });
        await page.click('.tab-btn[data-tab="demissional"]');
        await expect(page.locator('#files-tbody')).toContainText('rescisao_Colaborador_E2E.pdf', { timeout: 20000 });
        const aberto = await page.evaluate(async (p) => {
            const { blob, error } = await NexusFiles.download('documents', p);
            if (error) return { error: error.message };
            return { type: blob.type, head: new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5)) };
        }, estado.docs[0].storage_path);
        expect(aberto).toEqual({ type: 'application/pdf', head: '%PDF-' });
    });
});
