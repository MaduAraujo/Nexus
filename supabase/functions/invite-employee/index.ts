import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { mfaSatisfied, MFA_REQUIRED_MESSAGE } from "../_shared/mfa.ts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAGE_SIZE = 1000;

async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found || users.length < PAGE_SIZE) return found ?? null;
  }
}

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const redirectTo = typeof body.redirectTo === "string" ? body.redirectTo : "";
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: "E-mail inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    if (!mfaSatisfied(user, authHeader, true)) {
      return new Response(JSON.stringify({ error: MFA_REQUIRED_MESSAGE }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const redirect = redirectTo || Deno.env.get("SUPABASE_URL")!;

    const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirect,
      data: { first_access_pending: true },
    });

    if (!inviteErr && inviteData?.user) {
      return new Response(JSON.stringify({ id: inviteData.user.id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const existing = await findUserByEmail(adminClient, email);

    if (existing) {
      const { error: resetErr } = await adminClient.auth.resetPasswordForEmail(email, {
        redirectTo: redirect,
      });
      if (resetErr) {
        return new Response(JSON.stringify({ error: resetErr.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
    console.error("[invite-employee]", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: "Erro interno ao enviar o convite" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});