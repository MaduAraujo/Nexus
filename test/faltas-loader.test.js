const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
require('../src/javascript/domain/clt-domain.js');
global.CLTDomain = global.window.CLTDomain;
const { FakeSupabase } = require('../test-support/fake-supabase.js');
const NexusFaltas = require('../src/javascript/shared/faltas.js');

const EMP = 'e1';
const presente = (date) => ({ employee_id: EMP, date, entrada: `${date}T08:00:00-03:00` });

describe('NexusFaltas.listar — mesmo carregador para folha e férias', () => {
    const RealDate = Date;
    beforeEach(() => {
        const fixo = new RealDate('2026-06-24T10:00:00-03:00').getTime();
        global.Date = class extends RealDate {
            constructor(...a) {
                super(...(a.length ? a : [fixo]));
            }
            static now() {
                return fixo;
            }
        };
    });
    afterEach(() => {
        global.Date = RealDate;
        delete global.sb;
    });

    const vazio = () => ({ time_records: [], holidays: [], adjustment_requests: [], medical_leaves: [], vacations: [] });

    test('se qualquer consulta falhar, NÃO calcula faltas: um erro de rede nunca vira desconto', async () => {
        for (const tabela of ['time_records', 'holidays', 'adjustment_requests', 'medical_leaves', 'vacations']) {
            global.sb = new FakeSupabase({ tables: vazio(), errors: { [`${tabela}:select`]: { message: `falha em ${tabela}` } } });
            await assert.rejects(
                NexusFaltas.listar(EMP, '2026-06-01', '2026-06-30'),
                new RegExp(`Não foi possível conferir as faltas: falha em ${tabela}`),
                tabela
            );
        }
    });

    test('quem nunca bateu ponto não tem falta contada antes do primeiro registro', async () => {
        global.sb = new FakeSupabase({ tables: vazio() });
        assert.deepEqual(await NexusFaltas.listar(EMP, '2026-06-01', '2026-06-23'), []);
    });

    test('férias com período inválido são ignoradas, sem derrubar o cálculo', async () => {
        const tabelas = vazio();
        tabelas.time_records = ['2026-06-01', '2026-06-02'].map(presente);
        tabelas.vacations = [{ employee_id: EMP, start_date: '2026-06-10', end_date: '2026-06-05', days: 0, status: 'aprovado' }];
        global.sb = new FakeSupabase({ tables: tabelas });
        const faltas = await NexusFaltas.listar(EMP, '2026-06-01', '2026-06-12');
        assert.ok(faltas.includes('2026-06-10'), 'o dia segue como falta porque as férias não valem');
    });

    test('junta ponto, feriados, abonos, atestados e férias; hoje e o futuro não são falta', async () => {
        global.sb = new FakeSupabase({
            tables: {
                time_records: ['2026-06-01', '2026-06-15', '2026-06-16', '2026-06-22'].map(presente),
                holidays: [{ date: '2026-06-17' }],
                adjustment_requests: [
                    { employee_id: EMP, date: '2026-06-18', tipo: 'falta', status: 'aprovado' },
                    { employee_id: EMP, date: '2026-06-19', tipo: 'falta', status: 'rejeitado' },
                ],
                medical_leaves: [{ employee_id: EMP, start_date: '2026-06-10', end_date: '2026-06-12', status: 'aprovado' }],
                vacations: [{ employee_id: EMP, start_date: '2026-06-02', end_date: '2026-06-09', status: 'aprovado' }],
            },
        });
        const faltas = await NexusFaltas.listar(EMP, '2026-06-01', '2026-06-30');
        assert.deepEqual(faltas, ['2026-06-19', '2026-06-23']);
    });

    test('o abono não afasta: fora do período de gozo, ausência é falta mesmo com abono', async () => {
        global.sb = new FakeSupabase({
            tables: {
                time_records: [presente('2026-06-01')],
                holidays: [],
                adjustment_requests: [],
                medical_leaves: [],
                vacations: [{ employee_id: EMP, start_date: '2026-06-02', end_date: '2026-06-13', days: 12, abono: true, status: 'aprovado' }],
            },
        });
        const faltas = await NexusFaltas.listar(EMP, '2026-06-01', '2026-06-23');
        assert.deepEqual(faltas, ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-22', '2026-06-23']);
    });

    test('período inteiro no futuro devolve vazio sem consultar nada', async () => {
        global.sb = {
            from() {
                throw new Error('não deveria consultar o banco');
            },
        };
        assert.deepEqual(await NexusFaltas.listar(EMP, '2026-07-01', '2026-07-31'), []);
    });
});
