// Simulador de custo de rescisão CLT — cálculo local puro (função recebe os
// dados já apurados, sem acessar o banco). Cobre os 4 tipos mais comuns de
// desligamento. O saldo de banco de horas é o saldo REAL do colaborador (soma
// de todo o período de casa em time_records + bank_adjustments), calculado
// por quem chama esta função (ver pagamentos.js) e passado em `saldoBancoHorasMin`.
//
// IMPORTANTE: é uma ESTIMATIVA para planejamento interno do RH, não um cálculo
// trabalhista oficial. Simplificações assumidas:
//   - Férias sempre em dia (não considera férias vencidas não gozadas).
//   - Aviso prévio, quando pago, é sempre indenizado (não trabalhado).
//   - Aviso prévio (integral ou parcial) só projeta o contrato para 13º/férias
//     no caso de dispensa sem justa causa — nos demais tipos, a projeção é
//     tratada como não aplicável (simplificação; há divergência doutrinária).
//   - FGTS estimado com base no salário atual x tempo de casa (não no
//     histórico real de depósitos/salários anteriores).
//   - Médias habituais (Súmula 347 TST) na base do 13º/férias: só reflete
//     adicional noturno + adicional de domingo/feriado efetivamente PAGOS em
//     holerite nos últimos 12 meses (ver mediaAdicionaisHabituais, apurado por
//     quem chama esta função). NÃO reflete o mecanismo principal de
//     compensação de horas extras deste sistema, que é banco de horas (tempo,
//     não dinheiro) — se extras viraram folga em vez de pagamento, não há
//     "média salarial" real para refletir; e o saldo de banco de horas em si
//     já é liquidado à parte (ver saldoBancoHorasMin abaixo). Comissões não
//     existem no sistema.
//   - Saldo de banco de horas pago à hora simples, com o divisor derivado da
//     jornada real do colaborador quando informada (ver getDivisorHoraMensal)
//     — sem distinguir se cada hora foi acumulada dentro ou fora do prazo de
//     compensação (o que mudaria a base para hora+50%) — simplificação.
//   - Saldo negativo de banco de horas só é descontado em rescisões por
//     iniciativa do colaborador (pedido de demissão / acordo mútuo); em
//     dispensa sem justa causa e justa causa, o débito não é descontado
//     (jurisprudência diverge sobre a dedução unilateral pelo empregador).

// Regras por tipo de rescisão:
//   avisoFactor              — fração do aviso prévio integral que é paga (0, 0.5 ou 1)
//   projetaAviso             — se o aviso pago projeta o contrato p/ 13º e férias
//   direito13Proporcional    — se há direito a 13º proporcional
//   direitoFeriasProporcional— se há direito a férias proporcionais + 1/3
//   multaFgtsFactor          — fração da multa sobre o FGTS (0, 0.20 ou 0.40)
//   descontaBancoHorasNegativo — se um saldo negativo de banco de horas é
//                                descontado do total (só quando a rescisão
//                                parte do colaborador)
const TIPOS_RESCISAO = {
    sem_justa_causa: {
        label: 'Sem Justa Causa (dispensa pelo empregador)',
        avisoFactor: 1, projetaAviso: true,
        direito13Proporcional: true, direitoFeriasProporcional: true,
        multaFgtsFactor: 0.40, descontaBancoHorasNegativo: false,
    },
    pedido_demissao: {
        label: 'Pedido de Demissão',
        avisoFactor: 0, projetaAviso: false,
        direito13Proporcional: true, direitoFeriasProporcional: true,
        multaFgtsFactor: 0, descontaBancoHorasNegativo: true,
    },
    acordo_mutuo: {
        label: 'Acordo Mútuo (Distrato — art. 484-A CLT)',
        avisoFactor: 0.5, projetaAviso: false,
        direito13Proporcional: true, direitoFeriasProporcional: true,
        multaFgtsFactor: 0.20, descontaBancoHorasNegativo: true,
    },
    justa_causa: {
        label: 'Justa Causa (falta grave do empregado)',
        avisoFactor: 0, projetaAviso: false,
        direito13Proporcional: false, direitoFeriasProporcional: false,
        multaFgtsFactor: 0, descontaBancoHorasNegativo: false,
    },
};

// Divisor pra converter salário mensal em valor-hora, derivado da jornada real do
// colaborador (mesma fórmula usada na folha brasileira: horas semanais × 5 — de onde
// vem o clássico 220 pra jornada de 44h/semana). jornadaMin é sempre "minutos diários
// assumindo semana de 5 dias" (mesma premissa de getJornadaMinRH em pagamentos.js), daí
// horasSemanais = jornadaMin/60*5 e divisor = horasSemanais*5.
// 12x36 é exceção: a fórmula "jornada×5" não faz sentido pra uma escala que não é de
// 5 dias — mantém 220 como convenção prática (o próprio tema é controverso: convenções
// coletivas usam divisores diferentes entre si), simplificação documentada.
function getDivisorHoraMensal(jornadaMin, workLoad) {
    if (!jornadaMin) return 220;
    if (workLoad === '12x36') return 220;
    const horasSemanais = (jornadaMin / 60) * 5;
    return Math.round(horasSemanais * 5);
}

function minToStrRescisao(min) {
    const abs = Math.abs(Math.round(min));
    return `${min < 0 ? '-' : ''}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, '0')}min`;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function diffInMonths(start, end) {
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

// Avos (0–12) de um período que vai de `inicio` até `fimProjetado`, contando
// um mês como "trabalhado" apenas se atingiu 15 dias corridos nele.
function calcAvos(inicio, fimProjetado) {
    let meses = diffInMonths(inicio, fimProjetado);
    if (fimProjetado.getDate() < 15) meses -= 1;
    return Math.max(0, Math.min(12, meses));
}

function diasAvisoPrevioIntegral(anosCompletos) {
    return Math.min(30 + 3 * anosCompletos, 90);
}

function inicioPeriodoAquisitivoFerias(admissao, demissao) {
    const aniversario = new Date(demissao.getFullYear(), admissao.getMonth(), admissao.getDate());
    if (aniversario > demissao) aniversario.setFullYear(aniversario.getFullYear() - 1);
    return aniversario;
}

// Recebe { tipo, salario (número), admissao (Date), demissao (Date),
// saldoBancoHorasMin (minutos, real, positivo ou negativo — opcional),
// jornadaMin (minutos diários, opcional — ajusta o divisor do banco de horas),
// workLoad (string, opcional — só usada pra identificar escala 12x36),
// mediaAdicionaisHabituais (R$/mês, opcional — reflexo Súmula 347 TST na base do
// 13º/férias, apurado por quem chama esta função) } e retorna o detalhamento da
// rescisão para o tipo informado.
function calcularRescisao({ tipo, salario, admissao, demissao, saldoBancoHorasMin = 0, jornadaMin = null, workLoad = '', mediaAdicionaisHabituais = 0 }) {
    const config = TIPOS_RESCISAO[tipo] || TIPOS_RESCISAO.sem_justa_causa;
    const diaria = salario / 30;
    // Súmula 347 TST: adicionais habituais (noturno/feriado efetivamente pagos, ver
    // header do arquivo) integram a base de 13º/férias, não só o salário fixo.
    const baseFerias13 = salario + mediaAdicionaisHabituais;

    const mesesCasaAteDemissao = diffInMonths(admissao, demissao);
    const anosCompletos = Math.floor(mesesCasaAteDemissao / 12);

    const diasAvisoIntegral = diasAvisoPrevioIntegral(anosCompletos);
    const diasAviso = Math.round(diasAvisoIntegral * config.avisoFactor);
    const avisoPrevioValor = diasAviso > 0 ? +(diaria * diasAviso).toFixed(2) : 0;

    const dataProjetada = (config.projetaAviso && diasAviso > 0) ? addDays(demissao, diasAviso) : demissao;

    const saldoSalario = +(diaria * demissao.getDate()).toFixed(2);

    let avos13 = 0, decimoTerceiroProporcional = 0;
    if (config.direito13Proporcional) {
        avos13 = calcAvos(new Date(demissao.getFullYear(), 0, 1), dataProjetada);
        decimoTerceiroProporcional = +((baseFerias13 / 12) * avos13).toFixed(2);
    }

    let avosFerias = 0, feriasProporcionais = 0, tercoConstitucional = 0;
    if (config.direitoFeriasProporcional) {
        const inicioAquisitivo = inicioPeriodoAquisitivoFerias(admissao, demissao);
        avosFerias = calcAvos(inicioAquisitivo, dataProjetada);
        feriasProporcionais = +((baseFerias13 / 12) * avosFerias).toFixed(2);
        tercoConstitucional = +(feriasProporcionais / 3).toFixed(2);
    }

    const mesesFgts    = Math.max(0, diffInMonths(admissao, dataProjetada));
    const fgtsEstimado = +(salario * 0.08 * mesesFgts).toFixed(2);
    const multaFgts    = +(fgtsEstimado * config.multaFgtsFactor).toFixed(2);

    const verbas = [
        { descricao: 'Saldo de Salário', dias: demissao.getDate(), valor: saldoSalario },
    ];
    if (avisoPrevioValor > 0) {
        verbas.push({
            descricao: config.avisoFactor < 1 ? 'Aviso Prévio Indenizado (parcial)' : 'Aviso Prévio Indenizado',
            dias: diasAviso, valor: avisoPrevioValor,
        });
    }
    const notaMedias = mediaAdicionaisHabituais > 0 ? ' + médias habituais' : '';
    if (config.direito13Proporcional) {
        verbas.push({ descricao: '13º Salário Proporcional', dias: `${avos13}/12${notaMedias}`, valor: decimoTerceiroProporcional });
    }
    if (config.direitoFeriasProporcional) {
        verbas.push({ descricao: 'Férias Proporcionais',         dias: `${avosFerias}/12${notaMedias}`, valor: feriasProporcionais });
        verbas.push({ descricao: '1/3 Constitucional de Férias', dias: '—',                valor: tercoConstitucional });
    }

    // Saldo real de banco de horas (time_records + bank_adjustments do período todo de
    // casa, apurado por quem chama esta função). Positivo é pago; negativo só é
    // descontado nas rescisões por iniciativa do colaborador (ver descontaBancoHorasNegativo).
    const valorHora = salario / getDivisorHoraMensal(jornadaMin, workLoad);
    if (saldoBancoHorasMin > 0) {
        const valorBancoHoras = +((saldoBancoHorasMin / 60) * valorHora).toFixed(2);
        verbas.push({ descricao: 'Saldo de Banco de Horas', dias: minToStrRescisao(saldoBancoHorasMin), valor: valorBancoHoras });
    } else if (saldoBancoHorasMin < 0 && config.descontaBancoHorasNegativo) {
        const valorDesconto = +((saldoBancoHorasMin / 60) * valorHora).toFixed(2); // já negativo
        verbas.push({ descricao: 'Desconto de Saldo Negativo de Banco de Horas', dias: minToStrRescisao(saldoBancoHorasMin), valor: valorDesconto });
    }

    const encargos = [];
    if (multaFgts > 0) {
        encargos.push({ descricao: `Multa de ${Math.round(config.multaFgtsFactor * 100)}% sobre FGTS (estimado)`, dias: '—', valor: multaFgts });
    }

    const totalVerbas   = +verbas.reduce((s, v) => s + v.valor, 0).toFixed(2);
    const totalEncargos = +encargos.reduce((s, v) => s + v.valor, 0).toFixed(2);
    const custoTotal    = +(totalVerbas + totalEncargos).toFixed(2);

    return {
        tipo, label: config.label,
        anosCompletos, mesesCasaAteDemissao, diasAviso, fgtsEstimado, saldoBancoHorasMin, mediaAdicionaisHabituais,
        verbas, encargos, totalVerbas, totalEncargos, custoTotal,
    };
}

window.TIPOS_RESCISAO     = TIPOS_RESCISAO;
window.calcularRescisao   = calcularRescisao;

// Inerte no navegador (module não existe lá) — permite `require()` deste arquivo
// nos testes automatizados (ver test/) sem precisar de bundler.
if (typeof module !== 'undefined' && module.exports) module.exports = { TIPOS_RESCISAO, calcularRescisao, getDivisorHoraMensal };
