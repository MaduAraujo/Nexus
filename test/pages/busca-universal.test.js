const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const BASE = 'http://localhost:4173/src/screens/';

function client() {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            vacations: [{ id: 'v1', employee_id: ANA.id, start_date: '2026-07-01', end_date: '2026-07-10', status: 'pendente' }],
            bank_requests: [{ id: 'b1', employee_id: BIA.id, tipo: 'credito', minutos: 90, date: '2026-06-10', status: 'pendente' }],
            documents: [{ id: 'd1', name: 'contrato-ana.pdf', employee_id: ANA.id, category: 'admissional' }],
        }),
    });
}

async function buscar(p, termo) {
    const input = p.$('.nexus-search-input');
    input.value = termo;
    input.dispatchEvent(new p.window.Event('input', { bubbles: true }));
    await p.settle(20);
    return p.$$('.nexus-search-item').map((el) => p.text(el));
}

describe('busca universal (Ctrl+K)', () => {
    test('Ctrl+K abre; Esc fecha', async () => {
        page = await openPage('inicio-rh', { client: client() });
        await page.key(page.document, 'k', { ctrlKey: true });
        assert.equal(page.$('.nexus-search-overlay').classList.contains('hidden'), false);
        await page.key(page.document, 'Escape');
        assert.equal(page.$('.nexus-search-overlay').classList.contains('hidden'), true);
        await page.key(page.document, 'K', { metaKey: true });
        await page.key(page.document, 'K', { metaKey: true });
        assert.equal(page.$('.nexus-search-overlay').classList.contains('hidden'), true);
    });

    test('encontra colaborador, férias, banco de horas, documento e telas', async () => {
        page = await openPage('inicio-rh', { client: client() });
        await page.click('.nexus-search-trigger');
        assert.ok((await buscar(page, 'ana')).some((t) => /Ana Souza/.test(t)));
        assert.ok((await buscar(page, 'contrato')).some((t) => /contrato-ana\.pdf/.test(t)));
        assert.ok((await buscar(page, 'férias')).some((t) => /Gestão de Férias/.test(t)));
        assert.match((await buscar(page, 'xyz-inexistente')).join(''), /^$/);
        assert.match(page.text('.nexus-search-results'), /Nenhum resultado para "xyz-inexistente"/);
    });

    test('setas navegam e Enter abre o resultado (deep link)', async () => {
        page = await openPage('inicio-rh', { client: client() });
        await page.click('.nexus-search-trigger');
        await buscar(page, 'Ana Souza');
        const input = page.$('.nexus-search-input');
        await page.key(input, 'ArrowDown');
        await page.key(input, 'ArrowUp');
        await page.key(input, 'Enter');
        assert.match(page.navigations[0], new RegExp(`^${BASE}colaboradores\\.html\\?emp=${ANA.id}$`));
    });

    test('clicar num resultado de telas navega', async () => {
        page = await openPage('inicio-rh', { client: client() });
        await page.click('.nexus-search-trigger');
        await buscar(page, 'pagamentos');
        await page.click(page.$$('.nexus-search-item').find((el) => /Pagamentos/.test(el.textContent)));
        assert.equal(page.navigations[0], `${BASE}pagamentos.html`);
    });

    test('dados são carregados uma vez só (cache)', async () => {
        const c = client();
        page = await openPage('inicio-rh', { client: c });
        await page.click('.nexus-search-trigger');
        await buscar(page, 'a');
        await buscar(page, 'an');
        assert.equal(c.calls.filter((x) => x.table === 'vacations').length, 1);
    });
});

describe('busca universal — bordas', () => {
    test('no Mac o atalho mostra ⌘; falha nas consultas deixa só as telas', async () => {
        page = await openPage('inicio-rh', {
            client: new FakeSupabase({
                user: RH_USER,
                tables: baseTables(),
                errors: { employees: { message: 'a' }, vacations: { message: 'b' }, bank_requests: { message: 'c' }, documents: { message: 'd' } },
            }),
            before(w) {
                Object.defineProperty(w.navigator, 'platform', { configurable: true, value: 'MacIntel' });
            },
        });
        assert.match(page.text('.nexus-search-trigger kbd'), /⌘ K/);
        await page.click('.nexus-search-trigger');
        const itens = await buscar(page, 'a');
        assert.ok(itens.length > 0);
        assert.ok(page.$$('.nexus-search-group').every((g) => g.textContent === 'Telas'));
    });

    test('dados incompletos: sem cargo/setor/e-mail, sem data, status desconhecido, pedido de alguém fora da lista e documento sem nome', async () => {
        const c = new FakeSupabase({
            user: RH_USER,
            tables: baseTables({
                vacations: [
                    { id: 'v1', employee_id: 'zzz-sumido', start_date: '2026-07-01', end_date: '2026-07-10', status: 'pendente' },
                    { id: 'v2', employee_id: 'e-orfa', start_date: null, end_date: null, status: 'cancelado' },
                ],
                bank_requests: [
                    { id: 'b1', employee_id: 'zzz-sumido', tipo: 'credito', minutos: 30, date: '2026-06-10', status: 'pendente' },
                    { id: 'b2', employee_id: 'e-orfa', tipo: 'debito', minutos: 15, date: '2026-06-11', status: 'estornado' },
                ],
                documents: [
                    { id: 'd1', name: null, employee_id: 'zzz-sumido', category: 'orfa' },
                    { id: 'd2', name: 'orfa-sem-categoria.pdf', employee_id: null, category: null },
                ],
            }),
        });
        c.tables.employees.push({ id: 'e-orfa', name: 'Órfã Sem Dados', dept: null, role: null, email: null });
        page = await openPage('inicio-rh', { client: c });
        await page.click('.nexus-search-trigger');
        const itens = await buscar(page, 'órfã');
        assert.ok(itens.some((t) => t === 'Órfã Sem Dados'));
        assert.ok(itens.some((t) => /^Órfã Sem Dados →\s+· cancelado$/.test(t)));
        assert.ok(itens.some((t) => /-15min · estornado/.test(t)));
        const docs = await buscar(page, 'orfa');
        assert.ok(docs.some((t) => t === 'orfa'));
        assert.ok(docs.some((t) => t === 'orfa-sem-categoria.pdf'));
    });

    test('digitar rápido enquanto os dados carregam reaproveita a mesma consulta', async () => {
        const c = client();
        page = await openPage('inicio-rh', { client: c });
        const antes = c.calls.filter((x) => x.table === 'employees').length;
        page.$('.nexus-search-trigger').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        const input = page.$('.nexus-search-input');
        input.value = 'a';
        input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
        input.value = 'an';
        input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
        await page.settle(20);
        assert.equal(c.calls.filter((x) => x.table === 'employees').length - antes, 1);
    });
});
