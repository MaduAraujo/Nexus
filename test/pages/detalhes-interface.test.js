const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, COLAB_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const BASE = 'http://localhost:4173/src/screens/';
const LOGIN = `${BASE}login.html`;

function semTimers(w, limites = [400, 4000]) {
    const original = w.setTimeout;
    w.setTimeout = (fn, ms, ...a) => (limites.includes(ms) ? (fn(...a), 0) : original(fn, ms, ...a));
    return () => (w.setTimeout = original);
}

describe('index.html — barra de navegação e brilho dos cartões', () => {
    test('a barra ganha fundo ao rolar e perde ao voltar ao topo', async () => {
        page = await openPage('/index.html', { client: new FakeSupabase({}) });
        const w = page.window;
        Object.defineProperty(w, 'scrollY', { configurable: true, writable: true, value: 50 });
        w.dispatchEvent(new w.Event('scroll'));
        assert.ok(page.$('#navbar').classList.contains('scrolled'));
        w.scrollY = 0;
        w.dispatchEvent(new w.Event('scroll'));
        assert.equal(page.$('#navbar').classList.contains('scrolled'), false);
    });

    test('o brilho do cartão segue o mouse', async () => {
        page = await openPage('/index.html', { client: new FakeSupabase({}) });
        const card = page.$('.feat-card');
        card.getBoundingClientRect = () => ({ left: 100, top: 200, width: 200, height: 100 });
        card.dispatchEvent(new page.window.MouseEvent('mousemove', { clientX: 150, clientY: 275 }));
        assert.equal(card.style.getPropertyValue('--mx'), '25%');
        assert.equal(card.style.getPropertyValue('--my'), '75%');
    });
});

describe('holerite-colaborador.html — comparativo, informe e impressão', () => {
    const slip = (id, mes, liquido) => ({
        id,
        employee_id: ANA.id,
        mes,
        mes_formatado: mes,
        competencia: mes.slice(5, 7) + '/' + mes.slice(0, 4),
        status: 'pago',
        proventos: [{ cod: '001', descricao: 'Salário Base', referencia: '30 dias', valor: 4000 }],
        descontos: [{ cod: '901', descricao: 'INSS', referencia: '9%', valor: 360 }],
        total_proventos: 4000,
        total_descontos: 360,
        salario_liquido: liquido,
    });
    const client = () =>
        new FakeSupabase({ user: COLAB_USER, tables: baseTables({ payslips_decrypted: [slip('p1', '2025-12', 3640), slip('p2', '2026-06', 3640)] }) });

    test('reabrir o comparativo descarta o gráfico anterior antes de desenhar outro', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        await page.click('[data-click="openComparativoModal"]');
        page.window.closeComparativoModal();
        await page.click('[data-click="openComparativoModal"]');
        assert.equal(page.charts.length, 2);
        assert.equal(page.charts[0].destroyed, true);
        assert.notEqual(page.charts[1].destroyed, true);
    });

    test('seletor de ano do informe: troca o ano, fecha com Esc e com clique fora', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        await page.click('[data-click="openInformeModal"]');
        const pop = page.$('#informe-year-popover');
        await page.click('#informe-year-trigger');
        assert.ok(pop.classList.contains('open'));
        await page.key(page.document, 'a');
        assert.ok(pop.classList.contains('open'));
        await page.key(page.document, 'Escape');
        assert.equal(pop.classList.contains('open'), false);
        await page.click('#informe-year-trigger');
        await page.click(pop);
        assert.ok(pop.classList.contains('open'), 'clique dentro não fecha');
        await page.click(page.$('#informe-modal'));
        assert.equal(pop.classList.contains('open'), false);
    });

    test('depois de imprimir o informe, a página volta ao normal', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        const w = page.window;
        w.document.body.classList.add('printing-informe');
        w.document.title = 'Informe de Rendimentos 2025';
        w.dispatchEvent(new w.Event('afterprint'));
        assert.equal(w.document.body.classList.contains('printing-informe'), false);
        assert.equal(w.document.title, 'Holerites');
        assert.ok(page.$('#informe-print-doc').classList.contains('hidden'));
    });

    test('o aviso some sozinho depois de alguns segundos', async () => {
        page = await openPage('holerite-colaborador', { client: client() });
        const restaurar = semTimers(page.window);
        page.window.showToast('Aviso de teste');
        restaurar();
        assert.deepEqual(page.toasts(), []);
    });
});

describe('busca universal — abrir cada tipo de resultado', () => {
    const client = () =>
        new FakeSupabase({
            user: RH_USER,
            tables: baseTables({
                vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2026-07-01', end_date: '2026-07-10', status: 'pendente' }],
                bank_requests: [{ id: 'b1', employee_id: BIA.id, tipo: 'debito', minutos: 90, date: '2026-06-10', status: 'pendente' }],
                documents: [
                    { id: 'd1', name: 'contrato-ana.pdf', employee_id: ANA.id, category: 'admissional' },
                    { id: 'd2', name: 'politica-geral.pdf', employee_id: null, category: 'institucional' },
                ],
            }),
        });
    async function buscar(p, termo) {
        const input = p.$('.nexus-search-input');
        input.value = termo;
        input.dispatchEvent(new p.window.Event('input', { bubbles: true }));
        await p.settle(20);
    }
    const item = (p, re) => p.$$('.nexus-search-item').find((el) => re.test(el.textContent));

    test('férias, banco de horas e documentos levam direto ao registro', async () => {
        page = await openPage('inicio-rh', { client: client() });
        await page.click('.nexus-search-trigger');

        await buscar(page, 'ana');
        await page.click(item(page, /01\/07\/2026/));
        await buscar(page, 'bia');
        await page.click(item(page, /-90min/));
        await buscar(page, 'contrato');
        await page.click(item(page, /contrato-ana\.pdf/));
        await buscar(page, 'politica');
        await page.click(item(page, /politica-geral\.pdf/));
        assert.deepEqual(page.navigations, [
            `${BASE}ferias.html?req=v1`,
            `${BASE}banco-horas-rh.html?req=b1`,
            `${BASE}arquivos.html?colaborador=${ANA.id}`,
            `${BASE}arquivos.html`,
        ]);
    });

    test('passar o mouse marca o resultado e Enter abre o marcado', async () => {
        page = await openPage('inicio-rh', { client: client() });
        await page.click('.nexus-search-trigger');
        await buscar(page, 'contrato');
        const alvo = item(page, /contrato-ana\.pdf/);
        alvo.dispatchEvent(new page.window.MouseEvent('mouseenter'));
        assert.ok(alvo.classList.contains('active'));
        await page.key(page.$('.nexus-search-input'), 'Enter');
        assert.deepEqual(page.navigations, [`${BASE}arquivos.html?colaborador=${ANA.id}`]);
        await page.key(page.$('.nexus-search-input'), 'Escape');
        assert.ok(page.$('.nexus-search-overlay').classList.contains('hidden'));
    });
});

describe('inicio-colaborador.html — menu, sair e avisos', () => {
    const client = () =>
        new FakeSupabase({
            user: COLAB_USER,
            tables: baseTables({ messages: [], onboarding_tasks: [], onboarding_progress: [], vacations: [], documents: [] }),
        });

    test('menu aberto no celular fecha sozinho ao virar tela grande', async () => {
        page = await openPage('inicio-colaborador', {
            client: client(),
            before: (w) => Object.defineProperty(w, 'innerWidth', { configurable: true, writable: true, value: 390 }),
        });
        await page.click('#topbar-menu-btn');
        assert.ok(page.$('#sidebar').classList.contains('open'));
        page.window.dispatchEvent(new page.window.Event('resize'));
        assert.ok(page.$('#sidebar').classList.contains('open'), 'ainda no celular');
        page.window.innerWidth = 1280;
        page.window.dispatchEvent(new page.window.Event('resize'));
        assert.equal(page.$('#sidebar').classList.contains('open'), false);
    });

    test('sair encerra a sessão e volta ao login; o aviso some sozinho', async () => {
        const c = client();
        page = await openPage('inicio-colaborador', { client: c });
        const restaurar = semTimers(page.window);
        page.window.showToast('Aviso de teste');
        restaurar();
        assert.deepEqual(page.toasts(), []);
        await page.window.logout();
        assert.ok(c.calls.some((x) => x.auth === 'signOut'));
        assert.deepEqual(page.navigations, [LOGIN]);
    });
});
