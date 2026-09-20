# Operadores, contrato com a Groq (DPA) e transferência internacional

Situação em 2026-09-20. As condições contratuais abaixo foram lidas nas páginas públicas dos fornecedores nessa data; **releia antes de assinar o RIPD**, porque mudam.

## 1. Quem trata dados pessoais do Nexus

| Operador | O que trata | Contrato de proteção de dados | Cita a LGPD/ANPD? | Notificação de incidente ao cliente | Aviso de novo suboperador |
|---|---|---|---|---|---|
| **Groq** (GroqCloud) | Texto enviado ao modelo de IA (ver seção 2) | [DPA online](https://console.groq.com/docs/legal/customer-data-processing-addendum), versão de 15/10/2025. Vale por aceite eletrônico do Services Agreement, sem assinatura à parte | **Não** | Até 72 h | 15 dias |
| **Supabase** | Banco, login, arquivos, Edge Functions | [DPA online](https://supabase.com/legal/customer-resources/data-processing-addendum), versão 1 de 01/08/2026. Aceite do contrato equivale a assinar as cláusulas | **Não** | Até 48 h, quando viável | 30 dias |
| **Vercel** | Hospedagem das páginas (IP e cabeçalhos dos acessos) | [DPA online](https://vercel.com/legal/dpa), de 17/03/2026. Vale ao aceitar o contrato | **Não** | "Sem demora indevida" | 5 dias úteis |
| Serviços de push do navegador (Google, Apple, Mozilla, Microsoft) | Endpoint da inscrição e conteúdo da notificação | Termos do navegador; o titular escolhe ativar | — | — | — |
| ViaCEP, OpenStreetMap, jsDelivr, cdnjs, unpkg | Recebem o IP do navegador (CEP digitado, mapa, bibliotecas) | Sem contrato; sem dado do Nexus além do IP e do CEP | — | — | — |

(As fontes do Google Fonts já foram baixadas para o repositório, em `src/styles/fonts.css`; o navegador não fala mais com o Google para isso.)

### O que os três DPAs deixam em aberto para a LGPD

1. **Nenhum cita a LGPD.** Os papéis (controlador/operador), a comunicação de incidentes e os direitos do titular da LGPD não estão escritos neles. Eles se aplicam a "leis de proteção de dados aplicáveis", e a LGPD é uma delas, mas isso é interpretação, não texto.
2. **Transferência internacional.** Os três usam as cláusulas-padrão da União Europeia (SCCs). Pela [Resolução CD/ANPD nº 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024), quem usa cláusulas contratuais como mecanismo do art. 33 da LGPD precisa adotar **o texto das cláusulas-padrão da ANPD (Anexo II), sem alteração**, e o prazo de adaptação terminou em **23/08/2025**. As SCCs europeias não substituem isso automaticamente. Antes de dar o assunto por encerrado, conferir no site da ANPD se houve reconhecimento de equivalência das SCCs europeias.
3. **Quem assina é a controladora.** A obrigação de ter mecanismo válido de transferência é da controladora (a empresa que usa o Nexus). A equipe do projeto, como operadora, precisa entregar os documentos prontos.

**Ações (responsável: encarregado/DPO + jurídico):**

- [ ] Confirmar a região do projeto Supabase. Se for São Paulo (`sa-east-1`), o banco e os arquivos ficam no Brasil; sobra apenas o acesso remoto de suporte. Anotar em `ropa.md` e na política de privacidade.
- [ ] Pedir por escrito, a cada um dos três, a adesão às cláusulas-padrão da ANPD ou aditivo LGPD (modelo na seção 4). Guardar resposta ou o registro de que não houve resposta.
- [ ] Guardar uma cópia datada (PDF) de cada DPA aceito e o hash SHA-256 (`Get-FileHash`), como prova do que valia no dia.
- [ ] Sem resposta ou recusa: registrar no RIPD o risco residual e decidir (seção 5).

## 2. O que vai para a Groq (mapa do fluxo)

Código: `supabase/functions/ai-employee-chat/index.ts` e `supabase/functions/ai-alerts/index.ts`. Modelo: `openai/gpt-oss-120b`. A chave fica no segredo `GROQ_API_KEY` da Edge Function.

**Assistente do colaborador** (`ai-employee-chat`, só perfil `colaborador`, limite de 60 mensagens/hora). Envia dados **da própria pessoa**:

| Campo enviado | Observação |
|---|---|
| Nome, cargo, departamento, data de admissão, tipo de contrato, jornada | Identificação e vínculo |
| Saldo de férias estimado e período aquisitivo | |
| Banco de horas (saldo, vencimentos) | |
| **Três últimos holerites: competência, salário líquido, status** | Dado financeiro |
| Nomes/tipos de documentos pendentes de aprovação | Pode revelar a natureza do documento (por exemplo, "atestado") |
| Quantidade de ajustes de ponto pendentes | |
| Histórico da conversa e a pergunta (até 2.000 caracteres) | Texto livre: a pessoa pode digitar qualquer dado, inclusive de saúde |

**Assistente do RH** (`ai-alerts`, só `Administrador` com MFA, limite de 30 chamadas/hora). Envia dados **de todos os colaboradores ativos**:

| Campo enviado | Observação |
|---|---|
| Nome, departamento, cargo, data de admissão (tempo de casa) | |
| Férias pendentes (nome, datas, dias, tempo de espera) | |
| Ajustes de ponto pendentes: nome, data, tipo, **justificativa (até 100 caracteres)** | Texto livre; pode conter dado de saúde ("consulta médica") |
| **Alertas de burnout** por nome | Inferência sobre bem-estar; tratar como possível dado de saúde |
| Documentos pendentes: nome do colaborador e **nome do arquivo** | Nome de arquivo pode revelar saúde ("atestado_...") |
| Colaboradores sem ponto nos últimos 7 dias | Nome e departamento |
| Últimas 10 decisões da memória da IA (descrição) | Texto livre do RH |
| Histórico da conversa e a pergunta do RH | Texto livre |

**Não vão para a Groq:** CPF, RG, telefone, e-mail, data de nascimento, endereço, dados bancários/Pix, salário (nenhum dos dois assistentes o envia), PcD, raça/cor, pensão, conteúdo de chat entre colaboradores, feedback anônimo, arquivos e selfies.

Observação: `ai-employee-chat` lê `salary` em `employees_decrypted`, mas **não** o envia (o snapshot só carrega `salario_liquido` dos holerites).

## 3. O que a Groq oferece hoje (fonte: documentação pública, 2026-09-20)

- Por padrão a Groq [diz não reter dados de inferência](https://console.groq.com/docs/your-data), exceto registros temporários, por até 30 dias, para investigar falhas de confiabilidade ou suspeita de abuso.
- **Zero Data Retention (ZDR):** "todos os clientes podem habilitar ZDR nas configurações de Data Controls". Com ZDR ativo a Groq não retém dados nem para essas exceções.
- Dados retidos ficam em buckets GCP nos Estados Unidos.
- DPA: papéis controlador/operador (seção 2.1), auditoria a pedido (1 vez a cada 12 meses, custo do cliente; relatório SOC 2 atende a primeira verificação), exclusão em até 180 dias após o término do contrato, criptografia em repouso e em trânsito, SOC 2 Tipo II.
- A documentação consultada não afirma expressamente se a Groq treina modelos com dados de clientes. **Confirmar por escrito** (item do modelo abaixo).

## 4. Passo a passo para fechar o contrato

1. **Conta da empresa, não pessoal.** A conta GroqCloud que gera a `GROQ_API_KEY` precisa pertencer à organização controladora (ou, pelo menos, a uma conta de organização com o e-mail institucional). Quem aceita o Services Agreement é quem vincula o DPA.
2. **Aceitar o Services Agreement** e salvar PDF datado do Services Agreement e do DPA, com hash.
3. **Ligar o ZDR:** console.groq.com → Settings → Data Controls → Zero Data Retention. Tirar captura de tela com data para o registro de evidências.
4. **Inscrever-se na lista de suboperadores** (trust.groq.com/subprocessors) para receber o aviso de 15 dias de mudança.
5. **Enviar o pedido** (modelo abaixo) pelo canal indicado no Trust Center da Groq.
6. Registrar no RIPD (`ripd.md`, risco R3 e R4) o que foi obtido.

### Modelo de pedido (em inglês, pelo canal do Trust Center da Groq)

> Subject: LGPD (Brazil) transfer mechanism and data-handling confirmation for GroqCloud customer [ORGANIZATION]
>
> We are a Brazilian controller using GroqCloud (model openai/gpt-oss-120b) to process HR data of our employees. Your DPA (version of Oct 15, 2025) does not reference Brazil's LGPD. Please confirm:
> 1. Whether Groq will adhere to the standard contractual clauses approved by ANPD Resolution CD/ANPD No. 19/2024 (Annex II), or sign an LGPD addendum, for transfers of personal data from Brazil to the United States.
> 2. That Zero Data Retention is enabled on our organization ([ORG ID]) and what it covers (prompts, completions, logs, abuse-monitoring copies).
> 3. That customer data is not used to train or improve models.
> 4. The current sub-processor list and the regions where inference runs.
> 5. The contact for security incident notifications (DPA section 6, 72 hours).
>
> Contact: [DPO name, e-mail].

## 5. Se a Groq não aderir às cláusulas da ANPD

Nesta ordem de preferência:

1. **Reduzir o que é enviado até não haver dado pessoal identificável** (pseudonimização com tabela de correspondência guardada só no Nexus, ver seção 6). Dado pseudonimizado ainda é dado pessoal se o operador consegue reidentificar; aqui a Groq não teria como, mas a decisão de tratá-lo como anonimizado precisa ficar registrada no RIPD.
2. **Trocar de provedor** por um com região no Brasil/UE e aditivo LGPD, mantendo a mesma interface (as duas funções só dependem de `chat/completions`).
3. **Desligar o assistente do RH** (é o de maior volume e mais sensível) e manter só o do colaborador.
4. Não usar consentimento do colaborador como base de transferência: numa relação de emprego ele não é considerado livre.

## 6. Melhorias técnicas recomendadas (não implementadas)

Não alterei as Edge Functions: não há como testar Deno aqui e a mudança altera o comportamento da IA em produção. Em ordem de custo-benefício:

1. `ai-alerts`: trocar nomes por códigos ("Colaborador C7") antes de enviar e traduzir de volta na resposta. As respostas em streaming e o formato `ACTION:{...ids}` já usam **ids**, então o mapeamento só precisa cobrir os nomes no texto.
2. `ai-alerts`: parar de enviar o **nome do arquivo** dos documentos pendentes (`d.name`), só o tipo (`tipo`).
3. `ai-alerts`: reduzir `justificativa` para uma categoria, ou remover; hoje até 100 caracteres de texto livre.
4. `ai-employee-chat`: enviar só o primeiro nome; decidir se `liquido` dos holerites precisa ir (é o dado mais sensível que sai daqui).
5. Aviso na tela do chat de que a conversa é processada por IA de terceiros e para não digitar dados de saúde ou de terceiros.
