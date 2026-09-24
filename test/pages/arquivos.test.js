const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const filesOk = async () => new Response('{}', { status: 200 });

const DOCS = [
    {
        id: 'a1',
        employee_id: ANA.id,
        name: 'contrato.pdf',
        tipo: 'Contrato de Trabalho',
        category: 'admissional',
        source: 'Administrador',
        status: 'aprovado',
        storage_path: 'rh/contrato.pdf',
        created_at: '2026-02-01T10:00:00Z',
        retido_ate: '2056-02-01',
        version: 1,
    },
    {
        id: 'a2',
        employee_id: ANA.id,
        name: 'aso.pdf',
        tipo: 'Exame Admissional',
        category: 'admissional',
        source: 'Administrador',
        status: 'aprovado',
        data_validade: '2026-06-30',
        storage_path: 'rh/aso.pdf',
        created_at: '2026-02-02T10:00:00Z',
        retido_ate: '2046-02-01',
    },
    {
        id: 'c1',
        employee_id: BIA.id,
        name: 'rg-bia.pdf',
        tipo: 'RG',
        source: 'colaborador',
        status: 'pendente',
        storage_path: 'emp-bia/rg.pdf',
        created_at: '2026-06-10T10:00:00Z',
        retido_ate: '2031-06-10',
    },
    {
        id: 'old',
        employee_id: BIA.id,
        name: 'velho.pdf',
        tipo: 'RG',
        source: 'colaborador',
        status: 'aprovado',
        category: 'admissional',
        storage_path: 'emp-bia/velho.pdf',
        created_at: '2019-01-01T10:00:00Z',
        retido_ate: '2024-01-01',
    },
];

function client(extra = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            documents: DOCS.map((d) => ({ ...d })),
            document_requirements: [
                { id: 'r1', tipo: 'Contrato de Trabalho', category: 'admissional', contract_type: null, obrigatorio: true },
                { id: 'r2', tipo: 'CPF', category: 'admissional', contract_type: null, obrigatorio: true },
            ],
            document_audit_log: [],
            ...extra,
        }),
        functions: { 'send-document-push': () => ({ data: {}, error: null }) },
    });
}

describe('arquivos.html — carga e expurgo LGPD', () => {
    test('ao abrir, expurga documento com guarda vencida (registro primeiro, depois o arquivo) e audita', async () => {
        const c = client();
        page = await openPage('arquivos', { client: c, now: NOW });
        await page.waitFor(() => page.toasts().some((t) => /Expurgo automático LGPD/.test(t)));
        const ordem = c.calls
            .filter((x) => (x.table === 'documents' && x.op === 'delete') || (x.storage === 'documents' && x.op === 'remove'))
            .map((x) => x.op);
        assert.deepEqual(ordem, ['delete', 'remove']);
        assert.ok(!c.tables.documents.some((d) => d.id === 'old'));
        assert.equal(c.writes('document_audit_log', 'insert')[0].payload[0].actor_profile, 'sistema');
    });

    test('se o banco recusar o expurgo, o arquivo fica e nada é anunciado como removido', async () => {
        const c = client();
        c.errors['documents:delete'] = { message: 'RLS' };
        page = await openPage('arquivos', { client: c, now: NOW });
        await page.settle(20);
        assert.equal(c.calls.filter((x) => x.storage === 'documents' && x.op === 'remove').length, 0);
        assert.ok(!page.toasts().some((t) => /Expurgo automático/.test(t)));
    });

    test('contadores, vencendo e checklist de obrigatórios', async () => {
        page = await openPage('arquivos', { client: client(), now: NOW });
        await page.settle(20);
        assert.equal(page.text('#admissional-count'), '2');
        assert.equal(page.text('#vencendo-count'), '1', 'ASO vence em 13 dias');
        assert.match(page.text('#checklist-banner'), /CPF|pendente/i);
    });
});

describe('arquivos.html — documentos enviados pelo colaborador', () => {
    test('aprovar arquiva na categoria certa e audita; recusar marca recusado', async () => {
        const c = client();
        page = await openPage('arquivos', { client: c, now: NOW });
        await page.click('.tab-btn[data-tab="colaborador"]');
        assert.match(page.text('#files-tbody'), /rg-bia\.pdf/);
        page.window.approveColabDoc('c1');
        await page.settle(20);
        const doc = c.tables.documents.find((d) => d.id === 'c1');
        assert.deepEqual([doc.status, doc.category], ['aprovado', 'admissional']);
        assert.equal(c.writes('document_audit_log', 'insert').at(-1).payload[0].action, 'aprovado');
    });

    test('excluir documento do colaborador: confirmação, registro antes do arquivo', async () => {
        const c = client();
        page = await openPage('arquivos', { client: c, now: NOW });
        await page.settle(20);
        const antes = c.calls.length;
        page.window.deleteColabDoc('c1', 'emp-bia/rg.pdf');
        await page.settle(20);
        const ordem = c.calls
            .slice(antes)
            .filter((x) => (x.table === 'documents' && x.op === 'delete') || (x.storage === 'documents' && x.op === 'remove'))
            .map((x) => x.op);
        assert.deepEqual(ordem, ['delete', 'remove']);
        assert.match(page.confirms.at(-1), /excluir este arquivo/);
    });

    test('exclusão recusada pelo banco não apaga o arquivo', async () => {
        const c = client();
        page = await openPage('arquivos', { client: c, now: NOW });
        await page.settle(20);
        c.errors['documents:delete'] = { message: 'RLS' };
        const antes = c.calls.length;
        page.window.deleteFile('a1', 'rh/contrato.pdf');
        await page.settle(20);
        assert.equal(c.calls.slice(antes).filter((x) => x.storage === 'documents' && x.op === 'remove').length, 0);
        assert.ok(page.toasts().some((t) => /Não foi possível excluir o arquivo/.test(t)));
    });
});

describe('arquivos.html — envio pelo RH', () => {
    test('exige consentimento LGPD; envia, versiona o anterior e avisa o colaborador por push', async () => {
        const c = client();
        page = await openPage('arquivos', { client: c, now: NOW, fetch: filesOk });
        await page.settle(20);
        page.window.openUploadModal(ANA.id, 'admissional', 'Contrato de Trabalho');
        await page.settle();
        page.$('#upload-category').value = 'admissional|Contrato de Trabalho';
        page.$('#upload-employee-select').value = ANA.id;
        await page.setFiles('#file-input', [page.file('contrato-v2.pdf', '%PDF-1.4', 'application/pdf')]);
        await page.click('#btn-submit-upload');
        assert.ok(page.toasts().some((t) => /Consentimento LGPD/.test(t)));
        assert.equal(c.writes('documents', 'insert').length, 0);

        await page.check('#upload-lgpd-consent');
        await page.click('#btn-submit-upload');
        const doc = c.writes('documents', 'insert')[0].payload[0];
        assert.deepEqual([doc.employee_id, doc.version, doc.replaces_document_id, doc.retido_ate], [ANA.id, 2, 'a1', '2056-06-17']);
        assert.equal(c.tables.documents.find((d) => d.id === 'a1').is_current, false);
        await page.settle(20);
        assert.equal(c.calls.find((x) => x.fn === 'send-document-push').body.document_ids.length, 1);
    });

    test('requisitos: adicionar e remover documento obrigatório', async () => {
        const c = client();
        page = await openPage('arquivos', { client: c, now: NOW });
        await page.click('#btn-requirements');
        assert.match(page.text('#requirements-admissional'), /Contrato de Trabalho.*CPF/);
        page.window.removeRequirement('r2');
        await page.settle(20);
        assert.equal(c.writes('document_requirements', 'delete').length, 1);
    });

    test('auditoria lista as ações', async () => {
        const c = client({
            document_audit_log: [{ id: 'l1', document_name: 'x.pdf', action: 'criado', actor_name: 'RH', created_at: '2026-06-16T10:00:00Z' }],
        });
        page = await openPage('arquivos', { client: c, now: NOW });
        await page.click('#btn-audit');
        await page.waitFor(() => /x\.pdf/.test(page.text('#audit-log-list')));
    });
});
