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

As functions em `supabase/functions/` (`invite-employee`, `ai-alerts`, `ai-employee-chat`) precisam da chave da [Groq](https://console.groq.com/) para os recursos de IA:

```bash
npx supabase functions deploy
npx supabase secrets set GROQ_API_KEY=sua_chave_aqui
```

A function `send-push` envia notificações push (Web Push) quando o RH publica um comunicado imediato (não agendado). Ela precisa de um par de chaves VAPID como secret — gere o seu com `npx web-push generate-vapid-keys` e configure:

```bash
npx supabase secrets set VAPID_PUBLIC_KEY=sua_chave_publica VAPID_PRIVATE_KEY=sua_chave_privada
```

A chave pública também precisa ser colada em `VAPID_PUBLIC_KEY` no topo de `src/javascript/perfil-colaborador.js` (client-side, por isso não é secret) — mantenha as duas em sincronia. Sem isso configurado, o botão "Notificações push do navegador" em Meu Perfil aparece normalmente, mas o envio real falha silenciosamente (log no `send-push`).

### 5. Rodar o app localmente

Sem build step — qualquer servidor estático funciona:

```bash
node test-support/static-server.js
# abre em http://127.0.0.1:4173/src/screens/login.html
```

### 6. Rodar os testes

O projeto tem 3 camadas de teste automatizado:

```bash
npm test               # unidade — cálculos de folha/CLT/rescisão, ~100 casos, sem dependências externas
npm run lint            # ESLint
npm run format:check    # Prettier
```

Os testes de **integração** (RLS real contra Postgres) e de **sistema/E2E** (Playwright, navegador real) precisam de uma instância local do Supabase via Docker:

```bash
npx supabase start --exclude analytics,storage,studio,realtime,imgproxy,vector,edge-runtime,functions
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/schema.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f test-support/local-test-db-grants.sql

npm run test:integration   # RLS: policies de employees, time_records, hr_tickets etc.

npx playwright install --with-deps chromium
npm run test:e2e           # login → dashboard de RH e de colaborador, fim a fim
```

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

O módulo **Central de Alertas** usa a API da Groq (modelo Llama 3.3 70B) para analisar padrões de comportamento — excesso de horas, ausências frequentes, baixa interação — e sinalizar automaticamente possíveis riscos de burnout para o RH. A gestão de pessoas passa a agir de forma preventiva, antes que o problema se agrave.

<div align="center">

![Central de Alertas](README/Captura%20de%20tela%202026-05-18%20140350.png)

</div>

---

## Tecnologias

| Camada | Tecnologias |
|---|---|
| **Frontend** | HTML5 · CSS3 · JavaScript |
| **Backend** | Supabase (PostgreSQL · Auth · Storage · Realtime) |
| **Serverless** | TypeScript via Supabase Edge Functions |
| **IA** | Groq API — Llama 3.3 70B |
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