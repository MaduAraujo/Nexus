const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

global.window = global;

require('../src/javascript/domain/clt-domain.js');
const { BurnoutDomain } = require('../src/javascript/domain/burnout-domain.js');

describe('pontuarAlertasDia', () => {
    test('sem alertas no dia, pontuação zero', () => {
        assert.equal(BurnoutDomain.pontuarAlertasDia([]), 0);
        assert.equal(BurnoutDomain.pontuarAlertasDia(null), 0);
    });

    test('alerta crítico vale 2 pontos, atenção vale 1', () => {
        assert.equal(BurnoutDomain.pontuarAlertasDia([{ nivel: 'critico' }]), 2);
        assert.equal(BurnoutDomain.pontuarAlertasDia([{ nivel: 'atencao' }]), 1);
    });

    test('soma a pontuação de múltiplos alertas no mesmo dia', () => {
        assert.equal(BurnoutDomain.pontuarAlertasDia([{ nivel: 'critico' }, { nivel: 'atencao' }, { nivel: 'critico' }]), 5);
    });
});

describe('detectTrend', () => {
    test('sem linhas, não há tendência', () => {
        assert.deepEqual(BurnoutDomain.detectTrend([]), { piorando: false });
        assert.deepEqual(BurnoutDomain.detectTrend(null), { piorando: false });
    });

    test('menos semanas do que o mínimo exigido, não detecta tendência', () => {
        const rows = [
            { date: '2026-06-01', alertas: [{ nivel: 'atencao' }] },
            { date: '2026-06-08', alertas: [{ nivel: 'critico' }] },
        ];
        assert.deepEqual(BurnoutDomain.detectTrend(rows), { piorando: false });
    });

    test('pontuação semanal subindo por 3 semanas seguidas detecta piora', () => {
        const rows = [
            { date: '2026-06-01', alertas: [{ nivel: 'atencao' }] }, 
            { date: '2026-06-08', alertas: [{ nivel: 'critico' }] }, 
            { date: '2026-06-15', alertas: [{ nivel: 'critico' }, { nivel: 'atencao' }] }, 
        ];
        assert.deepEqual(BurnoutDomain.detectTrend(rows), { piorando: true, semanas: 3 });
    });

    test('pontuação estável (empatada) ao longo das semanas também conta como sequência de piora', () => {
        const rows = [
            { date: '2026-06-01', alertas: [{ nivel: 'atencao' }] }, 
            { date: '2026-06-08', alertas: [{ nivel: 'atencao' }] }, 
            { date: '2026-06-15', alertas: [{ nivel: 'critico' }] }, 
        ];
        assert.deepEqual(BurnoutDomain.detectTrend(rows), { piorando: true, semanas: 3 });
    });

    test('pontuação caindo na semana mais recente interrompe a sequência', () => {
        const rows = [
            { date: '2026-06-01', alertas: [{ nivel: 'critico' }] }, 
            { date: '2026-06-08', alertas: [{ nivel: 'critico' }, { nivel: 'critico' }] }, 
            { date: '2026-06-15', alertas: [{ nivel: 'atencao' }] }, 
        ];
        assert.deepEqual(BurnoutDomain.detectTrend(rows), { piorando: false });
    });

    test('sequência de semanas todas zeradas (sem alertas) não é considerada piora', () => {
        const rows = [
            { date: '2026-06-01', alertas: [] },
            { date: '2026-06-08', alertas: [] },
            { date: '2026-06-15', alertas: [] },
        ];
        assert.deepEqual(BurnoutDomain.detectTrend(rows), { piorando: false });
    });

    test('múltiplos registros na mesma semana são agrupados antes de comparar', () => {
        const rows = [
            { date: '2026-06-01', alertas: [{ nivel: 'atencao' }] }, 
            { date: '2026-06-08', alertas: [{ nivel: 'atencao' }] }, 
            { date: '2026-06-10', alertas: [{ nivel: 'atencao' }] }, 
            { date: '2026-06-15', alertas: [{ nivel: 'critico' }] }, 
        ];
        assert.deepEqual(BurnoutDomain.detectTrend(rows), { piorando: true, semanas: 3 });
    });
});