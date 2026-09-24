const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');

let page;
afterEach(() => page?.close());

const CELULAR = ['(max-width: 768px)'];
const APP_INSTALADO = ['(display-mode: standalone)'];
const sessao = (uid) => JSON.stringify({ access_token: 'x', user: { id: uid } });

describe('index.html (página pública)', () => {
    test('no computador fica na landing: menu mobile abre/fecha, âncoras rolam e contadores animam', async () => {
        page = await openPage('/index.html', { client: new FakeSupabase({}) });
        assert.deepEqual(page.navigations, []);
        assert.deepEqual(page.pageErrors.map(String), []);

        await page.click('#btn-hamburger');
        assert.equal(page.$('#mobile-menu').getAttribute('aria-hidden'), 'false');
        assert.equal(page.$('#btn-hamburger').getAttribute('aria-expanded'), 'true');
        await page.key(page.document, 'Escape');
        assert.equal(page.$('#mobile-menu').classList.contains('active'), false);

        await page.click('#btn-hamburger');
        await page.click('.mobile-link[href="#features"]');
        assert.equal(page.$('#mobile-menu').classList.contains('active'), false, 'clicar num link fecha o menu');

        const contador = page.$('.stat-num[data-target="3"]');
        await page.waitFor(() => contador.textContent === '3', { message: 'contador chega ao alvo' });
        assert.ok(page.$$('.reveal.visible').length > 0);
    });

    test('app instalado sem sessão abre direto o login', async () => {
        page = await openPage('/index.html', { client: new FakeSupabase({}), media: APP_INSTALADO });
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/login.html']);
    });

    test('celular com sessão volta para a última tela do mesmo usuário', async () => {
        page = await openPage('/index.html', {
            client: new FakeSupabase({}),
            media: CELULAR,
            localStorage: {
                'sb-proj-colab-auth-token': sessao('u-ana'),
                'nexus:last-screen': { path: '/src/screens/ferias-colaborador.html', uid: 'u-ana' },
            },
        });
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/ferias-colaborador.html']);
    });

    test('última tela de outro usuário é ignorada: vai para o início do perfil da sessão', async () => {
        page = await openPage('/index.html', {
            client: new FakeSupabase({}),
            media: CELULAR,
            localStorage: {
                'sb-proj-rh-auth-token': sessao('u-rh'),
                'nexus:last-screen': { path: '/src/screens/ferias-colaborador.html', uid: 'u-ana' },
            },
        });
        assert.deepEqual(page.navigations, ['http://localhost:4173/src/screens/inicio-rh.html']);
    });

    test('?landing força a página pública mesmo no celular', async () => {
        page = await openPage('/index.html', {
            client: new FakeSupabase({}),
            media: CELULAR,
            query: '?landing',
            localStorage: { 'sb-proj-rh-auth-token': sessao('u-rh') },
        });
        assert.deepEqual(page.navigations, []);
    });
});
