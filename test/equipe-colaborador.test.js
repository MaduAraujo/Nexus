const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('../test-support/mock-supabase');

let equipe;

before(() => {
    global.window = global;
    global.document = { addEventListener: () => {}, getElementById: () => null };
    require('../src/javascript/domain/clt-domain.js');
    equipe = require('../src/javascript/equipe-colaborador.js');
});

beforeEach(() => {
    equipe.__setStateForTest({ myEmployeeId: 'gestor1', myEmployee: { id: 'gestor1', name: 'Gestora', email: 'g@nexus.test' } });
    global.document.getElementById = () => null;
});

describe('minToStrEquipe / saldoBadgeHtml', () => {
    test('minToStrEquipe formata em "Xh MMmin", sempre com sinal positivo (o sinal fica por fora)', () => {
        assert.equal(equipe.minToStrEquipe(-90), '1h 30min');
        assert.equal(equipe.minToStrEquipe(65), '1h 05min');
    });
});

describe('getInitials / escHtml / fmtBR', () => {
    test('getInitials pega a primeira letra dos dois primeiros nomes', () => {
        assert.equal(equipe.getInitials('Maria Eduarda Araujo'), 'ME');
        assert.equal(equipe.getInitials('Cauê'), 'C');
    });

    test('getInitials sem nome não quebra', () => {
        assert.equal(equipe.getInitials(''), '?');
        assert.equal(equipe.getInitials(undefined), '?');
    });

    test('escHtml neutraliza os quatro caracteres perigosos (não escapa aspas simples)', () => {
        assert.equal(equipe.escHtml(`<b>"x"</b>`), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    });

    test('fmtBR converte AAAA-MM-DD em DD/MM/AAAA e trata ausência', () => {
        assert.equal(equipe.fmtBR('2026-03-07'), '07/03/2026');
        assert.equal(equipe.fmtBR(null), '—');
        assert.equal(equipe.fmtBR(''), '—');
    });
});

describe('loadTeam', () => {
    test('sem subordinados: time vazio, não quebra', async () => {
        global.sb = createMockSupabase({ team_roster: [] });
        await equipe.loadTeam();
        const { teamMembers } = equipe.__getStateForTest();
        assert.deepEqual(teamMembers, []);
    });

    test('carrega só os subordinados diretos deste gestor, em ordem alfabética', async () => {
        global.sb = createMockSupabase({
            team_roster: [
                { id: 'e2', name: 'Beatriz', manager_id: 'gestor1', contract_type: 'clt' },
                { id: 'e1', name: 'André', manager_id: 'gestor1', contract_type: 'clt' },
                { id: 'e3', name: 'Carla', manager_id: 'outro-gestor', contract_type: 'clt' },
            ],
            vacations: [],
            time_records: [],
            bank_adjustments: [],
        });
        await equipe.loadTeam();
        const { teamMembers } = equipe.__getStateForTest();
        assert.deepEqual(
            teamMembers.map((m) => m.name),
            ['André', 'Beatriz']
        );
    });
});

describe('loadTeamBalances', () => {
    test('funcionário PJ não recebe saldo (fica null, não zero)', async () => {
        global.sb = createMockSupabase({
            team_roster: [{ id: 'e1', name: 'PJ Dev', manager_id: 'gestor1', contract_type: 'pj' }],
            vacations: [],
            time_records: [],
            bank_adjustments: [],
        });
        await equipe.loadTeam();
        const { teamBalances } = equipe.__getStateForTest();
        assert.equal(teamBalances.e1, null);
    });

    test('soma horas extras/faltantes do mês corrente com os ajustes manuais de banco de horas', async () => {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const day = `${monthKey}-05`;
        global.sb = createMockSupabase({
            team_roster: [{ id: 'e1', name: 'CLT 40h', manager_id: 'gestor1', contract_type: 'clt', work_load: '40h' }],
            vacations: [],
            time_records: [{ employee_id: 'e1', date: day, entrada: `${day}T08:00:00`, saida: `${day}T17:00:00` }],
            bank_adjustments: [
                { employee_id: 'e1', date: day, tipo: 'credito', minutos: 30, deleted_at: null },
                { employee_id: 'e1', date: day, tipo: 'debito', minutos: 10, deleted_at: null },
            ],
        });
        await equipe.loadTeam();
        const { teamBalances } = equipe.__getStateForTest();
        assert.equal(teamBalances.e1, 60 + 20);
    });
});

describe('loadPendingVacations', () => {
    test('só traz solicitações pendentes do próprio time', async () => {
        global.sb = createMockSupabase({
            team_roster: [{ id: 'e1', name: 'A', manager_id: 'gestor1', contract_type: 'clt' }],
            vacations: [
                { id: 'v1', employee_id: 'e1', status: 'pendente', created_at: '2026-06-01T00:00:00Z' },
                { id: 'v2', employee_id: 'e1', status: 'aprovado', created_at: '2026-06-01T00:00:00Z' },
                { id: 'v3', employee_id: 'outro', status: 'pendente', created_at: '2026-06-01T00:00:00Z' },
            ],
            time_records: [],
            bank_adjustments: [],
        });
        await equipe.loadTeam();
        const { pendingVacations } = equipe.__getStateForTest();
        assert.deepEqual(
            pendingVacations.map((v) => v.id),
            ['v1']
        );
    });
});

describe('approveVacation / confirmRejectVacation / confirmEscalateToRh', () => {
    test('aprovar: muda status no banco e tira da lista de pendentes local', async () => {
        global.sb = createMockSupabase({
            team_roster: [{ id: 'e1', name: 'A', manager_id: 'gestor1', contract_type: 'clt' }],
            vacations: [{ id: 'v1', employee_id: 'e1', status: 'pendente', created_at: '2026-06-01T00:00:00Z' }],
            time_records: [],
            bank_adjustments: [],
        });
        await equipe.loadTeam();
        await equipe.approveVacation('v1');

        const { pendingVacations } = equipe.__getStateForTest();
        assert.equal(pendingVacations.length, 0);
        const { data } = await global.sb.from('vacations').select('*').eq('id', 'v1');
        assert.equal(data[0].status, 'aprovado');
        assert.equal(data[0].decided_by_name, 'Gestora');
    });

    test('recusar sem motivo: não grava e mantém pendente', async () => {
        global.sb = createMockSupabase({
            team_roster: [{ id: 'e1', name: 'A', manager_id: 'gestor1', contract_type: 'clt' }],
            vacations: [{ id: 'v1', employee_id: 'e1', status: 'pendente', created_at: '2026-06-01T00:00:00Z' }],
            time_records: [],
            bank_adjustments: [],
        });
        await equipe.loadTeam();
        equipe.__setStateForTest({ rejectingId: 'v1' });
        const errEl = { textContent: '' };
        global.document.getElementById = (id) => (id === 'err-reject-reason' ? errEl : null);
        await equipe.confirmRejectVacation();

        const { pendingVacations } = equipe.__getStateForTest();
        assert.equal(pendingVacations.length, 1, 'sem motivo, a recusa não deveria ter sido confirmada');
        assert.match(errEl.textContent, /Informe o motivo/);
    });

    test('escalar ao RH: cria o ticket e a primeira mensagem com o texto do gestor', async () => {
        global.sb = createMockSupabase({
            team_roster: [{ id: 'e1', name: 'Colaborador X', manager_id: 'gestor1', contract_type: 'clt' }],
            vacations: [],
            time_records: [],
            bank_adjustments: [],
            hr_tickets: [],
            hr_ticket_messages: [],
        });
        await equipe.loadTeam();
        equipe.__setStateForTest({ escalatingId: 'e1' });
        global.document.getElementById = (id) => (id === 'escalate-message-text' ? { value: 'Precisa de atenção do RH.' } : null);
        await equipe.confirmEscalateToRh();

        const { data: tickets } = await global.sb.from('hr_tickets').select('*');
        assert.equal(tickets.length, 1);
        assert.match(tickets[0].subject, /Colaborador X/);
        const { data: messages } = await global.sb.from('hr_ticket_messages').select('*');
        assert.equal(messages.length, 1);
        assert.equal(messages[0].content, 'Precisa de atenção do RH.');
        global.document.getElementById = () => null;
    });
});

describe('bordas das funções auxiliares', () => {
    test('iniciais ignoram espaços repetidos; escHtml aceita vazio; saldo de quem não foi calculado fica em branco', () => {
        assert.equal(equipe.getInitials('Ana  Souza'), 'AS');
        assert.equal(equipe.escHtml(null), '');
        assert.equal(equipe.saldoBadgeHtml('ninguem'), '');
    });
});
