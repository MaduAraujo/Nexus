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
        await card.click();
        await expect(page.locator('#modal-body')).toContainText('reunião geral amanhã');
        await page.keyboard.press('Escape');
        await card.click();
        const lidas = async () => (await withServiceRole((db) => db.query('SELECT 1 FROM message_reads WHERE employee_id = $1', [COLAB.employeeId]))).rowCount;
        expect(await lidas()).toBe(0);
        await page.click('#btn-marcar-lido');
        await expect(page.locator('#modal-lido')).toBeVisible();
        await expect
            .poll(() => withServiceRole(async (db) => (await db.query('SELECT message_id FROM message_reads WHERE employee_id = $1', [COLAB.employeeId])).rows))
            .toEqual([{ message_id: msg.id }]);

        await switchUser(page, ADMIN, 'Administrador');
        await page.goto('/src/screens/comunicacao.html');
        await expect(page.locator('#stat-reads')).toHaveText('1');
        await page.click('#main-toggle-btn');
        await expect(page.locator(`#messages-list [data-id="${msg.id}"]`).first()).toBeVisible();
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
