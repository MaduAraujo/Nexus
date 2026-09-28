const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const filesOk = async () => new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } });

const rh = (id, extra) => ({
    id,
    employee_id: ANA.id,
    category: 'admissional',
    source: 'Administrador',
    status: 'aprovado',
    storage_path: `rh/${id}.pdf`,
    created_at: '2026-02-01T10:00:00Z',
    retido_ate: '2056-02-01',
    version: 1,
    ...extra,
});
const colab = (id, extra) => ({
    id,
    employee_id: BIA.id,
    tipo: 'RG',
    source: 'colaborador',
    status: 'pendente',
    storage_path: `emp-bia/${id}.pdf`,
    created_at: '2026-06-10T10:00:00Z',
    retido_ate: '2031-06-10',
    ...extra,
});

const DOCS = [
    rh('contrato-v1', { name: 'contrato-v1.pdf', tipo: 'Contrato de Trabalho', is_current: false, created_at: '2026-01-10T10:00:00Z' }),
    rh('contrato-v2', {
        name: 'contrato-v2.pdf',
        tipo: 'Contrato de Trabalho',
        version: 2,
        replaces_document_id: 'contrato-v1',
        created_at: '2026-03-10T10:00:00Z',
    }),
    rh('cpf', { name: 'cpf-ana.pdf', tipo: 'CPF', created_at: '2026-05-20T10:00:00Z' }),
    rh('termo', { name: 'termo-sigilo.pdf', tipo: 'Contrato de Trabalho', requer_assinatura: true, assinado_em: null, created_at: '2026-06-01T10:00:00Z' }),
    colab('rg-bia', { name: 'rg-bia.pdf' }),
    colab('cpf-bia', { name: 'cpf-bia.pdf', tipo: 'CPF' }),
    colab('comprovante', { name: 'comprovante.pdf', tipo: 'Comprovante de Residência', status: 'recusado' }),
];

function client(extra = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            documents: DOCS.map((d) => ({ ...d })),
            data_access_log: [],
            document_requirements: [{ id: 'r1', tipo: 'Contrato de Trabalho', category: 'admissional', contract_type: null, obrigatorio: true }],
            document_audit_log: [],
            ...extra,
        }),
        functions: { 'send-document-push': () => ({ data: {}, error: null }) },
    });
}

const rows = (p) => p.$$('#files-tbody tr').map((tr) => tr.textContent.replace(/\s+/g, ' '));
async function marcar(p, ...ids) {
    for (const id of ids) await p.check(p.$(`.row-check[data-id="${id}"]`));
}
async function abrir(c, opts = {}) {
    page = await openPage('arquivos', { client: c, now: NOW, fetch: filesOk, ...opts });
    await page.settle(20);
    return page;
}

describe('arquivos.html — ações em lote nos documentos do colaborador', () => {
    test('aprovar em lote arquiva os dois e audita cada um', async () => {
        const c = client();
        await abrir(c);
        await page.click('.tab-btn[data-tab="colaborador"]');
        await marcar(page, 'rg-bia', 'cpf-bia');
        assert.equal(page.visible('#bulk-bar'), true);
        assert.equal(page.text('#bulk-bar-count'), '2 selecionados');
        await page.window.bulkApproveColab();
        await page.settle(20);
        for (const id of ['rg-bia', 'cpf-bia']) {
            const d = c.tables.documents.find((x) => x.id === id);
            assert.deepEqual([id, d.status, d.category], [id, 'aprovado', 'admissional']);
        }
        const acoes = c.writes('document_audit_log', 'insert').map((w) => w.payload[0].action);
        assert.equal(acoes.filter((a) => a === 'aprovado').length, 2);
        assert.ok(page.toasts().some((t) => /2 documentos movidos/.test(t)));
        assert.equal(page.visible('#bulk-bar'), false);
    });

    test('recusar em lote marca recusado e audita; erro do banco não altera nada', async () => {
        const c = client();
        await abrir(c);
        await page.click('.tab-btn[data-tab="colaborador"]');
        c.errors['documents:update'] = { message: 'rls' };
        await marcar(page, 'rg-bia');
        await page.window.bulkRejectColab();
        assert.ok(page.toasts().some((t) => /Não foi possível recusar/.test(t)));
        assert.equal(c.tables.documents.find((x) => x.id === 'rg-bia').status, 'pendente');

        delete c.errors['documents:update'];
        await page.window.bulkRejectColab();
        await page.settle(20);
        assert.equal(c.tables.documents.find((x) => x.id === 'rg-bia').status, 'recusado');
        assert.equal(c.writes('document_audit_log', 'insert').at(-1).payload[0].action, 'recusado');
    });

    test('excluir em lote é lógico, com motivo obrigatório; cancelar ou motivo curto não exclui nada', async () => {
        const c = client();
        await abrir(c, { prompt: null });
        await page.click('.tab-btn[data-tab="colaborador"]');
        await marcar(page, 'rg-bia', 'cpf-bia');
        await page.window.bulkDeleteColab();
        assert.equal(c.rpcCalls('soft_delete_documents').length, 0, 'cancelou o motivo: nada acontece');

        page.close();
        await abrir(c, { prompt: 'erro' });
        await page.click('.tab-btn[data-tab="colaborador"]');
        await marcar(page, 'rg-bia', 'cpf-bia');
        await page.window.bulkDeleteColab();
        assert.equal(c.rpcCalls('soft_delete_documents').length, 0);
        assert.ok(page.toasts().some((t) => /Motivo obrigatório/.test(t)));

        page.close();
        await abrir(c, { prompt: '  Documento ilegível, reenviar  ' });
        await page.click('.tab-btn[data-tab="colaborador"]');
        await marcar(page, 'rg-bia', 'cpf-bia');
        await page.window.bulkDeleteColab();
        await page.settle(20);
        assert.deepEqual(c.rpcCalls('soft_delete_documents')[0].args, { p_ids: ['rg-bia', 'cpf-bia'], p_reason: 'Documento ilegível, reenviar' });
        assert.equal(c.writes('documents', 'delete').length, 0, 'nenhum DELETE físico');
        assert.equal(c.calls.filter((x) => x.storage === 'documents' && x.op === 'remove').length, 0, 'arquivo fica guardado');
        assert.ok(!rows(page).some((r) => /rg-bia|cpf-bia/.test(r)));
    });
});

describe('arquivos.html — ações em lote nos arquivos do RH', () => {
    test('baixar em lote: conta só o que realmente baixou e diz o que falhou', async () => {
        const c = client();
        await abrir(c, {
            fetch: async (url) => (/cpf/.test(decodeURIComponent(url)) ? new Response('{"error":"x"}', { status: 500 }) : filesOk()),
        });
        await marcar(page, 'contrato-v2', 'cpf');
        await page.window.bulkDownloadRh();
        const toast = page.toasts().find((t) => /Download/.test(t));
        assert.match(toast, /1 arquivo baixado\. Não foi possível baixar: cpf-ana\.pdf/);
    });

    test('baixar em lote sem nenhum sucesso não diz que baixou', async () => {
        const c = client();
        await abrir(c, { fetch: async () => new Response('{"error":"x"}', { status: 500 }) });
        await marcar(page, 'contrato-v2', 'cpf');
        await page.window.bulkDownloadRh();
        assert.ok(page.toasts().some((t) => /Download não realizado/.test(t)));
        assert.ok(!page.toasts().some((t) => /Download iniciado/.test(t)));
    });

    test('excluir arquivos do RH em lote: exclusão lógica com motivo, some da lista', async () => {
        const c = client();
        await abrir(c, { prompt: 'Enviado ao colaborador errado' });
        await marcar(page, 'cpf');
        await page.window.bulkDeleteRh();
        await page.settle(20);
        assert.deepEqual(c.rpcCalls('soft_delete_documents')[0].args, { p_ids: ['cpf'], p_reason: 'Enviado ao colaborador errado' });
        assert.equal(c.calls.filter((x) => x.storage === 'documents' && x.op === 'remove').length, 0);
        assert.ok(!rows(page).some((r) => /cpf-ana/.test(r)));
        assert.ok(page.toasts().some((t) => /1 arquivo excluído \(mantido em guarda legal\)/.test(t)));
    });

    test('documento excluído logicamente não volta para a lista', async () => {
        const c = client();
        c.tables.documents.find((d) => d.id === 'cpf').deleted_at = '2026-06-10T10:00:00Z';
        await abrir(c);
        assert.ok(!rows(page).some((r) => /cpf-ana/.test(r)));
        assert.ok(rows(page).some((r) => /contrato-v2/.test(r)));
    });

    test('"selecionar todos" marca só o que está visível', async () => {
        await abrir(client());
        const all = page.$('#select-all-checkbox');
        await page.check(all);
        const visiveis = page.$$('.row-check').length;
        assert.ok(visiveis > 0);
        assert.equal(page.text('#bulk-bar-count'), `${visiveis} selecionado${visiveis > 1 ? 's' : ''}`);
        await page.click('#bulk-bar-clear');
        assert.equal(page.visible('#bulk-bar'), false);
    });
});

describe('arquivos.html — versões, visualização e recusa individual', () => {
    test('histórico mostra a cadeia de versões, da atual para a mais antiga', async () => {
        await abrir(client());
        page.window.showVersionHistory('contrato-v2');
        assert.equal(page.$('#history-modal').classList.contains('open'), true);
        assert.match(page.text('#history-modal-body'), /v2 · atual contrato-v2\.pdf.*v1 contrato-v1\.pdf/);
        page.window.closeHistoryModal();
        assert.equal(page.$('#history-modal').classList.contains('open'), false);
    });

    test('cadeia de versões com ciclo não trava a página', async () => {
        const docs = DOCS.map((d) => ({ ...d }));
        docs.find((d) => d.id === 'contrato-v1').replaces_document_id = 'contrato-v2';
        await abrir(client({ documents: docs }));
        page.window.showVersionHistory('contrato-v2');
        assert.equal(page.$$('#history-modal-body .history-row').length, 2);
    });

    test('visualizar registra o acesso (LGPD); sem arquivo salvo, orienta a pedir de novo', async () => {
        const c = client();
        await abrir(c);
        await page.window.viewFile('cpf', 'rh/cpf.pdf');
        await page.settle(20);
        assert.deepEqual(
            c.tables.data_access_log.map((l) => [l.employee_id, l.tipo, l.detalhe]),
            [[ANA.id, 'documento', 'cpf-ana.pdf']]
        );
        await page.window.viewFile('rg-bia', null);
        assert.ok(page.toasts().some((t) => /Peça ao colaborador para enviar o documento novamente/.test(t)));
    });

    test('recusar um documento do colaborador audita; erro não altera o status', async () => {
        const c = client();
        await abrir(c);
        c.errors['documents:update'] = { message: 'rls' };
        await page.window.rejectColabDoc('rg-bia');
        assert.ok(page.toasts().some((t) => /Não foi possível recusar o documento/.test(t)));
        delete c.errors['documents:update'];
        await page.window.rejectColabDoc('rg-bia');
        await page.settle(20);
        assert.equal(c.tables.documents.find((x) => x.id === 'rg-bia').status, 'recusado');
    });
});

describe('arquivos.html — requisitos, notificações e filtro por período', () => {
    test('adicionar tipo obrigatório com Enter; duplicado explica o motivo', async () => {
        const c = client();
        await abrir(c);
        await page.click('#btn-requirements');
        page.$('#requirements-add-admissional').value = 'Título de Eleitor';
        await page.key('#requirements-add-admissional', 'Enter');
        await page.settle(20);
        const ins = c.writes('document_requirements', 'insert')[0].payload[0];
        assert.deepEqual([ins.tipo, ins.category, ins.obrigatorio], ['Título de Eleitor', 'admissional', true]);
        assert.match(page.text('#requirements-admissional'), /Título de Eleitor/);
        assert.equal(page.$('#requirements-add-admissional').value, '');

        c.errors['document_requirements:insert'] = { code: '23505', message: 'dup' };
        page.$('#requirements-add-admissional').value = 'CPF';
        await page.window.addRequirement('admissional');
        assert.ok(page.toasts().some((t) => /talvez esse tipo já esteja cadastrado/.test(t)));
    });

    test('notificações: recusado aguardando reenvio e assinatura pendente; marcar como lida persiste', async () => {
        await abrir(client());
        const itens = page.text('#notif-panel-body');
        assert.match(itens, /comprovante\.pdf foi recusado — aguardando reenvio/);
        assert.match(itens, /termo-sigilo\.pdf aguardando assinatura de Ana Souza/);
        const antes = Number(page.text('#notif-badge'));
        assert.ok(antes >= 2);

        await page.click('#notif-panel-body .notif-item-read-btn');
        assert.equal(Number(page.text('#notif-badge')), antes - 1);
        page.window.markAllNotifsRead();
        await page.settle();
        assert.equal(page.visible('#notif-badge'), false);
        const salvo = JSON.parse(page.window.localStorage.getItem(`nexus:arquivos-notif-read:${RH_USER.id}`));
        assert.equal(salvo.length, antes);
    });

    test('clicar numa notificação leva à aba e ao documento', async () => {
        await abrir(client());
        page.window.goToNotifItem('comprovante', 'colaborador');
        await page.settle();
        assert.ok(page.$('.tab-btn[data-tab="colaborador"]').classList.contains('active'));
        assert.equal(page.$('#search-input').value, 'comprovante.pdf');
        assert.deepEqual(
            rows(page).map((r) => /comprovante\.pdf/.test(r)),
            [true]
        );
    });

    test('filtro por período: escolhe início e fim no calendário e filtra por data de envio', async () => {
        await abrir(client());
        await page.click('#filter-date-trigger');
        assert.equal(page.$('#filter-calendar-popover').classList.contains('open'), true);
        assert.equal(page.text('#filter-calendar-title'), 'Junho 2026');
        await page.click('#filter-calendar-prev');
        assert.equal(page.text('#filter-calendar-title'), 'Maio 2026');
        await page.click('#filter-calendar-grid [data-day="1"]');
        assert.equal(page.$('#filter-calendar-popover').classList.contains('open'), true, 'escolher o início não fecha o calendário');
        await page.click('#filter-calendar-next');
        await page.click('#filter-calendar-grid [data-day="30"]');
        assert.equal(page.$('#filter-calendar-popover').classList.contains('open'), true);
        await page.click('#filter-calendar-apply');
        assert.equal(page.$('#filter-date-start').value, '2026-05-01');
        assert.equal(page.$('#filter-date-end').value, '2026-06-30');
        assert.equal(page.text('#filter-date-trigger-text'), '01/05 – 30/06');
        const r = rows(page);
        assert.ok(r.some((x) => /cpf-ana|termo-sigilo/.test(x)));
        assert.ok(!r.some((x) => /contrato-v2/.test(x)), 'contrato de março fica fora');

        await page.click('#filter-date-trigger');
        await page.click('#filter-calendar-clear');
        assert.equal(page.text('#filter-date-trigger-text'), 'Período');
        assert.ok(rows(page).some((x) => /contrato-v2/.test(x)));
    });
});

describe('arquivos.html — envio pelo RH: falhas', () => {
    test('se o registro falha depois do upload, o arquivo enviado é apagado (nada de órfão)', async () => {
        const c = client();
        await abrir(c);
        c.errors['documents:insert'] = { message: 'rls' };
        page.window.openUploadModal(ANA.id, 'admissional', 'CPF');
        await page.settle();
        page.$('#upload-category').value = 'admissional|CPF';
        page.$('#upload-employee-select').value = ANA.id;
        await page.setFiles('#file-input', [page.file('cpf novo.pdf', '%PDF-1.4', 'application/pdf')]);
        await page.check('#upload-lgpd-consent');
        const inicio = c.calls.length;
        await page.click('#btn-submit-upload');
        await page.settle(20);
        const removidos = c.calls.slice(inicio).filter((x) => x.storage === 'documents' && x.op === 'remove');
        assert.equal(removidos.length, 1);
        assert.match(JSON.stringify(removidos[0].path), /rh\/\d+_cpf_novo\.pdf/);
        assert.ok(page.toasts().some((t) => /Não foi possível registrar cpf novo\.pdf/.test(t)));
    });

    test('arquivo acima de 25 MB é recusado antes do envio; sem categoria ou colaborador, não envia', async () => {
        const c = client();
        await abrir(c);
        page.window.openUploadModal();
        await page.settle();
        const grande = page.file('enorme.pdf', 'x', 'application/pdf');
        Object.defineProperty(grande, 'size', { value: 26 * 1024 * 1024 });
        await page.setFiles('#file-input', [grande]);
        assert.ok(page.toasts().some((t) => /enorme\.pdf ultrapassa o limite de 25 MB/.test(t)));

        await page.window.submitUpload();
        assert.ok(page.toasts().some((t) => /Selecione a categoria/.test(t)));
        page.$('#upload-category').value = 'admissional|CPF';
        await page.window.submitUpload();
        assert.ok(page.toasts().some((t) => /Selecione ao menos um arquivo/.test(t)));
        await page.setFiles('#file-input', [page.file('ok.pdf', '%PDF', 'application/pdf')]);
        await page.check('#upload-lgpd-consent');
        page.$('#upload-employee-select').value = '';
        await page.window.submitUpload();
        assert.ok(page.toasts().some((t) => /Escolha o colaborador/.test(t)));
        assert.equal(c.writes('documents', 'insert').length, 0);
    });

    test('OCR sugere o tipo pela palavra-chave do documento', async () => {
        const c = client();
        page = await openPage('arquivos', {
            client: c,
            now: NOW,
            fetch: filesOk,
            ocrText: 'REPÚBLICA FEDERATIVA DO BRASIL — Cadastro de Pessoa Física',
        });
        await page.settle(20);
        page.window.openUploadModal(ANA.id);
        await page.settle();
        await page.setFiles('#file-input', [page.file('foto.jpg', 'jpg', 'image/jpeg')]);
        await page.settle(20);
        assert.match(page.text('#ocr-hint'), /Tipo sugerido por OCR: "RG"/);
    });
});
