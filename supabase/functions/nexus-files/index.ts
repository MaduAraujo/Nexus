import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { BUCKETS, handleDownload, handleUpload } from "../_shared/files-core.mjs";

const MAX_BODY_BYTES = Math.max(...Object.values(BUCKETS).map((b: { maxBytes: number }) => b.maxBytes));

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("FILES_ENCRYPTION_KEY");
    if (!key) {
      console.error("FILES_ENCRYPTION_KEY não configurada");
      return json(500, { error: "Cifragem de arquivos não configurada" });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Não autorizado" });
    const caller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await caller.auth.getUser();
    if (userErr || !user) return json(401, { error: "Não autorizado" });

    if (req.method === "POST") {
      const declaredLength = Number(req.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_BODY_BYTES + 1024) return json(413, { error: "Arquivo grande demais" });

      const bytes = new Uint8Array(await req.arrayBuffer());
      const result = await handleUpload({
        storage: caller.storage,
        key,
        bucket: req.headers.get("x-nexus-bucket") ?? "",
        path: decodeURIComponent(req.headers.get("x-nexus-path") ?? ""),
        mime: req.headers.get("x-nexus-mime") ?? "",
        upsert: req.headers.get("x-nexus-upsert") === "true",
        bytes,
      });
      return json(result.status, result.body);
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const bucket = url.searchParams.get("bucket") ?? "";
      const result = await handleDownload({
        storage: caller.storage,
        key,
        bucket,
        path: url.searchParams.get("path") ?? "",
        allowLegacyPlaintext: Deno.env.get("FILES_ALLOW_LEGACY_PLAINTEXT") !== "false",
      });
      if (!result.bytes) return json(result.status, result.body);
      await caller.rpc("report_file_download", { p_bucket: bucket }).then(
        () => undefined,
        () => undefined,
      );
      return new Response(result.bytes, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": result.contentType,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }

    return json(405, { error: "Método não permitido" });
  } catch (e) {
    console.error("nexus-files:", e instanceof Error ? e.message : e);
    return json(400, { error: "Não foi possível processar o arquivo" });
  }
});
