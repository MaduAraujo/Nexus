import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { mfaSatisfied, MFA_REQUIRED_MESSAGE } from "../_shared/mfa.ts";
import { shapeSnapshot, sevenDaysAgo, pseudonymizeRows } from "../_shared/ai-alerts-snapshot.mjs";
import { createSseUnmaskStream } from "../_shared/pseudonymize.mjs";

async function gatherSnapshot(admin: ReturnType<typeof createClient>, caller: ReturnType<typeof createClient>, today: string) {
  const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
    admin.from("employees").select("id,name,dept,role,status,admission_date,contract_type").eq("status", "Ativo"),
    admin.from("vacations").select("id,employee_id,start_date,end_date,days,created_at,employees(name)").eq("status", "pendente").order("created_at"),
    admin.from("adjustment_requests").select("id,employee_id,date,tipo,justificativa,created_at,employees(name)").eq("status", "pendente").order("created_at"),
    admin.from("burnout_alerts").select("id,employee_id,date,alertas,created_at,employees(name)").eq("lido", false).order("created_at", { ascending: false }).limit(15),
    admin.from("documents").select("employee_id,name,created_at,employees(name)").eq("status", "pendente").eq("source", "colaborador"),
    admin.from("time_records").select("employee_id,date,entrada").gte("date", sevenDaysAgo(new Date(today))).lte("date", today),
    caller.from("ai_decision_memory_decrypted").select("action_type,description,created_at").order("created_at", { ascending: false }).limit(10),
  ]);

  const { ps, rows } = pseudonymizeRows({
    employees: r1.data ?? [],
    pendingVacations: r2.data ?? [],
    pendingAdjustments: r3.data ?? [],
    burnoutAlerts: r4.data ?? [],
    pendingDocs: r5.data ?? [],
    recentRecords: r6.data ?? [],
    decisions: r7.data ?? [],
  });
  return { ps, snapshot: ps.maskDeep(shapeSnapshot(today, rows)) };
}

function buildSystem(snapshot: object, today: string): string {
  return `Você é o Nexus AI, assistente inteligente de RH do sistema Nexus.

DADOS DO SISTEMA (${today}):
${JSON.stringify(snapshot, null, 2)}

PRIVACIDADE: os colaboradores aparecem por pseudônimos no formato [P1], [P2]... Ao se referir a alguém, escreva o pseudônimo exatamente assim, com os colchetes — o sistema troca pelo nome real antes de mostrar ao usuário. Nunca tente adivinhar ou inventar nomes.

INSTRUÇÕES:
1. CORRELAÇÕES CRUZADAS: Quando um colaborador aparece em múltiplas categorias (burnout + ausência + ajuste pendente), destaque o padrão convergente — isso é sinal de risco crítico, não casos isolados.
2. PADRÕES DE EQUIPE: Se vários colaboradores do mesmo departamento têm problemas similares, sinalize como problema sistêmico de gestão.
3. PERFIS NARRATIVOS: Para perguntas como "Como está o [P3]?" ou "Como está o time de TI?", escreva uma análise completa com situação atual, padrões detectados e recomendações concretas.
4. AÇÕES DIRETAS: Quando o usuário pedir para executar algo (aprovar, recusar, marcar como lido), responda APENAS com este formato — sem nenhum texto adicional:
ACTION:{"type":"approve_vacation|reject_vacation|approve_adjustment|reject_adjustment|mark_burnout_read","ids":["uuid1"],"message":"Descrição clara da ação para confirmação do usuário"}
5. MEMÓRIA: Use as decisões recentes do snapshot para contextualizar respostas e evitar repetições.

Responda sempre em português brasileiro. Seja direto, empático e orientado a ações concretas.`;
}

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { action, message, history } = await req.json().catch(() => ({}) as Record<string, unknown>);

    const authHeader = req.headers.get("Authorization");
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } }
    );

    const { data: { user }, error: authErr } = await caller.auth.getUser();
    if (authErr || !user) return json({ error: "Não autorizado" }, 401);

    const { data: profile } = await caller.from("profiles").select("profile").eq("id", user.id).single();
    if (profile?.profile !== "Administrador") return json({ error: "Acesso restrito ao Administrador" }, 403);
    if (!mfaSatisfied(user, authHeader, true)) return json({ error: MFA_REQUIRED_MESSAGE }, 403);

    const { data: allowed, error: limitErr } = await caller.rpc("rate_limit_check", { p_action: "ai-alerts", p_max: 30, p_window_seconds: 3600 });
    if (limitErr) console.error("rate_limit_check falhou:", limitErr.message);
    if (allowed === false) return json({ error: "Limite de análises por hora atingido. Tente novamente mais tarde." }, 429);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = new Date().toISOString().split("T")[0];
    const { ps, snapshot } = await gatherSnapshot(admin, caller, today);
    const system = buildSystem(snapshot, today);

    let messages: { role: string; content: string }[];

    if (action === "analyze") {
      messages = [{
        role: "user",
        content: `Analise os dados e retorne APENAS um JSON válido (sem markdown) com esta estrutura exata:
{"summary":"resumo de 1-2 frases","alerts":[{"severity":"critical|warning|info","category":"aprovacao|burnout|ausencia|documentos|admissao|geral","title":"título curto","description":"descrição com correlações cruzadas quando existirem","employees":["[P1]"],"action":"ação sugerida"}]}
Ordene por urgência. Destaque padrões convergentes no mesmo colaborador ou departamento.`,
      }];
    } else if (action === "report") {
      messages = [{
        role: "user",
        content: `Gere um relatório executivo completo em markdown com estas seções:

# Relatório Executivo RH — ${today}

## Resumo Executivo
## Score de Saúde: X/100
## Indicadores do Período
## Análise Cruzada de Riscos
(padrões que envolvem múltiplos colaboradores ou departamentos)
## Colaboradores que Requerem Atenção Imediata
## Recomendações para os Próximos 7 Dias

Tom profissional e empático. Baseie-se SOMENTE nos dados do snapshot.`,
      }];
    } else if (action === "chat") {
      messages = [...(history ?? []), { role: "user", content: message }];
    } else {
      return json({ error: "action inválido" }, 400);
    }

    const groqMessages = [
      { role: "system", content: system },
      ...messages.map((m) => ({ role: m.role, content: ps.mask(String(m.content ?? "")) })),
    ];

    if (action === "chat") {
      const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("GROQ_API_KEY")!}` },
        body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: 2048, messages: groqMessages, stream: true }),
      });
      if (!groqResp.ok) throw new Error(`Groq API ${groqResp.status}: ${await groqResp.text()}`);
      return new Response(groqResp.body!.pipeThrough(createSseUnmaskStream(ps.unmask)), {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("GROQ_API_KEY")!}` },
      body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: action === "report" ? 4096 : 2048, messages: groqMessages }),
    });
    if (!groqResp.ok) throw new Error(`Groq API ${groqResp.status}: ${await groqResp.text()}`);

    const text = ps.unmask((await groqResp.json()).choices[0].message.content, { jsonSafe: action === "analyze" });
    return json({ content: text, history: [...messages, { role: "assistant", content: text }] });

  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});