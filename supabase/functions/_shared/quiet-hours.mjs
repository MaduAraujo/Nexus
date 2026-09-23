const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 18;
const BR_OFFSET_MS = 3 * 60 * 60 * 1000;

function toSaoPaulo(date) {
    return new Date(date.getTime() - BR_OFFSET_MS);
}

export function isBusinessHours(date, { startHour = DEFAULT_START_HOUR, endHour = DEFAULT_END_HOUR } = {}) {
    const sp = toSaoPaulo(date);
    const day = sp.getUTCDay();
    const hour = sp.getUTCHours();
    return day >= 1 && day <= 5 && hour >= startHour && hour < endHour;
}

export function nextBusinessHourStart(date, { startHour = DEFAULT_START_HOUR } = {}) {
    const sp = toSaoPaulo(date);
    let y = sp.getUTCFullYear(),
        m = sp.getUTCMonth(),
        d = sp.getUTCDate();
    if (sp.getUTCHours() >= startHour) d += 1;
    let candidate = new Date(Date.UTC(y, m, d, startHour, 0, 0, 0));
    while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
        candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    }
    return new Date(candidate.getTime() + BR_OFFSET_MS);
}
