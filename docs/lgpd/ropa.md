# Registro das Operações de Tratamento de Dados Pessoais (ROPA)

LGPD, art. 37. Versão 1.0, elaborada em 2026-09-20 a partir do código e do schema do repositório (`supabase/schema.sql`, migrations 001–067, Edge Functions).

**Controladora:** [PREENCHER: razão social, CNPJ] · **Operador (plataforma):** [PREENCHER] · **Encarregado (DPO):** [PREENCHER: nome, e-mail]
**Revisão:** a cada 6 meses e a cada nova funcionalidade que trate dado pessoal. Próxima: [PREENCHER: data].

Legenda de base legal (LGPD): **7º-II** obrigação legal · **7º-V** execução de contrato · **7º-IX** legítimo interesse · **7º-I** consentimento · **11-II-a** obrigação legal (dado sensível) · **11-II-g** segurança e prevenção à fraude (dado sensível).
Titulares em todas as operações, salvo indicação: colaboradores (ativos e desligados) e, no login, o e-mail de quem tenta entrar.
Prazos de retenção marcados com ⚠ **não estão definidos no sistema** e precisam da decisão do jurídico; os dados de exemplo abaixo são propostas, não regra em vigor.

| # | Operação | Finalidade | Dados (tabelas) | Sensível? | Base legal | Operadores / destino | Retenção | Segurança principal |
|---|---|---|---|---|---|---|---|---|
| 1 | Cadastro de colaboradores | Gerir o vínculo de emprego | Identificação, contato, cargo, contrato, gestor (`employees`, `profiles`, `employee_audit`) | Sim: PcD, raça/cor, deficiência, pensão | 7º-V, 7º-II, 11-II-a | Supabase | ⚠ vínculo + prazo prescricional trabalhista (proposta: 5 anos após o desligamento) e depois anonimização (`anonymize_employee`) | RLS por perfil; CPF, nascimento, gênero, raça/cor, PcD e pensão cifrados (AES-256, chaves no Vault); trigger impede o colaborador de editar campos do RH |
| 2 | Folha, holerites e pagamentos | Pagar salário e benefícios, emitir holerite | Salário, proventos/descontos, dados bancários, Pix (`payslips`, `employees`) | Não (financeiro) | 7º-V, 7º-II | Supabase | ⚠ proposta: 5 anos após o desligamento (confirmar prazos fiscais/previdenciários) | Holerite cifrado; assinatura do holerite; acesso do RH registrado (`data_access_log`) |
| 3 | Controle de ponto e banco de horas | Cumprir a jornada e a CLT; calcular horas | Horários, ajustes, localização (`entrada_loc` etc.), selfie de conferência (`time_records`, `adjustment_requests`, `bank_*`, `activity_logs`) | Selfie e localização: dado pessoal, tratado com rigor de sensível | 7º-II, 7º-V | Supabase (selfies no bucket cifrado `ponto-selfies`) | ⚠ ponto: proposta mínima de 5 anos; **selfies e localização: proposta de 12 meses** (finalidade é conferência) | Selfie cifrada no Storage (`nexus-files`); acesso à selfie registrado; horário do servidor (RPC), não do aparelho |
| 4 | Férias e ausências | Programar e aprovar férias | Períodos, status, substituto (`vacations`) | Não | 7º-II, 7º-V | Supabase | ⚠ igual à operação 1 | RLS por perfil (colaborador vê as próprias solicitações) |
| 5 | Documentos e compliance | Guardar documentos obrigatórios e assinaturas | Arquivos (contrato, atestados, comprovantes), tipo, status, assinatura, trilha (`documents`, `document_requirements`, `document_audit_log`, Storage) | Sim, quando o arquivo é atestado/laudo | 7º-II, 7º-V, 11-II-a | Supabase Storage | ⚠ conforme o tipo (definir por tipo de documento) | Arquivos cifrados AES-256-GCM pela função `nexus-files`; trilha de auditoria; download em massa gera alerta |
| 6 | Comunicados | Informar colaboradores | Mensagens, anexos, leituras (`messages`, `message_reads`, `message_templates`) | Não | 7º-V, 7º-IX | Supabase | ⚠ proposta: 2 anos | RLS; anexos cifrados |
| 7 | Chat interno e chamados ao RH | Comunicação e atendimento | Mensagens, canais, chamados, avaliação de atendimento (`chat_*`, `hr_tickets`, `hr_ticket_messages`) | Pode conter (texto livre) | 7º-V, 7º-IX | Supabase | ⚠ proposta: 2 anos; chamados: 5 anos | Mensagens cifradas; conversas diretas 1:1 não legíveis pelo RH |
| 8 | Clima: feedback anônimo e elogios | Medir clima; reconhecimento | Texto do feedback, categoria; elogios entre pessoas (`anonymous_feedback`, `kudos`) | Pode conter | 7º-IX | Supabase | ⚠ proposta: 12 meses | Feedback **sem vínculo com o autor** (tabela sem identificador) e cifrado; colaborador não lê nem o próprio |
| 9 | Onboarding | Integrar novos colaboradores | Tarefas e progresso (`onboarding_*`) | Não | 7º-V | Supabase | Junto com a operação 1 | RLS |
| 10 | Alertas de compliance e de bem-estar | Prevenir descumprimento legal e adoecimento (horas extras excessivas) | Alertas por colaborador (`compliance_alerts`, `burnout_alerts`) | Inferência sobre bem-estar: tratar como possível dado de saúde | 7º-IX, 7º-II (limites de jornada) | Supabase; push (operação 15) | ⚠ proposta: 12 meses | RLS; visível ao RH e ao próprio; push só em horário comercial |
| 11 | Assistente de IA do RH | Resumir pendências, sugerir ações | Snapshot de colaboradores ativos enviado ao modelo; histórico cifrado (`ai_analysis_*`, `ai_chat_history`, `ai_decision_*`) | Possível (justificativas, burnout, nome de arquivo) | 7º-IX | **Groq (EUA)**, Supabase | ⚠ proposta: histórico 12 meses; **Groq: zero retenção (ZDR) a ligar** | Só Administrador com MFA; limite de 30/h; ação sugerida exige confirmação humana; histórico cifrado. Ver `operadores-e-groq.md` |
| 12 | Assistente de IA do colaborador | Tirar dúvidas de RH | Dados do próprio colaborador enviados ao modelo (nome, férias, banco de horas, 3 holerites) | Não, salvo texto livre | 7º-IX, 7º-V | **Groq (EUA)**, Supabase | Sem histórico próprio no servidor (vive no chamado, operação 7) | Só o próprio colaborador; limite de 60/h; resposta só com base nos dados do snapshot |
| 13 | Segurança e auditoria | Detectar acesso indevido e fraude; prestar contas | Falhas de login, IP, exportações, downloads, acessos do RH a dados, limite de requisições (`security_events`, `security_alerts`, `data_access_log`, `rate_limits`) | Não | 7º-IX, 11-II-g | Supabase | Eventos de segurança: **180 dias** (`purge_security_events`, automático). Demais: ⚠ definir | Tabelas fechadas à API; e-mail guardado só como hash nos eventos |
| 14 | Autenticação | Identificar quem acessa | E-mail, senha (hash do provedor), fatores TOTP, sessões (`auth.*`) | Não | 7º-V, 7º-IX | Supabase Auth | Enquanto a conta existir | MFA obrigatório para Administrador; limite de tentativas; sessão por perfil |
| 15 | Notificações push | Avisar de comunicados e alertas | Endpoint, chaves do navegador (`push_subscriptions`, `admin_push_subscriptions`) | Não | 7º-I (consentimento) | Supabase; serviço de push do navegador | Até o titular desligar ou a inscrição expirar | Só em horário comercial (direito à desconexão) |
| 16 | Backup e continuidade | Recuperar dados após falha | Cópia do banco (todos os dados acima, sem sessões nem chaves) | Sim (herda) | 7º-IX | Supabase (backup do provedor); cópia própria cifrada | Backups do provedor: conforme o plano contratado (Pro: 7 dias diários); cópia própria: ⚠ definir (proposta: 30 dias) | AES-256 (arquivo `.gpg`, frase fora do repositório); restauração testada todo mês por rotina agendada (`restore-drill`) |
| 17 | Hospedagem do site | Entregar as páginas | IP e cabeçalhos dos acessos | Não | 7º-IX | Vercel | Conforme o provedor | HTTPS, CSP, HSTS, sem cookies de rastreamento |

## Compartilhamentos e transferência internacional

| Destino | País | Mecanismo (art. 33) | Situação |
|---|---|---|---|
| Groq | EUA | SCCs europeias no DPA do fornecedor; **falta adesão às cláusulas-padrão da ANPD** | Pendente (`operadores-e-groq.md`) |
| Supabase | [PREENCHER: região do projeto] | Se fora do Brasil: SCCs europeias no DPA; falta cláusula ANPD | Pendente |
| Vercel | Global | SCCs europeias no DPA; falta cláusula ANPD | Pendente |
| Órgãos públicos (eSocial, Receita, Justiça do Trabalho) | Brasil | Obrigação legal | Sem envio automático pelo Nexus hoje |

## Direitos do titular (art. 18): como o sistema atende hoje

| Direito | Como |
|---|---|
| Confirmação e acesso | RH consulta e exporta o perfil completo (`colaboradores.js`, exportação registrada em `data_access_log`) |
| Correção | Colaborador edita nome, telefone, bio e foto; RH edita o restante (auditado em `employee_audit`) |
| Anonimização / eliminação | `anonymize_employee` (só para desligados; RH) |
| Portabilidade | Exportação de dados pelo RH a pedido do titular |
| Informação sobre compartilhamento | Política de Privacidade (`src/screens/privacidade.html`) e este registro |
| Revisão de decisão com IA | A IA só sugere; a decisão é humana. Pedido de revisão via chamado ao RH |
| Revogação de consentimento | Desligar notificações no perfil |

**Lacuna:** não há tela para o colaborador ver quem acessou os dados dele (a tabela existe e o colaborador pode lê-la pela API, mas não há interface). O atendimento hoje é manual, pelo RH, com prazo legal de 15 dias.
