import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sendInviteEmail(to: string, link: string, isRecovery: boolean) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY não configurado nos secrets da Edge Function");

  const from = Deno.env.get("RESEND_FROM") ?? "Nexus RH <onboarding@resend.dev>";
  const subject = isRecovery ? "Seu link de acesso ao Nexus RH" : "Bem-vindo ao Nexus RH";
  const action = isRecovery ? "redefinir sua senha e acessar" : "criar sua senha e acessar";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#6c63ff">Nexus RH</h2>
          <p>Você foi cadastrado no sistema de RH. Clique no botão abaixo para ${action} o sistema.</p>
          <a href="${link}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#6c63ff;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
            Acessar Nexus RH
          </a>
          <p style="color:#888;font-size:12px">Se não esperava este e-mail, ignore-o.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Resend ${res.status}: ${body?.message ?? body?.name ?? "falha ao enviar e-mail"}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, redirectTo } = await req.json();

    const authHeader = req.headers.get("Authorization");
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

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const redirect = redirectTo || Deno.env.get("SUPABASE_URL")!;

    // Tenta criar convite para novo usuário
    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: redirect, data: { first_access_pending: true } },
    });

    if (!inviteErr && inviteData?.user) {
      await sendInviteEmail(email, inviteData.properties.action_link, false);
      return new Response(JSON.stringify({ id: inviteData.user.id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Usuário já existe — gera link de recuperação de senha
    const { data: list } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users?.find(u => u.email === email);

    if (existing) {
      const { data: recoveryData, error: recoveryErr } = await adminClient.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: redirect },
      });
      if (recoveryErr || !recoveryData) {
        return new Response(JSON.stringify({ error: recoveryErr?.message ?? "Erro ao gerar link" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await sendInviteEmail(email, recoveryData.properties.action_link, true);
      return new Response(JSON.stringify({ id: existing.id, existing: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: inviteErr?.message ?? "Erro ao criar convite" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
