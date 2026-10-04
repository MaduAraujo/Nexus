const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

const CCT_VIGENTE = {
    id: 'cct1',
    nome: 'CCT Comerciários 2026',
    sindicato: 'Sindicato X',
    vigencia_inicio: '2026-01-01',
    vigencia_fim: '2026-12-31',
    piso_salarial: 3000,
};
const CCT_VENCIDA = { id: 'cct2', nome: 'CCT 2024', sindicato: null, vigencia_inicio: '2024-01-01', vigencia_fim: '2025-12-31', piso_salarial: 2000 };
const CCT_FUTURA = { id: 'cct3', nome: 'CCT 2027', sindicato: null, vigencia_inicio: '2027-01-01', vigencia_fim: '2027-12-31', piso_salarial: 5000 };

function client(anaOverrides = {}, convencoes = []) {
    const emps = [
        { ...ANA, cpf: '529.982.247-25', salary_type: 'Mensal Fixo', ...anaOverrides, created_at: '2024-02-01' },
        { ...BIA, created_at: '2022-05-10' },
        { ...CAIO, created_at: '2025-01-15' },
    ];
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
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
            convencoes_coletivas: convencoes.map((c) => ({ ...c })),
        }),
        rpc: { job_titles_public: [{ title: 'Analista' }] },
        views: { employees_decrypted: 'employees' },
    });
}

async function editar(c) {
    page = await openPage('colaboradores', { client: c, now: NOW });
    page.window.editEmployee(ANA.id);
    await page.settle();
}

async function salvar() {
    await page.submit('#employee-form');
    await page.settle(20);
}

async function marcarPensao(tipo, valor) {
    await page.check(page.$('input[name="pensao-alimenticia"][value="sim"]'));
    await page.check(page.$(`input[name="tipo-pensao"][value="${tipo}"]`));
    page.$('#pensao-valor').value = valor;
}

const toastCom = (re) => page.toasts().some((t) => re.test(t));

describe('colaboradores.html — valor da pensão alimentícia', () => {
    test('editar mostra o valor com vírgula e o rótulo do tipo; trocar o tipo troca o rótulo', async () => {
        await editar(client({ pensao_alimenticia: true, tipo_pensao: 'valor-fixo', pensao_valor: 1234.5 }));
        assert.equal(page.$('#pensao-valor').value, '1234,5');
        assert.equal(page.$('#pensao-valor-label').textContent, 'Valor mensal (R$)');
        await page.check(page.$('input[name="tipo-pensao"][value="salario-minimo"]'));
        assert.equal(page.$('#pensao-valor-label').textContent, 'Percentual do salário mínimo (%)');
    });

    test('salvar grava o valor convertido do formato brasileiro', async () => {
        const c = client();
        await editar(c);
        await marcarPensao('valor-fixo', 'R$ 1.234,56');
        await salvar();
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual([upd.pensao_alimenticia, upd.tipo_pensao, upd.pensao_valor], [true, 'valor-fixo', '1234.56']);
    });

    test('percentual sem vírgula também vale', async () => {
        const c = client();
        await editar(c);
        await marcarPensao('percentual', '25');
        await salvar();
        assert.equal(c.writes('employees', 'update')[0].payload.pensao_valor, '25');
    });

    test('sem valor, valor que não é número ou percentual acima de 100% não salva', async () => {
        const c = client();
        await editar(c);
        await marcarPensao('percentual', '');
        await salvar();
        assert.ok(toastCom(/Informe o valor da pensão alimentícia/));
        page.$('#pensao-valor').value = 'trinta';
        await salvar();
        page.$('#pensao-valor').value = '150';
        await salvar();
        assert.ok(toastCom(/não pode passar de 100%/));
        assert.equal(c.writes('employees', 'update').length, 0);
    });

    test('sem pensão, o valor não é gravado', async () => {
        const c = client({ pensao_alimenticia: false, pensao_valor: null });
        await editar(c);
        await salvar();
        assert.equal(c.writes('employees', 'update')[0].payload.pensao_valor, null);
    });
});

describe('colaboradores.html — convenção coletiva no cadastro', () => {
    test('a lista de convenções mostra piso e situação; editar marca a do colaborador e salvar grava a escolha', async () => {
        const c = client({ convencao_coletiva_id: 'cct1', salary: 4000 }, [CCT_VIGENTE, CCT_VENCIDA]);
        await editar(c);
        const opcoes = page.$$('#convencao-coletiva option').map((o) => o.textContent.replace(/ /g, ' '));
        assert.deepEqual(opcoes, ['Nenhuma', 'CCT Comerciários 2026 — piso R$ 3.000,00 (vigente)', 'CCT 2024 — piso R$ 2.000,00 (vencida)']);
        assert.equal(page.$('#convencao-coletiva').value, 'cct1');
        page.$('#convencao-coletiva').value = 'cct2';
        await salvar();
        assert.equal(c.writes('employees', 'update')[0].payload.convencao_coletiva_id, 'cct2');
    });

    test('convenção que não existe mais volta como "Nenhuma"; o erro do banco sobre o piso aparece para o RH', async () => {
        const c = client({ convencao_coletiva_id: 'apagada' }, [CCT_VIGENTE]);
        await editar(c);
        assert.equal(page.$('#convencao-coletiva').value, '');
        page.$('#convencao-coletiva').value = 'cct1';
        c.errors['employees:update'] = { code: '23514', message: 'Salário de R$ 2000,00 abaixo do piso de R$ 3000,00 da convenção "CCT Comerciários 2026".' };
        await salvar();
        assert.ok(toastCom(/abaixo do piso de R\$ 3000,00/));
    });
});

describe('colaboradores.html — catálogo de convenções coletivas', () => {
    async function abrir(c) {
        page = await openPage('colaboradores', { client: c, now: NOW });
        await page.click('#btn-open-convencoes');
        await page.settle();
    }

    const preencher = (campos) => Object.entries(campos).forEach(([id, v]) => (page.$(`#${id}`).value = v));

    test('sem convenções mostra o aviso; fechar limpa os campos', async () => {
        await abrir(client());
        assert.match(page.text('#convencoes-list'), /Nenhuma convenção cadastrada/);
        preencher({ 'cct-add-nome': 'X' });
        await page.click('[data-click="closeConvencoesModal"]');
        assert.equal(page.$('#cct-add-nome').value, '');
        assert.equal(page.$('#convencoes-modal').classList.contains('open'), false);
    });

    test('mostra situação, vinculados e quem está abaixo do piso (proporcional à jornada)', async () => {
        const c = client({ convencao_coletiva_id: 'cct1', salary: 2000, work_load: '30h', contract_type: 'clt' }, [CCT_VIGENTE, CCT_VENCIDA, CCT_FUTURA]);
        await abrir(c);
        const texto = page.text('#convencoes-list');
        assert.match(texto, /Sindicato X · 01\/01\/2026 a 31\/12\/2026 · piso R\$ 3\.000,00 · 1 vinculado/);
        assert.match(texto, /1 colaborador abaixo do piso: Ana Souza/);
        assert.match(texto, /vencida/);
        assert.match(texto, /ainda não começou/);
        assert.match(texto, /0 vinculados/);
    });

    test('quem ganha o piso proporcional, é estagiário ou está desligado não entra no alerta', async () => {
        const c = client({ convencao_coletiva_id: 'cct1', salary: 2045.46, work_load: '30h', contract_type: 'clt' }, [CCT_VIGENTE]);
        c.tables.employees.find((e) => e.id === BIA.id).convencao_coletiva_id = 'cct1';
        Object.assign(
            c.tables.employees.find((e) => e.id === BIA.id),
            { salary: 1000, contract_type: 'estagio' }
        );
        Object.assign(
            c.tables.employees.find((e) => e.id === CAIO.id),
            { convencao_coletiva_id: 'cct1', salary: 1000, status: 'Inativo' }
        );
        await abrir(c);
        assert.doesNotMatch(page.text('#convencoes-list'), /abaixo do piso/);
        assert.match(page.text('#convencoes-list'), /2 vinculados/);
    });

    test('adicionar valida os campos e a vigência de no máximo 2 anos', async () => {
        const c = client();
        await abrir(c);
        await page.click('[data-click="addConvencao"]');
        assert.ok(toastCom(/Informe o nome, a vigência e o piso/));
        preencher({ 'cct-add-nome': 'CCT Nova', 'cct-add-inicio': '2026-03-01', 'cct-add-fim': '2026-02-01', 'cct-add-piso': '2.500,00' });
        await page.click('[data-click="addConvencao"]');
        preencher({ 'cct-add-fim': '2028-03-02' });
        await page.click('[data-click="addConvencao"]');
        assert.ok(toastCom(/no máximo 2 anos/));
        assert.equal(c.writes('convencoes_coletivas', 'insert').length, 0);
    });

    test('adicionar grava, atualiza a lista e o campo do cadastro; nome repetido e erro do banco avisam', async () => {
        const c = client();
        await abrir(c);
        preencher({
            'cct-add-nome': 'CCT Nova',
            'cct-add-sindicato': '',
            'cct-add-inicio': '2026-03-01',
            'cct-add-fim': '2028-03-01',
            'cct-add-piso': '2.500,00',
        });
        await page.click('[data-click="addConvencao"]');
        assert.deepEqual(page.plain(c.writes('convencoes_coletivas', 'insert')[0].payload)[0], {
            nome: 'CCT Nova',
            sindicato: null,
            vigencia_inicio: '2026-03-01',
            vigencia_fim: '2028-03-01',
            piso_salarial: 2500,
        });
        assert.match(page.text('#convencoes-list'), /CCT Nova/);
        assert.equal(page.$('#cct-add-nome').value, '');
        assert.ok(page.$$('#convencao-coletiva option').some((o) => /CCT Nova/.test(o.textContent)));

        c.errors['convencoes_coletivas:insert'] = { code: '23505', message: 'dup' };
        preencher({ 'cct-add-nome': 'CCT Nova', 'cct-add-inicio': '2026-03-01', 'cct-add-fim': '2027-03-01', 'cct-add-piso': '2500' });
        await page.click('[data-click="addConvencao"]');
        assert.ok(toastCom(/Já existe uma convenção com esse nome/));
        c.errors['convencoes_coletivas:insert'] = { code: '500', message: 'x' };
        await page.click('[data-click="addConvencao"]');
        assert.ok(toastCom(/Não foi possível adicionar a convenção/));
    });

    test('excluir pede confirmação, avisa erro e desvincula os colaboradores', async () => {
        const c = client({ convencao_coletiva_id: 'cct1' }, [CCT_VIGENTE]);
        await abrir(c);
        page.window.confirm = () => false;
        await page.click('[data-click="deleteConvencao"]');
        assert.equal(c.writes('convencoes_coletivas', 'delete').length, 0);

        page.window.confirm = () => true;
        c.errors['convencoes_coletivas:delete'] = { message: 'x' };
        await page.click('[data-click="deleteConvencao"]');
        assert.ok(toastCom(/Não foi possível excluir a convenção/));
        delete c.errors['convencoes_coletivas:delete'];

        await page.click('[data-click="deleteConvencao"]');
        assert.match(page.text('#convencoes-list'), /Nenhuma convenção cadastrada/);
        page.window.editEmployee(ANA.id);
        await page.settle();
        assert.equal(page.$('#convencao-coletiva').value, '');
    });
});
