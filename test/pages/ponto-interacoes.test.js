const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { openPage, FakeSupabase } = require('../../test-support/page-harness');
const { COLAB_USER, MANAGER_USER, ANA, BIA, baseTables } = require('../../test-support/page-fixtures');

let page;
afterEach(() => page?.close());

const HOJE = '2026-06-17';
const NOW = `${HOJE}T10:00:00-03:00`;
const NA_EMPRESA = { lat: -23.5591, lng: -46.6606 };
const QUEUE_KEY = `nexus_ponto_offline_${ANA.id}`;

function colabClient({ extra = {}, user = COLAB_USER, rpc = {}, ana = {} } = {}) {
    const tables = baseTables({
        time_records: [],
        adjustment_requests: [],
        bank_requests: [],
        holidays: [],
        hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
        activity_logs: [],
        documents: [],
        burnout_alerts: [],
        ...extra,
    });
    for (const t of ['employees', 'employees_decrypted'])
        Object.assign(
            tables[t].find((e) => e.id === ANA.id),
            ana
        );
    return new FakeSupabase({
        user,
        tables,
        rpc: { report_daily_overtime_alert: {}, biometric_status: { enrolled: false }, ...rpc },
        defaults: { adjustment_requests: { status: 'pendente' }, bank_requests: { status: 'pendente' } },
    });
}

const dia = (date, entrada, saida, almoco = true) => ({
    id: `tr-${date}`,
    employee_id: ANA.id,
    date,
    entrada: `${date}T${entrada}:00-03:00`,
    saida_almoco: almoco ? `${date}T12:00:00-03:00` : null,
    retorno_almoco: almoco ? `${date}T13:00:00-03:00` : null,
    saida: saida ? `${date}T${saida}:00-03:00` : null,
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

function comFaceApi({ valor = 0.1, estado = {} } = {}) {
    return (w) => {
        w.NEXUS_PROVA_DE_VIDA_MS = 600;
        let i = 0;
        w.faceapi = {
            nets: new Proxy({}, { get: () => ({ loadFromUri: async () => {} }) }),
            TinyFaceDetectorOptions: class {},
            fetchImage: async (src) => {
                if (estado.falharImagem) throw new Error('modelo indisponível');
                return { src };
            },
            detectSingleFace: (entrada) => {
                if (estado.falharVideo && entrada?.tagName === 'VIDEO') throw new Error('câmera travou');
                return {
                    withFaceLandmarks: () => ({
                        then: (ok) => {
                            if (entrada?.tagName !== 'VIDEO') return ok(null);
                            const aberto = [true, false, true][i++ % 3];
                            return ok({ landmarks: { getLeftEye: () => olho(aberto), getRightEye: () => olho(aberto) } });
                        },
                        withFaceDescriptor: async () => (estado.semRosto ? null : { descriptor: Float32Array.from({ length: 128 }, () => valor) }),
                    }),
                };
            },
        };
    };
}

const servidor = (extra = {}) => ({
    biometric_status: { enrolled: true, consent_at: '2026-06-01T10:00:00Z' },
    biometric_verify: (args) => {
        const dist = Math.sqrt(args.p_descriptor.reduce((acc, v) => acc + (v - 0.1) ** 2, 0));
        return dist <= 0.55 ? { enrolled: true, matched: true, verification_id: 'tok-1' } : { enrolled: true, matched: false, verification_id: null };
    },
    punch_time_record: (args) => [{ employee_id: ANA.id, date: args.p_date, [args.p_step]: `${args.p_date}T10:00:00-03:00` }],
    ...extra,
});

async function abrirSelfie(opts = {}) {
    const estado = opts.estado || {};
    const c = colabClient({ rpc: servidor(opts.rpc) });
    page = await openPage('ponto-colaborador', {
        client: c,
        now: NOW,
        geolocation: NA_EMPRESA,
        camera: true,
        online: opts.online !== false,
        fetch: async () => new Response('{}', { status: 200 }),
        before: comFaceApi({ valor: opts.valor ?? 0.1, estado }),
    });
    await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
    await page.waitFor(() => /Biometria facial/.test(page.text('#biometria-card')));
    await page.click('#btn-ponto');
    return { c, estado };
}

async function tirarSelfie() {
    await page.click('#btn-selfie-shoot');
    await page.waitFor(
        () =>
            /detectamos a piscada/.test(page.text('#selfie-hint')) ||
            (page.visible('#face-verify-status') && !/Verificando/.test(page.text('#face-verify-status'))),
        { timeout: 5000 }
    );
}

describe('ponto-colaborador.html — saldo, estatísticas e histórico', () => {
    test('PJ: saldo mostra o total trabalhado e os dias registrados; histórico sem saldo; jornada "Autônomo"', async () => {
        const c = colabClient({
            ana: { contract_type: 'pj' },
            extra: { time_records: [dia('2026-06-15', '08:00', '17:00'), dia('2026-06-16', '08:00', '18:00')] },
        });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        assert.equal(page.text('#saldo-value'), '17h 00min');
        assert.equal(page.text('#saldo-sub'), 'Total registrado em 2 dia(s) — PJ');
        assert.equal(page.text('#stat-jornada'), 'Autônomo');
        assert.match(page.text('#historico-tbody'), /16\/06\/2026.*9h 00min 9h 00min Normal/);
    });

    test('dia com menos horas conta como falta no mês; dia exato é normal', async () => {
        const c = colabClient({ extra: { time_records: [dia('2026-06-15', '08:00', '17:00'), dia('2026-06-16', '08:00', '16:00')] } });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        assert.equal(page.text('#stat-horas-falta'), '1h 00min');
        assert.match(page.text('#historico-tbody tr:nth-child(1)'), /16\/06\/2026.*-1h 00min Falta/);
        assert.match(page.text('#historico-tbody tr:nth-child(2)'), /15\/06\/2026.*\+0h 00min Normal/);
    });

    test('filtro de mês do histórico: navega entre anos, escolhe maio e mostra os registros; mês vazio avisa', async () => {
        const c = colabClient({ extra: { time_records: [dia('2026-05-20', '08:00', '17:00')] } });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        const aberto = () => page.$('#filter-month-popover').classList.contains('open');
        assert.match(page.text('#historico-tbody'), /Nenhum registro em 06\/2026/);
        await page.click('#filter-month-trigger');
        assert.ok(aberto());
        for (let i = 0; i < 6; i++) await page.click('#filter-month-prev');
        assert.equal(page.text('#filter-month-title'), 'Dezembro 2025');
        for (let i = 0; i < 7; i++) await page.click('#filter-month-next');
        assert.equal(page.text('#filter-month-title'), 'Julho 2026');
        for (let i = 0; i < 6; i++) await page.click('#filter-month-next');
        assert.equal(page.text('#filter-month-title'), 'Janeiro 2027');
        for (let i = 0; i < 8; i++) await page.click('#filter-month-prev');
        assert.equal(page.text('#filter-month-title'), 'Maio 2026');
        await page.click('#filter-month-grid .calendar-day--muted');
        assert.ok(aberto(), 'dia de outro mês não escolhe');
        await page.click('#filter-month-grid button[data-day="10"]:not(.calendar-day--muted)');
        assert.ok(!aberto());
        assert.equal(page.text('#filter-month-text'), 'Maio 2026');
        assert.match(page.text('#historico-tbody'), /20\/05\/2026/);

        await page.click('#filter-month-trigger');
        assert.equal(page.text('#filter-month-title'), 'Maio 2026', 'reabre no mês escolhido');
        await page.click('#filter-month-trigger');
        assert.ok(!aberto());
        await page.click('#filter-month-trigger');
        await page.key('#filter-month-trigger', 'Escape');
        assert.ok(!aberto());
        await page.click('#filter-month-trigger');
        await page.click('#historico-tbody');
        assert.ok(!aberto());
    });

    test('duas jornadas longas na semana (6h de extras) geram alerta de sobrecarga; 8h ou mais é crítico', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient({ extra: { time_records: [dia('2026-06-15', '08:00', '20:00'), dia('2026-06-16', '08:00', '20:00')] } }),
            now: NOW,
        });
        await page.settle(20);
        assert.match(page.text('#section-burnout'), /6h 00min de extras esta semana/);
        assert.match(page.text('#section-burnout'), /Sugestão de Descanso/);
        page.close();

        page = await openPage('ponto-colaborador', {
            client: colabClient({ extra: { time_records: [dia('2026-06-15', '08:00', '21:00'), dia('2026-06-16', '08:00', '21:00')] } }),
            now: NOW,
        });
        await page.settle(20);
        assert.match(page.text('#section-burnout'), /Atenção: Risco de Esgotamento.*8h 00min de extras esta semana/);
    });
});

describe('ponto-colaborador.html — ajuste de ponto: data, tipo e relógio', () => {
    test('calendário do ajuste: navega entre anos, fecha com Esc, clique fora e no botão', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW });
        await page.click('[data-click="openModalAjuste"]');
        const aberto = () => page.$('#ajuste-data-popover').classList.contains('open');
        await page.click('#ajuste-data-trigger');
        assert.ok(aberto());
        for (let i = 0; i < 6; i++) await page.click('#ajuste-data-prev');
        assert.equal(page.text('#ajuste-data-title'), 'Dezembro 2025');
        for (let i = 0; i < 7; i++) await page.click('#ajuste-data-next');
        assert.equal(page.text('#ajuste-data-title'), 'Julho 2026');
        for (let i = 0; i < 6; i++) await page.click('#ajuste-data-next');
        assert.equal(page.text('#ajuste-data-title'), 'Janeiro 2027');
        await page.click('#ajuste-data-grid .calendar-day--muted');
        assert.ok(aberto());
        await page.click('#ajuste-data-trigger');
        assert.ok(!aberto());
        await page.click('#ajuste-data-trigger');
        await page.key('#ajuste-data-trigger', 'Escape');
        assert.ok(!aberto());
        await page.click('#ajuste-data-trigger');
        await page.click('#modal-ajuste .modal-body, #modal-ajuste');
        assert.ok(!aberto());
    });

    test('tipo do ajuste: abre, fecha, escolhe; relógio: hora externa e interna, arrastar, minutos e confirmar', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW });
        await page.click('[data-click="openModalAjuste"]');
        const tipoAberto = () => page.$('#ajuste-tipo-popover').classList.contains('open');
        await page.click('#ajuste-tipo-trigger');
        assert.ok(tipoAberto());
        await page.click('#ajuste-tipo-trigger');
        assert.ok(!tipoAberto());
        await page.click('#ajuste-tipo-trigger');
        await page.key('#ajuste-tipo-trigger', 'Escape');
        assert.ok(!tipoAberto());
        await page.click('#ajuste-tipo-trigger');
        await page.click('#modal-ajuste');
        assert.ok(!tipoAberto());
        await page.click('#ajuste-tipo-trigger');
        page.$('#ajuste-tipo-popover').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
        assert.ok(tipoAberto(), 'clique fora das opções não escolhe');
        await page.click('#ajuste-tipo-popover .select-option[data-value="saida"]');
        assert.equal(page.$('#ajuste-tipo').value, 'saida');
        assert.equal(page.text('#ajuste-tipo-text'), 'Correção de Saída');

        const dial = page.$('#clock-dial');
        dial.setPointerCapture = () => {};
        const ponteiro = (tipo, x, y) => dial.dispatchEvent(new page.window.MouseEvent(tipo, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
        await page.click('#ajuste-horario-trigger');
        assert.ok(page.$('#modal-relogio').classList.contains('open'));
        assert.equal(page.text('#clockmodal-hour-btn'), '--');
        assert.equal(page.$('#btn-clock-confirm').disabled, true);
        page.window.confirmClockModal();
        assert.equal(page.$('#ajuste-horario').value, '', 'sem hora e minuto não confirma');

        ponteiro('pointermove', -95, 0);
        assert.equal(page.text('#clockmodal-hour-btn'), '--', 'mover sem pressionar não escolhe');
        ponteiro('pointerdown', -95, 0);
        assert.equal(page.text('#clockmodal-hour-btn'), '09');
        ponteiro('pointermove', -60, 0);
        assert.equal(page.text('#clockmodal-hour-btn'), '21', 'anel interno = 13 a 24h');
        ponteiro('pointerdown', 0, -60);
        assert.equal(page.text('#clockmodal-hour-btn'), '12');
        ponteiro('pointermove', -60, 0);
        ponteiro('pointerup', -60, 0);
        assert.ok(page.$('#clock-dial').classList.contains('step-minute'), 'soltar a hora passa para os minutos');
        ponteiro('pointerup', 0, 95);
        ponteiro('pointerdown', 0, 95);
        ponteiro('pointerup', 0, 95);
        assert.equal(page.text('#clockmodal-min-btn'), '30');
        assert.ok(page.$('#clock-dial').classList.contains('step-minute'), 'nos minutos, soltar não volta');
        await page.click('#clockmodal-hour-btn');
        assert.ok(!page.$('#clock-dial').classList.contains('step-minute'));
        await page.click('#clockmodal-min-btn');
        assert.ok(page.$('#clock-dial').classList.contains('step-minute'));
        await page.click('[data-click="confirmClockModal"]');
        assert.equal(page.$('#ajuste-horario').value, '21:30');
        assert.equal(page.text('#ajuste-horario-text'), '21:30');

        await page.click('#ajuste-horario-trigger');
        assert.deepEqual([page.text('#clockmodal-hour-btn'), page.text('#clockmodal-min-btn')], ['21', '30'], 'reabre com o horário escolhido');
        assert.ok(page.$('#clock-dial .clock-number--inner.clock-number--selected'));
    });
});

describe('ponto-colaborador.html — gestor: anexo e rejeição', () => {
    function gestorClient(extraRpc = {}) {
        return new FakeSupabase({
            user: MANAGER_USER,
            tables: baseTables({
                time_records: [],
                adjustment_requests: [],
                holidays: [],
                hr_settings: [{ id: 1, limite_extra_diario_min: 120 }],
                bank_requests: [
                    {
                        id: 'br1',
                        employee_id: ANA.id,
                        manager_id_snapshot: BIA.id,
                        status: 'pendente',
                        tipo: 'credito',
                        minutos: 90,
                        date: '2026-06-15',
                        justificativa: 'Entrega',
                        anexo_path: 'emp-ana/banco-horas/comprovante.pdf',
                        anexo_name: 'comprovante.pdf',
                        created_at: '2026-06-15T19:00:00Z',
                        employees: { name: ANA.name, dept: ANA.dept },
                    },
                ],
            }),
            rpc: { biometric_status: { enrolled: false }, ...extraRpc },
        });
    }

    test('ver o anexo do pedido abre o arquivo; falha avisa', async () => {
        page = await openPage('ponto-colaborador', { client: gestorClient(), now: NOW });
        const abertos = [];
        page.window.NexusFiles.open = async (bucket, path, o) => {
            abertos.push([bucket, path, o.name]);
            return { error: abertos.length > 1 ? { message: 'x' } : null };
        };
        await page.click('[data-click="viewBankRequestAnexo"]');
        assert.deepEqual(abertos[0], ['documents', 'emp-ana/banco-horas/comprovante.pdf', 'comprovante.pdf']);
        await page.click('[data-click="viewBankRequestAnexo"]');
        assert.ok(page.toasts().includes('Não foi possível abrir o anexo.'));
        await page.window.viewBankRequestAnexo('nao-existe');
        assert.equal(abertos.length, 2);
    });

    test('rejeição recusada pelo banco mostra a mensagem e mantém o pedido', async () => {
        const c = gestorClient();
        c.errors['rpc:approve_bank_request'] = { message: 'Pedido já decidido.' };
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await page.click('[data-click="openRejectModal"]');
        await page.fill('#reject-obs-text', 'Sem comprovante');
        await page.click('[data-click="confirmRejectBankRequest"]');
        assert.ok(page.toasts().includes('Pedido já decidido.'));
        assert.ok(page.$('[data-click="approveTeamRequest"]'));
    });
});

describe('ponto-colaborador.html — câmera, prova de vida e verificação facial: falhas', () => {
    test('aparelho sem câmera: botão da selfie desativado com aviso', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient(),
            now: NOW,
            geolocation: NA_EMPRESA,
            before: (w) => Object.defineProperty(w.navigator, 'mediaDevices', { value: undefined, configurable: true }),
        });
        await page.click('#btn-ponto');
        assert.equal(page.$('#btn-selfie-shoot').disabled, true);
        assert.equal(page.text('#selfie-hint'), 'Câmera não disponível neste aparelho/navegador.');
    });

    test('prova de vida que falha por erro técnico não tira a selfie', async () => {
        await abrirSelfie({ estado: { falharVideo: true } });
        await tirarSelfie();
        assert.match(page.text('#selfie-hint'), /Não detectamos a piscada/);
        assert.equal(page.visible('#selfie-preview'), false);
    });

    test('falha ao processar a selfie avisa que a verificação está indisponível', async () => {
        await abrirSelfie({ estado: { falharImagem: true } });
        await tirarSelfie();
        assert.match(page.text('#face-verify-status'), /Verificação facial indisponível agora/);
        assert.equal(page.$('#btn-confirmar-ponto').disabled, true);
    });

    test('erro do servidor na verificação mostra a mensagem; servidor sem biometria libera sem token', async () => {
        await abrirSelfie({ rpc: { biometric_verify: { error: { message: 'Serviço de biometria fora do ar.' } } } });
        await tirarSelfie();
        assert.match(page.text('#face-verify-status'), /Serviço de biometria fora do ar\./);
        assert.equal(page.$('#btn-confirmar-ponto').disabled, true);
        page.close();

        await abrirSelfie({ rpc: { biometric_verify: { enrolled: false } } });
        await tirarSelfie();
        assert.match(page.text('#face-verify-status'), /Biometria facial não cadastrada/);
        assert.equal(page.$('#btn-confirmar-ponto').disabled, false);
    });

    test('confirmar sem selfie avisa', async () => {
        await abrirSelfie();
        await page.window.confirmarRegistro();
        assert.ok(page.toasts().includes('Tire uma selfie para confirmar o registro.'));
    });

    test('selfie tirada sem conexão e confirmada já online: rosto que não confere é recusado', async () => {
        const { c } = await abrirSelfie({ online: false, valor: 0.9 });
        await tirarSelfie();
        assert.match(page.text('#face-verify-status'), /verificada ao enviar/);
        await page.setOnline(true);
        await page.click('#btn-confirmar-ponto');
        await page.waitFor(() => page.toasts().length);
        assert.ok(page.toasts().includes('O rosto não confere com a biometria cadastrada. O ponto não foi registrado.'));
        assert.equal(c.rpcCalls('punch_time_record').length, 0);
    });

    test('falha técnica ao verificar no envio ou ao subir a selfie guarda a batida no aparelho', async () => {
        const { estado } = await abrirSelfie({ online: false });
        await tirarSelfie();
        await page.setOnline(true);
        estado.falharImagem = true;
        await page.click('#btn-confirmar-ponto');
        await page.waitFor(() => page.toasts().length);
        assert.ok(page.toasts().includes('Falha de conexão — ponto salvo no aparelho e será sincronizado automaticamente.'));
        assert.equal(JSON.parse(page.window.localStorage.getItem(QUEUE_KEY)).length, 1);
        page.close();

        await abrirSelfie();
        await tirarSelfie();
        page.window.NexusFiles.upload = async () => {
            throw new Error('rede caiu no meio');
        };
        await page.click('#btn-confirmar-ponto');
        await page.waitFor(() => page.toasts().length);
        assert.ok(page.toasts().includes('Falha de conexão — ponto salvo no aparelho e será sincronizado automaticamente.'));
    });

    test('Esc fecha o modal de confirmação e desliga a câmera', async () => {
        await abrirSelfie();
        let parou = 0;
        page.eval(`selfieStream = { getTracks: () => [{ stop: () => window.__parou = (window.__parou || 0) + 1 }] }`);
        await page.key('body', 'Escape');
        parou = page.window.__parou;
        assert.ok(!page.$('#modal-confirmar').classList.contains('open'));
        assert.equal(parou, 1);
    });
});

describe('ponto-colaborador.html — cadastro e revogação da biometria: falhas', () => {
    const cadastro = (rpc = {}, estado = {}, camera = true) =>
        openPage('ponto-colaborador', {
            client: colabClient({ rpc: { biometric_status: { enrolled: false }, ...rpc } }),
            now: NOW,
            camera,
            confirm: true,
            before: comFaceApi({ estado }),
        });

    test('sem acesso à câmera avisa no modal', async () => {
        page = await cadastro({}, {}, false);
        await page.click('#btn-biometria-cadastrar');
        await page.waitFor(() => /Não foi possível acessar a câmera/.test(page.text('#biometria-hint')));
        assert.equal(page.$('#btn-biometria-salvar').disabled, true);
    });

    test('rosto não identificado (por erro ou sem rosto) e erro do servidor ao cadastrar avisam', async () => {
        const estado = { falharImagem: true };
        page = await cadastro({ biometric_enroll: { error: { message: 'Consentimento inválido.' } } }, estado);
        await page.click('#btn-biometria-cadastrar');
        await page.waitFor(() => page.$('#bio-video').srcObject);
        await page.check('#biometria-consentimento');
        await page.click('#btn-biometria-salvar');
        await page.waitFor(() => /Não identificamos seu rosto/.test(page.text('#biometria-hint')), { timeout: 5000 });

        estado.falharImagem = false;
        estado.semRosto = true;
        page.$('#biometria-hint').textContent = '';
        await page.click('#btn-biometria-salvar');
        await page.waitFor(() => /Não identificamos seu rosto/.test(page.text('#biometria-hint')), { timeout: 5000 });

        estado.semRosto = false;
        await page.click('#btn-biometria-salvar');
        await page.waitFor(() => /Consentimento inválido\./.test(page.text('#biometria-hint')), { timeout: 5000 });
        assert.ok(page.$('#modal-biometria').classList.contains('open'));
    });

    test('erro ao revogar avisa e mantém a biometria', async () => {
        page = await cadastro({ biometric_status: { enrolled: true, consent_at: '2026-06-01T10:00:00Z' }, biometric_revoke: { error: { message: 'x' } } });
        await page.waitFor(() => /cadastrada em/.test(page.text('#biometria-card')));
        await page.click('#btn-biometria-revogar');
        await page.waitFor(() => page.toasts().length);
        assert.ok(page.toasts().includes('Não foi possível revogar agora. Tente novamente.'));
        assert.match(page.text('#biometria-card'), /cadastrada em/);
    });
});

describe('ponto-colaborador.html — fila offline, localização e tempo real', () => {
    test('fila ilegível no aparelho é tratada como vazia', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW, localStorage: { [QUEUE_KEY]: '{quebrado' } });
        assert.equal(page.visible('#ponto-sync-status'), false);
    });

    test('a verificação periódica envia as batidas pendentes', async () => {
        const intervalos = [];
        const c = colabClient({ rpc: { punch_time_record: (a) => [{ employee_id: ANA.id, date: a.p_date, [a.p_step]: `${a.p_date}T08:00:00-03:00` }] } });
        const pendente = [{ step: 'entrada', date: HOJE, timestamp: `${HOJE}T08:00:00-03:00`, loc: NA_EMPRESA, selfie: null, biometricToken: null }];
        page = await openPage('ponto-colaborador', {
            client: c,
            now: NOW,
            online: false,
            localStorage: { [QUEUE_KEY]: JSON.stringify(pendente) },
            before: (w) => {
                const real = w.setInterval.bind(w);
                w.setInterval = (fn, ms) => (ms === 20000 ? intervalos.push(fn) : real(fn, ms));
            },
        });
        assert.equal(c.rpcCalls('punch_time_record').length, 0);
        await page.setOnline(true);
        await page.waitFor(() => c.rpcCalls('punch_time_record').length === 1);
        intervalos[0]();
        await page.settle();
        assert.equal(c.rpcCalls('punch_time_record').length, 1, 'fila vazia: nada a enviar');
        page.window.localStorage.setItem(QUEUE_KEY, JSON.stringify(pendente));
        intervalos[0]();
        await page.waitFor(() => c.rpcCalls('punch_time_record').length === 2);
    });

    test('sem GPS no aparelho avisa; atualizar a localização redesenha o mapa', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient(),
            now: NOW,
            before: (w) => Object.defineProperty(w.navigator, 'geolocation', { value: undefined, configurable: true }),
        });
        assert.equal(page.text('#loc-status-text'), 'GPS não disponível');
        page.close();

        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW, geolocation: NA_EMPRESA });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await page.click('[data-click="initLocation"]');
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        assert.ok(page.libs.filter(([n]) => n === 'L.removeLayer').length >= 2, 'marcador e rota antigos saem do mapa');
    });

    test('tempo real: ponto, ajuste e pedido de banco de horas novos aparecem', async () => {
        const c = colabClient();
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        c.tables.time_records.push(dia(HOJE, '08:00', null));
        c.emit('time_records', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => /17\/06\/2026/.test(page.text('#historico-tbody')));

        c.tables.adjustment_requests.push({
            id: 'aj1',
            employee_id: ANA.id,
            tipo: 'entrada',
            date: '2026-06-16',
            status: 'pendente',
            created_at: '2026-06-16T10:00:00Z',
            justificativa: 'Esqueci',
        });
        c.emit('adjustment_requests', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => page.visible('#section-solicitacoes'));

        c.tables.bank_requests.push({
            id: 'br9',
            employee_id: ANA.id,
            tipo: 'credito',
            minutos: 30,
            date: '2026-06-16',
            status: 'pendente',
            created_at: '2026-06-16T10:00:00Z',
            justificativa: 'Evento',
        });
        c.emit('bank_requests', { eventType: 'INSERT', new: {} });
        await page.waitFor(() => /Evento/.test(page.text('body')));
    });

    test('aviso some sozinho', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW });
        const agendados = [];
        page.window.setTimeout = (fn, ms) => agendados.push([fn, ms]);
        page.window.showToast('Teste', 'info');
        const toast = page.$$('.toast').at(-1);
        agendados.find(([, ms]) => ms === 4000)[0]();
        assert.ok(toast.classList.contains('hide'));
        agendados.find(([, ms]) => ms === 400)[0]();
        assert.ok(!toast.isConnected);
    });
});

describe('ponto-colaborador.html — caminhos restantes', () => {
    test('falha ao carregar os modelos faciais não quebra a tela', async () => {
        page = await openPage('ponto-colaborador', {
            client: colabClient(),
            now: NOW,
            before: (w) => {
                w.faceapi = { nets: new Proxy({}, { get: () => ({ loadFromUri: () => Promise.reject(new Error('CDN fora')) }) }) };
            },
        });
        await page.settle();
        assert.match(page.text('#biometria-card'), /não cadastrada/);
    });

    test('botão de anexo do pedido de banco de horas abre o seletor de arquivo', async () => {
        page = await openPage('ponto-colaborador', { client: colabClient(), now: NOW });
        let abriu = 0;
        page.$('#bankreq-anexo').click = () => abriu++;
        await page.click('[data-click="openModalBankRequest"]');
        await page.click('#bankreq-anexo-btn');
        assert.equal(abriu, 1);
    });

    test('aviso de excesso ao RH que falha por rede não impede a batida', async () => {
        const agora = `${HOJE}T20:30:00-03:00`;
        const c = colabClient({
            extra: { time_records: [{ ...dia(HOJE, '08:00', null) }] },
            rpc: {
                punch_time_record: (a) => [{ ...dia(HOJE, '08:00', '20:30'), [a.p_step]: agora }],
                report_daily_overtime_alert: () => {
                    throw new Error('rede caiu');
                },
            },
        });
        page = await openPage('ponto-colaborador', {
            client: c,
            now: agora,
            geolocation: NA_EMPRESA,
            camera: true,
            fetch: async () => new Response('{}', { status: 200 }),
        });
        await page.waitFor(() => page.text('#loc-status-text') === 'Dentro da empresa');
        await page.click('#btn-ponto');
        await page.click('#btn-selfie-shoot');
        await page.waitFor(() => !page.$('#btn-confirmar-ponto').disabled || page.visible('#excesso-legal-just'));
        await page.fill('#excesso-legal-just', 'Fechamento');
        await page.click('#btn-confirmar-ponto');
        await page.waitFor(() => page.toasts().length);
        assert.ok(page.toasts().includes('Saída registrada — bom descanso!'));
        assert.equal(c.rpcCalls('report_daily_overtime_alert').length, 1);
    });

    test('fechar os cartões de alerta some com eles depois da animação', async () => {
        const c = colabClient({
            extra: {
                time_records: [dia('2026-06-15', '08:00', '20:00', false), dia('2026-06-16', '08:00', '20:00', false)],
            },
        });
        page = await openPage('ponto-colaborador', { client: c, now: NOW });
        await page.settle(20);
        const agendados = [];
        const real = page.window.setTimeout.bind(page.window);
        page.window.setTimeout = (fn, ms, ...a) => (ms === 350 ? agendados.push(fn) : real(fn, ms, ...a));
        page.window.dismissBurnout();
        page.window.dismissCLT();
        assert.equal(agendados.length, 2);
        agendados.forEach((fn) => fn());
        assert.ok(page.$('#section-burnout').classList.contains('hidden'));
        assert.ok(page.$('#section-clt').classList.contains('hidden'));
    });
});
