const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-07-20T10:00:00-03:00';
const MES = '2026-07';

function rhClient(extra = {}, opts = {}) {
    const tables = baseTables({
        payslips: [],
        payslips_decrypted: [],
        time_records: [],
        holidays: [],
        adjustment_requests: [],
        bank_adjustments: [],
        documents: [],
        employee_audit: [],
        vacations: [],
        data_access_log: [],
        ...extra,
    });
    tables.employees_decrypted.forEach((e) => (e.status = e.status || 'Ativo'));
    return new FakeSupabase({ user: RH_USER, tables, ...opts });
}

function espelharPayslips(client) {
    const orig = client.from.bind(client);
    client.from = (t) => {
        if (t === 'payslips_decrypted') client.tables.payslips_decrypted = client.tables.payslips;
        return orig(t);
    };
    return client;
}

const ponto = (employee_id, date, entrada, saida, { almoco = true } = {}) => ({
    employee_id,
    date,
    entrada: `${date}T${entrada}:00-03:00`,
    saida_almoco: almoco ? `${date}T12:00:00-03:00` : null,
    retorno_almoco: almoco ? `${date}T13:00:00-03:00` : null,
    saida: `${date}T${saida}:00-03:00`,
});

const rowFor = (p, name) => p.$$('#folha-tbody tr').find((tr) => tr.textContent.includes(name));
const toastCom = (p, re) => p.toasts().some((t) => re.test(t));

async function fecharFolhaDe(p, nome) {
    await p.check(rowFor(p, nome).querySelector('.cb-row'));
    await p.click('[data-click="marcarSelecionadosPagos"]');
}

const holeritePago = (employee_id, extra = {}) => ({
    id: `ps-${employee_id}`,
    employee_id,
    mes: MES,
    competencia: '07/2026',
    status: 'pago',
    proventos: [{ cod: '001', descricao: 'Salário Base', referencia: '30 dias', valor: 4000 }],
    descontos: [{ cod: '901', descricao: 'INSS', referencia: '9%', valor: 360 }],
    total_proventos: 4000,
    total_descontos: 360,
    salario_liquido: 3640,
    ...extra,
});

describe('pagamentos.html — rubricas do holerite', () => {
    test('domingo e feriado trabalhados pagam 100% (021); intervalo não cumprido indeniza 50% (022); vale-alimentação (011)', async () => {
        const c = rhClient(
            {
                time_records: [
                    ponto(ANA.id, '2026-07-05', '08:00', '17:00'),
                    ponto(ANA.id, '2026-07-09', '08:00', '17:00'),
                    ponto(ANA.id, '2026-07-06', '08:00', '17:00', { almoco: false }),
                ],
                holidays: [{ date: '2026-07-09', name: 'Revolução Constitucionalista' }],
            },
            {}
        );
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).vale_alimentacao = 600;
        page = await openPage('pagamentos', { client: espelharPayslips(c), now: NOW });
        await fecharFolhaDe(page, 'Ana Souza');
        const slip = c.writes('payslips', 'upsert')[0].payload[0];
        const rubrica = (cod) => slip.proventos.find((p) => p.cod === cod);
        assert.deepEqual([rubrica('021').valor, rubrica('021').referencia], [320, '16.0h'], '16h a R$ 20/h com 100%');
        assert.deepEqual([rubrica('022').valor, rubrica('022').referencia], [30, '1.0h'], '1h de intervalo a R$ 20/h com 50%');
        assert.deepEqual([rubrica('011').valor, rubrica('011').referencia], [600, 'Mensal']);
    });

    test('fechar quando todos os selecionados já estão pagos avisa; erro do banco ao fechar avisa', async () => {
        const c = espelharPayslips(rhClient({ payslips: [holeritePago(ANA.id)] }));
        page = await openPage('pagamentos', { client: c, now: NOW });
        page.eval(`selectedIds.add('${ANA.id}')`);
        await page.click('[data-click="marcarSelecionadosPagos"]');
        assert.ok(toastCom(page, /Todos os selecionados já estão pagos/));

        c.errors['payslips:upsert'] = { message: 'RLS negou' };
        await fecharFolhaDe(page, 'Bia Lima');
        assert.ok(toastCom(page, /Erro: RLS negou/));
    });

    test('holerite com férias sem INSS é barrado ao fechar e não grava', async () => {
        const c = espelharPayslips(rhClient());
        page = await openPage('pagamentos', { client: c, now: NOW });
        const original = page.window.calcImpostosMes;
        page.eval(`calcImpostosMes = () => ({ inss: 0, inssFerias: 0, irrf: 0, irrfFerias: 0, descontos: [] })`);
        page.eval(`proventosFeriasLegado = () => [{ cod: '040', descricao: 'Férias', referencia: '10 dias', valor: 1000 }]`);
        await fecharFolhaDe(page, 'Ana Souza');
        assert.ok(toastCom(page, /Ana Souza: holerite com férias sem desconto de INSS — não foi fechado/));
        assert.equal(c.writes('payslips', 'upsert').length, 0);
        assert.ok(original);
    });

    test('falha ao calcular a prévia de um colaborador não derruba a folha', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', {
            client: c,
            now: NOW,
            before: (w) => {
                const orig = c.from.bind(c);
                c.from = (t) => {
                    if (t === 'holidays') throw new Error('rede caiu');
                    return orig(t);
                };
            },
        });
        assert.equal(page.$$('#folha-tbody tr').length, 3);
    });
});

describe('pagamentos.html — holerite aberto: banco de horas, impressão e recibos', () => {
    test('saldo do banco de horas da competência aparece no holerite (positivo e negativo); PJ não mostra', async () => {
        const c = rhClient({
            payslips_decrypted: [holeritePago(ANA.id), holeritePago(BIA.id), holeritePago(CAIO.id)],
            time_records: [ponto(ANA.id, '2026-07-01', '08:00', '19:00'), ponto(BIA.id, '2026-07-01', '08:00', '15:00')],
            bank_adjustments: [{ employee_id: ANA.id, tipo: 'debito', minutos: 30, date: '2026-07-02', deleted_at: null }],
        });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.window.verHolerite(ANA.id);
        await page.waitFor(() => /banco de horas/.test(page.text('#slip-bank-info')));
        assert.match(page.text('#slip-bank-info'), /competência 07\/2026 .*: \+1h 30min/);
        assert.ok(page.$('#slip-bank-info').classList.contains('positivo'));

        await page.window.verHolerite(BIA.id);
        await page.waitFor(() => /-2h 00min/.test(page.text('#slip-bank-info')));
        assert.ok(page.$('#slip-bank-info').classList.contains('negativo'));

        await page.window.verHolerite(CAIO.id);
        await page.settle();
        assert.ok(page.$('#slip-bank-info').classList.contains('hidden'));
    });

    test('imprimir o holerite abre a versão de impressão; pop-up bloqueado avisa', async () => {
        const c = rhClient({ payslips_decrypted: [holeritePago(ANA.id, { proventos: [], descontos: [] })] });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="printCurrentSlip"]');
        assert.equal(page.opened.length, 0, 'sem holerite aberto não imprime');
        await page.window.verHolerite(ANA.id);
        await page.click('[data-click="printCurrentSlip"]');
        const impresso = page.opened.at(-1).text();
        assert.match(impresso, /Competência 07\/2026 NomeAna Souza CargoAnalista DepartamentoFinanceiro Contratoclt Admissão01\/02\/2024 ✓ PAGAMENTO EFETUADO/);
        assert.match(impresso, /Nenhum provento.*Nenhum desconto/);

        page.window.open = () => null;
        await page.click('[data-click="printCurrentSlip"]');
        assert.ok(toastCom(page, /Permita pop-ups para imprimir o holerite/));
    });

    test('imprimir holerite com rubricas lista proventos e descontos', async () => {
        const c = rhClient({ payslips_decrypted: [holeritePago(BIA.id, { status: 'publicado' })] });
        page = await openPage('pagamentos', { client: c, now: NOW });
        page.eval(`currentSlipData = { emp: employees.find((e) => e.id === '${BIA.id}'), slip: payslips[0] }`);
        await page.click('[data-click="printCurrentSlip"]');
        const impresso = page.opened.at(-1).text();
        assert.match(impresso, /001Salário Base30 diasR\$\s*4\.000,00/);
        assert.match(impresso, /901INSS9%R\$\s*360,00/);
        assert.doesNotMatch(impresso, /PAGAMENTO EFETUADO/);
    });

    test('emitir e pagar recibo de férias: erro do banco avisa; ver recibo esconde o banco de horas', async () => {
        const c = espelharPayslips(
            rhClient(
                {
                    vacations: [
                        { id: 'v1', employee_id: ANA.id, start_date: '2026-07-13', end_date: '2026-07-22', days: 10, abono: false, status: 'aprovado' },
                    ],
                },
                { errors: { 'rpc:apply_ferias_recibo': { message: 'competência fechada' } } }
            )
        );
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('#recibos-ferias-list [data-click="emitirReciboFerias"]');
        assert.ok(toastCom(page, /Erro: competência fechada/));
        await page.window.emitirReciboFerias('ninguem', '2026-07-13');

        c.tables.payslips.push({
            id: 'rf1',
            employee_id: ANA.id,
            mes: '2026-07-F13',
            mes_formatado: 'Recibo de Férias',
            competencia: '07/2026',
            status: 'publicado',
            proventos: [],
            descontos: [],
        });
        c.emit('payslips', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => page.$('#recibos-ferias-list [data-click="pagarReciboFerias"]'));
        c.errors['payslips:update'] = { message: 'bloqueado' };
        await page.click('#recibos-ferias-list [data-click="pagarReciboFerias"]');
        assert.ok(toastCom(page, /Erro: bloqueado/));
        await page.window.pagarReciboFerias('nao-existe');

        await page.click('#recibos-ferias-list [data-click="verReciboFerias"]');
        assert.ok(page.$('#slip-bank-info').classList.contains('hidden'));
        page.window.verReciboFerias('nao-existe');
    });
});

describe('pagamentos.html — abas, busca, filtros e seleção', () => {
    test('aba de holerites: busca, limpar e filtro de departamento', async () => {
        const c = rhClient({ payslips_decrypted: [holeritePago(ANA.id), holeritePago(CAIO.id)] });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="switchTab"][data-click-args*="holerites"]');
        assert.ok(page.$('#tab-holerites').classList.contains('active'));
        assert.ok(!page.$('#tab-folha').classList.contains('active'));
        assert.equal(page.$$('#hol-tbody tr').length, 2);

        await page.fill('#search-hol', 'caio');
        assert.equal(page.$$('#hol-tbody tr').length, 1);
        assert.ok(!page.$('#search-hol-clear').classList.contains('hidden'));
        await page.click('[data-click="clearHolSearch"]');
        assert.equal(page.$('#search-hol').value, '');
        assert.equal(page.$$('#hol-tbody tr').length, 2);

        await page.click('#btn-dept-hol-filter');
        assert.ok(page.$('#dept-hol-filter-menu').classList.contains('open'));
        await page.click('#dept-hol-filter-chips .chip[data-dept="TI"]');
        assert.ok(!page.$('#dept-hol-filter-menu').classList.contains('open'));
        assert.ok(page.$('#btn-dept-hol-filter').classList.contains('filtered'));
        assert.equal(page.$$('#hol-tbody tr').length, 1);
        await page.fill('#search-hol', 'ana');
        assert.match(page.text('#hol-tbody'), /Nenhum holerite pago nesta competência/);
    });

    test('folha: filtro de departamento abre e fecha, filtra e limpa a busca', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await page.click('#btn-dept-filter');
        assert.ok(page.$('#dept-filter-menu').classList.contains('open'));
        await page.click('#btn-dept-filter');
        assert.ok(!page.$('#dept-filter-menu').classList.contains('open'));
        await page.click('#btn-dept-filter');
        await page.click('#folha-tbody');
        assert.ok(!page.$('#dept-filter-menu').classList.contains('open'));
        await page.click('#btn-dept-filter');
        await page.click('#dept-filter-chips .chip[data-dept="Financeiro"]');
        assert.equal(page.$$('#folha-tbody tr').length, 2);
        await page.click('#dept-filter-chips .chip[data-dept=""]');
        assert.ok(!page.$('#btn-dept-filter').classList.contains('filtered'));

        await page.fill('#search-input', 'bia');
        await page.click('[data-click="clearSearch"]');
        assert.equal(page.$('#search-input').value, '');
        assert.equal(page.$$('#folha-tbody tr').length, 3);
    });

    test('seleção: desmarcar linha, marcar e desmarcar todos, limpar seleção', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await page.check(rowFor(page, 'Ana Souza').querySelector('.cb-row'));
        assert.ok(page.$('#select-all-cb').indeterminate);
        await page.check(rowFor(page, 'Ana Souza').querySelector('.cb-row'), false);
        assert.ok(!page.$('#bulk-bar').classList.contains('visible'));
        const todos = page.$('#select-all-cb');
        todos.checked = true;
        page.window.toggleSelectAll(todos);
        assert.equal(page.text('#bulk-count'), '3 colaboradores selecionados');
        assert.ok(page.$('#select-all-cb').checked);
        todos.checked = false;
        page.window.toggleSelectAll(todos);
        assert.ok(!page.$('#bulk-bar').classList.contains('visible'));
        page.window.toggleSelectAll(Object.assign(todos, { checked: true }));
        await page.click('[data-click="limparSelecao"]');
        assert.ok(!page.$('#bulk-bar').classList.contains('visible'));
    });

    test('seletor de mês: navega entre anos e troca a competência; Esc, clique fora e botão fecham', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        const aberto = () => page.$('#month-picker-dropdown').classList.contains('open');
        assert.equal(page.text('#month-picker-label'), 'Julho de 2026');
        await page.click('#month-picker-btn');
        for (let i = 0; i < 7; i++) await page.click('#mpd-prev-month');
        assert.equal(page.text('#mpd-title'), 'Dezembro 2025');
        for (let i = 0; i < 13; i++) await page.click('#mpd-next-month');
        assert.equal(page.text('#mpd-title'), 'Janeiro 2027');
        for (let i = 0; i < 6; i++) await page.click('#mpd-prev-month');
        await page.click('#mpd-grid .calendar-day:not(.calendar-day--muted)');
        assert.ok(!aberto());
        assert.equal(page.text('#month-picker-label'), 'Julho de 2026');
        await page.click('#month-picker-btn');
        await page.click('#mpd-prev-month');
        await page.click('#mpd-grid .calendar-day:not(.calendar-day--muted)');
        assert.equal(page.text('#month-picker-label'), 'Junho de 2026');

        await page.click('#month-picker-btn');
        await page.click('#month-picker-btn');
        assert.ok(!aberto());
        await page.click('#month-picker-btn');
        await page.click('#folha-tbody');
        assert.ok(!aberto());
        await page.click('#month-picker-btn');
        await page.key('#month-picker-btn', 'Escape');
        assert.ok(!aberto());
    });

    test('modais: o holerite não fecha clicando fora; Esc fecha todos', async () => {
        const c = rhClient({ payslips_decrypted: [holeritePago(ANA.id)] });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        await page.key('body', 'Escape');
        assert.ok(!page.$('#decimo-terceiro-modal').classList.contains('open'));
        assert.equal(page.window.handleOverlayClick({ target: page.$('#rescisao-modal') }, 'rescisao-modal'), undefined);
        await page.window.verHolerite(ANA.id);
        await page.click('#slip-modal');
        assert.ok(page.$('#slip-modal').classList.contains('open'), 'o holerite só fecha pelo botão');
        await page.key('body', 'Escape');
        assert.ok(!page.$('#slip-modal').classList.contains('open'));
        assert.equal(page.document.body.style.overflow, '');
    });

    test('tempo real: colaborador novo entra na folha', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', { client: c, now: NOW });
        c.tables.employees_decrypted.push({ ...BIA, id: 'emp-duda', name: 'Duda Reis', status: 'Ativo' });
        c.emit('employees', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => rowFor(page, 'Duda Reis'));
    });
});

describe('pagamentos.html — 13º salário: parcelas, elegibilidade e erros', () => {
    test('escolher a parcela pelos cartões; sem elegíveis; sem meses no ano; erro ao gerar reabilita o botão', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        await page.click('#dt-parcela-toggle .type-toggle-card[data-parcela="2"]');
        assert.equal(page.$('#dt-parcela').value, '2');
        assert.ok(page.$('#dt-parcela-toggle .type-toggle-card[data-parcela="2"]').classList.contains('active'));
        page.$('#dt-parcela-toggle').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.equal(page.$('#dt-parcela').value, '2', 'clique fora dos cartões não muda');

        page.$('#dt-ano').value = '2021';
        await page.click('[data-click="calcularDecimoTerceiroModal"]');
        assert.equal(page.text('#dt-error'), 'Nenhum colaborador tem meses suficientes de trabalho neste ano.');

        page.$('#dt-ano').value = '2026';
        await page.click('[data-click="calcularDecimoTerceiroModal"]');
        c.errors['payslips:upsert'] = { message: 'duplicado' };
        await page.click('#btn-gerar-decimo-terceiro');
        assert.ok(toastCom(page, /Erro ao gerar 13º: duplicado/));
        assert.equal(page.$('#btn-gerar-decimo-terceiro').disabled, false);
        assert.match(page.$('#btn-gerar-decimo-terceiro').innerHTML, /Gerar Holerites/);
        await page.window.gerarDecimoTerceiro();
    });

    test('ninguém elegível (PJ e estágio não entram)', async () => {
        const c = rhClient();
        c.tables.employees_decrypted.forEach((e) => (e.contract_type = 'pj'));
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        await page.click('[data-click="calcularDecimoTerceiroModal"]');
        assert.equal(
            page.text('#dt-error'),
            'Nenhum colaborador elegível ao 13º encontrado (PJ e Estágio não entram; o 13º do temporário é pago pela agência).'
        );
        await page.window.gerarDecimoTerceiro();
        assert.equal(c.writes('payslips', 'upsert').length, 0);
    });
});

describe('pagamentos.html — rescisão: validações, banco de horas, médias e falhas', () => {
    async function prepararRescisao(p, empId, data) {
        await p.click('[data-click="openRescisaoModal"]');
        await p.click('#rescisao-emp-trigger');
        await p.click(`#rescisao-emp-popover .select-option[data-value="${empId}"]`);
        p.window.setRescisaoDate(data);
        await p.settle();
    }

    test('validações: sem colaborador, sem admissão, sem data e sem salário', async () => {
        const c = rhClient();
        c.tables.employees_decrypted.push({ ...BIA, id: 'emp-sem-adm', name: 'Sem Admissão', admission_date: null, status: 'Ativo' });
        c.tables.employees_decrypted.push({ ...BIA, id: 'emp-sem-sal', name: 'Sem Salário', salary: 0, status: 'Ativo' });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await page.window.calcularRescisaoModal();
        assert.equal(page.text('#rescisao-error'), 'Selecione um colaborador.');
        page.window.setRescisaoEmp('emp-sem-adm');
        await page.window.calcularRescisaoModal();
        assert.equal(page.text('#rescisao-error'), 'Colaborador sem data de admissão cadastrada.');
        page.window.setRescisaoEmp(ANA.id);
        await page.window.calcularRescisaoModal();
        assert.equal(page.text('#rescisao-error'), 'Informe a data de desligamento.');
        page.window.setRescisaoEmp('emp-sem-sal');
        page.window.setRescisaoDate('2026-07-31');
        await page.window.calcularRescisaoModal();
        assert.equal(page.text('#rescisao-error'), 'Colaborador sem salário cadastrado.');
    });

    test('saldo positivo do banco de horas e média de adicionais dos últimos 12 meses entram nas verbas', async () => {
        const c = rhClient({
            time_records: [ponto(ANA.id, '2026-07-01', '08:00', '19:00')],
            payslips_decrypted: [
                {
                    employee_id: ANA.id,
                    mes: '2026-05',
                    proventos: [
                        { cod: '020', valor: 100 },
                        { cod: '001', valor: 4000 },
                    ],
                },
                { employee_id: ANA.id, mes: '2026-06', proventos: [{ cod: '021', valor: 200 }] },
            ],
        });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await page.click('#rescisao-tipo-toggle .type-toggle-card[data-tipo="pedido_demissao"]');
        assert.equal(page.$('#rescisao-tipo').value, 'pedido_demissao');
        page.$('#rescisao-tipo-toggle').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.equal(page.$('#rescisao-tipo').value, 'pedido_demissao');
        await page.click('#rescisao-emp-trigger');
        await page.click(`#rescisao-emp-popover .select-option[data-value="${ANA.id}"]`);
        page.window.setRescisaoDate('2026-07-31');
        await page.settle();
        await page.click('#btn-calcular-rescisao');
        const texto = page.text('#rescisao-result');
        assert.match(texto, /pagas como extras com 50% \(CLT art\. 59 §3º\) 2h 00min R\$\s*60,00/, '2h a R$ 20/h + 50%');
        assert.match(texto, /médias habituais/, 'média de R$ 150 (100 + 200 em 2 holerites) entra em férias/13º');
        assert.equal(page.$('#rescisao-emp-trigger').disabled, true, 'depois de calcular, os campos travam');
    });

    test('falha ao apurar o banco de horas não impede o cálculo', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', { client: c, now: NOW });
        const orig = c.from.bind(c);
        c.from = (t) => {
            if (t === 'payslips_decrypted') throw new Error('rede caiu');
            return orig(t);
        };
        await prepararRescisao(page, ANA.id, '2026-07-31');
        await page.click('#btn-calcular-rescisao');
        assert.equal(page.visible('#rescisao-result'), true);
        assert.equal(page.$('#btn-calcular-rescisao').disabled, false);
    });

    test('confirmar: sem biblioteca de PDF, erro ao inativar e erro ao anexar o termo', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', { client: c, now: NOW, fetch: async () => new Response('{"error":"x"}', { status: 500 }) });
        await prepararRescisao(page, ANA.id, '2026-07-31');
        await page.click('#btn-calcular-rescisao');

        const jspdf = page.window.jspdf;
        page.window.jspdf = undefined;
        await page.click('#btn-confirmar-desligamento');
        assert.ok(toastCom(page, /Biblioteca PDF não carregada/));
        assert.equal(page.$('#btn-confirmar-desligamento').disabled, false);
        page.window.jspdf = jspdf;

        c.errors['employees:update'] = { message: 'x' };
        await page.click('#btn-confirmar-desligamento');
        assert.ok(toastCom(page, /Não foi possível atualizar o status do colaborador/));
        delete c.errors['employees:update'];

        page.window.NexusFiles.upload = async () => ({ error: { message: 'storage fora' } });
        await page.click('#btn-confirmar-desligamento');
        await page.waitFor(() => toastCom(page, /Colaborador desligado, mas não foi possível anexar o documento de rescisão/));
        assert.equal(c.writes('documents', 'insert').length, 0);
    });

    test('seletores da rescisão: data navega entre anos e escolhe o dia; lista de colaboradores fecha com Esc e clique fora', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        const dataAberta = () => page.$('#rescisao-data-popover').classList.contains('open');
        const empAberta = () => page.$('#rescisao-emp-popover').classList.contains('open');

        await page.click('#rescisao-data-trigger');
        assert.ok(dataAberta());
        assert.equal(page.text('#rescisao-data-title'), 'Julho 2026');
        for (let i = 0; i < 7; i++) await page.click('#rescisao-data-prev');
        assert.equal(page.text('#rescisao-data-title'), 'Dezembro 2025');
        for (let i = 0; i < 13; i++) await page.click('#rescisao-data-next');
        assert.equal(page.text('#rescisao-data-title'), 'Janeiro 2027');
        await page.click('#rescisao-data-grid .calendar-day:not(.calendar-day--muted)');
        assert.ok(!dataAberta());
        assert.equal(page.$('#rescisao-data').value, '2027-01-01');
        assert.equal(page.text('#rescisao-data-label'), '01/01/2027');

        await page.click('#rescisao-data-trigger');
        assert.equal(page.text('#rescisao-data-title'), 'Janeiro 2027', 'reabre no mês escolhido');
        await page.click('#rescisao-emp-trigger');
        assert.ok(!dataAberta(), 'abrir a lista fecha o calendário');
        assert.ok(empAberta());
        await page.click('#rescisao-emp-trigger');
        assert.ok(!empAberta());
        await page.click('#rescisao-emp-trigger');
        await page.key('#rescisao-emp-trigger', 'Escape');
        assert.ok(!empAberta());
        await page.click('#rescisao-emp-trigger');
        await page.click('#rescisao-modal .modal-body, #rescisao-modal');
        assert.ok(!empAberta());
        await page.click('#rescisao-emp-trigger');
        page.$('#rescisao-emp-popover').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.ok(empAberta(), 'clique fora das opções não escolhe');

        await page.click('#rescisao-data-trigger');
        await page.click('#rescisao-data-trigger');
        assert.ok(!dataAberta());
        await page.click('#rescisao-data-trigger');
        await page.key('#rescisao-data-trigger', 'Escape');
        assert.ok(!dataAberta());
        await page.click('#rescisao-data-trigger');
        await page.click('#rescisao-modal');
        assert.ok(!dataAberta());

        page.window.setRescisaoEmpOptions([]);
        assert.match(page.text('#rescisao-emp-popover'), /Nenhum colaborador cadastrado/);
    });
});

describe('pagamentos.html — exportação: menu e falhas', () => {
    test('menu de exportar abre e fecha; sem bibliotecas avisa; sem colaboradores no CSV avisa; erro no cálculo avisa', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('#btn-export');
        assert.ok(page.$('#export-menu').classList.contains('open'));
        await page.click('#folha-tbody');
        assert.ok(!page.$('#export-menu').classList.contains('open'));

        const xlsx = page.window.XLSX;
        const jspdf = page.window.jspdf;
        page.window.XLSX = undefined;
        page.window.jspdf = undefined;
        await page.click('#export-excel');
        await page.click('#export-csv');
        await page.click('#export-pdf');
        assert.ok(toastCom(page, /Biblioteca Excel não carregada/));
        assert.ok(toastCom(page, /Biblioteca de exportação não carregada/));
        assert.ok(toastCom(page, /Biblioteca PDF não carregada/));
        page.window.XLSX = xlsx;
        page.window.jspdf = jspdf;

        page.eval(`buildPayslipData = async () => { throw new Error('falhou'); }`);
        await page.click('#export-csv');
        await page.waitFor(() => toastCom(page, /Erro ao gerar CSV/));

        page.eval(`employees = []`);
        await page.click('#export-csv');
        assert.ok(toastCom(page, /Nada para exportar neste mês/));
    });

    test('aviso some sozinho', async () => {
        page = await openPage('pagamentos', { client: rhClient(), now: NOW });
        const agendados = [];
        page.window.setTimeout = (fn, ms) => agendados.push([fn, ms]);
        page.eval(`showToast('Teste', 'info')`);
        const toast = page.$$('.toast').at(-1);
        agendados.find(([, ms]) => ms === 4000)[0]();
        assert.ok(toast.classList.contains('hide'));
        agendados.find(([, ms]) => ms === 400)[0]();
        assert.ok(!toast.isConnected);
    });
});

describe('pagamentos.html — carregamento, ordenação e ajustes', () => {
    test('o indicador de carregamento aparece enquanto a folha carrega e some no fim', async () => {
        const estados = [];
        page = await openPage('pagamentos', {
            client: rhClient(),
            now: NOW,
            before: (w) => {
                const loader = w.document.getElementById('page-loader');
                new w.MutationObserver(() => estados.push(loader.classList.contains('active'))).observe(loader, { attributes: true });
            },
        });
        await page.settle();
        assert.ok(estados.includes(true), 'mostrou o carregamento');
        assert.equal(page.$('#page-loader').classList.contains('active'), false, 'escondeu no fim');
        assert.equal(page.$('#page-loader').getAttribute('role'), 'status');
    });

    test('ajuste manual de crédito entra no saldo de banco de horas da rescisão', async () => {
        const c = rhClient({
            time_records: [ponto(ANA.id, '2026-07-01', '08:00', '18:00')],
            bank_adjustments: [
                { employee_id: ANA.id, tipo: 'credito', minutos: 90, date: '2026-07-02', deleted_at: null },
                { employee_id: ANA.id, tipo: 'debito', minutos: 30, date: '2026-07-03', deleted_at: null },
            ],
        });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openRescisaoModal"]');
        await page.click('#rescisao-emp-trigger');
        await page.click(`#rescisao-emp-popover .select-option[data-value="${ANA.id}"]`);
        page.window.setRescisaoDate('2026-07-31');
        await page.settle();
        await page.click('#btn-calcular-rescisao');
        assert.match(
            page.text('#rescisao-result'),
            /pagas como extras com 50% \(CLT art\. 59 §3º\) 2h 00min R\$\s*60,00/,
            '1h de ponto + 1h30 de crédito - 30min de débito, com 50%'
        );
    });

    test('recibos de férias pendentes aparecem na ordem do início do gozo', async () => {
        const c = rhClient({
            vacations: [
                { id: 'v2', employee_id: BIA.id, start_date: '2026-07-27', end_date: '2026-08-05', days: 10, abono: false, status: 'aprovado' },
                { id: 'v1', employee_id: ANA.id, start_date: '2026-07-13', end_date: '2026-07-22', days: 10, abono: false, status: 'aprovado' },
            ],
        });
        page = await openPage('pagamentos', { client: c, now: NOW });
        assert.deepEqual(
            page.$$('#recibos-ferias-list .recibo-nome').map((e) => e.textContent),
            ['Ana Souza', 'Bia Lima']
        );
    });

    test('CSV da contabilidade usa o holerite já existente do mês', async () => {
        const c = rhClient({ payslips_decrypted: [holeritePago(ANA.id, { status: 'publicado' })] });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('#export-csv');
        await page.waitFor(() => toastCom(page, /Exportação CSV concluída/));
        assert.ok(page.saved.includes('folha-pagamento-2026-07-contabilidade.csv'));
    });
});

describe('pagamentos.html — ramos de regra da folha', () => {
    test('1ª parcela do 13º sai com o código 030 e sem INSS/IRRF (os descontos ficam para a 2ª)', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.click('[data-click="openDecimoTerceiroModal"]');
        page.$('#dt-ano').value = '2026';
        page.$('#dt-parcela').value = '1';
        await page.click('[data-click="calcularDecimoTerceiroModal"]');
        await page.click('#btn-gerar-decimo-terceiro');
        const slips = c.writes('payslips', 'upsert')[0].payload;
        assert.ok(slips.length >= 1);
        for (const s of slips) {
            assert.equal(s.mes, '2026-13-1');
            assert.equal(s.proventos[0].cod, '030');
            assert.match(s.proventos[0].descricao, /1ª Parcela/);
            assert.deepEqual(s.descontos, []);
        }
        assert.ok(toastCom(page, /13º Salário \(1ª Parcela\) gerado/));
    });

    test('banco de horas do holerite: crédito manual soma e dia sem saída não entra na conta', async () => {
        const c = rhClient({
            payslips_decrypted: [holeritePago(ANA.id)],
            time_records: [
                ponto(ANA.id, '2026-07-01', '08:00', '17:00'),
                { employee_id: ANA.id, date: '2026-07-02', entrada: '2026-07-02T08:00:00-03:00', saida_almoco: null, retorno_almoco: null, saida: null },
            ],
            bank_adjustments: [{ employee_id: ANA.id, tipo: 'credito', minutos: 45, date: '2026-07-03', deleted_at: null }],
        });
        page = await openPage('pagamentos', { client: c, now: NOW });
        await page.window.verHolerite(ANA.id);
        await page.waitFor(() => /banco de horas/.test(page.text('#slip-bank-info')));
        assert.match(
            page.text('#slip-bank-info'),
            /: \+0h 45min/,
            'jornada de 8h (40h): o dia completo zera, o dia sem saída é ignorado e o crédito soma 45min'
        );
    });

    test('exportação da folha marca "Pago", "Gerado" (holerite ainda em aberto) e "Pendente" corretamente', async () => {
        const c = rhClient({
            payslips_decrypted: [holeritePago(ANA.id), holeritePago(BIA.id, { status: 'publicado' })],
        });
        page = await openPage('pagamentos', { client: c, now: NOW });
        let planilha = null;
        const original = page.window.XLSX.writeFile;
        page.window.XLSX.writeFile = (wb, nome) => {
            planilha = wb;
            original(wb, nome);
        };
        await page.click('#export-excel');
        await page.settle(20);
        const linhas = planilha.Sheets[planilha.SheetNames[0]].rows.slice(1);
        const status = Object.fromEntries(linhas.map((l) => [l[0], l[l.length - 1]]));
        assert.equal(status['Ana Souza'], 'Pago');
        assert.equal(status['Bia Lima'], 'Gerado');
        assert.equal(status['Caio Prado'], 'Pendente');
    });
});

describe('pagamentos.html — falha ao conferir as faltas', () => {
    test('fechar a folha com o ponto indisponível não grava holerite nenhum', async () => {
        const c = rhClient();
        page = await openPage('pagamentos', { client: c, now: NOW });
        c.errors['time_records:select'] = { message: 'rede caiu' };
        await fecharFolhaDe(page, 'Ana Souza');
        await page.settle(20);
        assert.equal(c.writes('payslips', 'upsert').length + c.writes('payslips', 'insert').length, 0);
        assert.ok(toastCom(page, /Não foi possível fechar a folha: Não foi possível conferir as faltas: rede caiu/));
    });
});
