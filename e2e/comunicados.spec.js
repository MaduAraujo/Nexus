const { test, expect, login, switchUser, resetE2EData, COLAB, ADMIN } = require('./support.js');
const { withServiceRole } = require('../test-support/pg-rls-client.js');

const MARCA = 'Comunicado E2E';

test.describe('Comunicados (Supabase local real)', () => {
    test.beforeEach(resetE2EData);
    test.afterAll(resetE2EData);

    test('RH envia para todos, o colaborador confirma a leitura e ela volta para o RH; o que não é para ele fica oculto', async ({ page }) => {
        await withServiceRole(async (db) => {
            await db.query(`INSERT INTO messages (texto, destino, categoria, created_by) VALUES ($1, 'Financeiro', 'Institucional', $2)`, [
                `${MARCA} só do Financeiro`,
                ADMIN.userId,
            ]);
            await db.query(
                `INSERT INTO messages (texto, destino, categoria, created_by, scheduled_at) VALUES ($1, 'Todos', 'Evento', $2, now() + interval '3 days')`,
                [`${MARCA} agendado`, ADMIN.userId]
            );
        });

        await login(page, ADMIN, 'Administrador');
        await page.goto('/src/screens/comunicacao.html');
        await page.click('#message-text');
        await page.keyboard.type(`${MARCA}: reunião geral amanhã`);
        await page.click('#dest-toggle-btn');
        await page.click('#dest-inline-grid [data-dest="Todos"]');
        await expect(page.locator('#send-btn')).toBeEnabled();
        await page.click('#send-btn');
        await expect(page.locator('#send-btn')).toContainText('Enviado!');

        const [msg] = await withServiceRole(
            async (db) => (await db.query(`SELECT id, texto, destino, categoria, scheduled_at FROM messages WHERE texto LIKE '%reunião geral%'`)).rows
        );
        expect(msg).toMatchObject({ destino: 'Todos', categoria: 'Institucional', scheduled_at: null });
        expect(msg.texto).toContain(`${MARCA}: reunião geral amanhã`);

        await switchUser(page, COLAB, 'colaborador');
        await page.goto('/src/screens/comunicados-colaborador.html');
        const cards = page.locator('#comunicados-list .comunicado-card');
        await expect(cards).toHaveCount(1);
        const card = page.locator(`#comunicados-list .comunicado-card[data-id="${msg.id}"]`);
        await expect(card).toHaveClass(/nao-lido/);
        const leituras = () =>
            withServiceRole(
                async (db) => (await db.query('SELECT message_id, acknowledged_at FROM message_reads WHERE employee_id = $1', [COLAB.employeeId])).rows
            );
        expect(await leituras()).toEqual([]);
        await card.click();
        await expect(page.locator('#modal-body')).toContainText('reunião geral amanhã');
        await expect(page.locator('#modal-lido')).toContainText('Leitura registrada');
        await expect(page.locator('#btn-marcar-lido')).toBeHidden();
        await expect.poll(leituras).toEqual([{ message_id: msg.id, acknowledged_at: null }]);
        await page.keyboard.press('Escape');
        await expect(card).not.toHaveClass(/nao-lido/);

        await switchUser(page, ADMIN, 'Administrador');
        await page.goto('/src/screens/comunicacao.html');
        await expect(page.locator('#stat-reads')).toHaveText('1');
        await page.click('#main-toggle-btn');
        await expect(page.locator(`#messages-list [data-id="${msg.id}"]`).first()).toBeVisible();
    });

    test('comunicado Urgente só conta como lido depois da ciência confirmada', async ({ page }) => {
        const [{ id }] = await withServiceRole(
            async (db) =>
                (
                    await db.query(`INSERT INTO messages (texto, destino, categoria, created_by) VALUES ($1, 'Todos', 'Urgente', $2) RETURNING id`, [
                        `${MARCA} urgente`,
                        ADMIN.userId,
                    ])
                ).rows
        );
        const leituras = () =>
            withServiceRole(
                async (db) => (await db.query('SELECT message_id, acknowledged_at FROM message_reads WHERE employee_id = $1', [COLAB.employeeId])).rows
            );

        await login(page, COLAB, 'colaborador');
        await page.goto('/src/screens/comunicados-colaborador.html');
        const card = page.locator(`#comunicados-list .comunicado-card[data-id="${id}"]`);
        await card.click();
        await expect(page.locator('#btn-marcar-lido')).toBeVisible();
        await expect(page.locator('#btn-marcar-lido')).toBeDisabled();
        await expect(page.locator('#modal-lido')).toBeHidden();
        await expect.poll(leituras).toEqual([{ message_id: id, acknowledged_at: null }]);
        await expect(card).toHaveClass(/nao-lido/);

        await page.check('#modal-ciencia');
        await page.click('#btn-marcar-lido');
        await expect(page.locator('#modal-lido')).toContainText('Ciência confirmada');
        await expect.poll(async () => (await leituras())[0]?.acknowledged_at).not.toBeNull();
        await page.keyboard.press('Escape');
        await expect(card).not.toHaveClass(/nao-lido/);
    });

    test('colaborador não consegue publicar comunicado', async ({ page, supabaseErrors }) => {
        supabaseErrors.expect(/POST \/rest\/v1\/messages → 403 .*row-level security/);
        await login(page, COLAB, 'colaborador');
        const erro = await page.evaluate(async () => {
            const { error } = await sb.from('messages').insert({ texto: 'forjado', destino: 'Todos', categoria: 'Urgente' });
            return error?.code;
        });
        expect(erro).toBe('42501');
        const forjados = await withServiceRole(async (db) => (await db.query(`SELECT count(*)::int AS n FROM messages WHERE texto = 'forjado'`)).rows[0].n);
        expect(forjados).toBe(0);
    });
});
