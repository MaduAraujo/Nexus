import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { isBusinessHours, separarPorExpediente } from "../_shared/quiet-hours.mjs";
import { isValidChatPushRequest, isStalePushError } from "../_shared/push-format.mjs";
import { corsHeadersFor } from "../_shared/cors.ts";

const QUIET_HOURS = {
  startHour: Number(Deno.env.get("QUIET_HOURS_START_HOUR") ?? "8"),
  endHour: Number(Deno.env.get("QUIET_HOURS_END_HOUR") ?? "18"),
};

webpush.setVapidDetails(
  "mailto:suporte@nexus-nine-zeta.vercel.app",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

type Target = { employee_id: string | null; profile_id: string | null; title: string; body: string; url: string; tag: string };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; employee_id?: string; profile_id?: string };

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    if (!isValidChatPushRequest(body)) return json({ error: "kind/id inválido" }, 400);

    if (req.headers.get("Authorization") !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
      return json({ error: "Não autorizado" }, 401);
    }

    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: targets, error } = await adminClient.rpc("chat_push_targets", { p_kind: body.kind, p_id: body.id });
    if (error) throw new Error(error.message);
    const now = new Date();
    const rhNoExpediente = isBusinessHours(now, QUIET_HOURS);
    let list = ((targets ?? []) as Target[]).filter((t) => t.employee_id || rhNoExpediente);
    const employeeIds = list.filter((t) => t.employee_id).map((t) => t.employee_id!);
    if (employeeIds.length) {
      const [{ data: employees }, { data: ccts }] = await Promise.all([
        adminClient.from("employees").select("id, expediente_inicio, expediente_fim, expediente_dias, escala_12x36_inicio, convencao_coletiva_id").in("id", employeeIds),
        adminClient.from("convencoes_coletivas").select("id, expediente_inicio, expediente_fim, expediente_dias"),
      ]);
      const porId = new Map((employees ?? []).map((e) => [e.id, e]));
      const alvos = employeeIds.map((id) => porId.get(id) ?? { id });
      const dentro = new Set(separarPorExpediente(alvos, ccts, now, QUIET_HOURS).dentro);
      list = list.filter((t) => !t.employee_id || dentro.has(t.employee_id));
    }
    if (!list.length) return json({ sent: 0, ...(targets?.length ? { skipped: "fora_do_horario" } : {}) });

    const byEmployee = new Map(list.filter((t) => t.employee_id).map((t) => [t.employee_id!, t]));
    const byProfile = new Map(list.filter((t) => t.profile_id).map((t) => [t.profile_id!, t]));

    const [{ data: employeeSubs }, { data: adminSubs }] = await Promise.all([
      byEmployee.size
        ? adminClient.from("push_subscriptions").select("id, employee_id, endpoint, p256dh, auth").in("employee_id", [...byEmployee.keys()])
        : Promise.resolve({ data: [] }),
      byProfile.size
        ? adminClient.from("admin_push_subscriptions").select("id, profile_id, endpoint, p256dh, auth").in("profile_id", [...byProfile.keys()])
        : Promise.resolve({ data: [] }),
    ]);

    let sent = 0;
    const staleEmployee: string[] = [];
    const staleAdmin: string[] = [];

    const send = async (sub: Sub, target: Target, stale: string[]) => {
      const payload = JSON.stringify({ title: target.title, body: target.body, url: target.url, tag: target.tag });
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        sent++;
      } catch (err) {
        if (isStalePushError(err)) stale.push(sub.id);
      }
    };

    await Promise.all([
      ...((employeeSubs ?? []) as Sub[]).map((s) => send(s, byEmployee.get(s.employee_id!)!, staleEmployee)),
      ...((adminSubs ?? []) as Sub[]).map((s) => send(s, byProfile.get(s.profile_id!)!, staleAdmin)),
    ]);

    if (staleEmployee.length) await adminClient.from("push_subscriptions").delete().in("id", staleEmployee);
    if (staleAdmin.length) await adminClient.from("admin_push_subscriptions").delete().in("id", staleAdmin);

    return json({ sent });
  } catch (e) {
    console.error("send-chat-push:", e instanceof Error ? e.message : e);
    return json({ error: "Não foi possível enviar a notificação" }, 500);
  }
});
