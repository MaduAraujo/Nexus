<div align="center">

# Nexus

**Sistema web de gestão de Recursos Humanos**

![Version](https://img.shields.io/badge/versão-1.0-6366f1?style=flat-square)
![Status](https://img.shields.io/badge/status-ativo-22c55e?style=flat-square)
![Frontend](https://img.shields.io/badge/frontend-vanilla%20JS-f59e0b?style=flat-square)
![Backend](https://img.shields.io/badge/backend-supabase-3ecf8e?style=flat-square)

</div>

---

## Sobre o projeto

O **Nexus** é uma plataforma de RH que centraliza os processos de gestão de pessoas de uma empresa. O sistema oferece dois ambientes distintos: um **painel administrativo** para o time de RH e um **portal individual** para cada colaborador.

---

## Funcionalidades

### Painel do RH

| Módulo | Descrição |
|---|---|
| **Dashboard** | Visão consolidada da equipe com indicadores em tempo real |
| **Colaboradores** | Cadastro, edição e gestão do ciclo de vida de cada funcionário |
| **Controle de Ponto** | Aprovação de registros, ajustes e gestão do banco de horas |
| **Férias** | Calendário de solicitações com fluxo completo de aprovação |
| **Comunicação** | Publicação de comunicados e chat interno com a equipe |
| **Documentos** | Envio e organização de arquivos e holerites por colaborador |
| **Alertas de IA** | Detecção de sinais de burnout com análise inteligente por IA |

### Portal do Colaborador

| Módulo | Descrição |
|---|---|
| **Ponto** | Registro de entrada/saída e solicitação de ajustes |
| **Férias** | Acompanhamento de saldo e status das solicitações |
| **Holerites** | Acesso ao histórico de contracheques |
| **Documentos** | Visualização de arquivos compartilhados pelo RH |
| **Chat** | Comunicação direta com o time de RH |
| **Perfil** | Edição de dados pessoais, foto e biografia |

---

## Tecnologias

```
Frontend   →  HTML5 · CSS3 · JavaScript
Backend    →  Supabase (PostgreSQL · Auth · Storage · Realtime)
Serverless →  TypeScript via Supabase Edge Functions
IA         →  Claude API (Anthropic) — análise de alertas de bem-estar
```

**Destaques de arquitetura:**
- Autenticação com controle de acesso por papel (`administrador` / `colaborador`)
- Atualizações em tempo real com Supabase Realtime (sem polling)
- Edge Functions para lógica sensível fora do cliente (convites, análise de IA)
- Row Level Security (RLS) no banco para isolamento de dados por usuário

---

## Rodando localmente

O projeto não possui etapa de build — basta servir os arquivos estáticos.

**Pré-requisitos**
- Conta no [Supabase](https://supabase.com) (plano gratuito é suficiente)
- Servidor HTTP local: [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) (VSCode)

**Passos**

```bash
# 1. Clone o repositório

git clone https://github.com/seu-usuario/nexus-rh.git
cd nexus-rh

# 2. No Supabase, execute supabase/schema.sql para criar as tabelas

# 3. Informe suas credenciais em src/javascript/supabase-client.js

# 4. Abra index.html com seu servidor HTTP local
```