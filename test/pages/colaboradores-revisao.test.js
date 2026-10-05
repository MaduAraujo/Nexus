const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { RH_USER, ANA, BIA, CAIO, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const NOW = '2026-06-17T10:00:00-03:00';
const ESTAVEL = 'Colaborador com estabilidade até 31/12/2026: informe o tipo de rescisão (use a tela de Rescisão).';

function client() {
    const emps = [ANA, BIA, CAIO].map((e) => ({ ...e, created_at: '2024-01-01' }));
    return new FakeSupabase({
        user: RH_USER,
        tables: baseTables({
            employees: emps,
            employee_audit: [],
            employee_audit_decrypted: [],
            vacations: [],
            documents: [],
            document_requirements: [],
            job_titles: [],
            trainings: [],
            data_access_log: [],
            onboarding_tasks: [],
            convencoes_coletivas: [],
        }),
        rpc: { job_titles_public: [] },
        views: { employees_decrypted: 'employees' },
    });
}

describe('colaboradores.html — inativar quem tem estabilidade', () => {
    test('em lote: a mensagem do banco explica por que não inativou', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: true });
        c.errors['employees:update'] = { code: '23514', message: ESTAVEL };
        page.eval(`selectedIds.add('${ANA.id}')`);
        await page.window.bulkUpdateStatus('Inativo');
        assert.ok(page.toasts().some((t) => t.includes(ESTAVEL)));
    });

    test('pelo painel do colaborador: idem; outros erros seguem com a mensagem genérica', async () => {
        const c = client();
        page = await openPage('colaboradores', { client: c, now: NOW, confirm: true });
        page.window.openDrawer(ANA.id);
        c.errors['employees:update'] = { code: '23514', message: ESTAVEL };
        await page.window.updateStatus('Inativo');
        assert.ok(page.toasts().some((t) => t.includes(ESTAVEL)));
        c.errors['employees:update'] = { code: '500', message: 'x' };
        await page.window.updateStatus('Afastado');
        assert.ok(page.toasts().some((t) => /Não foi possível atualizar o status\./.test(t)));
        page.eval(`selectedIds.add('${BIA.id}')`);
        await page.window.bulkUpdateStatus('Afastado');
        assert.ok(page.toasts().some((t) => /Não foi possível atualizar o status em lote/.test(t)));
    });
});
