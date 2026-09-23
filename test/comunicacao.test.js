const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

let comunicacao;

before(() => {
    const dom = new JSDOM('<!doctype html><div></div>');
    global.window = dom.window;
    global.document = dom.window.document;
    global.DOMParser = dom.window.DOMParser;
    global.Node = dom.window.Node;
    require('../src/javascript/comunicado-format.js');
    global.comunicadoPlainText = dom.window.comunicadoPlainText;

    global.document = { addEventListener: () => {}, getElementById: () => null, querySelectorAll: () => [] };
    comunicacao = require('../src/javascript/comunicacao.js');
});

describe('escHTML / fmtDate / fmtDateTime', () => {
    test('escHTML neutraliza os quatro caracteres perigosos (não escapa aspas simples)', () => {
        assert.equal(comunicacao.escHTML(`<b>"x"</b>`), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    });

    test('fmtDate formata em pt-BR (dd/mm/aaaa)', () => {
        assert.equal(comunicacao.fmtDate('2026-03-07T10:00:00Z'), comunicacao.fmtDate(new Date('2026-03-07T10:00:00Z').toISOString()));
        assert.match(comunicacao.fmtDate('2026-03-07T10:00:00Z'), /^\d{2}\/\d{2}\/\d{4}$/);
    });

    test('fmtDateTime inclui data e hora', () => {
        assert.match(comunicacao.fmtDateTime('2026-03-07T10:00:00Z'), /^\d{2}\/\d{2}, \d{2}:\d{2}$/);
    });
});

describe('isLive (comunicado já publicado x agendado para o futuro)', () => {
    test('sem scheduled_at, já está no ar', () => {
        assert.equal(comunicacao.isLive({ scheduled_at: null }), true);
    });

    test('scheduled_at no passado já está no ar', () => {
        assert.equal(comunicacao.isLive({ scheduled_at: '2020-01-01T00:00:00Z' }), true);
    });

    test('scheduled_at no futuro ainda não está no ar', () => {
        const futuro = new Date(Date.now() + 86400000).toISOString();
        assert.equal(comunicacao.isLive({ scheduled_at: futuro }), false);
    });
});

describe('fmtSize / fileIcon', () => {
    test('fmtSize usa KB abaixo de 1MB e MB com uma casa decimal a partir de 1MB', () => {
        assert.equal(comunicacao.fmtSize(500 * 1024), '500 KB');
        assert.equal(comunicacao.fmtSize(1.5 * 1024 * 1024), '1.5 MB');
    });

    test('fileIcon reconhece PDF e imagem, e cai no genérico para o resto', () => {
        assert.equal(comunicacao.fileIcon('application/pdf'), 'fa-file-pdf');
        assert.equal(comunicacao.fileIcon('image/jpeg'), 'fa-file-image');
        assert.equal(comunicacao.fileIcon('text/plain'), 'fa-file');
    });
});

describe('pickValidFiles (mesmo limite do anexo de comunicado e do anexo de edição)', () => {
    const pdf = { name: 'a.pdf', type: 'application/pdf', size: 1024 };
    const img = { name: 'b.png', type: 'image/png', size: 1024 };
    const grande = { name: 'c.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 };
    const tipoRuim = { name: 'd.exe', type: 'application/octet-stream', size: 1024 };

    test('aceita tipos permitidos dentro do tamanho', () => {
        assert.deepEqual(comunicacao.pickValidFiles([pdf, img], 0), [pdf, img]);
    });

    test('rejeita tipo não permitido e arquivo grande demais, mantendo os válidos', () => {
        assert.deepEqual(comunicacao.pickValidFiles([pdf, grande, tipoRuim, img], 0), [pdf, img]);
    });

    test('para de aceitar ao atingir o limite de 5, somando o que já estava selecionado', () => {
        const cinco = [pdf, img, pdf, img, pdf];
        assert.deepEqual(comunicacao.pickValidFiles(cinco, 3), [pdf, img]);
        assert.deepEqual(comunicacao.pickValidFiles(cinco, 5), []);
    });
});

describe('filterMessages (destino + categoria + busca do histórico)', () => {
    const msgs = [
        { id: 'm1', destino: 'Todos', categoria: 'Institucional', texto: '<p>Reunião geral amanhã</p>' },
        { id: 'm2', destino: 'TI', categoria: 'Urgente', texto: '<p>Manutenção no servidor</p>' },
        { id: 'm3', destino: 'RH', categoria: 'Benefícios', texto: '<p>Novo vale-refeição</p>' },
    ];

    test('"todos" não filtra por destino', () => {
        assert.equal(comunicacao.filterMessages(msgs, 'todos', 'todas', '').length, 3);
    });

    test('filtra por destino específico', () => {
        const out = comunicacao.filterMessages(msgs, 'TI', 'todas', '');
        assert.deepEqual(
            out.map((m) => m.id),
            ['m2']
        );
    });

    test('filtra por categoria específica', () => {
        const out = comunicacao.filterMessages(msgs, 'todos', 'Urgente', '');
        assert.deepEqual(
            out.map((m) => m.id),
            ['m2']
        );
    });

    test('busca casa com o texto sem tags ou com o nome do destino (quem chama já manda em minúsculas, como o handler do campo de busca faz)', () => {
        assert.deepEqual(
            comunicacao.filterMessages(msgs, 'todos', 'todas', 'vale-refeição').map((m) => m.id),
            ['m3']
        );
        assert.deepEqual(
            comunicacao.filterMessages(msgs, 'todos', 'todas', 'ti').map((m) => m.id),
            ['m2']
        );
    });

    test('destino + categoria + busca combinam com AND', () => {
        const out = comunicacao.filterMessages(msgs, 'TI', 'Urgente', 'servidor');
        assert.equal(out.length, 1);
        const semBate = comunicacao.filterMessages(msgs, 'TI', 'Benefícios', 'servidor');
        assert.equal(semBate.length, 0);
    });
});

describe('computeEngagementStats (taxa de leitura geral e por departamento)', () => {
    const employees = [
        { id: 'e1', status: 'Ativo', dept: 'TI' },
        { id: 'e2', status: 'Ativo', dept: 'TI' },
        { id: 'e3', status: 'Ativo', dept: 'RH' },
        { id: 'e4', status: 'Inativo', dept: 'TI' },
    ];

    test('mensagem para "Todos": destinatários são todos os ativos, independente de departamento', () => {
        const msgs = [{ id: 'm1', destino: 'Todos' }];
        const { totalRecipients } = comunicacao.computeEngagementStats(msgs, employees, []);
        assert.equal(totalRecipients, 3);
    });

    test('mensagem para um departamento: só os ativos daquele departamento contam', () => {
        const msgs = [{ id: 'm1', destino: 'TI' }];
        const { deptTotals, totalRecipients } = comunicacao.computeEngagementStats(msgs, employees, []);
        assert.deepEqual(deptTotals, { TI: 2 });
        assert.equal(totalRecipients, 2);
    });

    test('conta leituras por departamento e calcula a taxa geral arredondada', () => {
        const msgs = [{ id: 'm1', destino: 'Todos' }];
        const reads = [{ employees: { dept: 'TI' } }, { employees: { dept: 'RH' } }];
        const stats = comunicacao.computeEngagementStats(msgs, employees, reads);
        assert.deepEqual(stats.deptReads, { TI: 1, RH: 1 });
        assert.equal(stats.totalReads, 2);
        assert.equal(stats.totalRecipients, 3);
        assert.equal(stats.overallRate, 67);
    });

    test('leitura de departamento que não era destinatário (ex.: ex-funcionário mudou de setor) não aparece', () => {
        const msgs = [{ id: 'm1', destino: 'TI' }];
        const reads = [{ employees: { dept: 'Marketing' } }];
        const { deptReads } = comunicacao.computeEngagementStats(msgs, employees, reads);
        assert.deepEqual(deptReads, {});
    });

    test('sem destinatários, taxa geral é 0 (não divide por zero)', () => {
        const { overallRate } = comunicacao.computeEngagementStats([], employees, []);
        assert.equal(overallRate, 0);
    });

    test('várias mensagens relevantes somam destinatários (usado no engajamento geral)', () => {
        const msgs = [
            { id: 'm1', destino: 'TI' },
            { id: 'm2', destino: 'RH' },
        ];
        const { totalRecipients } = comunicacao.computeEngagementStats(msgs, employees, []);
        assert.equal(totalRecipients, 3);
    });
});
