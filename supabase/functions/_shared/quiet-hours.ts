const BR_OFFSET_MS = 3 * 60 * 60 * 1000;
const QUIET_START_HOUR = Number(Deno.env.get("QUIET_HOURS_START_HOUR") ?? "8");
const QUIET_END_HOUR = Number(Deno.env.get("QUIET_HOURS_END_HOUR") ?? "18");

function toSaoPaulo(date: Date): Date {
  return new Date(date.getTime() - BR_OFFSET_MS);
}

export function isBusinessHours(date: Date): boolean {
  const sp = toSaoPaulo(date);
  const day = sp.getUTCDay();
  const hour = sp.getUTCHours();
  return day >= 1 && day <= 5 && hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
}

export function nextBusinessHourStart(date: Date): Date {
  const sp = toSaoPaulo(date);
  let y = sp.getUTCFullYear(), m = sp.getUTCMonth(), d = sp.getUTCDate();
  if (sp.getUTCHours() >= QUIET_START_HOUR) d += 1;
  let candidate = new Date(Date.UTC(y, m, d, QUIET_START_HOUR, 0, 0, 0));
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return new Date(candidate.getTime() + BR_OFFSET_MS);
}