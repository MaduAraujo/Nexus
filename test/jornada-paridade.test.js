const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
const { CLTDomain } = require('../src/javascript/domain/clt-domain.js');

let edge;
before(async () => {
    edge = await import('../supabase/functions/_shared/employee-financial-snapshot.mjs');
});

const JORNADAS = [
    ['PJ não tem jornada', { contract_type: 'pj', work_load: '40h' }, null],
    ['PJ em maiúsculas', { contract_type: 'PJ' }, null],
    ['estágio sem acento', { contract_type: 'estagio', work_load: '40h' }, 360],
    ['estágio com acento', { contract_type: 'estágio' }, 360],
    ['aprendiz', { contract_type: 'aprendiz', work_load: '44h' }, 360],
    ['escala 12x36', { contract_type: 'clt', work_load: '12x36' }, 720],
    ['44h semanais', { contract_type: 'clt', work_load: '44h' }, 528],
    ['40h semanais', { contract_type: 'clt', work_load: '40h' }, 480],
    ['30h semanais', { contract_type: 'clt', work_load: '30h' }, 360],
    ['20h semanais', { contract_type: 'clt', work_load: '20h' }, 240],
    ['carga fora do padrão cai em 8h', { contract_type: 'clt', work_load: 'flexível' }, 480],
    ['sem carga informada', { contract_type: 'clt' }, 480],
    ['contrato ausente é CLT', {}, 480],
    ['temporário segue a carga', { contract_type: 'temporario', work_load: '40h' }, 480],
];

const REGISTROS = [
    ['sem entrada', {}, 0],
    ['entrada e saída sem almoço', { entrada: '2026-06-01T08:00:00-03:00', saida: '2026-06-01T17:00:00-03:00' }, 540],
    [
        'com almoço desconta o intervalo',
        {
            entrada: '2026-06-01T08:00:00-03:00',
            saida_almoco: '2026-06-01T12:00:00-03:00',
            retorno_almoco: '2026-06-01T13:00:00-03:00',
            saida: '2026-06-01T17:00:00-03:00',
        },
        480,
    ],
    ['saiu para almoçar e não voltou: só a manhã', { entrada: '2026-06-01T08:00:00-03:00', saida_almoco: '2026-06-01T12:00:00-03:00' }, 240],
    ['dia em aberto conta zero', { entrada: '2026-06-01T08:00:00-03:00' }, 0],
    ['minutos quebrados arredondam', { entrada: '2026-06-01T08:00:00-03:00', saida: '2026-06-01T08:00:40-03:00' }, 1],
];

describe('regra de jornada: tela (CLTDomain) e Edge Function dão o mesmo resultado', () => {
    for (const [nome, emp, esperado] of JORNADAS) {
        test(`jornada diária — ${nome}`, () => {
            assert.equal(CLTDomain.resolveJornadaMin({ contractType: emp.contract_type, workLoad: emp.work_load }), esperado, 'CLTDomain');
            assert.equal(edge.getJornadaMin(emp), esperado, 'Edge Function');
        });
    }

    for (const [nome, rec, esperado] of REGISTROS) {
        test(`minutos trabalhados — ${nome}`, () => {
            assert.equal(CLTDomain.calcWorkedMin(rec), esperado, 'CLTDomain');
            assert.equal(edge.calcWorkedMin(rec), esperado, 'Edge Function');
        });
    }
});
