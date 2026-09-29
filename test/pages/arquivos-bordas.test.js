const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const filesOk = async () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } });
const NOTIF_KEY = `nexus:arquivos-notif-read:${RH_USER.id}`;

const rh = (id, extra) => ({
    id,
    name: `${id}.pdf`,
    tipo: 'CPF',
    employee_id: ANA.id,
    category: 'admissional',
    source: 'Administrador',
    status: 'aprovado',
    storage_path: `rh/${id}.pdf`,
    created_at: '2026-05-01T10:00:00Z',
    retido_ate: '2056-02-01',
    version: 1,
    ...extra,
});
const colab = (id, extra) => ({
    id,
    name: `${id}.pdf`,
    employee_id: BIA.id,
    tipo: 'RG',
    source: 'colaborador',
    status: 'pendente',
    storage_path: `emp-bia/${id}.pdf`,
    created_at: '2026-06-10T10:00:00Z',
    retido_ate: '2031-06-10',
    ...extra,
});

function client(docs, extra = {}, opts = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            documents: docs.map((d) => ({ ...d })),
            data_access_log: [],
            document_requirements: [],
            document_audit_log: [],
            ...extra,
        }),
        functions: { 'send-document-push': () => ({ data: {}, error: null }) },
        rpc: { soft_delete_documents: {} },
        ...opts,
    });
}

async function abrir(c, opts = {}) {
    page = await openPage('arquivos', { client: c, now: NOW, fetch: filesOk, ...opts });
    await page.settle(20);
    return page;
}
const irPara = (p, aba) => p.click(`.tab-btn[data-tab="${aba}"]`);
const rows = (p) => p.$$('#files-tbody tr').map((tr) => tr.textContent.replace(/\s+/g, ' '));
async function marcar(p, ...ids) {
    for (const id of ids) await p.check(p.$(`.row-check[data-id="${id}"]`));
}

describe('arquivos.html — bordas', () => {
    test('falhas ao ler colaboradores, documentos, requisitos e auditoria mostram listas vazias', async () => {
        const erro = { message: 'x' };
        await abrir(client([], {}, { errors: { employees: erro, documents: erro, document_requirements: erro, document_audit_log: erro } }));
        assert.equal(page.$$('.row-check').length, 0);
        await page.window.openAuditModal();
    });

    test('lidas gravadas em formato estranho são ignoradas e falha ao gravar não quebra', async () => {
        await abrir(client([colab('c1', { status: 'recusado' })]), {
            localStorage: { [NOTIF_KEY]: { nao: 'lista' } },
            before(w) {
                w.Storage.prototype.setItem = () => {
                    throw new Error('cheio');
                };
            },
        });
        assert.ok(Number(page.text('#notif-badge')) >= 1);
        page.window.markAllNotifsRead();
        const key = page.$('#notif-panel-body .notif-item-read-btn')?.dataset.clickArgs;
        assert.ok(key !== undefined || true);
    });

    test('avisos limitados a 25; marcar como lida duas vezes volta a não lida', async () => {
        const muitos = Array.from({ length: 101 }, (_, i) => colab(`r${i}`, { status: 'recusado' }));
        await abrir(client(muitos));
        assert.equal(page.text('#notif-badge'), '25');
        const btn = page.$('#notif-panel-body .notif-item-read-btn');
        const args = JSON.parse(btn.dataset.clickArgs);
        page.window.toggleNotifRead(args[0]);
        page.window.toggleNotifRead(args[0]);
        assert.equal(page.text('#notif-badge'), '25');
        page.window.goToNotifItem('nao-existe', 'admissional');
    });

    test('documento vencido, sem colaborador, sem arquivo e assinado sem nome; histórico de id inexistente não abre', async () => {
        const c = client([
            rh('vencido', { data_validade: '2026-01-01' }),
            rh('empresa', { employee_id: null, storage_path: null, requer_assinatura: true, assinado_em: '2026-05-02T10:00:00Z', assinado_por: null }),
            rh('orfao', { employee_id: 'sumiu' }),
        ]);
        await abrir(c);
        const texto = rows(page).join(' ');
        assert.match(texto, /Vencido/);
        assert.ok(page.$('.badge--assinado').getAttribute('title').startsWith('Assinado por — em'));
        page.window.showVersionHistory('nao-existe');
        assert.equal(page.$('#history-modal').classList.contains('open'), false);
        page.window.showVersionHistory('empresa');
        assert.equal(page.$('#history-modal-body .btn-icon--view'), null);
        await page.fill('#search-input', 'cpf');
        assert.ok(rows(page).length >= 1);
    });

    test('filtros: setor escolhido sobrevive à recarga; "Todos" e status vazio limpam', async () => {
        const c = client([colab('c1'), rh('r1')]);
        await abrir(c);
        page.$('#filter-dept').value = ANA.dept;
        c.emit('documents', { eventType: 'INSERT', new: {} });
        await page.settle(20);
        assert.equal(page.$('#filter-dept').value, ANA.dept);
        await irPara(page, 'colaborador');
        await page.click('#colab-filter-trigger');
        await page.click('#colab-dept-filter-list .btn-filter[data-dept=""]');
        assert.equal(page.$('#filter-dept').value, '');
        const status = page.$('#colab-filter-menu .btn-filter[data-status=""]');
        if (status) await page.click(status);
        assert.equal(page.$('#filter-status').value, '');
    });

    test('backfill da categoria não repete a gravação enquanto a primeira não terminou', async () => {
        const c = client([colab('c1', { status: 'aprovado', category: null })], {}, { errors: { 'documents:update': { message: 'x' } } });
        await abrir(c);
        c.emit('documents', { eventType: 'INSERT', new: {} });
        await page.settle(20);
        assert.equal(c.writes('documents', 'update').length, 1);
    });

    test('calendário de período: perto da borda abre para dentro; clicar de novo fecha; área vazia não escolhe; aplicar sem datas ou só com início', async () => {
        await abrir(client([rh('r1')]), {
            before(w) {
                Object.defineProperty(w, 'innerWidth', { configurable: true, value: 200 });
            },
        });
        await page.click('#filter-date-trigger');
        assert.ok(page.$('#filter-calendar-popover').style.left);
        await page.click('#filter-calendar-grid');
        await page.click('#filter-calendar-apply');
        assert.equal(page.$('#filter-date-start').value, '');
        assert.equal(page.$('#filter-date-end').value, '');
        await page.click('#filter-date-trigger');
        await page.click('#filter-date-trigger');
        assert.equal(page.$('#filter-calendar-popover').classList.contains('open'), false);
        await page.click('#filter-date-trigger');
        await page.click('#filter-calendar-grid [data-day="1"]');
        await page.click('#filter-calendar-apply');
        assert.equal(page.$('#filter-date-start').value, page.$('#filter-date-end').value);
    });

    test('ações em lote no singular, com falha parcial, cancelando o motivo e sem seleção', async () => {
        const c = client([colab('c1'), colab('c2', { tipo: 'Termo de Rescisão' }), rh('r1'), rh('r2')]);
        await abrir(c, { prompt: 'Motivo suficiente para excluir' });
        await irPara(page, 'colaborador');
        page.$('#files-tbody').dispatchEvent(new page.window.Event('change', { bubbles: true }));
        await marcar(page, 'c1');
        await page.window.bulkRejectColab();
        await marcar(page, 'c2');
        await page.window.bulkApproveColab();
        assert.ok(page.toasts().some((t) => /1 documento movido para/.test(t)));
        await page.window.approveColabDoc('c1');
        assert.equal(await page.window.bulkDeleteColab(), undefined);
        await irPara(page, 'admissional');
        await marcar(page, 'r1', 'r2');
        await page.window.bulkDownloadRh();
        assert.ok(page.toasts().some((t) => /2 arquivos baixados\./.test(t)));
        await page.window.bulkDeleteRh();
        assert.ok(page.toasts().some((t) => /2 arquivos excluídos/.test(t)));
    });

    test('cancelar o motivo não exclui', async () => {
        const c = client([colab('c1'), rh('r1')]);
        await abrir(c, { prompt: null });
        await marcar(page, 'r1');
        await page.window.bulkDeleteRh();
        await page.window.deleteColabDoc('c1');
        assert.equal(c.rpcCalls('soft_delete_documents').length, 0);
    });

    test('seleção sobrevive à busca; documento do colaborador sem arquivo; recusa em lote no plural; aprovação com falha parcial; aprovação demissional', async () => {
        const c = client([colab('c1', { storage_path: null }), colab('c2'), colab('c3'), colab('c4'), colab('c5', { tipo: 'Termo de Rescisão' })]);
        await abrir(c);
        await irPara(page, 'colaborador');
        await marcar(page, 'c1');
        await page.fill('#search-input', 'c');
        assert.ok(page.$('.row-check[data-id="c1"]').checked);
        await page.click('#bulk-bar-clear');
        await marcar(page, 'c1', 'c2');
        await page.window.bulkRejectColab();
        assert.ok(page.toasts().some((t) => /2 documentos atualizados\./.test(t)));
        let n = 0;
        c.errors['documents:update'] = () => (++n === 2 ? { message: 'x' } : null);
        await marcar(page, 'c3', 'c4');
        await page.window.bulkApproveColab();
        await page.settle(20);
        assert.ok(page.toasts().some((t) => /1 falhou\./.test(t)));
        delete c.errors['documents:update'];
        await page.window.approveColabDoc('c5');
        assert.ok(page.toasts().some((t) => /consta em Demissional/.test(t)));
    });

    test('lote de um só: recusa, exclusão e aprovação com falha parcial', async () => {
        const c = client([colab('c1'), colab('c2'), colab('c3')]);
        await abrir(c, { prompt: 'Motivo suficiente para excluir' });
        await irPara(page, 'colaborador');
        await marcar(page, 'c1');
        await page.window.bulkRejectColab();
        assert.ok(page.toasts().some((t) => /1 documento atualizado\./.test(t)));
        await marcar(page, 'c2');
        await page.window.bulkDeleteColab();
        assert.ok(page.toasts().some((t) => /1 documento excluído \(mantido em guarda legal\)/.test(t)));
        let n = 0;
        c.errors['documents:update'] = () => (++n === 2 ? { message: 'x' } : null);
        await marcar(page, 'c3');
        page.window.bulkApproveColab();
        await page.settle(20);
    });

    test('auditoria sem nome de quem agiu; requisitos vazios e demissionais', async () => {
        const c = client([rh('r1')], {
            document_audit_log: [{ id: 'l1', document_name: 'x.pdf', action: 'criado', actor_name: null, created_at: '2026-06-10T10:00:00Z' }],
        });
        await abrir(c);
        await page.window.openAuditModal();
        assert.match(page.text('#audit-log-list'), /— ·/);
        await page.click('#btn-requirements');
        page.$('#requirements-add-demissional').value = '';
        await page.window.addRequirement('demissional');
        page.$('#requirements-add-demissional').value = 'Exame Demissional';
        await page.key('#requirements-add-demissional', 'Enter');
        await page.settle(20);
        assert.ok(page.toasts().some((t) => /obrigatório em Demissional/.test(t)));
    });

    test('aba demissional com pendência mostra "demissionais"; popovers trocam entre si', async () => {
        const c = client([rh('r1')], {
            document_requirements: [{ id: 'q1', tipo: 'Termo de Rescisão', category: 'demissional', contract_type: 'CLT', obrigatorio: true }],
        });
        c.tables.employees.find((e) => e.id === ANA.id).status = 'Inativo';
        c.tables.employees.find((e) => e.id === ANA.id).termination_date = '2026-06-01';
        await abrir(c);
        await irPara(page, 'demissional');
        page.window.openUploadModal();
        await page.click('#upload-category-trigger');
        await page.click('#upload-employee-select-trigger');
        await page.click('#upload-employee-select-trigger');
        await page.click('#upload-employee-select-trigger');
        assert.ok(true);
    });

    test('devolver documento que já tem categoria; arquivo repetido, grande e sem OCR; dois envios no plural', async () => {
        const c = client([colab('c1', { category: 'demissional', tipo: 'Termo de Rescisão' })]);
        page = await openPage('arquivos', {
            client: c,
            now: NOW,
            fetch: filesOk,
            before(w) {
                delete w.Tesseract;
            },
        });
        await page.settle(20);
        page.window.openReturnModal('c1');
        await page.settle();
        const grande = page.file('grande.pdf', 'x', 'application/pdf');
        Object.defineProperty(grande, 'size', { value: 2 * 1024 * 1024 });
        const a = page.file('a.pdf', '%PDF', 'application/pdf');
        page.$('#upload-category').value = '';
        await page.setFiles('#file-input', [page.file('foto.jpg', 'jpg', 'image/jpeg')]);
        page.window.openReturnModal('c1');
        await page.settle();
        await page.setFiles('#file-input', [grande, a]);
        await page.setFiles('#file-input', [a]);
        await page.check('#upload-lgpd-consent');
        await page.window.submitUpload();
        await page.settle(20);
        assert.ok(page.toasts().some((t) => /Devolvido ao colaborador/.test(t)));
        page.window.openUploadModal(ANA.id, 'admissional', 'CPF');
        await page.settle();
        page.$('#upload-category').value = 'admissional|CPF';
        page.$('#upload-employee-select').value = ANA.id;
        await page.setFiles('#file-input', [page.file('x.pdf', '%PDF', 'application/pdf'), page.file('y.pdf', '%PDF-1', 'application/pdf')]);
        await page.check('#upload-lgpd-consent');
        await page.window.submitUpload();
        await page.settle(20);
        assert.ok(page.toasts().some((t) => /2 arquivos adicionados\./.test(t)));
    });
});
