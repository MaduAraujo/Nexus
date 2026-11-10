const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let validadeCertificado, validadeCertificadoHtml;

before(() => {
    global.window = global;
    require('../src/javascript/shared/html.js');
    ({ validadeCertificado, validadeCertificadoHtml } = require('../src/javascript/shared/datas.js'));
});

describe('validadeCertificado', () => {
    test('sem data de validade não mostra nada', () => {
        assert.equal(validadeCertificado(null, '2026-11-10'), null);
        assert.equal(validadeCertificadoHtml('', '2026-11-10'), null);
    });

    test('vencido, vence hoje, vence amanhã, vence em poucos dias e válido', () => {
        assert.deepEqual(validadeCertificado('2026-11-09', '2026-11-10'), { estado: 'vencido', texto: 'Certificado vencido em 09/11/2026' });
        assert.deepEqual(validadeCertificado('2026-11-10', '2026-11-10'), { estado: 'vencendo', texto: 'Certificado vence hoje (10/11/2026)' });
        assert.deepEqual(validadeCertificado('2026-11-11', '2026-11-10'), { estado: 'vencendo', texto: 'Certificado vence em 1 dia (11/11/2026)' });
        assert.deepEqual(validadeCertificado('2026-12-10', '2026-11-10'), { estado: 'vencendo', texto: 'Certificado vence em 30 dias (10/12/2026)' });
        assert.deepEqual(validadeCertificado('2026-12-11', '2026-11-10'), { estado: 'valido', texto: 'Certificado válido até 11/12/2026' });
    });

    test('sem a data de hoje, usa o dia local', (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T15:00:00Z') });
        assert.equal(validadeCertificado('2026-11-09').estado, 'vencido');
    });

    test('a versão em HTML marca o estado na classe', () => {
        assert.equal(
            validadeCertificadoHtml('2026-11-09', '2026-11-10'),
            '<span class="training-validade training-validade--vencido">Certificado vencido em 09/11/2026</span>'
        );
    });
});
