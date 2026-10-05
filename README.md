<div align="center">

# Nexus

### Plataforma de Gestão de Recursos Humanos

[![Status](https://img.shields.io/badge/status-ativo-22c55e?style=flat-square)](https://nexus-nine-zeta.vercel.app)
[![Versão](https://img.shields.io/badge/versão-1.0-6366f1?style=flat-square)](https://github.com/MaduAraujo/Nexus)
[![Deploy](https://img.shields.io/badge/deploy-Vercel-black?style=flat-square&logo=vercel)](https://nexus-nine-zeta.vercel.app)

**[→ Acessar o Nexus](https://nexus-nine-zeta.vercel.app)**

</div>

---

## Sobre

O Nexus centraliza tudo que o time de RH e os colaboradores precisam em um único ambiente digital — ponto, férias, documentos, comunicados, holerites e monitoramento de bem-estar com inteligência artificial.

Empresas perdem horas toda semana gerenciando ponto em planilha, férias por e-mail e documentos em pastas compartilhadas. O Nexus elimina esse retrabalho com um sistema estruturado, em tempo real e acessível a qualquer empresa, independente do porte.

---

## Índice

- [Como começar](#como-começar)
- [Configuração local](#configuração-local)
- [Painel do RH](#painel-do-rh)
- [Portal do Colaborador](#portal-do-colaborador)
- [Inteligência Artificial](#inteligência-artificial)
- [Segurança e criptografia](#segurança-e-criptografia)
- [Privacidade (LGPD) e operação](#privacidade-lgpd-e-operação)
- [Tecnologias](#tecnologias)
- [Equipe](#equipe)

---

## Como começar

A plataforma opera com dois perfis de acesso: **RH / Administrador** e **Colaborador**.

**1. Acesse o painel do RH**

As credenciais de demonstração não ficam publicadas aqui — solicite acesso diretamente à autora do projeto.

**2. Cadastre os colaboradores:**
No módulo **Colaboradores**, adicione os membros da equipe.

**3. Convites automáticos:**
Ao cadastrar, a plataforma envia automaticamente um convite por e-mail para o colaborador, com a identidade visual do Nexus. Se o e-mail já tiver conta, ele recebe um link para definir uma nova senha.

**4. Colaborador acessa o portal:**
O colaborador clica em **Ativar minha conta**, define sua senha e passa a ter acesso ao próprio portal — com ponto, holerites, documentos e muito mais. O link é de uso único e tem prazo de validade; se vencer, o RH reenvia o convite.

---

## Configuração local

O Nexus é **HTML/CSS/JS puro, sem framework e sem build step** — não há bundler, então basta servir os arquivos estaticamente. O backend é 100% Supabase (Postgres + Auth + Storage + Realtime + Edge Functions).

### Pré-requisitos

- [Node.js](https://nodejs.org/) 20+ (só para rodar lint, testes e o servidor estático de desenvolvimento — não é usado em produção)
- Uma conta/projeto no [Supabase](https://supabase.com/) (para rodar contra a nuvem) **ou** [Docker](https://www.docker.com/) + [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (para rodar 100% localmente, inclusive os testes de integração e E2E)

### 1. Clonar e instalar dependências

```bash
git clone https://github.com/MaduAraujo/Nexus.git
cd Nexus
npm install
```

### 2. Configurar o cliente Supabase

Copie o arquivo de exemplo e preencha com as credenciais do seu projeto Supabase (Project Settings → API):

```bash
cp src/javascript/shared/supabase-client.example.js src/javascript/shared/supabase-client.js
```

Edite `SUPABASE_URL` e `SUPABASE_ANON_KEY` em `src/javascript/shared/supabase-client.js`. A `anon key` é uma chave pública (protegida pela RLS do banco, não por sigilo) — pode ficar commitada, ao contrário da `service_role key`, que nunca deve sair do backend/Edge Functions.

### 3. Aplicar o schema do banco

Em um projeto Supabase **novo** (recém-criado), carregue o schema consolidado primeiro — as migrations em `supabase/migrations/` são incrementais e assumem que as tabelas base (`employees` etc.) já existem, então `db push` sozinho falha em um banco vazio:

```bash
npx supabase link --project-ref SEU_PROJECT_REF
psql "SUA_CONNECTION_STRING" -f supabase/schema.sql
```

(a connection string fica em Project Settings → Database → Connection string no dashboard; alternativamente, cole o conteúdo de `supabase/schema.sql` direto no SQL Editor). Só depois disso, para futuras alterações incrementais, use `npx supabase db push` normalmente — a partir daí o banco já está na baseline que as migrations esperam.

### 4. Configurar as Edge Functions (opcional, para IA, convites e push)

As functions em `supabase/functions/` são `invite-employee`, `ai-alerts`, `ai-employee-chat`, `nexus-files`, `mfa-recover`, `send-push`, `send-alert-push`, `send-document-push` e `send-chat-push`. As de IA (`ai-alerts` e `ai-employee-chat`) precisam da chave da [Groq](https://console.groq.com/):

```bash
npx supabase functions deploy
npx supabase secrets set GROQ_API_KEY=sua_chave_aqui
```

A `nexus-files` cifra e decifra os arquivos do Storage (documentos, anexos de ponto e de chat, selfies). **Sem ela publicada, nenhum upload nem abertura de arquivo funciona**, porque o front não tem alternativa. Ela precisa de uma chave mestra própria, em base64 de 32 bytes (guarde uma cópia fora do Supabase: sem ela os arquivos cifrados são irrecuperáveis):

```bash
npx supabase secrets set FILES_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

**Trocar a chave dos arquivos** (cada arquivo guarda no cabeçalho o identificador da chave que o cifrou; sem as variáveis abaixo a chave atual vale como `v1`):

```bash
# 1. chave nova ativa + a antiga só para leitura, e republique a nexus-files
npx supabase secrets set FILES_ENCRYPTION_KEY=$(openssl rand -base64 32) FILES_ENCRYPTION_KEY_ID=v2 FILES_ENCRYPTION_OLD_KEYS=v1:CHAVE_ANTIGA
npx supabase functions deploy nexus-files
# 2. recifre o que já está no Storage (mesmas três variáveis + SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente)
node scripts/rotate-file-key.mjs --dry-run
node scripts/rotate-file-key.mjs
# 3. quando o script disser que nada depende mais da chave antiga, tire-a de FILES_ENCRYPTION_OLD_KEYS
```

A `mfa-recover` recebe o código de recuperação do MFA, confere no banco (uso único, até 5 tentativas a cada 15 min) e desvincula o app autenticador pela API de admin do Auth. Não precisa de segredo próprio.

Depois de publicar as funções, confira no painel do Supabase (Edge Functions) que as oito aparecem. Uma função ausente responde 404 ao front.

A function `send-push` envia notificações push (Web Push) quando o RH publica um comunicado imediato (não agendado). Ela precisa de um par de chaves VAPID como secret — gere o seu com `npx web-push generate-vapid-keys` e configure:

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=sua_chave_publica VAPID_PRIVATE_KEY=sua_chave_privada
```

A function `send-document-push` avisa por push o colaborador quando o RH lhe entrega um documento (contrato, termos, políticas). Usa os mesmos secrets VAPID, só envia em horário comercial (fora dele o aviso fica apenas na tela inicial do colaborador) e respeita a preferência "Documentos do RH" em Meu Perfil.

A function `send-chat-push` avisa por push quem recebe mensagem no chat (DM, canal, resposta do RH no atendimento) e o RH quando um colaborador pede atendimento. É chamada por triggers da migration `113` (via Vault, como as de alerta), só envia em horário comercial, nunca leva o conteúdo da mensagem (que pode estar cifrado de ponta a ponta) e respeita a preferência "Mensagens do chat" em Meu Perfil. Em canais com várias pessoas só a primeira mensagem não lida avisa; as seguintes aparecem no contador do menu.

A chave pública também precisa ser colada em `VAPID_PUBLIC_KEY` no topo de `src/javascript/perfil-colaborador.js` (client-side, por isso não é secret) — mantenha as duas em sincronia. Sem isso configurado, o botão "Notificações push do navegador" em Meu Perfil aparece normalmente, mas o envio real falha silenciosamente (log no `send-push`).

**Este passo é diferente do anterior** — é o Vault do Postgres (não `supabase secrets`), e sem ele **nenhum push server-side sai**: nem o reenvio de comunicado adiado por horário comercial (direito à desconexão), nem os alertas de compliance/burnout. As funções `dispatch_deferred_pushes()` e `notify_alert_push()` (rodam via `pg_cron`/triggers, não recebem `Authorization` de usuário) leem a URL do projeto e a service role key do Vault — sem eles, elas dão `RETURN` silencioso (mas emitem `RAISE WARNING`, visível nos Postgres Logs do dashboard ou via `get_logs`). Rode uma vez no SQL Editor do projeto (Project Settings → API para pegar a URL e a `service_role` key):

```sql
select vault.create_secret('https://SEU_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'service_role_key');
```

Se os secrets já existirem (confira com `select name from vault.secrets where name in ('project_url','service_role_key');`), **não rode `create_secret` de novo** — isso cria um registro duplicado com o mesmo nome, e as funções acima (que fazem `SELECT ... INTO` sem `LIMIT`) podem silenciosamente pegar o valor errado. Para atualizar um valor existente, use `vault.update_secret(id, novo_valor)` pelo `id` do secret.

### E-mails de convite e de senha

Os modelos ficam em `supabase/templates/`:

| Arquivo | Modelo do Supabase | Assunto |
|---|---|---|
| `convite.html` | Invite user | Seu acesso ao Nexus |
| `redefinir-senha.html` | Reset Password | Redefinição de senha no Nexus |

O `supabase/config.toml` já os usa no Supabase local. **O projeto hospedado não lê o `config.toml`:** cole o conteúdo de cada arquivo e o assunto em Authentication → Emails → Templates. O `redefinir-senha.html` é usado tanto no "Esqueci minha senha" quanto quando o RH convida um e-mail que já tem conta (`invite-employee`), por isso o texto é neutro.

Para o link do e-mail abrir o app, configure em Authentication → URL Configuration o **Site URL** (`https://nexus-nine-zeta.vercel.app`) e inclua `https://nexus-nine-zeta.vercel.app/**` em **Redirect URLs**.

**Remetente (SMTP):** o servidor padrão do Supabase envia poucos e-mails por hora e cai no spam com facilidade. Configure um SMTP próprio em Project Settings → Authentication → SMTP Settings. Opções:

- **Gmail com senha de app** (grátis, usado na demonstração): host `smtp.gmail.com`, porta `465`, usuário e remetente = o Gmail, senha = uma [senha de app](https://myaccount.google.com/apppasswords) (exige verificação em duas etapas). Limite de cerca de 500 e-mails por dia. O Supabase avisa que o Gmail é um provedor pessoal; o envio funciona, mas para uso real prefira a opção abaixo.
- **Serviço transacional com domínio próprio** (ex.: Resend): verifique o domínio com os registros SPF, DKIM e DMARC que o serviço indicar e use host `smtp.resend.com`, porta `465`, usuário `resend` e a API key como senha.

### 5. Rodar o app localmente

Sem build step — qualquer servidor estático funciona:

```bash
node test-support/static-server.js
# abre em http://127.0.0.1:4173/src/screens/login.html
```

### 6. Rodar os testes

O projeto tem 3 camadas de teste automatizado (o número exato de casos muda a cada mudança; rode os comandos para ver):

```bash
npm test               # unidade e telas (jsdom) — folha/CLT/rescisão/férias/estágio, criptografia, MFA, guarda de XSS e de CSP, mais de 2.000 casos, sem dependências externas
npm run test:coverage   # o mesmo, exigindo 99% de linhas, ramos e funções (piso do CI)
npm run check:edge      # checagem de tipos das Edge Functions (Deno)
npm run test:pwa        # manifesto e service worker do PWA
npm run lint            # ESLint
npm run format:check    # Prettier (não rode Prettier em .html)
```

Os testes de **integração** (RLS real contra Postgres) e de **sistema/E2E** (Playwright, navegador real) precisam de uma instância local do Supabase via Docker:

```bash
npx supabase start --exclude analytics,storage,studio,realtime,imgproxy,vector,edge-runtime,functions
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/schema.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f test-support/local-test-db-grants.sql

npm run test:integration   # RLS, criptografia, MFA, regras de folha/férias/documentos no banco, biometria e funções abertas a anônimos

npx playwright install --with-deps chromium
npm run test:e2e           # fluxos completos no navegador: login, folha, rescisão, documentos, comunicados, vários perfis, acessibilidade (axe, WCAG 2.1 AA) e navegação por teclado
npm run test:load          # carga: 20 colaboradores + 3 RH simultâneos, p95 ≤ 2 s
```

> **Já tem um Supabase local com o esquema antigo?** O `schema.sql` é para um banco vazio e não se sobrepõe a tabelas existentes. Em vez de recriar o seu banco de desenvolvimento, suba um segundo stack isolado: copie `supabase/config.toml` para uma pasta nova (`supabase/config.toml` dentro dela), troque o `project_id` e some 1000 às portas 543xx, rode `npx supabase start --exclude logflare,storage-api,studio,realtime,imgproxy,vector,edge-runtime` ali, carregue `schema.sql` e `local-test-db-grants.sql` na porta `55322` e rode os testes com `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres` e `E2E_SUPABASE_URL=http://127.0.0.1:55321`.

Tudo isso roda automaticamente em CI a cada push/PR para `main` (`.github/workflows/tests.yml`): jobs `test` (unidade com cobertura, lint, formatação, Edge Functions, PWA e `npm audit`), `rls-integration` (integração), `e2e` (fluxos no navegador com acessibilidade e teclado, e carga) e `security-scan` (varredura OWASP ZAP). O ensaio de restauração do backup roda todo mês (`restore-drill.yml`).

---

## Painel do RH

<div align="center">

![Painel RH](README/Captura%20de%20tela%202026-05-18%20134234.png)

</div>

| Módulo | Descrição |
|---|---|
| **Painel** | Tela inicial com calendário e acesso rápido a todos os módulos |
| **Dashboard** | Indicadores da equipe em tempo real, incluindo horas de treinamento e taxa de promoção |
| **Colaboradores** | Cadastro com checklist de documentos por tipo de contrato, convite por e-mail, catálogo de cargos e salários, treinamentos, processos disciplinares, atestados e consulta às avaliações de desempenho |
| **Gestão de Horas** | Aprovação de registros de ponto, ajustes e banco de horas |
| **Férias** | Solicitações com fluxo de aprovação, férias coletivas, abono pecuniário e recibo de férias |
| **Pagamentos** | Folha mensal com faltas e DSR, INSS e IRRF, 13º salário, recibo de férias, rescisão e regras de estágio |
| **Comunicação Interna** | Comunicados (com envio respeitando o horário comercial) e chat com a equipe |
| **Atendimento ao Colaborador** | Chamados abertos pelos colaboradores, com avaliação do atendimento |
| **Arquivos** | Documentos por colaborador, com guarda legal (documento aprovado não pode ser apagado antes do prazo) |
| **Central de Alertas** | Detecção de risco de burnout e de prazos de compliance com inteligência artificial |
| **Segurança** | Alertas de comportamento anormal, chaves de criptografia de ponta a ponta e proteção de arquivos antigos |

---

## Portal do Colaborador

Cada colaborador tem um espaço personalizado com seus dados de cargo, departamento e data de admissão.

<div align="center">

![Portal do Colaborador](README/Captura%20de%20tela%202026-05-18%20134331.png)

</div>

| Módulo | Descrição |
|---|---|
| **Painel** | Tela inicial com sino de avisos (comunicados não lidos) e alerta de documentos do RH para assinar |
| **Ponto** | Registro com selfie e reconhecimento facial com prova de vida, funcionamento offline e pedidos de ajuste |
| **Férias** | Saldo, solicitações, venda de 10 dias (abono) e status de cada pedido |
| **Holerites** | Histórico de contracheques e recibos de férias, com assinatura eletrônica e informe de rendimentos |
| **Documentos** | Envio das pendências do checklist e documentos entregues pelo RH, cifrados de ponta a ponta |
| **Comunicados** | Comunicados da empresa com controle de leitura |
| **Meu Desempenho** | Avaliações concluídas, metas do PDI, treinamentos (inclusive cursos externos), processos disciplinares com ciência eletrônica e atestados |
| **Minha Equipe** | Para gestores: time, avaliações de desempenho, treinamentos e aprovação de férias |
| **Chat** | Conversas com colegas e canais, e atendimento com o RH |
| **Perfil** | Dados pessoais, foto, biografia, MFA e preferências de notificação |

---

## Inteligência Artificial

O módulo **Central de Alertas** usa a API da Groq (modelo GPT-OSS 120B) para analisar padrões de comportamento — excesso de horas, ausências frequentes, baixa interação — e sinalizar automaticamente possíveis riscos de burnout para o RH. A gestão de pessoas passa a agir de forma preventiva, antes que o problema se agrave.

<div align="center">

![Central de Alertas](README/Captura%20de%20tela%202026-05-18%20140350.png)

</div>

---

## Segurança e criptografia

**Em trânsito:** todo o tráfego usa HTTPS (Vercel e Supabase).

**Em repouso, no banco (criptografia em nível de coluna, AES-256 via `pgcrypto`)** — migration `059_column_encryption.sql`:

| Dado | Onde |
|---|---|
| CPF, RG, telefone, salário, chave PIX, agência e conta | `employees` |
| Data de nascimento, gênero, raça/cor, deficiência e tipo de pensão (dados pessoais sensíveis, LGPD art. 5º, II) | `employees` (migration 062) |
| Mensagens de canais e conversas diretas | `chat_messages.content` |
| Mensagens do atendimento com o RH | `hr_ticket_messages.content` |

Como funciona:

- **Escrita:** triggers cifram sozinhos. O código continua gravando texto normal em `employees`, `chat_messages` e `hr_ticket_messages`.
- **Leitura:** as tabelas devolvem texto cifrado. Para ler o valor, use as views **`employees_decrypted`**, **`chat_messages_decrypted`** e **`hr_ticket_messages_decrypted`**. Elas respeitam a RLS e só decifram para quem tem direito ao dado (RH e a própria pessoa em `employees`; membros em conversas; RH nunca em conversas diretas). O gestor enxerga a equipe, mas sem nenhum dos campos cifrados.
- **Amarração ao dono:** cada valor cifrado carrega o seu dono (`emp:<id>`, `chan:<id>`, `tkt:<id>`). Copiar o texto cifrado de uma linha para outra não revela nada, e a função de decifrar confere a autorização antes de abrir.
- **CPF único:** `cpf_hash` é um índice cego (HMAC-SHA256, com ou sem máscara) que garante unicidade sem guardar o CPF em claro.

**Chaves:** ficam no **Supabase Vault** (`data_encryption_key` e `data_hmac_key`), geradas pela própria migration. Nunca estão no código nem no navegador.

> ⚠️ **Guarde uma cópia das duas chaves fora do Supabase** (gerenciador de senhas do time) e faça backup do banco antes de aplicar a migration. Sem as chaves, os dados cifrados **não podem ser recuperados**. Para ler: `select name, decrypted_secret from vault.decrypted_secrets where name in ('data_encryption_key','data_hmac_key');`

**Aplicando em um banco existente:** rode as migrations em ordem, a partir da `057` até a mais recente. A 059, a 062 e a 064 cifram os dados que já existem (a 064 exige a 059 e a 062 antes); a 060 restringe o que o colaborador edita; a 061 cria o limite de chamadas da IA; a 063 exige MFA para o RH; a 065 libera os buckets para arquivos cifrados; a 066 cria os alertas de comportamento anormal; a 067 permite trocar as chaves de cifragem; a 068 fecha leituras e execuções que estavam abertas a anônimos; a 082 faz as funções de RPC exigirem o segundo fator de quem tem MFA; a 083 cifra o histórico de edição; a 084 cria os códigos de recuperação do MFA; a 085 cria as tabelas de chaves da criptografia de ponta a ponta; a 086 estende essas chaves aos canais de grupo; a 087 e a 088 guardam o certificado do treinamento e exigem anexo no atestado; a 089 impede excluir colaborador que tenha holerite, ponto ou documento (prazo legal de guarda); a 090 cria o bucket de documentos; a 091 leva para o banco as regras de folha, guarda de documentos e atendimentos; a 092 isola a biometria facial; a 093 cria o recibo de férias com abono; a 094 otimiza as políticas de RLS; a 095 leva as regras de férias para o banco; a 096 fecha para anônimos as funções que não precisam ser públicas e a 097 reabre só as quatro que as políticas de acesso usam; a 098 cria os índices das chaves estrangeiras; a 099 tira todo o acesso de quem foi desligado; a 106 guarda o valor da pensão alimentícia (cifrado), cria as convenções coletivas com piso salarial e faz o banco barrar a dispensa sem justa causa durante a estabilidade; a 108 impede alterar holerite já pago, grava o ponto feito sem internet no horário do aparelho (com trava contra horário futuro ou de outro dia, sem sobrescrever marcação) e protege os débitos de banco de horas lançados pela folha; a 109 faz a versão nova de um documento desmarcar a anterior na mesma gravação. Ordem de publicação que evita travar o RH: habilite o TOTP no painel do Supabase (Authentication → MFA) e publique o front antes da 063, e publique o front e as Edge Functions junto com a 064 e a 065 (front antigo lê a tabela cifrada). Em um projeto novo, `supabase/schema.sql` já traz tudo.

**Regras para quem desenvolve:**

- Para **ler** CPF, RG, telefone, salário, PIX, agência, conta, nascimento, gênero, raça/cor, deficiência ou o conteúdo de mensagens, consulte a view `*_decrypted`. A tabela devolve texto cifrado.
- Depois de **adicionar coluna** em `employees`, rode `select nexus_refresh_employees_view();` (o teste `test-integration/column-encryption.js` falha se a view ficar desatualizada).
- Para cifrar **outra coluna**, siga o padrão de `employees_encrypt_sensitive()` na migration 059.

**Também cifrados** (migrations 064, 065 e 083): holerites (`payslips`), o histórico de edição (`employee_audit.changes`, lido pela view `employee_audit_decrypted`), feedback anônimo, as tabelas de histórico, cache, memória e log da IA do RH, os indicadores `pcd` e `pensao_alimenticia`, e os arquivos dos buckets `documents`, `message-attachments` e `ponto-selfies` (AES-256-GCM pela Edge Function `nexus-files`, chave mestra no segredo `FILES_ENCRYPTION_KEY`). A leitura segue o mesmo padrão das views `*_decrypted`.

**O que ainda NÃO é cifrado:** avatares (bucket público de propósito) e o número de dependentes. Nos dados cifrados em repouso, quem tem acesso administrativo ao banco **e** ao Vault enxerga tudo, porque a chave fica na mesma plataforma. Isso não vale para o que é cifrado de ponta a ponta (veja abaixo). A rotação das chaves existe para as colunas (migration 067) e para os arquivos (`scripts/rotate-file-key.mjs`, veja acima), as duas manuais.

### Criptografia de ponta a ponta (migration 085)

**O que é cifrado no navegador** (o servidor guarda só o conteúdo cifrado e nunca tem a chave): documentos do colaborador, atestados, anexos do banco de horas, selfies do ponto, as **mensagens diretas** e as mensagens dos **canais de grupo** do chat. Código em `src/javascript/shared/e2e-crypto.js` (WebCrypto), `e2e.js` (chaves e fluxos) e `e2e-ui.js` (janelas).

- **Chaves por pessoa:** cada usuário tem um par ECDH P-256 gerado no navegador. A chave privada vai ao banco (`e2e_keys`) só embrulhada pela senha (PBKDF2-SHA256, 600 mil iterações) e por uma **chave de recuperação** de 160 bits mostrada uma única vez no primeiro login. Depois do login, ela fica no IndexedDB como chave não exportável e é apagada ao sair.
- **Chave do RH:** um par da organização, entregue a cada administrador embrulhado com a chave pessoal dele (`e2e_org_key_grants`). Um administrador novo recebe acesso quando outro abre a tela Segurança.
- **Arquivos:** AES-256-GCM com chave aleatória por arquivo, embrulhada para o colaborador dono e para a chave do RH, no próprio cabeçalho do arquivo (formato `NXE1`). O envio vai direto ao Storage, com o RLS de sempre. Arquivos antigos seguem abrindo pela `nexus-files`, e o botão **Proteger arquivos antigos** (tela Segurança) os converte.
- **Mensagens diretas:** chave por conversa (`e2e_channel_keys`), embrulhada para os dois membros e versionada. Se um dos dois refaz as chaves, o outro recompartilha a conversa ao enviar a próxima mensagem.
- **Canais de grupo** (migration 086): chave por canal, embrulhada para cada membro que já tem chaves e para a chave do RH (o RH mantém a leitura prevista na política de compliance). Quem sai do canal força uma versão nova da chave e não lê o que vem depois. Quem entra ou cria chaves depois recebe a chave quando qualquer membro abre o canal.
- **Esqueceu a senha:** no login seguinte, a chave de recuperação reabre tudo e passa a valer a senha nova. Sem ela, a pessoa gera chaves novas: as conversas diretas antigas ficam ilegíveis, e os documentos voltam quando o RH usa "Proteger arquivos antigos".

**Continua visível para o servidor:** metadados (nome, tipo e dono do documento; quem conversa com quem e quando), cadastro, holerites e tudo que o sistema precisa processar (IA, alertas, folha, dashboard), que seguem cifrados em repouso com a chave do Vault. **Limite de todo E2E na web:** quem controla a hospedagem do front poderia publicar um JavaScript alterado; SRI, CSP e a revisão do código publicado reduzem, mas não eliminam, esse risco.

**Limitação conhecida da plataforma (Supabase, imagem `17.6.1.111`):** nessa versão, a extensão `supautils` derruba o Postgres quando `anon` ou `authenticated` chamam uma função sem permissão de execução (o código que monta a dica do erro, ligado por `supautils.hint_roles`, causa a falha de segmentação). Como a API expõe as funções do schema `public`, uma chamada a `/rest/v1/rpc/<função revogada>` reinicia o banco. Foi reproduzido localmente na mesma imagem, com PostgREST v12 e v14, e não acontece na `17.6.1.166`. A correção é atualizar o Postgres do projeto (no plano Free, pelo suporte do Supabase). O teste `test-integration/rpc-revogada-nao-derruba.js` confere isso e deve entrar no `test:integration`, junto com a troca da imagem do CI, depois da atualização.

**Desempenho:** decifrar tem custo por linha; ler 200 colaboradores leva na ordem de décimos de segundo. Para volumes muito maiores, vale cachear a chave por consulta ou paginar as listas.

### Proteções contra ataques

| Ameaça | Proteção |
|---|---|
| Colaborador alterar o próprio salário, cargo, status ou gestor | Migration `060`: policy de UPDATE só na própria linha **e** trigger que recusa qualquer coluna fora de nome, telefone, bio, avatar, preferências e último acesso. Vale também para colunas criadas no futuro. |
| XSS (código injetado por nome, mensagem, arquivo etc.) | Todo texto de usuário em HTML passa por `escapeHtml()` (`src/javascript/shared/html.js`). O teste `test/xss-guard.test.js` varre o código com um analisador de AST e **falha** se alguém interpolar texto de usuário sem escapar. Conteúdo HTML externo (markdown da IA, comunicados) passa por sanitizador com lista de permissões e parser inerte. |
| Execução de script externo / vazamento de dados | `vercel.json`: Content-Security-Policy (só as origens usadas; `connect-src` limitado ao Supabase, ViaCEP e CDNs), `frame-ancestors 'none'`, HSTS, `nosniff`, `Permissions-Policy` e COOP. |
| CDN comprometido (supply chain) | Todas as bibliotecas externas têm **versão fixa e SRI** (`integrity`). Para atualizar uma, gere o novo hash (`openssl dgst -sha384 -binary arquivo | openssl base64 -A`). |
| Senhas fracas | Mínimo de 12 caracteres, com letras e números, no app e em `supabase/config.toml`. **No projeto hospedado, ajuste o mesmo no painel** (Authentication → Sign In / Providers → Email). |
| Abuso e custo das funções de IA | Migration `061`: `rate_limit_check` limita por usuário (ai-alerts: 30/h; ai-employee-chat: 60/h). |
| Dependências vulneráveis | `npm audit --audit-level=high` no CI e Dependabot semanal. |
| Funções internas chamáveis por anônimo | Migrations `068` e `096`: retiram o `EXECUTE` de anônimos das funções internas; `kudos` e `onboarding_tasks` deixam de ser legíveis sem login. A `097` devolve o acesso só a `is_rh`, `my_employee_id`, `chat_is_member` e `chat_channel_is_dm`, usadas dentro das políticas de RLS (para quem não fez login elas devolvem "não" ou vazio), e `report_login_failure` segue aberta porque registra falhas antes do login. |
| Fraude no ponto (foto de outra pessoa, vídeo gravado) | Migration `092`: o modelo facial fica em `biometric_templates`, cifrado e sem acesso pela API; a comparação é feita no banco (`biometric_verify`), que recusa o mesmo vetor reenviado. No app há prova de vida (piscar) e consentimento explícito (LGPD art. 11). |
| Ex-colaborador continuar entrando | Migration `099`: `my_employee_id()` e `is_rh()` deixam de reconhecer quem está `Inativo` ou `Bloqueado`, então todas as políticas de RLS param de liberar dados para essa pessoa de uma vez. O login e as telas avisam "conta desativada" (`conta_desativada()`), e as inscrições de push são apagadas no desligamento. |
| Apagar provas (documentos, atendimentos) | Migration `091`: documento aprovado só sai por `soft_delete_documents` com motivo e respeitando o prazo de guarda; mensagens e chamados de atendimento não podem ser apagados, só ocultados. |

**Se o projeto Supabase mudar**, atualize o domínio em `connect-src` e `img-src` do `vercel.json`.

**Sem `'unsafe-inline'` em `script-src`:** o app não usa mais `onclick=`/`<script>` inline. Os manipuladores são atributos `data-click`, `data-change`, `data-input`, `data-keydown` e `data-keyup` (com `-args`, veja `src/javascript/shared/events.js`), ligados por listeners. Em templates JS use `data-click="fn" data-click-args="${dargs(id)}"`; nunca escreva `onclick=` (o teste `test/csp-inline.test.js` falha). O dispatcher só chama funções globais declaradas pelo app (não nativas), então markup injetado com `data-click="eval"` não executa código. Janelas de impressão usam `printWhenLoaded(win)` em vez de `<script>` inline.

**Sem `'unsafe-inline'` em `style-src`:** nenhum HTML ou template usa `style=`, `<style>` ou `setAttribute('style')` (o mesmo teste falha). Estilo fixo vai para classe CSS. Valor dinâmico usa um atributo de lista fechada, aplicado por `src/javascript/shared/dynamic-style.js` via `el.style`: `data-bg`/`data-color` (só cor), `data-w` (largura em %), `data-x`/`data-y` (px), `data-delay` (s), `data-bg-img` (só `https:`, `blob:` ou `data:image`) e `data-hide` (começa escondido e depois se comporta como `style.display = 'none'`). Janelas de impressão usam um `.css` próprio via `<link>`, e a orientação do holerite usa uma folha construída (`adoptedStyleSheets`).

**Limites conhecidos:** o CSS do Google Fonts não tem SRI (o Google serve um CSS diferente por navegador). A proteção contra senhas vazadas do Supabase (consulta ao HaveIBeenPwned) só existe no plano Pro; no plano Free o Security Advisor mostra esse aviso, e a compensação é a senha mínima de 12 caracteres, o MFA obrigatório para o RH, o limite de tentativas e o alerta de falhas de login em série. O Security Advisor também lista as funções `SECURITY DEFINER` chamáveis por usuários logados: são as RPCs do próprio app, e cada uma confere internamente o papel de quem chama. **MFA (TOTP):** obrigatório para o RH e opcional para o colaborador (`src/javascript/shared/mfa.js`, migration 063). Ao ativar, a pessoa recebe 10 códigos de recuperação (só o hash bcrypt fica no banco, migration 084). Se perder o celular, um código na tela de login desvincula o app e gera um alerta crítico para o RH; o RH então cadastra o celular novo na ativação obrigatória. **Alertas de comportamento anormal** (migration 066): falhas de login em série, login logo após falhas, exportação ou download em massa e acesso do RH fora do horário comercial, exibidos na tela Segurança.

---

## Privacidade (LGPD) e operação

- **Backup e restauração:** o backup cifrado (`scripts/backup/backup-db.mjs`) e a restauração em banco novo são ensaiados por `node scripts/backup/restore-drill.mjs` (Docker + gpg), que também roda todo mês no GitHub Actions. O relatório fica em `test-results/restore-drill/`.
- **Retenção:** `purge_security_events()` apaga eventos de segurança com mais de 180 dias e `purge_expired_conversations()` (migrations 081 e 110) apaga chat interno e histórico do assistente de IA do RH após 12 meses, e atendimentos resolvidos (ou só com o assistente) 5 anos após a última mensagem, por serem prova em reclamação trabalhista; atendimentos abertos ficam até serem resolvidos. As duas rodam todo dia pelo pg_cron. A política pública fica em `src/screens/privacidade.html` (versão de demonstração com empresa fictícia).
- **Acessos:** `scripts/ops/revisao-de-acessos.sql` lista quem tem acesso a quê.
- O schema não vai ao ar: o `.vercelignore` o exclui da hospedagem.

## Tecnologias

| Camada | Tecnologias |
|---|---|
| **Frontend** | HTML5 · CSS3 · JavaScript |
| **Backend** | Supabase (PostgreSQL · Auth · Storage · Realtime) |
| **Serverless** | TypeScript via Supabase Edge Functions (convites, IA, arquivos cifrados, push) |
| **IA** | Groq API — GPT-OSS 120B |
| **Deploy** | Vercel |

**Destaques de arquitetura**

- Autenticação com controle de acesso por papel (`administrador` / `colaborador`)
- Atualizações em tempo real com Supabase Realtime, sem polling
- Edge Functions para lógica sensível fora do cliente (convites, análise de IA)
- Row Level Security (RLS) para isolamento de dados por usuário no banco

---

## Equipe

| Nome |
|---|
| Madu Araújo |
| Vinicius |
| Igor |
| Maria Luiza |
| Aline |