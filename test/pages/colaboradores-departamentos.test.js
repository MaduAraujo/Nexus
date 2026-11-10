const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

function client({ departments, anaOverrides = {} } = {}) {
    const emps = [
        { ...ANA, cpf: '529.982.247-25', salary_type: 'Mensal Fixo', created_at: '2024-02-01', ...anaOverrides },
        { ...BIA, created_at: '2022-05-10' },
        { ...CAIO, created_at: '2025-01-15', status: 'Inativo' },
    ];
    const tables = baseTables({
        employees: emps.map((e) => ({ ...e })),
        employee_audit: [],
        employee_audit_decrypted: [],
        vacations: [],
        documents: [],
        document_requirements: [],
        job_titles: [],
        trainings: [],
        data_access_log: [],
        onboarding_tasks: [],
        convencoes_coletivas: [],
    });
    if (departments) tables.departments = departments;
    return new FakeSupabase({
        user: RH_USER,
        tables,
        rpc: { job_titles_public: [{ title: 'Analista' }] },
        views: { employees_decrypted: 'employees' },
        defaults: { departments: { ativo: true } },
    });
}

const toastCom = (re) => page.toasts().some((t) => re.test(t));

async function abrir(c, opts = {}) {
    page = await openPage('colaboradores', { client: c, now: NOW, ...opts });
    await page.click('#btn-open-departamentos');
    await page.settle();
}

describe('colaboradores.html — cadastro de departamentos (RF6.1)', () => {
    test('a lista mostra descrição, responsável, colaboradores ativos e situação', async () => {
        const c = client();
        c.tables.departments.find((d) => d.nome === 'Financeiro').responsavel_id = BIA.id;
        c.tables.departments.find((d) => d.nome === 'Jurídico').ativo = false;
        await abrir(c);
        const linha = (nome) => page.$$('#departamentos-list .onb-chip').find((el) => el.querySelector('.onb-chip-title').textContent.startsWith(nome));
        assert.match(linha('Financeiro').textContent, /Responsável: Bia.*2 colaboradores/s);
        assert.match(linha('TI').textContent, /Tecnologia da Informação.*Sem responsável.*0 colaboradores/s);
        assert.match(linha('Jurídico').textContent, /Inativo/);
        assert.ok(linha('Jurídico').querySelector('.fa-toggle-off'));
        assert.equal(
            page
                .$$('#dep-responsavel option')
                .map((o) => o.textContent)
                .join('|'),
            'Sem responsável|Ana Souza|Bia Lima'
        );
    });

    test('sem departamentos mostra o aviso', async () => {
        await abrir(client({ departments: [] }));
        assert.match(page.text('#departamentos-list'), /Nenhum departamento cadastrado/);
    });

    test('adicionar valida o nome e grava; repetido e erro do banco avisam', async () => {
        const c = client();
        await abrir(c);
        await page.click('#dep-salvar');
        assert.ok(toastCom(/Informe o nome do departamento/));
        page.$('#dep-nome').value = 'todos';
        await page.click('#dep-salvar');
        assert.ok(toastCom(/"Todos" é reservado/));
        page.$('#dep-nome').value = 'x'.repeat(61);
        await page.click('#dep-salvar');
        assert.equal(c.writes('departments', 'insert').length, 0);

        page.$('#dep-nome').value = '  Vendas   Externas ';
        page.$('#dep-descricao').value = 'Time de campo';
        page.$('#dep-responsavel').value = BIA.id;
        await page.click('#dep-salvar');
        assert.deepEqual(page.plain(c.writes('departments', 'insert')[0].payload)[0], {
            nome: 'Vendas Externas',
            descricao: 'Time de campo',
            responsavel_id: BIA.id,
        });
        assert.ok(toastCom(/Departamento Adicionado/));
        assert.match(page.text('#departamentos-list'), /Vendas Externas/);
        assert.ok(page.$$('#dept option').some((o) => o.value === 'Vendas Externas'));
        assert.equal(page.$('#dep-nome').value, '');

        c.errors['departments:insert'] = { code: '23505', message: 'dup' };
        page.$('#dep-nome').value = 'TI';
        await page.click('#dep-salvar');
        assert.ok(toastCom(/Já existe um departamento com esse nome/));
        c.errors['departments:insert'] = { code: 'XX', message: 'x' };
        await page.click('#dep-salvar');
        assert.ok(toastCom(/Não foi possível salvar o departamento/));
    });

    test('editar preenche o formulário, salva por id e cancelar volta ao modo de adicionar', async () => {
        const c = client();
        c.tables.departments.find((d) => d.nome === 'TI').responsavel_id = ANA.id;
        await abrir(c);
        await page.click('#departamentos-list [aria-label="Editar TI"]');
        assert.equal(page.$('#dep-nome').value, 'TI');
        assert.equal(page.$('#dep-descricao').value, 'Tecnologia da Informação');
        assert.equal(page.$('#dep-responsavel').value, ANA.id);
        assert.equal(page.$('#dep-cancelar').classList.contains('hidden'), false);
        assert.match(page.text('#dep-salvar'), /Salvar/);

        page.$('#dep-nome').value = 'Tecnologia';
        page.$('#dep-descricao').value = '';
        await page.click('#dep-salvar');
        const upd = c.writes('departments', 'update')[0];
        assert.deepEqual(page.plain(upd.payload), { nome: 'Tecnologia', descricao: null, responsavel_id: ANA.id });
        assert.ok(toastCom(/Departamento Atualizado/));
        assert.match(page.text('#dep-salvar'), /Adicionar/);

        await page.click('#departamentos-list [aria-label="Editar Marketing"]');
        await page.click('#dep-cancelar');
        assert.equal(page.$('#dep-nome').value, '');
        assert.equal(page.$('#dep-cancelar').classList.contains('hidden'), true);

        await page.click('#departamentos-list [aria-label="Editar RH"]');
        await page.click('[data-click="closeDepartamentosModal"]');
        assert.ok(!page.$('#departamentos-modal').classList.contains('open'));
        assert.equal(page.$('#dep-nome').value, '');
    });

    test('inativar com colaboradores pede confirmação; reativar não; erro avisa', async () => {
        let aceitar = false;
        const c = client();
        await abrir(c, { confirm: () => aceitar });
        await page.click('#departamentos-list [aria-label="Inativar Financeiro"]');
        assert.match(page.confirms.at(-1), /2 colaboradores continuam em Financeiro/);
        assert.equal(c.writes('departments', 'update').length, 0);

        aceitar = true;
        await page.click('#departamentos-list [aria-label="Inativar Financeiro"]');
        assert.deepEqual(page.plain(c.writes('departments', 'update')[0].payload), { ativo: false });
        assert.ok(toastCom(/Departamento Inativado/));

        const confirmacoes = page.confirms.length;
        await page.click('#departamentos-list [aria-label="Inativar Marketing"]');
        assert.equal(page.confirms.length, confirmacoes, 'sem colaboradores não pergunta');
        await page.click('#departamentos-list [aria-label="Reativar Marketing"]');
        assert.ok(toastCom(/Departamento Reativado/));

        c.errors['departments:update'] = { message: 'x' };
        await page.click('#departamentos-list [aria-label="Inativar TI"]');
        assert.ok(toastCom(/Não foi possível atualizar o departamento/));
    });

    test('excluir: em uso (inclusive por desligado) orienta a inativar; vazio pede confirmação; erros avisam', async () => {
        let aceitar = false;
        const c = client();
        await abrir(c, { confirm: () => aceitar });
        await page.click('#departamentos-list [aria-label="Excluir TI"]');
        assert.ok(toastCom(/Inative-o em vez de excluir/));
        assert.equal(c.writes('departments', 'delete').length, 0);

        await page.click('#departamentos-list [aria-label="Excluir Marketing"]');
        assert.equal(c.writes('departments', 'delete').length, 0, 'cancelou a confirmação');

        aceitar = true;
        c.errors['departments:delete'] = { code: '23503', message: 'fk' };
        await page.click('#departamentos-list [aria-label="Excluir Marketing"]');
        assert.ok(toastCom(/Há colaboradores neste departamento/));
        c.errors['departments:delete'] = { code: 'XX', message: 'x' };
        await page.click('#departamentos-list [aria-label="Excluir Marketing"]');
        assert.ok(toastCom(/Não foi possível excluir o departamento/));
        delete c.errors['departments:delete'];
        await page.click('#departamentos-list [aria-label="Excluir Marketing"]');
        assert.ok(toastCom(/Departamento Excluído/));
        assert.ok(!page.$$('#dept option').some((o) => o.value === 'Marketing'));
    });

    test('cadastro do colaborador: só departamentos ativos, mais o atual mesmo se inativo', async () => {
        const c = client({ anaOverrides: { dept: 'Jurídico' } });
        c.tables.departments.find((d) => d.nome === 'Jurídico').ativo = false;
        page = await openPage('colaboradores', { client: c, now: NOW });
        assert.ok(!page.$$('#dept option').some((o) => o.value === 'Jurídico'));
        assert.equal(page.$$('#vinculo-dept option').length, page.$$('#dept option').length);
        assert.ok(page.$$('#dept option').some((o) => o.textContent === 'TI — Tecnologia da Informação'));
        page.window.editEmployee(ANA.id);
        await page.settle();
        assert.equal(page.$('#dept').value, 'Jurídico');
        assert.match(page.$('#dept').selectedOptions[0].textContent, /Jurídico \(inativo\)/);
    });

    test('importação: departamento fora do cadastro ou inativo é apontado; maiúsculas não importam', async () => {
        const c = client();
        c.tables.departments.find((d) => d.nome === 'Jurídico').ativo = false;
        const CABECALHO = ['Nome', 'CPF', 'Email', 'Data de Admissão', 'Tipo de Contrato', 'Departamento', 'Jornada', 'Salário', 'Tipo de Salário', 'Cargo'];
        const xlsxRows = [
            CABECALHO,
            ['Sem Cadastro', '153.509.460-56', 'sc@empresa.com', '01/06/2026', 'CLT', 'Logística', '40h', '3000', 'Mensal', ''],
            ['Inativo', '111.444.777-35', 'in@empresa.com', '01/06/2026', 'CLT', 'jurídico', '40h', '3000', 'Mensal', ''],
            ['Minúsculo', '000.000.001-91', 'mi@empresa.com', '01/06/2026', 'CLT', 'ti', '40h', '3000', 'Mensal', ''],
        ];
        page = await openPage('colaboradores', { client: c, now: NOW, xlsxRows, fetch: async () => new Response('{"id":"auth-x"}', { status: 200 }) });
        page.window.openImportModal();
        await page.setFiles('#import-file-input', [page.file('equipe.xlsx', 'xlsx', 'application/vnd.ms-excel')]);
        await page.settle(20);
        const preview = page.text('#import-preview-body');
        assert.match(preview, /Departamento "Logística" não está cadastrado/);
        assert.match(preview, /Departamento "Jurídico" está inativo/);
        const minusculo = page.$$('#import-preview-body tr.import-row').find((tr) => /Minúsculo/.test(tr.textContent));
        assert.match(minusculo.textContent, /TI/);
        assert.doesNotMatch(minusculo.textContent, /não está cadastrado/);
    });
});
