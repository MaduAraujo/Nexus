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
Ao cadastrar, a plataforma envia automaticamente um convite por e-mail para o colaborador.

**4. Colaborador acessa o portal:**
O colaborador recebe o convite, define sua senha e passa a ter acesso ao próprio portal — com ponto, holerites, documentos e muito mais.

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

As functions em `supabase/functions/` são `invite-employee`, `ai-alerts`, `ai-employee-chat`, `nexus-files`, `send-push` e `send-alert-push`. As de IA (`ai-alerts` e `ai-employee-chat`) precisam da chave da [Groq](https://console.groq.com/):

```bash
npx supabase functions deploy
npx supabase secrets set GROQ_API_KEY=sua_chave_aqui
```

A `nexus-files` cifra e decifra os arquivos do Storage (documentos, anexos de ponto e de chat, selfies). **Sem ela publicada, nenhum upload nem abertura de arquivo funciona**, porque o front não tem alternativa. Ela precisa de uma chave mestra própria, em base64 de 32 bytes (guarde uma cópia fora do Supabase: sem ela os arquivos cifrados são irrecuperáveis):

```bash
npx supabase secrets set FILES_ENCRYPTION_KEY=$(openssl rand -base64 32)
```

Depois de publicar as funções, confira no painel do Supabase (Edge Functions) que as seis aparecem. Uma função ausente responde 404 ao front.

A function `send-push` envia notificações push (Web Push) quando o RH publica um comunicado imediato (não agendado). Ela precisa de um par de chaves VAPID como secret — gere o seu com `npx web-push generate-vapid-keys` e configure:

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=sua_chave_publica VAPID_PRIVATE_KEY=sua_chave_privada
```

A chave pública também precisa ser colada em `VAPID_PUBLIC_KEY` no topo de `src/javascript/perfil-colaborador.js` (client-side, por isso não é secret) — mantenha as duas em sincronia. Sem isso configurado, o botão "Notificações push do navegador" em Meu Perfil aparece normalmente, mas o envio real falha silenciosamente (log no `send-push`).

**Este passo é diferente do anterior** — é o Vault do Postgres (não `supabase secrets`), e sem ele **nenhum push server-side sai**: nem o reenvio de comunicado adiado por horário comercial (direito à desconexão), nem os alertas de compliance/burnout. As funções `dispatch_deferred_pushes()` e `notify_alert_push()` (rodam via `pg_cron`/triggers, não recebem `Authorization` de usuário) leem a URL do projeto e a service role key do Vault — sem eles, elas dão `RETURN` silencioso (mas emitem `RAISE WARNING`, visível nos Postgres Logs do dashboard ou via `get_logs`). Rode uma vez no SQL Editor do projeto (Project Settings → API para pegar a URL e a `service_role` key):

```sql
select vault.create_secret('https://SEU_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('SUA_SERVICE_ROLE_KEY', 'service_role_key');
```

Se os secrets já existirem (confira com `select name from vault.secrets where name in ('project_url','service_role_key');`), **não rode `create_secret` de novo** — isso cria um registro duplicado com o mesmo nome, e as funções acima (que fazem `SELECT ... INTO` sem `LIMIT`) podem silenciosamente pegar o valor errado. Para atualizar um valor existente, use `vault.update_secret(id, novo_valor)` pelo `id` do secret.

### 5. Rodar o app localmente

Sem build step — qualquer servidor estático funciona:

```bash
node test-support/static-server.js
# abre em http://127.0.0.1:4173/src/screens/login.html
```

### 6. Rodar os testes

O projeto tem 3 camadas de teste automatizado (o número exato de casos muda a cada mudança; rode os comandos para ver):

```bash
npm test               # unidade — folha/CLT/rescisão, criptografia de arquivos, MFA, guarda de XSS e de CSP, 260+ casos, sem dependências externas
npm run lint            # ESLint
npm run format:check    # Prettier
```

Os testes de **integração** (RLS real contra Postgres) e de **sistema/E2E** (Playwright, navegador real) precisam de uma instância local do Supabase via Docker:

```bash
npx supabase start --exclude analytics,storage,studio,realtime,imgproxy,vector,edge-runtime,functions
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/schema.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f test-support/local-test-db-grants.sql

npm run test:integration   # RLS, criptografia de colunas, MFA, limite de chamadas, alertas de segurança e rotação de chaves (116 casos)

npx playwright install --with-deps chromium
npm run test:e2e           # login → dashboard de RH e de colaborador, fim a fim
```

> **Já tem um Supabase local com o esquema antigo?** O `schema.sql` é para um banco vazio e não se sobrepõe a tabelas existentes. Em vez de recriar o seu banco de desenvolvimento, suba um segundo stack isolado: copie `supabase/config.toml` para uma pasta nova (`supabase/config.toml` dentro dela), troque o `project_id` e some 1000 às portas 543xx, rode `npx supabase start --exclude logflare,storage-api,studio,realtime,imgproxy,vector,edge-runtime` ali, carregue `schema.sql` e `local-test-db-grants.sql` na porta `55322` e rode os testes com `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres` e `E2E_SUPABASE_URL=http://127.0.0.1:55321`. Validado assim: os 7 testes E2E passam.

Esses 2 comandos rodam automaticamente em CI a cada push/PR para `main` (`.github/workflows/tests.yml`, jobs `rls-integration` e `e2e`).

---

## Painel do RH

<div align="center">

![Painel RH](README/Captura%20de%20tela%202026-05-18%20134234.png)

</div>

| Módulo | Descrição |
|---|---|
| **Dashboard** | Indicadores da equipe atualizados em tempo real |
| **Colaboradores** | Cadastro, edição e gestão do ciclo de vida de cada funcionário |
| **Controle de Ponto** | Aprovação de registros, ajustes e gestão do banco de horas |
| **Férias** | Calendário de solicitações com fluxo completo de aprovação |
| **Comunicação** | Publicação de comunicados e chat direto com a equipe |
| **Documentos** | Envio e organização de arquivos e holerites por colaborador |
| **Central de Alertas** | Detecção automática de risco de burnout via inteligência artificial |

---

## Portal do Colaborador

Cada colaborador tem um espaço personalizado com seus dados de cargo, departamento e data de admissão.

<div align="center">

![Portal do Colaborador](README/Captura%20de%20tela%202026-05-18%20134331.png)

</div>

| Módulo | Descrição |
|---|---|
| **Ponto** | Registre entrada e saída e solicite ajustes quando necessário |
| **Férias** | Acompanhe seu saldo e o status das solicitações |
| **Holerites** | Acesse o histórico completo dos contracheques |
| **Documentos** | Visualize arquivos compartilhados pelo RH |
| **Chat** | Fale diretamente com o time de RH |
| **Perfil** | Mantenha dados pessoais, foto e biografia atualizados |

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

**Aplicando em um banco existente:** rode as migrations em ordem, a partir da `057` até a `068`. A 059, a 062 e a 064 cifram os dados que já existem (a 064 exige a 059 e a 062 antes); a 060 restringe o que o colaborador edita; a 061 cria o limite de chamadas da IA; a 063 exige MFA para o RH; a 065 libera os buckets para arquivos cifrados; a 066 cria os alertas de comportamento anormal; a 067 permite trocar as chaves de cifragem; a 068 fecha leituras e execuções que estavam abertas a anônimos. Ordem de publicação que evita travar o RH: habilite o TOTP no painel do Supabase (Authentication → MFA) e publique o front antes da 063, e publique o front e as Edge Functions junto com a 064 e a 065 (front antigo lê a tabela cifrada). Em um projeto novo, `supabase/schema.sql` já traz tudo.

**Regras para quem desenvolve:**

- Para **ler** CPF, RG, telefone, salário, PIX, agência, conta, nascimento, gênero, raça/cor, deficiência ou o conteúdo de mensagens, consulte a view `*_decrypted`. A tabela devolve texto cifrado.
- Depois de **adicionar coluna** em `employees`, rode `select nexus_refresh_employees_view();` (o teste `test-integration/column-encryption.js` falha se a view ficar desatualizada).
- Para cifrar **outra coluna**, siga o padrão de `employees_encrypt_sensitive()` na migration 059.

**Também cifrados** (migrations 064 e 065): holerites (`payslips`), feedback anônimo, as tabelas de histórico, cache, memória e log da IA do RH, os indicadores `pcd` e `pensao_alimenticia`, e os arquivos dos buckets `documents`, `message-attachments` e `ponto-selfies` (AES-256-GCM pela Edge Function `nexus-files`, chave mestra no segredo `FILES_ENCRYPTION_KEY`). A leitura segue o mesmo padrão das views `*_decrypted`.

**O que ainda NÃO é cifrado:** avatares (bucket público de propósito), o histórico de edição (`employee_audit.changes`) e o número de dependentes. Quem tem acesso administrativo ao banco **e** ao Vault enxerga tudo, porque a chave fica na mesma plataforma. Não há criptografia ponta a ponta. A rotação das chaves de colunas existe (migration 067), mas é manual; a chave dos arquivos ainda não tem rotação.

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
| Funções internas chamáveis por anônimo | Migration `068`: retira o `EXECUTE` público das funções de cron/push e limita as demais a `authenticated`; `kudos` e `onboarding_tasks` deixam de ser legíveis sem login. |

**Se o projeto Supabase mudar**, atualize o domínio em `connect-src` e `img-src` do `vercel.json`.

**Sem `'unsafe-inline'` em `script-src`:** o app não usa mais `onclick=`/`<script>` inline. Os manipuladores são atributos `data-click`, `data-change`, `data-input`, `data-keydown` e `data-keyup` (com `-args`, veja `src/javascript/shared/events.js`), ligados por listeners. Em templates JS use `data-click="fn" data-click-args="${dargs(id)}"`; nunca escreva `onclick=` (o teste `test/csp-inline.test.js` falha). O dispatcher só chama funções globais declaradas pelo app (não nativas), então markup injetado com `data-click="eval"` não executa código. Janelas de impressão usam `printWhenLoaded(win)` em vez de `<script>` inline.

**Limites conhecidos:** `style-src` ainda tem `'unsafe-inline'` (atributos `style=` e `<style>` em vários templates), então injeção de CSS não é barrada. O CSS do Google Fonts não tem SRI (o Google serve um CSS diferente por navegador). **MFA (TOTP):** obrigatório para o RH e opcional para o colaborador (`src/javascript/shared/mfa.js`, migration 063). Não há códigos de recuperação: se o RH perder o aparelho, só removendo o fator pelo painel do Supabase. **Alertas de comportamento anormal** (migration 066): falhas de login em série, login logo após falhas, exportação ou download em massa e acesso do RH fora do horário comercial, exibidos na tela Segurança.

---

## Privacidade (LGPD) e operação

- **Backup e restauração:** o backup cifrado (`scripts/backup/backup-db.mjs`) e a restauração em banco novo são ensaiados por `node scripts/backup/restore-drill.mjs` (Docker + gpg), que também roda todo mês no GitHub Actions. O relatório fica em `test-results/restore-drill/`.
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