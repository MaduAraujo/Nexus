import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function gatherSnapshot(admin: ReturnType<typeof createClient>, today: string) {
  const d7 = new Date();
  d7.setDate(d7.getDate() - 7);
  const sevenDaysAgo = d7.toISOString().split("T")[0];

  const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
    admin.from("employees").select("id,name,dept,role,status,admission_date,contract_type").eq("status", "Ativo"),
    admin.from("vacations").select("id,employee_id,start_date,end_date,days,created_at,employees(name)").eq("status", "pendente").order("created_at"),
    admin.from("adjustment_requests").select("id,employee_id,date,tipo,justificativa,created_at,employees(name)").eq("status", "pendente").order("created_at"),
    admin.from("burnout_alerts").select("id,employee_id,date,alertas,created_at,employees(name)").eq("lido", false).order("created_at", { ascending: false }).limit(15),
    admin.from("documents").select("employee_id,name,created_at,employees(name)").eq("status", "pendente").eq("source", "colaborador"),
    admin.from("time_records").select("employee_id,date,entrada").gte("date", sevenDaysAgo).lte("date", today),
    admin.from("ai_decision_memory").select("action_type,description,created_at").order("created_at", { ascending: false }).limit(10),
  ]);

  const employees: any[]         = r1.data ?? [];
  const pendingVacations: any[]  = r2.data ?? [];
  const pendingAdjustments: any[]= r3.data ?? [];
  const burnoutAlerts: any[]     = r4.data ?? [];
  const pendingDocs: any[]       = r5.data ?? [];
  const recentRecords: any[]     = r6.data ?? [];
  const decisions: any[]         = r7.data ?? [];

  const presentIds = new Set(recentRecords.filter((r) => r.entrada).map((r) => r.employee_id));
  const noRecentRecords = employees
    .filter((e) => !presentIds.has(e.id))
    .map((e) => ({ name: e.name, dept: e.dept ?? "N/A" }));

  const now = Date.now();
  const newHires = employees
    .filter((e) => e.admission_date && now - new Date(e.admission_date + "T00:00:00").getTime() <= 90 * 86_400_000)
    .map((e) => ({
      name: e.name, dept: e.dept ?? "N/A",
      days_at_company: Math.floor((now - new Date(e.admission_date + "T00:00:00").getTime()) / 86_400_000),
    }));

  return {
    date: today,
    active_employees: employees.length,
    departments: [...new Set(employees.map((e: any) => e.dept).filter(Boolean))],
    pending_vacations: pendingVacations.map((v) => ({
      id: v.id,
      employee: v.employees?.name ?? "N/A",
      start: v.start_date, end: v.end_date, days: v.days,
      waiting_days: Math.floor((now - new Date(v.created_at).getTime()) / 86_400_000),
    })),
    pending_adjustments: pendingAdjustments.map((a) => ({
      id: a.id,
      employee: a.employees?.name ?? "N/A",
      date: a.date, type: a.tipo,
      justification: String(a.justificativa ?? "").substring(0, 100),
    })),
    burnout_alerts: burnoutAlerts.map((b) => ({
      id: b.id,
      employee: b.employees?.name ?? "N/A",
      date: b.date, alerts: b.alertas,
    })),
    pending_documents: pendingDocs.map((d) => ({
      employee: d.employees?.name ?? "N/A", document: d.name,
    })),
    employees_no_records_last_7days: noRecentRecords,
    new_hires_last_90days: newHires,
    recent_decisions: decisions.map((d) => ({
      action: d.action_type,
      description: d.description,
      date: new Date(d.created_at).toLocaleDateString("pt-BR"),
    })),
  };
}

function buildSystem(snapshot: object, today: string): string {
  return `Você é o Nexus AI, assistente inteligente de RH do sistema Nexus.

DADOS DO SISTEMA (${today}):
${JSON.stringify(snapshot, null, 2)}

INSTRUÇÕES:
1. CORRELAÇÕES CRUZADAS: Quando um colaborador aparece em múltiplas categorias (burnout + ausência + ajuste pendente), destaque o padrão convergente — isso é sinal de risco crítico, não casos isolados.
2. PADRÕES DE EQUIPE: Se vários colaboradores do mesmo departamento têm problemas similares, sinalize como problema sistêmico de gestão.
3. PERFIS NARRATIVOS: Para perguntas como "Como está o João?" ou "Como está o time de TI?", escreva uma análise completa com situação atual, padrões detectados e recomendações concretas.
4. AÇÕES DIRETAS: Quando o usuário pedir para executar algo (aprovar, recusar, marcar como lido), responda APENAS com este formato — sem nenhum texto adicional:
ACTION:{"type":"approve_vacation|reject_vacation|approve_adjustment|reject_adjustment|mark_burnout_read","ids":["uuid1"],"message":"Descrição clara da ação para confirmação do usuário"}
5. MEMÓRIA: Use as decisões recentes do snapshot para contextualizar respostas e evitar repetições.

Responda sempre em português brasileiro. Seja direto, empático e orientado a ações concretas.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { action, message, history } = await req.json();

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

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const today = new Date().toISOString().split("T")[0];
    const snapshot = await gatherSnapshot(admin, today);
    const system = buildSystem(snapshot, today);

    let messages: { role: string; content: string }[];

    if (action === "analyze") {
      messages = [{
        role: "user",
        content: `Analise os dados e retorne APENAS um JSON válido (sem markdown) com esta estrutura exata:
{"summary":"resumo de 1-2 frases","alerts":[{"severity":"critical|warning|info","category":"aprovacao|burnout|ausencia|documentos|admissao|geral","title":"título curto","description":"descrição com correlações cruzadas quando existirem","employees":["Nome"],"action":"ação sugerida"}]}
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

    const groqMessages = [{ role: "system", content: system }, ...messages];

    // Chat: streaming SSE
    if (action === "chat") {
      const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("GROQ_API_KEY")!}` },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 2048, messages: groqMessages, stream: true }),
      });
      if (!groqResp.ok) throw new Error(`Groq API ${groqResp.status}: ${await groqResp.text()}`);
      return new Response(groqResp.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    // Analyze / Report: non-streaming JSON
    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("GROQ_API_KEY")!}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: action === "report" ? 4096 : 2048, messages: groqMessages }),
    });
    if (!groqResp.ok) throw new Error(`Groq API ${groqResp.status}: ${await groqResp.text()}`);

    const text = (await groqResp.json()).choices[0].message.content;
    return json({ content: text, history: [...messages, { role: "assistant", content: text }] });

  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
