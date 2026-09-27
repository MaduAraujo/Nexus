process.env.TZ = 'America/Sao_Paulo';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const NOITE_BRASILIA = new Date('2026-09-27T01:30:00Z');

let documentos;

before(() => {
    global.window = global;
    global.document = { addEventListener: () => {}, getElementById: () => null };
    require('../src/javascript/shared/datas.js');
    require('../src/javascript/domain/requisitos-documentos.js');
    documentos = require('../src/javascript/documentos-colaborador.js');
});

describe('datas de negócio usam o dia de Brasília, não o de UTC (22h30 de 26/09)', () => {
    test('documento com guarda até hoje ainda está retido', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: NOITE_BRASILIA });
        assert.equal(documentos.isUnderRetention({ status: 'aprovado', retido_ate: '2026-09-26' }), true);
        assert.equal(documentos.isUnderRetention({ status: 'aprovado', retido_ate: '2026-09-25' }), false);
    });

    test('prazo de guarda conta a partir do dia local', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: NOITE_BRASILIA });
        assert.equal(documentos.computeRetentionDate('Contrato de Trabalho'), '2056-09-26');
        assert.equal(documentos.computeRetentionDate('RG'), '2031-09-26');
    });
});
