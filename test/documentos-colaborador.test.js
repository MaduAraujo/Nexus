const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('../test-support/mock-supabase');

let documentos;

before(() => {
    global.window = global;
    global.document = { addEventListener: () => {}, getElementById: () => null };
    require('../src/javascript/domain/requisitos-documentos.js');
    documentos = require('../src/javascript/documentos-colaborador.js');
});

beforeEach(() => {
    documentos.__setStateForTest({
        myEmployeeId: 'c1',
        emp: { name: 'Colaboradora', contract_type: 'CLT' },
        user: { id: 'u1', email: 'colab@nexus.test' },
    });
});

describe('computeRetentionDate (prazo de guarda LGPD por tipo de documento)', () => {
    test('tipos trabalhistas de 30 anos (ex.: Contrato de Trabalho)', () => {
        const esperado = new Date();
        esperado.setFullYear(esperado.getFullYear() + 30);
        assert.equal(documentos.computeRetentionDate('Contrato de Trabalho'), esperado.toISOString().slice(0, 10));
    });

    test('exames têm 20 anos', () => {
        const esperado = new Date();
        esperado.setFullYear(esperado.getFullYear() + 20);
        assert.equal(documentos.computeRetentionDate('Exame Admissional'), esperado.toISOString().slice(0, 10));
    });

    test('RG/CPF/comprovante de residência têm 5 anos', () => {
        const esperado = new Date();
        esperado.setFullYear(esperado.getFullYear() + 5);
        assert.equal(documentos.computeRetentionDate('RG'), esperado.toISOString().slice(0, 10));
    });

    test('tipo não listado cai no padrão de 5 anos', () => {
        const esperado = new Date();
        esperado.setFullYear(esperado.getFullYear() + 5);
        assert.equal(documentos.computeRetentionDate('Certificado de Curso'), esperado.toISOString().slice(0, 10));
    });
});

describe('getIconInfo (ícone por extensão do arquivo)', () => {
    test('pdf, word, imagem e desconhecido', () => {
        assert.deepEqual(documentos.getIconInfo('contrato.pdf'), { cls: 'pdf', fa: 'fa-file-pdf' });
        assert.deepEqual(documentos.getIconInfo('carta.docx'), { cls: 'doc', fa: 'fa-file-word' });
        assert.deepEqual(documentos.getIconInfo('foto.PNG'), { cls: 'img', fa: 'fa-file-image' });
        assert.deepEqual(documentos.getIconInfo('arquivo.zip'), { cls: 'other', fa: 'fa-file' });
    });

    test('nome sem extensão não quebra', () => {
        assert.deepEqual(documentos.getIconInfo(''), { cls: 'other', fa: 'fa-file' });
        assert.deepEqual(documentos.getIconInfo(undefined), { cls: 'other', fa: 'fa-file' });
    });
});

describe('missingRequiredTipos', () => {
    test('só sobra o que ainda falta enviar', () => {
        assert.deepEqual(documentos.missingRequiredTipos(['RG', 'CPF', 'Contrato'], ['RG']), ['CPF', 'Contrato']);
    });

    test('nada obrigatório falta quando todos já foram enviados', () => {
        assert.deepEqual(documentos.missingRequiredTipos(['RG', 'CPF'], ['RG', 'CPF', 'Extra']), []);
    });
});

describe('statusOf (situação exibida para cada documento)', () => {
    beforeEach(() => {
        documentos.__setStateForTest({
            myDocs: [
                { id: 'd1', tipo: 'Termo de Compromisso de Estágio', source: 'colaborador', status: 'pendente', created_at: '2026-01-01T00:00:00Z' },
                { id: 'd2', tipo: 'Termo de Compromisso de Estágio', source: 'Administrador', status: 'aprovado', created_at: '2026-02-01T00:00:00Z' },
            ],
        });
    });

    test('documento do colaborador com uma versão do RH devolvida depois: "Devolvido pelo RH"', () => {
        const st = documentos.statusOf({ id: 'd1', tipo: 'Termo de Compromisso de Estágio', source: 'colaborador', created_at: '2026-01-01T00:00:00Z' });
        assert.equal(st.label, 'Devolvido pelo RH');
    });

    test('tipo fora da lista de devolução usa o status normal, mesmo com versão do RH depois', () => {
        documentos.__setStateForTest({
            myDocs: [
                { id: 'd1', tipo: 'RG', source: 'colaborador', status: 'pendente', created_at: '2026-01-01T00:00:00Z' },
                { id: 'd2', tipo: 'RG', source: 'Administrador', status: 'aprovado', created_at: '2026-02-01T00:00:00Z' },
            ],
        });
        const st = documentos.statusOf({ id: 'd1', tipo: 'RG', source: 'colaborador', status: 'pendente', created_at: '2026-01-01T00:00:00Z' });
        assert.equal(st.label, 'Pendente');
    });

    test('versão do RH anterior (não depois) não conta como devolução', () => {
        documentos.__setStateForTest({
            myDocs: [
                { id: 'd0', tipo: 'Termo de Compromisso de Estágio', source: 'Administrador', status: 'aprovado', created_at: '2025-12-01T00:00:00Z' },
                { id: 'd1', tipo: 'Termo de Compromisso de Estágio', source: 'colaborador', status: 'pendente', created_at: '2026-01-01T00:00:00Z' },
            ],
        });
        const st = documentos.statusOf({
            id: 'd1',
            tipo: 'Termo de Compromisso de Estágio',
            source: 'colaborador',
            status: 'pendente',
            created_at: '2026-01-01T00:00:00Z',
        });
        assert.equal(st.label, 'Pendente');
    });

    test('status normais (pendente/aprovado/recusado) quando não há devolução aplicável', () => {
        assert.equal(documentos.statusOf({ id: 'x', tipo: 'RG', source: 'colaborador', status: 'aprovado' }).label, 'Aprovado');
        assert.equal(documentos.statusOf({ id: 'x', tipo: 'RG', source: 'colaborador', status: 'recusado' }).label, 'Recusado');
        assert.equal(documentos.statusOf({ id: 'x', tipo: 'RG', source: 'colaborador', status: 'pendente' }).label, 'Pendente');
    });

    test('status desconhecido/ausente cai em "Pendente"', () => {
        assert.equal(documentos.statusOf({ id: 'x', tipo: 'RG', source: 'colaborador' }).label, 'Pendente');
    });
});

describe('refreshDocs', () => {
    test('separa a versão atual (is_current !== false) das antigas, e só do próprio colaborador', async () => {
        global.sb = createMockSupabase({
            documents: [
                { id: 'd1', employee_id: 'c1', is_current: true, created_at: '2026-02-01T00:00:00Z' },
                { id: 'd0', employee_id: 'c1', is_current: false, created_at: '2026-01-01T00:00:00Z' },
                { id: 'd2', employee_id: 'outro', is_current: true, created_at: '2026-02-01T00:00:00Z' },
            ],
        });
        await documentos.refreshDocs();
        const { myDocs, allMyDocs } = documentos.__getStateForTest();
        assert.deepEqual(
            myDocs.map((d) => d.id),
            ['d1']
        );
        assert.deepEqual(allMyDocs.map((d) => d.id).sort(), ['d0', 'd1']);
    });

    test('documento sem is_current definido conta como atual (default)', async () => {
        global.sb = createMockSupabase({ documents: [{ id: 'd1', employee_id: 'c1', created_at: '2026-01-01T00:00:00Z' }] });
        await documentos.refreshDocs();
        const { myDocs } = documentos.__getStateForTest();
        assert.equal(myDocs.length, 1);
    });
});

describe('loadRequirements', () => {
    test('usa o contrato do colaborador para filtrar os tipos obrigatórios de admissão', async () => {
        global.sb = createMockSupabase({
            document_requirements: [
                { tipo: 'RG', category: 'admissional', contract_type: 'CLT', obrigatorio: true },
                { tipo: 'Termo de Compromisso de Estágio', category: 'admissional', contract_type: 'Estágio', obrigatorio: true },
            ],
        });
        documentos.__setStateForTest({ emp: { name: 'X', contract_type: 'CLT' } });
        await documentos.loadRequirements();
        const { requiredTipos } = documentos.__getStateForTest();
        assert.deepEqual(requiredTipos, ['RG']);
    });
});

describe('logAudit', () => {
    test('grava ação, documento e autor (o colaborador) na trilha de auditoria', async () => {
        global.sb = createMockSupabase({ document_audit_log: [] });
        await documentos.logAudit('criado', { id: 'd1', name: 'RG.pdf' });
        const { data } = await global.sb.from('document_audit_log').select('*');
        assert.equal(data.length, 1);
        assert.equal(data[0].action, 'criado');
        assert.equal(data[0].employee_id, 'c1');
        assert.equal(data[0].actor_id, 'u1');
        assert.equal(data[0].actor_profile, 'colaborador');
        assert.equal(data[0].details.email, 'colab@nexus.test');
    });
});
