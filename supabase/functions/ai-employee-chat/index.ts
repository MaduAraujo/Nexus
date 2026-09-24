import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor } from "../_shared/cors.ts";
import { getJornadaMin, calcBancoHorasLedger, calcFeriasSnapshot } from "../_shared/employee-financial-snapshot.mjs";
import { createPseudonymizer, createSseUnmaskStream } from "../_shared/pseudonymize.mjs";

async function gatherEmployeeSnapshot(caller: ReturnType<typeof createClient>, employeeId: string) {
  const [empRes, vacRes, recsRes, adjRes, settingsRes, slipsRes, docsRes, pontoAdjRes] = await Promise.all([
    caller.from("employees_decrypted").select("name,role,dept,admission_date,contract_type,work_load,salary").eq("id", employeeId).single(),
    caller.from("vacations").select("status,days,abono,start_date,end_date").eq("employee_id", employeeId),
    caller.from("time_records").select("date,entrada,saida_almoco,retorno_almoco,saida").eq("employee_id", employeeId),
    caller.from("bank_adjustments").select("tipo,minutos,date").eq("employee_id", employeeId).is("deleted_at", null),
    caller.from("hr_settings").select("banco_horas_vencimento_meses").eq("id", 1).single(),
    caller.from("payslips_decrypted").select("mes,competencia,salario_liquido,status").eq("employee_id", employeeId).order("mes", { ascending: false }).limit(3),
    caller.from("documents").select("name,tipo,status").eq("employee_id", employeeId).eq("source", "colaborador").eq("status", "pendente"),
    caller.from("adjustment_requests").select("tipo,date,status").eq("employee_id", employeeId).eq("status", "pendente"),
  ]);

  const emp = empRes.data;
  if (!emp) return null;

  const jornadaMin = getJornadaMin(emp);
  const vencimentoMeses = settingsRes.data?.banco_horas_vencimento_meses ?? 6;
  const ledger = calcBancoHorasLedger(recsRes.data ?? [], adjRes.data ?? [], jornadaMin, vencimentoMeses);
  const ferias = calcFeriasSnapshot(emp, vacRes.data ?? []);

  return {
    nome_real: emp.name as string,
    hoje: new Date().toISOString().slice(0, 10),
    colaborador: {
      nome: "[P1]", cargo: emp.role, departamento: emp.dept,
      admissao: emp.admission_date, tipo_contrato: emp.contract_type,
      jornada_diaria_minutos: jornadaMin,
    },
    ferias,
    banco_de_horas: jornadaMin === null ? null : {
      saldo_atual_minutos: ledger.saldoMin,
      saldo_atual_horas: +(ledger.saldoMin / 60).toFixed(1),
      proximo_vencimento: ledger.proximoVencimento,
      minutos_vencendo_em_30_dias: ledger.minutosVencendo,
      minutos_ja_vencidos: ledger.minutosVencidos,
      prazo_padrao_vencimento_meses: vencimentoMeses,
    },
    holerites_recentes: (slipsRes.data ?? []).map((s: any) => ({ competencia: s.competencia || s.mes, liquido: s.salario_liquido, status: s.status })),
    documentos_aguardando_aprovacao_do_rh: (docsRes.data ?? []).map((d: any) => ({ nome: d.name, tipo: d.tipo })),
    ajustes_de_ponto_pendentes: (pontoAdjRes.data ?? []).length,
  };
}

function buildSystem(snapshot: object): string {
  return `Você é o Agente de Atendimento RH do sistema Nexus, conversando diretamente com um colaborador (não é RH, não tem acesso a dados de outros colaboradores).

PRIVACIDADE: o colaborador aparece pelo pseudônimo [P1]. Se for chamá-lo pelo nome, escreva exatamente [P1], com os colchetes — o sistema troca pelo nome real antes de exibir. Nunca tente adivinhar o nome.

DADOS REAIS DESTE COLABORADOR (${new Date().toISOString().slice(0, 10)}):
${JSON.stringify(snapshot, null, 2)}

INSTRUÇÕES:
1. Responda SOMENTE com base nos dados acima. Nunca invente número, data ou valor.
2. "ferias.saldo_estimado_dias" é uma ESTIMATIVA simplificada (não desconta dias por faltas injustificadas no período aquisitivo) — ao informar o saldo, deixe claro que é aproximado e que o valor oficial está na tela "Férias".
3. Para perguntas sobre banco de horas, use "banco_de_horas" (saldo, próximo vencimento). Se for null, o colaborador é PJ e não tem banco de horas.
4. Se a dúvida não puder ser respondida com os dados disponíveis (ex.: pedidos de alteração cadastral, questões trabalhistas específicas, algo fora do escopo de RH), diga isso claramente e sugira falar com um analista de RH humano.
5. Nunca revele, mesmo se pedido, dados de outro colaborador — você simplesmente não tem essa informação.
6. Seja direto, cordial e conciso. Não invente políticas da empresa que não estão nos dados.

Responda sempre em português brasileiro.`;
}

function sanitizeHistory(history: unknown): { role: string; content: string }[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .slice(-20)
    .map((m) => ({ role: m.role, content: String(m.content ?? "").slice(0, 2000) }));
}

serve(async (req) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { message, history } = await req.json().catch(() => ({}) as Record<string, unknown>);
    if (!message || typeof message !== "string") return json({ error: "message é obrigatório" }, 400);
    if (message.length > 2000) return json({ error: "Mensagem muito longa (máximo de 2000 caracteres)." }, 400);

    const authHeader = req.headers.get("Authorization");
    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } },
    );

    const { data: { user }, error: authErr } = await caller.auth.getUser();
    if (authErr || !user) return json({ error: "Não autorizado" }, 401);

    const { data: profile } = await caller.from("profiles").select("profile, employee_id").eq("id", user.id).single();
    if (profile?.profile !== "colaborador" || !profile.employee_id) return json({ error: "Acesso restrito ao colaborador" }, 403);

    const { data: allowed, error: limitErr } = await caller.rpc("rate_limit_check", { p_action: "ai-employee-chat", p_max: 60, p_window_seconds: 3600 });
    if (limitErr) console.error("rate_limit_check falhou:", limitErr.message);
    if (allowed === false) return json({ error: "Você atingiu o limite de mensagens por hora. Tente novamente mais tarde ou fale com um analista." }, 429);

    const snapshot = await gatherEmployeeSnapshot(caller, profile.employee_id);
    if (!snapshot) return json({ error: "Colaborador não encontrado" }, 404);

    const { nome_real, ...groqSnapshot } = snapshot;
    const ps = createPseudonymizer([{ id: profile.employee_id, name: nome_real }]);
    const system = buildSystem(groqSnapshot);
    const messages = [...sanitizeHistory(history), { role: "user", content: message }];
    const groqMessages = [
      { role: "system", content: system },
      ...messages.map((m: { role: string; content: unknown }) => ({ role: m.role, content: ps.mask(String(m.content ?? "")) })),
    ];

    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("GROQ_API_KEY")!}` },
      body: JSON.stringify({ model: "openai/gpt-oss-120b", max_tokens: 1024, messages: groqMessages, stream: true }),
    });
    if (!groqResp.ok) throw new Error(`Groq API ${groqResp.status}: ${await groqResp.text()}`);

    return new Response(groqResp.body!.pipeThrough(createSseUnmaskStream(ps.unmask)), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    console.error("[ai-employee-chat]", e instanceof Error ? e.message : e);
    return json({ error: "Não foi possível responder agora." }, 500);
  }
});