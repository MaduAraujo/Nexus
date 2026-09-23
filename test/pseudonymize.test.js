const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let createPseudonymizer, createSseUnmaskStream, pseudonymizeRows, shapeSnapshot;

before(async () => {
    ({ createPseudonymizer, createSseUnmaskStream } = await import('../supabase/functions/_shared/pseudonymize.mjs'));
    ({ pseudonymizeRows, shapeSnapshot } = await import('../supabase/functions/_shared/ai-alerts-snapshot.mjs'));
});

const PEOPLE = [
    { id: 'e1', name: 'João Silva' },
    { id: 'e2', name: 'Ana Paula Souza' },
    { id: 'e3', name: 'Ana Lima' },
];

describe('createPseudonymizer — mask', () => {
    test('troca nome completo, ignorando acento, caixa e separador', () => {
        const ps = createPseudonymizer(PEOPLE);
        assert.equal(ps.mask('Como está o joao silva?'), 'Como está o [P1]?');
        assert.equal(ps.mask('JOÃO SILVA faltou'), '[P1] faltou');
        assert.equal(ps.mask('atestado_joao_silva.pdf'), 'atestado_[P1].pdf');
    });

    test('nome mais longo ganha do mais curto', () => {
        const ps = createPseudonymizer(PEOPLE);
        assert.equal(ps.mask('Ana Paula Souza e Ana Lima'), '[P2] e [P3]');
    });

    test('primeiro nome único é trocado; primeiro nome compartilhado não', () => {
        const ps = createPseudonymizer(PEOPLE);
        assert.equal(ps.mask('Como está o João?'), 'Como está o [P1]?');
        assert.equal(ps.mask('E a Ana?'), 'E a Ana?');
    });

    test('não troca pedaço de palavra', () => {
        const ps = createPseudonymizer([{ id: 'e1', name: 'Ana Costa' }]);
        assert.equal(ps.mask('Análise da Ana, banana'), 'Análise da [P1], banana');
    });

    test('homônimos ganham apelidos diferentes por id', () => {
        const ps = createPseudonymizer([
            { id: 'a', name: 'Carlos Dias' },
            { id: 'b', name: 'Carlos Dias' },
            { id: 'a', name: 'Carlos Dias' },
        ]);
        assert.equal(ps.aliasOf('a'), '[P1]');
        assert.equal(ps.aliasOf('b'), '[P2]');
    });

    test('maskDeep percorre objetos e arrays', () => {
        const ps = createPseudonymizer(PEOPLE);
        assert.deepEqual(ps.maskDeep({ a: ['João Silva', 3], b: { c: 'Ana Lima' } }), { a: ['[P1]', 3], b: { c: '[P3]' } });
    });
});

describe('createPseudonymizer — unmask', () => {
    test('volta os apelidos a nomes e deixa apelido desconhecido como está', () => {
        const ps = createPseudonymizer(PEOPLE);
        assert.equal(ps.unmask('[P1] e [P3]; [P9]'), 'João Silva e Ana Lima; [P9]');
    });

    test('jsonSafe escapa o nome para caber numa string JSON', () => {
        const ps = createPseudonymizer([{ id: 'x', name: 'Zé "Bigode" Neto' }]);
        const out = ps.unmask('{"employees":["[P1]"]}', { jsonSafe: true });
        assert.deepEqual(JSON.parse(out), { employees: ['Zé "Bigode" Neto'] });
    });
});

async function runSse(events, unmask) {
    const enc = new TextEncoder();
    const body = events.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    const bytes = enc.encode(body);
    const source = new ReadableStream({
        start(controller) {
            for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
            controller.close();
        },
    });
    const text = await new Response(source.pipeThrough(createSseUnmaskStream(unmask))).text();
    let content = '';
    let sawDone = false;
    for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') {
            sawDone = true;
            continue;
        }
        assert.equal(sawDone, false, 'conteúdo depois do [DONE]');
        content += JSON.parse(raw).choices?.[0]?.delta?.content ?? '';
    }
    return { content, sawDone };
}

describe('createSseUnmaskStream', () => {
    test('troca apelido partido entre eventos', async () => {
        const ps = createPseudonymizer(PEOPLE);
        const { content, sawDone } = await runSse(['Olá ', '[', 'P', '3', '] e [P', '1]!'], ps.unmask);
        assert.equal(content, 'Olá Ana Lima e João Silva!');
        assert.equal(sawDone, true);
    });

    test('colchete que não vira apelido é devolvido no fim', async () => {
        const ps = createPseudonymizer(PEOPLE);
        const { content } = await runSse(['nota [', 'x] e fim [P'], ps.unmask);
        assert.equal(content, 'nota [x] e fim [P');
    });
});

describe('pseudonymizeRows + shapeSnapshot', () => {
    test('nenhum nome real chega ao snapshot, inclusive em texto livre', () => {
        const { ps, rows } = pseudonymizeRows({
            employees: [
                { id: 'e1', name: 'João Silva', dept: 'TI', admission_date: '2020-01-01' },
                { id: 'e2', name: 'Ana Lima', dept: 'RH', admission_date: '2020-01-01' },
            ],
            pendingVacations: [
                {
                    id: 'v1',
                    employee_id: 'e2',
                    start_date: '2026-07-01',
                    end_date: '2026-07-10',
                    days: 10,
                    created_at: '2026-06-01',
                    employees: { name: 'Ana Lima' },
                },
            ],
            pendingAdjustments: [
                {
                    id: 'a1',
                    employee_id: 'e9',
                    date: '2026-06-10',
                    tipo: 'falta',
                    justificativa: 'Cobri o João',
                    created_at: '2026-06-10',
                    employees: { name: 'Pedro Alves' },
                },
            ],
            pendingDocs: [{ employee_id: 'e1', name: 'atestado_joao_silva.pdf', employees: { name: 'João Silva' } }],
            decisions: [{ action_type: 'approve_vacation', description: 'Férias de Ana Lima aprovadas', created_at: '2026-06-01' }],
        });
        const snap = ps.maskDeep(shapeSnapshot('2026-06-15', rows, new Date('2026-06-15T12:00:00Z').getTime()));
        const json = JSON.stringify(snap);
        for (const nome of ['João', 'Joao', 'joao', 'Ana', 'Silva', 'Lima', 'Pedro']) assert.ok(!json.includes(nome), `${nome} vazou: ${json}`);
        assert.equal(snap.pending_vacations[0].employee, ps.aliasOf('e2'));
        assert.equal(snap.pending_adjustments[0].employee, ps.aliasOf('e9'));
        assert.equal(snap.pending_adjustments[0].justification, `Cobri o ${ps.aliasOf('e1')}`);
        assert.equal(ps.unmask(snap.recent_decisions[0].description), 'Férias de Ana Lima aprovadas');
    });
});
