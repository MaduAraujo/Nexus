import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { isBusinessHours, nextBusinessHourStart } from "../_shared/quiet-hours.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://nexus-nine-zeta.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

webpush.setVapidDetails(
  "mailto:suporte@nexus-nine-zeta.vercel.app",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const ALERT_TABLES: Record<string, { notifPrefKey: string; title: string; url: string }> = {
  compliance_alerts: { notifPrefKey: "compliance", title: "Alerta de compliance", url: "/src/screens/perfil-colaborador.html" },
  burnout_alerts: { notifPrefKey: "burnout", title: "Alerta de sobrecarga", url: "/src/screens/perfil-colaborador.html" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { table, id } = await req.json();
    const cfg = ALERT_TABLES[table];
    if (!cfg || !id) return json({ error: "table/id inválido" }, 400);

    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
      return json({ error: "Não autorizado" }, 401);
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: alert } = await adminClient
      .from(table)
      .select("employee_id, alertas, push_scheduled_at")
      .eq("id", id)
      .single();

    if (!alert) return json({ error: "Alerta não encontrado" }, 404);

    const now = new Date();
    if (!isBusinessHours(now)) {
      if (!alert.push_scheduled_at || new Date(alert.push_scheduled_at) <= now) {
        await adminClient
          .from(table)
          .update({ push_scheduled_at: nextBusinessHourStart(now).toISOString() })
          .eq("id", id);
      }
      return json({ sent: 0, deferred: true });
    }

    const alertas: { titulo?: string }[] = alert.alertas || [];
    const first = alertas[0]?.titulo || cfg.title;
    const bodyText = alertas.length > 1 ? `${first} (+${alertas.length - 1})` : first;
    const payload = JSON.stringify({ title: cfg.title, body: bodyText, url: cfg.url });

    const { data: adminSubs } = await adminClient
      .from("admin_push_subscriptions")
      .select("id, endpoint, p256dh, auth");

    let employeeSubs: { id: string; endpoint: string; p256dh: string; auth: string }[] = [];
    if (alert.employee_id) {
      const { data: employee } = await adminClient
        .from("employees")
        .select("notif_prefs")
        .eq("id", alert.employee_id)
        .single();

      if (employee?.notif_prefs?.[cfg.notifPrefKey] !== false) {
        const { data } = await adminClient
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("employee_id", alert.employee_id);
        employeeSubs = data || [];
      }
    }

    let sent = 0;
    const staleAdminIds: string[] = [];
    const staleEmployeeIds: string[] = [];

    await Promise.all([
      ...(adminSubs || []).map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          sent++;
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) staleAdminIds.push(sub.id);
        }
      }),
      ...employeeSubs.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
          sent++;
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) staleEmployeeIds.push(sub.id);
        }
      }),
    ]);

    if (staleAdminIds.length) await adminClient.from("admin_push_subscriptions").delete().in("id", staleAdminIds);
    if (staleEmployeeIds.length) await adminClient.from("push_subscriptions").delete().in("id", staleEmployeeIds);

    await adminClient.from(table).update({ push_sent_at: now.toISOString() }).eq("id", id);

    return json({ sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
