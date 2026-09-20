# Revisão periódica de acessos

Versão 1.0, 2026-09-20. Objetivo: garantir que só as pessoas certas têm acesso, com o nível certo, e que o acesso some quando a necessidade some (LGPD art. 46 e 6º, VII; RIPD risco R1).

## 1. Quando, quem, quanto tempo

| Gatilho | Prazo | Quem faz | Quem confere |
|---|---|---|---|
| **Revisão trimestral completa** (jan, abr, jul, out) | até o dia 10 do mês | Responsável técnico, com o SQL desta pasta | Encarregado (DPO), que assina o registro |
| **Desligamento de colaborador** | no mesmo dia do desligamento | RH marca o colaborador como Inativo e o técnico desativa a conta (playbook P1, passo 1) | Bloco A2 do SQL na revisão seguinte |
| **Mudança de função** (entra ou sai do RH, vira ou deixa de ser gestor) | no mesmo dia | RH | Blocos A1 e A6 |
| **Após incidente** | conforme o plano de incidentes | Coordenador do incidente | DPO |

Tempo estimado: 45 minutos.

## 2. Como fazer

1. Abrir o SQL Editor do Supabase (projeto de produção) e colar o conteúdo de [`scripts/ops/revisao-de-acessos.sql`](../../scripts/ops/revisao-de-acessos.sql). Todos os comandos são `SELECT`: **nada é alterado**. Rodar um bloco por vez.
2. Para cada bloco, comparar com o resultado esperado (tabela da seção 3). Toda linha em um bloco de **alerta** é uma pendência.
3. Decidir cada pendência **na revisão**, com o DPO: remover, manter com justificativa, ou investigar (incidente).
4. Executar as correções à mão (painel do Supabase ou SQL) e **rodar o bloco de novo** para provar que sumiu.
5. Preencher o registro (seção 5), com a data, e arquivar em `docs/operacao/evidencias/revisao-acessos-AAAA-MM.md`. Não cole dado pessoal no registro: use nome e cargo, não CPF.

## 3. O que cada bloco procura

| Bloco | Pergunta | Esperado |
|---|---|---|
| A1 | Quem são os Administradores e como estão (vínculo, último login, MFA)? | Todos Ativos, todos com MFA, ninguém que não reconhecemos |
| **A2** | Alguém que **saiu da empresa** ainda tem acesso ativo? | **Nenhuma linha** |
| **A3** | Administrador sem MFA verificado? | **Nenhuma linha** |
| A4 | Contas sem login há mais de 90 dias | Justificar ou desativar cada uma |
| A5 | Usuário do Auth sem perfil no Nexus | Nenhuma linha (convite incompleto ou conta esquecida) |
| A6 | Gestores de equipe e tamanho da equipe | Bate com o organograma |
| A7 | Aparelhos inscritos em notificação por Administrador | Só aparelhos reconhecidos |
| B1 | Acessos a dados pessoais por pessoa do RH nos últimos 90 dias | Volume compatível com a função; quem destoa vira pergunta ao gestor |
| B2 | Exportações e downloads em massa | Cada um com justificativa conhecida |
| B3 | Alertas de segurança do período | Todos tratados |
| **C1** | Tabelas do `public` sem row level security | **Nenhuma linha** |
| C2 | Políticas com condição sempre verdadeira | Só as intencionais (hoje: kudos e tarefas de onboarding, restritas a quem está logado) |
| C3 | O que o papel anônimo pode tocar | Em produção o Supabase concede permissões ao `anon` por padrão; a barreira real é a política (C1 e C2). Serve para ver o que mudou desde a última revisão |
| **C4** | Funções chamáveis sem login | Só as que o login precisa (`is_rh`, `my_employee_id`, `report_login_failure` e afins usadas nas políticas). **Rotinas de cron ou de push aqui são falha grave** |
| **D** | Migrations e configurações do código aplicadas no projeto real | Tudo `true`. `false` = controle que o RIPD e a política de privacidade afirmam, mas que não está ativo |

O bloco A2 depende da coluna `banned_until` de `auth.users` (existe no Supabase Auth). O bloco D usa `cron.job` e `vault.decrypted_secrets`: se aparecer "relation does not exist", `pg_cron` ou o Vault não estão habilitados no projeto, e isso já é a resposta.

## 4. O que revisar fora do banco

Anotar sim/não e quem confirmou:

- [ ] **Painel do Supabase:** quem são os membros da organização e do projeto, com que papel; remover quem saiu. Convites pendentes. MFA obrigatório para os membros da organização.
- [ ] **Vercel:** membros do time; tokens de acesso; integrações do Git.
- [ ] **GitHub:** quem tem acesso de escrita ao repositório; chaves de deploy; `Dependabot` e alertas de segurança abertos.
- [ ] **Groq:** membros da organização; chaves de API ativas (apagar as sem uso); ZDR ainda ligado.
- [ ] **Segredos das Edge Functions:** `supabase secrets list` — só os esperados (`GROQ_API_KEY`, `VAPID_*`, `FILES_ENCRYPTION_KEY`, ...).
- [ ] **Cofre de senhas da equipe:** quem acessa as chaves de cifragem (ao menos duas pessoas, todas ainda na equipe).
- [ ] **Painel de Auth:** política de senha (12+ caracteres), TOTP habilitado, provedores de login desnecessários desligados, URL de redirecionamento só com o domínio real.

## 5. Registro (copiar para `evidencias/revisao-acessos-AAAA-MM.md`)

```
Revisão de acessos — AAAA-MM
Data: 
Executada por:            Conferida por (DPO):
Escopo: banco (SQL) + fora do banco

Bloco | Resultado | Pendências encontradas | Decisão | Feito em
A1    |           |                        |         |
A2    |           |                        |         |
A3    |           |                        |         |
A4    |           |                        |         |
A5    |           |                        |         |
A6    |           |                        |         |
A7    |           |                        |         |
B1-B3 |           |                        |         |
C1-C4 |           |                        |         |
D     |           |                        |         |
Fora do banco (seção 4): 

Correções refeitas e conferidas (bloco rodado de novo)? sim/não
Próxima revisão:
```

## 6. Histórico

| Data | Executada por | Registro |
|---|---|---|
| 2026-09-20 | Primeira execução, em banco de teste com dados sintéticos (valida o SQL; **não é** a revisão do ambiente real) | — |
| [PREENCHER] | | |
