const fs = require('fs');
const path = require('path');
const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect, login, switchUser, resetE2EData, COLAB, ADMIN } = require('./support.js');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const COLAB_TELAS = [
    'inicio-colaborador',
    'ponto-colaborador',
    'holerite-colaborador',
    'ferias-colaborador',
    'documentos-colaborador',
    'comunicados-colaborador',
    'chat-colaborador',
    'perfil-colaborador',
    'desempenho-colaborador',
    'equipe-colaborador',
];

const RH_TELAS = [
    'inicio-rh',
    'dashboard',
    'colaboradores',
    'pagamentos',
    'ferias',
    'arquivos',
    'comunicacao',
    'chat-rh',
    'banco-horas-rh',
    'alertas',
    'seguranca',
];

async function auditar(page, tela, testInfo, tema = 'claro') {
    await page.goto(`/src/screens/${tela}.html`);
    await page.waitForLoadState('networkidle');
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const graves = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const relatorio = JSON.stringify(violations, null, 2);
    await testInfo.attach(`axe-${tela}-${tema}.json`, { body: relatorio, contentType: 'application/json' });
    const dir = path.join(__dirname, '..', 'test-results', 'axe');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${tela}-${tema}.json`), relatorio);
    return graves.map((v) => `${tela} (${tema}): [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}×: ${v.nodes[0]?.target.join(' ')})`);
}

test.describe('Acessibilidade (axe-core, WCAG 2.1 AA)', () => {
    test.beforeEach(resetE2EData);
    test.setTimeout(240_000);

    test('telas públicas (login, política de privacidade) sem violações graves', async ({ page }, testInfo) => {
        const achados = [];
        for (const tela of ['login', 'privacidade']) achados.push(...(await auditar(page, tela, testInfo)));
        expect(achados).toEqual([]);
    });

    test('telas do colaborador sem violações graves', async ({ page }, testInfo) => {
        await login(page, COLAB, 'colaborador');
        const achados = [];
        for (const tela of COLAB_TELAS) achados.push(...(await auditar(page, tela, testInfo)));
        expect(achados).toEqual([]);
    });

    test('tema escuro: telas do colaborador e do RH sem violações graves', async ({ page }, testInfo) => {
        await page.addInitScript(() => localStorage.setItem('nexus-theme', 'dark'));
        await login(page, COLAB, 'colaborador');
        const achados = [];
        for (const tela of COLAB_TELAS) achados.push(...(await auditar(page, tela, testInfo, 'escuro')));
        await switchUser(page, ADMIN, 'Administrador');
        for (const tela of RH_TELAS) achados.push(...(await auditar(page, tela, testInfo, 'escuro')));
        expect(achados).toEqual([]);
    });

    test('telas do RH sem violações graves', async ({ page }, testInfo) => {
        await login(page, ADMIN, 'Administrador');
        const achados = [];
        for (const tela of RH_TELAS) achados.push(...(await auditar(page, tela, testInfo)));
        expect(achados).toEqual([]);
    });
});
