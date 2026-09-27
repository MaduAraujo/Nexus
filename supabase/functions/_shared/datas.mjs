const FORMATO_SAO_PAULO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

export function hojeSaoPaulo(agora = new Date()) {
    return FORMATO_SAO_PAULO.format(agora);
}

export function inicioDoDia(dataISO) {
    return new Date(`${dataISO}T00:00:00`);
}
