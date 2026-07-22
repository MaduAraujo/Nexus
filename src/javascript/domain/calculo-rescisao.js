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

function calcAvos(inicio, fimProjetado) {
    let meses = diffInMonths(inicio, fimProjetado);
    if (fimProjetado.getDate() < 15) meses -= 1;
    return Math.max(0, Math.min(12, meses));
}

function diasAvisoPrevioIntegral(anosCompletos) {
    return CLTDomain.diasAvisoPrevioIntegral(anosCompletos);
}

function inicioPeriodoAquisitivoFerias(admissao, demissao) {
    const aniversario = new Date(demissao.getFullYear(), admissao.getMonth(), admissao.getDate());
    if (aniversario > demissao) aniversario.setFullYear(aniversario.getFullYear() - 1);
    return aniversario;
}

function calcularRescisao({ tipo, salario, admissao, demissao, saldoBancoHorasMin = 0, jornadaMin = null, workLoad = '', mediaAdicionaisHabituais = 0 }) {
    const config = TIPOS_RESCISAO[tipo] || TIPOS_RESCISAO.sem_justa_causa;
    const diaria = salario / 30;
    const baseFerias13 = salario + mediaAdicionaisHabituais;

    const mesesCasaAteDemissao = diffInMonths(admissao, demissao);
    const anosCompletos = Math.floor(mesesCasaAteDemissao / 12);

    const diasAvisoIntegral = diasAvisoPrevioIntegral(anosCompletos);
    const diasAviso = Math.round(diasAvisoIntegral * config.avisoFactor);
    const avisoPrevioValor = diasAviso > 0 ? +(diaria * diasAviso).toFixed(2) : 0;

    const dataProjetada = config.projetaAviso && diasAviso > 0 ? addDays(demissao, diasAviso) : demissao;

    const saldoSalario = +(diaria * demissao.getDate()).toFixed(2);

    let avos13 = 0,
        decimoTerceiroProporcional = 0;
    if (config.direito13Proporcional) {
        avos13 = calcAvos(new Date(demissao.getFullYear(), 0, 1), dataProjetada);
        decimoTerceiroProporcional = +((baseFerias13 / 12) * avos13).toFixed(2);
    }

    let avosFerias = 0,
        feriasProporcionais = 0,
        tercoConstitucional = 0;
    if (config.direitoFeriasProporcional) {
        const inicioAquisitivo = inicioPeriodoAquisitivoFerias(admissao, demissao);
        avosFerias = calcAvos(inicioAquisitivo, dataProjetada);
        feriasProporcionais = +((baseFerias13 / 12) * avosFerias).toFixed(2);
        tercoConstitucional = +(feriasProporcionais / 3).toFixed(2);
    }

    const mesesFgts = Math.max(0, diffInMonths(admissao, dataProjetada));
    const fgtsEstimado = +(salario * 0.08 * mesesFgts).toFixed(2);
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

    const valorHora = salario / getDivisorHoraMensal(jornadaMin, workLoad);
    if (saldoBancoHorasMin > 0) {
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
    };
}

window.TIPOS_RESCISAO = TIPOS_RESCISAO;
window.calcularRescisao = calcularRescisao;

if (typeof module !== 'undefined' && module.exports) module.exports = { TIPOS_RESCISAO, calcularRescisao, getDivisorHoraMensal };