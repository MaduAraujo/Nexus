const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

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

function client(docs, extra = {}) {
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
    });
}

async function abrir(c, opts = {}) {
    page = await openPage('arquivos', { client: c, now: NOW, fetch: filesOk, ...opts });
    await page.settle(20);
    return page;
}

const irPara = (p, aba) => p.click(`.tab-btn[data-tab="${aba}"]`);
const linhas = (p) => p.$$('#files-tbody tr').map((tr) => tr.textContent.replace(/\s+/g, ' '));
const toastCom = (p, re) => p.toasts().some((t) => re.test(t));

describe('arquivos.html — devolver documento preenchido e assinado', () => {
    test('termo do colaborador: devolver abre o envio já preenchido; enviar aprova o original e avisa quem devolveu', async () => {
        const c = client([colab('vt', { name: 'vale-transporte.pdf', tipo: 'Termo de Vale-Transporte' })]);
        await abrir(c);
        await irPara(page, 'colaborador');
        await page.click('#files-tbody [data-click="openReturnModal"]');
        assert.ok(page.$('#upload-modal').classList.contains('open'));
        assert.equal(page.$('#upload-employee-select').value, BIA.id);
        assert.equal(page.$('#upload-category').value, 'admissional|Termo de Vale-Transporte');
        assert.match(
            page.text('#upload-return-hint-text'),
            /Anexe a versão preenchida e assinada de "Termo de Vale-Transporte"\. Ao enviar, o documento de Bia Lima é aprovado/
        );

        await page.setFiles('#file-input', [page.file('vt-assinado.pdf', '%PDF')]);
        page.$('#upload-lgpd-consent').checked = true;
        await page.click('#btn-submit-upload');
        await page.waitFor(() => toastCom(page, /Devolvido ao colaborador/));
        assert.ok(toastCom(page, /Termo de Vale-Transporte preenchido e assinado foi enviado para Bia Lima/));
        const original = c.tables.documents.find((d) => d.id === 'vt');
        assert.deepEqual([original.status, original.category], ['aprovado', 'admissional']);
        assert.equal(c.calls.filter((x) => x.fn === 'send-document-push').length, 1);
        assert.ok(page.$('#upload-return-hint').classList.contains('hidden'), 'fechar o envio limpa a devolução');

        await irPara(page, 'admissional');
        const texto = linhas(page).join(' | ');
        assert.match(texto, /vale-transporte\.pdf.*Devolvido ao colaborador/);
        assert.equal(page.$('#files-tbody [data-click="openReturnModal"]'), null, 'já devolvido: sem botão de devolver');
    });

    test('documento recusado ou de tipo comum não tem o botão de devolver', async () => {
        const c = client([colab('vt', { name: 'vt.pdf', tipo: 'Termo de Vale-Transporte', status: 'recusado' }), colab('rg', { name: 'rg.pdf' })]);
        await abrir(c);
        await irPara(page, 'colaborador');
        assert.equal(page.$('#files-tbody [data-click="openReturnModal"]'), null);
        page.window.openReturnModal('nao-existe');
        assert.ok(!page.$('#upload-modal').classList.contains('open'));
    });
});

describe('arquivos.html — carga, ícones, validade e categoria faltando', () => {
    test('documento aprovado do colaborador sem categoria recebe a categoria (demissional para desligado) e é gravado uma vez', async () => {
        const c = client([colab('aso', { name: 'aso.pdf', tipo: 'Exame Admissional', status: 'aprovado', category: null, employee_id: CAIO.id })]);
        c.tables.employees.find((e) => e.id === CAIO.id).status = 'Inativo';
        await abrir(c);
        await irPara(page, 'demissional');
        assert.match(linhas(page).join(' '), /aso\.pdf/);
        const gravacoes = c.writes('documents', 'update').filter((w) => w.payload.category);
        assert.deepEqual(
            gravacoes.map((w) => w.payload.category),
            ['demissional']
        );
        c.emit('documents', { eventType: 'UPDATE', new: {} });
        await page.settle(20);
        assert.equal(c.writes('documents', 'update').filter((w) => w.payload.category).length, 1, 'não grava de novo');
    });

    test('ícone por tipo de arquivo e validade distante mostra a data', async () => {
        const c = client([
            rh('a', { name: 'contrato.docx', tipo: 'Contrato de Trabalho' }),
            rh('b', { name: 'foto.png', tipo: 'RG', data_validade: '2027-06-17' }),
            rh('c', { name: 'planilha.xlsx', tipo: 'CPF' }),
        ]);
        await abrir(c);
        assert.ok(page.$('#files-tbody .file-icon--doc'));
        assert.ok(page.$('#files-tbody .file-icon--img'));
        assert.ok(page.$('#files-tbody .file-icon--other'));
        assert.equal(page.text('#files-tbody .badge--valido'), '17/06/2027', 'data sem horário não volta um dia pelo fuso');
    });

    test('marcações de notificação ilegíveis no aparelho são ignoradas', async () => {
        await abrir(client([]), { localStorage: { [`nexus:arquivos-notif-read:${RH_USER.id}`]: '{quebrado' } });
        assert.equal(page.$$('#files-tbody tr .row-check').length, 0);
    });

    test('link com ?colaborador= filtra pelo colaborador e mostra o nome na busca', async () => {
        const c = client([rh('a', { name: 'contrato-ana.pdf', tipo: 'Contrato de Trabalho' }), rh('b', { name: 'contrato-bia.pdf', employee_id: BIA.id })]);
        await abrir(c, { query: `?colaborador=${BIA.id}` });
        assert.equal(page.$('#search-input').value, 'Bia Lima');
        assert.ok(!page.$('#search-clear').classList.contains('hidden'));
        assert.deepEqual(
            linhas(page).map((l) => /contrato-\w+\.pdf/.exec(l)[0]),
            ['contrato-bia.pdf']
        );
        await page.fill('#search-input', '');
        assert.equal(page.$$('#files-tbody .row-check').length, 2, 'digitar tira o filtro do link');
    });
});

describe('arquivos.html — filtros, busca, painéis e seleção', () => {
    const DOCS = [
        colab('rg-bia', { name: 'rg-bia.pdf' }),
        colab('rg-ana', { name: 'rg-ana.pdf', employee_id: ANA.id, status: 'recusado' }),
        colab('rg-caio', { name: 'rg-caio.pdf', employee_id: CAIO.id }),
    ];

    test('menu de filtro: posição, status e departamento filtram; limpar volta tudo; Esc e clique fora fecham', async () => {
        await abrir(client(DOCS));
        await irPara(page, 'colaborador');
        const aberto = () => page.$('#colab-filter-menu').classList.contains('open');
        Object.defineProperty(page.window, 'innerWidth', { value: 200, configurable: true });
        await page.click('#colab-filter-trigger');
        assert.ok(aberto());
        assert.equal(page.$('#colab-filter-menu').style.left, '12px', 'não sai da tela');
        page.window.dispatchEvent(new page.window.Event('resize'));
        await page.click('#colab-filter-trigger');
        assert.ok(!aberto());

        await page.click('#colab-filter-trigger');
        await page.click('#colab-filter-menu .btn-filter[data-status="recusado"]');
        assert.ok(!aberto());
        assert.equal(page.$$('#files-tbody .row-check').length, 1);
        assert.ok(!page.$('#filter-clear-btn').classList.contains('hidden'));

        await page.click('#colab-filter-trigger');
        await page.click('#colab-dept-filter-list .btn-filter[data-dept="TI"]');
        assert.equal(page.$$('#files-tbody .row-check').length, 0);
        await page.click('#filter-clear-btn');
        assert.equal(page.$$('#files-tbody .row-check').length, 3);
        assert.ok(page.$('#filter-clear-btn').classList.contains('hidden'));
        assert.ok(page.$('#colab-filter-menu .btn-filter[data-status=""]').classList.contains('active'));

        await page.click('#colab-filter-trigger');
        await page.click('#files-tbody');
        assert.ok(!aberto());
        await page.click('#colab-filter-trigger');
        page.$('#colab-filter-menu').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.ok(aberto(), 'clique dentro do menu não fecha');
        await irPara(page, 'admissional');
        assert.ok(!aberto(), 'trocar de aba fecha o menu');
    });

    test('busca, limpar busca, sino, checklist e desmarcar seleção', async () => {
        const c = client(DOCS, {
            document_requirements: [{ id: 'r1', tipo: 'Contrato de Trabalho', category: 'admissional', contract_type: null, obrigatorio: true }],
        });
        await abrir(c);
        await irPara(page, 'colaborador');
        await page.fill('#search-input', 'caio');
        assert.equal(page.$$('#files-tbody .row-check').length, 1);
        await page.click('#search-clear');
        assert.equal(page.$('#search-input').value, '');
        assert.equal(page.$$('#files-tbody .row-check').length, 3);

        await page.click('#btn-notif');
        assert.ok(!page.$('#notif-panel').classList.contains('hidden'));
        await page.click('#btn-notif');
        assert.ok(page.$('#notif-panel').classList.contains('hidden'));

        await page.click('#checklist-banner-toggle');
        assert.ok(page.$('#checklist-banner').classList.contains('open'));
        await page.click('#checklist-banner-toggle');
        assert.ok(!page.$('#checklist-banner').classList.contains('open'));

        await page.check(page.$('.row-check[data-id="rg-bia"]'));
        await page.check(page.$('.row-check[data-id="rg-bia"]'), false);
        assert.ok(page.$('#bulk-bar').classList.contains('hidden'));
        await page.check('#select-all-checkbox');
        assert.equal(page.text('#bulk-bar-count'), '3 selecionados');
        await page.check('#select-all-checkbox', false);
        assert.ok(page.$('#bulk-bar').classList.contains('hidden'));
    });

    test('calendário de período: navega entre anos, início depois de fim troca o início, Esc fecha', async () => {
        await abrir(client(DOCS));
        await irPara(page, 'colaborador');
        await page.click('#filter-date-trigger');
        const aberto = () => page.$('#filter-calendar-popover').classList.contains('open');
        assert.ok(aberto());
        for (let i = 0; i < 6; i++) await page.click('#filter-calendar-prev');
        assert.equal(page.text('#filter-calendar-title'), 'Dezembro 2025');
        for (let i = 0; i < 6; i++) await page.click('#filter-calendar-next');
        await page.click('#filter-calendar-grid [data-day="10"]');
        await page.click('#filter-calendar-grid [data-day="5"]');
        assert.ok(page.$('#filter-calendar-grid [data-day="5"]').classList.contains('calendar-day--range-start'), 'clicar antes do início troca o início');
        for (let i = 0; i < 7; i++) await page.click('#filter-calendar-next');
        assert.equal(page.text('#filter-calendar-title'), 'Janeiro 2027');
        await page.key('#filter-date-trigger', 'Escape');
        assert.ok(!aberto());
    });
});

describe('arquivos.html — falhas nas ações', () => {
    test('aprovar em lote e aprovar um documento: erro do banco avisa', async () => {
        const c = client([colab('rg-bia', { name: 'rg-bia.pdf' })]);
        c.errors['documents:update'] = { message: 'RLS' };
        await abrir(c);
        await irPara(page, 'colaborador');
        await page.check(page.$('.row-check[data-id="rg-bia"]'));
        await page.click('#bulk-bar-actions [data-click="bulkApproveColab"]');
        assert.ok(toastCom(page, /Não foi possível aprovar os documentos selecionados/));
        await page.window.approveColabDoc('rg-bia');
        assert.ok(toastCom(page, /Não foi possível aprovar o documento\./));
    });

    test('baixar em lote: arquivos sem download avisam; falha ao gerar o link conta como falha', async () => {
        const c = client([rh('a', { name: 'a.pdf', tipo: 'CPF', storage_path: null }), rh('b', { name: 'b.pdf', tipo: 'RG' })]);
        await abrir(c);
        await page.check(page.$('.row-check[data-id="a"]'));
        await page.click('#bulk-bar-actions [data-click="bulkDownloadRh"]');
        assert.ok(toastCom(page, /Nenhum arquivo com download disponível/));
        page.window.NexusFiles.download = async () => ({ blob: new page.window.Blob(['x']) });
        page.window.URL.createObjectURL = () => {
            throw new Error('sem memória');
        };
        await page.check(page.$('.row-check[data-id="b"]'));
        await page.click('#bulk-bar-actions [data-click="bulkDownloadRh"]');
        assert.ok(toastCom(page, /Não foi possível baixar: b\.pdf/));
    });

    test('visualizar com erro avisa; excluir arquivo do RH some da lista', async () => {
        const c = client([rh('a', { name: 'a.pdf', tipo: 'CPF' })], {});
        c.handlers.rpc.soft_delete_documents = {};
        await abrir(c, { prompt: () => 'Arquivo enviado por engano' });
        page.window.NexusFiles.open = async () => ({ error: { message: 'Arquivo corrompido.' } });
        await page.click('#files-tbody [data-click="viewFile"]');
        assert.ok(toastCom(page, /Não foi possível abrir.*Arquivo corrompido\./));
        await page.click('#files-tbody [data-click="deleteFile"]');
        assert.ok(toastCom(page, /Arquivo excluído!/));
        assert.equal(page.$$('#files-tbody .row-check').length, 0);
    });

    test('auditoria: filtro sem resultado, fechar; requisitos: erro ao remover, fechar', async () => {
        const c = client([], {
            document_audit_log: [
                { id: 'l1', action: 'criado', document_name: 'a.pdf', employee_id: ANA.id, actor_name: 'Administrador', created_at: '2026-06-10T10:00:00Z' },
            ],
            document_requirements: [{ id: 'r1', tipo: 'Contrato de Trabalho', category: 'admissional', contract_type: null, obrigatorio: true }],
        });
        await abrir(c);
        await page.click('[data-click="openAuditModal"]');
        await page.click('#audit-filter-action-trigger');
        assert.ok(page.$('#audit-filter-action-popover').classList.contains('open'));
        await page.click('#audit-filter-action-trigger');
        assert.ok(!page.$('#audit-filter-action-popover').classList.contains('open'));
        await page.click('#audit-filter-action-trigger');
        await page.key('#audit-filter-action-trigger', 'Escape');
        await page.click('#audit-filter-action-trigger');
        await page.click('#audit-log-list');
        assert.ok(!page.$('#audit-filter-action-popover').classList.contains('open'));
        await page.click('#audit-filter-action-trigger');
        await page.click('#audit-filter-action-popover .select-option[data-value="excluido"]');
        assert.match(page.text('#audit-log-list'), /Nenhum registro encontrado/);
        await page.click('[data-click="closeAuditModal"]');
        assert.ok(!page.$('#audit-modal').classList.contains('open'));

        await page.click('[data-click="openRequirementsModal"]');
        c.errors['document_requirements:delete'] = { message: 'x' };
        await page.click('#requirements-admissional [data-click="removeRequirement"]');
        assert.ok(toastCom(page, /Não foi possível remover o tipo/));
        await page.click('[data-click="closeRequirementsModal"]');
        assert.ok(!page.$('#requirements-modal').classList.contains('open'));
    });
});

describe('arquivos.html — envio: validade, arrastar, câmera, OCR e falhas', () => {
    test('validade pelo calendário: navega entre anos, escolhe, limpa; fecha com Esc e clique fora', async () => {
        await abrir(client([]));
        await page.click('[data-click="openUploadModal"]');
        const aberto = () => page.$('#upload-validade-popover').classList.contains('open');
        await page.click('#upload-validade-trigger');
        assert.ok(aberto());
        for (let i = 0; i < 6; i++) await page.click('#upload-validade-prev');
        assert.equal(page.text('#upload-validade-title'), 'Dezembro 2025');
        for (let i = 0; i < 7; i++) await page.click('#upload-validade-next');
        for (let i = 0; i < 6; i++) await page.click('#upload-validade-next');
        assert.equal(page.text('#upload-validade-title'), 'Janeiro 2027');
        await page.click('#upload-validade-grid .calendar-day--muted');
        assert.ok(aberto());
        await page.click('#upload-validade-grid button[data-day="31"]:not(.calendar-day--muted)');
        assert.ok(!aberto());
        assert.equal(page.$('#upload-validade').value, '2027-01-31');
        assert.equal(page.text('#upload-validade-text'), '31/01/2027');
        assert.ok(!page.$('#upload-validade-footer').classList.contains('hidden'));
        await page.click('#upload-validade-trigger');
        assert.equal(page.text('#upload-validade-title'), 'Janeiro 2027');
        await page.click('#upload-validade-trigger');
        assert.ok(!aberto());
        await page.click('#upload-validade-trigger');
        await page.key('#upload-validade-trigger', 'Escape');
        assert.ok(!aberto());
        await page.click('#upload-validade-trigger');
        await page.click('#upload-modal');
        assert.ok(!aberto());
        await page.click('#upload-validade-clear');
        assert.equal(page.$('#upload-validade').value, '');
    });

    test('arrastar arquivo, câmera, remover da lista; Esc fecha tudo', async () => {
        await abrir(client([]));
        await page.click('[data-click="openUploadModal"]');
        const dz = page.$('#drop-zone');
        dz.dispatchEvent(new page.window.Event('dragover', { cancelable: true }));
        assert.ok(dz.classList.contains('dragover'));
        dz.dispatchEvent(new page.window.Event('dragleave'));
        assert.ok(!dz.classList.contains('dragover'));
        const drop = new page.window.Event('drop', { cancelable: true });
        drop.dataTransfer = { files: [page.file('arrastado.pdf', '%PDF')] };
        dz.dispatchEvent(drop);
        await page.settle();
        let abriuCamera = 0;
        page.$('#camera-input').click = () => abriuCamera++;
        await page.click('#btn-camera');
        assert.equal(abriuCamera, 1);
        await page.setFiles('#camera-input', [page.file('foto.pdf', '%PDF')]);
        assert.deepEqual(
            page.$$('#files-selected-list .file-selected-item span').map((e) => e.textContent),
            ['arrastado.pdf', 'foto.pdf']
        );
        await page.click('#files-selected-list [data-click="removeSelectedFile"]');
        assert.deepEqual(
            page.$$('#files-selected-list .file-selected-item span').map((e) => e.textContent),
            ['foto.pdf']
        );
        await page.key('body', 'Escape');
        assert.ok(!page.$('#upload-modal').classList.contains('open'));
    });

    test('OCR: sem palavra-chave pede escolha manual; tipo sem opção na lista orienta; erro do OCR avisa', async () => {
        await abrir(client([]), { ocrText: 'texto qualquer sem nada' });
        await page.click('[data-click="openUploadModal"]');
        await page.setFiles('#file-input', [page.file('doc1.jpg', 'x', 'image/jpeg')]);
        await page.waitFor(() => /Selecione manualmente/.test(page.text('#ocr-hint-text')));

        page.window.Tesseract.recognize = async () => ({ data: { text: 'GUIA DE RECOLHIMENTO FGTS' } });
        page.$$('#upload-category-popover .select-option')
            .filter((o) => /Guia FGTS/.test(o.dataset.value))
            .forEach((o) => o.remove());
        await page.setFiles('#file-input', [page.file('doc2.png', 'y', 'image/png')]);
        await page.waitFor(() => /Tipo sugerido por OCR: "Guia FGTS" — selecione manualmente/.test(page.text('#ocr-hint-text')));

        page.window.Tesseract.recognize = async () => {
            throw new Error('falhou');
        };
        await page.setFiles('#file-input', [page.file('doc3.jpeg', 'z', 'image/jpeg')]);
        await page.waitFor(() => /Não foi possível analisar o documento automaticamente/.test(page.text('#ocr-hint-text')));
    });

    test('upload que falha avisa pelo nome e não registra nada; push que falha não trava', async () => {
        const c = client([]);
        c.handlers.functions['send-document-push'] = () => Promise.reject(new Error('push fora'));
        await abrir(c);
        await page.click('[data-click="openUploadModal"]');
        await page.click('#upload-employee-select-trigger');
        await page.click(`#upload-employee-select-popover .select-option[data-value="${ANA.id}"]`);
        await page.click('#upload-category-trigger');
        await page.click('#upload-category-popover .select-option[data-value="admissional|CPF"]');
        await page.setFiles('#file-input', [page.file('cpf.pdf', '%PDF'), page.file('rg.pdf', '%PDF')]);
        page.$('#upload-lgpd-consent').checked = true;
        let n = 0;
        page.window.NexusFiles.upload = async () => ({ error: ++n === 1 ? { message: 'x' } : null });
        await page.click('#btn-submit-upload');
        await page.waitFor(() => toastCom(page, /Arquivos carregados com sucesso/));
        assert.ok(toastCom(page, /Não foi possível enviar cpf\.pdf/));
        assert.deepEqual(
            c.writes('documents', 'insert').map((w) => w.payload[0].name),
            ['rg.pdf']
        );
    });

    test('aviso some sozinho', async () => {
        await abrir(client([]));
        const agendados = [];
        page.window.setTimeout = (fn, ms) => agendados.push([fn, ms]);
        await page.click('#files-tbody');
        page.window.viewFile('x', null);
        const toast = page.$$('.toast').at(-1);
        agendados.find(([, ms]) => ms === 4000)[0]();
        assert.ok(toast.classList.contains('hide'));
        agendados.find(([, ms]) => ms === 400)[0]();
        assert.ok(!toast.isConnected);
    });
});

describe('arquivos.html — caminhos restantes', () => {
    test('clicar na área de arrastar abre o seletor de arquivo', async () => {
        await abrir(client([]));
        await page.click('[data-click="openUploadModal"]');
        let abriu = 0;
        page.$('#file-input').click = () => abriu++;
        await page.click('#drop-zone');
        assert.equal(abriu, 1);
    });

    test('link com ?colaborador= de desligado encontra o nome entre os inativos', async () => {
        const c = client([rh('a', { name: 'rescisao-caio.pdf', employee_id: CAIO.id, category: 'demissional', tipo: 'Termo de Rescisão' })]);
        c.tables.employees.find((e) => e.id === CAIO.id).status = 'Inativo';
        await abrir(c, { query: `?colaborador=${CAIO.id}` });
        assert.equal(page.$('#search-input').value, 'Caio Prado');
    });

    test('Esc no calendário de período fecha só o calendário', async () => {
        await abrir(client([colab('rg-bia', { name: 'rg-bia.pdf' })]));
        await irPara(page, 'colaborador');
        await page.click('#filter-date-trigger');
        await page.click('#filter-calendar-grid [data-day="10"]');
        assert.ok(page.$('#filter-calendar-popover').classList.contains('open'));
        await page.click('#files-tbody');
        assert.ok(!page.$('#filter-calendar-popover').classList.contains('open'), 'clique fora fecha');
        await page.click('#filter-date-trigger');
        await page.key('#filter-date-trigger', 'Escape');
        assert.ok(!page.$('#filter-calendar-popover').classList.contains('open'));
    });
});
