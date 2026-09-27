const { test, expect, login, switchUser, resetE2EData, COLAB, ADMIN } = require('./support.js');
const { withServiceRole, withUser } = require('../test-support/pg-rls-client.js');

const competencia = () => {
    const d = new Date();
    return { mes: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` };
};

test.describe('Folha de pagamento (Supabase local real)', () => {
    test.beforeEach(resetE2EData);
    test.afterAll(resetE2EData);

    test('RH marca o colaborador como pago, o holerite é gravado cifrado e o colaborador o vê', async ({ page }) => {
        const { mes, label } = competencia();

        await login(page, ADMIN, 'Administrador');
        await page.goto('/src/screens/pagamentos.html');
        const linha = page.locator('#folha-tbody tr', { hasText: COLAB.name });
        await expect(linha).toContainText('R$ 4.000,00');
        await linha.locator('.cb-row').check();
        await page.click('[data-click="marcarSelecionadosPagos"]');
        await expect(page.locator('.toast', { hasText: '1 colaborador marcado como pago' })).toBeVisible();
        await expect(page.locator('#folha-tbody tr', { hasText: COLAB.name })).toHaveCount(0);

        const bruto = await withServiceRole(async (db) => (await db.query('SELECT * FROM payslips WHERE employee_id = $1', [COLAB.employeeId])).rows);
        expect(bruto).toHaveLength(1);
        expect(bruto[0]).toMatchObject({ mes, status: 'pago', competencia: label });

        const slip = await withUser(
            { sub: ADMIN.userId, aal: 'aal2' },
            async (db) => (await db.query('SELECT * FROM payslips_decrypted WHERE employee_id = $1', [COLAB.employeeId])).rows[0]
        );
        expect(slip.proventos.map((p) => p.cod)).toContain('001');
        expect(slip.descontos.map((d) => d.cod)).toContain('901');
        expect(Number(slip.salario_liquido)).toBeCloseTo(Number(slip.total_proventos) - Number(slip.total_descontos), 2);

        await page.click('.tab-btn[data-click-args*="holerites"]');
        await page.locator('#hol-tbody tr', { hasText: COLAB.name }).locator('[data-click="verHolerite"]').click();
        await expect(page.locator('#slip-modal-sub')).toHaveText(`${COLAB.name} — ${label}`);
        await expect
            .poll(() =>
                withServiceRole(
                    async (db) => (await db.query('SELECT tipo, accessed_by_email FROM data_access_log WHERE employee_id = $1', [COLAB.employeeId])).rows
                )
            )
            .toContainEqual({ tipo: 'holerite', accessed_by_email: ADMIN.email });

        await switchUser(page, COLAB, 'colaborador');
        await page.goto('/src/screens/holerite-colaborador.html');
        await expect(page.locator('#month-count-badge')).toHaveText('1');
        await expect(page.locator('#doc-competencia')).toHaveText(`Competência: ${label}`);
        await expect(page.locator('#doc-name')).toHaveText(COLAB.name);
        await expect(page.locator('.payslip-status-badge')).toContainText('Pago');
        const liquido = Number(slip.salario_liquido).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        await expect(page.locator('#doc-liquido')).toContainText(liquido);
    });

    test('colaborador não enxerga o holerite de outra pessoa', async ({ page }) => {
        const { mes } = competencia();
        await withServiceRole((db) =>
            db.query(
                `INSERT INTO payslips (employee_id, mes, competencia, status, proventos, descontos, total_proventos, total_descontos, salario_liquido)
                 VALUES ($1, $2, 'x', 'pago', '[]', '[]', 1, 0, 1)`,
                [ADMIN.employeeId, mes]
            )
        );
        await login(page, COLAB, 'colaborador');
        await page.goto('/src/screens/holerite-colaborador.html');
        await expect(page.locator('#month-count-badge')).toHaveText('0');
    });
});
