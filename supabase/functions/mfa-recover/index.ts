import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { recoverWithCode } from "../_shared/mfa-recovery-core.mjs";

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return reply(405, { error: "Método não permitido" });
  }

  try {
    const { code } = await req.json().catch(() => ({}) as Record<string, unknown>);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return reply(401, { error: "Não autorizado" });

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return reply(401, { error: "Não autorizado" });

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const result = await recoverWithCode({
      userId: user.id,
      code,
      rateLimit: async () => {
        const { data, error } = await callerClient.rpc("rate_limit_check", { p_action: "mfa-recover", p_max: 5, p_window_seconds: 900 });
        return !error && data === true;
      },
      verify: async (userId: string, normalized: string) => {
        const { data, error } = await adminClient.rpc("mfa_recovery_verify", { p_user: userId, p_code: normalized });
        return !error && data === true;
      },
      reportFailure: async () => {
        await callerClient.rpc("report_mfa_failure").then(() => {}, () => {});
      },
      listFactors: async (userId: string) => {
        const { data, error } = await adminClient.auth.admin.mfa.listFactors({ userId });
        if (error) throw error;
        return data?.factors ?? [];
      },
      deleteFactor: async (userId: string, id: string) => {
        const { error } = await adminClient.auth.admin.mfa.deleteFactor({ userId, id });
        return !error;
      },
      complete: async (userId: string) => {
        const { error } = await adminClient.rpc("mfa_recovery_complete", { p_user: userId });
        if (error) console.error("[mfa-recover] mfa_recovery_complete:", error.message);
      },
    });

    return reply(result.status, result.body);
  } catch (err) {
    console.error("[mfa-recover]", err instanceof Error ? err.message : err);
    return reply(500, { error: "Erro interno" });
  }
});
