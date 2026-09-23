const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { createMockSupabase } = require('../test-support/mock-supabase');

let desempenho;

before(() => {
    global.window = global;
    global.document = { addEventListener: () => {}, getElementById: () => null };
    desempenho = require('../src/javascript/desempenho-colaborador.js');
});

describe('buildCareerTrackGroups', () => {
    const catalogo = [
        { title: 'Analista Sênior', level: 'Sênior', track: null },
        { title: 'Analista Júnior', level: 'Júnior', track: null },
        { title: 'Analista Pleno', level: 'Pleno', track: null },
        { title: 'Diretor de Tecnologia', level: 'Diretoria', track: 'Tecnologia' },
        { title: 'Gerente de Tecnologia', level: 'Gerência', track: 'Tecnologia' },
    ];

    test('agrupa por trilha; quem não tem trilha definida fica num grupo sem nome', () => {
        const groups = desempenho.buildCareerTrackGroups(catalogo, null);
        const byTrack = Object.fromEntries(groups.map((g) => [g.track, g.rows.length]));
        assert.deepEqual(byTrack, { '': 3, Tecnologia: 2 });
    });

    test('dentro de cada trilha, ordena por senioridade (não alfabético)', () => {
        const groups = desempenho.buildCareerTrackGroups(catalogo, null);
        const geral = groups.find((g) => g.track === '');
        assert.deepEqual(
            geral.rows.map((r) => r.title),
            ['Analista Júnior', 'Analista Pleno', 'Analista Sênior']
        );
    });

    test('nível fora da lista conhecida vai para o final do grupo, em ordem alfabética', () => {
        const comNivelCustom = [...catalogo, { title: 'Consultor Externo', level: 'Consultoria', track: null }];
        const groups = desempenho.buildCareerTrackGroups(comNivelCustom, null);
        const geral = groups.find((g) => g.track === '');
        assert.deepEqual(
            geral.rows.map((r) => r.title),
            ['Analista Júnior', 'Analista Pleno', 'Analista Sênior', 'Consultor Externo']
        );
    });

    test('marca isCurrent só na linha cujo título bate com o cargo do colaborador', () => {
        const groups = desempenho.buildCareerTrackGroups(catalogo, 'Analista Pleno');
        const flat = groups.flatMap((g) => g.rows);
        assert.deepEqual(
            flat.filter((r) => r.isCurrent).map((r) => r.title),
            ['Analista Pleno']
        );
    });

    test('sem cargo do colaborador (null/undefined), nenhuma linha fica marcada', () => {
        const groups = desempenho.buildCareerTrackGroups(catalogo, null);
        assert.equal(
            groups.flatMap((g) => g.rows).some((r) => r.isCurrent),
            false
        );
    });

    test('cargo do colaborador que não existe no catálogo não marca nada (e não quebra)', () => {
        const groups = desempenho.buildCareerTrackGroups(catalogo, 'Cargo Que Não Existe');
        assert.equal(
            groups.flatMap((g) => g.rows).some((r) => r.isCurrent),
            false
        );
    });

    test('catálogo vazio devolve lista de grupos vazia', () => {
        assert.deepEqual(desempenho.buildCareerTrackGroups([], 'Analista Pleno'), []);
    });
});

describe('loadCareerTrack', () => {
    test('busca o catálogo público via RPC job_titles_public', async () => {
        global.sb = createMockSupabase({});
        global.sb.rpc = async (name) => {
            assert.equal(name, 'job_titles_public');
            return { data: [{ id: 't1', title: 'Analista Pleno', track: null, level: 'Pleno' }] };
        };
        await desempenho.loadCareerTrack();
        const { jobTitlesPublic } = desempenho.__getStateForTest();
        assert.deepEqual(jobTitlesPublic, [{ id: 't1', title: 'Analista Pleno', track: null, level: 'Pleno' }]);
    });

    test('RPC sem dado (erro/RLS) não quebra — vira lista vazia', async () => {
        global.sb = createMockSupabase({});
        global.sb.rpc = async () => ({ data: null });
        await desempenho.loadCareerTrack();
        const { jobTitlesPublic } = desempenho.__getStateForTest();
        assert.deepEqual(jobTitlesPublic, []);
    });
});
