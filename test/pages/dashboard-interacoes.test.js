const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T15:00:00-03:00';

function client(emps, extra = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            employees_decrypted: emps,
            vacations: [],
            time_records: [],
            holidays: [],
            payslips_decrypted: [],
            bank_adjustments: [],
            messages: [],
            message_reads: [],
            employee_audit_decrypted: [],
            employee_trainings: [],
            performance_reviews: [],
            ...extra,
        }),
    });
}

const EMPS = [
    { ...ANA, gender: 'Feminino', salary: 4000, birth_date: '1975-03-10', admission_date: '2019-02-01' },
    { ...BIA, gender: 'Feminino', salary: 8000, birth_date: '1965-07-01' },
    { ...CAIO, gender: 'Masculino', salary: 9000, birth_date: '1990-01-20' },
];

const chartDe = (p, id) => p.charts.filter((c) => c.ctx?.id === id).at(-1);

describe('dashboard.html — plugins de gráfico', () => {
    test('texto central e rótulos de valor são desenhados só quando o gráfico pede', async () => {
        const plugins = [];
        page = await openPage('dashboard', {
            client: client(EMPS),
            now: NOW,
            before: (w) => {
                w.Chart.register = (p) => plugins.push(p);
            },
        });
        const centro = plugins.find((p) => p.id === 'centerText');
        const valores = plugins.find((p) => p.id === 'valueLabels');
        const escritos = [];
        const ctx = { save() {}, restore() {}, fillText: (t) => escritos.push(t) };

        centro.afterDraw({ config: { options: { plugins: {} } }, ctx });
        centro.afterDraw({ config: { options: { plugins: { centerText: { value: '3', label: 'ativos' } } } }, ctx });
        centro.afterDraw({
            config: { options: { plugins: { centerText: { value: '3', label: 'ativos' } } } },
            ctx,
            chartArea: { left: 0, right: 100, top: 0, bottom: 100 },
        });
        assert.deepEqual(escritos.splice(0), ['3', 'ativos'], 'sem área do gráfico não desenha');

        valores.afterDatasetsDraw({ config: { options: { plugins: {} } }, ctx });
        valores.afterDatasetsDraw({
            config: { options: { plugins: { valueLabels: true } } },
            ctx,
            data: {
                datasets: [{ type: 'line', borderColor: '#000', data: [2, -1, 0] }, { data: [5, null] }, { data: [9] }],
            },
            getDatasetMeta: (i) => ({
                hidden: i === 2,
                data: [
                    { x: 1, y: 1 },
                    { x: 2, y: 2 },
                    { x: 3, y: 3 },
                ],
            }),
        });
        assert.deepEqual(escritos, ['+2', '-1', '5'], 'zero, vazio e série oculta não ganham rótulo');
    });

    test('degradês e rótulos dos gráficos', async () => {
        page = await openPage('dashboard', {
            client: client(EMPS, {
                employee_trainings: [{ employee_id: ANA.id, hours: 8, completion_date: '2026-05-20', status: 'concluido' }],
                performance_reviews: [
                    { employee_id: ANA.id, overall_rating: 4, completed_at: '2026-05-30T12:00:00Z', status: 'concluida' },
                    { employee_id: BIA.id, overall_rating: 5, completed_at: '2026-05-10T12:00:00Z', status: 'concluida' },
                ],
                payslips_decrypted: [
                    { mes: '2026-04', total_proventos: 20000, salario_liquido: 16000 },
                    { mes: '2026-05', total_proventos: 22000, salario_liquido: 17000 },
                ],
                messages: [{ id: 'm1', texto: 'Oi', destino: 'Todos', created_at: '2026-06-01T10:00:00-03:00' }],
            }),
            now: NOW,
        });
        const area = { chartArea: { top: 0, bottom: 10, left: 0, right: 10 }, ctx: { createLinearGradient: () => ({ addColorStop() {} }) } };
        const fundos = page.charts.map((c) => c.config.data.datasets[0]?.backgroundColor).filter((b) => typeof b === 'function');
        assert.ok(fundos.length >= 2);
        for (const f of fundos) {
            assert.equal(typeof f({ chart: {} }), 'string', 'sem área usa a cor sólida');
            assert.ok(f({ chart: area }));
        }

        const treino = chartDe(page, 'chart-training-hours');
        assert.equal(page.plain(treino.data.datasets[0].data).at(-2), 8);
        assert.equal(treino.options.plugins.tooltip.callbacks.label({ parsed: { y: 8 } }), ' 8h');
        assert.equal(treino.options.scales.y.ticks.callback(4), '4h');
        const aval = chartDe(page, 'chart-performance-reviews');
        assert.equal(page.plain(aval.data.datasets[0].data).at(-2), 4.5, 'média das notas do mês');

        const folha = chartDe(page, 'chart-payroll');
        const rotulo = folha.options.plugins.tooltip.callbacks.label;
        const iMaio = page.plain(folha.data.datasets[0].data).indexOf(22000);
        assert.match(rotulo({ dataset: { label: 'Custo de folha' }, parsed: { y: 22000 }, dataIndex: iMaio }), /R\$ 22\.000.*\+10\.0% vs mês anterior/);
        assert.match(rotulo({ dataset: { label: 'Custo de folha' }, parsed: { y: 20000 }, dataIndex: 0 }), /^ R\$ 20\.000/);
        assert.match(rotulo({ dataset: { label: 'Média' }, parsed: { y: 1000 } }), /Média: R\$/);
        assert.equal(folha.options.scales.y.ticks.callback(22000), 'R$ 22k');

        const dept = chartDe(page, 'chart-department');
        assert.match(dept.options.plugins.tooltip.callbacks.label({ parsed: { x: 2 } }), /2 colaboradores \(67%\)/);
        const contratos = chartDe(page, 'chart-contracts');
        assert.match(contratos.options.plugins.tooltip.callbacks.label({ label: 'CLT', parsed: 1 }), /CLT: 1 colaborador \(33%\)/);
        const raca = chartDe(page, 'chart-race');
        assert.match(raca.options.plugins.tooltip.callbacks.label({ parsed: { x: 3 } }), /3 colaboradores \(100%\)/);
        const saidas = chartDe(page, 'chart-dept-turnover');
        assert.match(saidas.options.plugins.tooltip.callbacks.label({ dataIndex: 0 }), /% \(0 de \d+ colaborador/);
        const leitura = chartDe(page, 'chart-dept-readrate');
        assert.match(leitura.options.plugins.tooltip.callbacks.label({ dataIndex: 0 }), /% de leitura \(1 comunicado\)/);
    });
});

describe('dashboard.html — faixas, vazios e regras', () => {
    test('tempo de casa 5+ anos; idades 46–55 e 56+', async () => {
        page = await openPage('dashboard', { client: client(EMPS), now: NOW });
        const casa = chartDe(page, 'chart-tenure');
        assert.equal(page.plain(casa.data.datasets[0].data)[3], 1, 'Ana: 7 anos de casa');
        const idade = chartDe(page, 'chart-age');
        assert.deepEqual(page.plain(idade.data.datasets[0].data).slice(3), [1, 1], 'Ana 51, Bia 60');
    });

    test('sem ninguém ativo: gráficos de distribuição somem e indicadores mostram "—"', async () => {
        page = await openPage('dashboard', { client: client([]), now: NOW });
        for (const id of ['chart-department', 'chart-contracts', 'chart-race', 'chart-dept-turnover']) assert.equal(page.$(`#${id}`).style.display, 'none', id);
        assert.equal(page.text('#turnover-rate'), '—');
        assert.equal(page.text('#absenteeism-rate'), '—');
    });

    test('domingo, dia 1º: sem dia útil no mês, absenteísmo "—"', async () => {
        page = await openPage('dashboard', { client: client(EMPS), now: '2026-02-01T10:00:00-03:00' });
        assert.equal(page.text('#absenteeism-rate'), '—');
    });

    test('cota PcD (Lei 8.213/91, art. 93): 2% até 200, 3% até 500, 4% até 1.000, 5% acima', async () => {
        page = await openPage('dashboard', { client: client(EMPS), now: NOW });
        const cota = page.window.pcdQuotaPct;
        assert.deepEqual([99, 100, 200, 201, 500, 501, 1000, 1001].map(cota), [null, 2, 2, 3, 3, 4, 4, 5]);
        page.close();

        const muitos = Array.from({ length: 150 }, (_, i) => ({ ...BIA, id: `e${i}`, name: `Pessoa ${i}`, pcd: i < 2, status: 'Ativo' }));
        page = await openPage('dashboard', { client: client(muitos), now: NOW });
        assert.match(page.text('#equity-pcd-body'), /1\.3%.*2 de 150 colaboradores PCD.*Cota legal mínima.*2%.*Não atende/);
        assert.ok(page.$('#equity-pcd-body .equity-stat--warn'), 'mais da metade da cota: atenção');
        page.close();

        const atende = Array.from({ length: 150 }, (_, i) => ({ ...BIA, id: `e${i}`, name: `Pessoa ${i}`, pcd: i < 3, status: 'Ativo' }));
        page = await openPage('dashboard', { client: client(atende), now: NOW });
        assert.match(page.text('#equity-pcd-body'), /2\.0%.*Atende/);
        assert.ok(page.$('#equity-pcd-body .equity-stat--good'));
    });

    test('seções recolhem e expandem', async () => {
        page = await openPage('dashboard', { client: client(EMPS), now: NOW });
        await page.click('#demo-section-toggle');
        assert.equal(page.$('#demo-section-toggle').getAttribute('aria-expanded'), 'false');
        assert.equal(page.$('#demo-section-toggle').getAttribute('aria-label'), 'Expandir seção');
        await page.click('#demo-section-toggle');
        assert.equal(page.$('#demo-section-toggle').getAttribute('aria-label'), 'Recolher seção');
    });
});

describe('dashboard.html — exportação e tempo real', () => {
    test('PDF com todos os gráficos quebra página; sem biblioteca avisa; menu fecha com clique fora', async () => {
        page = await openPage('dashboard', { client: client(EMPS), now: NOW });
        await page.click('#btn-export');
        assert.ok(page.$('#export-menu').classList.contains('open'));
        await page.click('body');
        assert.ok(!page.$('#export-menu').classList.contains('open'));
        await page.click('#export-pdf');
        const pdf = page.pdfs.at(-1);
        assert.ok(pdf.calls.filter(([m]) => m === 'addImage').length >= 10, 'os gráficos entram no relatório');
        assert.ok(pdf.calls.some(([m]) => m === 'addPage'));
        page.window.jspdf = undefined;
        await page.click('#export-pdf');
        assert.ok(page.alerts.includes('Biblioteca PDF não carregada.'));
    });

    test('mudanças em férias, holerites, banco de horas e comunicados recarregam o painel', async () => {
        const c = client(EMPS);
        page = await openPage('dashboard', { client: c, now: NOW });
        const cargas = () => c.calls.filter((x) => x.table === 'employees_decrypted').length;
        for (const t of ['vacations', 'payslips', 'bank_adjustments', 'messages', 'message_reads']) {
            const antes = cargas();
            c.emit(t, { eventType: 'INSERT', new: {} });
            await page.waitFor(() => cargas() > antes, { message: t });
        }
    });
});

describe('dashboard.html — engajamento, três gêneros e relatório longo', () => {
    test('comunicados menos lidos em ordem; tempo de leitura; maior disparidade entre três gêneros; seção nova quebra página', async () => {
        const emps = [...EMPS, { ...BIA, id: 'emp-nb', name: 'Nic Reis', gender: 'Não-binário', salary: 3000 }];
        page = await openPage('dashboard', {
            client: client(emps, {
                messages: [
                    { id: 'm1', texto: 'A', destino: 'Todos', created_at: '2026-06-01T10:00:00-03:00' },
                    { id: 'm2', texto: 'B', destino: 'Financeiro', created_at: '2026-06-02T10:00:00-03:00' },
                ],
                message_reads: [
                    { message_id: 'm1', employee_id: ANA.id, read_at: '2026-06-01T12:00:00-03:00' },
                    { message_id: 'm2', employee_id: ANA.id, read_at: '2026-06-02T11:00:00-03:00' },
                    { message_id: 'm2', employee_id: BIA.id, read_at: '2026-06-02T13:00:00-03:00' },
                ],
            }),
            now: NOW,
        });
        assert.match(page.text('#equity-gender-body'), /gap salarial: Masculino ganha mais que Não-binário/);
        assert.match(page.text('#engagement-low-list'), /A.*25%.*B.*67%/, 'o menos lido primeiro');
        const tempo = chartDe(page, 'chart-read-time');
        const rotulo = tempo.options.plugins.tooltip.callbacks.label;
        assert.equal(rotulo({ parsed: { y: null } }), ' Sem leituras');
        assert.equal(rotulo({ parsed: { y: 2 } }), ' 2h em média');
        assert.equal(tempo.options.scales.y.ticks.callback(3), '3h');

        page.$$('canvas').forEach((c) => (c.height = 2000));
        await page.click('#export-pdf');
        const pdf = page.pdfs.at(-1);
        assert.ok(pdf.calls.filter(([m]) => m === 'addPage').length >= 5);
    });
});

describe('dashboard.html — rótulos dos demais gráficos', () => {
    test('tooltips e eixos: promoções, avaliações, tempo de casa, idade, gênero, horas extras e percentuais', async () => {
        page = await openPage('dashboard', {
            client: client(EMPS, { messages: [{ id: 'm1', texto: 'Oi', destino: 'Todos', created_at: '2026-06-01T10:00:00-03:00' }] }),
            now: NOW,
        });
        const rotulo = (id, ctx) => chartDe(page, id).options.plugins.tooltip.callbacks.label(ctx);
        assert.equal(rotulo('chart-promotion-rate', { parsed: { y: 1 } }), ' 1 promoção');
        assert.equal(rotulo('chart-promotion-rate', { parsed: { y: 2 } }), ' 2 promoções');
        assert.equal(rotulo('chart-performance-reviews', { parsed: { y: 4.5 } }), ' 4.5/5');
        assert.equal(rotulo('chart-performance-reviews', { parsed: { y: 0 } }), ' Sem avaliações concluídas');
        assert.equal(rotulo('chart-tenure', { parsed: { x: 1 } }), ' 1 colaborador');
        assert.equal(rotulo('chart-age', { parsed: { y: 2 } }), ' 2 colaboradores');
        assert.equal(rotulo('chart-gender', { label: 'Feminino', parsed: 2 }), ' Feminino: 2 colaboradores');
        assert.equal(rotulo('chart-overtime', { parsed: { y: 3 } }), ' 3h');
        assert.equal(chartDe(page, 'chart-overtime').options.scales.y.ticks.callback(3), '3h');
        assert.equal(chartDe(page, 'chart-dept-turnover').options.scales.x.ticks.callback(10), '10%');
        assert.equal(chartDe(page, 'chart-dept-readrate').options.scales.x.ticks.callback(50), '50%');
    });
});
