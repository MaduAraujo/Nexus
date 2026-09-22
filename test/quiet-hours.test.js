const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// quiet-hours.mjs é o "direito à desconexão" do produto: fora do horário comercial (8h–18h, dias
// úteis, fuso de São Paulo por padrão) nenhum push é enviado na hora — fica agendado para o próximo
// início de expediente. Nunca tinha teste porque vivia em quiet-hours.ts, que lia Deno.env no
// carregamento do módulo; convertido para .mjs parametrizado (mesmo padrão de files-core.mjs) para
// poder rodar aqui.
let isBusinessHours, nextBusinessHourStart;

before(async () => {
    ({ isBusinessHours, nextBusinessHourStart } = await import('../supabase/functions/_shared/quiet-hours.mjs'));
});

// Datas em UTC com o comentário indicando o horário equivalente em São Paulo (UTC-3).
describe('isBusinessHours (padrão 8h–18h, sem configuração)', () => {
    test('segunda-feira 10h SP está dentro do horário', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T13:00:00Z')), true); // segunda
    });

    test('segunda-feira antes das 8h SP está fora', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T10:00:00Z')), false); // 07:00 SP
    });

    test('segunda-feira exatamente às 8h SP já conta como dentro (limite inclusivo)', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T11:00:00Z')), true); // 08:00 SP
    });

    test('segunda-feira às 18h SP já conta como fora (limite exclusivo)', () => {
        assert.equal(isBusinessHours(new Date('2026-06-08T21:00:00Z')), false); // 18:00 SP
    });

    test('sábado e domingo estão sempre fora, mesmo em horário comercial', () => {
        assert.equal(isBusinessHours(new Date('2026-06-13T13:00:00Z')), false); // sábado 10h SP
        assert.equal(isBusinessHours(new Date('2026-06-14T13:00:00Z')), false); // domingo 10h SP
    });

    test('sexta-feira 17h59 SP ainda está dentro', () => {
        assert.equal(isBusinessHours(new Date('2026-06-12T20:59:00Z')), true);
    });
});

describe('isBusinessHours com configuração customizada', () => {
    test('respeita startHour/endHour passados, ignorando o padrão 8–18', () => {
        const segundaMeioDiaSP = new Date('2026-06-08T15:00:00Z'); // 12h SP
        assert.equal(isBusinessHours(segundaMeioDiaSP, { startHour: 9, endHour: 12 }), false);
        assert.equal(isBusinessHours(segundaMeioDiaSP, { startHour: 9, endHour: 13 }), true);
    });
});

describe('nextBusinessHourStart', () => {
    test('de sábado, pula para a segunda-feira às 8h SP', () => {
        const sabado = new Date('2026-06-13T13:00:00Z');
        const next = nextBusinessHourStart(sabado);
        assert.equal(next.toISOString(), '2026-06-15T11:00:00.000Z'); // segunda 08:00 SP
    });

    test('de domingo, também pula para a segunda-feira às 8h SP', () => {
        const domingo = new Date('2026-06-14T13:00:00Z');
        const next = nextBusinessHourStart(domingo);
        assert.equal(next.toISOString(), '2026-06-15T11:00:00.000Z');
    });

    test('de uma madrugada de dia útil (antes das 8h), o próximo horário é no mesmo dia', () => {
        const segundaCedo = new Date('2026-06-08T05:00:00Z'); // 02:00 SP
        const next = nextBusinessHourStart(segundaCedo);
        assert.equal(next.toISOString(), '2026-06-08T11:00:00.000Z'); // mesmo dia, 08:00 SP
    });

    test('de uma noite de dia útil (depois das 18h), o próximo horário é no dia seguinte', () => {
        const segundaNoite = new Date('2026-06-08T23:00:00Z'); // 20:00 SP
        const next = nextBusinessHourStart(segundaNoite);
        assert.equal(next.toISOString(), '2026-06-09T11:00:00.000Z'); // terça 08:00 SP
    });

    test('de uma sexta-feira à noite, pula o fim de semana inteiro para a segunda', () => {
        const sextaNoite = new Date('2026-06-12T23:00:00Z'); // sexta 20:00 SP
        const next = nextBusinessHourStart(sextaNoite);
        assert.equal(next.toISOString(), '2026-06-15T11:00:00.000Z'); // segunda 08:00 SP
    });

    test('resultado de nextBusinessHourStart sempre passa em isBusinessHours', () => {
        for (const iso of ['2026-06-13T13:00:00Z', '2026-06-14T13:00:00Z', '2026-06-12T23:00:00Z', '2026-06-08T05:00:00Z']) {
            const next = nextBusinessHourStart(new Date(iso));
            assert.equal(isBusinessHours(next), true, `${iso} -> ${next.toISOString()} deveria estar em horário comercial`);
        }
    });
});
