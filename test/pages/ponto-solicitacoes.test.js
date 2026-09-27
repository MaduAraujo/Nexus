const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, MANAGER_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const HOJE = '2026-06-17';
const NOW = `${HOJE}T10:00:00-03:00`;
const filesOk = async () => new Response('{}', { status: 200 });

function colabClient({ extra = {}, user = COLAB_USER, rpc = {} } = {}) {
    return new FakeSupabase({
        user,
        tables: baseTables({
            time_records: [],
            adjustment_requests: [],
            bank_requests: [],
            holidays: [],
            hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
            activity_logs: [],
            documents: [],
            burnout_alerts: [],
            ...extra,
        }),
        rpc: { report_daily_overtime_alert: {}, biometric_status: { enrolled: false }, ...rpc },
        defaults: { adjustment_requests: { status: 'pendente' }, bank_requests: { status: 'pendente' } },
    });
}

const setHidden = (p, id, value) => {
    p.$(`#${id}`).value = value;
};

describe('ponto-colaborador.html — solicitação de ajuste de ponto', () => {
    async function abrirAjuste(p) {
        p.window.openModalAjuste();
        await p.settle();
        assert.ok(p.$('#modal-ajuste').classList.contains('open'));
    }

    test('campos obrigatórios: mostra o erro de cada um e não envia', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await abrirAjuste(page);
        assert.equal(page.$('#btn-ajuste-enviar').disabled, true);
        await page.window.enviarSolicitacao();
        assert.equal(page.text('#err-ajuste-data'), 'Informe a data.');
        assert.equal(page.text('#err-ajuste-tipo'), 'Selecione o tipo.');
        assert.equal(page.text('#err-ajuste-horario'), 'Informe o horário correto.');
        assert.equal(page.text('#err-ajuste-just'), 'A justificativa é obrigatória.');
        assert.equal(c.writes('adjustment_requests', 'insert').length, 0);
    });

    test('escolher o dia pelo calendário e enviar ajuste de entrada', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await abrirAjuste(page);
        await page.click('#ajuste-data-trigger');
        await page.click('#ajuste-data-grid .calendar-day:not(.calendar-day--muted)[data-day="16"]');
        assert.equal(page.$('#ajuste-data').value, '2026-06-16');
        assert.equal(page.text('#ajuste-data-text'), '16/06/2026');
        setHidden(page, 'ajuste-tipo', 'entrada');
        setHidden(page, 'ajuste-horario', '08:05');
        await page.fill('#ajuste-justificativa', 'Esqueci de bater na chegada');
        assert.equal(page.$('#btn-ajuste-enviar').disabled, false);
        await page.window.enviarSolicitacao();
        const ins = c.writes('adjustment_requests', 'insert')[0].payload[0];
        assert.deepEqual(
            [ins.employee_id, ins.date, ins.tipo, ins.horario, ins.justificativa],
            [ANA.id, '2026-06-16', 'entrada', '08:05', 'Esqueci de bater na chegada']
        );
        assert.ok(page.toasts().some((t) => /Solicitação enviada/.test(t)));
        assert.equal(page.$('#modal-ajuste').classList.contains('open'), false);
        assert.match(page.text('#solicitacoes-list'), /Correção de Entrada.*2026-06-16.*08:05.*Pendente/);
    });

    test('falta não pede horário e vai sem horário', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await abrirAjuste(page);
        setHidden(page, 'ajuste-data', '2026-06-15');
        setHidden(page, 'ajuste-tipo', 'falta');
        page.window.onAjusteTipoChange();
        assert.equal(page.visible('#ajuste-horario-group'), false);
        page.$('#ajuste-justificativa').value = 'Consulta médica';
        await page.window.enviarSolicitacao();
        assert.equal(c.writes('adjustment_requests', 'insert')[0].payload[0].horario, null);
    });

    test('data futura é recusada (ajuste corrige batida que já aconteceu)', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await abrirAjuste(page);
        setHidden(page, 'ajuste-data', '2026-06-18');
        setHidden(page, 'ajuste-tipo', 'entrada');
        setHidden(page, 'ajuste-horario', '08:00');
        page.$('#ajuste-justificativa').value = 'Vou chegar cedo';
        await page.window.enviarSolicitacao();
        assert.match(page.text('#err-ajuste-data'), /data futura/);
        assert.equal(c.writes('adjustment_requests', 'insert').length, 0);
    });

    test('erro do banco avisa e mantém o modal aberto', async () => {
        const c = colabClient();
        c.errors['adjustment_requests:insert'] = { message: 'rls' };
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await abrirAjuste(page);
        setHidden(page, 'ajuste-data', '2026-06-16');
        setHidden(page, 'ajuste-tipo', 'saida');
        setHidden(page, 'ajuste-horario', '18:00');
        page.$('#ajuste-justificativa').value = 'x';
        await page.window.enviarSolicitacao();
        assert.ok(page.toasts().some((t) => /Erro ao enviar solicitação/.test(t)));
        assert.ok(page.$('#modal-ajuste').classList.contains('open'));
    });
});

describe('ponto-colaborador.html — pedido de banco de horas', () => {
    async function preencher(p, { tipo = 'credito', h = '1', m = '30', data = '2026-06-15', just = 'Fechamento do mês' } = {}) {
        p.window.openModalBankRequest();
        await p.settle();
        if (tipo !== 'credito') await p.click(`#bankreq-tipo-toggle .type-toggle-card[data-tipo="${tipo}"]`);
        setHidden(p, 'bankreq-data', data);
        setHidden(p, 'bankreq-horas', h);
        setHidden(p, 'bankreq-minutos', m);
        await p.fill('#bankreq-justificativa', just);
    }

    test('validações: data, valor maior que zero e justificativa', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await preencher(page, { data: '', h: '0', m: '0', just: '' });
        assert.equal(page.$('#btn-bankreq-enviar').disabled, true);
        await page.window.enviarBankRequest();
        assert.match(page.text('#err-bankreq-data'), /data de referência/);
        assert.match(page.text('#err-bankreq-valor'), /maior que zero/);
        assert.match(page.text('#err-bankreq-just'), /obrigatória/);
        assert.equal(c.writes('bank_requests', 'insert').length, 0);
    });

    test('duração escolhida no seletor de horas e minutos; débito vai para o RH aprovar', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await preencher(page, { tipo: 'debito', h: '', m: '' });
        page.window.openModalDuracao();
        await page.click('#modal-bankreq-duracao button[data-h="2"]');
        await page.click('#modal-bankreq-duracao button[data-m="15"]');
        page.window.confirmDuracaoModal();
        await page.settle();
        await page.window.enviarBankRequest();
        const ins = c.writes('bank_requests', 'insert')[0].payload[0];
        assert.deepEqual([ins.tipo, ins.minutos, ins.date, ins.requires_approval_from, ins.origem], ['debito', 135, '2026-06-15', 'rh', 'colaborador']);
        assert.ok(page.toasts().some((t) => /Aguarde aprovação do RH/.test(t)));
        assert.match(page.text('#bank-requests-list'), /Fechamento do mês|2h 15|02:15/);
    });

    test('com anexo: sobe com nome limpo e registra o comprovante em Documentos', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW, fetch: filesOk });
        await preencher(page);
        await page.setFiles('#bankreq-anexo', [page.file('Declaração médica.pdf', '%PDF-1.4', 'application/pdf')]);
        assert.equal(page.text('#bankreq-anexo-name'), 'Declaração médica.pdf');
        await page.window.enviarBankRequest();
        const br = c.writes('bank_requests', 'insert')[0].payload[0];
        assert.match(br.anexo_path, /^emp-ana\/banco-horas\/\d+_Declaracao_medica\.pdf$/);
        assert.equal(br.anexo_name, 'Declaração médica.pdf');
        const doc = c.writes('documents', 'insert')[0].payload[0];
        assert.deepEqual([doc.storage_path, doc.category, doc.employee_id], [br.anexo_path, 'banco_horas', ANA.id]);
    });

    test('se o pedido falha, o anexo enviado é apagado e nada vai para Documentos', async () => {
        const c = colabClient();
        c.errors['bank_requests:insert'] = { message: 'rls' };
        page = await openPage('ponto-colaborador', { client: c, now: NOW, fetch: filesOk });
        await preencher(page);
        await page.setFiles('#bankreq-anexo', [page.file('atestado.pdf', '%PDF-1.4', 'application/pdf')]);
        await page.window.enviarBankRequest();
        assert.ok(page.toasts().some((t) => /Erro ao enviar solicitação/.test(t)));
        const removidos = c.calls.filter((x) => x.storage === 'documents' && x.op === 'remove');
        assert.equal(removidos.length, 1);
        assert.match(JSON.stringify(removidos[0].path), /banco-horas\/\d+_atestado\.pdf/);
        assert.equal(c.writes('documents', 'insert').length, 0);
    });

    test('anexo acima de 10 MB ou upload com erro: não cria o pedido', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW, fetch: async () => new Response('{"error":"x"}', { status: 500 }) });
        await preencher(page);
        const grande = page.file('grande.pdf', 'x', 'application/pdf');
        Object.defineProperty(grande, 'size', { value: 11 * 1024 * 1024 });
        await page.setFiles('#bankreq-anexo', [grande]);
        await page.window.enviarBankRequest();
        assert.ok(page.toasts().some((t) => /máx\. 10 MB/.test(t)));
        await page.setFiles('#bankreq-anexo', [page.file('ok.pdf', '%PDF', 'application/pdf')]);
        await page.window.enviarBankRequest();
        assert.ok(page.toasts().some((t) => /Erro ao enviar o anexo/.test(t)));
        assert.equal(c.writes('bank_requests', 'insert').length, 0);
    });
});

describe('ponto-colaborador.html — gestor decide pedidos da equipe', () => {
    const PEDIDO = {
        id: 'br1',
        employee_id: ANA.id,
        manager_id_snapshot: BIA.id,
        status: 'pendente',
        tipo: 'credito',
        minutos: 90,
        date: '2026-06-15',
        justificativa: 'Entrega do trimestre',
        created_at: '2026-06-15T19:00:00Z',
        employees: { name: ANA.name, dept: ANA.dept },
    };

    test('aprovar chama approve_bank_request com a decisão e quem decidiu', async () => {
        const c = colabClient({ user: MANAGER_USER, extra: { bank_requests: [{ ...PEDIDO }] }, rpc: { approve_bank_request: {} } });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await page.click('[data-click="approveTeamRequest"]');
        await page.settle();
        const call = c.rpcCalls('approve_bank_request')[0];
        assert.deepEqual([call.args.p_request_id, call.args.p_decision, call.args.p_decided_by_name], ['br1', 'aprovado', BIA.name]);
        assert.equal(page.visible('#section-team-approvals'), false, 'fila vazia some da tela');
    });

    test('rejeitar exige motivo e envia a observação', async () => {
        const c = colabClient({ user: MANAGER_USER, extra: { bank_requests: [{ ...PEDIDO }] }, rpc: { approve_bank_request: {} } });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        page.window.openRejectModal('br1');
        await page.window.confirmRejectBankRequest();
        assert.equal(page.text('#err-reject-obs'), 'Informe o motivo da rejeição.');
        assert.equal(c.rpcCalls('approve_bank_request').length, 0);
        page.$('#reject-obs-text').value = 'Sem registro de ponto no dia';
        await page.window.confirmRejectBankRequest();
        const call = c.rpcCalls('approve_bank_request')[0];
        assert.deepEqual([call.args.p_decision, call.args.p_obs], ['rejeitado', 'Sem registro de ponto no dia']);
        assert.ok(page.toasts().some((t) => /Solicitação rejeitada/.test(t)));
    });

    test('erro da RPC mostra a mensagem do banco e mantém o pedido na fila', async () => {
        const c = colabClient({
            user: MANAGER_USER,
            extra: { bank_requests: [{ ...PEDIDO }] },
            rpc: { approve_bank_request: () => ({ error: { message: 'Saldo insuficiente para débito' } }) },
        });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await page.click('[data-click="approveTeamRequest"]');
        assert.ok(page.toasts().some((t) => /Saldo insuficiente/.test(t)));
        assert.match(page.text('#team-approvals-list'), /Ana Souza/);
    });
});

describe('ponto-colaborador.html — alertas de bem-estar e CLT', () => {
    const dia = (date, { entrada = '08:00', almoco = '12:00', volta = '13:00', saida = '17:00' } = {}) => ({
        employee_id: ANA.id,
        date,
        entrada: `${date}T${entrada}:00-03:00`,
        saida_almoco: almoco && `${date}T${almoco}:00-03:00`,
        retorno_almoco: volta && `${date}T${volta}:00-03:00`,
        saida: `${date}T${saida}:00-03:00`,
    });

    test('três dias seguidos com 2h de extra: cartão de descanso e aviso único ao RH no dia', async () => {
        const records = ['2026-06-15', '2026-06-16'].map((d) => dia(d, { saida: '19:00' }));
        records.unshift(dia('2026-06-12', { saida: '19:00' }));
        const c = colabClient({ extra: { time_records: records } });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await page.settle(20);
        assert.equal(page.visible('#section-burnout'), true);
        assert.match(page.text('#section-burnout'), /3 dias consecutivos com horas extras/);
        const avisos = c.writes('burnout_alerts', 'insert');
        assert.equal(avisos.length, 1);
        assert.equal(avisos[0].payload[0].date, HOJE);
        assert.ok(avisos[0].payload[0].alertas.some((a) => a.tipo === 'extras_consecutivos'));
        page.window.dismissBurnout();
        assert.ok(page.$('#section-burnout').classList.contains('burnout-dismissing'));
    });

    test('RH já avisado hoje: não duplica o alerta', async () => {
        const records = ['2026-06-12', '2026-06-15', '2026-06-16'].map((d) => dia(d, { saida: '19:00' }));
        const c = colabClient({ extra: { time_records: records, burnout_alerts: [{ id: 'b1', employee_id: ANA.id, date: HOJE }] } });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await page.settle(20);
        assert.equal(c.writes('burnout_alerts', 'insert').length, 0);
    });

    test('almoço não registrado 2x na semana e falta pendente: alertas de bem-estar e de DSR', async () => {
        const records = [dia('2026-06-15', { almoco: null, volta: null }), dia('2026-06-16', { almoco: null, volta: null })];
        const c = colabClient({
            extra: {
                time_records: records,
                adjustment_requests: [
                    { id: 'a1', employee_id: ANA.id, tipo: 'falta', status: 'pendente', date: '2026-06-10', created_at: '2026-06-10T12:00:00Z' },
                ],
            },
        });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await page.settle(20);
        assert.match(page.text('#section-burnout'), /almoço não registrado 2x/);
        assert.match(page.text('#section-clt'), /Risco de perda do DSR em 1 semana/);
        page.window.dismissCLT();
        assert.ok(page.$('#section-clt').classList.contains('burnout-dismissing'));
    });
});

const olho = (aberto) =>
    [
        [0, 0],
        [1, aberto ? -1 : -0.1],
        [2, aberto ? -1 : -0.1],
        [3, 0],
        [2, aberto ? 1 : 0.1],
        [1, aberto ? 1 : 0.1],
    ].map(([x, y]) => ({ x, y }));

function quadrosDoVideo(sequencia = [true, false, true]) {
    let i = 0;
    return () => {
        const aberto = sequencia[Math.min(i++, sequencia.length - 1)];
        return { landmarks: { getLeftEye: () => olho(aberto), getRightEye: () => olho(aberto) } };
    };
}

describe('ponto-colaborador.html — verificação facial da selfie (biometria no servidor)', () => {
    const NA_EMPRESA = { lat: -23.5591, lng: -46.6606 };
    const QUEUE_KEY = `nexus_ponto_offline_${ANA.id}`;
    const vetor = (x) => Array.from({ length: 128 }, () => x);

    function comFaceApi(selfieValor, imagens = [], sequencia) {
        return (w) => {
            w.NEXUS_PROVA_DE_VIDA_MS = 600;
            const quadro = quadrosDoVideo(sequencia);
            w.faceapi = {
                nets: new Proxy({}, { get: () => ({ loadFromUri: async () => {} }) }),
                TinyFaceDetectorOptions: class {},
                fetchImage: async (src) => {
                    imagens.push(src);
                    return { src };
                },
                detectSingleFace: (entrada) => ({
                    withFaceLandmarks: () => ({
                        then: (ok) => ok(entrada?.tagName === 'VIDEO' ? quadro() : null),
                        withFaceDescriptor: async () => (selfieValor === null ? null : { descriptor: Float32Array.from(vetor(selfieValor)) }),
                    }),
                }),
            };
        };
    }

    function servidor({ enrolled = true } = {}) {
        return {
            biometric_status: { enrolled, consent_at: '2026-06-01T10:00:00Z' },
            biometric_verify: (args) => {
                if (!enrolled) return { enrolled: false };
                const dist = Math.sqrt(args.p_descriptor.reduce((acc, v) => acc + (v - 0.1) ** 2, 0));
                return dist <= 0.55 ? { enrolled: true, matched: true, verification_id: 'tok-1' } : { enrolled: true, matched: false, verification_id: null };
            },
            punch_time_record: (args) => [{ employee_id: ANA.id, date: args.p_date, [args.p_step]: `${args.p_date}T08:00:00-03:00` }],
        };
    }

    async function tirarSelfie(selfieValor, { enrolled = true, imagens = [], online = true, sequencia } = {}) {
        const c = colabClient({ rpc: servidor({ enrolled }) });
        for (const t of ['employees', 'employees_decrypted']) c.tables[t].find((e) => e.id === ANA.id).avatar_url = 'https://storage.test/avatars/ana.jpg';
        page = await openPage('ponto-colaborador', {
            client: c,
            now: `${HOJE}T08:00:00-03:00`,
            geolocation: NA_EMPRESA,
            camera: true,
            fetch: filesOk,
            online,
            before: comFaceApi(selfieValor, imagens, sequencia),
        });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await page.waitFor(() => /Biometria facial/.test(page.text('#biometria-card')));
        await page.click('#btn-ponto');
        await page.click('#btn-selfie-shoot');
        await page.waitFor(
            () =>
                /detectamos a piscada/.test(page.text('#selfie-hint')) ||
                (page.visible('#face-verify-status') && !/Verificando/.test(page.text('#face-verify-status'))),
            { timeout: 5000 }
        );
        return c;
    }

    test('rosto confere no servidor: libera a confirmação e a batida leva o token de verificação', async () => {
        const imagens = [];
        const c = await tirarSelfie(0.11, { imagens });
        assert.match(page.text('#face-verify-status'), /Identidade confirmada/);
        assert.equal(c.rpcCalls('biometric_verify')[0].args.p_descriptor.length, 128);
        assert.ok(!imagens.some((src) => /avatars/.test(src)), 'a foto de perfil (pública) não é referência biométrica');
        await page.click('#btn-confirmar-ponto');
        await page.waitFor(() => page.toasts().length);
        assert.equal(c.rpcCalls('punch_time_record')[0].args.p_biometric_token, 'tok-1');
    });

    test('prova de vida: sem piscar (foto parada) a selfie nem é tirada', async () => {
        const c = await tirarSelfie(0.11, { sequencia: [true] });
        assert.match(page.text('#selfie-hint'), /Não detectamos a piscada/);
        assert.equal(page.visible('#selfie-preview'), false);
        assert.equal(c.rpcCalls('biometric_verify').length, 0);
        assert.equal(page.$('#btn-confirmar-ponto').disabled, true);
        assert.equal(page.$('#btn-selfie-shoot').disabled, false, 'pode tentar de novo');
    });

    test('rosto de outra pessoa: bloqueia a confirmação', async () => {
        const c = await tirarSelfie(0.9);
        assert.match(page.text('#face-verify-status'), /não confere com o cadastro/);
        assert.equal(page.$('#btn-confirmar-ponto').disabled, true);
        await page.click('#btn-confirmar-ponto');
        assert.equal(c.rpcCalls('punch_time_record').length, 0);
    });

    test('sem rosto na foto: pede outra; "tirar de novo" volta para a câmera', async () => {
        await tirarSelfie(null);
        assert.match(page.text('#face-verify-status'), /Não identificamos seu rosto/);
        assert.equal(page.$('#btn-confirmar-ponto').disabled, true);
        await page.click('#btn-selfie-retake');
        assert.equal(page.visible('#face-verify-status'), false);
        assert.equal(page.visible('#btn-selfie-shoot'), true);
        assert.equal(page.visible('#selfie-preview'), false);
    });

    test('sem biometria cadastrada: avisa, não compara nada e a batida vai sem token', async () => {
        const c = await tirarSelfie(0.9, { enrolled: false });
        assert.match(page.text('#face-verify-status'), /Biometria facial não cadastrada/);
        assert.equal(c.rpcCalls('biometric_verify').length, 0);
        assert.match(page.text('#biometria-card'), /não cadastrada/);
        await page.click('#btn-confirmar-ponto');
        await page.waitFor(() => page.toasts().length);
        assert.equal(c.rpcCalls('punch_time_record')[0].args.p_biometric_token, null);
    });

    test('sem conexão: a fila não guarda o vetor facial; a verificação acontece no envio e rosto que não confere é recusado', async () => {
        const c = await tirarSelfie(0.9, { online: false });
        assert.match(page.text('#face-verify-status'), /verificada ao enviar/);
        await page.click('#btn-confirmar-ponto');
        await page.waitFor(() => page.toasts().length);
        const fila = JSON.parse(page.window.localStorage.getItem(QUEUE_KEY));
        assert.equal(fila[0].descriptor, undefined, 'nenhum vetor biométrico no localStorage');
        assert.equal(fila[0].biometricToken, null);
        assert.equal(c.rpcCalls('biometric_verify').length, 0);

        await page.setOnline(true);
        await page.waitFor(() => page.toasts().some((t) => /recusado/.test(t)));
        assert.equal(c.rpcCalls('biometric_verify').length, 1);
        assert.equal(c.rpcCalls('biometric_verify')[0].args.p_descriptor.length, 128, 'vetor recalculado da selfie no envio');
        assert.equal(c.rpcCalls('punch_time_record').length, 0, 'batida sem identidade confirmada não entra');
        assert.deepEqual(JSON.parse(page.window.localStorage.getItem(QUEUE_KEY)), []);
    });
});

describe('ponto-colaborador.html — cadastro da biometria facial (captura dedicada + consentimento)', () => {
    const vetor = Array.from({ length: 128 }, () => 0.1);
    const faceApi = (w) => {
        w.NEXUS_PROVA_DE_VIDA_MS = 600;
        const quadro = quadrosDoVideo();
        w.faceapi = {
            nets: new Proxy({}, { get: () => ({ loadFromUri: async () => {} }) }),
            TinyFaceDetectorOptions: class {},
            fetchImage: async (src) => ({ src }),
            detectSingleFace: (entrada) => ({
                withFaceLandmarks: () => ({
                    then: (ok) => ok(entrada?.tagName === 'VIDEO' ? quadro() : null),
                    withFaceDescriptor: async () => ({ descriptor: Float32Array.from(vetor) }),
                }),
            }),
        };
    };

    test('só cadastra com o consentimento marcado; envia o vetor, nunca a foto', async () => {
        let cadastrado = false;
        const c = colabClient({
            rpc: {
                biometric_status: () => ({ enrolled: cadastrado, consent_at: '2026-06-17T10:00:00Z' }),
                biometric_enroll: () => {
                    cadastrado = true;
                    return { enrolled: true };
                },
            },
        });
        page = await openPage('ponto-colaborador', { client: c, now: NOW, camera: true, before: faceApi });
        assert.match(page.text('#biometria-card'), /não cadastrada/);
        await page.click('#btn-biometria-cadastrar');
        await page.waitFor(() => page.$('#bio-video').srcObject);
        assert.equal(page.$('#btn-biometria-salvar').disabled, true, 'sem consentimento não captura');

        await page.check('#biometria-consentimento');
        assert.equal(page.$('#btn-biometria-salvar').disabled, false);
        await page.click('#btn-biometria-salvar');
        await page.waitFor(() => page.toasts().length);

        const [enroll] = c.rpcCalls('biometric_enroll');
        assert.deepEqual(Object.keys(enroll.args).sort(), ['p_consent', 'p_consent_version', 'p_descriptor']);
        assert.deepEqual([enroll.args.p_consent, enroll.args.p_consent_version, enroll.args.p_descriptor.length], [true, 'biometria-ponto-v1', 128]);
        assert.equal(page.fetches.length, 0, 'nenhum upload: a foto do cadastro não sai do aparelho');
        assert.match(page.toasts()[0], /Biometria facial cadastrada/);
        assert.equal(page.$('#modal-biometria').classList.contains('open'), false);
        assert.match(page.text('#biometria-card'), /cadastrada em 17\/06\/2026/);
        assert.equal(page.visible('#btn-biometria-revogar'), true);
    });

    test('revogar o consentimento apaga a biometria', async () => {
        let cadastrado = true;
        const c = colabClient({
            rpc: {
                biometric_status: () => ({ enrolled: cadastrado, consent_at: '2026-06-01T10:00:00Z' }),
                biometric_revoke: () => {
                    cadastrado = false;
                    return { enrolled: false };
                },
            },
        });
        page = await openPage('ponto-colaborador', { client: c, now: NOW, confirm: true });
        await page.waitFor(() => /cadastrada em/.test(page.text('#biometria-card')));
        await page.click('#btn-biometria-revogar');
        await page.waitFor(() => page.toasts().length);
        assert.match(page.confirms.at(-1), /Revogar o consentimento/);
        assert.equal(c.rpcCalls('biometric_revoke').length, 1);
        assert.match(page.text('#biometria-card'), /não cadastrada/);
    });
});
