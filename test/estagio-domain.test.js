const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
const { EstagioDomain } = require('../src/javascript/domain/estagio-domain.js');

const BASE = {
    id: 'e1',
    admissionDate: '2026-03-10',
    birthDate: '2005-01-01',
    workLoad: '30h',
    pcd: false,
    nivel: 'superior',
    obrigatorio: false,
    alternancia: false,
    instituicao: 'Universidade X',
    fim: '2027-03-09',
    supervisorId: 's1',
    salary: 1200,
    valeTransporte: true,
    avaliacoes: [],
};

describe('EstagioDomain — identificação e rótulos', () => {
    test('reconhece estágio com e sem acento, em qualquer caixa', () => {
        assert.equal(EstagioDomain.isEstagio('Estágio'), true);
        assert.equal(EstagioDomain.isEstagio('estagio'), true);
        assert.equal(EstagioDomain.isEstagio('CLT'), false);
        assert.equal(EstagioDomain.isEstagio(undefined), false);
    });

    test('rótulo do nível e nível desconhecido', () => {
        assert.equal(EstagioDomain.nivelLabel('superior'), 'Educação superior');
        assert.equal(EstagioDomain.nivelLabel('xyz'), '—');
    });

    test('cota do art. 17 só vale para médio regular, especial e fundamental', () => {
        assert.equal(EstagioDomain.temCota('medio'), true);
        assert.equal(EstagioDomain.temCota('especial'), true);
        assert.equal(EstagioDomain.temCota('superior'), false);
        assert.equal(EstagioDomain.temCota('medio_profissional'), false);
    });
});

describe('EstagioDomain — jornada (art. 10)', () => {
    test('carga máxima semanal por nível e alternância', () => {
        assert.equal(EstagioDomain.cargaMaximaSemanal('especial'), 20);
        assert.equal(EstagioDomain.cargaMaximaSemanal('fundamental_eja', true), 20);
        assert.equal(EstagioDomain.cargaMaximaSemanal('superior'), 30);
        assert.equal(EstagioDomain.cargaMaximaSemanal('superior', true), 40);
    });
});

describe('EstagioDomain — duração, recesso e relatório', () => {
    test('fim máximo é 2 anos menos 1 dia, com 29/02 virando 28/02', () => {
        assert.equal(EstagioDomain.fimMaximo('2026-03-10'), '2028-03-09');
        assert.equal(EstagioDomain.fimMaximo('2028-02-29'), '2030-02-27');
        assert.equal(EstagioDomain.fimMaximo('2026-01-01'), '2027-12-31');
        assert.equal(EstagioDomain.fimMaximo(''), null);
    });

    test('recesso proporcional: 2,5 dias por mês completo (art. 13 § 2º)', () => {
        assert.equal(EstagioDomain.recessoAdquirido('2026-01-10', '2026-07-09'), 12);
        assert.equal(EstagioDomain.recessoAdquirido('2026-01-10', '2026-07-10'), 15);
        assert.equal(EstagioDomain.recessoAdquirido('2026-01-10', '2027-01-10'), 30);
        assert.equal(EstagioDomain.recessoAdquirido('2026-01-10', '2026-01-09'), 0);
        assert.equal(EstagioDomain.recessoAdquirido('', '2026-01-09'), 0);
        assert.equal(EstagioDomain.recessoAdquirido('2026-01-10', new Date(2026, 3, 10)), 7);
        assert.equal(typeof EstagioDomain.recessoAdquirido('2026-01-10'), 'number');
    });

    test('recesso na rescisão soma anos completos e desconta o que foi gozado', () => {
        assert.deepEqual(EstagioDomain.recessoNaRescisao({ admissaoISO: '2025-01-10', desligamentoISO: '2026-02-09' }), {
            meses: 13,
            devidos: 33,
            gozados: 0,
            dias: 33,
        });
        assert.equal(EstagioDomain.recessoNaRescisao({ admissaoISO: '2025-01-10', desligamentoISO: '2026-02-09', gozados: 30 }).dias, 3);
        assert.equal(EstagioDomain.recessoNaRescisao({ admissaoISO: '2026-01-10', desligamentoISO: '2026-03-09', gozados: 20 }).dias, 0);
        assert.equal(EstagioDomain.recessoNaRescisao({ admissaoISO: '2026-01-10', desligamentoISO: '2026-03-09', gozados: -4 }).gozados, 0);
    });

    test('cota do art. 17 por tamanho do quadro', () => {
        assert.equal(EstagioDomain.limiteCota(0), 0);
        assert.equal(EstagioDomain.limiteCota('x'), 0);
        assert.equal(EstagioDomain.limiteCota(5), 1);
        assert.equal(EstagioDomain.limiteCota(10), 2);
        assert.equal(EstagioDomain.limiteCota(25), 5);
        assert.equal(EstagioDomain.limiteCota(26), 6);
        assert.equal(EstagioDomain.limiteCota(30), 6);
        assert.equal(EstagioDomain.limiteCota(31), 7);
    });

    test('relatório semestral: conta da admissão ou do último relatório (art. 9º, VII)', () => {
        assert.deepEqual(EstagioDomain.proximoRelatorio('2026-01-31', null, '2026-07-30'), { prazo: '2026-07-31', vencido: false });
        assert.deepEqual(EstagioDomain.proximoRelatorio('2026-08-31', null, '2027-03-01'), { prazo: '2027-02-28', vencido: true });
        assert.deepEqual(EstagioDomain.proximoRelatorio('2026-01-10', '2026-07-01', '2026-12-01'), { prazo: '2027-01-01', vencido: false });
        assert.equal(EstagioDomain.proximoRelatorio('2026-01-10', '2025-12-01', '2026-12-01').prazo, '2026-07-10');
        assert.equal(EstagioDomain.proximoRelatorio('', null), null);
        assert.equal(typeof EstagioDomain.proximoRelatorio('2026-01-10', null).vencido, 'boolean');
    });
});

describe('EstagioDomain.validar', () => {
    const erro = (alteracoes) => EstagioDomain.validar({ ...BASE, ...alteracoes });

    test('cadastro completo e válido passa', () => {
        assert.equal(erro({}), null);
        assert.equal(erro({ obrigatorio: true, salary: 0, valeTransporte: false }), null);
        assert.equal(erro({ birthDate: null }), null);
        assert.equal(erro({ id: null }), null);
        assert.equal(erro({ alternancia: true, workLoad: '40h' }), null);
        assert.equal(erro({ avaliacoes: [{ inicio: '2026-06-01', fim: '2026-06-05' }] }), null);
        assert.equal(erro({ avaliacoes: undefined }), null);
    });

    test('sem argumentos acusa o nível', () => {
        assert.match(EstagioDomain.validar(), /nível de ensino/);
    });

    test('campos obrigatórios do termo de compromisso', () => {
        assert.match(erro({ nivel: '' }), /nível de ensino/);
        assert.match(erro({ obrigatorio: null }), /obrigatório ou não/);
        assert.match(erro({ instituicao: '   ' }), /instituição de ensino/);
        assert.match(erro({ instituicao: undefined }), /instituição de ensino/);
        assert.match(erro({ admissionDate: '' }), /início do estágio/);
        assert.match(erro({ fim: '' }), /término prevista/);
        assert.match(erro({ fim: '2026-03-01' }), /igual ou posterior ao início/);
    });

    test('limite de 2 anos, exceto pessoa com deficiência (art. 11)', () => {
        assert.match(erro({ fim: '2028-03-10' }), /2 anos/);
        assert.equal(erro({ fim: '2028-03-09' }), null);
        assert.equal(erro({ fim: '2029-03-10', pcd: true }), null);
    });

    test('idade mínima de 16 anos no início', () => {
        assert.match(erro({ birthDate: '2010-03-11' }), /16 anos/);
        assert.equal(erro({ birthDate: '2010-03-10' }), null);
    });

    test('carga horária por nível (art. 10)', () => {
        assert.match(erro({ nivel: 'especial', alternancia: true, workLoad: '20h' }), /alternam teoria e prática/);
        assert.match(erro({ workLoad: '44h' }), /20h, 30h ou 40h/);
        assert.match(erro({ workLoad: '12x36' }), /20h, 30h ou 40h/);
        assert.match(erro({ nivel: 'fundamental_eja', workLoad: '30h' }), /4h por dia e 20h/);
        assert.equal(erro({ nivel: 'especial', workLoad: '20h' }), null);
        assert.match(erro({ workLoad: '40h' }), /6h por dia e 30h/);
    });

    test('supervisor (art. 9º, III)', () => {
        assert.match(erro({ supervisorId: '' }), /supervisor/);
        assert.match(erro({ supervisorId: 'e1' }), /próprio supervisor/);
    });

    test('bolsa e auxílio-transporte no não obrigatório (art. 12)', () => {
        assert.match(erro({ salary: 0 }), /bolsa é obrigatória/);
        assert.match(erro({ salary: 'abc' }), /bolsa é obrigatória/);
        assert.match(erro({ valeTransporte: false }), /auxílio-transporte/);
    });

    test('períodos de provas mal formados', () => {
        assert.match(erro({ avaliacoes: [{ inicio: '2026-06-05', fim: '2026-06-01' }] }), /período de provas/);
        assert.match(erro({ avaliacoes: [{ inicio: '2026-06-05' }] }), /período de provas/);
        assert.match(erro({ avaliacoes: [null] }), /período de provas/);
    });
});
