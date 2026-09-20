# Plano de resposta a incidentes de segurança com dados pessoais

Versão 1.0, 2026-09-20. Vale para o Nexus e seus operadores (Supabase, Vercel, Groq). Base legal: LGPD art. 48 e [Resolução CD/ANPD nº 15/2024](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis) (verifique se houve alteração desde esta data).

**Regra que vale mais que o resto:** o relógio dos prazos legais começa quando a controladora **toma conhecimento** de que o incidente afetou dados pessoais. Não espere ter certeza de tudo para acionar o plano. Na dúvida, abra o incidente.

## 1. Papéis e contatos (preencher e manter atualizado)

| Papel | Quem | Contato (fora do Nexus: celular/e-mail pessoal) | Suplente |
|---|---|---|---|
| Coordenador do incidente (decide e registra) | [PREENCHER] | | |
| Encarregado / DPO (avalia risco, fala com ANPD e titulares) | [PREENCHER] | | |
| Responsável técnico (contém e investiga) | [PREENCHER] | | |
| Jurídico | [PREENCHER] | | |
| Comunicação (mensagem aos titulares) | [PREENCHER] | | |

Contatos de emergência dos fornecedores: painel do Supabase (suporte do projeto), Vercel (suporte), Groq (canal do Trust Center). Guarde também **onde estão as credenciais de administração** (cofre de senhas da equipe): sem elas a contenção atrasa.

## 2. O que é um incidente

Qualquer evento confirmado ou suspeito que comprometa a confidencialidade, integridade ou disponibilidade de dados pessoais: acesso não autorizado, vazamento, perda, alteração indevida, ransomware, chave ou credencial exposta, arquivo público por engano, envio de dados ao destinatário errado, falha de um operador que afete os nossos dados.

**De onde vem o aviso no Nexus:** alertas da tela Segurança do RH (login falho em série, exportação ou download em massa, acesso fora do horário), e-mail de operador, denúncia de colaborador, achado de pentest, monitoramento do GitHub/Dependabot.

## 3. Severidade

| Nível | Exemplos no Nexus | Meta de contenção | Aciona DPO |
|---|---|---|---|
| **1 — Crítico** | Chave do Vault, `SERVICE_ROLE_KEY` ou senha do banco vazadas; Administrador comprometido com exportação de dados; banco ou Storage acessível publicamente; ransomware | 1 hora | Imediato |
| **2 — Alto** | Credencial de colaborador comprometida; download em massa de documentos; envio de dados à IA além do previsto; incidente comunicado por operador | 4 horas | Em até 4 h |
| **3 — Médio/baixo** | Tentativas de login barradas; scan externo sem acesso; falha de configuração sem evidência de acesso | 1 dia útil | No relatório semanal |

## 4. Fluxo

1. **Detectar e registrar (0–1 h).** Quem percebeu abre a **ficha do incidente** (seção 8) com hora de conhecimento, o que viu e quem avisou. A hora de conhecimento é o marco dos prazos.
2. **Triar (até 2 h).** Coordenador define a severidade, chama o DPO se nível 1 ou 2 e abre um canal privado só da equipe de resposta (não use o chat do Nexus).
3. **Conter.** Playbooks da seção 5. Prefira conter a investigar: depois de estancar, o que foi perdido não aumenta.
4. **Preservar evidências, antes de "limpar".** Ver seção 6.
5. **Avaliar o risco aos titulares (DPO, até 24 h).** Quais dados, de quantas pessoas, se estavam cifrados e a chave também vazou, se há dado sensível ou de menores, possibilidade de fraude, discriminação ou dano financeiro. Registre a conclusão e o porquê, inclusive quando decidir **não** comunicar.
6. **Comunicar (seção 7).**
7. **Erradicar e recuperar.** Rotacionar segredos, corrigir a causa, restaurar dados se preciso (`backup-e-restauracao.md`), reabrir acesso com monitoramento reforçado por 30 dias.
8. **Encerrar com lições aprendidas (até 15 dias).** O que falhou, o que funcionou, ações com dono e prazo. Atualize este plano, o RIPD e o ROPA.

## 5. Playbooks

### P1 — Conta de Administrador (RH) comprometida
1. Desativar o usuário no painel do Supabase (Authentication → Users → Ban) e encerrar as sessões.
2. Trocar a senha e **remover e refazer o fator TOTP** do usuário.
3. Conferir na tela Segurança e em `security_events`, `data_access_log` e `activity_logs` o que a conta fez: exportações, downloads, leitura de perfis, alteração de dados (`employee_audit`).
4. Se houve exportação ou download em massa: tratar como vazamento (seção 7).
5. Verificar se outras contas usam a mesma senha ou o mesmo e-mail de recuperação.

### P2 — Segredo de plataforma exposto (`SERVICE_ROLE_KEY`, senha do banco, `GROQ_API_KEY`, VAPID, `FILES_ENCRYPTION_KEY`)
- **Service role / chave `anon` / JWT secret:** rotacionar no painel do Supabase (Settings → API), atualizar `supabase-client.js` (a `anon` é pública por desenho; a `service_role` **nunca** pode estar no front) e redeployar as Edge Functions.
- **Senha do banco:** Settings → Database → Reset database password.
- **`GROQ_API_KEY`:** revogar no console da Groq, criar outra e `npx supabase secrets set GROQ_API_KEY=...`. Revisar o uso no console (chamadas fora do padrão).
- **VAPID:** gerar novo par e `supabase secrets set`; as inscrições de push antigas deixam de funcionar (colaboradores reativam).
- **`FILES_ENCRYPTION_KEY`:** trocar exige recifrar os arquivos com `scripts/encrypt-existing-files.mjs`; **não apague a chave antiga antes** de concluir, ou os arquivos ficam irrecuperáveis.
- Procurar o segredo no histórico do Git (`git log -S`) e em logs; se estiver no repositório, considere-o público.

### P3 — Chave de cifragem de colunas (Vault) exposta ou perdida
- **Exposta:** gerar chave nova e recifrar todos os dados com as funções da migration 067, na ordem: `nexus_key_generate('encryption', 'v2')` → `nexus_key_activate('encryption', 'v2')` → `nexus_rewrap_all()` repetido até zerar, conferindo com `nexus_key_status()`. Faça o mesmo para `hmac`. Só apague a chave antiga depois de todos os dados estarem na nova.
- **Perdida:** se ainda houver o banco e a cópia offline das chaves, recolocá-las (ver `backup-e-restauracao.md`, seção "Chaves"). Sem a chave, os campos cifrados estão perdidos; restaure de backup **e** da cópia das chaves.
- Uma chave exposta **sem** acesso ao banco/backups tem risco baixo; o inverso (acesso ao banco com a chave) é vazamento de tudo o que estava cifrado.

### P4 — Arquivo, bucket ou página exposta publicamente
1. Tornar o bucket privado / remover o arquivo / corrigir `.vercelignore` e republicar.
2. Buscar nos logs de acesso quem baixou (Vercel e Supabase Storage logs) — **os logs do provedor têm retenção curta: exporte já**.
3. Arquivos de documentos e selfies estão cifrados pela função `nexus-files`; confirme se o objeto exposto era o cifrado (ilegível sem a chave) ou legado em claro.

### P5 — Uso indevido por quem tem acesso (RH ou gestor)
1. Preservar `data_access_log`, `security_events`, `employee_audit`, `activity_logs`.
2. Suspender o acesso (P1, passo 1) sem avisar a pessoa antes de a evidência estar preservada.
3. Acionar jurídico e RH superior: envolve relação de trabalho.
4. Avisar os titulares afetados quando houver risco relevante.

### P6 — Incidente no operador (Supabase, Vercel, Groq)
1. Os DPAs preveem aviso em até 48 h (Supabase), 72 h (Groq) ou "sem demora" (Vercel); a controladora **continua responsável** perante os titulares e a ANPD.
2. Pedir ao operador: quais dados nossos, período, causa, medidas. Registrar por escrito.
3. Seguir da etapa 5 do fluxo (avaliar risco e comunicar).

### P7 — Perda ou corrupção do banco / ransomware
1. Colocar o sistema em manutenção (ou revogar chaves de API) para impedir escrita sobre dados bons.
2. Restaurar: backup do provedor ou da nossa cópia cifrada (`backup-e-restauracao.md`). O procedimento é ensaiado todo mês.
3. Recolocar as chaves do Vault (sem elas, dados cifrados voltam vazios, sem erro).
4. Conferir integridade (contagens, RLS, login do RH, um holerite de teste) antes de reabrir.

### P8 — Suspeita de vazamento pela IA (Groq)
1. Revisar no console da Groq o uso e a política de retenção (ZDR ligado?).
2. Se algum dado além do previsto em `docs/lgpd/operadores-e-groq.md` foi enviado, tratar como incidente nível 2 e corrigir a Edge Function.
3. Desligar temporariamente a função (`supabase functions delete ai-alerts`, restaurando depois) se o envio indevido continuar.

## 6. Evidências (o que guardar e onde)

- Copiar e **arquivar em local próprio** antes do prazo de expurgo: `security_events` (é apagado após 180 dias por `purge_security_events`; durante uma investigação, suspender com `SELECT cron.unschedule('purge-security-events');` e reativar depois), `security_alerts`, `data_access_log`, `employee_audit`, `activity_logs`, `document_audit_log`.
- Logs do Supabase (Logs Explorer: Auth, API, Postgres, Edge Functions) e da Vercel: exportar na hora; a retenção depende do plano.
- Capturas de tela com data, hashes de arquivos exportados, e-mails trocados com operadores.
- Nada de conversar sobre o incidente por canais que o invasor possa ler (conta comprometida).

## 7. Comunicação

**Quando comunicar:** se o incidente puder acarretar **risco ou dano relevante** aos titulares (LGPD art. 48). Envolvimento de dado sensível, financeiro, de grande número de pessoas ou possibilidade de fraude praticamente sempre é relevante.

**Prazos (Resolução CD/ANPD nº 15/2024):**

| Comunicação | Prazo | Como |
|---|---|---|
| **ANPD** | **3 dias úteis** a partir do conhecimento de que dados pessoais foram afetados (o prazo é contado em dobro para agente de tratamento de pequeno porte; confirmar enquadramento com o jurídico) | Formulário eletrônico da ANPD (link acima), preenchido pelo DPO |
| **Titulares afetados** | Mesmo prazo, em linguagem simples | E-mail e aviso no Nexus |
| Complemento à ANPD | 20 dias úteis após a comunicação | Mesmo formulário |

- Se a informação ainda estiver incompleta no prazo, comunique com o que se sabe e complemente depois: **não** deixe passar o prazo esperando fechar a investigação.
- O **registro do incidente** (ficha + decisão de comunicar ou não + evidências) deve ser mantido pelo prazo exigido pela regulamentação (mínimo de 5 anos segundo a resolução; confirmar com o jurídico), mesmo quando não houve comunicação.

**Conteúdo da comunicação ao titular (art. 48, §1º):** descrição da natureza dos dados afetados; quem são os titulares envolvidos; medidas técnicas e de segurança usadas para proteção; riscos relacionados; motivos da demora, se houver; medidas adotadas ou que serão adotadas para reverter ou mitigar os efeitos; contato do encarregado.

Modelo de mensagem ao titular:

> Assunto: Aviso importante sobre seus dados no Nexus
>
> Em [data], identificamos [descrição simples do que aconteceu]. Os dados envolvidos foram: [lista: por exemplo, nome, CPF, e-mail]. [Os dados X estavam / não estavam cifrados.] Já tomamos as seguintes medidas: [lista]. Riscos possíveis para você: [por exemplo, tentativa de golpe usando seus dados]. O que recomendamos: [por exemplo, desconfiar de contatos pedindo dinheiro ou senhas, trocar a senha do Nexus]. Dúvidas: [nome do encarregado, e-mail].
> Comunicamos também a Autoridade Nacional de Proteção de Dados.

## 8. Ficha do incidente (copiar para um arquivo novo por incidente)

```
ID: INC-AAAA-NNN
Aberta em (hora do conhecimento): 
Quem detectou / como:
Severidade (1/2/3) e quem definiu:
Sistemas e dados afetados (tabelas, buckets, funções):
Nº aproximado de titulares:  Dados sensíveis? (s/n)
Cifrados? A chave também foi exposta? 
Linha do tempo (hora — ação — quem):
Contenção feita:
Evidências guardadas (onde):
Avaliação de risco do DPO (relevante? por quê):
Comunicado à ANPD? (data, protocolo) / aos titulares? (data, canal) / justificativa se não:
Causa raiz:
Correções e prazos (dono):
Encerrada em:
```

## 9. Preparação

- **Exercício de mesa uma vez por ano** (30 minutos, cenário P1 ou P2): registrar data, participantes, o que faltou. Último: [PREENCHER]. Próximo: [PREENCHER].
- **Conferir a cada trimestre:** lista de contatos, acesso das credenciais de emergência, `security_rules` (limites dos alertas), e a revisão de acessos (`revisao-de-acessos.md`).
- **Botão de pânico documentado:** desativar Administrador (P1), rotacionar segredos (P2) e manutenção do site estão descritos acima; teste pelo menos uma vez em ambiente de teste.
