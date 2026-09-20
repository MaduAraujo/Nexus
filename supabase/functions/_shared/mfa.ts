export function aalFromAuthHeader(authHeader: string | null): string {
  const token = (authHeader ?? "").replace(/^Bearer\s+/i, "");
  const payload = token.split(".")[1];
  if (!payload) return "";
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return String(JSON.parse(json).aal ?? "");
  } catch {
    return "";
  }
}

export function mfaSatisfied(
  user: { factors?: { status?: string }[] | null },
  authHeader: string | null,
  required: boolean,
): boolean {
  if (aalFromAuthHeader(authHeader) === "aal2") return true;
  if (required) return false;
  return !(user.factors ?? []).some((f) => f.status === "verified");
}

export const MFA_REQUIRED_MESSAGE = "Confirme o código da verificação em duas etapas para continuar.";