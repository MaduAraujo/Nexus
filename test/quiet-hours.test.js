const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let isBusinessHours, nextBusinessHourStart, janelaDoColaborador, separarPorExpediente;

before(async () => {
    ({ isBusinessHours, nextBusinessHourStart, janelaDoColaborador, separarPorExpediente } = await import('../supabase/functions/_shared/quiet-hours.mjs'));
});

describe('isBusinessHours (padrão 8h–18h, sem configuração)', () => {
    test('segunda-feira 10h SP está dentro do horário', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T13:00:00Z')), true);
    });

    test('segunda-feira antes das 8h SP está fora', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T10:00:00Z')), false);
    });

    test('segunda-feira exatamente às 8h SP já conta como dentro (limite inclusivo)', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T11:00:00Z')), true);
    });

    test('segunda-feira às 18h SP já conta como fora (limite exclusivo)', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T21:00:00Z')), false);
    });

    test('sábado e domingo estão sempre fora, mesmo em horário comercial', () => {
        assert.equal(isBusinessHours(new Date('2026-06-13T13:00:00Z')), false);
        assert.equal(isBusinessHours(new Date('2026-06-14T13:00:00Z')), false);
    });

    test('sexta-feira 17h59 SP ainda está dentro', () => {
        assert.equal(isBusinessHours(new Date('2026-06-12T20:59:00Z')), true);
    });
});

describe('isBusinessHours com configuração customizada', () => {
    test('respeita startHour/endHour passados, ignorando o padrão 8–18', () => {
        const segundaMeioDiaSP = new Date('2026-06-08T15:00:00Z');
        assert.equal(isBusinessHours(segundaMeioDiaSP, { startHour: 9, endHour: 12 }), false);
        assert.equal(isBusinessHours(segundaMeioDiaSP, { startHour: 9, endHour: 13 }), true);
    });
});

describe('nextBusinessHourStart', () => {
    test('de sábado, pula para a segunda-feira às 8h SP', () => {
        const sabado = new Date('2026-06-13T13:00:00Z');
        const next = nextBusinessHourStart(sabado);
        assert.equal(next.toISOString(), '2026-06-15T11:00:00.000Z');
    });

    test('de domingo, também pula para a segunda-feira às 8h SP', () => {
        const domingo = new Date('2026-06-14T13:00:00Z');
        const next = nextBusinessHourStart(domingo);
        assert.equal(next.toISOString(), '2026-06-15T11:00:00.000Z');
    });

    test('de uma madrugada de dia útil (antes das 8h), o próximo horário é no mesmo dia', () => {
        const segundaCedo = new Date('2026-06-08T05:00:00Z');
        const next = nextBusinessHourStart(segundaCedo);
        assert.equal(next.toISOString(), '2026-06-08T11:00:00.000Z');
    });

    test('de uma noite de dia útil (depois das 18h), o próximo horário é no dia seguinte', () => {
        const segundaNoite = new Date('2026-06-08T23:00:00Z');
        const next = nextBusinessHourStart(segundaNoite);
        assert.equal(next.toISOString(), '2026-06-09T11:00:00.000Z');
    });

    test('de uma sexta-feira à noite, pula o fim de semana inteiro para a segunda', () => {
        const sextaNoite = new Date('2026-06-12T23:00:00Z');
        const next = nextBusinessHourStart(sextaNoite);
        assert.equal(next.toISOString(), '2026-06-15T11:00:00.000Z');
    });

    test('resultado de nextBusinessHourStart sempre passa em isBusinessHours', () => {
        for (const iso of ['2026-06-13T13:00:00Z', '2026-06-14T13:00:00Z', '2026-06-12T23:00:00Z', '2026-06-08T05:00:00Z']) {
            const next = nextBusinessHourStart(new Date(iso));
            assert.equal(isBusinessHours(next), true, `${iso} -> ${next.toISOString()} deveria estar em horário comercial`);
        }
    });
});

describe('expediente que vira a noite (ex.: 22h às 6h)', () => {
    const noturno = { startHour: 22, endHour: 6 };

    test('dentro: segunda 23h, terça 3h e a madrugada de sábado que continua o turno de sexta', () => {
        assert.equal(isBusinessHours(new Date('2026-06-09T02:00:00Z'), noturno), true);
        assert.equal(isBusinessHours(new Date('2026-06-09T06:00:00Z'), noturno), true);
        assert.equal(isBusinessHours(new Date('2026-06-13T06:00:00Z'), noturno), true);
    });

    test('fora: segunda 3h (o turno de domingo não existe), segunda 10h e sábado 23h', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T06:00:00Z'), noturno), false);
        assert.equal(isBusinessHours(new Date('2026-06-08T13:00:00Z'), noturno), false);
        assert.equal(isBusinessHours(new Date('2026-06-14T02:00:00Z'), noturno), false);
    });

    test('o próximo início é às 22h do próximo dia útil', () => {
        assert.equal(nextBusinessHourStart(new Date('2026-06-13T13:00:00Z'), noturno).toISOString(), '2026-06-16T01:00:00.000Z');
    });

    test('início igual ao fim nunca está no expediente', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T13:00:00Z'), { startHour: 9, endHour: 9 }), false);
    });
});

describe('janelaDoColaborador: colaborador, depois convenção, depois empresa', () => {
    const empresa = { startHour: 8, endHour: 18 };
    const UTEIS = [1, 2, 3, 4, 5];

    test('o horário e os dias do próprio colaborador vencem os da convenção', () => {
        assert.deepEqual(
            janelaDoColaborador(
                { expediente_inicio: 14, expediente_fim: 22, expediente_dias: [2, 3, 4, 5, 6] },
                { expediente_inicio: 6, expediente_fim: 14, expediente_dias: [1, 2, 3] },
                empresa
            ),
            { startHour: 14, endHour: 22, dias: [2, 3, 4, 5, 6], escala12x36: null }
        );
    });

    test('sem horário nem dias próprios valem os da convenção; a escala 12x36 é só do colaborador', () => {
        assert.deepEqual(
            janelaDoColaborador(
                { expediente_inicio: null, expediente_fim: null, expediente_dias: null, escala_12x36_inicio: '2026-06-01' },
                { expediente_inicio: 6, expediente_fim: 14, expediente_dias: [0, 6] },
                empresa
            ),
            { startHour: 6, endHour: 14, dias: [0, 6], escala12x36: '2026-06-01' }
        );
    });

    test('horário incompleto, dias vazios ou inválidos caem no padrão da empresa (segunda a sexta)', () => {
        assert.deepEqual(
            janelaDoColaborador(
                { expediente_inicio: 9, expediente_fim: null, expediente_dias: [] },
                { expediente_inicio: 7, expediente_fim: 7, expediente_dias: [9] },
                empresa
            ),
            { ...empresa, dias: UTEIS, escala12x36: null }
        );
        assert.deepEqual(janelaDoColaborador(undefined, undefined), { startHour: 8, endHour: 18, dias: UTEIS, escala12x36: null });
    });
});

describe('dias de trabalho próprios e escala 12x36', () => {
    test('quem trabalha de terça a sábado recebe no sábado e não na segunda', () => {
        const janela = { startHour: 8, endHour: 18, dias: [2, 3, 4, 5, 6] };
        assert.equal(isBusinessHours(new Date('2026-06-13T13:00:00Z'), janela), true);
        assert.equal(isBusinessHours(new Date('2026-06-08T13:00:00Z'), janela), false);
        assert.equal(nextBusinessHourStart(new Date('2026-06-14T13:00:00Z'), janela).toISOString(), '2026-06-16T11:00:00.000Z');
    });

    test('12x36 diurno: trabalha um dia sim, um dia não a partir do plantão de referência, inclusive no fim de semana', () => {
        const janela = { startHour: 7, endHour: 19, escala12x36: '2026-06-12' };
        assert.equal(isBusinessHours(new Date('2026-06-12T13:00:00Z'), janela), true);
        assert.equal(isBusinessHours(new Date('2026-06-13T13:00:00Z'), janela), false);
        assert.equal(isBusinessHours(new Date('2026-06-14T13:00:00Z'), janela), true);
        assert.equal(isBusinessHours(new Date('2026-06-10T13:00:00Z'), janela), true, 'dias antes da referência também alternam');
        assert.equal(nextBusinessHourStart(new Date('2026-06-12T23:00:00Z'), janela).toISOString(), '2026-06-14T10:00:00.000Z');
    });

    test('12x36 noturno: a madrugada seguinte ao plantão ainda é expediente; a outra não', () => {
        const janela = { startHour: 19, endHour: 7, escala12x36: '2026-06-12' };
        assert.equal(isBusinessHours(new Date('2026-06-13T06:00:00Z'), janela), true);
        assert.equal(isBusinessHours(new Date('2026-06-14T06:00:00Z'), janela), false);
    });

    test('data de referência inválida volta para os dias da semana', () => {
        assert.equal(isBusinessHours(new Date('2026-06-13T13:00:00Z'), { escala12x36: 'xx' }), false);
    });

    test('lista de dias sem nenhum dia válido não trava a busca do próximo expediente', () => {
        const r = nextBusinessHourStart(new Date('2026-06-08T13:00:00Z'), { startHour: 8, dias: [] });
        assert.ok(r instanceof Date);
    });
});

describe('separarPorExpediente', () => {
    test('separa quem está no expediente e devolve o próximo início mais cedo entre os demais', () => {
        const quartaDezHoras = new Date('2026-06-10T13:00:00Z');
        const r = separarPorExpediente(
            [
                { id: 'padrao' },
                { id: 'tarde', expediente_inicio: 14, expediente_fim: 22 },
                { id: 'cct', convencao_coletiva_id: 'c1' },
                { id: 'noite', expediente_inicio: 22, expediente_fim: 6 },
            ],
            [{ id: 'c1', expediente_inicio: 12, expediente_fim: 20 }],
            quartaDezHoras,
            { startHour: 8, endHour: 18 }
        );
        assert.deepEqual(r.dentro, ['padrao']);
        assert.deepEqual(r.fora, ['tarde', 'cct', 'noite']);
        assert.equal(r.proximo.toISOString(), '2026-06-10T15:00:00.000Z');
    });

    test('lista vazia ou nula: ninguém dentro, ninguém fora', () => {
        assert.deepEqual(separarPorExpediente(null, null, new Date()), { dentro: [], fora: [], proximo: null });
    });
});
