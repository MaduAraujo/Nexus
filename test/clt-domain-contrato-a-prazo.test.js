const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

const { CLTDomain } = require('../src/javascript/domain/clt-domain.js');

const validar = (campos) => CLTDomain.validarContratoAPrazo(campos);

describe('tipos de contrato a prazo', () => {
    test('reconhece temporário com ou sem acento e prazo determinado', () => {
        assert.equal(CLTDomain.isTemporario('Temporário'), true);
        assert.equal(CLTDomain.isTemporario('temporario'), true);
        assert.equal(CLTDomain.isTemporario('CLT'), false);
        assert.equal(CLTDomain.isTemporario(undefined), false);
        assert.equal(CLTDomain.isPrazoDeterminado('Prazo determinado'), true);
        assert.equal(CLTDomain.isPrazoDeterminado('CLT'), false);
        assert.equal(CLTDomain.isPrazoDeterminado(null), false);
    });

    test('estágio, aprendiz, temporário e prazo determinado têm data de término; CLT e PJ não', () => {
        for (const t of ['Estágio', 'Aprendiz', 'Temporário', 'Prazo determinado']) assert.equal(CLTDomain.temTerminoContrato(t), true, t);
        for (const t of ['CLT', 'PJ', '']) assert.equal(CLTDomain.temTerminoContrato(t), false, t);
    });
});

describe('validarContratoAPrazo — temporário (Lei 6.019/1974)', () => {
    const base = { contractType: 'Temporário', admissionDate: '2026-01-01' };

    test('outros tipos de contrato não passam por esta regra', () => {
        assert.equal(validar({ contractType: 'CLT', isProbation: true }), null);
    });

    test('não admite contrato de experiência (art. 10 §4º)', () => {
        assert.match(validar({ ...base, contractEndDate: '2026-03-01', isProbation: true }), /art\. 10 §4º/);
    });

    test('exige a data de término', () => {
        assert.match(validar(base), /término do contrato temporário/);
    });

    test('até 270 dias contando a admissão passa; 271 é recusado (art. 10 §§1º e 2º)', () => {
        assert.equal(validar({ ...base, contractEndDate: '2026-09-27' }), null);
        assert.match(validar({ ...base, contractEndDate: '2026-09-28' }), /270 dias/);
    });

    test('término igual ou antes da admissão é recusado', () => {
        assert.match(validar({ ...base, contractEndDate: '2026-01-01' }), /depois da admissão/);
    });

    test('sem admissão só confere a presença do término', () => {
        assert.equal(validar({ contractType: 'Temporário', contractEndDate: '2026-03-01' }), null);
    });
});

describe('validarContratoAPrazo — prazo determinado (CLT art. 443)', () => {
    const base = { contractType: 'Prazo determinado', admissionDate: '2026-01-10' };

    test('experiência não se soma ao prazo determinado', () => {
        assert.match(validar({ ...base, contractEndDate: '2026-06-01', isProbation: true }), /art\. 443 §2º, c/);
    });

    test('exige a data de término', () => {
        assert.match(validar(base), /prazo determinado \(CLT art\. 443\)/);
    });

    test('até 2 anos passa; um dia a mais é recusado (art. 445)', () => {
        assert.equal(validar({ ...base, contractEndDate: '2028-01-10' }), null);
        assert.match(validar({ ...base, contractEndDate: '2028-01-11' }), /2 anos \(CLT art\. 445\)/);
    });
});
