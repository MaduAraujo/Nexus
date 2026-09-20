# LGPD no Nexus: o que existe e o que falta

Atualizado em 2026-09-20.

| Documento | O que é | Estado |
|---|---|---|
| Política de Privacidade pública | **Removida do projeto** (página `privacidade.html`, estilos e links no login e na página inicial). Recuperável pelo histórico do git | Sem política pública no ar |
| [`ropa.md`](ropa.md) | **Registro das operações de tratamento** (art. 37): 17 operações, base legal, retenção, operadores | Pronto, com campos `[PREENCHER]` e prazos de retenção como **proposta** |
| [`ripd.md`](ripd.md) | **Relatório de Impacto** (art. 38): necessidade, proporcionalidade, 13 riscos e medidas | Rascunho técnico completo; falta parecer do DPO e aprovação |
| [`operadores-e-groq.md`](operadores-e-groq.md) | **Contratos com operadores**, o que vai para a Groq, passo a passo do DPA/ZDR, modelo de pedido | Análise feita; **a contratação depende de quem tem conta na Groq** |
| [`../operacao/`](../operacao/) | Incidentes, backup e restauração, revisão de acessos, pentest | Ver cada arquivo |

## O que só uma pessoa da empresa pode fazer

Nada abaixo dá para fazer pelo código. Sem isso os documentos são rascunhos.

1. **Preencher os campos `[PREENCHER]`.** Para achar todos: `grep -rn "PREENCHER" src docs`. Os principais: razão social e CNPJ da controladora, nome e e-mail do encarregado (DPO), região do projeto Supabase, prazos de retenção confirmados pelo jurídico, data de vigência da política.
2. **Definir quem é a controladora.** Num TCC em grupo, a controladora é a empresa que usaria o sistema e a equipe é operadora. Isso muda quem assina o RIPD e os contratos.
3. **Groq:** conta da organização, aceitar o Services Agreement, **ligar o Zero Data Retention**, enviar o pedido de cláusulas da ANPD (modelo em `operadores-e-groq.md`). Enquanto isso não acontecer, o RIPD recomenda **não rodar o assistente de IA do RH com dados reais**.
4. **Jurídico:** revisar a política, o ROPA e o RIPD, principalmente bases legais (o legítimo interesse do assistente de IA e dos alertas de bem-estar) e prazos de retenção.
5. **Publicar** somente depois de conferir o item abaixo.

## Antes de publicar a política: o que ela afirma precisa ser verdade

A política diz que dados sensíveis ficam cifrados, que o RH usa verificação em duas etapas e que há alertas de comportamento anormal. No código isso existe (migrations 059 a 067), mas **precisa estar aplicado no projeto Supabase real**. Rode o bloco D de `scripts/ops/revisao-de-acessos.sql` e só publique se tudo vier `true`. Também confirme:

- [ ] TOTP habilitado no painel (Authentication → MFA);
- [ ] Edge Functions com a versão atual publicada;
- [ ] migration `068` aplicada (fecha leitura anônima de kudos e rotinas abertas a anônimos);
- [ ] `.vercelignore` publicado e `curl -I https://SEU-SITE/supabase/schema.sql` responde 404.

## Lacunas de produto que a LGPD exige e o sistema ainda não tem

- Retenção automática (só os eventos de segurança expiram, em 180 dias). Definir prazos e agendar rotinas de eliminação/anonimização.
- Tela para o titular ver quem acessou os dados dele (a tabela `data_access_log` existe; falta a interface).
- Aviso na tela do chat com IA de que a conversa é processada por terceiro (item 5 da seção 6 de `operadores-e-groq.md`).
- Minimização do que vai para a Groq (pseudonimizar nomes, retirar nome de arquivo e justificativas): seção 6 de `operadores-e-groq.md`.
