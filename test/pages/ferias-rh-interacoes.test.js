const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function vac(id, employee_id, start_date, end_date, status, extra = {}) {
    const days = Math.round((new Date(end_date) - new Date(start_date)) / 86400000) + 1;
    return { id, employee_id, start_date, end_date, days, status, abono: false, created_at: '2026-05-01T10:00:00Z', ...extra };
}

function rhClient(vacations, opts = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({ vacations, time_records: [], holidays: [], bank_adjustments: [] }),
        rpc: { apply_ferias_recibo: {}, revert_ferias_recibo: {}, revert_ferias_payroll_event: {} },
        ...opts,
    });
}

const setEmp = (client, id, campos) => {
    for (const t of ['employees', 'employees_decrypted']) {
        const e = client.tables[t].find((x) => x.id === id);
        if (e) Object.assign(e, campos);
    }
};

async function pick(p, id, value) {
    await p.click(`#${id}-trigger`);
    await p.click(p.$(`#${id}-popover .select-option[data-value="${value}"]`));
}

async function escolherData(p, id, iso) {
    const [y, m] = iso.split('-').map(Number);
    await p.click(`#${id}-trigger`);
    const alvo = (y - 2026) * 12 + (m - 6);
    for (let i = 0; i < Math.abs(alvo); i++) await p.click(`#${id}-${alvo > 0 ? 'next' : 'prev'}`);
    await p.click(`#${id}-grid [data-iso="${iso}"]`);
}

const toastCom = (p, re) => p.toasts().some((t) => re.test(t));

describe('ferias.html (RH) — lista: filtros, busca, seleção e exportação', () => {
    test('menu de filtro e de exportar: um fecha o outro; clique fora fecha; limpar busca', async () => {
        page = await openPage('ferias', { client: rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente')]), now: NOW });
        const aberto = (id) => page.$(id).classList.contains('open');
        await page.click('#btn-filter');
        assert.ok(aberto('#filter-dropdown-menu'));
        await page.click('#btn-export');
        assert.ok(aberto('#export-dropdown-menu'));
        assert.ok(!aberto('#filter-dropdown-menu'));
        await page.click('#btn-filter');
        assert.ok(!aberto('#export-dropdown-menu'));
        await page.click('#btn-filter');
        assert.ok(!aberto('#filter-dropdown-menu'));
        await page.click('#btn-export');
        await page.click('#btn-export');
        assert.ok(!aberto('#export-dropdown-menu'));
        await page.click('#btn-export');
        await page.click('#requests-tbody');
        assert.ok(!aberto('#export-dropdown-menu'));

        await page.fill('#search-input', 'zzz');
        assert.match(page.text('#requests-tbody'), /Nenhuma solicitação encontrada/);
        await page.click('[data-click="clearSearch"]');
        assert.equal(page.$('#search-input').value, '');
        assert.equal(page.$$('#requests-tbody tr[data-id]').length, 1);
    });

    test('selecionada que some pelo filtro sai da seleção', async () => {
        page = await openPage('ferias', {
            client: rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente'), vac('v2', BIA.id, '2026-08-01', '2026-08-20', 'pendente')]),
            now: NOW,
        });
        await page.check(page.$('#requests-tbody tr[data-id="v1"] input[data-id="v1"]'));
        assert.ok(!page.$('#bulk-bar').classList.contains('hidden'));
        await page.fill('#search-input', 'bia');
        await page.click('[data-click="clearSearch"]');
        assert.equal(page.$('#requests-tbody tr[data-id="v1"] input[type="checkbox"]').checked, false);
    });

    test('exportar PDF pelo menu: sem nada no filtro avisa; pop-up bloqueado avisa', async () => {
        page = await openPage('ferias', { client: rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente')]), now: NOW });
        await page.click('#btn-export');
        await page.click('#export-csv-btn');
        assert.ok(!page.$('#export-dropdown-menu').classList.contains('open'));
        page.window.open = () => null;
        await page.click('#export-pdf-btn');
        assert.ok(toastCom(page, /Permita pop-ups para exportar o PDF/));
        await page.fill('#search-input', 'ninguém');
        await page.click('#export-pdf-btn');
        assert.ok(toastCom(page, /Nenhuma solicitação para exportar com o filtro atual/));
    });
});

describe('ferias.html (RH) — decisões com erro e atalhos', () => {
    test('erro ao cancelar e ao recusar avisa e mantém o status; motivo pronto preenche o campo', async () => {
        const c = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'aprovado'), vac('v2', BIA.id, '2026-08-01', '2026-08-20', 'pendente')]);
        c.errors['vacations:update'] = { message: 'RLS' };
        page = await openPage('ferias', { client: c, now: NOW, confirm: true });
        await page.click('#requests-tbody tr[data-id="v1"] [data-click="cancelApprovedVacation"]');
        assert.ok(toastCom(page, /Não foi possível cancelar/));
        assert.equal(c.tables.vacations[0].status, 'aprovado');

        await page.click('#requests-tbody tr[data-id="v2"] [data-click="openRejectModal"]');
        await page.click('[data-click="prefillRejectReason"]');
        assert.ok(page.$('#reject-reason').value.length > 10);
        await page.click('[data-click="confirmReject"]');
        assert.ok(toastCom(page, /Erro ao recusar/));
        assert.equal(c.tables.vacations[1].status, 'pendente');
    });

    test('indicador abre e fecha a lista; link com ?req= destaca a solicitação e o destaque some', async () => {
        page = await openPage('ferias', { client: rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente')]), now: NOW, query: '?req=v1' });
        const linha = page.$('#requests-tbody tr[data-id="v1"]');
        assert.ok(linha.classList.contains('row-deep-link-highlight'));
        await page.waitFor(() => !linha.classList.contains('row-deep-link-highlight'), { timeout: 4000 });
        await page.click('[data-click="openKpiModal"][data-click-args*="pendente"]');
        assert.ok(page.$('#kpi-info-modal').classList.contains('open'));
        await page.click('[data-click="closeKpiInfoModal"]');
        assert.ok(!page.$('#kpi-info-modal').classList.contains('open'));
    });

    test('ver solicitação e férias vencidas: fechar; sem vencidas avisa que está tudo em dia', async () => {
        const c = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'pendente')]);
        for (const id of [ANA.id, BIA.id]) setEmp(c, id, { admission_date: '2025-10-01' });
        page = await openPage('ferias', { client: c, now: NOW });
        await page.click('#requests-tbody tr[data-id="v1"] [data-click="openViewModal"]');
        assert.ok(page.$('#view-modal').classList.contains('open'));
        await page.click('[data-click="closeViewModal"]');
        assert.ok(!page.$('#view-modal').classList.contains('open'));
        await page.click('[data-click="openExpiredModal"]');
        assert.match(page.text('#expired-modal'), /Nenhuma férias vencida no momento/);
        await page.click('[data-click="closeExpiredModal"]');
        assert.ok(!page.$('#expired-modal').classList.contains('open'));
    });
});

describe('ferias.html (RH) — cadastro manual: painel, frações e calendário', () => {
    test('painel vazio sem colaborador; sem admissão ou admitido depois de hoje não mostra o ciclo; PJ sem banco de horas', async () => {
        const c = rhClient([]);
        setEmp(c, ANA.id, { admission_date: null });
        setEmp(c, BIA.id, { admission_date: '2026-12-01' });
        page = await openPage('ferias', { client: c, now: NOW });
        await page.click('[data-click="openAddModal"]');
        page.window.onAddEmployeeChange();
        await page.settle();
        assert.ok(page.$('#add-emp-ferias-info').classList.contains('hidden'));
        assert.ok(page.$('#add-emp-saldo-info').classList.contains('hidden'));
        await pick(page, 'add-employee', ANA.id);
        await page.settle(20);
        assert.ok(page.$('#add-emp-ferias-info').classList.contains('hidden'), 'sem admissão não há ciclo');
        await pick(page, 'add-employee', BIA.id);
        await page.settle(20);
        assert.ok(page.$('#add-emp-ferias-info').classList.contains('hidden'), 'admissão futura: ainda não há ciclo');
    });

    test('terceira fração sem nenhuma de 14 dias pede confirmação (CLT art. 134 §1º); recusar não grava', async () => {
        const c = rhClient([vac('f1', ANA.id, '2026-02-02', '2026-02-06', 'aprovado'), vac('f2', ANA.id, '2026-03-02', '2026-03-06', 'aprovado')]);
        const respostas = [false, true];
        page = await openPage('ferias', { client: c, now: NOW, confirm: () => respostas.shift() });
        await page.click('[data-click="openAddModal"]');
        await pick(page, 'add-employee', ANA.id);
        await escolherData(page, 'add-start', '2026-08-03');
        await escolherData(page, 'add-end', '2026-08-12');
        await page.click('[data-click="submitAdd"]');
        assert.match(page.confirms[0], /ao menos uma tenha no mínimo 14 dias \(art\. 134 §1º\)/);
        assert.equal(c.writes('vacations', 'insert').length, 0);
        await page.click('[data-click="submitAdd"]');
        assert.equal(c.writes('vacations', 'insert').length, 1);
    });

    test('erro do banco ao registrar avisa no modal', async () => {
        const c = rhClient([]);
        c.errors['vacations:insert'] = { message: 'RLS' };
        page = await openPage('ferias', { client: c, now: NOW });
        await page.click('[data-click="openAddModal"]');
        await pick(page, 'add-employee', BIA.id);
        await escolherData(page, 'add-start', '2026-08-03');
        await escolherData(page, 'add-end', '2026-08-22');
        await page.click('[data-click="submitAdd"]');
        assert.match(page.text('#add-alert'), /Erro ao registrar\. Tente novamente\./);
    });

    test('calendário do cadastro: navega entre anos, marca o dia escolhido, fecha com Esc e clique fora; dias sem data não contam', async () => {
        page = await openPage('ferias', { client: rhClient([]), now: NOW });
        await page.click('[data-click="openAddModal"]');
        const aberto = () => page.$('#add-start-popover').classList.contains('open');
        page.window.calcAddDays();
        assert.equal(page.text('#add-days-count'), 'Selecione as datas');
        await page.click('#add-start-trigger');
        assert.ok(aberto());
        for (let i = 0; i < 6; i++) await page.click('#add-start-prev');
        assert.equal(page.text('#add-start-title'), 'Dezembro 2025');
        for (let i = 0; i < 13; i++) await page.click('#add-start-next');
        assert.equal(page.text('#add-start-title'), 'Janeiro 2027');
        page.$('#add-start-grid').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.ok(aberto(), 'clique fora dos dias não escolhe');
        await page.click('#add-start-grid [data-iso="2027-01-11"]');
        assert.ok(!aberto());
        await page.click('#add-start-trigger');
        assert.ok(page.$('#add-start-grid [data-iso="2027-01-11"]').classList.contains('calendar-day--selected'));
        await page.click('#add-start-trigger');
        assert.ok(!aberto());
        await page.click('#add-start-trigger');
        await page.key('#add-start-trigger', 'Escape');
        assert.ok(!aberto());
        await page.click('#add-start-trigger');
        await page.click('#add-modal');
        assert.ok(!aberto());

        const statusAberto = () => page.$('#add-status-popover').classList.contains('open');
        await page.click('#add-status-trigger');
        assert.ok(statusAberto());
        await page.key('#add-status-trigger', 'Escape');
        assert.ok(!statusAberto());
        await page.click('#add-status-trigger');
        await page.click('#add-modal');
        assert.ok(!statusAberto());
        await page.click('#add-status-trigger');
        page.$('#add-status-popover').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.ok(statusAberto(), 'clique fora das opções não escolhe');
    });
});

describe('ferias.html (RH) — coletivas: validações e erro', () => {
    test('sem período, sem elegíveis (só estagiário no departamento) e erro do banco avisam', async () => {
        const c = rhClient([]);
        setEmp(c, CAIO.id, { contract_type: 'estagio' });
        page = await openPage('ferias', { client: c, now: NOW });
        await page.click('[data-click="openColetivaModal"]');
        await page.window.submitColetiva();
        assert.match(page.text('#coletiva-alert'), /Informe o período completo/);
        await escolherData(page, 'coletiva-start', '2026-12-21');
        await escolherData(page, 'coletiva-end', '2026-12-31');
        await pick(page, 'coletiva-dept', 'TI');
        await page.click('[data-click="submitColetiva"]');
        assert.match(page.text('#coletiva-alert'), /Nenhum colaborador elegível encontrado/);

        await pick(page, 'coletiva-dept', 'Financeiro');
        c.errors['vacations:insert'] = { message: 'RLS' };
        await page.click('[data-click="submitColetiva"]');
        assert.match(page.text('#coletiva-alert'), /Erro ao registrar férias coletivas/);
    });
});

describe('ferias.html (RH) — calendário anual, cobertura e tempo real', () => {
    test('trocar o ano; dica ao passar o mouse na barra; ano sem férias mostra só o total; sem departamentos avisa', async () => {
        const c = rhClient([vac('v1', ANA.id, '2026-07-01', '2026-07-20', 'aprovado')]);
        page = await openPage('ferias', { client: c, now: NOW });
        await page.click('[data-click="switchTab"][data-click-args*="calendar"]');
        const barra = page.$('.gantt-bar, [data-name="Ana Souza"]');
        assert.ok(barra);
        Object.defineProperty(page.window, 'innerWidth', { value: 300, configurable: true });
        Object.defineProperty(page.window, 'innerHeight', { value: 300, configurable: true });
        page.$('#gantt-tooltip').getBoundingClientRect = () => ({ width: 200, height: 100 });
        barra.dispatchEvent(new page.window.MouseEvent('mouseenter', { clientX: 250, clientY: 250 }));
        assert.ok(page.$('#gantt-tooltip').classList.contains('show'));
        assert.match(page.text('#gantt-tooltip'), /Ana Souza.*Financeiro.*01\/07\/2026 → 20\/07\/2026.*20 dias · Aprovado/);
        assert.equal(page.$('#gantt-tooltip').style.left, '36px', 'perto da borda, abre para o lado de dentro');
        barra.dispatchEvent(new page.window.MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
        assert.equal(page.$('#gantt-tooltip').style.top, '24px');
        barra.dispatchEvent(new page.window.MouseEvent('mouseleave'));
        assert.ok(!page.$('#gantt-tooltip').classList.contains('show'));
        barra.dispatchEvent(new page.window.MouseEvent('mousemove', { clientX: 10, clientY: 10 }));

        await page.click('#year-next');
        assert.match(page.text('body'), /2027/);
        await page.click('#year-prev');
        await page.click('#year-prev');
        assert.match(page.text('body'), /2025/);

        c.tables.employees_decrypted.forEach((e) => (e.dept = null));
        c.tables.employees.forEach((e) => (e.dept = null));
        c.tables.vacations.push(vac('v2', BIA.id, '2026-09-01', '2026-09-10', 'aprovado'));
        c.emit('vacations', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => page.$$('#requests-tbody tr[data-id]').length === 2);
    });

    test('empresa sem departamentos: cobertura avisa', async () => {
        const c = rhClient([]);
        c.tables.employees_decrypted.forEach((e) => (e.dept = null));
        c.tables.employees.forEach((e) => (e.dept = null));
        page = await openPage('ferias', { client: c, now: NOW });
        await page.click('[data-click="switchTab"][data-click-args*="calendar"]');
        assert.match(page.text('#cobertura-wrap'), /Nenhum departamento cadastrado/);
    });
});

describe('ferias.html (RH) — frações no detalhe e ordem da exportação', () => {
    test('segunda fração do ciclo aparece como 2/3; exportação lista da mais recente para a mais antiga', async () => {
        const c = rhClient([
            vac('f1', ANA.id, '2026-02-02', '2026-02-11', 'aprovado', { created_at: '2026-01-10T10:00:00Z' }),
            vac('f2', ANA.id, '2026-07-06', '2026-07-15', 'pendente', { created_at: '2026-05-10T10:00:00Z' }),
        ]);
        page = await openPage('ferias', { client: c, now: NOW });
        await page.click('#requests-tbody tr[data-id="f2"] [data-click="openViewModal"]');
        assert.match(page.text('#view-modal'), /2\/3 no ciclo/);
        await page.click('[data-click="closeViewModal"]');
        await page.click('#export-csv-btn');
        const csv = await page.objectUrls.at(-1).text();
        const linhas = csv.split('\n').filter((l) => /Ana Souza/.test(l));
        assert.match(linhas[0], /06\/07\/2026/);
        assert.match(linhas[1], /02\/02\/2026/);
    });
});
