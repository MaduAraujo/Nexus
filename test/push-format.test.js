const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// Lógica pura extraída das três Edge Functions de push (send-alert-push, send-document-push,
// send-push) para _shared/push-format.mjs, seguindo o mesmo padrão de files-core.mjs: título/corpo
// da notificação, filtro por preferência do colaborador e detecção de inscrição morta.
let pf;

before(async () => {
    pf = await import('../supabase/functions/_shared/push-format.mjs');
});

describe('securityAlertBody', () => {
    test('usa o texto específico de cada tipo de alerta conhecido', () => {
        assert.equal(pf.securityAlertBody('login_failures'), 'Várias tentativas de login falhas em uma conta.');
        assert.equal(pf.securityAlertBody('mass_export'), 'Volume incomum de exportações de dados.');
    });

    test('tipo desconhecido cai no texto genérico', () => {
        assert.equal(pf.securityAlertBody('algo_novo_nao_mapeado'), 'Comportamento incomum detectado.');
    });
});

describe('alertNotificationBody (compliance/burnout)', () => {
    test('sem alertas, usa o título padrão da categoria', () => {
        assert.equal(pf.alertNotificationBody([], 'Alerta de compliance'), 'Alerta de compliance');
        assert.equal(pf.alertNotificationBody(undefined, 'Alerta de compliance'), 'Alerta de compliance');
    });

    test('um único alerta usa o título dele, sem contagem', () => {
        assert.equal(pf.alertNotificationBody([{ titulo: 'Banco de horas negativo' }], 'Alerta de compliance'), 'Banco de horas negativo');
    });

    test('vários alertas: título do primeiro + quantos ficaram de fora', () => {
        assert.equal(
            pf.alertNotificationBody([{ titulo: 'Banco de horas negativo' }, { titulo: 'Férias vencendo' }, { titulo: 'Documento pendente' }], 'x'),
            'Banco de horas negativo (+2)'
        );
    });

    test('alerta sem título usa o título padrão da categoria', () => {
        assert.equal(pf.alertNotificationBody([{}], 'Alerta de compliance'), 'Alerta de compliance');
    });
});

describe('isStalePushError', () => {
    test('404 e 410 são inscrição morta', () => {
        assert.equal(pf.isStalePushError({ statusCode: 404 }), true);
        assert.equal(pf.isStalePushError({ statusCode: 410 }), true);
    });

    test('outros códigos (ex.: 500, 429) não são tratados como morta', () => {
        assert.equal(pf.isStalePushError({ statusCode: 500 }), false);
        assert.equal(pf.isStalePushError({ statusCode: 429 }), false);
    });

    test('erro sem statusCode (ex.: rede caiu) não é tratado como morta', () => {
        assert.equal(pf.isStalePushError(new Error('network')), false);
        assert.equal(pf.isStalePushError(null), false);
        assert.equal(pf.isStalePushError(undefined), false);
    });
});

describe('isValidDocumentIds', () => {
    const uuid1 = '11111111-1111-1111-1111-111111111111';
    const uuid2 = '22222222-2222-2222-2222-222222222222';

    test('aceita uma lista de UUIDs válidos dentro do limite', () => {
        assert.equal(pf.isValidDocumentIds([uuid1, uuid2], 50), true);
    });

    test('rejeita lista vazia', () => {
        assert.equal(pf.isValidDocumentIds([], 50), false);
    });

    test('rejeita quando passa do limite máximo', () => {
        assert.equal(pf.isValidDocumentIds([uuid1, uuid2], 1), false);
    });

    test('rejeita item que não é UUID', () => {
        assert.equal(pf.isValidDocumentIds([uuid1, 'nao-e-uuid'], 50), false);
        assert.equal(pf.isValidDocumentIds(['; DROP TABLE documents;'], 50), false);
    });

    test('rejeita entrada que não é array', () => {
        assert.equal(pf.isValidDocumentIds('not-an-array', 50), false);
        assert.equal(pf.isValidDocumentIds(null, 50), false);
        assert.equal(pf.isValidDocumentIds(undefined, 50), false);
    });
});

describe('groupDocumentsByEmployee / documentPushMessage', () => {
    test('agrupa por employee_id e conta quantos exigem assinatura', () => {
        const byEmployee = pf.groupDocumentsByEmployee([
            { employee_id: 'e1', tipo: 'Holerite', requer_assinatura: false },
            { employee_id: 'e1', tipo: 'Advertência', requer_assinatura: true },
            { employee_id: 'e2', tipo: 'Contrato', requer_assinatura: true },
        ]);
        assert.deepEqual(byEmployee.get('e1'), { tipos: ['Holerite', 'Advertência'], toSign: 1 });
        assert.deepEqual(byEmployee.get('e2'), { tipos: ['Contrato'], toSign: 1 });
    });

    test('um documento sem assinatura: título genérico, corpo é o próprio tipo', () => {
        const msg = pf.documentPushMessage({ tipos: ['Holerite'], toSign: 0 });
        assert.deepEqual(msg, { title: 'Novo documento do RH', body: 'Holerite' });
    });

    test('algum documento exige assinatura: título muda para "Documento para assinar"', () => {
        const msg = pf.documentPushMessage({ tipos: ['Advertência'], toSign: 1 });
        assert.equal(msg.title, 'Documento para assinar');
    });

    test('vários documentos: corpo lista até 3 tipos e usa reticências para o resto', () => {
        const msg = pf.documentPushMessage({ tipos: ['A', 'B', 'C', 'D', 'E'], toSign: 0 });
        assert.equal(msg.body, '5 documentos: A, B, C…');
    });

    test('exatamente 3 documentos: sem reticências', () => {
        const msg = pf.documentPushMessage({ tipos: ['A', 'B', 'C'], toSign: 0 });
        assert.equal(msg.body, '3 documentos: A, B, C');
    });
});

describe('filterEmployeeIdsByPref', () => {
    test('inclui quem não tem preferência definida (default é permitido)', () => {
        const ids = pf.filterEmployeeIdsByPref([{ id: 'e1', notif_prefs: null }, { id: 'e2' }], 'comunicados');
        assert.deepEqual(ids, ['e1', 'e2']);
    });

    test('exclui só quem desativou explicitamente (false)', () => {
        const ids = pf.filterEmployeeIdsByPref(
            [
                { id: 'e1', notif_prefs: { comunicados: false } },
                { id: 'e2', notif_prefs: { comunicados: true } },
                { id: 'e3', notif_prefs: { documentos: false } }, // outra categoria desativada não afeta
            ],
            'comunicados'
        );
        assert.deepEqual(ids, ['e2', 'e3']);
    });

    test('lista de colaboradores nula/indefinida não quebra', () => {
        assert.deepEqual(pf.filterEmployeeIdsByPref(null, 'comunicados'), []);
        assert.deepEqual(pf.filterEmployeeIdsByPref(undefined, 'comunicados'), []);
    });
});

describe('plainTextPreview', () => {
    test('remove tags HTML e colapsa espaços', () => {
        assert.equal(pf.plainTextPreview('<p>Olá <strong>mundo</strong></p>\n\n<p>  de novo  </p>'), 'Olá mundo de novo');
    });

    test('trunca em 140 caracteres por padrão, com reticências', () => {
        const longo = 'a'.repeat(200);
        const out = pf.plainTextPreview(longo);
        assert.equal(out.length, 141); // 140 + reticência
        assert.ok(out.endsWith('…'));
    });

    test('texto curto não é truncado nem ganha reticências', () => {
        assert.equal(pf.plainTextPreview('<p>curto</p>'), 'curto');
    });

    test('limite customizado via segundo parâmetro', () => {
        assert.equal(pf.plainTextPreview('abcdefghij', 5), 'abcde…');
    });

    test('entrada vazia/nula não quebra', () => {
        assert.equal(pf.plainTextPreview(''), '');
        assert.equal(pf.plainTextPreview(null), '');
        assert.equal(pf.plainTextPreview(undefined), '');
    });
});
