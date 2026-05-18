# Nexus RH

![Version](https://img.shields.io/badge/versão-1.0-blue) ![Status](https://img.shields.io/badge/status-ativo-brightgreen)

**Nexus** é um sistema web de gestão de Recursos Humanos desenvolvido para centralizar os processos do dia a dia de uma empresa — controle de ponto, férias, holerites, comunicação interna e muito mais — em uma interface moderna e acessível.

---

## Funcionalidades

**Painel do RH**
- Dashboard com visão geral da equipe
- Cadastro e gestão de colaboradores
- Aprovação de registros de ponto, ajustes e banco de horas
- Gestão de férias com calendário de aprovações
- Publicação de comunicados e chat interno
- Gerenciamento de holerites, documentos e arquivos
- Alertas inteligentes de burnout com análise por IA

**Portal do Colaborador**
- Registro de ponto e solicitação de ajustes
- Acompanhamento de férias e saldo de banco de horas
- Acesso a holerites e documentos
- Chat com o RH e visualização de comunicados
- Perfil editável com foto e biografia

---

## Tecnologias

| | |
|---|---|
| **Frontend** | HTML5, CSS3, JavaScript |
| **Backend** | Supabase — banco PostgreSQL, autenticação, storage e realtime |
| **Funções serverless** | TypeScript via Supabase Edge Functions |
| **IA** | Claude API — análise de alertas de bem-estar |

---

## Rodando localmente

O projeto não possui build step — basta servir os arquivos estáticos.

**Pré-requisitos:** conta no [Supabase](https://supabase.com) e um servidor HTTP local (ex: extensão Live Server no VSCode).

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/nexus-rh.git
cd nexus-rh

# Configure suas credenciais Supabase em:
# src/javascript/supabase-client.js
# Abra index.html com Live Server ou qualquer servidor HTTP
```

> O schema completo do banco está em `supabase/schema.sql`.

---

## Autoria

Desenvolvido por **Maria Eduarda**
