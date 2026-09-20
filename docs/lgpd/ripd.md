# Relatório de Impacto à Proteção de Dados Pessoais (RIPD)

LGPD, art. 5º XVII e art. 38. Versão 1.0, elaborada em 2026-09-20. Estrutura segundo o guia da ANPD para RIPD.
**Sistema:** Nexus (sistema de RH). **Controladora:** [PREENCHER]. **Encarregado (DPO):** [PREENCHER].
**Aprovação:** [PREENCHER: nome, cargo, data]. Enquanto não houver aprovação, este documento é um rascunho técnico para revisão do jurídico.

> **Leia antes de assinar.** Os controles marcados com ✱ existem no código do repositório, mas dependem de migrations ou configurações que precisam estar **aplicadas no projeto Supabase real** (060–067, MFA TOTP habilitado no painel, funções redeployadas, front publicado). Confirmar item a item (`docs/operacao/revisao-de-acessos.md`, seção "Conferência de implantação") antes de afirmar no RIPD que o controle está ativo.

## 1. Por que o RIPD é necessário

O tratamento reúne fatores que a ANPD trata como de risco elevado:

- dados pessoais sensíveis (PcD, raça/cor, atestados, inferências de bem-estar);
- dados de titulares em relação de subordinação (empregados), em que o consentimento não é base adequada;
- acompanhamento sistemático (ponto com localização e selfie, alertas comportamentais);
- uso de inteligência artificial de terceiro no exterior (Groq, EUA);
- dados financeiros (salário, holerite, conta bancária).

## 2. Descrição do tratamento

- **Natureza:** coleta em formulários do sistema, importação pelo RH, registros gerados pelo uso (ponto, chat), armazenamento em banco Postgres (Supabase), arquivos em Storage, processamento por Edge Functions e envio de parte dos dados a um modelo de IA.
- **Escopo:** ~[PREENCHER: nº] colaboradores; dados de identificação, vínculo, financeiros, ponto, documentos, comunicação e segurança. Inventário completo em `ropa.md` (17 operações).
- **Contexto:** empregados e RH da controladora. Expectativa razoável do titular: o empregador trata esses dados para cumprir a lei e gerir o contrato; **não** espera que dados de bem-estar ou textos livres sejam processados por IA de terceiros no exterior sem aviso claro (por isso a seção 5 da política de privacidade).
- **Finalidades:** ver `ropa.md`. Base legal por operação no mesmo documento.
- **Compartilhamento:** Supabase, Vercel, Groq, serviços de push do navegador (`operadores-e-groq.md`).

## 3. Necessidade e proporcionalidade

| Pergunta | Avaliação |
|---|---|
| Os dados são adequados e limitados ao necessário? | Em geral sim. Pontos de atenção: selfie e localização no ponto (manter só pelo tempo necessário à conferência); texto livre nas justificativas e no chat enviado à IA |
| Há base legal para cada finalidade? | Sim, por operação (`ropa.md`). O legítimo interesse do assistente de IA e dos alertas de bem-estar depende do teste de proporcionalidade abaixo |
| Teste de legítimo interesse (IA e alertas) | **Finalidade:** apoiar o RH a agir cedo sobre sobrecarga e pendências. **Necessidade:** os alertas usam só dados de jornada já tratados por obrigação legal; a IA recebe menos dados do que o RH já vê na tela. **Balanceamento:** o titular pode se opor (política, seção 8); a IA não decide; ação sugerida exige confirmação humana; notificações respeitam o horário comercial. Conclusão: **aceitável, condicionada** à minimização da seção 5 (R3) |
| Qualidade e transparência | Política de Privacidade pública (`src/screens/privacidade.html`), com IA e transferência internacional declaradas |
| Direitos do titular | Atendidos manualmente pelo RH em até 15 dias (`ropa.md`); lacuna: sem tela de acessos aos dados para o titular |
| Retenção | **Lacuna:** só `security_events` tem prazo automático (180 dias). Demais prazos são propostas em `ropa.md` |
| Operadores | Contratos online sem cláusula ANPD (`operadores-e-groq.md`) |

## 4. Partes interessadas

Titulares (colaboradores); RH e Administradores; gestores de equipe; encarregado (DPO); equipe técnica; operadores (Supabase, Vercel, Groq); ANPD. **Consulta aos titulares:** [PREENCHER: como e quando foi feita, por exemplo apresentação à equipe e coleta de dúvidas]. **Parecer do encarregado:** [PREENCHER].

## 5. Riscos e medidas

Escala: probabilidade e impacto em Baixo / Médio / Alto. Risco = a combinação; **residual** é o que sobra com as medidas já existentes.

| ID | Risco ao titular | P | I | Medidas existentes | Residual | Medida adicional (responsável, prazo) |
|---|---|---|---|---|---|---|
| R1 | **Acesso indevido por quem já tem acesso** (RH curioso, credencial de RH usada por outra pessoa) | M | A | RLS por perfil; MFA obrigatório para Administrador ✱; registro de acessos a perfil, documento, holerite e selfie (`data_access_log`); alertas de acesso fora do horário e de exportação em massa ✱; DMs fora do alcance do RH | Médio | Revisão trimestral de acessos (`revisao-de-acessos.md`); DPO lê os alertas de segurança |
| R2 | **Vazamento por credencial roubada** | M | A | MFA ✱; limite de tentativas de login ✱; alerta de falhas em série ✱; senha de 12+ caracteres (configurar no painel Supabase) | Médio | Códigos de recuperação do MFA; política de sessão |
| R3 | **Excesso de dados enviados à IA**, incluindo texto livre e inferências sobre saúde | A | A | Só nomes e pendências, nunca CPF, endereço, banco, PcD, raça/cor; limites de uso; ação com confirmação humana | **Alto** | Ligar ZDR na Groq; pseudonimizar nomes; remover nome de arquivo e justificativa do envio (`operadores-e-groq.md`, seção 6). Meta: Médio |
| R4 | **Transferência internacional sem mecanismo válido** (Groq, Supabase, Vercel) | A | M | DPAs online com SCCs europeias | **Alto** | Pedir adesão às cláusulas-padrão da ANPD (modelo pronto); confirmar região do Supabase. Meta: Baixo |
| R5 | **Decisão indevida baseada em alerta ou resumo de IA** (viés, erro, "alucinação") | M | A | IA só sugere; confirmação humana; resposta restrita ao snapshot; direito de revisão | Médio | Registrar em `ai_decision_log` (já existe, cifrado) e revisar amostra a cada trimestre |
| R6 | **Vigilância excessiva** (localização e selfie a cada batida, alertas de bem-estar) | M | M | Arquivos cifrados; acesso à selfie registrado; alertas só para RH e o próprio; sem monitoramento fora do ponto | Médio | Definir e automatizar retenção de selfie e localização (proposta: 12 meses) |
| R7 | **Perda de dados ou de chaves** (banco perdido; chave de cifragem perdida deixa tudo ilegível) | B | A | Backups do provedor; cópia cifrada própria e restauração testada (`docs/operacao/evidencias/restore-drill-*.md`); chaves fora do backup | Baixo | Guardar as chaves do Vault e `FILES_ENCRYPTION_KEY` em cofre fora do Supabase (e conferir que existe cópia) |
| R8 | **Retenção além do necessário** | A | M | Só `security_events` expira (180 dias) | Alto | Definir prazos com o jurídico e automatizar (pg_cron) |
| R9 | **Exposição de código, schema e documentos por hospedagem estática** | M | M | `.vercelignore` exclui `supabase/`, `docs/`, testes e scripts; conferir com `curl` após publicar | Baixo | Incluir a checagem no roteiro de publicação |
| R10 | **Reidentificação do feedback anônimo** (equipes pequenas, horário da mensagem) | B | M | Tabela sem autor; texto cifrado; colaborador não lê feedback | Baixo | Não expor `created_at` ao gestor; agrupar por período |
| R11 | **Incidente sem resposta organizada** (demora, sem comunicar titulares e ANPD no prazo) | M | A | Alertas de segurança; plano de resposta (`plano-resposta-incidentes.md`) | Médio | Simulação anual ("mesa") do plano |
| R12 | **Dados de saúde em atestados vistos por quem não precisa** | B | A | Arquivos cifrados; acesso registrado; download em massa gera alerta | Baixo | Restringir por tipo de documento (só RH) |
| R13 | **Falha de segurança na aplicação web** (XSS, injeção, configuração) | M | A | CSP sem `unsafe-inline` em scripts; guarda automática contra XSS; SRI nas bibliotecas; RLS testada em Postgres; dependências monitoradas | Médio | Pentest externo; primeiro passe com OWASP ZAP feito (`pentest-owasp-zap.md`) |

## 6. Conclusão

- **Riscos altos remanescentes:** R3, R4 e R8. Nenhum impede o uso do sistema, mas **o assistente de IA do RH não deve operar com dados reais de colaboradores** até que a Groq esteja com ZDR ligado e o pedido de cláusulas da ANPD tenha sido enviado (R3/R4).
- **Recomendação ao DPO:** aprovar o tratamento com as medidas adicionais e prazos acima; revisar o RIPD a cada 12 meses ou quando mudar o fornecedor de IA, o tipo de dado enviado ou houver incidente.

| Item | Preencher |
|---|---|
| Parecer do encarregado | |
| Aprovação do controlador (nome, cargo) | |
| Data | |
| Próxima revisão | |
