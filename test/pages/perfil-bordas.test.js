const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function client({ emp = {}, extra = {}, errors = {} } = {}) {
    const c = new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({ time_records: [], bank_adjustments: [], vacations: [], push_subscriptions: [], ...extra }),
        errors,
    });
    Object.assign(
        c.tables.employees_decrypted.find((e) => e.id === ANA.id),
        emp
    );
    return c;
}

describe('perfil-colaborador.html — bordas', () => {
    test('cadastro sem cargo, setor, situação e contrato; admissão num dia do mês ainda não alcançado', async () => {
        page = await openPage('perfil-colaborador', {
            client: client({ emp: { name: 'Ana  Souza', role: null, dept: null, status: null, contract_type: null, admission_date: '2025-06-20' } }),
            now: NOW,
        });
        assert.equal(page.text('#profile-avatar'), 'AS');
        assert.equal(page.text('#profile-hero-sub'), '— · —');
        assert.match(page.text('#profile-status-badge'), /Ativo/);
        assert.equal(page.text('#prof-role'), '—');
        assert.equal(page.text('#prof-status'), 'Ativo');
        assert.match(page.text('#prof-highlight-ferias'), /Faltam 1 mês\(es\)/);
    });

    test('situação "Férias" e outra situação mudam a cor do selo', async () => {
        page = await openPage('perfil-colaborador', { client: client({ emp: { status: 'Férias' } }), now: NOW });
        assert.equal(page.$('#profile-status-badge i').dataset.color, '#facc15');
        page.close();
        page = await openPage('perfil-colaborador', { client: client({ emp: { status: 'Afastado' } }), now: NOW });
        assert.equal(page.$('#profile-status-badge i').dataset.color, '#f87171');
    });

    test('falha ao ler ponto, ajustes e férias não quebra o banco de horas nem o saldo de férias', async () => {
        page = await openPage('perfil-colaborador', {
            client: client({ errors: { time_records: { message: 'a' }, bank_adjustments: { message: 'b' }, vacations: { message: 'c' } } }),
            now: NOW,
        });
        assert.equal(page.text('#prof-banco-value'), '0h 00min');
        assert.match(page.text('#prof-highlight-ferias'), /60 dias/);
    });

    test('preferências gravadas em formato inválido voltam ao padrão; desativar avisa', async () => {
        const c = client({ emp: { notif_prefs: 'corrompido' } });
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        assert.equal(page.$('#notif-ferias').checked, true);
        await page.eval(`saveNotifPref('ferias', false)`);
        await page.settle();
        assert.ok(page.toasts().includes('Notificação desativada.'));
        assert.equal(c.writes('employees', 'update').at(-1).payload.notif_prefs.ferias, false);
    });

    test('preferências gravadas são mantidas ao salvar outra', async () => {
        const c = client({
            emp: { notif_prefs: { ferias: false } },
            extra: {
                bank_adjustments: [
                    { employee_id: ANA.id, tipo: 'debito', minutos: 45, deleted_at: null },
                    { employee_id: ANA.id, tipo: 'credito', minutos: 15, deleted_at: null },
                ],
            },
        });
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        assert.equal(page.$('#notif-ferias').checked, false);
        assert.equal(page.text('#prof-banco-value'), '-0h 30min');
        await page.eval(`saveNotifPref('ponto', true)`);
        await page.settle();
        assert.deepEqual({ ...c.writes('employees', 'update').at(-1).payload.notif_prefs }, { ferias: false, ponto: true });
    });

    test('sem preferências gravadas usa o padrão ao salvar', async () => {
        const c = client({ emp: { notif_prefs: null } });
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        await page.eval(`saveNotifPref('ponto', true)`);
        await page.settle();
        assert.equal(c.writes('employees', 'update').at(-1).payload.notif_prefs.ponto, true);
    });

    test('push: inscrição existente é sincronizada ao abrir; sem suporte, desativar não quebra', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW, push: { permission: 'granted', subscribed: true } });
        await page.settle();
        assert.equal(page.$('#notif-push-browser').checked, true);
        assert.equal(c.writes('push_subscriptions', 'upsert').length, 1);
        page.close();
        page = await openPage('perfil-colaborador', { client: client(), now: NOW });
        await page.eval('togglePushNotifications(false)');
        assert.ok(page.toasts().includes('Notificações push desativadas.'));
    });

    test('foto: seleção vazia não faz nada', async () => {
        const c = client();
        page = await openPage('perfil-colaborador', { client: c, now: NOW });
        await page.eval('handlePhotoUpload({ target: { files: [] } })');
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('menus perto da borda da tela abrem para dentro; rolar e redimensionar reposicionam só o que está aberto; clique fora fecha as cores', async () => {
        page = await openPage('perfil-colaborador', {
            client: client(),
            now: NOW,
            before(w) {
                Object.defineProperty(w, 'innerWidth', { configurable: true, value: 150 });
                Object.defineProperty(w, 'innerHeight', { configurable: true, value: 100 });
            },
        });
        await page.eval('openColorPicker()');
        const picker = page.$('#color-picker');
        assert.equal(picker.style.left, '-58px');
        assert.equal(picker.style.top, '-168px');
        picker.style.left = '';
        page.window.dispatchEvent(new page.window.Event('scroll'));
        assert.equal(picker.style.left, '-58px');
        picker.style.left = '';
        page.window.dispatchEvent(new page.window.Event('resize'));
        assert.equal(picker.style.left, '-58px');
        await page.click(page.document.body);
        assert.equal(picker.classList.contains('open'), false);
        await page.eval('toggleAvatarMenu()');
        const menu = page.$('#avatar-menu');
        menu.style.left = '';
        page.window.dispatchEvent(new page.window.Event('scroll'));
        assert.equal(menu.style.left, '-58px');
        menu.style.left = '';
        page.window.dispatchEvent(new page.window.Event('resize'));
        assert.equal(menu.style.left, '-58px');
    });
});
