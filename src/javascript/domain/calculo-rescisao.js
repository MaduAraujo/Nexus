const TIPOS_RESCISAO = {
    sem_justa_causa: {
        label: 'Sem Justa Causa (dispensa pelo empregador)',
        avisoFactor: 1,
        projetaAviso: true,
        direito13Proporcional: true,
        direitoFeriasProporcional: true,
        multaFgtsFactor: 0.4,
        descontaBancoHorasNegativo: false,
    },
    pedido_demissao: {
        label: 'Pedido de Demissão',
        avisoFactor: 0,
        projetaAviso: false,
        direito13Proporcional: true,
        direitoFeriasProporcional: true,
        multaFgtsFactor: 0,
        descontaBancoHorasNegativo: true,
    },
    acordo_mutuo: {
        label: 'Acordo Mútuo (Distrato — art. 484-A CLT)',
        avisoFactor: 0.5,
        projetaAviso: false,
        direito13Proporcional: true,
        direitoFeriasProporcional: true,
        multaFgtsFactor: 0.2,
        descontaBancoHorasNegativo: true,
    },
    justa_causa: {
        label: 'Justa Causa (falta grave do empregado)',
        avisoFactor: 0,
        projetaAviso: false,
        direito13Proporcional: false,
        direitoFeriasProporcional: false,
        multaFgtsFactor: 0,
        descontaBancoHorasNegativo: false,
    },
};

const RESCISAO_APRENDIZ_BASE = {
    avisoFactor: 0,
    projetaAviso: false,
    direito13Proporcional: true,
    direitoFeriasProporcional: true,
    multaFgtsFactor: 0,
    descontaBancoHorasNegativo: false,
    indenizacao479: false,
};

const TIPOS_RESCISAO_APRENDIZ = {
    aprendiz_termino: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Término do contrato de aprendizagem ou aprendiz completou 24 anos (CLT art. 433)',
    },
    aprendiz_desempenho: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Extinção antecipada — desempenho insuficiente ou inadaptação (CLT art. 433, I)',
    },
    aprendiz_falta_grave: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Extinção antecipada — falta disciplinar grave (CLT art. 433, II)',
        direito13Proporcional: false,
        direitoFeriasProporcional: false,
    },
    aprendiz_ausencia_escolar: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Extinção antecipada — ausência injustificada à escola com perda do ano letivo (CLT art. 433, III)',
    },
    aprendiz_pedido: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Extinção antecipada — a pedido do aprendiz (CLT art. 433, IV)',
    },
    aprendiz_sem_justa_causa: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Dispensa antecipada sem justa causa (fora das hipóteses do art. 433 — CLT art. 479)',
        multaFgtsFactor: 0.4,
        indenizacao479: true,
    },
};

const EQUIVALENTE_APRENDIZ = {
    sem_justa_causa: 'aprendiz_sem_justa_causa',
    pedido_demissao: 'aprendiz_pedido',
    justa_causa: 'aprendiz_falta_grave',
};

function configRescisaoAprendiz(tipo) {
    return TIPOS_RESCISAO_APRENDIZ[tipo] || TIPOS_RESCISAO_APRENDIZ[EQUIVALENTE_APRENDIZ[tipo]] || TIPOS_RESCISAO_APRENDIZ.aprendiz_termino;
}

const TIPOS_RESCISAO_PRAZO = {
    prazo_termino: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Término do contrato por prazo determinado na data combinada (CLT art. 443)',
    },
    prazo_sem_justa_causa: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Dispensa antecipada sem justa causa (CLT art. 479)',
        multaFgtsFactor: 0.4,
        indenizacao479: true,
    },
    prazo_pedido: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Pedido de demissão antes do término (CLT art. 480)',
        descontaBancoHorasNegativo: true,
        aviso480: true,
    },
    prazo_justa_causa: {
        ...RESCISAO_APRENDIZ_BASE,
        label: 'Justa Causa (falta grave do empregado — CLT art. 482)',
        direito13Proporcional: false,
        direitoFeriasProporcional: false,
    },
};

const EQUIVALENTE_PRAZO = {
    sem_justa_causa: 'prazo_sem_justa_causa',
    pedido_demissao: 'prazo_pedido',
    justa_causa: 'prazo_justa_causa',
};

function configRescisaoPrazo(tipo) {
    return TIPOS_RESCISAO_PRAZO[tipo] || TIPOS_RESCISAO_PRAZO[EQUIVALENTE_PRAZO[tipo]] || TIPOS_RESCISAO_PRAZO.prazo_termino;
}

function getDivisorHoraMensal(jornadaMin, workLoad) {
    return CLTDomain.getDivisorHoraMensal(jornadaMin, workLoad);
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

function diasAvisoPrevioIntegral(anosCompletos) {
    return CLTDomain.diasAvisoPrevioIntegral(anosCompletos);
}

function inicioPeriodoAquisitivoFerias(admissao, demissao) {
    const aniversario = new Date(demissao.getFullYear(), admissao.getMonth(), admissao.getDate());
    if (aniversario > demissao) aniversario.setFullYear(aniversario.getFullYear() - 1);
    return aniversario;
}

function feriasVencidasNaRescisao({ admissao, dataProjetada, demissao, diasGozados = 0 }) {
    let restante = Math.max(0, Number(diasGozados) || 0);
    let simples = 0,
        dobro = 0;
    for (let n = 1; ; n++) {
        const aniversario = new Date(admissao.getFullYear() + n, admissao.getMonth(), admissao.getDate());
        if (aniversario > dataProjetada) break;
        const consumido = Math.min(restante, 30);
        restante -= consumido;
        const pendente = 30 - consumido;
        const fimConcessivo = new Date(aniversario.getFullYear() + 1, aniversario.getMonth(), aniversario.getDate() - 1);
        if (demissao > fimConcessivo) dobro += pendente;
        else simples += pendente;
    }
    return { simples, dobro };
}

function isoLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calcularRescisaoEstagio({ tipo, salario, admissao, demissao, recessoGozadoDias = 0 }) {
    const diaria = salario / 30;
    const saldoSalario = +(diaria * demissao.getDate()).toFixed(2);
    const mesesTotais = diffInMonths(admissao, demissao) + (demissao.getDate() >= admissao.getDate() ? 0 : -1);
    const recessoCalc = EstagioDomain.recessoNaRescisao({
        admissaoISO: isoLocal(admissao),
        desligamentoISO: isoLocal(demissao),
        gozados: Number(recessoGozadoDias) || 0,
    });
    const diasRecesso = recessoCalc.dias;
    const recesso = +(diaria * diasRecesso).toFixed(2);
    const verbas = [{ descricao: 'Saldo de Bolsa', dias: demissao.getDate(), valor: saldoSalario }];
    if (recesso > 0) verbas.push({ descricao: 'Recesso Proporcional (Lei 11.788 art. 13)', dias: diasRecesso, valor: recesso });
    const totalVerbas = +verbas.reduce((s, v) => s + v.valor, 0).toFixed(2);
    return {
        tipo,
        label: 'Encerramento de Estágio (Lei 11.788/08)',
        anosCompletos: Math.floor(Math.max(0, mesesTotais) / 12),
        mesesCasaAteDemissao: diffInMonths(admissao, demissao),
        diasAviso: 0,
        fgtsEstimado: 0,
        saldoBancoHorasMin: 0,
        mediaAdicionaisHabituais: 0,
        verbas,
        encargos: [],
        totalVerbas,
        totalEncargos: 0,
        custoTotal: totalVerbas,
        recessoDevidoDias: recessoCalc.devidos,
        recessoGozadoDias: recessoCalc.gozados,
        estagio: true,
    };
}

function calcularRescisaoPJ({ tipo, salario, admissao, demissao }) {
    const saldoServicos = +((salario / 30) * demissao.getDate()).toFixed(2);
    const mesesTotais = Math.max(0, diffInMonths(admissao, demissao));
    const verbas = [{ descricao: 'Saldo de Serviços Prestados no Mês', dias: demissao.getDate(), valor: saldoServicos }];
    return {
        tipo,
        label: 'Encerramento de Contrato de Prestação de Serviços (PJ)',
        anosCompletos: Math.floor(mesesTotais / 12),
        mesesCasaAteDemissao: mesesTotais,
        diasAviso: 0,
        fgtsEstimado: 0,
        saldoBancoHorasMin: 0,
        mediaAdicionaisHabituais: 0,
        verbas,
        encargos: [],
        totalVerbas: saldoServicos,
        totalEncargos: 0,
        custoTotal: saldoServicos,
        pj: true,
    };
}

function calcularRescisaoTemporario({ tipo, admissao, demissao }) {
    const mesesTotais = Math.max(0, diffInMonths(admissao, demissao));
    return {
        tipo,
        label: 'Encerramento de contrato temporário (Lei 6.019/1974) — verbas pagas pela empresa de trabalho temporário',
        anosCompletos: Math.floor(mesesTotais / 12),
        mesesCasaAteDemissao: mesesTotais,
        diasAviso: 0,
        fgtsEstimado: 0,
        saldoBancoHorasMin: 0,
        mediaAdicionaisHabituais: 0,
        verbas: [],
        encargos: [],
        totalVerbas: 0,
        totalEncargos: 0,
        custoTotal: 0,
        temporario: true,
    };
}

function calcularRescisao({
    tipo,
    salario,
    admissao,
    demissao,
    saldoBancoHorasMin = 0,
    jornadaMin = null,
    workLoad = '',
    mediaAdicionaisHabituais = 0,
    contractType = 'clt',
    contratoFim = null,
    recessoGozadoDias = 0,
    adicionalFixo = 0,
    diasFeriasGozados = 0,
    avisoEmpregado = 'cumprido',
}) {
    if (CLTDomain.isEstagio(contractType)) return calcularRescisaoEstagio({ tipo, salario, admissao, demissao, recessoGozadoDias });
    if (CLTDomain.isPJ(contractType)) return calcularRescisaoPJ({ tipo, salario, admissao, demissao });
    if (CLTDomain.isTemporario(contractType)) return calcularRescisaoTemporario({ tipo, admissao, demissao });
    const aprendiz = CLTDomain.isAprendiz(contractType);
    const prazoDeterminado = CLTDomain.isPrazoDeterminado(contractType);
    const config = aprendiz
        ? configRescisaoAprendiz(tipo)
        : prazoDeterminado
          ? configRescisaoPrazo(tipo)
          : TIPOS_RESCISAO[tipo] || TIPOS_RESCISAO.sem_justa_causa;
    const remuneracao = salario + adicionalFixo;
    const diaria = remuneracao / 30;
    const baseFerias13 = remuneracao + mediaAdicionaisHabituais;
    const diariaComMedias = baseFerias13 / 30;

    const mesesCasaAteDemissao = diffInMonths(admissao, demissao);
    const anosCompletos = Math.floor(mesesCasaAteDemissao / 12);

    const diasAvisoIntegral = diasAvisoPrevioIntegral(anosCompletos);
    const diasAviso = Math.round(diasAvisoIntegral * config.avisoFactor);
    const avisoPrevioValor = diasAviso > 0 ? +(diariaComMedias * diasAviso).toFixed(2) : 0;

    const dataProjetada = config.projetaAviso && diasAviso > 0 ? addDays(demissao, diasAviso) : demissao;

    const saldoSalario = +(diaria * demissao.getDate()).toFixed(2);

    let avos13 = 0,
        decimoTerceiroProporcional = 0;
    if (config.direito13Proporcional) {
        const inicioAno = new Date(demissao.getFullYear(), 0, 1);
        avos13 = CLTDomain.avosDecimoTerceiro(admissao > inicioAno ? admissao : inicioAno, dataProjetada);
        decimoTerceiroProporcional = +((baseFerias13 / 12) * avos13).toFixed(2);
    }

    let avosFerias = 0,
        feriasProporcionais = 0,
        tercoConstitucional = 0;
    if (config.direitoFeriasProporcional) {
        const inicioAquisitivo = inicioPeriodoAquisitivoFerias(admissao, dataProjetada);
        avosFerias = CLTDomain.avosPeriodoAquisitivo(inicioAquisitivo, dataProjetada);
        feriasProporcionais = +((baseFerias13 / 12) * avosFerias).toFixed(2);
        tercoConstitucional = +(feriasProporcionais / 3).toFixed(2);
    }

    const mesesFgts = Math.max(0, diffInMonths(admissao, dataProjetada));
    const fgtsEstimado = +(remuneracao * CLTDomain.aliquotaFGTS(contractType) * mesesFgts).toFixed(2);
    const vencidas = feriasVencidasNaRescisao({ admissao, dataProjetada, demissao, diasGozados: diasFeriasGozados });
    const multaFgts = +(fgtsEstimado * config.multaFgtsFactor).toFixed(2);

    const verbas = [{ descricao: 'Saldo de Salário', dias: demissao.getDate(), valor: saldoSalario }];
    if (avisoPrevioValor > 0) {
        verbas.push({
            descricao: config.avisoFactor < 1 ? 'Aviso Prévio Indenizado (parcial)' : 'Aviso Prévio Indenizado',
            dias: diasAviso,
            valor: avisoPrevioValor,
        });
    }
    const notaMedias = mediaAdicionaisHabituais > 0 ? ' + médias habituais' : '';
    if (config.direito13Proporcional) {
        verbas.push({ descricao: '13º Salário Proporcional', dias: `${avos13}/12${notaMedias}`, valor: decimoTerceiroProporcional });
    }
    if (config.direitoFeriasProporcional) {
        verbas.push({ descricao: 'Férias Proporcionais', dias: `${avosFerias}/12${notaMedias}`, valor: feriasProporcionais });
        verbas.push({ descricao: '1/3 Constitucional de Férias', dias: '—', valor: tercoConstitucional });
    }
    if (vencidas.simples > 0) {
        const valor = +(diariaComMedias * vencidas.simples).toFixed(2);
        verbas.push({ descricao: 'Férias Vencidas (CLT art. 146)', dias: vencidas.simples, valor });
        verbas.push({ descricao: '1/3 Constitucional sobre Férias Vencidas', dias: '—', valor: +(valor / 3).toFixed(2) });
    }
    if (vencidas.dobro > 0) {
        const valor = +(diariaComMedias * vencidas.dobro * 2).toFixed(2);
        verbas.push({ descricao: 'Férias Vencidas em Dobro — prazo de concessão perdido (CLT art. 137)', dias: vencidas.dobro, valor });
        verbas.push({ descricao: '1/3 Constitucional sobre Férias em Dobro', dias: '—', valor: +(valor / 3).toFixed(2) });
    }
    const descontaAvisoEmpregado = tipo === 'pedido_demissao' && !aprendiz && !prazoDeterminado && avisoEmpregado === 'descontar';
    if (descontaAvisoEmpregado) {
        verbas.push({
            descricao: 'Desconto do Aviso Prévio não cumprido pelo empregado (CLT art. 487 §2º)',
            dias: CLTDomain.DIAS_AVISO_EMPREGADO,
            valor: -+(diaria * CLTDomain.DIAS_AVISO_EMPREGADO).toFixed(2),
        });
    }
    const contratoFimAusente = !!config.indenizacao479 && !contratoFim;
    if (config.indenizacao479 && contratoFim > demissao) {
        const diasRestantes = CLTDomain.diasCorridosInclusive(addDays(demissao, 1), contratoFim);
        verbas.push({
            descricao: 'Indenização art. 479 CLT (metade dos salários até o término do contrato)',
            dias: diasRestantes,
            valor: +((diaria * diasRestantes) / 2).toFixed(2),
        });
    }

    const valorHora = remuneracao / getDivisorHoraMensal(jornadaMin, workLoad);
    if (saldoBancoHorasMin > 0 && aprendiz) {
        verbas.push({
            descricao: 'Horas Excedentes do Aprendiz com adicional de 50% (sem compensação — CLT art. 432)',
            dias: minToStrRescisao(saldoBancoHorasMin),
            valor: +((saldoBancoHorasMin / 60) * valorHora * 1.5).toFixed(2),
        });
    } else if (saldoBancoHorasMin > 0) {
        const valorBancoHoras = +((saldoBancoHorasMin / 60) * valorHora).toFixed(2);
        verbas.push({ descricao: 'Saldo de Banco de Horas', dias: minToStrRescisao(saldoBancoHorasMin), valor: valorBancoHoras });
    } else if (saldoBancoHorasMin < 0 && config.descontaBancoHorasNegativo) {
        const valorDesconto = +((saldoBancoHorasMin / 60) * valorHora).toFixed(2);
        verbas.push({ descricao: 'Desconto de Saldo Negativo de Banco de Horas', dias: minToStrRescisao(saldoBancoHorasMin), valor: valorDesconto });
    }

    const encargos = [];
    if (multaFgts > 0) {
        encargos.push({ descricao: `Multa de ${Math.round(config.multaFgtsFactor * 100)}% sobre FGTS (estimado)`, dias: '—', valor: multaFgts });
    }

    const totalVerbas = +verbas.reduce((s, v) => s + v.valor, 0).toFixed(2);
    const totalEncargos = +encargos.reduce((s, v) => s + v.valor, 0).toFixed(2);
    const custoTotal = +(totalVerbas + totalEncargos).toFixed(2);

    return {
        tipo,
        label: config.label,
        anosCompletos,
        mesesCasaAteDemissao,
        diasAviso,
        fgtsEstimado,
        saldoBancoHorasMin,
        mediaAdicionaisHabituais,
        verbas,
        encargos,
        totalVerbas,
        totalEncargos,
        custoTotal,
        aprendiz,
        prazoDeterminado,
        contratoFimAusente,
        aviso480: !!config.aviso480,
        adicionalFixo,
        feriasVencidas: vencidas,
        prazoPagamento: isoLocal(addDays(demissao, CLTDomain.PRAZO_PAGAMENTO_RESCISAO_DIAS)),
    };
}

window.TIPOS_RESCISAO = TIPOS_RESCISAO;
window.TIPOS_RESCISAO_APRENDIZ = TIPOS_RESCISAO_APRENDIZ;
window.TIPOS_RESCISAO_PRAZO = TIPOS_RESCISAO_PRAZO;
window.calcularRescisao = calcularRescisao;

if (typeof module !== 'undefined' && module.exports)
    module.exports = { TIPOS_RESCISAO, TIPOS_RESCISAO_APRENDIZ, TIPOS_RESCISAO_PRAZO, calcularRescisao, getDivisorHoraMensal, feriasVencidasNaRescisao };
