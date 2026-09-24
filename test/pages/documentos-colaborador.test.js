const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, ANA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const filesOk = async () => new Response('{}', { status: 200 });
const NOW = '2026-06-17T10:00:00-03:00';

const DOCS = [
    {
        id: 'd1',
        employee_id: ANA.id,
        name: 'rg.pdf',
        tipo: 'RG',
        source: 'colaborador',
        status: 'aprovado',
        storage_path: 'emp-ana/rg.pdf',
        created_at: '2026-02-01T10:00:00Z',
        version: 1,
    },
    {
        id: 'd2',
        employee_id: ANA.id,
        name: 'contrato.pdf',
        tipo: 'Contrato de Trabalho',
        source: 'Administrador',
        status: 'aprovado',
        requer_assinatura: true,
        storage_path: 'emp-ana/contrato.pdf',
        created_at: '2026-02-02T10:00:00Z',
    },
    {
        id: 'd0',
        employee_id: ANA.id,
        name: 'rg-antigo.pdf',
        tipo: 'RG',
        source: 'colaborador',
        status: 'recusado',
        is_current: false,
        created_at: '2026-01-01T10:00:00Z',
    },
];

function client(extra = {}) {
    return new FakeSupabase({
        user: COLAB_USER,
        tables: baseTables({
            documents: DOCS.map((d) => ({ ...d })),
            document_audit_log: [],
            document_requirements: [
                { tipo: 'RG', category: 'admissional', contract_type: null, obrigatorio: true },
                { tipo: 'CPF', category: 'admissional', contract_type: null, obrigatorio: true },
                { tipo: 'Exame Admissional', category: 'admissional', contract_type: null, obrigatorio: true },
            ],
            ...extra,
        }),
        rpc: {
            sign_document: ({ p_document_id, p_signer_name }, c) => {
                Object.assign(
                    c.tables.documents.find((d) => d.id === p_document_id),
                    { assinado_em: '2026-06-17T13:00:00Z', assinado_por: p_signer_name }
                );
                return {};
            },
        },
    });
}

describe('documentos-colaborador.html', () => {
    test('lista só as versões atuais e aponta obrigatórios pendentes', async () => {
        page = await openPage('documentos-colaborador', { client: client(), now: NOW });
        assert.equal(page.text('#doc-count-badge'), '2');
        assert.match(page.text('#pending-docs-text'), /2 documentos obrigatórios pendentes/);
        assert.match(page.text('#pending-docs-chips'), /CPF.*Exame Admissional — aguardando o RH/);
        assert.match(page.text('#doc-list'), /contrato\.pdf.*Enviado pelo RH · Aguardando sua assinatura/);
    });

    test('abrir um documento mostra os detalhes; do RH não pode ser removido pelo colaborador', async () => {
        page = await openPage('documentos-colaborador', { client: client(), now: NOW });
        await page.click('.doc-card-item[data-click-args*="d2"]');
        assert.equal(page.text('#action-doc-name'), 'contrato.pdf');
        assert.equal(page.visible('#btn-sign-doc'), true);
        assert.equal(page.$('#btn-delete-doc').classList.contains('hidden'), true);
    });

    test('assinar exige nome e concordância; registra pela RPC e audita', async () => {
        const c = client();
        page = await openPage('documentos-colaborador', { client: c, now: NOW });
        await page.click('.doc-card-item[data-click-args*="d2"]');
        await page.click('#btn-sign-doc');
        assert.equal(page.$('#sign-name-input').value, 'Ana Souza');
        await page.click('[data-click="confirmSignature"]');
        assert.match(page.toasts()[0], /Confirmação necessária/);
        await page.check('#sign-agree-check');
        await page.click('[data-click="confirmSignature"]');
        assert.deepEqual(c.rpcCalls('sign_document')[0].args, { p_document_id: 'd2', p_signer_name: 'Ana Souza' });
        assert.equal(c.writes('document_audit_log', 'insert')[0].payload[0].action, 'assinado');
        assert.match(page.text('#assinatura-area'), /Assinado por Ana Souza/);
    });

    test('enviar novo documento: exige tipo, sobe o arquivo e cria como pendente com guarda legal', async () => {
        const c = client();
        page = await openPage('documentos-colaborador', { client: c, now: NOW, fetch: filesOk });
        await page.click('.pending-doc-chip[data-click="quickUploadTipo"]');
        assert.equal(page.$('#upload-tipo').value, 'CPF');
        await page.setFiles('#file-input', [page.file('cpf.pdf', '%PDF-1.4 cpf', 'application/pdf')]);
        assert.equal(page.text('#file-selected-name'), 'cpf.pdf');
        await page.click('#btn-submit-upload');

        const [ins] = c.writes('documents', 'insert');
        const doc = ins.payload[0];
        assert.equal(doc.tipo, 'CPF');
        assert.equal(doc.status, 'pendente');
        assert.equal(doc.source, 'colaborador');
        assert.equal(doc.retido_ate, '2031-06-17');
        assert.equal(doc.version, 1);
        assert.equal(page.fetches.length, 1);
        assert.match(page.toasts().join(' '), /cpf\.pdf foi enviado para análise do RH/);
    });

    test('reenviar um tipo que já existe cria nova versão e aposenta a anterior', async () => {
        const c = client();
        page = await openPage('documentos-colaborador', { client: c, now: NOW, fetch: filesOk });
        await page.click('#btn-upload');
        page.window.setUploadTipo('RG');
        await page.setFiles('#file-input', [page.file('rg-novo.pdf', '%PDF', 'application/pdf')]);
        await page.click('#btn-submit-upload');
        const doc = c.writes('documents', 'insert')[0].payload[0];
        assert.deepEqual([doc.version, doc.replaces_document_id], [2, 'd1']);
        assert.equal(c.tables.documents.find((d) => d.id === 'd1').is_current, false);
        assert.equal(c.writes('document_audit_log', 'insert')[0].payload[0].action, 'substituido');
    });

    test('arquivo acima de 25 MB é recusado', async () => {
        page = await openPage('documentos-colaborador', { client: client(), now: NOW });
        const grande = page.file('grande.pdf', 'x', 'application/pdf');
        Object.defineProperty(grande, 'size', { value: 26 * 1024 * 1024 });
        await page.setFiles('#file-input', [grande]);
        assert.match(page.toasts()[0], /Arquivo muito grande/);
        assert.equal(page.$('#btn-submit-upload').disabled, true);
    });

    test('remover apaga o registro, depois o arquivo, e audita', async () => {
        const c = client();
        page = await openPage('documentos-colaborador', { client: c, now: NOW });
        await page.click('.doc-card-item[data-click-args*="d1"]');
        await page.click('#btn-delete-doc');
        const ordem = c.calls
            .filter((x) => (x.table === 'documents' && x.op === 'delete') || (x.storage === 'documents' && x.op === 'remove'))
            .map((x) => x.op);
        assert.deepEqual(ordem, ['delete', 'remove']);
        assert.equal(c.writes('document_audit_log', 'insert')[0].payload[0].action, 'excluido');
    });

    test('se o banco recusar a exclusão, o arquivo NÃO é apagado', async () => {
        const c = client();
        c.errors['documents:delete'] = { message: 'permission denied' };
        page = await openPage('documentos-colaborador', { client: c, now: NOW });
        await page.click('.doc-card-item[data-click-args*="d1"]');
        await page.click('#btn-delete-doc');
        assert.equal(c.calls.filter((x) => x.storage === 'documents' && x.op === 'remove').length, 0);
        assert.equal(c.writes('document_audit_log', 'insert').length, 0);
        assert.ok(page.toasts().some((t) => /Não foi possível remover/.test(t)));
    });

    test('visualizar abre o arquivo pelo NexusFiles', async () => {
        page = await openPage('documentos-colaborador', {
            client: client(),
            now: NOW,
            fetch: async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { 'content-type': 'application/pdf' } }),
        });
        await page.click('.doc-card-item[data-click-args*="d1"]');
        await page.click('[data-click="viewSelectedDoc"]');
        await page.settle(20);
        assert.ok(page.fetches.some((f) => /nexus-files/.test(f.url)) || page.client.calls.some((x) => x.storage === 'documents' && x.op === 'download'));
    });
});
