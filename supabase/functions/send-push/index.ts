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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message_id } = await req.json();
    if (!message_id) {
      return new Response(JSON.stringify({ error: "message_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    const isSystemCall = authHeader === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;

    if (!isSystemCall) {
      const callerClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader! } } }
      );

      const { data: { user }, error: userErr } = await callerClient.auth.getUser();
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: "Não autorizado" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: profile } = await callerClient
        .from("profiles")
        .select("profile")
        .eq("id", user.id)
        .single();

      if (profile?.profile !== "Administrador") {
        return new Response(JSON.stringify({ error: "Acesso restrito ao Administrador" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: message } = await adminClient
      .from("messages")
      .select("texto, categoria, destino, scheduled_at")
      .eq("id", message_id)
      .single();

    if (!message) {
      return new Response(JSON.stringify({ error: "Comunicado não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    if (!isBusinessHours(now)) {
      if (!message.scheduled_at || new Date(message.scheduled_at) <= now) {
        await adminClient
          .from("messages")
          .update({ scheduled_at: nextBusinessHourStart(now).toISOString() })
          .eq("id", message_id);
      }
      return new Response(JSON.stringify({ sent: 0, deferred: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let employeeQuery = adminClient.from("employees").select("id, notif_prefs");
    if (message.destino !== "Todos") employeeQuery = employeeQuery.eq("dept", message.destino);
    const { data: employees } = await employeeQuery;

    const employeeIds = (employees ?? [])
      .filter((e) => e.notif_prefs?.comunicados !== false)
      .map((e) => e.id);

    if (!employeeIds.length) {
      await adminClient.from("messages").update({ push_sent_at: now.toISOString() }).eq("id", message_id);
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subs } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("employee_id", employeeIds);

    const plainText = message.texto.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const payload = JSON.stringify({
      title: `Novo comunicado (${message.categoria})`,
      body: plainText.length > 140 ? `${plainText.slice(0, 140)}…` : plainText,
      url: "/src/screens/comunicados-colaborador.html",
    });

    let sent = 0;
    const staleIds: string[] = [];

    await Promise.all(
      (subs ?? []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          sent++;
        } catch (err) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) staleIds.push(sub.id);
        }
      })
    );

    if (staleIds.length) {
      await adminClient.from("push_subscriptions").delete().in("id", staleIds);
    }

    await adminClient.from("messages").update({ push_sent_at: now.toISOString() }).eq("id", message_id);

    return new Response(JSON.stringify({ sent }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
