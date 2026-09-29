const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T15:00:00-03:00';
const TABELAS = [
    'employees_decrypted',
    'vacations',
    'payslips_decrypted',
    'bank_adjustments',
    'messages',
    'message_reads',
    'employee_audit_decrypted',
    'employee_trainings',
    'performance_reviews',
];

function client(extra = {}, opts = {}) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            employees_decrypted: [],
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
        ...opts,
    });
}

const chartDe = (p, id) => p.charts.filter((c) => c.ctx?.id === id).at(-1);
const rotulo = (chart, i, valor) => {
    const ds = chart.data.datasets[0];
    const doughnut = chart.config.type === 'doughnut';
    return chart.options.plugins.tooltip.callbacks.label({
        parsed: doughnut ? valor : { x: valor, y: valor },
        label: chart.data.labels[i],
        dataIndex: i,
        dataset: ds,
        raw: valor,
    });
};

const EMPS = [
    { ...ANA, dept: null, contract_type: null, gender: 'Feminino', salary: 8800, birth_date: '2003-12-31', admission_date: null, status: 'Ativo' },
    { ...BIA, dept: 'TI', gender: 'Masculino', salary: 10000, birth_date: '1990-01-20', admission_date: '2020-01-01', status: 'Ativo' },
    { ...CAIO, dept: 'TI', gender: 'Outro', salary: 9400, admission_date: '2021-01-01', termination_date: '2026-03-01', status: 'Inativo' },
    {
        id: 'e4',
        name: 'Duda',
        dept: 'Vendas',
        contract_type: 'CLT',
        status: 'Ativo',
        gender: 'Outro',
        salary: 9400,
        birth_date: '2000-06-30',
        admission_date: '2022-01-01',
        termination_date: null,
    },
    { id: 'e5', name: 'Edu', dept: 'Vendas', contract_type: 'CLT', status: 'Ativo', admission_date: '2022-01-01', termination_date: null },
    { id: 'e6', name: 'Fabi', dept: 'Vendas', contract_type: 'CLT', status: 'Ativo', admission_date: '2022-01-01', termination_date: null },
    { id: 'e7', name: 'Gil', dept: 'Vendas', contract_type: 'CLT', status: 'Inativo', admission_date: '2022-01-01', termination_date: '2026-02-01' },
    { id: 'e8', name: 'Hugo', dept: 'Vendas', contract_type: 'CLT', status: 'Ativo', admission_date: '2022-01-01', termination_date: null },
    { id: 'e9', name: 'Ivo', dept: 'Vendas', contract_type: 'CLT', status: 'Ativo', admission_date: '2022-01-01', termination_date: null },
    { id: 'e10', name: 'Jo', dept: 'Vendas', contract_type: 'CLT', status: 'Ativo', admission_date: '2022-01-01', termination_date: null },
    { id: 'e11', name: 'Kai', dept: 'Vendas', contract_type: 'CLT', status: 'Ativo', admission_date: '2022-01-01', termination_date: null },
    { id: 'e12', name: 'Lu', dept: 'Vendas', contract_type: 'CLT', status: 'Ativo', admission_date: '2022-01-01', termination_date: null },
];

describe('dashboard.html — bordas', () => {
    test('falha em todas as consultas mostra o painel zerado', async () => {
        const errors = Object.fromEntries(TABELAS.map((t) => [t, { message: 'x' }]));
        page = await openPage('dashboard', { client: client({}, { errors }), now: NOW });
        assert.equal(page.text('#count-ativos'), '0');
        assert.equal(page.text('#turnover-rate'), '—');
    });

    test('sem a biblioteca de gráficos o painel carrega os números sem desenhar', async () => {
        page = await openPage('dashboard', {
            client: client({ employees_decrypted: EMPS }),
            now: NOW,
            before(w) {
                delete w.Chart;
            },
        });
        assert.equal(page.text('#count-ativos'), '10');
        assert.equal(page.charts.length, 0);
    });

    test('dados variados: sem setor/contrato/admissão, idade no limite, gap salarial, horas, avaliações e comunicados', async () => {
        const c = client({
            employees_decrypted: EMPS,
            vacations: [
                { id: 'v1', employee_id: BIA.id, start_date: '2026-06-01', end_date: '2026-06-05', status: 'aprovado' },
                { id: 'v2', employee_id: BIA.id, start_date: '2026-06-15', end_date: '2026-06-20', status: 'pendente' },
            ],
            payslips_decrypted: [
                { mes: '2026-05', total_proventos: 10000 },
                { mes: '2026-06', total_proventos: null },
                { mes: '2026-06', total_proventos: 8000 },
            ],
            bank_adjustments: [
                { employee_id: BIA.id, tipo: 'debito', minutos: 30, date: '2026-06-02' },
                { employee_id: BIA.id, tipo: 'credito', minutos: null, date: '2026-06-02' },
                { employee_id: BIA.id, tipo: 'credito', minutos: 60, date: null },
            ],
            employee_audit_decrypted: [
                { employee_id: BIA.id, changes: null, created_at: '2026-05-01T10:00:00Z' },
                { employee_id: BIA.id, changes: [{ field: 'salary' }], created_at: '2026-05-01T10:00:00Z' },
            ],
            employee_trainings: [
                { employee_id: CAIO.id, hours: 10, completion_date: '2026-05-10', status: 'concluido' },
                { employee_id: BIA.id, hours: 5, completion_date: null, status: 'concluido' },
                { employee_id: BIA.id, hours: null, completion_date: '2026-05-10', status: 'concluido' },
            ],
            performance_reviews: [
                { employee_id: CAIO.id, overall_rating: 4, completed_at: '2026-05-10T10:00:00Z', status: 'concluida' },
                { employee_id: BIA.id, overall_rating: null, completed_at: '2026-05-10T10:00:00Z', status: 'concluida' },
                { employee_id: BIA.id, overall_rating: 3, completed_at: null, status: 'concluida' },
            ],
            messages: [
                { id: 'm1', texto: 'x'.repeat(60), destino: 'Todos', categoria: 'Institucional', created_at: '2026-06-01T10:00:00-03:00', scheduled_at: null },
                {
                    id: 'm2',
                    texto: 'Agendado',
                    destino: 'TI',
                    categoria: 'Institucional',
                    created_at: '2026-06-01T10:00:00-03:00',
                    scheduled_at: '2026-06-02T10:00:00-03:00',
                },
                {
                    id: 'm3',
                    texto: 'Futuro',
                    destino: 'TI',
                    categoria: 'Institucional',
                    created_at: '2026-06-01T10:00:00-03:00',
                    scheduled_at: '2026-07-01T10:00:00-03:00',
                },
                {
                    id: 'm4',
                    texto: 'Vazio',
                    destino: 'Setor Sem Gente',
                    categoria: 'Institucional',
                    created_at: '2026-06-01T10:00:00-03:00',
                    scheduled_at: null,
                },
                {
                    id: 'm5',
                    texto: 'Antes',
                    destino: 'TI',
                    categoria: 'Institucional',
                    created_at: '2026-06-10T10:00:00-03:00',
                    scheduled_at: '2026-06-01T10:00:00-03:00',
                },
            ],
            message_reads: [
                { message_id: 'm2', employee_id: BIA.id, read_at: '2026-06-03T10:00:00-03:00' },
                { message_id: 'm1', employee_id: 'e4', read_at: '2026-05-20T10:00:00-03:00' },
                { message_id: 'sumiu', employee_id: BIA.id, read_at: '2026-06-03T10:00:00-03:00' },
                { message_id: 'm1', employee_id: 'e5', read_at: '2026-06-02T10:00:00-03:00' },
                { message_id: 'm1', employee_id: 'e6', read_at: '2026-06-02T10:00:00-03:00' },
                { message_id: 'm1', employee_id: 'e8', read_at: '2026-06-02T10:00:00-03:00' },
                { message_id: 'm1', employee_id: 'e9', read_at: '2026-06-02T10:00:00-03:00' },
                { message_id: 'm1', employee_id: 'e10', read_at: '2026-06-02T10:00:00-03:00' },
            ],
        });
        c.errors['time_records:select'] = { message: 'x' };
        c.errors['holidays:select'] = { message: 'y' };
        page = await openPage('dashboard', { client: c, now: NOW });

        assert.match(page.text('#equity-gender-body'), /12\.0%/);
        assert.ok(page.$('#equity-gender-body .equity-stat--warn'));
        assert.ok(chartDe(page, 'chart-department').data.labels.includes('Não Informado'));
        assert.ok(chartDe(page, 'chart-contracts').data.labels.includes('Não Definido'));
        assert.equal(chartDe(page, 'chart-age').data.datasets[0].data[0], 2);
        assert.match(page.text('#engagement-low-list'), /x{54}…/);

        assert.match(rotulo(chartDe(page, 'chart-department'), 0, 1), / 1 colaborador \(/);
        assert.match(rotulo(chartDe(page, 'chart-department'), 0, 2), / 2 colaboradores \(/);
        assert.match(rotulo(chartDe(page, 'chart-contracts'), 0, 1), /1 colaborador \(/);
        assert.match(rotulo(chartDe(page, 'chart-contracts'), 0, 2), /2 colaboradores \(/);
        assert.match(rotulo(chartDe(page, 'chart-race'), 0, 1), / 1 colaborador \(/);
        assert.match(rotulo(chartDe(page, 'chart-race'), 0, 2), / 2 colaboradores \(/);
        assert.equal(rotulo(chartDe(page, 'chart-tenure'), 0, 1), ' 1 colaborador');
        assert.equal(rotulo(chartDe(page, 'chart-tenure'), 0, 2), ' 2 colaboradores');
        assert.equal(rotulo(chartDe(page, 'chart-age'), 0, 1), ' 1 colaborador');
        assert.equal(rotulo(chartDe(page, 'chart-age'), 0, 2), ' 2 colaboradores');
        assert.match(rotulo(chartDe(page, 'chart-gender'), 0, 1), /: 1 colaborador$/);
        assert.match(rotulo(chartDe(page, 'chart-gender'), 0, 2), /: 2 colaboradores$/);

        const folha = chartDe(page, 'chart-payroll');
        assert.match(rotulo(folha, 5, 8000), /-20\.0% vs mês anterior/);
        assert.match(rotulo(folha, 5, 12000), /\+20\.0% vs mês anterior/);

        const saidas = chartDe(page, 'chart-dept-turnover');
        const cores = saidas.data.datasets[0].backgroundColor;
        assert.ok(cores.includes('#ef4444') && cores.includes('#f59e0b'));
        const iTi = saidas.data.labels.indexOf('TI');
        assert.match(rotulo(saidas, iTi, 50), /de 2 colaboradores/);
        const iSem = saidas.data.labels.indexOf('Não Informado');
        assert.match(rotulo(saidas, iSem, 0), /de 1 colaborador\)/);

        const leitura = chartDe(page, 'chart-dept-readrate');
        const coresLeitura = leitura.data.datasets[0].backgroundColor;
        assert.ok(coresLeitura.includes('#ef4444') && coresLeitura.includes('#f59e0b'));
        const iTiL = leitura.data.labels.indexOf('TI');
        assert.match(rotulo(leitura, iTiL, 0), /\(3 comunicados\)/);
        const iSemL = leitura.data.labels.indexOf('Não Informado');
        assert.match(rotulo(leitura, iSemL, 0), /\(1 comunicado\)/);
    });

    test('gap salarial grande fica vermelho', async () => {
        page = await openPage('dashboard', {
            client: client({
                employees_decrypted: [
                    { ...ANA, gender: 'Feminino', salary: 5000, status: 'Ativo' },
                    { ...BIA, gender: 'Masculino', salary: 10000, status: 'Ativo' },
                ],
            }),
            now: NOW,
        });
        assert.ok(page.$('#equity-gender-body .equity-stat--bad'));
    });

    test('setor que leu tudo fica verde na taxa de leitura', async () => {
        page = await openPage('dashboard', {
            client: client({
                employees_decrypted: [{ ...ANA, dept: 'RH', status: 'Ativo' }],
                messages: [{ id: 'm1', texto: 'A', destino: 'Todos', categoria: 'Institucional', created_at: '2026-06-01T10:00:00-03:00', scheduled_at: null }],
                message_reads: [{ message_id: 'm1', employee_id: ANA.id, read_at: '2026-06-02T10:00:00-03:00' }],
            }),
            now: NOW,
        });
        assert.deepEqual(page.plain(chartDe(page, 'chart-dept-readrate').data.datasets[0].backgroundColor), ['#22c55e']);
    });
});
