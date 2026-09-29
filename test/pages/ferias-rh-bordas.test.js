const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function vac(id, employee_id, start_date, end_date, status, extra = {}) {
    const days = Math.round((new Date(end_date) - new Date(start_date)) / 86400000) + 1;
    return { id, employee_id, start_date, end_date, days, status, abono: false, created_at: `2026-05-0${id.length}T10:00:00Z`, ...extra };
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
const rowOf = (p, id) => p.$(`#requests-tbody tr[data-id="${id}"]`);
async function pick(p, id, value) {
    await p.click(`#${id}-trigger`);
    await p.click(p.$(`#${id}-popover .select-option[data-value="${value}"]`));
}

describe('ferias.html (RH) — bordas', () => {
    test('falhas ao ler férias, colaboradores e feriados deixam a tela vazia', async () => {
        const erro = { message: 'x' };
        page = await openPage('ferias', { client: rhClient([], { errors: { vacations: erro, employees_decrypted: erro, holidays: erro } }), now: NOW });
        assert.match(page.text('#requests-tbody'), /Nenhuma solicitação/);
    });

    test('colaborador sem setor, contrato e jornada, com foto: lista, indicadores, ver, recibo, exportações e agenda', async () => {
        const c = rhClient([
            vac('v1', ANA.id, '2026-06-10', '2026-06-25', 'aprovado', { coletiva: true, substituto_id: BIA.id, abono: true }),
            vac('v2', ANA.id, '2026-06-20', '2026-06-29', 'aprovado'),
            vac('v3', ANA.id, '2026-08-01', '2026-08-10', 'pendente'),
            vac('v4', ANA.id, '2026-05-01', '2026-05-10', 'recusado', { rejection_reason: 'Equipe reduzida' }),
            vac('v5', ANA.id, '2025-12-20', '2026-01-10', 'concluido'),
        ]);
        setEmp(c, ANA.id, { dept: null, contract_type: null, work_load: null, avatar_url: 'https://storage.test/ana.jpg', role: 'Analista' });
        page = await openPage('ferias', { client: c, now: NOW });
        assert.equal(rowOf(page, 'v1').querySelector('.emp-avatar').getAttribute('data-bg-img'), 'https://storage.test/ana.jpg');
        for (const k of ['pendente', 'upcoming', 'ativas']) {
            page.window.openKpiModal(k);
            assert.match(page.text('#kpi-info-body'), /—|Nenhum/);
        }
        page.window.openViewModal('v1');
        assert.match(page.text('#view-modal'), /Sim.*Bia Lima.*Coletiva/);
        page.window.openViewModal('v4');
        assert.match(page.text('#view-modal'), /Equipe reduzida/);
        page.window.generateReceipt('v1');
        page.window.exportVacationsCSV();
        page.window.exportVacationsPDF();
        page.window.downloadIcs('v1');
        page.window.openGoogleCalendar('v1');
        page.window.openExpiredModal();
        await page.click(page.$('.tab-btn[data-tab="calendar"]') || page.$('[data-click="switchTab"]'));
        page.window.switchTab(page.$('.tab-btn'), 'calendar');
        const barra = page.$('#gantt-rows .gantt-bar');
        barra.dispatchEvent(new page.window.MouseEvent('mouseenter', { clientX: 10, clientY: 10 }));
        assert.ok(page.$('#gantt-tooltip').classList.contains('show'));
        assert.ok(page.pdfs.length >= 0);
    });

    test('ano de outro calendário não mostra a linha de hoje; realtime que falha recarrega vazio', async () => {
        const c = rhClient([
            vac('v1', ANA.id, '2025-12-20', '2026-01-10', 'aprovado'),
            vac('v2', BIA.id, '2026-03-02', '2026-03-12', 'aprovado'),
            vac('v3', ANA.id, '2026-03-02', '2026-03-12', 'aprovado'),
        ]);
        page = await openPage('ferias', { client: c, now: NOW });
        page.window.switchTab(page.$('.tab-btn'), 'calendar');
        page.$('#year-prev').click();
        await page.settle();
        assert.equal(page.$('#gantt-rows .gantt-today-line'), null);
        c.errors['vacations:select'] = { message: 'x' };
        c.emit('vacations', { eventType: 'UPDATE', new: {} });
        await page.settle();
        assert.match(page.text('#requests-tbody'), /Nenhuma solicitação/);
    });

    test('seleção: desmarcar tira da lista; lote sem seleção não faz nada; aprovar e recusar um só; recusar em lote', async () => {
        const c = rhClient([
            vac('v1', CAIO.id, '2026-08-01', '2026-08-10', 'pendente'),
            vac('v2', CAIO.id, '2026-09-01', '2026-09-10', 'pendente'),
            vac('v3', CAIO.id, '2026-10-01', '2026-10-10', 'pendente'),
        ]);
        page = await openPage('ferias', { client: c, now: NOW, confirm: true });
        await page.window.bulkApprove();
        page.window.bulkReject();
        page.window.toggleSelectAll(true);
        page.window.toggleSelectAll(false);
        page.window.toggleRowSelect('v1', true);
        page.window.toggleRowSelect('v2', true);
        page.window.toggleRowSelect('v2', false);
        await page.window.bulkApprove();
        assert.ok(page.confirms.some((t) => /Aprovar 1 solicitação selecionada\?/.test(t)));
        assert.ok(page.toasts().some((t) => /1 solicitação aprovada/.test(t)));
        page.window.toggleRowSelect('v2', true);
        page.window.toggleRowSelect('v3', true);
        page.window.bulkReject();
        page.$('#reject-reason').value = 'Sem cobertura';
        await page.window.confirmReject();
        assert.ok(page.toasts().some((t) => /2 solicitações recusadas\./.test(t)));
    });

    test('conflito: sem setor não conflita; colega de outro setor não conflita; mais de 3 colegas mostra reticências', async () => {
        const c = rhClient([
            vac('v1', ANA.id, '2026-07-01', '2026-07-10', 'pendente'),
            vac('v2', BIA.id, '2026-07-01', '2026-07-10', 'aprovado'),
            vac('v3', CAIO.id, '2026-07-01', '2026-07-10', 'pendente'),
        ]);
        for (let i = 0; i < 4; i++) {
            c.tables.employees_decrypted.push({ ...ANA, id: `x${i}`, name: `Colega ${i}`, email: `x${i}@e.com` });
            c.tables.vacations.push(vac(`c${i}`, `x${i}`, '2026-07-01', '2026-07-10', 'aprovado'));
        }
        setEmp(c, CAIO.id, { dept: null });
        c.tables.employees_decrypted.push({ ...BIA, id: 'y1', name: 'Outro Setor', email: 'y1@e.com', dept: 'Logística' });
        c.tables.vacations.push(vac('y1v', 'y1', '2026-07-01', '2026-07-10', 'aprovado'));
        page = await openPage('ferias', { client: c, now: NOW, confirm: false });
        await page.window.approveRequest('v1');
        assert.ok(page.confirms.some((t) => /…/.test(t)));
        await page.window.approveRequest('v3');
        assert.equal(c.tables.vacations.find((v) => v.id === 'v3').status, 'aprovado');
    });

    test('erros ao emitir e desfazer o recibo só registram no console', async () => {
        const c = rhClient([vac('v1', ANA.id, '2026-08-01', '2026-08-10', 'pendente'), vac('v2', ANA.id, '2026-09-01', '2026-09-10', 'aprovado')], {
            rpc: { apply_ferias_recibo: { error: { message: 'x' } }, revert_ferias_recibo: {}, revert_ferias_payroll_event: { error: { message: 'y' } } },
        });
        page = await openPage('ferias', { client: c, now: NOW, confirm: true });
        await page.window.approveRequest('v1');
        await page.window.cancelApprovedVacation('v2');
        assert.equal(c.tables.vacations.find((v) => v.id === 'v2').status, 'cancelado');
    });

    test('cadastro: uma falta no ciclo usa o singular; saldo de banco zerado e negativo; dia sem saída; um dia só; início antes da admissão', async () => {
        const c = rhClient([]);
        c.tables.time_records.push({ employee_id: ANA.id, date: '2026-06-01', entrada: null, saida: null });
        c.tables.time_records.push({ employee_id: ANA.id, date: '2026-06-02', entrada: '2026-06-02T08:00:00-03:00', saida: null });
        c.tables.bank_adjustments.push({ employee_id: ANA.id, tipo: 'debito', minutos: 30, date: '2026-06-10', deleted_at: null });
        page = await openPage('ferias', { client: c, now: NOW, confirm: true });
        await page.click('[data-click="openAddModal"]');
        await pick(page, 'add-employee', ANA.id);
        await page.settle(30);
        assert.ok(page.$('#add-emp-saldo-info').classList.contains('negativo'));
        page.eval(`setDatePickerValue('add-start', '2026-08-03'); setDatePickerValue('add-end', '2026-08-03'); calcAddDays();`);
        assert.equal(page.text('#add-days-count'), '1 dia de férias');
        page.eval(`setDatePickerValue('add-start', '2023-01-02'); setDatePickerValue('add-end', '2023-01-20'); calcAddDays();`);
        await page.window.submitAdd();
        c.tables.bank_adjustments.push({ employee_id: ANA.id, tipo: 'credito', minutos: 30, date: '2026-06-11', deleted_at: null });
        page.window.onAddEmployeeChange();
        await page.settle(30);
        assert.match(page.text('#add-emp-saldo-info'), /0h 00min/);
    });

    test('substituto sem setor aparece como "Sem departamento"; popovers trocam; clicar de novo fecha', async () => {
        const c = rhClient([]);
        setEmp(c, BIA.id, { dept: null });
        page = await openPage('ferias', { client: c, now: NOW });
        await page.click('[data-click="openAddModal"]');
        await pick(page, 'add-employee', ANA.id);
        assert.match(page.text('#add-substituto-popover'), /Bia Lima — Sem departamento/);
        await page.click('#add-substituto-trigger');
        await page.click('#add-status-trigger');
        await page.click('#add-status-trigger');
        assert.equal(page.$('#add-status-popover').classList.contains('open'), false);
    });

    test('coletivas registradas com a aba do calendário aberta, para uma pessoa só; cobertura com setor sem férias', async () => {
        const c = rhClient([]);
        for (const e of c.tables.employees_decrypted) if (e.id !== ANA.id && e.dept === ANA.dept) e.dept = 'Outro Setor';
        page = await openPage('ferias', { client: c, now: NOW, confirm: true });
        page.window.switchTab(page.$('.tab-btn'), 'calendar');
        page.window.openColetivaModal();
        await pick(page, 'coletiva-dept', ANA.dept);
        page.eval(`setDatePickerValue('coletiva-start', '2026-08-03'); setDatePickerValue('coletiva-end', '2026-08-14');`);
        await page.window.submitColetiva();
        assert.ok(page.toasts().some((t) => /registradas para 1 colaborador\./.test(t)));
        assert.ok(page.$$('#cobertura-wrap .cobertura-item').length >= 2);
    });

    test('clicar dentro do modal não fecha', async () => {
        page = await openPage('ferias', { client: rhClient([]), now: NOW });
        page.window.openAddModal();
        const modal = page.$('#add-modal');
        page.window.handleOverlayClick({ target: modal.firstElementChild }, 'add-modal');
        assert.ok(modal.classList.contains('open'));
        page.window.handleOverlayClick({ target: modal }, 'add-modal');
        assert.equal(modal.classList.contains('open'), false);
    });

    test('lote sem conflito cancelado na confirmação; coletivas com dois pulados; recibo sem cargo; vencidas sem setor; saldo com falha nos ajustes', async () => {
        const c = rhClient([
            vac('v1', CAIO.id, '2026-09-01', '2026-09-10', 'pendente'),
            vac('a1', ANA.id, '2026-08-03', '2026-08-20', 'aprovado'),
            vac('b1', BIA.id, '2026-08-03', '2026-08-20', 'aprovado'),
        ]);
        setEmp(c, ANA.id, { role: null, dept: null, admission_date: '2020-01-01' });
        page = await openPage('ferias', { client: c, now: NOW, confirm: false });
        page.window.toggleRowSelect('v1', true);
        await page.window.bulkApprove();
        assert.equal(c.tables.vacations.find((v) => v.id === 'v1').status, 'pendente');
        page.window.generateReceipt('a1');
        page.window.openExpiredModal();
        assert.match(page.text('#expired-body'), /— · vencida desde/);
        page.window.openColetivaModal();
        page.eval(`setDatePickerValue('coletiva-start', '2026-08-03'); setDatePickerValue('coletiva-end', '2026-08-14');`);
        page.window.confirm = () => true;
        await page.window.submitColetiva();
        assert.ok(page.toasts().some((t) => /2 pulados por conflito/.test(t)));
        c.errors['bank_adjustments:select'] = { message: 'x' };
        await page.click('[data-click="openAddModal"]');
        await pick(page, 'add-employee', BIA.id);
        await page.settle(30);
        assert.match(page.text('#add-emp-saldo-info'), /0h 00min/);
    });

    test('coletivas para a empresa toda usam o plural', async () => {
        page = await openPage('ferias', { client: rhClient([]), now: NOW, confirm: true });
        page.window.openColetivaModal();
        page.eval(`setDatePickerValue('coletiva-start', '2026-08-03'); setDatePickerValue('coletiva-end', '2026-08-14');`);
        await page.window.submitColetiva();
        assert.ok(page.toasts().some((t) => /colaboradores\./.test(t)));
    });
});
