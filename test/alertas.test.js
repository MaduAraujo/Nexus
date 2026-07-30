const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
global.document = { addEventListener: () => {} };

const { buildAiDecisionLogRows, AI_DECISION_TARGET_TABLE } = require('../src/javascript/alertas.js');

describe('buildAiDecisionLogRows — log auditável de decisão da IA', () => {
    test('gera uma linha por registro afetado, com evidência e quem confirmou', () => {
        const rows = buildAiDecisionLogRows({
            type: 'approve_vacation',
            evidenceRows: [
                { id: 'v1', employee_id: 'e1', status: 'pendente', start_date: '2026-08-01', end_date: '2026-08-10', days: 10 },
                { id: 'v2', employee_id: 'e2', status: 'pendente', start_date: '2026-09-01', end_date: '2026-09-15', days: 15 },
            ],
            message: 'Aprovar as férias pendentes de e1 e e2',
            decidedByName: 'madu',
            decidedByEmail: 'madu@nexus.com',
        });

        assert.equal(rows.length, 2);
        assert.deepEqual(
            rows.map((r) => r.employee_id),
            ['e1', 'e2']
        );
        assert.equal(rows[0].target_table, 'vacations');
        assert.equal(rows[0].target_id, 'v1');
        assert.equal(rows[0].action_type, 'approve_vacation');
        assert.equal(rows[0].ai_message, 'Aprovar as férias pendentes de e1 e e2');
        assert.deepEqual(rows[0].evidence, {
            id: 'v1',
            employee_id: 'e1',
            status: 'pendente',
            start_date: '2026-08-01',
            end_date: '2026-08-10',
            days: 10,
        });
        assert.equal(rows[0].decided_by_name, 'madu');
        assert.equal(rows[0].decided_by_email, 'madu@nexus.com');
    });

    test('mapeia cada tipo de ação para a tabela-alvo correta', () => {
        assert.equal(AI_DECISION_TARGET_TABLE.approve_vacation, 'vacations');
        assert.equal(AI_DECISION_TARGET_TABLE.reject_vacation, 'vacations');
        assert.equal(AI_DECISION_TARGET_TABLE.approve_adjustment, 'adjustment_requests');
        assert.equal(AI_DECISION_TARGET_TABLE.reject_adjustment, 'adjustment_requests');
        assert.equal(AI_DECISION_TARGET_TABLE.mark_burnout_read, 'burnout_alerts');
    });

    test('não gera log para ação desconhecida (sem tabela-alvo mapeada)', () => {
        const rows = buildAiDecisionLogRows({
            type: 'algo_inexistente',
            evidenceRows: [{ id: 'x1', employee_id: 'e1' }],
            message: 'msg',
            decidedByName: 'madu',
            decidedByEmail: 'madu@nexus.com',
        });
        assert.deepEqual(rows, []);
    });

    test('não gera log quando não há evidência (nenhum registro encontrado)', () => {
        const rows = buildAiDecisionLogRows({
            type: 'mark_burnout_read',
            evidenceRows: [],
            message: 'msg',
            decidedByName: 'madu',
            decidedByEmail: 'madu@nexus.com',
        });
        assert.deepEqual(rows, []);
    });

    test('employee_id fica null quando o registro de evidência não tem employee_id', () => {
        const rows = buildAiDecisionLogRows({
            type: 'mark_burnout_read',
            evidenceRows: [{ id: 'b1' }],
            message: 'msg',
            decidedByName: 'madu',
            decidedByEmail: 'madu@nexus.com',
        });
        assert.equal(rows[0].employee_id, null);
    });
});
