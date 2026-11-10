import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { separarPorExpediente } from "../_shared/quiet-hours.mjs";
import { filterEmployeeIdsByPref, plainTextPreview, isStalePushError } from "../_shared/push-format.mjs";
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

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message_id } = await req.json().catch(() => ({}) as Record<string, unknown>);
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

      if (!mfaSatisfied(user, authHeader, true)) {
        return new Response(JSON.stringify({ error: MFA_REQUIRED_MESSAGE }), {
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
      .select("texto, categoria, destino, scheduled_at, push_sent_to")
      .eq("id", message_id)
      .single();

    if (!message) {
      return new Response(JSON.stringify({ error: "Comunicado não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date();
    let employeeQuery = adminClient
      .from("employees")
      .select("id, notif_prefs, expediente_inicio, expediente_fim, expediente_dias, escala_12x36_inicio, convencao_coletiva_id");
    if (message.destino !== "Todos") employeeQuery = employeeQuery.eq("dept", message.destino);
    const [{ data: employees }, { data: ccts }] = await Promise.all([
      employeeQuery,
      adminClient.from("convencoes_coletivas").select("id, expediente_inicio, expediente_fim, expediente_dias"),
    ]);

    const jaEnviados = new Set<string>(message.push_sent_to ?? []);
    const permitidos = new Set(filterEmployeeIdsByPref(employees, "comunicados"));
    const pendentes = (employees ?? []).filter((e) => permitidos.has(e.id) && !jaEnviados.has(e.id));
    const { dentro, fora, proximo } = separarPorExpediente(pendentes, ccts, now, QUIET_HOURS);

    if (!dentro.length && fora.length) {
      const aindaNaoPublicado = !jaEnviados.size && (!message.scheduled_at || new Date(message.scheduled_at) <= now);
      await adminClient
        .from("messages")
        .update(aindaNaoPublicado ? { scheduled_at: proximo!.toISOString() } : { push_next_at: proximo!.toISOString() })
        .eq("id", message_id);
      return new Response(JSON.stringify({ sent: 0, deferred: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const concluir = () =>
      adminClient
        .from("messages")
        .update({
          push_sent_to: [...jaEnviados, ...dentro],
          push_sent_at: fora.length ? null : now.toISOString(),
          push_next_at: fora.length ? proximo!.toISOString() : null,
        })
        .eq("id", message_id);

    if (!dentro.length) {
      await concluir();
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subs } = await adminClient
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("employee_id", dentro);

    const payload = JSON.stringify({
      title: `Novo comunicado (${message.categoria})`,
      body: plainTextPreview(message.texto),
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
          if (isStalePushError(err)) staleIds.push(sub.id);
        }
      })
    );

    if (staleIds.length) {
      await adminClient.from("push_subscriptions").delete().in("id", staleIds);
    }

    await concluir();

    return new Response(JSON.stringify({ sent }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[send-push]", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: "Não foi possível enviar a notificação" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
