const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

const { CLTDomain } = require('../src/javascript/domain/clt-domain.js');

const valido = {
    birthDate: '2008-05-10',
    admissionDate: '2026-02-02',
    contractEndDate: '2028-02-01',
    workLoad: '30h',
    salary: 1200,
    salarioMinimo: 1621,
};

describe('aprendiz: identificação, FGTS e hora extra', () => {
    test('isAprendiz aceita qualquer grafia de caixa', () => {
        assert.equal(CLTDomain.isAprendiz('Aprendiz'), true);
        assert.equal(CLTDomain.isAprendiz('aprendiz'), true);
        assert.equal(CLTDomain.isAprendiz('CLT'), false);
        assert.equal(CLTDomain.isAprendiz(undefined), false);
    });

    test('FGTS: 2% para aprendiz (Lei 8.036 art. 15 §7º), 8% para os demais CLT, nada para estágio e PJ', () => {
        assert.equal(CLTDomain.aliquotaFGTS('Aprendiz'), 0.02);
        assert.equal(CLTDomain.aliquotaFGTS('CLT'), 0.08);
        assert.equal(CLTDomain.aliquotaFGTS(undefined), 0.08);
        assert.equal(CLTDomain.aliquotaFGTS('Temporário'), 0.08);
        assert.equal(CLTDomain.aliquotaFGTS('Estágio'), 0);
        assert.equal(CLTDomain.aliquotaFGTS('PJ'), 0);
    });

    test('aprendiz não pode fazer hora extra: só a tolerância de 10 min do art. 58 §1º (CLT art. 432)', () => {
        assert.equal(CLTDomain.limiteExtraDiarioMin('Aprendiz', 120), 10);
        assert.equal(CLTDomain.limiteExtraDiarioMin('CLT', 90), 90);
        assert.equal(CLTDomain.limiteExtraDiarioMin('CLT'), CLTDomain.LIMITE_EXTRA_DIARIO_MIN_PADRAO);
    });
});

describe('cota de aprendizes (CLT art. 429)', () => {
    test('abaixo de 7 empregados na base não há cota obrigatória', () => {
        assert.deepEqual(CLTDomain.cotaAprendiz(6), { obrigatoria: false, minimo: 0, maximo: 0 });
        assert.deepEqual(CLTDomain.cotaAprendiz(undefined), { obrigatoria: false, minimo: 0, maximo: 0 });
        assert.deepEqual(CLTDomain.cotaAprendiz(-3), { obrigatoria: false, minimo: 0, maximo: 0 });
    });

    test('mínimo de 5% arredondado para cima e máximo de 15% para baixo', () => {
        assert.deepEqual(CLTDomain.cotaAprendiz(7), { obrigatoria: true, minimo: 1, maximo: 1 });
        assert.deepEqual(CLTDomain.cotaAprendiz(20), { obrigatoria: true, minimo: 1, maximo: 3 });
        assert.deepEqual(CLTDomain.cotaAprendiz(21), { obrigatoria: true, minimo: 2, maximo: 3 });
        assert.deepEqual(CLTDomain.cotaAprendiz(100), { obrigatoria: true, minimo: 5, maximo: 15 });
    });
});

describe('idade e datas', () => {
    test('idadeEm considera se o aniversário já passou', () => {
        assert.equal(CLTDomain.idadeEm('2008-05-10', '2026-05-09'), 17);
        assert.equal(CLTDomain.idadeEm('2008-05-10', '2026-05-10'), 18);
        assert.equal(CLTDomain.idadeEm('2008-05-10', '2026-04-30'), 17);
        assert.equal(CLTDomain.idadeEm('2008-05-10T00:00:00', '2026-06-01'), 18);
    });

    test('idadeEm sem data retorna null', () => {
        assert.equal(CLTDomain.idadeEm(null, '2026-01-01'), null);
        assert.equal(CLTDomain.idadeEm('2008-01-01', ''), null);
        assert.equal(CLTDomain.idadeEm('x', '2026-01-01'), null);
    });

    test('somaAnosISO trata 29 de fevereiro', () => {
        assert.equal(CLTDomain.somaAnosISO('2026-02-02', 2), '2028-02-02');
        assert.equal(CLTDomain.somaAnosISO('2028-02-29', 1), '2029-02-28');
    });

    test('salário mínimo hora proporcional à jornada', () => {
        assert.equal(CLTDomain.salarioMinimoAprendiz({ salarioMinimo: 1621, workLoad: '30h' }), +((1621 / 220) * 150).toFixed(2));
        assert.equal(CLTDomain.salarioMinimoAprendiz({ salarioMinimo: 1621, workLoad: '20h' }), +((1621 / 220) * 100).toFixed(2));
    });
});

describe('validarAprendiz (CLT arts. 428 a 433)', () => {
    test('cadastro dentro da lei não tem erros', () => {
        assert.deepEqual(CLTDomain.validarAprendiz(valido), []);
        assert.deepEqual(CLTDomain.validarAprendiz({ ...valido, workLoad: '40h', fundamentalCompleto: true, salary: 1500 }), []);
    });

    test('sem argumentos acusa nascimento e término ausentes', () => {
        const erros = CLTDomain.validarAprendiz();
        assert.ok(erros.some((e) => /data de nascimento/.test(e)));
        assert.ok(erros.some((e) => /data de término/.test(e)));
    });

    test('menor de 14 anos na admissão', () => {
        assert.match(CLTDomain.validarAprendiz({ ...valido, birthDate: '2012-03-01' }).join(), /pelo menos 14 anos/);
    });

    test('24 anos ou mais na admissão, salvo PcD', () => {
        const dados = { ...valido, birthDate: '2001-01-01', contractEndDate: '2027-01-01' };
        assert.match(CLTDomain.validarAprendiz(dados).join(), /menos de 24 anos/);
        assert.deepEqual(CLTDomain.validarAprendiz({ ...dados, pcd: true }), []);
    });

    test('término antes ou igual à admissão', () => {
        assert.match(CLTDomain.validarAprendiz({ ...valido, contractEndDate: '2026-02-02' }).join(), /depois da admissão/);
    });

    test('contrato acima de 2 anos, salvo PcD', () => {
        const dados = { ...valido, contractEndDate: '2028-02-03' };
        assert.match(CLTDomain.validarAprendiz(dados).join(), /não pode passar de 2 anos/);
        assert.deepEqual(CLTDomain.validarAprendiz({ ...dados, pcd: true }), []);
    });

    test('contrato que termina depois dos 24 anos', () => {
        const dados = { ...valido, birthDate: '2003-06-01', contractEndDate: '2027-06-01' };
        assert.match(CLTDomain.validarAprendiz(dados).join(), /completar 24 anos/);
        assert.deepEqual(CLTDomain.validarAprendiz({ ...dados, pcd: true }), []);
        assert.deepEqual(CLTDomain.validarAprendiz({ ...dados, contractEndDate: '2027-05-31' }), []);
    });

    test('sem admissão não compara prazos', () => {
        assert.deepEqual(CLTDomain.validarAprendiz({ ...valido, admissionDate: '' }), []);
    });

    test('jornada acima de 6h sem fundamental completo', () => {
        assert.match(CLTDomain.validarAprendiz({ ...valido, workLoad: '40h', salary: 1500 }).join(), /não pode passar de 6 horas/);
    });

    test('jornada acima de 8h mesmo com fundamental completo, e escala 12x36', () => {
        assert.match(CLTDomain.validarAprendiz({ ...valido, workLoad: '44h', fundamentalCompleto: true, salary: 1700 }).join(), /não pode passar de 8 horas/);
        assert.match(CLTDomain.validarAprendiz({ ...valido, workLoad: '12x36', salary: 1700 }).join(), /6 horas/);
    });

    test('carga fora do padrão não é barrada pela jornada', () => {
        assert.deepEqual(CLTDomain.validarAprendiz({ ...valido, workLoad: '', salary: 1200 }), []);
    });

    test('salário abaixo do mínimo hora proporcional', () => {
        assert.match(CLTDomain.validarAprendiz({ ...valido, salary: 1000 }).join(), /salário mínimo hora proporcional à jornada \(R\$ 1105,23\)/);
    });

    test('sem salário mínimo de referência ou sem salário não confere o piso', () => {
        assert.deepEqual(CLTDomain.validarAprendiz({ ...valido, salary: 100, salarioMinimo: 0 }), []);
        assert.deepEqual(CLTDomain.validarAprendiz({ ...valido, salary: 0 }), []);
    });
});
