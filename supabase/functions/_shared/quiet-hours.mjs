const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;
const DIAS_UTEIS = [1, 2, 3, 4, 5];
const BR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

function toSaoPaulo(date) {
    return new Date(date.getTime() - BR_OFFSET_MS);
}

function diaDeTrabalho(diaUtc, { dias = DIAS_UTEIS, escala12x36 = null } = {}) {
    const referencia = escala12x36 ? Date.parse(`${escala12x36}T00:00:00Z`) : NaN;
    if (!Number.isNaN(referencia)) return Math.abs(Math.round((diaUtc - referencia) / DIA_MS)) % 2 === 0;
    return dias.includes(new Date(diaUtc).getUTCDay());
}

export function isBusinessHours(date, { startHour = DEFAULT_START_HOUR, endHour = DEFAULT_END_HOUR, dias, escala12x36 } = {}) {
    const sp = toSaoPaulo(date);
    const hoje = Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate());
    const hour = sp.getUTCHours();
    const trabalha = (dia) => diaDeTrabalho(dia, { dias, escala12x36 });
    if (startHour === endHour) return false;
    if (startHour < endHour) return trabalha(hoje) && hour >= startHour && hour < endHour;
    return (trabalha(hoje) && hour >= startHour) || (trabalha(hoje - DIA_MS) && hour < endHour);
}

const janelaValida = (inicio, fim) => Number.isInteger(inicio) && Number.isInteger(fim) && inicio !== fim;
const diasValidos = (dias) => Array.isArray(dias) && dias.length > 0 && dias.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);

export function janelaDoColaborador(emp, cct, padrao = {}) {
    let horas = { startHour: padrao.startHour ?? DEFAULT_START_HOUR, endHour: padrao.endHour ?? DEFAULT_END_HOUR };
    if (janelaValida(cct?.expediente_inicio, cct?.expediente_fim)) horas = { startHour: cct.expediente_inicio, endHour: cct.expediente_fim };
    if (janelaValida(emp?.expediente_inicio, emp?.expediente_fim)) horas = { startHour: emp.expediente_inicio, endHour: emp.expediente_fim };
    let dias = DIAS_UTEIS;
    if (diasValidos(cct?.expediente_dias)) dias = cct.expediente_dias;
    if (diasValidos(emp?.expediente_dias)) dias = emp.expediente_dias;
    return { ...horas, dias, escala12x36: emp?.escala_12x36_inicio || null };
}

export function separarPorExpediente(employees, ccts, date, padrao = {}) {
    const cctPorId = new Map((ccts || []).map((c) => [c.id, c]));
    const dentro = [];
    const fora = [];
    let proximo = null;
    for (const emp of employees || []) {
        const janela = janelaDoColaborador(emp, cctPorId.get(emp.convencao_coletiva_id), padrao);
        if (isBusinessHours(date, janela)) {
            dentro.push(emp.id);
            continue;
        }
        fora.push(emp.id);
        const inicio = nextBusinessHourStart(date, janela);
        if (!proximo || inicio < proximo) proximo = inicio;
    }
    return { dentro, fora, proximo };
}

export function nextBusinessHourStart(date, { startHour = DEFAULT_START_HOUR, dias, escala12x36 } = {}) {
    const sp = toSaoPaulo(date);
    let dia = Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate());
    if (sp.getUTCHours() >= startHour) dia += DIA_MS;
    for (let i = 0; i < 14 && !diaDeTrabalho(dia, { dias, escala12x36 }); i++) dia += DIA_MS;
    return new Date(dia + startHour * 60 * 60 * 1000 + BR_OFFSET_MS);
}
