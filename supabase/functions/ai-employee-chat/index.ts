// ai-employee-chat — assistente conversacional do COLABORADOR, com dados reais da
// própria sessão (mesma arquitetura de supabase/functions/ai-alerts: system prompt com
// snapshot de dados + Groq streaming), mas escopado a um único colaborador em vez do
// snapshot geral de RH.
//
// Diferença de segurança importante em relação a ai-alerts: aquela função usa o client
// admin (service role) porque o RH tem visão da empresa toda. Aqui usamos o client do
// PRÓPRIO chamador (JWT do colaborador) para buscar os dados — mesmo que a query tenha
// algum bug de filtro, a RLS de colaborador (my_employee_id()) impede vazar dado de
// outra pessoa. Defesa em profundidade, não só o filtro .eq('employee_id', ...).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Jornada / cálculo de ponto (mesma regra de ponto-colaborador.js) ──────────

function getJornadaMin(emp: any): number | null {
  const tipo = String(emp?.contract_type || "clt").toLowerCase();
  if (tipo === "pj") return null;
  if (tipo === "estagio" || tipo === "estágio" || tipo === "aprendiz") return 6 * 60;
  const workLoad = emp?.work_load || "";
  if (workLoad === "12x36") return 12 * 60;
  const m = workLoad.match(/^(\d+)h/);
  if (m) return Math.round((parseInt(m[1], 10) / 5) * 60);
  return 8 * 60;
}

function diffMin(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

function calcWorkedMin(rec: any): number {
  if (!rec?.entrada) return 0;
  if (rec.saida_almoco) {
    const morning = diffMin(rec.entrada, rec.saida_almoco);
    const afternoon = rec.retorno_almoco && rec.saida ? diffMin(rec.retorno_almoco, rec.saida) : 0;
    return morning + afternoon;
  }
  return rec.saida ? diffMin(rec.entrada, rec.saida) : 0;
}

// Ledger FIFO de banco de horas por competência (mesma lógica de loadBankLedger em
// banco-horas-rh.js), simplificado pra um único colaborador.
function calcBancoHorasLedger(
  records: any[],
  adjustments: any[],
  jornadaMin: number | null,
  vencimentoMeses: number,
): { saldoMin: number; proximoVencimento: string | null; minutosVencendo: number; minutosVencidos: number } {
  if (jornadaMin === null) return { saldoMin: 0, proximoVencimento: null, minutosVencendo: 0, minutosVencidos: 0 };

  const byMonth: Record<string, number> = {};
  for (const r of records) {
    if (!r.entrada || !r.saida) continue;
    const s = calcWorkedMin(r) - jornadaMin;
    const mk = r.date.slice(0, 7);
    byMonth[mk] = (byMonth[mk] || 0) + s;
  }
  for (const a of adjustments) {
    const mk = a.date.slice(0, 7);
    const delta = a.tipo === "credito" ? a.minutos : -a.minutos;
    byMonth[mk] = (byMonth[mk] || 0) + delta;
  }

  const keys = Object.keys(byMonth).sort();
  const queue: { mk: string; remaining: number }[] = [];
  let saldoMin = 0;
  for (const mk of keys) {
    let net = byMonth[mk];
    saldoMin += net;
    if (net > 0) queue.push({ mk, remaining: net });
    else if (net < 0) {
      let debt = -net;
      while (debt > 0 && queue.length) {
        const oldest = queue[0];
        const consumed = Math.min(oldest.remaining, debt);
        oldest.remaining -= consumed;
        debt -= consumed;
        if (oldest.remaining <= 0) queue.shift();
      }
    }
  }

  const hoje = new Date();
  let minutosVencendo = 0, minutosVencidos = 0, proximoVencimento: string | null = null;
  let proxExpiraDate: Date | null = null;
  for (const bucket of queue) {
    const [y, m] = bucket.mk.split("-").map(Number);
    const expira = new Date(y, m - 1 + vencimentoMeses, 1);
    const diasRestantes = Math.round((expira.getTime() - hoje.getTime()) / 86400000);
    if (diasRestantes < 0) minutosVencidos += bucket.remaining;
    else if (diasRestantes <= 30) minutosVencendo += bucket.remaining;
    if (proxExpiraDate === null || expira < proxExpiraDate) proxExpiraDate = expira;
  }
  if (proxExpiraDate) proximoVencimento = (proxExpiraDate as Date).toISOString().slice(0, 10);

  return { saldoMin, proximoVencimento, minutosVencendo, minutosVencidos };
}

// ─── Férias (mesma fórmula de calcAcquisitivePeriod em ferias-colaborador.js para o
// período aquisitivo atual; saldo é uma ESTIMATIVA simplificada — não desconta dias por
// faltas injustificadas no período, ver diasDireitoPorFaltas no client, então pode ser
// um pouco otimista em casos com muitas faltas. Documentado no prompt do sistema). ────

function calcAcquisitivePeriod(admDate: Date, today: Date): { start: Date; end: Date } {
  const start = new Date(admDate);
  while (new Date(start.getFullYear() + 1, start.getMonth(), start.getDate()) <= today) {
    start.setFullYear(start.getFullYear() + 1);
  }
  const end = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
  return { start, end };
}

function monthsDiff(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function calcFeriasSnapshot(emp: any, vacations: any[]) {
  if (!emp.admission_date) return null;
  const today = new Date();
  const admDate = new Date(emp.admission_date + "T00:00:00");
  const months = monthsDiff(admDate, today);
  const periods = Math.floor(months / 12);
  const earned = periods * 30; // simplificação: sem desconto por faltas injustificadas
  const taken = vacations
    .filter((v) => v.status === "aprovado" || v.status === "concluido")
    .reduce((s, v) => s + v.days - (v.abono ? 10 : 0), 0);
  const saldoEstimado = Math.max(0, earned - taken);
  const period = calcAcquisitivePeriod(admDate, today);
  const diasRestantesCiclo = Math.ceil((period.end.getTime() - today.getTime()) / 86400000);
  return {
    saldo_estimado_dias: saldoEstimado,
    periodo_aquisitivo_atual: { inicio: period.start.toISOString().slice(0, 10), fim: period.end.toISOString().slice(0, 10) },
    dias_restantes_no_ciclo_atual: diasRestantesCiclo,
  };
}

// ─── Snapshot completo do colaborador ──────────────────────────────────────────

async function gatherEmployeeSnapshot(caller: ReturnType<typeof createClient>, employeeId: string) {
  const [empRes, vacRes, recsRes, adjRes, settingsRes, slipsRes, docsRes, pontoAdjRes] = await Promise.all([
    caller.from("employees").select("name,role,dept,admission_date,contract_type,work_load,salary").eq("id", employeeId).single(),
    caller.from("vacations").select("status,days,abono,start_date,end_date").eq("employee_id", employeeId),
    caller.from("time_records").select("date,entrada,saida_almoco,retorno_almoco,saida").eq("employee_id", employeeId),
    caller.from("bank_adjustments").select("tipo,minutos,date").eq("employee_id", employeeId).is("deleted_at", null),
    caller.from("hr_settings").select("banco_horas_vencimento_meses").eq("id", 1).single(),
    caller.from("payslips").select("mes,competencia,salario_liquido,status").eq("employee_id", employeeId).order("mes", { ascending: false }).limit(3),
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
    hoje: new Date().toISOString().slice(0, 10),
    colaborador: {
      nome: emp.name, cargo: emp.role, departamento: emp.dept,
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

function buildSystem(snapshot: object, employeeName: string): string {
  return `Você é o Agente de Atendimento RH do sistema Nexus, conversando diretamente com ${employeeName}, um colaborador (não é RH, não tem acesso a dados de outros colaboradores).

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { message, history } = await req.json();
    if (!message || typeof message !== "string") return json({ error: "message é obrigatório" }, 400);

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

    const snapshot = await gatherEmployeeSnapshot(caller, profile.employee_id);
    if (!snapshot) return json({ error: "Colaborador não encontrado" }, 404);

    const system = buildSystem(snapshot, snapshot.colaborador.nome || "colaborador");
    const messages = [...(history ?? []), { role: "user", content: message }];
    const groqMessages = [{ role: "system", content: system }, ...messages];

    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("GROQ_API_KEY")!}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", max_tokens: 1024, messages: groqMessages, stream: true }),
    });
    if (!groqResp.ok) throw new Error(`Groq API ${groqResp.status}: ${await groqResp.text()}`);

    return new Response(groqResp.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
