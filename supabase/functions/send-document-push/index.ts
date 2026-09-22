import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { isBusinessHours } from "../_shared/quiet-hours.mjs";
import { isValidDocumentIds, groupDocumentsByEmployee, documentPushMessage, filterEmployeeIdsByPref, isStalePushError } from "../_shared/push-format.mjs";
import { corsHeadersFor } from "../_shared/cors.ts";
import { mfaSatisfied, MFA_REQUIRED_MESSAGE } from "../_shared/mfa.ts";

const QUIET_HOURS = {
  startHour: Number(Deno.env.get("QUIET_HOURS_START_HOUR") ?? "8"),
  endHour: Number(Deno.env.get("QUIET_HOURS_END_HOUR") ?? "18"),
};

webpush.setVapidDetails(
  "mailto:suporte@nexus-nine-zeta.vercel.app",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const MAX_DOCUMENTS = 50;

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body?.document_ids) ? body.document_ids : [];
    if (!isValidDocumentIds(ids, MAX_DOCUMENTS)) {
      return json({ error: "document_ids inválido" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado" }, 401);

    const callerClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: "Não autorizado" }, 401);

    const { data: profile } = await callerClient.from("profiles").select("profile").eq("id", user.id).single();
    if (profile?.profile !== "Administrador") return json({ error: "Acesso restrito ao Administrador" }, 403);
    if (!mfaSatisfied(user, authHeader, true)) return json({ error: MFA_REQUIRED_MESSAGE }, 403);

    // Direito à desconexão: fora do horário comercial não há push; o aviso continua na tela inicial do colaborador.
    if (!isBusinessHours(new Date(), QUIET_HOURS)) return json({ sent: 0, skipped: "fora_do_horario" });

    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: docs } = await adminClient
      .from("documents")
      .select("id, employee_id, tipo, requer_assinatura")
      .in("id", ids)
      .eq("source", "Administrador")
      .eq("is_current", true)
      .not("employee_id", "is", null);
    if (!docs?.length) return json({ sent: 0 });

    const byEmployee = groupDocumentsByEmployee(docs);

    const employeeIds = [...byEmployee.keys()];
    const { data: employees } = await adminClient.from("employees").select("id, notif_prefs").in("id", employeeIds);
    const allowed = new Set(filterEmployeeIdsByPref(employees, "documentos"));
    if (!allowed.size) return json({ sent: 0 });

    const { data: subs } = await adminClient
      .from("push_subscriptions")
      .select("id, employee_id, endpoint, p256dh, auth")
      .in("employee_id", [...allowed]);

    let sent = 0;
    const staleIds: string[] = [];

    await Promise.all(
      (subs ?? []).map(async (sub) => {
        const entry = byEmployee.get(sub.employee_id)!;
        const payload = JSON.stringify({ ...documentPushMessage(entry), url: "/src/screens/documentos-colaborador.html" });
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          sent++;
        } catch (err) {
          if (isStalePushError(err)) staleIds.push(sub.id);
        }
      }),
    );

    if (staleIds.length) await adminClient.from("push_subscriptions").delete().in("id", staleIds);

    return json({ sent });
  } catch (e) {
    console.error("send-document-push:", e instanceof Error ? e.message : e);
    return json({ error: "Não foi possível enviar a notificação" }, 500);
  }
});
