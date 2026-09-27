const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';

const ANA_COMPLETA = {
    ...ANA,
    cpf: '529.982.247-25',
    rg: '12.345.678-9',
    telefone: '(11) 90000-0001',
    contract_type: 'CLT',
    salary_type: 'Mensal Fixo',
    gender: 'Feminino',
    raca_cor: 'Parda',
    avatar_color: '#123456',
    seguro_vida: true,
    seguradora: 'Porto',
    possui_dependentes: true,
    qtd_dependentes: 2,
    pcd: false,
    is_probation: false,
    is_aviso_previo: false,
    pensao_alimenticia: false,
    vale_transporte: true,
    valor_passagem: 5.5,
    conducoes_dia: 2,
    vale_refeicao: 35.9,
    vale_alimentacao: 600,
    forma_pagamento: 'pix',
    tipo_chave_pix: 'email',
    chave_pix: 'ana@pix.com',
};

function client(anaOverrides = {}, extra = {}) {
    const ana = { ...ANA_COMPLETA, ...anaOverrides };
    const emps = [
        { ...ana, created_at: '2024-02-01' },
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
            job_titles: [{ id: 'jt1', title: 'Analista', level: 'Júnior', active: true }],
            trainings: [],
            data_access_log: [],
            onboarding_tasks: [],
            ...extra,
        }),
        rpc: { job_titles_public: [{ title: 'Analista' }, { title: 'Analista Pleno' }] },
        views: { employees_decrypted: 'employees' },
    });
}

async function editarESalvar(p, alterar = () => {}) {
    p.window.editEmployee(ANA.id);
    await p.settle();
    await alterar(p);
    await p.submit('#employee-form');
    await p.settle(20);
}

describe('colaboradores.html — editar sem perder dados', () => {
    test('abrir a edição preenche o formulário com o cadastro atual', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        assert.equal(page.$('#employee-id').value, ANA.id);
        assert.equal(page.$('#name').value, 'Ana Souza');
        assert.equal(page.$('#salary').value, 'R$ 4.000,00');
        assert.equal(page.$('input[name="seguro-vida"][value="sim"]').checked, true);
        assert.equal(page.$('#seguradora').value, 'Porto');
        assert.equal(page.$('input[name="forma-pagamento"][value="pix"]').checked, true);
        assert.equal(page.$('#chave-pix').value, 'ana@pix.com');
    });

    test('mudar só o cargo não altera benefícios, pagamento, cor do avatar nem nada além do cargo', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        const antes = { ...c.tables.employees.find((e) => e.id === ANA.id) };
        await editarESalvar(page, (p) => p.eval(`roleField.setValue('Analista Pleno')`));

        assert.ok(
            page.toasts().some((t) => /Colaborador Atualizado/.test(t)),
            page.toasts().join(' | ')
        );
        const upd = c.writes('employees', 'update')[0].payload;
        assert.equal(upd.role, 'Analista Pleno');
        const campos = [
            'salary',
            'seguro_vida',
            'seguradora',
            'possui_dependentes',
            'qtd_dependentes',
            'vale_transporte',
            'valor_passagem',
            'conducoes_dia',
            'vale_refeicao',
            'vale_alimentacao',
            'forma_pagamento',
            'tipo_chave_pix',
            'chave_pix',
            'avatar_color',
            'status',
        ];
        for (const k of campos) assert.deepEqual([k, upd[k]], [k, antes[k]]);

        const changes = c.writes('employee_audit', 'insert')[0].payload[0].changes;
        assert.deepEqual(
            changes.map((x) => [x.field, x.oldValue, x.newValue]),
            [['role', 'Analista', 'Analista Pleno']]
        );
    });

    test('ida e volta com todos os campos condicionais ligados: salvar sem mudar nada preserva tudo', async () => {
        const completo = {
            pcd: true,
            deficiencia: 'Visual',
            pensao_alimenticia: true,
            tipo_pensao: 'percentual',
            is_probation: true,
            probation_end_date: '2026-07-20',
            is_aviso_previo: false,
            forma_pagamento: 'conta',
            banco: 'Itaú',
            tipo_conta: 'corrente',
            agencia: '1234',
            conta: '56789-0',
            tipo_chave_pix: null,
            chave_pix: null,
            admission_date: '2026-04-21',
        };
        const c = client(completo);
        page = await openPage('colaboradores', { client: c, now: NOW });
        page.window.editEmployee(ANA.id);
        await page.settle();
        assert.equal(page.$('input[name="pcd"][value="sim"]').checked, true);
        assert.equal(page.$('#tipo-deficiencia').value, 'Visual');
        assert.equal(page.$('input[name="tipo-pensao"][value="percentual"]').checked, true);
        assert.equal(page.$('#banco').value, 'Itaú');
        assert.equal(page.$('#agencia').value, '1234');

        const antes = { ...c.tables.employees.find((e) => e.id === ANA.id) };
        await page.submit('#employee-form');
        await page.settle(20);
        const upd = c.writes('employees', 'update')[0]?.payload;
        assert.ok(upd, page.toasts().join(' | '));
        for (const k of [
            'pcd',
            'deficiencia',
            'pensao_alimenticia',
            'tipo_pensao',
            'is_probation',
            'probation_end_date',
            'forma_pagamento',
            'banco',
            'tipo_conta',
            'agencia',
            'conta',
            'qtd_dependentes',
            'seguradora',
        ])
            assert.deepEqual([k, upd[k]], [k, antes[k]]);
        assert.equal(upd.chave_pix, null, 'pagamento em conta não guarda chave PIX');
        assert.equal(c.writes('employee_audit', 'insert').length, 0, 'nada mudou: nada a auditar');
    });

    test('editar colaborador desligado mantém o status e a data de desligamento', async () => {
        const c = client({ status: 'Inativo', termination_date: '2026-05-31' });
        page = await openPage('colaboradores', { client: c, now: NOW });
        await editarESalvar(page, (p) => (p.$('#telefone').value = '(11) 98888-7777'));
        const upd = c.writes('employees', 'update')[0].payload;
        assert.equal(upd.status, 'Inativo');
        assert.equal(upd.termination_date, '2026-05-31');
    });

    test('conta bancária de banco fora da lista volta como "outro" e é salva igual', async () => {
        const c = client({ forma_pagamento: 'conta', banco: 'Banco da Esquina', tipo_conta: 'corrente', agencia: '1234', conta: '56789-0' });
        page = await openPage('colaboradores', { client: c, now: NOW });
        await editarESalvar(page, (p) => {
            assert.equal(p.$('#banco').value, 'outro');
            assert.equal(p.$('#banco-outro').value, 'Banco da Esquina');
        });
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual([upd.banco, upd.agencia, upd.conta], ['Banco da Esquina', '1234', '56789-0']);
    });

    test('redução salarial na edição pede confirmação; recusando, nada é gravado', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: false });
        await editarESalvar(page, (p) => (p.$('#salary').value = 'R$ 3.000,00'));
        assert.match(page.confirms.at(-1), /redução salarial/i);
        assert.equal(c.writes('employees', 'update').length, 0);
        assert.equal(page.$('#btn-save-simple')?.disabled ?? false, false, 'botão volta a ficar ativo');
    });

    test('erro do banco ao salvar a edição aparece para o RH e não altera a lista', async () => {
        const c = client();
        c.errors['employees:update'] = { message: 'permission denied for table employees' };
        page = await openPage('colaboradores', { client: c, now: NOW });
        await editarESalvar(page, (p) => (p.$('#name').value = 'Ana Souza Lima'));
        assert.ok(page.toasts().some((t) => /permission denied/.test(t)));
        assert.ok(page.$$('#employee-list-body tr').some((tr) => tr.textContent.includes('Ana Souza')));
        assert.equal(c.writes('employee_audit', 'insert').length, 0, 'sem auditoria de algo que não foi gravado');
    });
});

describe('colaboradores.html — regras legais no formulário', () => {
    const marcar = (p, name, value) => p.eval(`document.querySelector('input[name="${name}"][value="${value}"]').checked = true`);
    const data = (p, id, iso) => p.eval(`setDateFieldValue(document.getElementById('${id}'), '${iso}')`);

    test('experiência: exige data, posterior à admissão e no máximo 90 dias (CLT art. 445)', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        await editarESalvar(page, (p) => marcar(p, 'em-experiencia', 'sim'));
        assert.ok(page.toasts().some((t) => /Informe o fim do período de experiência/.test(t)));

        data(page, 'probation-end-date', '2024-01-15');
        await page.submit('#employee-form');
        assert.ok(page.toasts().some((t) => /posterior à data de admissão/.test(t)));

        data(page, 'probation-end-date', '2024-05-15');
        await page.submit('#employee-form');
        assert.ok(page.toasts().some((t) => /não pode ultrapassar 90 dias.*104 dias/.test(t)));
        assert.equal(c.writes('employees', 'update').length, 0);

        data(page, 'probation-end-date', '2024-04-30');
        await page.submit('#employee-form');
        await page.settle(20);
        const upd = c.writes('employees', 'update')[0].payload;
        assert.deepEqual([upd.is_probation, upd.probation_end_date], [true, '2024-04-30']);
    });

    test('aviso prévio: mínimo de 30 dias e máximo de 30 + 3 por ano completo (Lei 12.506/2011)', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW });
        await editarESalvar(page, (p) => {
            marcar(p, 'em-aviso-previo', 'sim');
            data(p, 'aviso-previo-end-date', '2026-07-01');
        });
        assert.ok(page.toasts().some((t) => /no mínimo 30 dias/.test(t)));

        data(page, 'aviso-previo-end-date', '2026-07-24');
        await page.submit('#employee-form');
        assert.ok(page.toasts().some((t) => /não pode ultrapassar 36 dias.*37 dias/.test(t)));
        assert.equal(c.writes('employees', 'update').length, 0);

        data(page, 'aviso-previo-end-date', '2026-07-23');
        await page.submit('#employee-form');
        await page.settle(20);
        assert.equal(c.writes('employees', 'update')[0].payload.aviso_previo_end_date, '2026-07-23');
    });
});

describe('colaboradores.html — etapas do cadastro, máscaras e CEP', () => {
    test('avançar e voltar entre as etapas; "Cancelar" só na primeira', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.toggleForm();
        await page.settle();
        assert.equal(page.text('#btn-prev-step'), 'Cancelar');
        await page.click('#btn-next-step');
        assert.equal(page.visible('#step-panel-2'), true);
        assert.equal(page.visible('#step-panel-1'), false);
        assert.ok(page.$('[data-step="1"]').classList.contains('completed'));
        assert.equal(page.text('#btn-prev-step'), 'Voltar');
        for (let i = 0; i < 10; i++) await page.click('#btn-next-step');
        assert.equal(page.visible('#step-panel-6'), true, 'para na última etapa');
        assert.equal(page.$('#btn-next-step').style.display, 'none');
        assert.equal(page.$('#btn-save').style.display, 'inline-flex');
        await page.click('#btn-prev-step');
        assert.equal(page.visible('#step-panel-5'), true);
        assert.ok(page.$('[data-step="5"]').classList.contains('active'));
        assert.equal(page.$('[data-step="6"]').classList.contains('completed'), false, 'a etapa de onde voltou não conta como concluída');
    });

    test('máscaras de CPF, RG, telefone, CEP, agência, conta e PIS', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        const casos = [
            ['#cpf', '52998224725', '529.982.247-25'],
            ['#telefone', '11987654321', '(11) 98765-4321'],
            ['#cep', '01310100', '01310-100'],
            ['#valor-passagem', '550', 'R$ 5,50'],
            ['#salary', '123456', 'R$ 1.234,56'],
        ];
        for (const [sel, digitado, esperado] of casos) {
            await page.fill(sel, digitado);
            assert.equal(page.$(sel).value, esperado, sel);
        }
        for (const sel of ['#rg', '#agencia', '#conta', '#pis-pasep']) {
            if (!page.$(sel)) continue;
            await page.fill(sel, 'ab12345678901234');
            assert.doesNotMatch(page.$(sel).value, /[a-z]/, `${sel} só aceita dígitos`);
        }
    });

    test('CEP preenche o endereço pelo ViaCEP; CEP inexistente ou falha de rede avisa', async () => {
        let resposta = { logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' };
        page = await openPage('colaboradores', {
            client: client(),
            now: NOW,
            fetch: async (url) => {
                if (resposta === 'rede') throw new TypeError('Failed to fetch');
                assert.match(url, /viacep\.com\.br\/ws\/01310100\/json/);
                return new Response(JSON.stringify(resposta));
            },
        });
        await page.window.pesquisacep('01310-100');
        assert.deepEqual(
            ['#logradouro', '#bairro', '#cidade', '#uf'].map((s) => page.$(s).value),
            ['Avenida Paulista', 'Bela Vista', 'São Paulo', 'SP']
        );
        await page.window.pesquisacep('123');
        assert.equal(page.fetches.length, 1, 'CEP incompleto nem consulta');
        resposta = { erro: true };
        await page.window.pesquisacep('01310100');
        resposta = 'rede';
        await page.window.pesquisacep('01310100');
        assert.equal(page.toasts().filter((t) => /CEP não encontrado/.test(t)).length, 2);
    });
});

describe('colaboradores.html — documentos de admissão anexados no cadastro', () => {
    const pathDe = (init) => decodeURIComponent(new Headers(init.headers).get('x-nexus-path') || '');

    async function anexar(p, tipo, nome) {
        p.window.selectRegDocType(tipo);
        await p.setFiles('#reg-doc-input', [p.file(nome, '%PDF-1.4 conteudo', 'application/pdf')]);
    }

    test('upload que falha é avisado pelo nome (antes sumia em silêncio); o que deu certo tem guarda legal', async () => {
        const c = client();
        page = await openPage('colaboradores', {
            client: c,
            now: NOW,
            fetch: async (url, init) => {
                if (/nexus-files/.test(url) && /Exame/.test(pathDe(init))) return new Response('{"error":"falhou"}', { status: 500 });
                return new Response('{}', { status: 200 });
            },
        });
        await editarESalvar(page, async (p) => {
            await anexar(p, 'Contrato de Trabalho', 'Contrato Ana José.pdf');
            await anexar(p, 'Exame Admissional', 'Exame Admissional.pdf');
            assert.match(p.text('#reg-doc-list'), /Contrato Ana José\.pdf.*Exame Admissional\.pdf/);
            p.$('#reg-doc-lgpd-consent').checked = true;
        });
        const docs = c.writes('documents', 'insert').map((w) => w.payload[0]);
        assert.equal(docs.length, 1);
        assert.deepEqual(
            [docs[0].tipo, docs[0].category, docs[0].employee_id, docs[0].lgpd_consentimento],
            ['Contrato de Trabalho', 'admissional', ANA.id, true]
        );
        assert.match(docs[0].storage_path, /^rh\/\d+_0_Contrato_Ana_Jose\.pdf$/, 'nome limpo, sem espaço nem acento');
        assert.match(docs[0].retido_ate, /^20\d\d-06-17$/);
        assert.ok(page.toasts().some((t) => /1 documento anexado/.test(t)));
        assert.ok(page.toasts().some((t) => /1 documento não foi anexado: Exame Admissional\.pdf/.test(t)));
    });

    test('se o registro do documento falha, o arquivo enviado é apagado do storage (nada de órfão)', async () => {
        const c = client();
        c.errors['documents:insert'] = { message: 'violates row-level security' };
        page = await openPage('colaboradores', { client: c, now: NOW, fetch: async () => new Response('{}', { status: 200 }) });
        await editarESalvar(page, (p) => anexar(p, 'Outros', 'rg.pdf'));
        const removidos = c.calls.filter((x) => x.storage === 'documents' && x.op === 'remove');
        assert.equal(removidos.length, 1);
        assert.match(JSON.stringify(removidos[0].path), /rh\/\d+_0_rg\.pdf/);
        assert.ok(page.toasts().some((t) => /não foi anexado: rg\.pdf/.test(t)));
    });

    test('remover um anexo antes de salvar tira da lista', async () => {
        page = await openPage('colaboradores', { client: client(), now: NOW });
        page.window.toggleForm();
        await page.settle();
        await anexar(page, 'Outros', 'a.pdf');
        await anexar(page, 'Outros', 'b.pdf');
        page.window.removeRegDoc(0);
        assert.doesNotMatch(page.text('#reg-doc-list'), /a\.pdf/);
        assert.match(page.text('#reg-doc-list'), /b\.pdf/);
        assert.equal(page.visible('#reg-doc-consent-wrap'), true);
    });
});
