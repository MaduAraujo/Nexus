const { test, describe, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

let NexusAvatar;
let chamadas;
let resposta;
const agoraReal = Date.now;

before(() => {
    global.window = {};
    NexusAvatar = require('../src/javascript/shared/avatar.js');
});

beforeEach(() => {
    chamadas = [];
    resposta = (paths) => ({
        data: paths.map((path) => ({ path, signedUrl: `https://x.supabase.co/storage/v1/object/sign/avatars/${path}?token=${chamadas.length}` })),
        error: null,
    });
    global.sb = {
        storage: {
            from: (bucket) => ({
                createSignedUrls: async (paths, validade) => {
                    chamadas.push({ bucket, paths, validade });
                    return resposta(paths);
                },
            }),
        },
    };
});

afterEach(() => {
    Date.now = agoraReal;
});

describe('NexusAvatar.caminho — o que é foto do bucket privado', () => {
    test('referência nova "avatars/<id>?v=..." vira o caminho do objeto', () => {
        assert.equal(NexusAvatar.caminho('avatars/emp-1?v=123'), 'emp-1');
    });

    test('URL pública antiga (gravada antes do bucket ficar privado) também é reconhecida', () => {
        assert.equal(NexusAvatar.caminho('https://x.supabase.co/storage/v1/object/public/avatars/emp%201?t=9'), 'emp 1');
    });

    test('outros endereços, vazio e referência sem caminho não são do bucket', () => {
        for (const v of ['https://cdn.test/a.png', 'data:image/png;base64,AA', '', null, undefined, 'avatars/', 'avatars/?v=1'])
            assert.equal(NexusAvatar.caminho(v), null, String(v));
    });

    test('referencia() grava o caminho com versão, para não reaproveitar a foto antiga', () => {
        Date.now = () => 1700;
        assert.equal(NexusAvatar.referencia('emp-1'), 'avatars/emp-1?v=1700');
    });
});

describe('NexusAvatar.url — links temporários', () => {
    test('pedidos da mesma renderização viram uma única chamada, com validade de 1 hora', async () => {
        const [a, b, a2] = await Promise.all([
            NexusAvatar.url('avatars/lote-a?v=1'),
            NexusAvatar.url('avatars/lote-b?v=1'),
            NexusAvatar.url('avatars/lote-a?v=1'),
        ]);
        assert.equal(chamadas.length, 1);
        assert.deepEqual(chamadas[0], { bucket: 'avatars', paths: ['lote-a', 'lote-b'], validade: 3600 });
        assert.match(a, /\/sign\/avatars\/lote-a\?token=/);
        assert.match(b, /\/sign\/avatars\/lote-b\?token=/);
        assert.equal(a2, a);
    });

    test('link ainda válido vem do cache; perto de vencer, assina de novo', async () => {
        const inicio = agoraReal();
        Date.now = () => inicio;
        const primeiro = await NexusAvatar.url('avatars/cache?v=1');
        Date.now = () => inicio + 30 * 60 * 1000;
        assert.equal(await NexusAvatar.url('avatars/cache?v=1'), primeiro);
        assert.equal(chamadas.length, 1);
        Date.now = () => inicio + 56 * 60 * 1000;
        const renovado = await NexusAvatar.url('avatars/cache?v=1');
        assert.equal(chamadas.length, 2);
        assert.notEqual(renovado, primeiro);
    });

    test('endereço que não é do bucket não chama o Storage', async () => {
        assert.equal(await NexusAvatar.url('https://cdn.test/a.png'), null);
        assert.equal(chamadas.length, 0);
    });

    test('erro do Storage, exceção ou objeto sem link resolvem como "sem foto" e não entram no cache', async () => {
        resposta = () => ({ data: null, error: { message: 'negado' } });
        assert.equal(await NexusAvatar.url('avatars/falha-1'), null);

        resposta = () => {
            throw new Error('rede');
        };
        assert.equal(await NexusAvatar.url('avatars/falha-2'), null);

        resposta = (paths) => ({ data: paths.map((path) => ({ path, signedUrl: null, error: 'Object not found' })), error: null });
        assert.equal(await NexusAvatar.url('avatars/falha-3'), null);

        resposta = () => ({ data: undefined, error: null });
        assert.equal(await NexusAvatar.url('avatars/falha-4'), null);

        resposta = (paths) => ({ data: paths.map((path) => ({ path, signedUrl: `https://ok/${path}` })), error: null });
        assert.equal(await NexusAvatar.url('avatars/falha-1'), 'https://ok/falha-1');
        assert.equal(chamadas.length, 5);
    });
});
