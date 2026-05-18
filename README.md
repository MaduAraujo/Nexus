# Nexus

**Gestão de Recursos Humanos**

[![Status](https://img.shields.io/badge/status-ativo-22c55e?style=flat-square)](https://nexus-nine-zeta.vercel.app)
[![Versão](https://img.shields.io/badge/versão-1.0-6366f1?style=flat-square)](https://github.com/MaduAraujo/Nexus)

> Nexus é uma plataforma web que reúne em um só lugar tudo que o time de RH e os colaboradores precisam: ponto, férias, documentos, comunicação e muito mais.

🔗 **[Acesse o Nexus →](https://nexus-nine-zeta.vercel.app)**

---

## Índice
 
- [O problema que o Nexus resolve](#o-problema-que-o-nexus-resolve)
- [Para quem é o Nexus?](#para-quem-é-o-nexus)
- [Como funciona](#como-funciona)
- [Como começar a usar](#como-começar-a-usar)
- [Painel do RH](#painel-do-rh)
- [Portal do Colaborador](#portal-do-colaborador)
- [Inteligência Artificial integrada](#inteligência-artificial-integrada)
- [Tecnologias utilizadas](#tecnologias-utilizadas)
- [Limitações desta versão](#limitações-desta-versão)
- [Equipe](#equipe)
---

## O problema que o Nexus resolve
 
Empresas perdem horas toda semana gerenciando ponto em planilha, férias por e-mail e documentos espalhados em pastas compartilhadas. O resultado é retrabalho, falta de visibilidade e colaboradores sem acesso fácil às próprias informações.
 
O Nexus centraliza tudo isso em um único ambiente — organizado, em tempo real e com inteligência artificial monitorando o bem-estar da equipe.
 
---

## Para quem é o Nexus?
 
O Nexus é voltado para **qualquer empresa que queira substituir processos manuais de RH por uma solução digital centralizada** — independente do porte ou segmento.

---

## Como funciona
 
A plataforma funciona com dois perfis de acesso:
 
- **RH / Administrador** — controle total sobre a equipe, processos e dados.
- **Colaborador** — portal individual para acompanhar sua própria jornada na empresa.
 
---

## Como começar a usar
 
**1. Acesse o perfil do RH**
 
| Campo | Valor |
|---|---|
| **E-mail** | rh@nexus.com |
| **Senha** | Fam@1234 |
 
**2. Cadastre os colaboradores**
No painel do RH, acesse o módulo **Colaboradores** e cadastre-se como colaborador.

**3. Envie os convites**
Após o cadastro, a plataforma envia automaticamente um convite por e-mail para o colaborador criado.
 
**4. Colaborador acessa o portal**
O colaborador recebe o convite, define sua senha e já passa a ter acesso ao próprio portal — com seus dados, holerites, ponto e muito mais.
 
---

## Painel do RH

<div align="center">

![Painel RH](<Captura de tela 2026-05-18 134234.png>)

</div>

| O que pode fazer | Como funciona |
|---|---|
| 📊 **Dashboard** | Painel com indicadores da equipe atualizados em tempo real |
| 👥 **Colaboradores** | Cadastro, edição e gestão do ciclo de vida de cada funcionário |
| ⏱️ **Controle de Ponto** | Aprovação de registros, ajustes e gestão do banco de horas |
| 🏖️ **Férias** | Calendário de solicitações com fluxo completo de aprovação |
| 💬 **Comunicação** | Publicação de comunicados e chat direto com a equipe |
| 📁 **Documentos** | Envio e organização de arquivos e holerites por colaborador |
| 🤖 **Alertas de IA** | Detecção automática de sinais de burnout com análise por inteligência artificial |

---

## Painel do Colaborador

Cada colaborador tem seu próprio espaço personalizado, com seus dados de cargo, departamento e data de admissão logo na entrada.

<div align="center">

![Painel Colaborador](<Captura de tela 2026-05-18 134331.png>)

</div>

| O que pode fazer | Como funciona |
|---|---|
| ⏱️ **Ponto** | Registre entrada e saída e solicite ajustes quando necessário |
| 🏖️ **Férias** | Acompanhe seu saldo e o status das suas solicitações |
| 💰 **Holerites** | Acesse todo o histórico dos seus contracheques |
| 📁 **Documentos** | Visualize arquivos compartilhados pelo RH |
| 💬 **Chat** | Fale diretamente com o time de RH |
| 👤 **Perfil** | Mantenha seus dados pessoais, foto e biografia atualizados |

---

## Inteligência Artificial integrada
 
O módulo **Central de Alertas** usa a API da Anthropic (Claude) para analisar padrões de comportamento dos colaboradores — como excesso de horas, ausências frequentes e falta de interação — e sinalizar automaticamente possíveis riscos de burnout para o RH. Isso permite que a equipe de gestão de pessoas aja de forma preventiva, antes que o problema se agrave.

<div align="center">

![Central de Alertas](<Captura de tela 2026-05-18 140350.png>)

</div>
 
---

## Tecnologias utilizadas
 
```
Frontend     →  HTML5 · CSS3 · JavaScript
Backend      →  Supabase (PostgreSQL · Auth · Storage · Realtime)
Serverless   →  TypeScript via Supabase Edge Functions
IA           →  Claude API (Anthropic)
Deploy       →  Vercel
```
 
**Destaques de arquitetura:**
 
- Autenticação com controle de acesso por papel (`administrador` / `colaborador`)
- Atualizações em tempo real com Supabase Realtime (sem polling)
- Edge Functions para lógica sensível fora do cliente (convites, análise de IA)
- Row Level Security (RLS) no banco para isolamento de dados por usuário

---

## Equipe
 
| Nome |
|---|---|
| Madu Araújo |
| Vinicius |
| Igor |
| Maria Luiza |
| Aline |
 
---