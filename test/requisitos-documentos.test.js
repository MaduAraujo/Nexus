const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

const { RequisitosDocumentos } = require('../src/javascript/domain/requisitos-documentos.js');

describe('normalizeContractType', () => {
    test('aceita variações de caixa e acento vindas do banco', () => {
        assert.equal(RequisitosDocumentos.normalizeContractType('clt'), 'CLT');
        assert.equal(RequisitosDocumentos.normalizeContractType('estagio'), 'Estágio');
        assert.equal(RequisitosDocumentos.normalizeContractType('Estágio'), 'Estágio');
        assert.equal(RequisitosDocumentos.normalizeContractType('aprendiz'), 'Aprendiz');
        assert.equal(RequisitosDocumentos.normalizeContractType('temporario'), 'Temporário');
        assert.equal(RequisitosDocumentos.normalizeContractType(' pj '), 'PJ');
    });

    test('valor vazio ou desconhecido cai em CLT', () => {
        assert.equal(RequisitosDocumentos.normalizeContractType(null), 'CLT');
        assert.equal(RequisitosDocumentos.normalizeContractType(undefined), 'CLT');
        assert.equal(RequisitosDocumentos.normalizeContractType(''), 'CLT');
        assert.equal(RequisitosDocumentos.normalizeContractType('outro'), 'CLT');
    });
});

describe('requiredTipos', () => {
    const reqs = [
        { category: 'admissional', tipo: 'RG', contract_type: 'CLT' },
        { category: 'admissional', tipo: 'Carteira de Trabalho', contract_type: 'CLT' },
        { category: 'admissional', tipo: 'RG', contract_type: 'Estágio' },
        { category: 'admissional', tipo: 'Termo de Compromisso de Estágio', contract_type: 'Estágio' },
        { category: 'demissional', tipo: 'Termo de Realização do Estágio', contract_type: 'Estágio' },
        { category: 'admissional', tipo: 'CPF' },
    ];

    test('filtra por categoria e tipo de contrato', () => {
        assert.deepEqual(RequisitosDocumentos.requiredTipos(reqs, 'admissional', 'Estágio'), ['RG', 'Termo de Compromisso de Estágio']);
        assert.deepEqual(RequisitosDocumentos.requiredTipos(reqs, 'demissional', 'estagio'), ['Termo de Realização do Estágio']);
    });

    test('estagiário não herda exigências de CLT', () => {
        assert.ok(!RequisitosDocumentos.requiredTipos(reqs, 'admissional', 'Estágio').includes('Carteira de Trabalho'));
    });

    test('linha sem contract_type vale para CLT', () => {
        assert.ok(RequisitosDocumentos.requiredTipos(reqs, 'admissional', 'CLT').includes('CPF'));
        assert.ok(!RequisitosDocumentos.requiredTipos(reqs, 'admissional', 'Estágio').includes('CPF'));
    });

    test('não duplica tipos e tolera lista vazia', () => {
        const dup = [
            { category: 'admissional', tipo: 'RG', contract_type: 'CLT' },
            { category: 'admissional', tipo: 'RG' },
        ];
        assert.deepEqual(RequisitosDocumentos.requiredTipos(dup, 'admissional', 'CLT'), ['RG']);
        assert.deepEqual(RequisitosDocumentos.requiredTipos(null, 'admissional', 'CLT'), []);
    });
});

describe('CONTRACT_TYPES', () => {
    test('cobre os tipos de contrato do cadastro de colaboradores, cada um com base legal', () => {
        const values = RequisitosDocumentos.CONTRACT_TYPES.map((t) => t.value);
        assert.deepEqual(values.sort(), ['Aprendiz', 'CLT', 'Estágio', 'PJ', 'Temporário']);
        RequisitosDocumentos.CONTRACT_TYPES.forEach((t) => assert.ok(t.base.length > 20));
    });
});
