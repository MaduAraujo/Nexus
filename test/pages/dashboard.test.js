const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T15:00:00-03:00';
const UTEIS = ['01', '02', '03', '05', '08', '09', '10', '11', '12', '15', '16', '17'].map((d) => `2026-06-${d}`);

function client(extra = {}) {
    const emps = [
        { ...ANA, gender: 'Feminino', salary: 4000, pcd: true, raca_cor: 'Parda', birth_date: '1995-03-10' },
        { ...BIA, gender: 'Feminino', salary: 8000, raca_cor: 'Branca', birth_date: '1985-07-01' },
        { ...CAIO, gender: 'Masculino', salary: 9000, raca_cor: 'Preta', birth_date: '1990-01-20' },
        {
            id: 'emp-duda',
            name: 'Duda Reis',
            dept: 'TI',
            status: 'Inativo',
            contract_type: 'clt',
            gender: 'Masculino',
            salary: 5000,
            admission_date: '2023-01-02',
            termination_date: '2026-03-31',
        },
        {
            id: 'emp-edu',
            name: 'Edu Nunes',
            dept: 'TI',
            status: 'Ativo',
            contract_type: 'clt',
            gender: 'Masculino',
            salary: 12000,
            admission_date: '2026-06-15',
        },
    ];
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            employees_decrypted: emps,
            vacations: [{ id: 'v1', employee_id: BIA.id, start_date: '2026-06-08', end_date: '2026-06-19', status: 'aprovado' }],
            time_records: [
                ...UTEIS.map((date) => ({ employee_id: ANA.id, date, entrada: `${date}T08:00:00-03:00` })),
                ...UTEIS.filter((d) => d < '2026-06-08').map((date) => ({ employee_id: BIA.id, date, entrada: `${date}T08:00:00-03:00` })),
                { employee_id: 'emp-edu', date: '2026-06-15', entrada: '2026-06-15T08:00:00-03:00' },
                { employee_id: 'emp-edu', date: '2026-06-16', entrada: '2026-06-16T08:00:00-03:00' },
            ],
            holidays: [{ date: '2026-06-04', name: 'Corpus Christi' }],
            payslips_decrypted: [{ mes: '2026-05', total_proventos: 21000, salario_liquido: 17000 }],
            bank_adjustments: [{ employee_id: ANA.id, tipo: 'credito', minutos: 120, date: '2026-06-02' }],
            messages: [{ id: 'm1', texto: 'Oi', destino: 'Todos', created_at: '2026-06-01T10:00:00-03:00' }],
            message_reads: [{ message_id: 'm1', employee_id: ANA.id, read_at: '2026-06-01T11:00:00-03:00' }],
            employee_audit_decrypted: [
                { employee_id: ANA.id, changes: [{ field: 'role', oldValue: 'Assistente', newValue: 'Analista' }], created_at: '2026-04-10T10:00:00-03:00' },
            ],
            employee_trainings: [{ employee_id: ANA.id, hours: 8, completion_date: '2026-05-20' }],
            performance_reviews: [{ employee_id: ANA.id, overall_rating: 4, completed_at: '2026-05-30' }],
            ...extra,
        }),
    });
}

describe('dashboard.html', () => {
    test('contadores de status e férias em andamento', async () => {
        page = await openPage('dashboard', { client: client(), now: NOW });
        assert.deepEqual(
            ['count-ativos', 'count-ferias', 'count-inativos', 'count-afastados'].map((id) => page.text(`#${id}`)),
            ['4', '1', '1', '0']
        );
        assert.match(page.text('#delta-ativos'), /\+1 admissão/);
        assert.equal(page.text('#turnover-rate'), '20.0%');
    });

    test('absenteísmo ignora PJ, férias, feriado e dias antes da admissão', async () => {
        page = await openPage('dashboard', { client: client(), now: NOW });
        await page.waitFor(() => page.text('#absenteeism-rate') !== '—' && /%/.test(page.text('#absenteeism-rate')));
        assert.equal(page.text('#absenteeism-rate'), '5.3%');
    });

    test('equidade: gap salarial por gênero e cota PcD (sem obrigação abaixo de 100)', async () => {
        page = await openPage('dashboard', { client: client(), now: NOW });
        assert.match(page.text('#equity-gender-body'), /42\.9%.*Masculino ganha mais que Feminino/);
        assert.match(page.text('#equity-pcd-body'), /25\.0%.*1 de 4 colaboradores PCD.*Sem obrigatoriedade legal/);
    });

    test('gráficos são desenhados com os dados carregados', async () => {
        page = await openPage('dashboard', { client: client(), now: NOW });
        const ids = page.charts.map((c) => c.ctx?.id).filter(Boolean);
        for (const id of ['chart-department', 'chart-contracts', 'chart-gender', 'chart-payroll', 'chart-turnover'])
            assert.ok(ids.includes(id), `gráfico ${id}`);
        const contratos = page.charts.find((c) => c.ctx?.id === 'chart-contracts');
        assert.ok(page.plain(contratos.data.labels).length >= 2);
    });

    test('exportar PDF gera o relatório e registra a exportação', async () => {
        const c = client();
        page = await openPage('dashboard', { client: c, now: NOW });
        await page.click('#btn-export');
        await page.click('#export-pdf');
        await page.settle(20);
        assert.equal(page.pdfs.length, 1);
        assert.ok(page.saved.length === 1 || c.rpcCalls('report_data_export').length === 1);
    });

    test('mudança em tempo real recarrega os números', async () => {
        const c = client();
        page = await openPage('dashboard', { client: c, now: NOW });
        c.tables.employees_decrypted.find((e) => e.id === ANA.id).status = 'Afastado';
        c.emit('employees', { new: { id: ANA.id } });
        await page.settle(20);
        assert.equal(page.text('#count-afastados'), '1');
        assert.equal(page.text('#count-ativos'), '3');
    });
});
