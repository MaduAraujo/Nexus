const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T15:00:00-03:00';

function client(emps) {
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            employees_decrypted: emps,
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
        }),
    });
}

const pessoas = (n, campos = {}) =>
    Array.from({ length: n }, (_, i) => ({ ...BIA, id: `${campos.contract_type || 'clt'}-${i}`, name: `P${i}`, status: 'Ativo', ...campos }));

describe('dashboard.html — cota de aprendizes (CLT art. 429)', () => {
    test('menos de 7 empregados na base: sem cota obrigatória', async () => {
        page = await openPage('dashboard', { client: client([...pessoas(6), ...pessoas(3, { contract_type: 'PJ' })]), now: NOW });
        assert.match(page.text('#equity-aprendiz-body'), /0.*base de 6 empregado.*Sem cota obrigatória/);
    });

    test('abaixo do mínimo, dentro da faixa e acima do máximo', async () => {
        const base = [...pessoas(20), ...pessoas(2, { contract_type: 'Estágio' }), ...pessoas(2, { contract_type: 'Temporário' })];
        page = await openPage('dashboard', { client: client(base), now: NOW });
        assert.match(page.text('#equity-aprendiz-body'), /base de 20 empregado.*de 1 a 3.*Não atende/);
        assert.ok(page.$('#equity-aprendiz-body .equity-stat--bad'));
        page.close();

        page = await openPage('dashboard', { client: client([...base, ...pessoas(2, { contract_type: 'Aprendiz' })]), now: NOW });
        assert.match(page.text('#equity-aprendiz-body'), /^2.*Atende/);
        assert.ok(page.$('#equity-aprendiz-body .equity-stat--good'));
        page.close();

        page = await openPage('dashboard', { client: client([...base, ...pessoas(4, { contract_type: 'aprendiz' })]), now: NOW });
        assert.match(page.text('#equity-aprendiz-body'), /Acima do máximo/);
        assert.ok(page.$('#equity-aprendiz-body .equity-stat--warn'));
    });

    test('aprendiz inativo não conta', async () => {
        page = await openPage('dashboard', {
            client: client([...pessoas(20), ...pessoas(2, { contract_type: 'Aprendiz', status: 'Inativo' })]),
            now: NOW,
        });
        assert.match(page.text('#equity-aprendiz-body'), /^0.*Não atende/);
    });
});
