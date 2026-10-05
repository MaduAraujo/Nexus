const { test, expect, login, resetE2EData, COLAB, ADMIN } = require('./support.js');
const { withServiceRole } = require('../test-support/pg-rls-client.js');

const TABS = 25;

async function percorrer(page) {
    const vistos = [];
    for (let i = 0; i < TABS; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const cs = getComputedStyle(el);
            const visivel = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
            const r = el.getBoundingClientRect();
            const id = el.id ? `#${el.id}` : '';
            const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
            return { alvo: `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 90), visivel, tamanho: r.width > 0 && r.height > 0 };
        });
        if (info) vistos.push(info);
    }
    return vistos;
}

async function auditarTeclado(page, tela) {
    await page.goto(`/src/screens/${tela}.html`);
    await page.waitForLoadState('networkidle');
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    const vistos = await percorrer(page);
    const problemas = [];
    if (vistos.length < 3) problemas.push(`${tela}: o foco não percorre a tela (${vistos.length} parada(s))`);
    for (const v of vistos) {
        if (!v.tamanho) problemas.push(`${tela}: foco em elemento invisível ${v.alvo}`);
        else if (!v.visivel) problemas.push(`${tela}: sem indicador de foco em ${v.alvo}`);
    }
    return [...new Set(problemas)];
}

test.describe('Teclado (foco visível e navegável)', () => {
    test.beforeEach(resetE2EData);
    test.setTimeout(240_000);

    test('login: escolher o perfil e entrar só com o teclado', async ({ page }) => {
        await page.goto('/src/screens/login.html');
        await page.waitForLoadState('networkidle');
        expect(await auditarTeclado(page, 'login')).toEqual([]);
    });

    test('telas do colaborador', async ({ page }) => {
        await login(page, COLAB, 'colaborador');
        const problemas = [];
        for (const tela of [
            'inicio-colaborador',
            'ponto-colaborador',
            'holerite-colaborador',
            'ferias-colaborador',
            'documentos-colaborador',
            'comunicados-colaborador',
        ])
            problemas.push(...(await auditarTeclado(page, tela)));
        expect(problemas).toEqual([]);
    });

    test('comunicado: abrir, confirmar a leitura e fechar só com o teclado', async ({ page }) => {
        await withServiceRole((db) =>
            db.query(`INSERT INTO messages (texto, destino, categoria, created_by) VALUES ('Teclado E2E: aviso geral', 'Todos', 'Urgente', $1)`, [ADMIN.userId])
        );
        await login(page, COLAB, 'colaborador');
        await page.goto('/src/screens/comunicados-colaborador.html');
        const card = page.locator('.comunicado-card', { hasText: 'Teclado E2E' });
        await card.focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#msg-modal')).toBeVisible();
        await page.locator('#modal-ciencia').focus();
        await page.keyboard.press('Space');
        await expect(page.locator('#modal-ciencia')).toBeChecked();
        await page.keyboard.press('Tab');
        await expect(page.locator('#btn-marcar-lido')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.locator('#modal-lido')).toContainText('Ciência confirmada');
        await page.keyboard.press('Escape');
        await expect(page.locator('#msg-modal')).toBeHidden();
        const lidas = await withServiceRole(
            async (db) =>
                (await db.query('SELECT count(*)::int AS n FROM message_reads WHERE employee_id = $1 AND acknowledged_at IS NOT NULL', [COLAB.employeeId]))
                    .rows[0].n
        );
        expect(lidas).toBe(1);
    });

    test('telas do RH', async ({ page }) => {
        await login(page, ADMIN, 'Administrador');
        const problemas = [];
        for (const tela of ['inicio-rh', 'colaboradores', 'pagamentos', 'ferias', 'arquivos', 'banco-horas-rh'])
            problemas.push(...(await auditarTeclado(page, tela)));
        expect(problemas).toEqual([]);
    });
});
